/// <reference types="vite/client" />
import { describe, test, expect, vi, afterEach } from "vitest";
import {
  sendNotificationOnce,
  sendNotification,
  calculateBackoffMs,
  NovuApiError,
  NovuRateLimitError,
  NovuTimeoutError,
  NovuInvalidResponseError,
  VALID_WORKFLOW_IDS,
  type SendNotificationParams,
} from "./novu";

// ─── Helper: mock fetch globally ─────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const noopSleep = () => Promise.resolve();

const validParams: SendNotificationParams = {
  subscriberId: "user_clerk_123",
  workflowId: "critical_lead",
  title: "Lead critique détecté",
  body: "Un lead avec un score de 92 a été détecté pour Piksend.",
  priority: "critical",
};

// ─── calculateBackoffMs ──────────────────────────────────────────────────────

describe("calculateBackoffMs", () => {
  test("returns 500ms for attempt 0", () => {
    expect(calculateBackoffMs(0)).toBe(500);
  });

  test("returns 1000ms for attempt 1", () => {
    expect(calculateBackoffMs(1)).toBe(1000);
  });
});

// ─── VALID_WORKFLOW_IDS ──────────────────────────────────────────────────────

describe("VALID_WORKFLOW_IDS", () => {
  test("contains all 6 expected workflow IDs", () => {
    const expected = [
      "critical_lead",
      "hot_reply",
      "idle_hot_lead",
      "churn_signal",
      "pending_validation",
      "weekly_report",
    ];
    for (const id of expected) {
      expect(VALID_WORKFLOW_IDS.has(id as never)).toBe(true);
    }
    expect(VALID_WORKFLOW_IDS.size).toBe(6);
  });
});

// ─── sendNotificationOnce ────────────────────────────────────────────────────

describe("sendNotificationOnce", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("sends correct request to Novu API", async () => {
    const mockFetch = mockFetchResponse({
      data: { transactionId: "txn_abc123" },
    });
    globalThis.fetch = mockFetch;

    await sendNotificationOnce(validParams, "novu_test_key");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.novu.co/v1/events/trigger");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("ApiKey novu_test_key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.name).toBe("critical_lead");
    expect(body.to.subscriberId).toBe("user_clerk_123");
    expect(body.payload.title).toBe("Lead critique détecté");
    expect(body.payload.body).toContain("score de 92");
    expect(body.payload.priority).toBe("critical");
  });

  test("returns sentViaNovu true and transactionId on success", async () => {
    globalThis.fetch = mockFetchResponse({
      data: { transactionId: "txn_xyz789" },
    });

    const result = await sendNotificationOnce(validParams, "novu_test_key");
    expect(result.sentViaNovu).toBe(true);
    expect(result.transactionId).toBe("txn_xyz789");
  });

  test("handles response without transactionId gracefully", async () => {
    globalThis.fetch = mockFetchResponse({ data: {} });

    const result = await sendNotificationOnce(validParams, "novu_test_key");
    expect(result.sentViaNovu).toBe(true);
    expect(result.transactionId).toBeUndefined();
  });

  test("includes custom payload in request", async () => {
    const mockFetch = mockFetchResponse({
      data: { transactionId: "txn_payload" },
    });
    globalThis.fetch = mockFetch;

    await sendNotificationOnce(
      { ...validParams, payload: { leadId: "lead_123", score: 92 } },
      "novu_test_key",
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.leadId).toBe("lead_123");
    expect(body.payload.score).toBe(92);
  });

  test("throws NovuApiError when API key is missing", async () => {
    await expect(
      sendNotificationOnce(validParams, undefined),
    ).rejects.toThrow(NovuApiError);
  });

  test("throws NovuApiError for empty subscriberId", async () => {
    await expect(
      sendNotificationOnce(
        { ...validParams, subscriberId: "" },
        "novu_test_key",
      ),
    ).rejects.toThrow(NovuApiError);
  });

  test("throws NovuApiError for invalid workflowId", async () => {
    await expect(
      sendNotificationOnce(
        { ...validParams, workflowId: "invalid_workflow" as never },
        "novu_test_key",
      ),
    ).rejects.toThrow(NovuApiError);
  });

  test("throws NovuApiError for empty title", async () => {
    await expect(
      sendNotificationOnce(
        { ...validParams, title: "" },
        "novu_test_key",
      ),
    ).rejects.toThrow(NovuApiError);
  });

  test("throws NovuApiError for empty body", async () => {
    await expect(
      sendNotificationOnce(
        { ...validParams, body: "" },
        "novu_test_key",
      ),
    ).rejects.toThrow(NovuApiError);
  });

  test("throws NovuRateLimitError on 429", async () => {
    globalThis.fetch = mockFetchResponse({ error: "rate limited" }, 429);

    await expect(
      sendNotificationOnce(validParams, "novu_test_key"),
    ).rejects.toThrow(NovuRateLimitError);
  });

  test("throws NovuApiError on 500 (retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "internal error" }, 500);

    try {
      await sendNotificationOnce(validParams, "novu_test_key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NovuApiError);
      expect((e as NovuApiError).statusCode).toBe(500);
      expect((e as NovuApiError).isRetryable).toBe(true);
    }
  });

  test("throws NovuApiError on 401 (not retryable)", async () => {
    globalThis.fetch = mockFetchResponse({ error: "unauthorized" }, 401);

    try {
      await sendNotificationOnce(validParams, "novu_test_key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NovuApiError);
      expect((e as NovuApiError).statusCode).toBe(401);
      expect((e as NovuApiError).isRetryable).toBe(false);
    }
  });

  test("throws NovuInvalidResponseError for non-JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("not json"),
    });

    await expect(
      sendNotificationOnce(validParams, "novu_test_key"),
    ).rejects.toThrow(NovuInvalidResponseError);
  });

  test("throws NovuTimeoutError on abort", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    });

    await expect(
      sendNotificationOnce(validParams, "novu_test_key", 1),
    ).rejects.toThrow(NovuTimeoutError);
  });

  test("throws NovuApiError on network error (retryable)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    try {
      await sendNotificationOnce(validParams, "novu_test_key");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NovuApiError);
      expect((e as NovuApiError).isRetryable).toBe(true);
      expect((e as NovuApiError).message).toContain("ECONNREFUSED");
    }
  });
});

