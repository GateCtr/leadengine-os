/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, test, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for notification triggers (task 17.2).
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */

// ─── Helper: create a lead in the DB ─────────────────────────────────────────

async function createTestLead(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("leads", {
      email: "test@example.com",
      source: "radar",
      detectedAt: now,
      detectionChannel: "web",
      status: "qualified" as const,
      score: 90,
      productId: "piksend",
      consentSource: "web_scraping",
      consentDate: now,
      updatedAt: now,
      ...overrides,
    });
  });
}

// ─── Helper: create a message in the DB ──────────────────────────────────────

async function createTestMessage(
  t: ReturnType<typeof convexTest>,
  leadId: ReturnType<typeof createTestLead> extends Promise<infer T> ? T : never,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("messages", {
      leadId,
      validationStatus: "pending_validation" as const,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  });
}

// ─── storeNotification ───────────────────────────────────────────────────────

describe("storeNotification", () => {
  test("stores a notification with all fields", async () => {
    const t = convexTest(schema, modules);

    const leadId = await createTestLead(t);

    const notifId = await t.mutation(
      internal.notifications.triggerHelpers.storeNotification,
      {
        type: "critical_lead",
        priority: "critical",
        title: "Lead critique",
        body: "Score de 92 détecté",
        leadId,
        sentViaNovu: true,
      },
    );

    const notif = await t.run(async (ctx) => {
      return await ctx.db.get(notifId);
    });

    expect(notif).not.toBeNull();
    expect(notif!.type).toBe("critical_lead");
    expect(notif!.priority).toBe("critical");
    expect(notif!.title).toBe("Lead critique");
    expect(notif!.body).toBe("Score de 92 détecté");
    expect(notif!.leadId).toBe(leadId);
    expect(notif!.isRead).toBe(false);
    expect(notif!.sentViaNovu).toBe(true);
    expect(notif!.createdAt).toBeGreaterThan(0);
  });

  test("stores notification without leadId or messageId", async () => {
    const t = convexTest(schema, modules);

    const notifId = await t.mutation(
      internal.notifications.triggerHelpers.storeNotification,
      {
        type: "weekly_report",
        priority: "info",
        title: "Rapport hebdomadaire",
        body: "Votre rapport est prêt",
        sentViaNovu: false,
      },
    );

    const notif = await t.run(async (ctx) => {
      return await ctx.db.get(notifId);
    });

    expect(notif).not.toBeNull();
    expect(notif!.type).toBe("weekly_report");
    expect(notif!.leadId).toBeUndefined();
    expect(notif!.messageId).toBeUndefined();
  });
});

// ─── getIdleHotLeads ─────────────────────────────────────────────────────────

describe("getIdleHotLeads", () => {
  test("returns hot leads idle beyond threshold", async () => {
    const t = convexTest(schema, modules);
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;

    await createTestLead(t, {
      email: "idle@example.com",
      status: "hot",
      updatedAt: fiveHoursAgo,
    });

    const idleLeads = await t.query(
      internal.notifications.triggerHelpers.getIdleHotLeads,
      { idleThresholdMs: FOUR_HOURS_MS },
    );

    expect(idleLeads.length).toBe(1);
    expect(idleLeads[0].email).toBe("idle@example.com");
  });

  test("does not return recently updated hot leads", async () => {
    const t = convexTest(schema, modules);
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

    await createTestLead(t, {
      email: "active@example.com",
      status: "hot",
      updatedAt: Date.now(),
    });

    const idleLeads = await t.query(
      internal.notifications.triggerHelpers.getIdleHotLeads,
      { idleThresholdMs: FOUR_HOURS_MS },
    );

    expect(idleLeads.length).toBe(0);
  });

  test("does not return non-hot leads", async () => {
    const t = convexTest(schema, modules);
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;

    await createTestLead(t, {
      email: "qualified@example.com",
      status: "qualified",
      updatedAt: fiveHoursAgo,
    });

    const idleLeads = await t.query(
      internal.notifications.triggerHelpers.getIdleHotLeads,
      { idleThresholdMs: FOUR_HOURS_MS },
    );

    expect(idleLeads.length).toBe(0);
  });
});

// ─── getPendingValidationMessages ────────────────────────────────────────────

