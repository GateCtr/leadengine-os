/**
 * Serper.dev Integration — Web Search for Lead Detection
 *
 * Pure helper module (NOT a Convex registered function).
 * Called from within Convex actions (e.g., Agent Radar).
 *
 * Requirements: 1.1 (Serper.dev search), 1.4 (error handling & retry)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SerperSearchParams {
  /** Pain keyword to search for */
  q: string;
  /** Number of results (10–100) */
  num: number;
  /** Target country code (e.g., "fr", "us") */
  gl?: string;
  /** Language code (e.g., "fr", "en") */
  hl?: string;
}

export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export interface SerperSearchResponse {
  organic: SerperOrganicResult[];
  searchParameters?: {
    q: string;
    gl?: string;
    hl?: string;
    num?: number;
  };
}

/**
 * A lead candidate extracted from a Serper.dev search result.
 * This is the parsed output before insertion into the Convex `leads` table.
 */
export interface LeadCandidate {
  /** Email extracted from the snippet or page content (may be null) */
  email: string | null;
  /** Name extracted from the result title or snippet (may be null) */
  name: string | null;
  /** URL of the source page */
  sourceUrl: string;
  /** Channel where the lead was detected */
  detectionChannel: string;
  /** Original snippet text from the search result */
  snippet: string;
  /** Position in search results */
  position: number;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class SerperApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "SerperApiError";
  }
}

export class SerperRateLimitError extends SerperApiError {
  constructor(message: string = "Serper.dev rate limit exceeded (429)") {
    super(message, 429, true);
    this.name = "SerperRateLimitError";
  }
}

export class SerperTimeoutError extends SerperApiError {
  constructor(message: string = "Serper.dev request timed out") {
    super(message, 0, true);
    this.name = "SerperTimeoutError";
  }
}

export class SerperInvalidResponseError extends SerperApiError {
  constructor(message: string = "Serper.dev returned an invalid response") {
    super(message, 0, false);
    this.name = "SerperInvalidResponseError";
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SERPER_API_URL = "https://google.serper.dev/search";
const DEFAULT_TIMEOUT_MS = 15_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detect the channel from a URL (e.g., twitter.com → "twitter").
 * Falls back to "web" for generic sites.
 */
export function detectChannelFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("twitter.com") || hostname.includes("x.com"))
      return "twitter";
    if (hostname.includes("linkedin.com")) return "linkedin";
    if (hostname.includes("reddit.com")) return "reddit";
    if (hostname.includes("instagram.com")) return "instagram";
    if (hostname.includes("github.com")) return "github";
    return "web";
  } catch {
    return "web";
  }
}

/**
 * Attempt to extract an email address from a text snippet.
 * Returns the first match or null.
 */
export function extractEmailFromText(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const match = text.match(emailRegex);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Attempt to extract a person's name from a search result title.
 * Uses simple heuristics — strips common suffixes like " - LinkedIn", " | Twitter", etc.
 */
export function extractNameFromTitle(title: string): string | null {
  if (!title || title.trim().length === 0) return null;

  // Strip common platform suffixes
  const cleaned = title
    .replace(/\s*[-–|·]\s*(LinkedIn|Twitter|X|GitHub|Reddit|Instagram|Medium|Dev\.to|Stack Overflow).*$/i, "")
    .replace(/\s*[-–|·]\s*Profile.*$/i, "")
    .trim();

  // If the cleaned title is very short or looks like a URL/code, skip it
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (/^https?:\/\//.test(cleaned)) return null;

  return cleaned || null;
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Execute a search query against the Serper.dev API.
 *
 * @param params - Search parameters (q, num, gl, hl)
 * @param apiKey - Serper.dev API key (defaults to env var SERPER_API_KEY)
 * @param timeoutMs - Request timeout in milliseconds (default: 15s)
 * @returns Raw Serper.dev search response
 * @throws SerperApiError on API errors
 * @throws SerperRateLimitError on 429 responses
 * @throws SerperTimeoutError on timeout
 * @throws SerperInvalidResponseError on unparseable responses
 */
export async function searchSerper(
  params: SerperSearchParams,
  apiKey?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SerperSearchResponse> {
  const key = apiKey ?? process.env.SERPER_API_KEY;
  if (!key) {
    throw new SerperApiError(
      "SERPER_API_KEY is not set in environment variables",
      0,
      false,
    );
  }

  // Validate params
  if (!params.q || params.q.trim().length === 0) {
    throw new SerperApiError("Search query (q) cannot be empty", 0, false);
  }
  if (params.num < 1 || params.num > 100) {
    throw new SerperApiError(
      "Number of results (num) must be between 1 and 100",
      0,
      false,
    );
  }

  // Build request body
  const body: Record<string, unknown> = {
    q: params.q,
    num: params.num,
  };
  if (params.gl) body.gl = params.gl;
  if (params.hl) body.hl = params.hl;

  // Execute fetch with timeout via AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(SERPER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SerperTimeoutError();
    }
    // Network error
    const message =
      error instanceof Error ? error.message : "Unknown network error";
    throw new SerperApiError(
      `Serper.dev network error: ${message}`,
      0,
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP errors
  if (response.status === 429) {
    throw new SerperRateLimitError();
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore read errors
    }
    throw new SerperApiError(
      `Serper.dev API error (${response.status}): ${errorBody}`.slice(0, 500),
      response.status,
      response.status >= 500,
    );
  }

  // Parse response
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new SerperInvalidResponseError(
      "Serper.dev returned non-JSON response",
    );
  }

  // Validate response shape
  if (!data || typeof data !== "object") {
    throw new SerperInvalidResponseError(
      "Serper.dev returned an unexpected response format",
    );
  }

  const responseObj = data as Record<string, unknown>;
  const organic = responseObj.organic;

  // organic may be missing if no results found — treat as empty array
  if (organic !== undefined && !Array.isArray(organic)) {
    throw new SerperInvalidResponseError(
      "Serper.dev response 'organic' field is not an array",
    );
  }

  return {
    organic: Array.isArray(organic)
      ? (organic as SerperOrganicResult[])
      : [],
    searchParameters: responseObj.searchParameters as
      | SerperSearchResponse["searchParameters"]
      | undefined,
  };
}

/**
 * Parse Serper.dev organic results into lead candidates.
 *
 * Extracts emails, names, source URLs, and detection channels from
 * each search result. Results without any useful data are still included
 * (with null email/name) so the caller can decide how to handle them.
 *
 * @param results - Array of organic search results from Serper.dev
 * @returns Array of lead candidates
 */
export function parseResultsToLeadCandidates(
  results: SerperOrganicResult[],
): LeadCandidate[] {
  return results.map((result) => {
    const combinedText = `${result.title} ${result.snippet}`;
    const email = extractEmailFromText(combinedText);
    const name = extractNameFromTitle(result.title);
    const detectionChannel = detectChannelFromUrl(result.link);

    return {
      email,
      name,
      sourceUrl: result.link,
      detectionChannel,
      snippet: result.snippet,
      position: result.position,
    };
  });
}

/**
 * High-level function: search Serper.dev and return parsed lead candidates.
 *
 * This is the main entry point for the Agent Radar.
 *
 * @param params - Search parameters
 * @param apiKey - Optional API key override
 * @param timeoutMs - Optional timeout override
 * @returns Array of lead candidates parsed from search results
 */
export async function searchAndParseLeads(
  params: SerperSearchParams,
  apiKey?: string,
  timeoutMs?: number,
): Promise<LeadCandidate[]> {
  const response = await searchSerper(params, apiKey, timeoutMs);
  return parseResultsToLeadCandidates(response.organic);
}
