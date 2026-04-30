/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  calculateOptimalSendTime,
  detectTimezone,
  getLocalTimeParts,
  isOptimalDay,
} from "./agents/timing";

const modules = import.meta.glob("./**/*.ts");

// ─── detectTimezone (pure function tests) ────────────────────────────────────

describe("detectTimezone", () => {
  test("returns Europe/Paris when no enrichment data", () => {
    expect(detectTimezone(null)).toBe("Europe/Paris");
    expect(detectTimezone(undefined)).toBe("Europe/Paris");
  });

  test("returns Europe/Paris when enrichment data has no location hints", () => {
    expect(detectTimezone({ company: "Acme Corp" })).toBe("Europe/Paris");
  });

  test("detects US East Coast from company name", () => {
    expect(detectTimezone({ company: "NYC Startup Inc" })).toBe(
      "America/New_York",
    );
  });

  test("detects US West Coast from bio", () => {
    expect(
      detectTimezone({ bio: "Based in San Francisco, building cool stuff" }),
    ).toBe("America/Los_Angeles");
  });

  test("detects London from company", () => {
    expect(detectTimezone({ company: "London Tech Ltd" })).toBe(
      "Europe/London",
    );
  });

  test("detects Berlin from bio", () => {
    expect(detectTimezone({ bio: "Software engineer in Berlin" })).toBe(
      "Europe/Berlin",
    );
  });

  test("detects Tokyo from company", () => {
    expect(detectTimezone({ company: "Tokyo Digital" })).toBe("Asia/Tokyo");
  });

  test("detects Singapore from bio", () => {
    expect(detectTimezone({ bio: "Working from Singapore" })).toBe(
      "Asia/Singapore",
    );
  });

  test("detects timezone from LinkedIn URL with country hint", () => {
    expect(
      detectTimezone({ linkedinUrl: "https://linkedin.com/in/user-from-toronto" }),
    ).toBe("America/Toronto");
  });

  test("detects India from company location", () => {
    expect(detectTimezone({ company: "Bangalore Tech Solutions" })).toBe(
      "Asia/Kolkata",
    );
  });

  test("returns default when all fields are empty strings", () => {
    expect(
      detectTimezone({ company: "", bio: "", role: "" }),
    ).toBe("Europe/Paris");
  });
});

// ─── isOptimalDay (pure function tests) ──────────────────────────────────────

describe("isOptimalDay", () => {
  test("Tuesday (2) is optimal", () => {
    expect(isOptimalDay(2)).toBe(true);
  });

  test("Wednesday (3) is optimal", () => {
    expect(isOptimalDay(3)).toBe(true);
  });

  test("Thursday (4) is optimal", () => {
    expect(isOptimalDay(4)).toBe(true);
  });

  test("Monday (1) is not optimal", () => {
    expect(isOptimalDay(1)).toBe(false);
  });

  test("Friday (5) is not optimal", () => {
    expect(isOptimalDay(5)).toBe(false);
  });

  test("Saturday (6) is not optimal", () => {
    expect(isOptimalDay(6)).toBe(false);
  });

  test("Sunday (0) is not optimal", () => {
    expect(isOptimalDay(0)).toBe(false);
  });
});

// ─── getLocalTimeParts (pure function tests) ─────────────────────────────────

describe("getLocalTimeParts", () => {
  test("returns correct parts for a known UTC time in Europe/Paris", () => {
    // 2025-01-15 10:00:00 UTC → 11:00 in Europe/Paris (CET = UTC+1)
    const utcMs = new Date("2025-01-15T10:00:00Z").getTime();
    const parts = getLocalTimeParts(utcMs, "Europe/Paris");
    expect(parts.year).toBe(2025);
    expect(parts.month).toBe(1);
    expect(parts.day).toBe(15);
    expect(parts.hour).toBe(11);
    expect(parts.minute).toBe(0);
    expect(parts.dayOfWeek).toBe(3); // Wednesday
  });

  test("returns correct parts for America/New_York", () => {
    // 2025-01-15 15:30:00 UTC → 10:30 in America/New_York (EST = UTC-5)
    const utcMs = new Date("2025-01-15T15:30:00Z").getTime();
    const parts = getLocalTimeParts(utcMs, "America/New_York");
    expect(parts.year).toBe(2025);
    expect(parts.month).toBe(1);
    expect(parts.day).toBe(15);
    expect(parts.hour).toBe(10);
    expect(parts.minute).toBe(30);
    expect(parts.dayOfWeek).toBe(3); // Wednesday
  });
});

