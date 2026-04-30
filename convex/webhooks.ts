import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/**
 * Internal query to load all active product slugs from the `products` table.
 * Used by the webhook HTTP route to validate incoming product_id values.
 *
 * Requirements: 2.3, 20.5
 */
export const getActiveProductSlugs = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    return products.map((p) => p.slug);
  },
});

/**
 * Internal mutation to store a webhook event in the `webhook_events` table.
 * Stores both successful and failed webhook events for observability.
 *
 * Requirements: 2.1, 2.3, 20.2
 */
export const storeWebhookEvent = internalMutation({
  args: {
    source: v.string(),
    eventType: v.string(),
    payload: v.any(),
    processed: v.boolean(),
    processedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    receivedAt: v.number(),
  },
  returns: v.id("webhook_events"),
  handler: async (ctx, args) => {
    const eventId = await ctx.db.insert("webhook_events", {
      source: args.source,
      eventType: args.eventType,
      payload: args.payload,
      processed: args.processed,
      processedAt: args.processedAt,
      error: args.error,
      receivedAt: args.receivedAt,
    });
    return eventId;
  },
});

/**
 * Internal mutation to create or consolidate a lead from a valid webhook event.
 *
 * - Creates a lead with status `qualified`, score 100, and the corresponding productId.
 * - Stores webhook fields (webhookEventType, webhookEventContext, webhookUserId).
 * - The lead bypasses the Agent Qualificateur and goes directly to the Copywriter.
 * - Deduplicates by email: if a lead with the same email exists, consolidates (updates) it.
 *
 * Requirements: 2.1, 2.2
 */
export const createLeadFromWebhook = internalMutation({
  args: {
    productId: v.string(),
    eventType: v.string(),
    eventContext: v.string(),
    userEmail: v.string(),
    timestamp: v.number(),
  },
  returns: v.id("leads"),
  handler: async (ctx, args): Promise<Id<"leads">> => {
    const now = Date.now();

    // Scoring breakdown for webhook leads: webhookSource gets max (25), others at 0
    // Total score = 100 (max) for webhook leads
    const scoringBreakdown = {
      urgency: 25,
      webhookSource: 25,
      productMatch: 20,
      activeProfile: 15,
      contextSignals: 15,
    };

    const webhookFields = {
      webhookEventType: args.eventType,
      webhookEventContext: args.eventContext,
      webhookUserId: args.userEmail,
    };

    // Deduplicate by email using the by_email index
    const existingLead = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", args.userEmail))
      .unique();

    if (existingLead) {
      // Consolidate: update existing lead to qualified with webhook data
      await ctx.db.patch(existingLead._id, {
        status: "qualified",
        score: 100,
        productId: args.productId,
        source: `webhook_${args.productId}`,
        scoringBreakdown,
        scoringReasoning: "Lead from product webhook — auto-qualified with maximum score",
        ...webhookFields,
        consentSource: "product_signup",
        consentDate: args.timestamp,
        updatedAt: now,
      });

      // Trigger enrichment for the webhook lead (fail-safe — Copywriter runs regardless).
      // Requirement 3.1: Enrich leads that reach `qualified` status.
      await ctx.scheduler.runAfter(
        0,
        internal.enrichment.enrichLead,
        { leadId: existingLead._id },
      );

      // Schedule the Agent Copywriter for this hot lead.
      // Webhook leads bypass the Qualificateur and go directly to the Copywriter.
      // Small delay (2s) to allow enrichment to complete first.
      // (Requirements: 5.1, 2.2)
      await ctx.scheduler.runAfter(
        2000,
        internal.agents.copywriter.composeMessage,
        { leadId: existingLead._id },
      );

      // Requirement 16.1: Lead score > 85 → notification critical push immediate.
      // Webhook leads have score 100, so always trigger.
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.triggers.triggerNotification,
        {
          type: "critical_lead",
          priority: "critical",
          title: "Lead critique détecté (webhook)",
          body: `Un lead webhook avec un score de 100 a été qualifié pour ${args.productId}.`,
          leadId: existingLead._id,
        },
      );

      return existingLead._id;
    }

    // Create new lead
    const leadId = await ctx.db.insert("leads", {
      email: args.userEmail,
      source: `webhook_${args.productId}`,
      detectedAt: args.timestamp,
      detectionChannel: "webhook",
      status: "qualified",
      score: 100,
      productId: args.productId,
      scoringBreakdown,
      scoringReasoning: "Lead from product webhook — auto-qualified with maximum score",
      ...webhookFields,
      consentSource: "product_signup",
      consentDate: args.timestamp,
      updatedAt: now,
    });

    // Trigger enrichment for the webhook lead (fail-safe — Copywriter runs regardless).
    // Requirement 3.1: Enrich leads that reach `qualified` status.
    await ctx.scheduler.runAfter(
      0,
      internal.enrichment.enrichLead,
      { leadId },
    );

    // Schedule the Agent Copywriter for this hot lead.
    // Webhook leads bypass the Qualificateur and go directly to the Copywriter.
    // Small delay (2s) to allow enrichment to complete first.
    // (Requirements: 5.1, 2.2)
    await ctx.scheduler.runAfter(
      2000,
      internal.agents.copywriter.composeMessage,
      { leadId },
    );

    // Requirement 16.1: Lead score > 85 → notification critical push immediate.
    // Webhook leads have score 100, so always trigger.
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.triggers.triggerNotification,
      {
        type: "critical_lead",
        priority: "critical",
        title: "Lead critique détecté (webhook)",
        body: `Un lead webhook avec un score de 100 a été qualifié pour ${args.productId}.`,
        leadId,
      },
    );

    return leadId;
  },
});

