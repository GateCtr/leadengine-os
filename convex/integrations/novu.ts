/**
 * Novu Integration — Push & In-App Notifications for LeadEngine OS
 *
 * Pure helper module (NOT a Convex registered function).
 * Called from within Convex actions to send notifications via Novu.
 *
 * Requirements: 16.1 (critical lead push), 16.2 (hot reply push),
 *               16.3 (idle hot lead push + banner), 16.4 (churn signal push + alert),
 *               16.5 (pending validation dashboard notification)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Supported Novu workflow identifiers.
 * Each maps to a specific alert type in the notifications table.
 */
export type NovuWorkflowId =
  | "critical_lead"
  | "hot_reply"
  | "idle_hot_lead"
  | "churn_signal"
  | "pending_validation"
  | "weekly_report";

/**
 * Notification priority levels matching the notifications table schema.
 */
export type NotificationPriority = "critical" | "high" | "medium" | "info";

/**
 * Parameters for sending a notification via Novu.
 */
export interface SendNotificationParams {
  /** Novu subscriber ID (typically the Clerk userId) */
  subscriberId: string;
  /** Workflow to trigger */
  workflowId: NovuWorkflowId;
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** Priority level for the notification */
  priority: NotificationPriority;
  /** Optional payload data passed to the Novu workflow template */
  payload?: Record<string, unknown>;
}

export interface SendNotificationResult {
  /** Whether the notification was successfully sent via Novu */
  sentViaNovu: boolean;
  /** Novu transaction ID (only present when sentViaNovu is true) */
  transactionId?: string;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class NovuApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "NovuApiError";
  }
}

export class NovuRateLimitError extends NovuApiError {
  constructor(message: string = "Novu rate limit exceeded (429)") {
    super(message, 429, true);
    this.name = "NovuRateLimitError";
  }
}

export class NovuTimeoutError extends NovuApiError {
  constructor(message: string = "Novu request timed out") {
    super(message, 0, true);
    this.name = "NovuTimeoutError";
  }
}