// ─── calculateOptimalSendTime (pure function tests) ──────────────────────────

describe("calculateOptimalSendTime", () => {
  test("suggests time within current window when already in optimal slot", () => {
    // Wednesday 2025-01-15 at 9:15 AM Europe/Paris → UTC 08:15
    const nowMs = new Date("2025-01-15T08:15:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");

    // Should suggest 30 minutes from now (still within the 9-11 window)
    expect(result).toBe(nowMs + 30 * 60 * 1000);
  });

  test("suggests next optimal day when on a non-optimal day", () => {
    // Monday 2025-01-13 at 10:00 AM Europe/Paris → UTC 09:00
    const nowMs = new Date("2025-01-13T09:00:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");

    // Should suggest Tuesday 9:30 AM Europe/Paris
    const resultParts = getLocalTimeParts(result, "Europe/Paris");
    expect(resultParts.dayOfWeek).toBe(2); // Tuesday
    expect(resultParts.hour).toBe(9);
    expect(resultParts.minute).toBe(30);
  });

  test("suggests next optimal day when past the window on an optimal day", () => {
    // Wednesday 2025-01-15 at 2:00 PM Europe/Paris → UTC 13:00
    const nowMs = new Date("2025-01-15T13:00:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");

    // Should suggest Thursday 9:30 AM Europe/Paris
    const resultParts = getLocalTimeParts(result, "Europe/Paris");
    expect(resultParts.dayOfWeek).toBe(4); // Thursday
    expect(resultParts.hour).toBe(9);
    expect(resultParts.minute).toBe(30);
  });

  test("suggests Tuesday when on Friday", () => {
    // Friday 2025-01-17 at 10:00 AM Europe/Paris → UTC 09:00
    const nowMs = new Date("2025-01-17T09:00:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");

    // Should suggest next Tuesday 9:30 AM
    const resultParts = getLocalTimeParts(result, "Europe/Paris");
    expect(resultParts.dayOfWeek).toBe(2); // Tuesday
    expect(resultParts.hour).toBe(9);
    expect(resultParts.minute).toBe(30);
  });

  test("suggests Tuesday when on Saturday", () => {
    // Saturday 2025-01-18 at 10:00 AM Europe/Paris → UTC 09:00
    const nowMs = new Date("2025-01-18T09:00:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");

    const resultParts = getLocalTimeParts(result, "Europe/Paris");
    expect(resultParts.dayOfWeek).toBe(2); // Tuesday
    expect(resultParts.hour).toBe(9);
    expect(resultParts.minute).toBe(30);
  });

  test("suggests same day when before the window on an optimal day", () => {
    // Tuesday 2025-01-14 at 7:00 AM Europe/Paris → UTC 06:00
    const nowMs = new Date("2025-01-14T06:00:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");

    // Should suggest today (Tuesday) at 9:30 AM
    const resultParts = getLocalTimeParts(result, "Europe/Paris");
    expect(resultParts.dayOfWeek).toBe(2); // Tuesday
    expect(resultParts.hour).toBe(9);
    expect(resultParts.minute).toBe(30);
  });

  test("works with America/New_York timezone", () => {
    // Monday 2025-01-13 at 3:00 PM UTC → 10:00 AM EST
    const nowMs = new Date("2025-01-13T15:00:00Z").getTime();
    const result = calculateOptimalSendTime(nowMs, "America/New_York");

    // Monday is not optimal, should suggest Tuesday 9:30 AM EST
    const resultParts = getLocalTimeParts(result, "America/New_York");
    expect(resultParts.dayOfWeek).toBe(2); // Tuesday
    expect(resultParts.hour).toBe(9);
    expect(resultParts.minute).toBe(30);
  });

  test("suggested time is always in the future", () => {
    const nowMs = Date.now();
    const result = calculateOptimalSendTime(nowMs, "Europe/Paris");
    expect(result).toBeGreaterThan(nowMs - 1);
  });
});

