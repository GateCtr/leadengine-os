/**
 * Firecrawl Integration — Profile Scraping for Lead Enrichment
 *
 * Pure helper module (NOT a Convex registered function).
 * Called from within Convex actions (e.g., Agent Qualificateur).
 *
 * Requirements: 3.1 (Firecrawl scraping), 3.3 (error handling & retry)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FirecrawlScrapeParams {
  /** URL of the public profile to scrape */
  url: string;
  /** Output formats requested (default: ["markdown"]) */
  formats?: string[];
}

export interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      [key: string]: unknown;
    };
  };
}

/**
 * Enrichment data extracted from a scraped profile.
 * Matches the `enrichmentData` field in the Convex `leads` schema.
 */
export interface EnrichmentData {
  linkedinUrl?: string;
  githubUrl?: string;
  websiteUrl?: string;
  bio?: string;
  skills?: string[];
  company?: string;
  role?: string;
  scrapedAt?: number;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class FirecrawlApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "FirecrawlApiError";
  }
}

export class FirecrawlTimeoutError extends FirecrawlApiError {
  constructor(message: string = "Firecrawl request timed out") {
    super(message, 0, true);
    this.name = "FirecrawlTimeoutError";
  }
}

export class FirecrawlNotFoundError extends FirecrawlApiError {
  constructor(message: string = "Profile not found or inaccessible") {
    super(message, 404, false);
    this.name = "FirecrawlNotFoundError";
  }
}

export class FirecrawlInvalidResponseError extends FirecrawlApiError {
  constructor(message: string = "Firecrawl returned an invalid response") {
    super(message, 0, false);
    this.name = "FirecrawlInvalidResponseError";
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape";
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/**
 * Extract a LinkedIn URL from markdown content.
 */
export function extractLinkedinUrl(text: string): string | undefined {
  const match = text.match(
    /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/i,
  );
  return match ? match[0] : undefined;
}

/**
 * Extract a GitHub URL from markdown content.
 */
export function extractGithubUrl(text: string): string | undefined {
  const match = text.match(
    /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+\/?/i,
  );
  return match ? match[0] : undefined;
}

/**
 * Extract a personal website URL from markdown content.
 * Looks for URLs that are not from major social platforms.
 */
export function extractWebsiteUrl(text: string): string | undefined {
  const urlRegex = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s)]*)?/gi;
  const matches = text.match(urlRegex);
  if (!matches) return undefined;

  const socialDomains = [
    "linkedin.com",
    "github.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "reddit.com",
    "youtube.com",
    "medium.com",
    "firecrawl.dev",
  ];

  for (const url of matches) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const isSocial = socialDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
      if (!isSocial) return url;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Extract a bio/description from markdown content.
 * Takes the first meaningful paragraph (non-heading, non-link-only).
 */
