/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// ─── Helper: insert a product ────────────────────────────────────────────────

async function insertTestProduct(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("products", {
      slug: "piksend",
      name: "Piksend",
      senderEmail: "hello@piksend.com",
      replyToEmail: "support@piksend.com",
      templateId: "piksend-outreach",
      brandColor: "#FF6B35",
      logoUrl: "https://cdn.leadengine.io/logos/piksend.svg",
      landingPageBaseUrl: "https://piksend.com/lp",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ─── Helper: insert a lead ───────────────────────────────────────────────────

async function insertTestLead(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("leads", {
      email: "prospect@example.com",
      source: "radar",
      detectedAt: now,
      detectionChannel: "web",
      status: "qualified",
      score: 75,
      productId: "piksend",
      consentSource: "radar_detection",
      consentDate: now,
      updatedAt: now,
      ...overrides,
    });
  });
}

// ─── Helper: insert a sent message for a lead ────────────────────────────────

async function insertTestMessage(
  t: ReturnType<typeof convexTest>,
  leadId: Id<"leads">,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("messages", {
      leadId,
      suggestedReply: "Hello, I noticed you might benefit from Piksend...",
      subject: "Piksend can help",
      validationStatus: "sent",
      sentAt: now - 60_000, // Sent 1 minute ago
      channel: "email",
      createdAt: now - 120_000,
      updatedAt: now - 60_000,
      ...overrides,
    });
  });
}

// ─── processInboundReply tests ───────────────────────────────────────────────

describe("processInboundReply", () => {
  it("updates message with reply content and schedules Agent Objecteur", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await insertTestProduct(t);
    const leadId = await insertTestLead(t);
    const messageId = await insertTestMessage(t, leadId);

    const result = await t.mutation(internal.webhooks.processInboundReply, {
      senderEmail: "prospect@example.com",
      replyContent: "I'm interested in learning more about Piksend!",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.messageId).toBe(messageId);
      expect(result.leadId).toBe(leadId);
    }

    // Verify the message was updated
    const message = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(message).not.toBeNull();
    expect(message!.replyContent).toBe("I'm interested in learning more about Piksend!");
    expect(message!.replyReceivedAt).toBeDefined();
    expect(typeof message!.replyReceivedAt).toBe("number");

    vi.useRealTimers();
  });

  it("returns failure when no lead matches the sender email", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.webhooks.processInboundReply, {
      senderEmail: "unknown@example.com",
      replyContent: "Some reply",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("No lead found for sender email");
    }
  });

  it("returns failure when lead exists but has no messages", async () => {
    const t = convexTest(schema, modules);
    await insertTestProduct(t);
    await insertTestLead(t);

    const result = await t.mutation(internal.webhooks.processInboundReply, {
      senderEmail: "prospect@example.com",
      replyContent: "Some reply",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("No messages found for lead");
    }
  });

  it("associates reply with the most recent message when multiple exist", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await insertTestProduct(t);
    const leadId = await insertTestLead(t);

    const now = Date.now();

    // Insert an older message
    const oldMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "First message",
        validationStatus: "sent",
        sentAt: now - 86_400_000, // 1 day ago
        createdAt: now - 86_400_000,
        updatedAt: now - 86_400_000,
      });
    });

    // Insert a newer message (created later, so it appears last in desc order)
    const newMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        suggestedReply: "Second message",
        validationStatus: "sent",
        sentAt: now - 3_600_000, // 1 hour ago
        createdAt: now - 3_600_000,
        updatedAt: now - 3_600_000,
      });
    });

    const result = await t.mutation(internal.webhooks.processInboundReply, {
      senderEmail: "prospect@example.com",
      replyContent: "Replying to the latest message",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Should associate with the most recent message (by _creationTime desc)
      expect(result.messageId).toBe(newMessageId);
    }

    // Verify old message was NOT updated
    const oldMessage = await t.run(async (ctx) => ctx.db.get(oldMessageId));
    expect(oldMessage!.replyContent).toBeUndefined();

    // Verify new message WAS updated
    const newMessage = await t.run(async (ctx) => ctx.db.get(newMessageId));
    expect(newMessage!.replyContent).toBe("Replying to the latest message");

    vi.useRealTimers();
  });

  it("creates a log entry on successful processing", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await insertTestProduct(t);
    const leadId = await insertTestLead(t);
    await insertTestMessage(t, leadId);

    await t.mutation(internal.webhooks.processInboundReply, {
      senderEmail: "prospect@example.com",
      replyContent: "Thanks for reaching out!",
    });

    // Check that a log was created
    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("agent_logs")
        .withIndex("by_agentType", (q) => q.eq("agentType", "objector"))
        .collect();
    });

    const infoLog = logs.find(
      (l) => l.level === "info" && l.message.includes("Inbound reply received"),
    );
    expect(infoLog).toBeDefined();

    vi.useRealTimers();
  });
});
