import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Upsell Engine.
 *
 * These live in a separate file because upsellEngine.ts uses "use node"
 * (for the Vercel AI SDK), and files with "use node" can only export actions.
 * Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Load all active upsell rules from the `upsell_rules` table.
 * Rules are loaded dynamically — no hardcoded constants.
 */
export const getActiveUpsellRules = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("upsell_rules")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
  },
});

/**
 * Get all converted leads for upsell evaluation.
 * Returns up to 100 converted leads per batch.
 */
export const getConvertedLeadsForUpsell = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "converted"))
      .take(100);
  },
});

/**
 * Get tracking events for a lead to evaluate usage signals.
 * Returns recent events (last 30 days) for signal analysis.
 */
export const getLeadTrackingEvents = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const events = await ctx.db
      .query("tracking_events")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(200);

    return events.filter((e) => e.timestamp >= thirtyDaysAgo);
  },
});

/**
 * Get webhook events for a lead to detect usage patterns.
 * Looks for product-specific webhook events in the last 30 days.
 */
export const getLeadWebhookEvents = internalQuery({
  args: { sourceSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, { sourceSlug }) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const events = await ctx.db
      .query("webhook_events")
      .withIndex("by_source", (q) => q.eq("source", sourceSlug))
      .take(200);

    return events.filter((e) => e.receivedAt >= thirtyDaysAgo);
  },
});

/**
 * Check if an upsell message already exists for a lead + target product
 * to avoid duplicate suggestions.
 */
export const hasExistingUpsellMessage = internalQuery({
  args: {
    leadId: v.id("leads"),
    targetProductSlug: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { leadId, targetProductSlug }) => {
    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(50);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return recentMessages.some(
      (msg) =>
        msg.createdAt >= thirtyDaysAgo &&
        msg.contextualLink?.includes(targetProductSlug),
    );
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Insert an upsell/cross-sell message into the messages table.
 * The message goes through the standard pipeline: Channel Router → Timing → HITL.
 *
 * Requirement 13.5: All upsell/cross-sell messages must go through HITL validation.
 */
export const insertUpsellMessage = internalMutation({
  args: {
    leadId: v.id("leads"),
    suggestedReply: v.string(),
    subject: v.optional(v.string()),
    tone: v.union(v.literal("expert"), v.literal("support"), v.literal("tech")),
    contextualLink: v.string(),
    socialProofUsed: v.optional(v.string()),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const now = Date.now();

    const messageId = await ctx.db.insert("messages", {
      leadId: args.leadId,
      suggestedReply: args.suggestedReply,
      subject: args.subject,
      tone: args.tone,
      contextualLink: args.contextualLink,
      socialProofUsed: args.socialProofUsed,
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Trigger the Channel Router to determine delivery channel and brand identity.
    // This continues the standard pipeline: Channel Router → Timing → HITL.
    await ctx.scheduler.runAfter(
      0,
      internal.router.channelRouter.routeMessage,
      { messageId },
    );

    return messageId;
  },
});
