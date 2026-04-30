/// <reference types="vite/client" />
import { describe, test, expect, vi, afterEach } from "vitest";
import {
  scrapeUrl,
  scrapeUrlWithRetry,
  scrapeAndEnrichProfile,
  parseMarkdownToEnrichmentData,
  extractLinkedinUrl,
  extractGithubUrl,
  extractWebsiteUrl,
  extractBio,
  extractSkills,
  extractCompany,
  extractRole,
  FirecrawlApiError,
  FirecrawlTimeoutError,
  FirecrawlNotFoundError,
  FirecrawlInvalidResponseError,
  type FirecrawlScrapeParams,
} from "./firecrawl";

// ─── Helper: mock fetch globally ─────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ─── extractLinkedinUrl ──────────────────────────────────────────────────────

describe("extractLinkedinUrl", () => {
  test("extracts LinkedIn profile URL", () => {
    expect(
      extractLinkedinUrl("Check out https://www.linkedin.com/in/johndoe for more"),
    ).toBe("https://www.linkedin.com/in/johndoe");
  });

  test("extracts LinkedIn URL without www", () => {
    expect(
      extractLinkedinUrl("Profile: https://linkedin.com/in/jane-smith/"),
    ).toBe("https://linkedin.com/in/jane-smith/");
  });

  test("returns undefined when no LinkedIn URL", () => {
    expect(extractLinkedinUrl("No social links here")).toBeUndefined();
  });
});

// ─── extractGithubUrl ────────────────────────────────────────────────────────

describe("extractGithubUrl", () => {
  test("extracts GitHub profile URL", () => {
    expect(
      extractGithubUrl("Code at https://github.com/janedev"),
    ).toBe("https://github.com/janedev");
  });

  test("returns undefined when no GitHub URL", () => {
    expect(extractGithubUrl("No code links")).toBeUndefined();
  });
});

// ─── extractWebsiteUrl ──────────────────────────────────────────────────────

describe("extractWebsiteUrl", () => {
  test("extracts personal website URL, skipping social platforms", () => {
    const text =
      "Find me at https://linkedin.com/in/john and https://johndoe.dev/blog";
    expect(extractWebsiteUrl(text)).toBe("https://johndoe.dev/blog");
  });

  test("returns undefined when only social URLs present", () => {
    expect(
      extractWebsiteUrl("https://github.com/user https://linkedin.com/in/user"),
    ).toBeUndefined();
  });

  test("returns undefined when no URLs present", () => {
    expect(extractWebsiteUrl("No links at all")).toBeUndefined();
  });
});

// ─── extractBio ──────────────────────────────────────────────────────────────

describe("extractBio", () => {
  test("extracts first meaningful paragraph", () => {
    const text = [
      "# John Doe",
      "",
      "Full-stack developer with 10 years of experience building SaaS products.",
      "",
      "## Skills",
    ].join("\n");
    expect(extractBio(text)).toBe(
      "Full-stack developer with 10 years of experience building SaaS products.",
    );
  });

  test("skips headings and short lines", () => {
    const text = [
      "# Profile",
      "Short",
      "This is a longer description that should be picked up as the bio text.",
    ].join("\n");
    expect(extractBio(text)).toBe(
      "This is a longer description that should be picked up as the bio text.",
    );
  });

  test("returns undefined for empty content", () => {
    expect(extractBio("")).toBeUndefined();
  });

  test("truncates bio to 500 characters", () => {
    const longText = "A".repeat(600);
    expect(extractBio(longText)!.length).toBe(500);
  });
});

// ─── extractSkills ───────────────────────────────────────────────────────────

describe("extractSkills", () => {
  test("extracts skills from a skills section", () => {
    const text = [
      "## Skills",
      "JavaScript, TypeScript, React, Node.js",
    ].join("\n");
    const skills = extractSkills(text);
    expect(skills).toBeDefined();
    expect(skills!.length).toBeGreaterThan(0);
  });

  test("extracts inline tech tags", () => {
    const text = "I work with TypeScript and React daily, plus some Python.";
    const skills = extractSkills(text);
    expect(skills).toBeDefined();
    expect(skills!.some((s) => s === "TypeScript")).toBe(true);
  });

  test("returns undefined when no skills found", () => {
    expect(extractSkills("No technical content here at all.")).toBeUndefined();
  });

  test("limits to 20 skills max", () => {
    const text =
      "Skills: JavaScript, TypeScript, Python, React, Node.js, Vue, Angular, Go, Rust, Java, Ruby, PHP, Swift, Kotlin, Docker, Kubernetes, AWS, GCP, Azure, PostgreSQL, MongoDB, Redis, GraphQL";
    const skills = extractSkills(text);
    expect(skills).toBeDefined();
    expect(skills!.length).toBeLessThanOrEqual(20);
  });
});

// ─── extractCompany ──────────────────────────────────────────────────────────