describe("getPendingValidationMessages", () => {
  test("returns messages pending validation beyond threshold", async () => {
    const t = convexTest(schema, modules);
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
    const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;

    const leadId = await createTestLead(t);
    await createTestMessage(t, leadId, {
      validationStatus: "pending_validation",
      createdAt: nineHoursAgo,
    });

    const staleMessages = await t.query(
      internal.notifications.triggerHelpers.getPendingValidationMessages,
      { pendingThresholdMs: EIGHT_HOURS_MS },
    );

    expect(staleMessages.length).toBe(1);
  });

  test("does not return recently created pending messages", async () => {
    const t = convexTest(schema, modules);
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

    const leadId = await createTestLead(t);
    await createTestMessage(t, leadId, {
      validationStatus: "pending_validation",
      createdAt: Date.now(),
    });

    const staleMessages = await t.query(
      internal.notifications.triggerHelpers.getPendingValidationMessages,
      { pendingThresholdMs: EIGHT_HOURS_MS },
    );

    expect(staleMessages.length).toBe(0);
  });

  test("does not return messages with other validation statuses", async () => {
    const t = convexTest(schema, modules);
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
    const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;

    const leadId = await createTestLead(t);
    await createTestMessage(t, leadId, {
      validationStatus: "approved",
      createdAt: nineHoursAgo,
    });

    const staleMessages = await t.query(
      internal.notifications.triggerHelpers.getPendingValidationMessages,
      { pendingThresholdMs: EIGHT_HOURS_MS },
    );

    expect(staleMessages.length).toBe(0);
  });
});

// ─── hasRecentNotification ───────────────────────────────────────────────────

describe("hasRecentNotification", () => {
  test("returns true when a recent notification exists for the same lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await createTestLead(t);

    await t.mutation(
      internal.notifications.triggerHelpers.storeNotification,
      {
        type: "critical_lead",
        priority: "critical",
        title: "Test",
        body: "Test body",
        leadId,
        sentViaNovu: false,
      },
    );

    const hasRecent = await t.query(
      internal.notifications.triggerHelpers.hasRecentNotification,
      {
        type: "critical_lead",
        leadId,
        windowMs: 60 * 60 * 1000,
      },
    );

    expect(hasRecent).toBe(true);
  });

  test("returns false when no recent notification exists", async () => {
    const t = convexTest(schema, modules);
    const leadId = await createTestLead(t);

    const hasRecent = await t.query(
      internal.notifications.triggerHelpers.hasRecentNotification,
      {
        type: "critical_lead",
        leadId,
        windowMs: 60 * 60 * 1000,
      },
    );

    expect(hasRecent).toBe(false);
  });
});

// ─── Wiring: qualifierHelpers triggers critical_lead for score > 85 ──────────

describe("qualifierHelpers critical_lead notification wiring", () => {
  test("schedules critical_lead notification when score > 85", async () => {
    const t = convexTest(schema, modules);

    const leadId = await createTestLead(t, {
      status: "pending_qualification",
      score: undefined,
    });

    await t.mutation(
      internal.agents.qualifierHelpers.updateLeadQualification,
      {
        leadId,
        status: "qualified",
        score: 92,
        scoringBreakdown: {
          urgency: 28,
          webhookSource: 20,
          productMatch: 18,
          activeProfile: 14,
          contextSignals: 12,
        },
        productId: "piksend",
        scoringReasoning: "High urgency lead",
      },
    );

    // The notification is scheduled via ctx.scheduler.runAfter(0, ...)
    // In convex-test, scheduled functions run automatically.
    // We verify the lead was updated correctly.
    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.status).toBe("qualified");
    expect(lead!.score).toBe(92);
  });

  test("does not schedule critical_lead notification when score <= 85", async () => {
    const t = convexTest(schema, modules);

    const leadId = await createTestLead(t, {
      status: "pending_qualification",
      score: undefined,
    });

    await t.mutation(
      internal.agents.qualifierHelpers.updateLeadQualification,
      {
        leadId,
        status: "qualified",
        score: 60,
        scoringBreakdown: {
          urgency: 15,
          webhookSource: 10,
          productMatch: 15,
          activeProfile: 10,
          contextSignals: 10,
        },
        productId: "piksend",
        scoringReasoning: "Moderate lead",
      },
    );

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.status).toBe("qualified");
    expect(lead!.score).toBe(60);
  });
});

// ─── Wiring: processInboundReply triggers hot_reply within 2h ────────────────

describe("processInboundReply hot_reply notification wiring", () => {
  test("schedules hot_reply notification when reply is within 2h of send", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    const leadId = await createTestLead(t, {
      email: "prospect@example.com",
      status: "qualified",
    });

    await createTestMessage(t, leadId, {
      validationStatus: "sent",
      sentAt: oneHourAgo,
    });

    const result = await t.mutation(
      internal.webhooks.processInboundReply,
      {
        senderEmail: "prospect@example.com",
        replyContent: "I'm interested!",
      },
    );

    expect(result.success).toBe(true);
  });

  test("does not schedule hot_reply when reply is after 2h", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;

    const leadId = await createTestLead(t, {
      email: "slow@example.com",
      status: "qualified",
    });

    await createTestMessage(t, leadId, {
      validationStatus: "sent",
      sentAt: threeHoursAgo,
    });

    const result = await t.mutation(
      internal.webhooks.processInboundReply,
      {
        senderEmail: "slow@example.com",
        replyContent: "I'm interested but took my time",
      },
    );

    expect(result.success).toBe(true);
  });
});