/**
 * Internal mutation to mark a webhook event as processed.
 *
 * Requirements: 2.1
 */
export const markWebhookProcessed = internalMutation({
  args: {
    eventId: v.id("webhook_events"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      processed: true,
      processedAt: Date.now(),
    });
    return null;
  },
});


/**
 * Internal mutation to process an inbound email reply from Resend webhook.
 *
 * Pipeline:
 * 1. Find the lead by sender email using the `by_email` index
 * 2. Find the most recent sent message for that lead
 * 3. Update the message with `replyContent` and `replyReceivedAt`
 * 4. Schedule the Agent Objecteur's `analyzeReply` action
 *
 * Requirements: 10.1
 */
export const processInboundReply = internalMutation({
  args: {
    senderEmail: v.string(),
    replyContent: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      messageId: v.id("messages"),
      leadId: v.id("leads"),
    }),
    v.object({
      success: v.literal(false),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, { senderEmail, replyContent }) => {
    const now = Date.now();

    // 1. Find the lead by sender email
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", senderEmail))
      .unique();

    if (!lead) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "objector",
        level: "warn",
        message: `Inbound reply from unknown email: ${senderEmail}. No matching lead found.`,
        metadata: { senderEmail },
      });
      return { success: false as const, reason: "No lead found for sender email" };
    }

    // 2. Find the most recent sent message for that lead (ordered desc by sentAt)
    const recentMessage = await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
      .order("desc")
      .first();

    if (!recentMessage) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "objector",
        level: "warn",
        message: `Inbound reply from ${senderEmail} but no messages found for lead ${lead._id}.`,
        leadId: lead._id,
        metadata: { senderEmail },
      });
      return { success: false as const, reason: "No messages found for lead" };
    }

    // 3. Update the message with replyContent and replyReceivedAt
    await ctx.db.patch(recentMessage._id, {
      replyContent,
      replyReceivedAt: now,
      updatedAt: now,
    });

    // 4. Schedule the Agent Objecteur's analyzeReply action
    await ctx.scheduler.runAfter(
      0,
      internal.agents.objector.analyzeReply,
      {
        messageId: recentMessage._id,
        replyContent,
      },
    );

    // Requirement 16.2: Reply received within 2h post-send → notification high push immediate
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    if (recentMessage.sentAt && now - recentMessage.sentAt <= TWO_HOURS_MS) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.triggers.triggerNotification,
        {
          type: "hot_reply",
          priority: "high",
          title: "Réponse rapide reçue",
          body: `Le prospect ${senderEmail} a répondu dans les 2h suivant l'envoi.`,
          leadId: lead._id,
          messageId: recentMessage._id,
        },
      );
    }

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "objector",
      level: "info",
      message: `Inbound reply received from ${senderEmail}. Message ${recentMessage._id} updated. Agent Objecteur scheduled.`,
      leadId: lead._id,
      messageId: recentMessage._id,
      metadata: { senderEmail },
    });

    return {
      success: true as const,
      messageId: recentMessage._id,
      leadId: lead._id,
    };
  },
});
