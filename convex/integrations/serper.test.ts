/// <reference types="vite/client" />
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchSerper,
  parseResultsToLeadCandidates,
  searchAndParseLeads,
  detectChannelFromUrl,
  extractEmailFromText,
  extractNameFromTitle,
  SerperApiError,
  SerperRateLimitError,
  SerperTimeoutError,
  SerperInvalidResponseError,
  type SerperOrganicResult,
  type SerperSearchParams,
} from "./serper";

// ─── Helper: mock fetch globally ─────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ─── detectChannelFromUrl ────────────────────────────────────────────────────

describe("detectChannelFromUrl", () => {
  test("detects twitter from twitter.com", () => {
    expect(detectChannelFromUrl("https://twitter.com/user/status/123")).toBe(
      "twitter",
    );
  });

  test("detects twitter from x.com", () => {
    expect(detectChannelFromUrl("https://x.com/user")).toBe("twitter");
  });

  test("detects linkedin", () => {
    expect(detectChannelFromUrl("https://www.linkedin.com/in/john")).toBe(
      "linkedin",
    );
  });

  test("detects reddit", () => {
    expect(detectChannelFromUrl("https://reddit.com/r/saas/comments/abc")).toBe(
      "reddit",
    );
  });

  test("detects instagram", () => {
    expect(detectChannelFromUrl("https://instagram.com/user")).toBe(
      "instagram",
    );
  });

  test("detects github", () => {
    expect(detectChannelFromUrl("https://github.com/user/repo")).toBe("github");
  });

  test("returns web for generic sites", () => {
    expect(detectChannelFromUrl("https://example.com/page")).toBe("web");
  });

  test("returns web for invalid URLs", () => {
    expect(detectChannelFromUrl("not-a-url")).toBe("web");
  });
});

// ─── extractEmailFromText ────────────────────────────────────────────────────

describe("extractEmailFromText", () => {
  test("extracts email from text", () => {
    expect(
      extractEmailFromText("Contact me at john@example.com for details"),
    ).toBe("john@example.com");
  });

  test("returns first email when multiple present", () => {
    expect(
      extractEmailFromText("john@a.com and jane@b.com"),
    ).toBe("john@a.com");
  });

  test("returns null when no email found", () => {
    expect(extractEmailFromText("No email here")).toBeNull();
  });

  test("lowercases extracted email", () => {
    expect(extractEmailFromText("Email: John.Doe@Example.COM")).toBe(
      "john.doe@example.com",
    );
  });

  test("handles email with special chars", () => {
    expect(extractEmailFromText("user.name+tag@domain.co.uk")).toBe(
      "user.name+tag@domain.co.uk",
    );
  });
});

// ─── extractNameFromTitle ────────────────────────────────────────────────────

describe("extractNameFromTitle", () => {
  test("strips LinkedIn suffix", () => {
    expect(extractNameFromTitle("John Doe - LinkedIn")).toBe("John Doe");
  });

  test("strips Twitter suffix", () => {
    expect(extractNameFromTitle("Jane Smith | Twitter")).toBe("Jane Smith");
  });

  test("strips GitHub suffix", () => {
    expect(extractNameFromTitle("Dev User · GitHub")).toBe("Dev User");
  });

  test("returns null for empty string", () => {
    expect(extractNameFromTitle("")).toBeNull();
  });

  test("returns null for URL-like titles", () => {
    expect(extractNameFromTitle("https://example.com")).toBeNull();
  });

  test("returns cleaned title for normal text", () => {
    expect(extractNameFromTitle("Some Article Title")).toBe(
      "Some Article Title",
    );
  });
});

// ─── parseResultsToLeadCandidates ────────────────────────────────────────────

describe("parseResultsToLeadCandidates", () => {
  test("parses organic results into lead candidates", () => {
    const results: SerperOrganicResult[] = [
      {
        title: "John Doe - LinkedIn",
        link: "https://linkedin.com/in/johndoe",
        snippet: "Contact: john@example.com — SaaS founder struggling with...",
        position: 1,
      },
      {
        title: "Need help with email automation",
        link: "https://reddit.com/r/saas/comments/abc",
        snippet: "I've been looking for a tool to automate my outreach...",
        position: 2,
      },
    ];

    const candidates = parseResultsToLeadCandidates(results);

    expect(candidates).toHaveLength(2);

    // First result: has email, name, linkedin channel
    expect(candidates[0].email).toBe("john@example.com");
    expect(candidates[0].name).toBe("John Doe");
    expect(candidates[0].sourceUrl).toBe("https://linkedin.com/in/johndoe");
    expect(candidates[0].detectionChannel).toBe("linkedin");
    expect(candidates[0].position).toBe(1);

    // Second result: no email, no name (title doesn't look like a person), reddit channel
    expect(candidates[1].email).toBeNull();
    expect(candidates[1].detectionChannel).toBe("reddit");
    expect(candidates[1].sourceUrl).toBe(
      "https://reddit.com/r/saas/comments/abc",
    );
    expect(candidates[1].position).toBe(2);
  });

  test("returns empty array for empty results", () => {
    expect(parseResultsToLeadCandidates([])).toEqual([]);
  });
});

// ─── searchSerper ────────────────────────────────────────────────────────────