export class NovuInvalidResponseError extends NovuApiError {
  constructor(message: string = "Novu returned an invalid response") {
    super(message, 0, false);
    this.name = "NovuInvalidResponseError";
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NOVU_API_URL = "https://api.novu.co/v1/events/trigger";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

/**
 * Valid workflow IDs for validation.
 */
export const VALID_WORKFLOW_IDS: ReadonlySet<NovuWorkflowId> = new Set([
  "critical_lead",
  "hot_reply",
  "idle_hot_lead",
  "churn_signal",
  "pending_validation",
  "weekly_report",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calculate the backoff delay for a given retry attempt.
 * Uses exponential backoff: 500ms, 1000ms.
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
 * Send a single notification via the Novu API (no retry).
 *
 * @param params - Notification parameters
 * @param apiKey - Novu API key (defaults to env var NOVU_API_KEY)
 * @param timeoutMs - Request timeout in milliseconds (default: 15s)
 * @returns The result with transactionId
 * @throws NovuApiError on API errors
 * @throws NovuRateLimitError on 429 responses
 * @throws NovuTimeoutError on timeout
 * @throws NovuInvalidResponseError on unparseable responses
 */
export async function sendNotificationOnce(
  params: SendNotificationParams,
  apiKey?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SendNotificationResult> {
  const key = apiKey ?? process.env.NOVU_API_KEY;
  if (!key) {
    throw new NovuApiError(
      "NOVU_API_KEY is not set in environment variables",
      0,
      false,
    );
  }

  if (!params.subscriberId || params.subscriberId.trim().length === 0) {
    throw new NovuApiError("subscriberId cannot be empty", 0, false);
  }
  if (!VALID_WORKFLOW_IDS.has(params.workflowId)) {
    throw new NovuApiError(
      `Invalid workflowId: "${params.workflowId}". Must be one of: ${[...VALID_WORKFLOW_IDS].join(", ")}`,
      0,
      false,
    );
  }
  if (!params.title || params.title.trim().length === 0) {
    throw new NovuApiError("title cannot be empty", 0, false);
  }
  if (!params.body || params.body.trim().length === 0) {
    throw new NovuApiError("body cannot be empty", 0, false);
  }

  const requestBody = {
    name: params.workflowId,
    to: {
      subscriberId: params.subscriberId,
    },
    payload: {
      title: params.title,
      body: params.body,
      priority: params.priority,
      ...(params.payload ?? {}),
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(NOVU_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${key}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new NovuTimeoutError();
    }
    const message =
      error instanceof Error ? error.message : "Unknown network error";
    throw new NovuApiError(`Novu network error: ${message}`, 0, true);
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    throw new NovuRateLimitError();
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore read errors
    }
    throw new NovuApiError(
      `Novu API error (${response.status}): ${errorBody}`.slice(0, 500),
      response.status,
      response.status >= 500,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new NovuInvalidResponseError("Novu returned non-JSON response");
  }

  if (!data || typeof data !== "object") {
    throw new NovuInvalidResponseError(
      "Novu returned an unexpected response format",
    );
  }

  const responseObj = data as Record<string, unknown>;
  const dataField = responseObj.data as Record<string, unknown> | undefined;
  const transactionId =
    (dataField?.transactionId as string) ??
    (responseObj.transactionId as string);

  return {
    sentViaNovu: true,
    transactionId: typeof transactionId === "string" ? transactionId : undefined,
  };
}

/**
 * Options for the sendNotification function.
 */
export interface SendNotificationOptions {
  /** Optional Novu API key override (defaults to env var) */
  apiKey?: string;
  /** Optional timeout override per request in milliseconds */
  timeoutMs?: number;
  /** Optional custom sleep function for testing (defaults to real setTimeout) */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Send a notification via Novu with retry (2 retries: 500ms, 1000ms).
 *
 * On failure after all retries, returns { sentViaNovu: false } instead of
 * throwing — the caller should fall back to storing the notification in the
 * database only (notifications table).
 *
 * This is the main entry point for sending notifications in LeadEngine OS.
 *
 * @param params - Notification parameters
 * @param options - Optional configuration (apiKey, timeoutMs, sleepFn)
 * @returns Result indicating whether Novu delivery succeeded
 */
export async function sendNotification(
  params: SendNotificationParams,
  options?: SendNotificationOptions,
): Promise<SendNotificationResult> {
  const opts = options ?? {};
  const sleepImpl = opts.sleepFn ?? sleep;

  // Validation errors should throw immediately (not retryable)
  const key = opts.apiKey ?? process.env.NOVU_API_KEY;
  if (!key) {
    return { sentViaNovu: false };
  }
  if (!params.subscriberId || params.subscriberId.trim().length === 0) {
    throw new NovuApiError("subscriberId cannot be empty", 0, false);
  }
  if (!VALID_WORKFLOW_IDS.has(params.workflowId)) {
    throw new NovuApiError(
      `Invalid workflowId: "${params.workflowId}". Must be one of: ${[...VALID_WORKFLOW_IDS].join(", ")}`,
      0,
      false,
    );
  }
  if (!params.title || params.title.trim().length === 0) {
    throw new NovuApiError("title cannot be empty", 0, false);
  }
  if (!params.body || params.body.trim().length === 0) {
    throw new NovuApiError("body cannot be empty", 0, false);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendNotificationOnce(params, opts.apiKey, opts.timeoutMs);
    } catch (error: unknown) {
      // Non-retryable errors should not be retried
      if (error instanceof NovuApiError && !error.isRetryable) {
        throw error;
      }

      // Don't sleep after the last attempt
      if (attempt < MAX_RETRIES) {
        const backoffMs = calculateBackoffMs(attempt);
        await sleepImpl(backoffMs);
      }
    }
  }

  // All retries exhausted — fallback to database-only notification
  return { sentViaNovu: false };
}
