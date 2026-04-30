/**
 * Resend Integration — Email Sending for LeadEngine OS
 *
 * Pure helper module (NOT a Convex registered function).
 * Called from within Convex actions (e.g., sendApprovedEmail).
 *
 * Requirements: 7.3 (send email via Resend from product domain),
 *               17.1 (unsubscribe link in every email — GDPR/CAN-SPAM)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendEmailParams {
  /** Sender address from the product domain (e.g. "hello@piksend.com") */
  from: string;
  /** Recipient email address */
  to: string;
  /** Reply-to address for the product */
  replyTo: string;
  /** Email subject line */
  subject: string;
  /** HTML body of the email */
  html: string;
  /** Optional unsubscribe URL — auto-generated if not provided */
  unsubscribeUrl?: string;
}

export interface SendEmailResult {
  /** Resend message ID for tracking */
  messageId: string;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class ResendApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "ResendApiError";
  }
}

export class ResendRateLimitError extends ResendApiError {
  constructor(message: string = "Resend rate limit exceeded (429)") {
    super(message, 429, true);
    this.name = "ResendRateLimitError";
  }
}

export class ResendTimeoutError extends ResendApiError {
  constructor(message: string = "Resend request timed out") {
    super(message, 0, true);
    this.name = "ResendTimeoutError";
  }
}

export class ResendInvalidResponseError extends ResendApiError {
  constructor(message: string = "Resend returned an invalid response") {
    super(message, 0, false);
    this.name = "ResendInvalidResponseError";
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const DEFAULT_UNSUBSCRIBE_BASE_URL = "https://leadengine.io/unsubscribe";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the unsubscribe URL for a given recipient email.
 * Uses a base64-encoded email as a simple identifier.
 */
export function buildUnsubscribeUrl(
  recipientEmail: string,
  baseUrl: string = DEFAULT_UNSUBSCRIBE_BASE_URL,
): string {
  const encoded = btoa(recipientEmail);
  return `${baseUrl}?id=${encodeURIComponent(encoded)}`;
}

/**
 * Append an unsubscribe footer to the HTML body.
 * GDPR/CAN-SPAM compliant: every email must include a visible unsubscribe link.
 */
export function appendUnsubscribeFooter(
  html: string,
  unsubscribeUrl: string,
): string {
  const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">` +
    `<p>Si vous ne souhaitez plus recevoir nos emails, ` +
    `<a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">cliquez ici pour vous désinscrire</a>.</p>` +
    `</div>`;
  return html + footer;
}

/**
 * Calculate the backoff delay for a given retry attempt.
 * Uses exponential backoff: 1s, 2s, 4s.
 */
export function calculateBackoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Send a single email via the Resend API (no retry).
 *
 * @param params - Email parameters (from, to, replyTo, subject, html)
 * @param apiKey - Resend API key (defaults to env var RESEND_API_KEY)
 * @param timeoutMs - Request timeout in milliseconds (default: 30s)
 * @returns The Resend messageId
 * @throws ResendApiError on API errors
 * @throws ResendRateLimitError on 429 responses
 * @throws ResendTimeoutError on timeout
 * @throws ResendInvalidResponseError on unparseable responses
 */
export async function sendEmailOnce(
  params: SendEmailParams,
  apiKey?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SendEmailResult> {
  const key = apiKey ?? process.env.RESEND_API_KEY;
  if (!key) {
    throw new ResendApiError(
      "RESEND_API_KEY is not set in environment variables",
      0,
      false,
    );
  }

  // Validate required params
  if (!params.from || params.from.trim().length === 0) {
    throw new ResendApiError("Sender (from) cannot be empty", 0, false);
  }
  if (!params.to || params.to.trim().length === 0) {
    throw new ResendApiError("Recipient (to) cannot be empty", 0, false);
  }
  if (!params.subject || params.subject.trim().length === 0) {
    throw new ResendApiError("Subject cannot be empty", 0, false);
  }
  if (!params.html || params.html.trim().length === 0) {
    throw new ResendApiError("HTML body cannot be empty", 0, false);
  }

  // Build unsubscribe URL and append footer (GDPR/CAN-SPAM)
  const unsubscribeUrl =
    params.unsubscribeUrl ?? buildUnsubscribeUrl(params.to);
  const htmlWithFooter = appendUnsubscribeFooter(params.html, unsubscribeUrl);

  // Build request body
  const body = {
    from: params.from,
    to: [params.to],
    reply_to: params.replyTo,
    subject: params.subject,
    html: htmlWithFooter,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  // Execute fetch with timeout via AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ResendTimeoutError();
    }
    const message =
      error instanceof Error ? error.message : "Unknown network error";
    throw new ResendApiError(
      `Resend network error: ${message}`,
      0,
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP errors
  if (response.status === 429) {
    throw new ResendRateLimitError();
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore read errors
    }
    throw new ResendApiError(
      `Resend API error (${response.status}): ${errorBody}`.slice(0, 500),
      response.status,
      response.status >= 500,
    );
  }

  // Parse response
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ResendInvalidResponseError(
      "Resend returned non-JSON response",
    );
  }

  // Validate response shape — Resend returns { id: "..." }
  if (!data || typeof data !== "object") {
    throw new ResendInvalidResponseError(
      "Resend returned an unexpected response format",
    );
  }

  const responseObj = data as Record<string, unknown>;
  const messageId = responseObj.id;

  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new ResendInvalidResponseError(
      "Resend response missing 'id' field (messageId)",
    );
  }

  return { messageId };
}

/**
 * Options for the sendEmail function.
 */
export interface SendEmailOptions {
  /** Optional Resend API key override (defaults to env var) */
  apiKey?: string;
  /** Optional timeout override per request in milliseconds */
  timeoutMs?: number;
  /** Optional custom sleep function for testing (defaults to real setTimeout) */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Send an email via Resend with exponential backoff retry (3 retries: 1s, 2s, 4s).
 *
 * Automatically includes an unsubscribe link in every email (GDPR/CAN-SPAM).
 * Returns the Resend messageId for tracking.
 *
 * This is the main entry point for sending emails in LeadEngine OS.
 *
 * @param params - Email parameters (from, to, replyTo, subject, html)
 * @param options - Optional configuration (apiKey, timeoutMs, sleepFn)
 * @returns The Resend messageId
 * @throws ResendApiError after all retries are exhausted
 */
export async function sendEmail(
  params: SendEmailParams,
  options?: string | SendEmailOptions,
): Promise<SendEmailResult> {
  // Support legacy signature: sendEmail(params, apiKey)
  const opts: SendEmailOptions =
    typeof options === "string" ? { apiKey: options } : (options ?? {});
  const sleepImpl = opts.sleepFn ?? sleep;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendEmailOnce(params, opts.apiKey, opts.timeoutMs);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on retryable errors
      if (error instanceof ResendApiError && !error.isRetryable) {
        throw error;
      }

      // Don't sleep after the last attempt
      if (attempt < MAX_RETRIES) {
        const backoffMs = calculateBackoffMs(attempt);
        await sleepImpl(backoffMs);
      }
    }
  }

  throw lastError ?? new ResendApiError("All retries exhausted", 0, false);
}
