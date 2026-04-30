/// <reference types="vite/client" />
import { describe, test, expect, vi, afterEach } from "vitest";
import {
  sendEmailOnce,
  sendEmail,
  buildUnsubscribeUrl,
  appendUnsubscribeFooter,
  calculateBackoffMs,
  ResendApiError,
  ResendRateLimitError,
  ResendTimeoutError,
  ResendInvalidResponseError,
  type SendEmailParams,
} from "./resend";

// ─── Helper: mock fetch globally ─────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** No-op sleep for tests — skips real delays */
const noopSleep = () => Promise.resolve();

const validParams: SendEmailParams = {
  from: "hello@piksend.com",
  to: "prospect@example.com",
  replyTo: "support@piksend.com",
  subject: "Discover Piksend",
  html: "<p>Hello, check out Piksend!</p>",
};

// ─── buildUnsubscribeUrl ─────────────────────────────────────────────────────

describe("buildUnsubscribeUrl", () => {
  test("builds URL with base64-encoded email", () => {
    const url = buildUnsubscribeUrl("test@example.com");
    expect(url).toContain("https://leadengine.io/unsubscribe?id=");
    expect(url).toContain(encodeURIComponent(btoa("test@example.com")));
  });

  test("uses custom base URL when provided", () => {
    const url = buildUnsubscribeUrl(
      "test@example.com",
      "https://custom.io/unsub",
    );
    expect(url.startsWith("https://custom.io/unsub?id=")).toBe(true);
  });
});

// ─── appendUnsubscribeFooter ─────────────────────────────────────────────────

describe("appendUnsubscribeFooter", () => {
  test("appends unsubscribe link to HTML body", () => {
    const html = "<p>Hello</p>";
    const result = appendUnsubscribeFooter(html, "https://example.com/unsub");
    expect(result).toContain("<p>Hello</p>");
    expect(result).toContain("https://example.com/unsub");
    expect(result).toContain("désinscrire");
  });

  test("preserves original HTML content", () => {
    const html = "<div><h1>Title</h1><p>Body content</p></div>";
    const result = appendUnsubscribeFooter(html, "https://example.com/unsub");
    expect(result.startsWith(html)).toBe(true);
  });
});

// ─── calculateBackoffMs ──────────────────────────────────────────────────────

describe("calculateBackoffMs", () => {
  test("returns 1s for attempt 0", () => {
    expect(calculateBackoffMs(0)).toBe(1000);
  });

  test("returns 2s for attempt 1", () => {
    expect(calculateBackoffMs(1)).toBe(2000);
  });

  test("returns 4s for attempt 2", () => {
    expect(calculateBackoffMs(2)).toBe(4000);
  });
});

// ─── sendEmailOnce ───────────────────────────────────────────────────────────