describe("searchSerper", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const validParams: SerperSearchParams = {
    q: "need email automation tool",
    num: 10,
    gl: "us",
    hl: "en",
  };

  test("sends correct request to Serper.dev API", async () => {
    const mockFetch = mockFetchResponse({
      organic: [
        {
          title: "Test",
          link: "https://example.com",
          snippet: "test snippet",
          position: 1,
        },
      ],
    });
    globalThis.fetch = mockFetch;

    await searchSerper(validParams, "test-api-key");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://google.serper.dev/search");
    expect(options.method).toBe("POST");
    expect(options.headers["X-API-KEY"]).toBe("test-api-key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.q).toBe("need email automation tool");
    expect(body.num).toBe(10);
    expect(body.gl).toBe("us");
    expect(body.hl).toBe("en");
  });

  test("returns parsed organic results", async () => {
    globalThis.fetch = mockFetchResponse({
      organic: [
        {
          title: "Result 1",
          link: "https://example.com/1",
          snippet: "Snippet 1",
          position: 1,
        },
        {
          title: "Result 2",
          link: "https://example.com/2",
          snippet: "Snippet 2",
          position: 2,
        },
      ],
      searchParameters: { q: "test", num: 10 },
    });

    const result = await searchSerper(validParams, "test-key");

    expect(result.organic).toHaveLength(2);
    expect(result.organic[0].title).toBe("Result 1");
    expect(result.organic[1].title).toBe("Result 2");
  });

  test("returns empty organic array when no results", async () => {
    globalThis.fetch = mockFetchResponse({
      searchParameters: { q: "very obscure query" },
    });

    const result = await searchSerper(validParams, "test-key");
    expect(result.organic).toEqual([]);
  });

  test("throws SerperApiError when API key is missing", async () => {
    await expect(
      searchSerper(validParams, undefined),
    ).rejects.toThrow(SerperApiError);
  });

  test("throws SerperApiError for empty query", async () => {
    await expect(
      searchSerper({ q: "", num: 10 }, "test-key"),
    ).rejects.toThrow(SerperApiError);
  });

  test("throws SerperApiError for invalid num", async () => {
    await expect(
      searchSerper({ q: "test", num: 0 }, "test-key"),
    ).rejects.toThrow(SerperApiError);

    await expect(
      searchSerper({ q: "test", num: 101 }, "test-key"),
    ).rejects.toThrow(SerperApiError);
  });

  test("throws SerperRateLimitError on 429", async () => {
    globalThis.fetch = mockFetchResponse({ error: "rate limited" }, 429);

    await expect(
      searchSerper(validParams, "test-key"),
    ).rejects.toThrow(SerperRateLimitError);
  });

  test("throws SerperApiError on 500 (retryable)", async () => {
    globalThis.fetch = mockFetchResponse(
      { error: "internal error" },
      500,
    );

    try {
      await searchSerper(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SerperApiError);
      expect((e as SerperApiError).statusCode).toBe(500);
      expect((e as SerperApiError).isRetryable).toBe(true);
    }
  });

  test("throws SerperApiError on 401 (not retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "unauthorized" }, 401);

    try {
      await searchSerper(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SerperApiError);
      expect((e as SerperApiError).statusCode).toBe(401);
      expect((e as SerperApiError).isRetryable).toBe(false);
    }
  });

  test("throws SerperInvalidResponseError for non-JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("not json"),
    });

    await expect(
      searchSerper(validParams, "test-key"),
    ).rejects.toThrow(SerperInvalidResponseError);
  });

  test("throws SerperInvalidResponseError when organic is not an array", async () => {
    globalThis.fetch = mockFetchResponse({ organic: "not-an-array" });

    await expect(
      searchSerper(validParams, "test-key"),
    ).rejects.toThrow(SerperInvalidResponseError);
  });

  test("throws SerperTimeoutError on abort", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    });

    await expect(
      searchSerper(validParams, "test-key", 1),
    ).rejects.toThrow(SerperTimeoutError);
  });

  test("throws SerperApiError on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    try {
      await searchSerper(validParams, "test-key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SerperApiError);
      expect((e as SerperApiError).isRetryable).toBe(true);
      expect((e as SerperApiError).message).toContain("ECONNREFUSED");
    }
  });

  test("omits gl and hl from body when not provided", async () => {
    const mockFetch = mockFetchResponse({ organic: [] });
    globalThis.fetch = mockFetch;

    await searchSerper({ q: "test", num: 10 }, "test-key");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("gl");
    expect(body).not.toHaveProperty("hl");
  });
});

// ─── searchAndParseLeads ─────────────────────────────────────────────────────

describe("searchAndParseLeads", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("combines search and parse into lead candidates", async () => {
    globalThis.fetch = mockFetchResponse({
      organic: [
        {
          title: "Jane Dev - GitHub",
          link: "https://github.com/janedev",
          snippet: "Full-stack dev — jane@dev.io — looking for automation",
          position: 1,
        },
      ],
    });

    const candidates = await searchAndParseLeads(
      { q: "need automation tool", num: 10 },
      "test-key",
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].email).toBe("jane@dev.io");
    expect(candidates[0].name).toBe("Jane Dev");
    expect(candidates[0].detectionChannel).toBe("github");
    expect(candidates[0].sourceUrl).toBe("https://github.com/janedev");
  });
});
