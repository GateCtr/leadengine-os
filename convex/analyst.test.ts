/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  computeMultiTouchAttribution,
  calculatePromptPerformanceScore,
  computeABVersionMetrics,
  evaluateABTest,
  type TouchpointAttribution,
  type ABVersionMetrics,
  type ABTestEvaluationResult,
} from "./agents/analyst";

const modules = import.meta.glob("./**/*.ts");

// ─── Pure function tests: computeMultiTouchAttribution ───────────────────────

describe("computeMultiTouchAttribution", () => {
  test("returns empty array for no touchpoints", () => {
    const result = computeMultiTouchAttribution([]);
    expect(result).toEqual([]);
  });

  test("single touchpoint gets 100%", () => {
    const result = computeMultiTouchAttribution([
      {
        messageId: "msg1",
        channel: "email",
        sentAt: 1000,
        events: [{ type: "click", timestamp: 2000 }],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].percentage).toBe(100);
    expect(result[0].messageId).toBe("msg1");
  });

  test("two touchpoints get 50% each", () => {
    const result = computeMultiTouchAttribution([
      {
        messageId: "msg1",
        channel: "email",
        sentAt: 1000,
        events: [{ type: "open", timestamp: 1500 }],
      },
      {
        messageId: "msg2",
        channel: "linkedin",
        sentAt: 2000,
        events: [{ type: "click", timestamp: 2500 }],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].percentage).toBe(50);
    expect(result[1].percentage).toBe(50);
  });

  test("three touchpoints use U-shaped model (40/20/40)", () => {
    const result = computeMultiTouchAttribution([
      {
        messageId: "msg1",
        channel: "email",
        sentAt: 1000,
        events: [{ type: "open", timestamp: 1100 }],
      },
      {
        messageId: "msg2",
        channel: "email",
        sentAt: 2000,
        events: [{ type: "click", timestamp: 2100 }],
      },
      {
        messageId: "msg3",
        channel: "linkedin",
        sentAt: 3000,
        events: [{ type: "reply", timestamp: 3100 }],
      },
    ]);
    expect(result).toHaveLength(3);
    const sum = result.reduce((s, r) => s + r.percentage, 0);
    expect(sum).toBeCloseTo(100, 1);
    // First and last should be higher than middle
    expect(result[0].percentage).toBeGreaterThan(result[1].percentage);
    expect(result[2].percentage).toBeGreaterThan(result[1].percentage);
  });

  test("all percentages are >= 0", () => {
    const result = computeMultiTouchAttribution([
      {
        messageId: "msg1",
        channel: "email",
        sentAt: 1000,
        events: [],
      },
      {
        messageId: "msg2",
        channel: "email",
        sentAt: 2000,
        events: [],
      },
      {
        messageId: "msg3",
        channel: "email",
        sentAt: 3000,
        events: [],
      },
      {
        messageId: "msg4",
        channel: "email",
        sentAt: 4000,
        events: [],
      },
    ]);
    for (const r of result) {
      expect(r.percentage).toBeGreaterThanOrEqual(0);
    }
  });

  test("sum of percentages equals 100 for multiple touchpoints", () => {
    const touchpoints = Array.from({ length: 7 }, (_, i) => ({
      messageId: `msg${i}`,
      channel: "email" as const,
      sentAt: i * 1000,
      events: [{ type: "click", timestamp: i * 1000 + 500 }],
    }));

    const result = computeMultiTouchAttribution(touchpoints);
    const sum = result.reduce((s, r) => s + r.percentage, 0);
    expect(sum).toBeCloseTo(100, 0);
  });

  test("sorts touchpoints by earliest event timestamp", () => {
    const result = computeMultiTouchAttribution([
      {
        messageId: "msg_late",
        channel: "email",
        sentAt: 5000,
        events: [{ type: "open", timestamp: 5500 }],
      },
      {
        messageId: "msg_early",
        channel: "email",
        sentAt: 1000,
        events: [{ type: "click", timestamp: 1200 }],
      },
    ]);
    // msg_early should be first (lower timestamp)
    expect(result[0].messageId).toBe("msg_early");
    expect(result[1].messageId).toBe("msg_late");
  });
});

// ─── Pure function tests: calculatePromptPerformanceScore ────────────────────

describe("calculatePromptPerformanceScore", () => {
  test("returns 0 for no messages", () => {
    const score = calculatePromptPerformanceScore({
      totalMessages: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      conversions: 0,
    });
    expect(score).toBe(0);
  });

  test("returns 100 for perfect metrics", () => {
    const score = calculatePromptPerformanceScore({
      totalMessages: 10,
      opens: 10,
      clicks: 10,
      replies: 10,
      conversions: 10,
    });
    expect(score).toBe(100);
  });

  test("returns score between 0 and 100", () => {
    const score = calculatePromptPerformanceScore({
      totalMessages: 20,
      opens: 10,
      clicks: 5,
      replies: 3,
      conversions: 1,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ─── Convex integration tests: analystHelpers ────────────────────────────────

describe("analystHelpers", () => {
  test("storeWeeklyReport inserts a report in analytics", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const reportId = await t.mutation(
      internal.agents.analystHelpers.storeWeeklyReport,
      {
        period: { start: now - 7 * 24 * 60 * 60 * 1000, end: now },
        data: {
          summary: { totalMessagesSent: 42, totalConversions: 5 },
        },
      },
    );

    expect(reportId).toBeDefined();

    const report = await t.run(async (ctx) => {
      return await ctx.db.get(reportId);
    });

    expect(report).not.toBeNull();
    expect(report!.type).toBe("weekly_report");
    expect(report!.data.summary.totalMessagesSent).toBe(42);
  });

  test("storeAttributionData inserts attribution in analytics", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const attrId = await t.mutation(
      internal.agents.analystHelpers.storeAttributionData,
      {
        productId: "piksend",
        period: { start: now - 7 * 24 * 60 * 60 * 1000, end: now },
        data: {
          attributions: [
            { leadId: "lead1", revenue: 99, touchpointCount: 3 },
          ],
        },
      },
    );

    const attr = await t.run(async (ctx) => {
      return await ctx.db.get(attrId);
    });

    expect(attr).not.toBeNull();
    expect(attr!.type).toBe("attribution");
    expect(attr!.productId).toBe("piksend");
  });

  test("getRecentTrackingEvents returns events after timestamp", async () => {
    const t = convexTest(schema, modules);

    // Create a lead and message first
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        validationStatus: "sent",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Insert tracking events
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("tracking_events", {
        leadId,
        messageId,
        type: "click",
        timestamp: now - 1000,
      });
      await ctx.db.insert("tracking_events", {
        leadId,
        messageId,
        type: "open",
        timestamp: now - 500,
      });
    });

    const events = await t.query(
      internal.agents.analystHelpers.getRecentTrackingEvents,
      { sinceTimestamp: now - 2000 },
    );

    expect(events).toHaveLength(2);
  });

  test("updatePromptPerformance updates score on existing config", async () => {
    const t = convexTest(schema, modules);

    const configId = await t.run(async (ctx) => {
      return await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        productId: "piksend",
        promptTemplate: "Write a compelling message...",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(
      internal.agents.analystHelpers.updatePromptPerformance,
      {
        promptConfigId: configId,
        performanceScore: 75,
      },
    );

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });

    expect(updated!.performanceScore).toBe(75);
  });

  test("updatePromptPerformance creates new version when revision provided", async () => {
    const t = convexTest(schema, modules);

    const configId = await t.run(async (ctx) => {
      return await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        productId: "piksend",
        promptTemplate: "Original prompt...",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(
      internal.agents.analystHelpers.updatePromptPerformance,
      {
        promptConfigId: configId,
        performanceScore: 15,
        revisedPromptTemplate: "Improved prompt...",
      },
    );

    // Old config should be deactivated
    const oldConfig = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });
    expect(oldConfig!.isActive).toBe(false);

    // New config should exist and be active
    const allConfigs = await t.run(async (ctx) => {
      return await ctx.db
        .query("prompt_configs")
        .withIndex("by_agentType_productId", (q) =>
          q.eq("agentType", "copywriter").eq("productId", "piksend"),
        )
        .collect();
    });

    const newConfig = allConfigs.find((c) => c.isActive);
    expect(newConfig).toBeDefined();
    expect(newConfig!.promptTemplate).toBe("Improved prompt...");
    expect(newConfig!.version).toBe(2);
  });
});

// ─── Pure function tests: computeABVersionMetrics ────────────────────────────

describe("computeABVersionMetrics", () => {
  test("returns zero metrics for empty messages", () => {
    const result = computeABVersionMetrics([]);
    expect(result.totalMessages).toBe(0);
    expect(result.combinedScore).toBe(0);
    expect(result.openRate).toBe(0);
    expect(result.clickRate).toBe(0);
    expect(result.replyRate).toBe(0);
  });

  test("computes correct rates for messages with all engagement", () => {
    const messages = [
      { opened: true, clicked: true, replyContent: "Great!" },
      { opened: true, clicked: true, replyContent: "Interested" },
    ];
    const result = computeABVersionMetrics(messages);
    expect(result.totalMessages).toBe(2);
    expect(result.opens).toBe(2);
    expect(result.clicks).toBe(2);
    expect(result.replies).toBe(2);
    expect(result.openRate).toBe(1);
    expect(result.clickRate).toBe(1);
    expect(result.replyRate).toBe(1);
    expect(result.combinedScore).toBe(100);
  });

  test("computes correct rates for mixed engagement", () => {
    const messages = [
      { opened: true, clicked: true, replyContent: "Yes" },
      { opened: true, clicked: false, replyContent: undefined },
      { opened: false, clicked: false, replyContent: undefined },
      { opened: true, clicked: false, replyContent: undefined },
    ];
    const result = computeABVersionMetrics(messages);
    expect(result.totalMessages).toBe(4);
    expect(result.opens).toBe(3);
    expect(result.clicks).toBe(1);
    expect(result.replies).toBe(1);
    // openRate = 3/4 = 0.75, clickRate = 1/4 = 0.25, replyRate = 1/4 = 0.25
    expect(result.openRate).toBe(0.75);
    expect(result.clickRate).toBe(0.25);
    expect(result.replyRate).toBe(0.25);
  });

  test("combined score is between 0 and 100", () => {
    const messages = [
      { opened: true, clicked: false, replyContent: undefined },
      { opened: false, clicked: true, replyContent: "reply" },
    ];
    const result = computeABVersionMetrics(messages);
    expect(result.combinedScore).toBeGreaterThanOrEqual(0);
    expect(result.combinedScore).toBeLessThanOrEqual(100);
  });
});

// ─── Pure function tests: evaluateABTest ─────────────────────────────────────

describe("evaluateABTest", () => {
  test("selects version with higher combined score as winner", () => {
    // Version B has better engagement
    const versionA = [
      { opened: true, clicked: false, replyContent: undefined },
      { opened: false, clicked: false, replyContent: undefined },
    ];
    const versionB = [
      { opened: true, clicked: true, replyContent: "Interested!" },
      { opened: true, clicked: true, replyContent: undefined },
    ];

    const result = evaluateABTest("piksend", versionA, versionB);
    expect(result.winner).toBe("B");
    expect(result.versionB.combinedScore).toBeGreaterThan(
      result.versionA.combinedScore,
    );
    expect(result.productId).toBe("piksend");
  });

  test("version A wins on tie (incumbent advantage)", () => {
    const versionA = [
      { opened: true, clicked: true, replyContent: "Yes" },
    ];
    const versionB = [
      { opened: true, clicked: true, replyContent: "Yes" },
    ];

    const result = evaluateABTest("gatectr", versionA, versionB);
    expect(result.winner).toBe("A");
    expect(result.scoreDifference).toBe(0);
  });

  test("version A wins when it has better metrics", () => {
    const versionA = [
      { opened: true, clicked: true, replyContent: "Great" },
      { opened: true, clicked: true, replyContent: "Love it" },
    ];
    const versionB = [
      { opened: false, clicked: false, replyContent: undefined },
      { opened: true, clicked: false, replyContent: undefined },
    ];

    const result = evaluateABTest("joventy", versionA, versionB);
    expect(result.winner).toBe("A");
    expect(result.versionA.combinedScore).toBeGreaterThan(
      result.versionB.combinedScore,
    );
  });

  test("score difference is always non-negative", () => {
    const versionA = [{ opened: true, clicked: false, replyContent: undefined }];
    const versionB = [{ opened: false, clicked: true, replyContent: "reply" }];

    const result = evaluateABTest("test", versionA, versionB);
    expect(result.scoreDifference).toBeGreaterThanOrEqual(0);
  });
});

// ─── Convex integration tests: A/B test helpers ─────────────────────────────

describe("analystHelpers A/B testing", () => {
  test("getABTestMessagesForEvaluation returns A/B messages sent before cutoff", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const fifteenDaysAgo = now - 15 * 24 * 60 * 60 * 1000;
    const cutoff = now - 14 * 24 * 60 * 60 * 1000;

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "ab-test@example.com",
        source: "radar",
        detectedAt: fifteenDaysAgo,
        detectionChannel: "web",
        status: "qualified",
        productId: "piksend",
        consentSource: "web_scraping",
        consentDate: fifteenDaysAgo,
        updatedAt: fifteenDaysAgo,
      });
    });

    // A/B test message sent 15 days ago (should be included)
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Version A content",
        suggestedReplyB: "Version B content",
        activeVersion: "A",
        validationStatus: "sent",
        sentAt: fifteenDaysAgo,
        opened: true,
        clicked: false,
        createdAt: fifteenDaysAgo,
        updatedAt: fifteenDaysAgo,
      });
    });

    // Non-A/B message (should be excluded)
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Regular message",
        validationStatus: "sent",
        sentAt: fifteenDaysAgo,
        createdAt: fifteenDaysAgo,
        updatedAt: fifteenDaysAgo,
      });
    });

    // Recent A/B message (should be excluded — not old enough)
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Recent A",
        suggestedReplyB: "Recent B",
        activeVersion: "B",
        validationStatus: "sent",
        sentAt: now - 5 * 24 * 60 * 60 * 1000,
        createdAt: now,
        updatedAt: now,
      });
    });

    const abMessages = await t.query(
      internal.agents.analystHelpers.getABTestMessagesForEvaluation,
      { cutoffTimestamp: cutoff },
    );

    expect(abMessages).toHaveLength(1);
    expect(abMessages[0].suggestedReply).toBe("Version A content");
    expect(abMessages[0].suggestedReplyB).toBe("Version B content");
    expect(abMessages[0].activeVersion).toBe("A");
  });

  test("storeABTestResult inserts result in analytics", async () => {
    const t = convexTest(schema, modules);

    const resultId = await t.mutation(
      internal.agents.analystHelpers.storeABTestResult,
      {
        productId: "piksend",
        data: {
          winner: "B",
          versionA: { combinedScore: 30 },
          versionB: { combinedScore: 55 },
        },
      },
    );

    const result = await t.run(async (ctx) => {
      return await ctx.db.get(resultId);
    });

    expect(result).not.toBeNull();
    expect(result!.type).toBe("ab_test_result");
    expect(result!.productId).toBe("piksend");
    expect(result!.data.winner).toBe("B");
  });

  test("adoptABTestWinner with version A keeps current config", async () => {
    const t = convexTest(schema, modules);

    const configId = await t.run(async (ctx) => {
      return await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        productId: "piksend",
        promptTemplate: "Original template",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.agents.analystHelpers.adoptABTestWinner, {
      productId: "piksend",
      winningVersion: "A",
    });

    const config = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });

    // Config should still be active with original template
    expect(config!.isActive).toBe(true);
    expect(config!.promptTemplate).toBe("Original template");
  });

  test("adoptABTestWinner with version B creates new config version", async () => {
    const t = convexTest(schema, modules);

    const configId = await t.run(async (ctx) => {
      return await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        productId: "piksend",
        promptTemplate: "Original template",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.agents.analystHelpers.adoptABTestWinner, {
      productId: "piksend",
      winningVersion: "B",
      winningTemplate: "Version B winning template",
    });

    // Old config should be deactivated
    const oldConfig = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });
    expect(oldConfig!.isActive).toBe(false);

    // New config should exist with version B template
    const allConfigs = await t.run(async (ctx) => {
      return await ctx.db
        .query("prompt_configs")
        .withIndex("by_agentType_productId", (q) =>
          q.eq("agentType", "copywriter").eq("productId", "piksend"),
        )
        .collect();
    });

    const newConfig = allConfigs.find((c) => c.isActive);
    expect(newConfig).toBeDefined();
    expect(newConfig!.promptTemplate).toBe("Version B winning template");
    expect(newConfig!.version).toBe(2);
  });

  test("getLeadProductId returns the product for a lead", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "product-test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        productId: "gatectr",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.agents.analystHelpers.getLeadProductId,
      { leadId },
    );

    expect(result).not.toBeNull();
    expect(result!.productId).toBe("gatectr");
  });
});