describe("sendEmailOnce", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("sends correct request to Resend API", async () => {
    const mockFetch = mockFetchResponse({ id: "msg_abc123" });
    globalThis.fetch = mockFetch;

    await sendEmailOnce(validParams, "re_test_key");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer re_test_key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.from).toBe("hello@piksend.com");
    expect(body.to).toEqual(["prospect@example.com"]);
    expect(body.reply_to).toBe("support@piksend.com");
    expect(body.subject).toBe("Discover Piksend");
  });

  test("includes List-Unsubscribe header in request", async () => {
    const mockFetch = mockFetchResponse({ id: "msg_abc123" });
    globalThis.fetch = mockFetch;

    await sendEmailOnce(validParams, "re_test_key");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.headers["List-Unsubscribe"]).toBeDefined();
    expect(body.headers["List-Unsubscribe"]).toContain("<");
    expect(body.headers["List-Unsubscribe"]).toContain(">");
    expect(body.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });

  test("appends unsubscribe footer to HTML body", async () => {
    const mockFetch = mockFetchResponse({ id: "msg_abc123" });
    globalThis.fetch = mockFetch;

    await sendEmailOnce(validParams, "re_test_key");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.html).toContain("désinscrire");
    expect(body.html).toContain(validParams.html);
  });

  test("returns messageId on success", async () => {
    globalThis.fetch = mockFetchResponse({ id: "msg_xyz789" });

    const result = await sendEmailOnce(validParams, "re_test_key");
    expect(result.messageId).toBe("msg_xyz789");
  });

  test("uses custom unsubscribeUrl when provided", async () => {
    const mockFetch = mockFetchResponse({ id: "msg_abc123" });
    globalThis.fetch = mockFetch;

    await sendEmailOnce(
      { ...validParams, unsubscribeUrl: "https://custom.io/unsub/123" },
      "re_test_key",
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.headers["List-Unsubscribe"]).toBe(
      "<https://custom.io/unsub/123>",
    );
    expect(body.html).toContain("https://custom.io/unsub/123");
  });

  test("throws ResendApiError when API key is missing", async () => {
    await expect(sendEmailOnce(validParams, undefined)).rejects.toThrow(
      ResendApiError,
    );
  });

  test("throws ResendApiError for empty from", async () => {
    await expect(
      sendEmailOnce({ ...validParams, from: "" }, "re_test_key"),
    ).rejects.toThrow(ResendApiError);
  });

  test("throws ResendApiError for empty to", async () => {
    await expect(
      sendEmailOnce({ ...validParams, to: "" }, "re_test_key"),
    ).rejects.toThrow(ResendApiError);
  });

  test("throws ResendApiError for empty subject", async () => {
    await expect(
      sendEmailOnce({ ...validParams, subject: "" }, "re_test_key"),
    ).rejects.toThrow(ResendApiError);
  });

  test("throws ResendApiError for empty html", async () => {
    await expect(
      sendEmailOnce({ ...validParams, html: "" }, "re_test_key"),
    ).rejects.toThrow(ResendApiError);
  });

  test("throws ResendRateLimitError on 429", async () => {
    globalThis.fetch = mockFetchResponse({ error: "rate limited" }, 429);

    await expect(
      sendEmailOnce(validParams, "re_test_key"),
    ).rejects.toThrow(ResendRateLimitError);
  });

  test("throws ResendApiError on 500 (retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "internal error" }, 500);

    try {
      await sendEmailOnce(validParams, "re_test_key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResendApiError);
      expect((e as ResendApiError).statusCode).toBe(500);
      expect((e as ResendApiError).isRetryable).toBe(true);
    }
  });

  test("throws ResendApiError on 401 (not retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "unauthorized" }, 401);

    try {
      await sendEmailOnce(validParams, "re_test_key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResendApiError);
      expect((e as ResendApiError).statusCode).toBe(401);
      expect((e as ResendApiError).isRetryable).toBe(false);
    }
  });

  test("throws ResendInvalidResponseError for non-JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("not json"),
    });

    await expect(
      sendEmailOnce(validParams, "re_test_key"),
    ).rejects.toThrow(ResendInvalidResponseError);
  });

  test("throws ResendInvalidResponseError when id is missing", async () => {
    globalThis.fetch = mockFetchResponse({ status: "ok" });

    await expect(
      sendEmailOnce(validParams, "re_test_key"),
    ).rejects.toThrow(ResendInvalidResponseError);
  });

  test("throws ResendTimeoutError on abort", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    });

    await expect(
      sendEmailOnce(validParams, "re_test_key", 1),
    ).rejects.toThrow(ResendTimeoutError);
  });

  test("throws ResendApiError on network error (retryable)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    try {
      await sendEmailOnce(validParams, "re_test_key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResendApiError);
      expect((e as ResendApiError).isRetryable).toBe(true);
      expect((e as ResendApiError).message).toContain("ECONNREFUSED");
    }
  });
});

// ─── sendEmail (with retry) ──────────────────────────────────────────────────

describe("sendEmail", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("returns messageId on first success", async () => {
    globalThis.fetch = mockFetchResponse({ id: "msg_first" });

    const result = await sendEmail(validParams, {
      apiKey: "re_test_key",
      sleepFn: noopSleep,
    });
    expect(result.messageId).toBe("msg_first");
  });

  test("retries on retryable error and succeeds", async () => {
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
        json: () => Promise.resolve({ id: "msg_retry_ok" }),
        text: () => Promise.resolve('{"id":"msg_retry_ok"}'),
      });
    });

    const result = await sendEmail(validParams, {
      apiKey: "re_test_key",
      sleepFn: noopSleep,
    });
    expect(result.messageId).toBe("msg_retry_ok");
    expect(callCount).toBe(2);
  });

  test("does not retry on non-retryable error", async () => {
    globalThis.fetch = mockFetchResponse({ error: "unauthorized" }, 401);

    await expect(
      sendEmail(validParams, { apiKey: "re_test_key", sleepFn: noopSleep }),
    ).rejects.toThrow(ResendApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("throws after all retries exhausted", async () => {
    globalThis.fetch = mockFetchResponse({ error: "server error" }, 500);

    await expect(
      sendEmail(validParams, { apiKey: "re_test_key", sleepFn: noopSleep }),
    ).rejects.toThrow(ResendApiError);
    // 1 initial + 3 retries = 4 calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  test("does not retry validation errors (empty params)", async () => {
    await expect(
      sendEmail({ ...validParams, from: "" }, {
        apiKey: "re_test_key",
        sleepFn: noopSleep,
      }),
    ).rejects.toThrow(ResendApiError);
  });

  test("supports legacy string apiKey argument", async () => {
    globalThis.fetch = mockFetchResponse({ id: "msg_legacy" });

    const result = await sendEmail(validParams, "re_test_key");
    expect(result.messageId).toBe("msg_legacy");
  });
});