export function extractBio(text: string): string | undefined {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Skip headings, links-only lines, and very short lines
    if (line.startsWith("#")) continue;
    if (/^\[.*\]\(.*\)$/.test(line)) continue;
    if (line.startsWith("![")) continue;
    if (line.length < 20) continue;
    // Skip lines that are just URLs
    if (/^https?:\/\//.test(line)) continue;

    // Clean markdown formatting
    const cleaned = line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
      .replace(/[*_`~]/g, "") // Remove bold/italic/code markers
      .trim();

    if (cleaned.length >= 20) {
      return cleaned.slice(0, 500);
    }
  }
  return undefined;
}

/**
 * Extract skills from markdown content.
 * Looks for common skill-list patterns (bullet lists, comma-separated, tags).
 */
export function extractSkills(text: string): string[] | undefined {
  const skills: Set<string> = new Set();

  // Pattern 1: Lines with "Skills" or "Technologies" headers followed by content
  const skillSectionRegex =
    /(?:skills|technologies|tech stack|expertise|compétences)[:\s]*\n?([\s\S]*?)(?:\n#|\n\n|$)/gi;
  let sectionMatch;
  while ((sectionMatch = skillSectionRegex.exec(text)) !== null) {
    const section = sectionMatch[1];
    // Extract bullet items or comma-separated values
    const items = section
      .split(/[,\n•·\-*|]/)
      .map((s) => s.replace(/[*_`\[\]()#]/g, "").trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
    for (const item of items) {
      skills.add(item);
    }
  }

  // Pattern 2: Inline skill tags (common on GitHub/LinkedIn profiles)
  const tagRegex =
    /(?:^|\s)(?:JavaScript|TypeScript|Python|React|Node\.js|Next\.js|Vue|Angular|Go|Rust|Java|C\+\+|Ruby|PHP|Swift|Kotlin|Docker|Kubernetes|AWS|GCP|Azure|PostgreSQL|MongoDB|Redis|GraphQL|REST|SQL|HTML|CSS|Tailwind|Svelte|Django|Flask|Spring|Express|NestJS|Convex|Supabase|Firebase)(?:\s|$|,|\.)/gi;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    skills.add(tagMatch[0].trim().replace(/[,.]$/, ""));
  }

  if (skills.size === 0) return undefined;
  return [...skills].slice(0, 20);
}

/**
 * Extract company name from markdown content.
 */
export function extractCompany(text: string): string | undefined {
  // Pattern 1: "works at Company" — case-insensitive prefix, capture capitalized words
  const atMatch = text.match(
    /[Ww]orks?\s+at\s+([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+)*)/,
  );
  if (atMatch) return atMatch[1].trim();

  // Pattern 1b: "working at / employed at / @" variants
  const atMatch2 = text.match(
    /(?:[Ww]orking\s+at|[Ee]mployed\s+at|@)\s+([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+)*)/,
  );
  if (atMatch2) return atMatch2[1].trim();

  // Pattern 2: "Company: Name" — case-insensitive label, then value
  const labelMatch = text.match(
    /(?:[Cc]ompany|[Ee]ntreprise|[Oo]rganisation|[Oo]rganization)[:\s]+([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Za-z0-9&.'-]+){0,4})/,
  );
  if (labelMatch) return labelMatch[1].trim();

  return undefined;
}

/**
 * Extract role/job title from markdown content.
 */
export function extractRole(text: string): string | undefined {
  const patterns = [
    /(?:role|title|position|poste|titre)[:\s]+([A-Za-z\s&.'-]{3,60}?)(?:\s+at\s|\s+@\s|\s*[,.|]|\s*$)/i,
    /((?:Senior|Junior|Lead|Staff|Principal|Head of|VP of|Director of|Chief|CTO|CEO|COO|CFO|CMO|CPO|Founder|Co-Founder)\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s+at\s|\s+@\s|\s+(?:who|passionate|building|with|focused)|\s*[,.|]|\s*$)/i,
    /((?:Software|Full[- ]?Stack|Front[- ]?End|Back[- ]?End|DevOps|Data|ML|AI|Cloud|Product|Design|UX|UI)\s+(?:Engineer|Developer|Architect|Manager|Designer|Scientist|Analyst|Consultant|Lead))(?:\s|[,.|]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

/**
 * Parse scraped markdown content into structured enrichment data.
 *
 * @param markdown - Raw markdown content from Firecrawl
 * @param sourceUrl - The original URL that was scraped
 * @returns Structured enrichment data
 */
export function parseMarkdownToEnrichmentData(
  markdown: string,
  sourceUrl: string,
): EnrichmentData {
  const data: EnrichmentData = {
    scrapedAt: Date.now(),
  };

  // Determine the type of source URL and set it directly
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    if (hostname.includes("linkedin.com")) {
      data.linkedinUrl = sourceUrl;
    } else if (hostname.includes("github.com")) {
      data.githubUrl = sourceUrl;
    } else {
      data.websiteUrl = sourceUrl;
    }
  } catch {
    // Invalid source URL — skip
  }

  // Extract additional URLs from content
  if (!data.linkedinUrl) {
    data.linkedinUrl = extractLinkedinUrl(markdown);
  }
  if (!data.githubUrl) {
    data.githubUrl = extractGithubUrl(markdown);
  }
  if (!data.websiteUrl) {
    data.websiteUrl = extractWebsiteUrl(markdown);
  }

  // Extract profile data
  data.bio = extractBio(markdown);
  data.skills = extractSkills(markdown);
  data.company = extractCompany(markdown);
  data.role = extractRole(markdown);

  return data;
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Scrape a URL using the Firecrawl API.
 *
 * @param params - Scrape parameters (url, formats)
 * @param apiKey - Firecrawl API key (defaults to env var FIRECRAWL_API_KEY)
 * @param timeoutMs - Request timeout in milliseconds (default: 30s)
 * @returns Raw Firecrawl scrape response
 * @throws FirecrawlApiError on API errors
 * @throws FirecrawlTimeoutError on timeout
 * @throws FirecrawlNotFoundError when profile is not found
 * @throws FirecrawlInvalidResponseError on unparseable responses
 */
export async function scrapeUrl(
  params: FirecrawlScrapeParams,
  apiKey?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FirecrawlScrapeResponse> {
  const key = apiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new FirecrawlApiError(
      "FIRECRAWL_API_KEY is not set in environment variables",
      0,
      false,
    );
  }

  // Validate params
  if (!params.url || params.url.trim().length === 0) {
    throw new FirecrawlApiError("Scrape URL cannot be empty", 0, false);
  }

  // Build request body
  const body = {
    url: params.url,
    formats: params.formats ?? ["markdown"],
  };

  // Execute fetch with timeout via AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(FIRECRAWL_API_URL, {
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
      throw new FirecrawlTimeoutError();
    }
    const message =
      error instanceof Error ? error.message : "Unknown network error";
    throw new FirecrawlApiError(
      `Firecrawl network error: ${message}`,
      0,
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP errors
  if (response.status === 404) {
    throw new FirecrawlNotFoundError();
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore read errors
    }
    throw new FirecrawlApiError(
      `Firecrawl API error (${response.status}): ${errorBody}`.slice(0, 500),
      response.status,
      response.status >= 500 || response.status === 429,
    );
  }

  // Parse response
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new FirecrawlInvalidResponseError(
      "Firecrawl returned non-JSON response",
    );
  }

  // Validate response shape
  if (!data || typeof data !== "object") {
    throw new FirecrawlInvalidResponseError(
      "Firecrawl returned an unexpected response format",
    );
  }

  const responseObj = data as Record<string, unknown>;

  return {
    success: Boolean(responseObj.success),
    data: responseObj.data as FirecrawlScrapeResponse["data"],
  };
}

/**
 * Scrape a URL with 1 automatic retry on retryable failures.
 *
 * @param params - Scrape parameters
 * @param apiKey - Optional API key override
 * @param timeoutMs - Optional timeout override
 * @returns Raw Firecrawl scrape response
 */
export async function scrapeUrlWithRetry(
  params: FirecrawlScrapeParams,
  apiKey?: string,
  timeoutMs?: number,
): Promise<FirecrawlScrapeResponse> {
  try {
    return await scrapeUrl(params, apiKey, timeoutMs);
  } catch (error: unknown) {
    // Retry once on retryable errors
    if (error instanceof FirecrawlApiError && error.isRetryable) {
      return await scrapeUrl(params, apiKey, timeoutMs);
    }
    throw error;
  }
}

/**
 * High-level function: scrape a profile URL and return structured enrichment data.
 *
 * This is the main entry point for the Agent Qualificateur.
 * Includes 1 automatic retry on retryable failures.
 *
 * @param url - URL of the public profile to scrape
 * @param apiKey - Optional API key override
 * @param timeoutMs - Optional timeout override
 * @returns Structured enrichment data, or null if scraping fails or returns no content
 */
export async function scrapeAndEnrichProfile(
  url: string,
  apiKey?: string,
  timeoutMs?: number,
): Promise<EnrichmentData | null> {
  const response = await scrapeUrlWithRetry({ url }, apiKey, timeoutMs);

  if (!response.success || !response.data?.markdown) {
    return null;
  }

  return parseMarkdownToEnrichmentData(response.data.markdown, url);
}