describe("extractCompany", () => {
  test("extracts company from 'works at' pattern", () => {
    expect(extractCompany("She works at Acme Corp building tools")).toBe(
      "Acme Corp",
    );
  });

  test("extracts company from 'Company:' pattern", () => {
    expect(extractCompany("Company: TechStartup Inc")).toBe("TechStartup Inc");
  });

  test("returns undefined when no company found", () => {
    expect(extractCompany("Just a regular person")).toBeUndefined();
  });
});

// ─── extractRole ─────────────────────────────────────────────────────────────

describe("extractRole", () => {
  test("extracts role from title pattern", () => {
    expect(extractRole("Senior Software Engineer at Acme")).toBe(
      "Senior Software Engineer",
    );
  });

  test("extracts role from 'Role:' pattern", () => {
    expect(extractRole("Role: Product Manager")).toBe("Product Manager");
  });

  test("extracts full-stack developer role", () => {
    expect(extractRole("Full-Stack Developer building SaaS")).toBe(
      "Full-Stack Developer",
    );
  });

  test("returns undefined when no role found", () => {
    expect(extractRole("Just some text without a role")).toBeUndefined();
  });
});

// ─── parseMarkdownToEnrichmentData ───────────────────────────────────────────

describe("parseMarkdownToEnrichmentData", () => {
  test("parses LinkedIn profile markdown", () => {
    const markdown = [
      "# Jane Smith",
      "",
      "Senior Software Engineer passionate about building scalable systems.",
      "",
      "Works at TechCorp building distributed systems.",
      "",
      "## Skills",
      "TypeScript, React, Node.js, PostgreSQL",
      "",
      "GitHub: https://github.com/janesmith",
      "Website: https://janesmith.dev",
    ].join("\n");

    const data = parseMarkdownToEnrichmentData(
      markdown,
      "https://linkedin.com/in/janesmith",
    );

    expect(data.linkedinUrl).toBe("https://linkedin.com/in/janesmith");
    expect(data.githubUrl).toBe("https://github.com/janesmith");
    expect(data.websiteUrl).toBe("https://janesmith.dev");
    expect(data.bio).toBeDefined();
    expect(data.skills).toBeDefined();
    expect(data.company).toBe("TechCorp");
    expect(data.role).toBe("Senior Software Engineer");
    expect(data.scrapedAt).toBeDefined();
    expect(typeof data.scrapedAt).toBe("number");
  });

  test("parses GitHub profile markdown", () => {
    const markdown = [
      "# devuser",
      "",
      "Full-Stack Developer who loves open source contributions and building tools.",
      "",
      "LinkedIn: https://linkedin.com/in/devuser",
    ].join("\n");

    const data = parseMarkdownToEnrichmentData(
      markdown,
      "https://github.com/devuser",
    );

    expect(data.githubUrl).toBe("https://github.com/devuser");
    expect(data.linkedinUrl).toBe("https://linkedin.com/in/devuser");
    expect(data.bio).toBeDefined();
  });

  test("sets sourceUrl as websiteUrl for non-social URLs", () => {
    const data = parseMarkdownToEnrichmentData(
      "Some content about a developer building great things for the community.",
      "https://johndoe.dev",
    );
    expect(data.websiteUrl).toBe("https://johndoe.dev");
  });

  test("always includes scrapedAt timestamp", () => {
    const before = Date.now();
    const data = parseMarkdownToEnrichmentData("Minimal content that is not very useful.", "https://example.com");
    const after = Date.now();

    expect(data.scrapedAt).toBeGreaterThanOrEqual(before);
    expect(data.scrapedAt).toBeLessThanOrEqual(after);
  });
});

// ─── scrapeUrl ───────────────────────────────────────────────────────────────

