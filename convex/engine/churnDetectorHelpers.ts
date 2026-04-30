import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Churn Detector.
 *
 * These live in a separate file because churnDetector.ts uses "use node"
 * (for the Copywriter action call), and files with "use node" can only
 * export actions. Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** 7 days in milliseconds — no login threshold */
export const NO_LOGIN_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** 14 days in milliseconds — usage drop analysis window */
export const USAGE_DROP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** 48 hours in milliseconds — support ticket without response */
export const SUPPORT_TICKET_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get all converted/active leads that may show churn signals.
 * Returns up to 100 converted leads per batch.
 */
export const getConvertedLeads = internalQuery({
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
 * Get converted leads with no activity for more than the specified threshold.
 * A lead is considered inactive if lastActivityAt is older than the cutoff,
 * or if lastActivityAt is not set and convertedAt is older than the cutoff.
 *
 * Requirement 12.1: No login for > 7 days → high priority alert
 */
export const getInactiveConvertedLeads = internalQuery({
  args: { inactivityThresholdMs: v.number() },
  returns: v.any(),
  handler: async (ctx, { inactivityThresholdMs }) => {
    const cutoff = Date.now() - inactivityThresholdMs;

    const convertedLeads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "converted"))
      .take(100);

    return convertedLeads.filter((lead) => {
      const lastActivity = lead.lastActivityAt ?? lead.convertedAt ?? lead.updatedAt;
      return lastActivity <= cutoff;
    });
  },
});

/**
 * Get webhook events that indicate a support ticket opened > 48h ago
 * without a corresponding resolution event.
 *
 * Requirement 12.3: Support ticket open > 48h without response → escalation
 */
export const getUnresolvedSupportTickets = internalQuery({
  args: { ticketThresholdMs: v.number() },
  returns: v.any(),
  handler: async (ctx, { ticketThresholdMs }) => {
    const cutoff = Date.now() - ticketThresholdMs;

    const supportEvents = await ctx.db
      .query("webhook_events")
      .withIndex("by_source")
      .take(200);

    return supportEvents.filter((event) => {
      const isTicketOpen =
        event.eventType === "support_ticket_opened" ||
        event.eventType === "support_ticket" ||
        event.eventType === "ticket_opened";
      const isOldEnough = event.receivedAt <= cutoff;
      const isUnprocessed = !event.processed;
      return isTicketOpen && isOldEnough && isUnprocessed;
    });
  },
});

/**
 * Get webhook events that indicate a cancellation attempt.
 *
 * Requirement 12.4: Cancellation attempt → immediate downsell offer
 */
export const getCancellationAttempts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const cancellationEvents = await ctx.db
      .query("webhook_events")
      .withIndex("by_processed", (q) => q.eq("processed", false))
      .take(100);

    return cancellationEvents.filter((event) => {
      return (
        event.eventType === "subscription_cancelled" ||
        event.eventType === "subscription_cancellation" ||
        event.eventType === "cancel_attempt" ||
        event.eventType === "customer.subscription.deleted" ||
        event.eventType === "subscription_pending_cancel"
      );
    });
  },
});

/**
 * Get tracking events for a lead within a time window to detect usage drops.
 * Compares activity in the first half vs second half of the window.
 *
 * Requirement 12.2: Usage drop > 50% over 2 weeks → retention message
 */
export const getLeadActivityForUsageDrop = internalQuery({
  args: {
    leadId: v.id("leads"),
    windowMs: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { leadId, windowMs }) => {
    const now = Date.now();
    const windowStart = now - windowMs;
    const midpoint = windowStart + windowMs / 2;

    const events = await ctx.db
      .query("tracking_events")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(200);

    const eventsInWindow = events.filter((e) => e.timestamp >= windowStart);
    const firstHalf = eventsInWindow.filter((e) => e.timestamp < midpoint).length;
    const secondHalf = eventsInWindow.filter((e) => e.timestamp >= midpoint).length;

    return { firstHalf, secondHalf, totalEvents: eventsInWindow.length };
  },
});

/**
 * Find the lead associated with a webhook event by matching email or externalId.
 */
export const findLeadForWebhookEvent = internalQuery({
  args: { webhookEventId: v.id("webhook_events") },
  returns: v.any(),
  handler: async (ctx, { webhookEventId }) => {
    const event = await ctx.db.get(webhookEventId);
    if (!event || !event.payload) return null;

    const payload = event.payload as Record<string, unknown>;
    const email = (payload.user_email ?? payload.email ?? payload.customer_email) as
      | string
      | undefined;

    if (email) {
      const lead = await ctx.db
        .query("leads")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      return lead;
    }

    return null;
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Update a lead's churn risk score and optionally mark as churned.
 */
export const updateChurnRiskScore = internalMutation({
  args: {
    leadId: v.id("leads"),
    churnRiskScore: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { leadId, churnRiskScore }) => {
    await ctx.db.patch(leadId, {
      churnRiskScore,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Mark a lead as churned.
 */
export const markLeadAsChurned = internalMutation({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    await ctx.db.patch(leadId, {
      status: "churned",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Mark a webhook event as processed so it won't be picked up again.
 */
export const markWebhookEventProcessed = internalMutation({
  args: { webhookEventId: v.id("webhook_events") },
  returns: v.null(),
  handler: async (ctx, { webhookEventId }) => {
    await ctx.db.patch(webhookEventId, {
      processed: true,
      processedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Insert a retention/downsell message into the messages table.
 * The message goes through the standard pipeline: Channel Router → Timing → HITL.
 *
 * Requirement 12.5: All retention/downsell messages must go through HITL validation.
 */
export const insertRetentionMessage = internalMutation({
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