// ─── sendNotification (with retry + fallback) ────────────────────────────────

describe("sendNotification", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("returns sentViaNovu true on first success", async () => {
    globalThis.fetch = mockFetchResponse({
      data: { transactionId: "txn_first" },
    });

    const result = await sendNotification(validParams, {
      apiKey: "novu_test_key",
      sleepFn: noopSleep,
    });
    expect(result.sentViaNovu).toBe(true);
    expect(result.transactionId).toBe("txn_first");
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
        json: () =>
          Promise.resolve({ data: { transactionId: "txn_retry_ok" } }),
        text: () =>
          Promise.resolve('{"data":{"transactionId":"txn_retry_ok"}}'),
      });
    });

    const result = await sendNotification(validParams, {
      apiKey: "novu_test_key",
      sleepFn: noopSleep,
    });
    expect(result.sentViaNovu).toBe(true);
    expect(result.transactionId).toBe("txn_retry_ok");
    expect(callCount).toBe(2);
  });

  test("does not retry on non-retryable error", async () => {
    globalThis.fetch = mockFetchResponse({ error: "unauthorized" }, 401);

    await expect(
      sendNotification(validParams, {
        apiKey: "novu_test_key",
        sleepFn: noopSleep,
      }),
    ).rejects.toThrow(NovuApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("falls back to sentViaNovu false after all retries exhausted", async () => {
    globalThis.fetch = mockFetchResponse({ error: "server error" }, 500);

    const result = await sendNotification(validParams, {
      apiKey: "novu_test_key",
      sleepFn: noopSleep,
    });
    expect(result.sentViaNovu).toBe(false);
    // 1 initial + 2 retries = 3 calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test("returns sentViaNovu false when API key is missing", async () => {
    const result = await sendNotification(validParams, {
      apiKey: undefined,
      sleepFn: noopSleep,
    });
    expect(result.sentViaNovu).toBe(false);
  });

  test("throws on validation errors (empty subscriberId)", async () => {
    await expect(
      sendNotification(
        { ...validParams, subscriberId: "" },
        { apiKey: "novu_test_key", sleepFn: noopSleep },
      ),
    ).rejects.toThrow(NovuApiError);
  });

  test("throws on validation errors (invalid workflowId)", async () => {
    await expect(
      sendNotification(
        { ...validParams, workflowId: "bad_id" as never },
        { apiKey: "novu_test_key", sleepFn: noopSleep },
      ),
    ).rejects.toThrow(NovuApiError);
  });

  test("supports all 6 workflow IDs", async () => {
    const workflows = [
      "critical_lead",
      "hot_reply",
      "idle_hot_lead",
      "churn_signal",
      "pending_validation",
      "weekly_report",
    ] as const;

    for (const workflowId of workflows) {
      globalThis.fetch = mockFetchResponse({
        data: { transactionId: `txn_${workflowId}` },
      });

      const result = await sendNotification(
        { ...validParams, workflowId },
        { apiKey: "novu_test_key", sleepFn: noopSleep },
      );
      expect(result.sentViaNovu).toBe(true);
    }
  });
});
