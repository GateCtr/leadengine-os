/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function insertTestLead(
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
      status: "qualified",
      consentSource: "web_form",
      consentDate: now,
      updatedAt: now,
      ...overrides,
    });
  });
}

async function insertTestMessage(
  t: ReturnType<typeof convexTest>,
  leadId: Id<"leads">,
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("messages", {
      leadId,
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function insertTestSequence(
  t: ReturnType<typeof convexTest>,
  leadId: Id<"leads">,
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("sequences", {
      leadId,
      type: "outreach",
      status: "active",
      currentStep: 0,
      steps: [{ day: 0, type: "initial", angle: "intro" }],
      startedAt: now,
    });
  });
}

describe("deleteProspectData", () => {
  it("deletes lead and all associated data in a single transaction", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user123" });

    const leadId = await insertTestLead(t);
    const messageId = await insertTestMessage(t, leadId);

    await t.run(async (ctx) => {
      await ctx.db.insert("tracking_events", {
        leadId,
        messageId,
        type: "click",
        timestamp: Date.now(),
      });
      await ctx.db.insert("short_urls", {
        code: "abc123",
        originalUrl: "https://example.com",
        leadId,
        messageId,
        clickCount: 0,
        createdAt: Date.now(),
      });
      await ctx.db.insert("testimonials", {
        leadId,
        productId: "piksend",
        content: "Great product!",
        isValidated: true,
        createdAt: Date.now(),
      });
      await ctx.db.insert("notifications", {
        type: "critical_lead",
        priority: "critical",
        title: "Hot lead",
        body: "New hot lead detected",
        leadId,
        isRead: false,
        sentViaNovu: false,
        createdAt: Date.now(),
      });
    });

    await insertTestSequence(t, leadId);

    const result = await asUser.mutation(
      api.compliance.deleteProspect.deleteProspectData,
      { leadId },
    );

    expect(result.email).toBe("test@example.com");
    expect(result.messagesDeleted).toBe(1);
    expect(result.sequencesDeleted).toBe(1);
    expect(result.trackingEventsDeleted).toBe(1);
    expect(result.shortUrlsDeleted).toBe(1);
    expect(result.testimonialsDeleted).toBe(1);
    expect(result.notificationsDeleted).toBe(1);

    // Verify lead is gone
    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });
    expect(lead).toBeNull();

    // Verify email is blacklisted
    const blacklistEntry = await t.run(async (ctx) => {
      return await ctx.db
        .query("blacklist")
        .withIndex("by_email", (q) => q.eq("email", "test@example.com"))
        .unique();
    });
    expect(blacklistEntry).not.toBeNull();
    expect(blacklistEntry!.reason).toBe("gdpr_request");
  });

  it("throws when not authenticated", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    await expect(
      t.mutation(api.compliance.deleteProspect.deleteProspectData, { leadId }),
    ).rejects.toThrow("Authentication required");
  });

  it("throws when lead does not exist", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user123" });
    const leadId = await insertTestLead(t);

    // Delete the lead first
    await t.run(async (ctx) => {
      await ctx.db.delete(leadId);
    });

    await expect(
      asUser.mutation(
        api.compliance.deleteProspect.deleteProspectData,
        { leadId },
      ),
    ).rejects.toThrow("not found");
  });

  it("does not duplicate blacklist entry if email already blacklisted", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user123" });
    const leadId = await insertTestLead(t);

    // Pre-blacklist the email
    await t.run(async (ctx) => {
      await ctx.db.insert("blacklist", {
        email: "test@example.com",
        reason: "unsubscribe",
        addedAt: Date.now(),
      });
    });

    await asUser.mutation(
      api.compliance.deleteProspect.deleteProspectData,
      { leadId },
    );

    // Should still have only one blacklist entry
    const entries = await t.run(async (ctx) => {
      return await ctx.db
        .query("blacklist")
        .withIndex("by_email", (q) => q.eq("email", "test@example.com"))
        .take(10);
    });
    expect(entries).toHaveLength(1);
    // Original reason preserved
    expect(entries[0].reason).toBe("unsubscribe");
  });
});
