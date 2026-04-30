"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  sendNotification,
  type NovuWorkflowId,
  type NotificationPriority,
} from "../integrations/novu";

/**
 * Notification triggers for LeadEngine OS.
 *
 * Each trigger:
 * 1. Sends a push notification via Novu (with retry + fallback)
 * 2. Stores the notification in the `notifications` table
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const DEFAULT_SUBSCRIBER_ID = "leadengine_operator";
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour dedup window

// ─── Core trigger action ─────────────────────────────────────────────────────

/**
 * Internal action that sends a notification via Novu and stores it in the
 * notifications table. This is the central notification dispatch function.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */
export const triggerNotification = internalAction({
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Check for recent duplicate notification to avoid spam
    const hasDuplicate: boolean = await ctx.runQuery(
      internal.notifications.triggerHelpers.hasRecentNotification,
      {
        type: args.type,
        leadId: args.leadId,
        messageId: args.messageId,
        windowMs: DEDUP_WINDOW_MS,
      },
    );

    if (hasDuplicate) {
      return null;
    }

    // Send via Novu (with retry + fallback)
    const result = await sendNotification({
      subscriberId: DEFAULT_SUBSCRIBER_ID,
      workflowId: args.type as NovuWorkflowId,
      title: args.title,
      body: args.body,
      priority: args.priority as NotificationPriority,
      payload: {
        ...(args.leadId ? { leadId: args.leadId } : {}),
        ...(args.messageId ? { messageId: args.messageId } : {}),
      },
    });

    // Store in notifications table regardless of Novu delivery status
    await ctx.runMutation(
      internal.notifications.triggerHelpers.storeNotification,
      {
        type: args.type,
        priority: args.priority,
        title: args.title,
        body: args.body,
        leadId: args.leadId,
        messageId: args.messageId,
        sentViaNovu: result.sentViaNovu,
      },
    );

    return null;
  },
});

// ─── Cron-based checks ───────────────────────────────────────────────────────

/**
 * Check for hot leads that have been idle for more than 4 hours.
 * Triggered by a cron job. For each idle hot lead, dispatches a
 * `idle_hot_lead` notification with priority `high`.
 *
 * Requirement 16.3: Lead `hot` without action for > 4h → notification high push + Dashboard banner
 */
export const checkIdleHotLeads = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const idleLeads = await ctx.runQuery(
      internal.notifications.triggerHelpers.getIdleHotLeads,
      { idleThresholdMs: FOUR_HOURS_MS },
    );

    for (const lead of idleLeads) {
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "idle_hot_lead",
          priority: "high",
          title: "Lead hot inactif depuis 4h+",
          body: `Le lead ${lead.name ?? lead.email} (score: ${lead.score ?? "N/A"}) est en statut hot sans action depuis plus de 4 heures.`,
          leadId: lead._id,
        },
      );
    }

    return null;
  },
});

/**
 * Check for messages pending validation for more than 8 hours.
 * Triggered by a cron job. For each stale message, dispatches a
 * `pending_validation` notification with priority `medium`.
 *
 * Requirement 16.5: Message pending validation for > 8h → notification medium Dashboard
 */
export const checkPendingValidation = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const staleMessages = await ctx.runQuery(
      internal.notifications.triggerHelpers.getPendingValidationMessages,
      { pendingThresholdMs: EIGHT_HOURS_MS },
    );

    for (const msg of staleMessages) {
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "pending_validation",
          priority: "medium",
          title: "Message en attente de validation depuis 8h+",
          body: `Un message pour le lead est en attente de validation depuis plus de 8 heures.`,
          messageId: msg._id,
          leadId: msg.leadId,
        },
      );
    }

    return null;
  },
});