// ─── Win/Loss Engine Helper Tests ────────────────────────────────────────────

describe("analystHelpers Win/Loss Engine", () => {
  test("getConvertedLeadsForSurvey returns eligible leads without existing survey", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    // Create a converted lead (eligible)
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "converted@example.com",
        source: "webhook_piksend",
        detectedAt: twoDaysAgo,
        detectionChannel: "webhook",
        status: "converted",
        productId: "piksend",
        convertedAt: twoDaysAgo,
        consentSource: "webhook",
        consentDate: twoDaysAgo,
        updatedAt: twoDaysAgo,
      });
    });

    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const eligible = await t.query(
      internal.agents.analystHelpers.getConvertedLeadsForSurvey,
      { sinceTimestamp: sevenDaysAgo },
    );

    expect(eligible).toHaveLength(1);
    expect(eligible[0]._id).toBe(leadId);
  });

  test("getConvertedLeadsForSurvey excludes leads that already have a survey message", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "surveyed@example.com",
        source: "webhook_piksend",
        detectedAt: twoDaysAgo,
        detectionChannel: "webhook",
        status: "converted",
        productId: "piksend",
        convertedAt: twoDaysAgo,
        consentSource: "webhook",
        consentDate: twoDaysAgo,
        updatedAt: twoDaysAgo,
      });
    });

    // Create a survey message (sequenceStep = -1)
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Survey content",
        subject: "Survey",
        sequenceStep: -1,
        validationStatus: "draft",
        createdAt: now,
        updatedAt: now,
      });
    });

    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const eligible = await t.query(
      internal.agents.analystHelpers.getConvertedLeadsForSurvey,
      { sinceTimestamp: sevenDaysAgo },
    );

    expect(eligible).toHaveLength(0);
  });

  test("getArchivedLeadsWithRejections returns leads with rejection data", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "rejected@example.com",
        source: "radar",
        detectedAt: fiveDaysAgo,
        detectionChannel: "web",
        status: "archived",
        productId: "gatectr",
        consentSource: "web_scraping",
        consentDate: fiveDaysAgo,
        updatedAt: now,
      });
    });

    // Create a message with a rejection reply
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Hello!",
        replyContent: "No thanks, not interested.",
        replyCategory: "refus",
        replyReceivedAt: now - 3 * 24 * 60 * 60 * 1000,
        channel: "email",
        sentAt: fiveDaysAgo,
        validationStatus: "sent",
        createdAt: fiveDaysAgo,
        updatedAt: now,
      });
    });

    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const results = await t.query(
      internal.agents.analystHelpers.getArchivedLeadsWithRejections,
      { sinceTimestamp: thirtyDaysAgo },
    );

    expect(results).toHaveLength(1);
    expect(results[0].leadId).toBe(leadId);
    expect(results[0].rejections).toHaveLength(1);
    expect(results[0].rejections[0].category).toBe("refus");
  });

  test("getArchivedLeadsWithRejections includes objection messages", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "objection@example.com",
        source: "radar",
        detectedAt: fiveDaysAgo,
        detectionChannel: "web",
        status: "archived",
        productId: "piksend",
        consentSource: "web_scraping",
        consentDate: fiveDaysAgo,
        updatedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Check out our product",
        replyContent: "Too expensive for us.",
        replyCategory: "trop_cher",
        replyReceivedAt: now - 2 * 24 * 60 * 60 * 1000,
        channel: "email",
        sentAt: fiveDaysAgo,
        validationStatus: "sent",
        createdAt: fiveDaysAgo,
        updatedAt: now,
      });
    });

    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const results = await t.query(
      internal.agents.analystHelpers.getArchivedLeadsWithRejections,
      { sinceTimestamp: thirtyDaysAgo },
    );

    expect(results).toHaveLength(1);
    expect(results[0].objections).toHaveLength(1);
    expect(results[0].objections[0].category).toBe("trop_cher");
  });

  test("insertSurveyMessage creates a message with sequenceStep -1", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "survey-test@example.com",
        source: "webhook_piksend",
        detectedAt: now,
        detectionChannel: "webhook",
        status: "converted",
        productId: "piksend",
        consentSource: "webhook",
        consentDate: now,
        updatedAt: now,
      });
    });

    const messageId = await t.mutation(
      internal.agents.analystHelpers.insertSurveyMessage,
      {
        leadId,
        suggestedReply: "What convinced you?",
        subject: "Quick question",
      },
    );

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message).not.toBeNull();
    expect(message!.sequenceStep).toBe(-1);
    expect(message!.suggestedReply).toBe("What convinced you?");
    expect(message!.subject).toBe("Quick question");
    expect(message!.tone).toBe("support");
    expect(message!.validationStatus).toBe("draft");
  });

  test("storeWinLossAnalysis inserts win_loss type in analytics", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const analysisId = await t.mutation(
      internal.agents.analystHelpers.storeWinLossAnalysis,
      {
        productId: "piksend",
        period: { start: thirtyDaysAgo, end: now },
        data: {
          archivedLeadsAnalyzed: 15,
          rejectionsByCategory: { refus: 8, trop_cher: 5, besoin_reflexion: 2 },
        },
      },
    );

    const analysis = await t.run(async (ctx) => {
      return await ctx.db.get(analysisId);
    });

    expect(analysis).not.toBeNull();
    expect(analysis!.type).toBe("win_loss");
    expect(analysis!.productId).toBe("piksend");
    expect(analysis!.data.archivedLeadsAnalyzed).toBe(15);
  });

  test("enrichPromptWithWinLossInsights appends insights to prompt template", async () => {
    const t = convexTest(schema, modules);

    const configId = await t.run(async (ctx) => {
      return await ctx.db.insert("prompt_configs", {
        agentType: "qualifier",
        productId: "piksend",
        promptTemplate: "Score leads based on urgency and fit.",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(
      internal.agents.analystHelpers.enrichPromptWithWinLossInsights,
      {
        agentType: "qualifier",
        productId: "piksend",
        insights: "Most rejections come from price-sensitive leads. Deprioritize budget-constrained prospects.",
      },
    );

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });

    expect(updated!.promptTemplate).toContain("[WIN/LOSS INSIGHTS]");
    expect(updated!.promptTemplate).toContain("price-sensitive leads");
    expect(updated!.promptTemplate).toContain("[/WIN/LOSS INSIGHTS]");
    // Original template should still be present
    expect(updated!.promptTemplate).toContain("Score leads based on urgency and fit.");
  });

  test("enrichPromptWithWinLossInsights replaces existing insights section", async () => {
    const t = convexTest(schema, modules);

    const configId = await t.run(async (ctx) => {
      return await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        productId: "gatectr",
        promptTemplate: "Write messages.\n\n[WIN/LOSS INSIGHTS]\nOld insights here.\n[/WIN/LOSS INSIGHTS]",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(
      internal.agents.analystHelpers.enrichPromptWithWinLossInsights,
      {
        agentType: "copywriter",
        productId: "gatectr",
        insights: "New updated insights based on recent data.",
      },
    );

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });

    expect(updated!.promptTemplate).toContain("New updated insights");
    expect(updated!.promptTemplate).not.toContain("Old insights here");
    expect(updated!.promptTemplate).toContain("Write messages.");
  });
});