describe("scrapeUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const validParams: FirecrawlScrapeParams = {
    url: "https://linkedin.com/in/johndoe",
  };

  test("sends correct request to Firecrawl API", async () => {
    const mockFetch = mockFetchResponse({
      success: true,
      data: { markdown: "# Profile" },
    });
    globalThis.fetch = mockFetch;

    await scrapeUrl(validParams, "test-api-key");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.firecrawl.dev/v1/scrape");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer test-api-key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.url).toBe("https://linkedin.com/in/johndoe");
    expect(body.formats).toEqual(["markdown"]);
  });

  test("returns parsed response", async () => {
    globalThis.fetch = mockFetchResponse({
      success: true,
      data: {
        markdown: "# John Doe\nSoftware Engineer",
        metadata: { title: "John Doe" },
      },
    });

    const result = await scrapeUrl(validParams, "test-key");

    expect(result.success).toBe(true);
    expect(result.data?.markdown).toContain("John Doe");
  });

  test("throws FirecrawlApiError when API key is missing", async () => {
    await expect(scrapeUrl(validParams, undefined)).rejects.toThrow(
      FirecrawlApiError,
    );
  });

  test("throws FirecrawlApiError for empty URL", async () => {
    await expect(scrapeUrl({ url: "" }, "test-key")).rejects.toThrow(
      FirecrawlApiError,
    );
  });

  test("throws FirecrawlNotFoundError on 404", async () => {
    globalThis.fetch = mockFetchResponse({ error: "not found" }, 404);

    await expect(scrapeUrl(validParams, "test-key")).rejects.toThrow(
      FirecrawlNotFoundError,
    );
  });

  test("throws FirecrawlApiError on 500 (retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "server error" }, 500);

    try {
      await scrapeUrl(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirecrawlApiError);
      expect((e as FirecrawlApiError).statusCode).toBe(500);
      expect((e as FirecrawlApiError).isRetryable).toBe(true);
    }
  });

  test("throws FirecrawlApiError on 429 (retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "rate limited" }, 429);

    try {
      await scrapeUrl(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirecrawlApiError);
      expect((e as FirecrawlApiError).statusCode).toBe(429);
      expect((e as FirecrawlApiError).isRetryable).toBe(true);
    }
  });

  test("throws FirecrawlApiError on 401 (not retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "unauthorized" }, 401);

    try {
      await scrapeUrl(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirecrawlApiError);
      expect((e as FirecrawlApiError).statusCode).toBe(401);
      expect((e as FirecrawlApiError).isRetryable).toBe(false);
    }
  });

  test("throws FirecrawlTimeoutError on abort", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    });

    await expect(scrapeUrl(validParams, "test-key", 1)).rejects.toThrow(
      FirecrawlTimeoutError,
    );
  });

  test("throws FirecrawlApiError on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    try {
      await scrapeUrl(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirecrawlApiError);
      expect((e as FirecrawlApiError).isRetryable).toBe(true);
      expect((e as FirecrawlApiError).message).toContain("ECONNREFUSED");
    }
  });

  test("throws FirecrawlInvalidResponseError for non-JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("not json"),
    });

    await expect(scrapeUrl(validParams, "test-key")).rejects.toThrow(
      FirecrawlInvalidResponseError,
    );
  });

  test("uses custom formats when provided", async () => {
    const mockFetch = mockFetchResponse({ success: true, data: {} });
    globalThis.fetch = mockFetch;

    await scrapeUrl(
      { url: "https://example.com", formats: ["markdown", "html"] },
      "test-key",
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.formats).toEqual(["markdown", "html"]);
  });
});

// ─── scrapeUrlWithRetry ──────────────────────────────────────────────────────

describe("scrapeUrlWithRetry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("retries once on retryable error then succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "server error" }),
          text: () => Promise.resolve("server error"),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ success: true, data: { markdown: "# OK" } }),
        text: () => Promise.resolve(""),
      });
    });

    const result = await scrapeUrlWithRetry(
      { url: "https://example.com" },
      "test-key",
    );
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  test("does not retry on non-retryable error", async () => {
    globalThis.fetch = mockFetchResponse({ error: "not found" }, 404);

    await expect(
      scrapeUrlWithRetry({ url: "https://example.com" }, "test-key"),
    ).rejects.toThrow(FirecrawlNotFoundError);
  });

  test("throws after retry fails", async () => {
    globalThis.fetch = mockFetchResponse({ error: "server error" }, 500);

    await expect(
      scrapeUrlWithRetry({ url: "https://example.com" }, "test-key"),
    ).rejects.toThrow(FirecrawlApiError);
  });
});

// ─── scrapeAndEnrichProfile ──────────────────────────────────────────────────

describe("scrapeAndEnrichProfile", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("scrapes and returns enrichment data", async () => {
    globalThis.fetch = mockFetchResponse({
      success: true,
      data: {
        markdown: [
          "# Jane Dev",
          "",
          "Senior Software Engineer passionate about distributed systems and open source.",
          "",
          "Works at TechCorp building amazing products.",
          "",
          "GitHub: https://github.com/janedev",
        ].join("\n"),
      },
    });

    const data = await scrapeAndEnrichProfile(
      "https://linkedin.com/in/janedev",
      "test-key",
    );

    expect(data).not.toBeNull();
    expect(data!.linkedinUrl).toBe("https://linkedin.com/in/janedev");
    expect(data!.githubUrl).toBe("https://github.com/janedev");
    expect(data!.bio).toBeDefined();
    expect(data!.company).toBe("TechCorp");
    expect(data!.scrapedAt).toBeDefined();
  });

  test("returns null when scrape fails (success: false)", async () => {
    globalThis.fetch = mockFetchResponse({
      success: false,
      data: null,
    });

    const data = await scrapeAndEnrichProfile(
      "https://example.com/profile",
      "test-key",
    );
    expect(data).toBeNull();
  });

  test("returns null when no markdown content", async () => {
    globalThis.fetch = mockFetchResponse({
      success: true,
      data: { markdown: "" },
    });

    const data = await scrapeAndEnrichProfile(
      "https://example.com/profile",
      "test-key",
    );
    expect(data).toBeNull();
  });
});