// ─── suggestSendTime (Convex integration tests) ─────────────────────────────

describe("suggestSendTime", () => {
  async function setupLead(
    t: ReturnType<typeof convexTest>,
    overrides: Record<string, unknown> = {},
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "prospect@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        productId: "piksend",
        score: 75,
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
      });
    });
  }

  async function setupMessage(
    t: ReturnType<typeof convexTest>,
    leadId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId: leadId as any,
        suggestedReply: "Hello, I noticed your work...",
        validationStatus: "draft",
        tone: "expert",
        channel: "email",
        contextualLink: "https://piksend.com/lp",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
      });
    });
  }

  test("sets sendAtSuggested and updates validationStatus to pending_validation", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message).not.toBeNull();
    expect(message!.sendAtSuggested).toBeDefined();
    expect(typeof message!.sendAtSuggested).toBe("number");
    expect(message!.sendAtSuggested).toBeGreaterThan(0);
    expect(message!.validationStatus).toBe("pending_validation");
  });

  test("skips when message already has sendAtSuggested", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t);
    const existingSendTime = Date.now() + 86400000;
    const messageId = await setupMessage(t, leadId as string, {
      sendAtSuggested: existingSendTime,
    });

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    // sendAtSuggested should remain unchanged
    expect(message!.sendAtSuggested).toBe(existingSendTime);
  });

  test("uses enrichment data for timezone detection", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t, {
      enrichmentData: {
        company: "San Francisco Startup",
        bio: "Building in the Bay Area",
      },
    });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.sendAtSuggested).toBeDefined();
    expect(message!.validationStatus).toBe("pending_validation");

    // Verify the suggested time falls in the 9-11 AM window in LA timezone
    const parts = getLocalTimeParts(
      message!.sendAtSuggested!,
      "America/Los_Angeles",
    );
    expect(parts.hour).toBeGreaterThanOrEqual(9);
    expect(parts.hour).toBeLessThanOrEqual(11);
    expect([2, 3, 4]).toContain(parts.dayOfWeek);
  });

  test("defaults to Europe/Paris when no enrichment data", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.sendAtSuggested).toBeDefined();

    // Verify the suggested time falls in the 9-11 AM window in Paris timezone
    const parts = getLocalTimeParts(
      message!.sendAtSuggested!,
      "Europe/Paris",
    );
    expect(parts.hour).toBeGreaterThanOrEqual(9);
    expect(parts.hour).toBeLessThanOrEqual(11);
    expect([2, 3, 4]).toContain(parts.dayOfWeek);
  });

  test("logs error when lead is not found", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    // Delete the lead to simulate missing lead
    await t.run(async (ctx) => {
      await ctx.db.delete(leadId);
    });

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("agent_logs")
        .withIndex("by_agentType", (q) => q.eq("agentType", "timing"))
        .collect();
    });

    expect(logs.some((l) => l.level === "error")).toBe(true);
  });

  test("creates info log on successful timing suggestion", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("agent_logs")
        .withIndex("by_agentType", (q) => q.eq("agentType", "timing"))
        .collect();
    });

    const infoLog = logs.find(
      (l) => l.level === "info" && l.message.includes("Send time suggested"),
    );
    expect(infoLog).toBeDefined();
    expect(infoLog!.message).toContain("Europe/Paris");
  });

  test("does not block immediate sending — validationStatus allows operator override", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.agents.timing.suggestSendTime, { messageId });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    // The message is in pending_validation — the operator can approve and send
    // immediately regardless of sendAtSuggested. The suggested time is advisory only.
    expect(message!.validationStatus).toBe("pending_validation");
    expect(message!.sendAtSuggested).toBeDefined();
    // sentAt is not set — the operator controls when to actually send
    expect(message!.sentAt).toBeUndefined();
  });
});
