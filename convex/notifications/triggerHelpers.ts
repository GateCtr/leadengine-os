import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for notification triggers.
 *
 * These live in a separate file because triggers.ts uses "use node"
 * (for the Novu API calls via fetch), and files with "use node" can only
 * export actions. Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Store a notification in the `notifications` table.
 * Called after (or instead of) sending via Novu to ensure every notification
 * is persisted regardless of Novu delivery status.
 */
export const storeNotification = internalMutation({
  args: {
    type: v.union(
      v.literal("critical_lead"),
      v.literal("hot_reply"),
      v.literal("idle_hot_lead"),
      v.literal("churn_signal"),
      v.literal("pending_validation"),
      v.literal("weekly_report"),
    ),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("info"),
    ),
    title: v.string(),
    body: v.string(),
    leadId: v.optional(v.id("leads")),
    messageId: v.optional(v.id("messages")),
    sentViaNovu: v.boolean(),
  },
  returns: v.id("notifications"),
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      type: args.type,
      priority: args.priority,
      title: args.title,
      body: args.body,
      leadId: args.leadId,
      messageId: args.messageId,
      isRead: false,
      sentViaNovu: args.sentViaNovu,
      createdAt: Date.now(),
    });
    return notificationId;
  },
});

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get leads with status `hot` that have not been updated in the last 4 hours.
 * Used by the checkIdleHotLeads cron to trigger idle_hot_lead notifications.
 *
 * Requirement 16.3: Lead `hot` without action for > 4h → notification high push + Dashboard banner
 */
export const getIdleHotLeads = internalQuery({
  args: { idleThresholdMs: v.number() },
  returns: v.any(),
  handler: async (ctx, { idleThresholdMs }) => {
    const cutoff = Date.now() - idleThresholdMs;

    const hotLeads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "hot"))
      .take(100);

    return hotLeads.filter((lead) => lead.updatedAt <= cutoff);
  },
});

/**
 * Get messages in `pending_validation` status that have been waiting for more than
 * the specified threshold.
 *
 * Requirement 16.5: Message pending validation for > 8h → notification medium Dashboard
 */
export const getPendingValidationMessages = internalQuery({
  args: { pendingThresholdMs: v.number() },
  returns: v.any(),
  handler: async (ctx, { pendingThresholdMs }) => {
    const cutoff = Date.now() - pendingThresholdMs;

    const pendingMessages = await ctx.db
      .query("messages")
      .withIndex("by_validationStatus", (q) =>
        q.eq("validationStatus", "pending_validation"),
      )
      .take(100);

    return pendingMessages.filter((msg) => msg.createdAt <= cutoff);
  },
});

/**
 * Check if a notification of a given type already exists for a lead
 * within a recent time window, to avoid duplicate notifications.
 */
export const hasRecentNotification = internalQuery({
  args: {
    type: v.union(
      v.literal("critical_lead"),
      v.literal("hot_reply"),
      v.literal("idle_hot_lead"),
      v.literal("churn_signal"),
      v.literal("pending_validation"),
      v.literal("weekly_report"),
    ),
    leadId: v.optional(v.id("leads")),
    messageId: v.optional(v.id("messages")),
    windowMs: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { type, leadId, messageId, windowMs }) => {
    const cutoff = Date.now() - windowMs;

    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_type", (q) => q.eq("type", type))
      .order("desc")
      .take(50);

    return recentNotifications.some((n) => {
      if (n.createdAt < cutoff) return false;
      if (leadId && n.leadId !== leadId) return false;
      if (messageId && n.messageId !== messageId) return false;
      return true;
    });
  },
});
