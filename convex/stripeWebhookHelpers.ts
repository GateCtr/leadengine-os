import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Helper mutations for Stripe webhook processing.
 *
 * These live in a separate file because stripeWebhook.ts uses "use node"
 * (for Stripe SDK crypto), and files with "use node" can only export actions.
 * Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

/**
 * Process a checkout.session.completed event.
 *
 * 1. Find the lead by customer email
 * 2. Update lead status to `converted`, record revenue and convertedAt
 * 3. Store stripeCustomerId for future reference
 * 4. Create an onboarding sequence (J0, J1, J3, J7, J14)
 *
 * Requirements: 11.1, 11.2
 */
export const processCheckoutCompleted = internalMutation({
  args: {
    customerEmail: v.string(),
    revenueGenerated: v.number(),
    stripeCustomerId: v.optional(v.string()),
    stripeEventId: v.string(),
    currency: v.string(),
  },
  returns: v.object({
    leadFound: v.boolean(),
    leadId: v.optional(v.id("leads")),
    sequenceId: v.optional(v.id("sequences")),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // 1. Find the lead by customer email
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", args.customerEmail))
      .unique();

    if (!lead) {
      return { leadFound: false };
    }

    // 2. Update lead status to `converted` (Requirement 11.1)
    await ctx.db.patch(lead._id, {
      status: "converted",
      revenueGenerated: (lead.revenueGenerated ?? 0) + args.revenueGenerated,
      stripeCustomerId: args.stripeCustomerId,
      convertedAt: now,
      lastActivityAt: now,
      updatedAt: now,
    });

    // 3. Cancel any active outreach sequences for this lead
    const activeSequences = await ctx.db
      .query("sequences")
      .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
      .take(10);

    for (const seq of activeSequences) {
      if (seq.status === "active" && seq.type === "outreach") {
        await ctx.db.patch(seq._id, {
          status: "completed",
          completedAt: now,
        });
      }
    }

    // 4. Create an onboarding sequence (J0, J1, J3, J7, J14) (Requirement 11.2)
    // Note: ctx.scheduler.runAfter returns a ScheduledFunctionId, not the function's
    // return value. The sequence is created asynchronously.
    await ctx.scheduler.runAfter(
      0,
      internal.engine.sequenceHelpers.createSequence,
      {
        leadId: lead._id,
        type: "onboarding",
      },
    );

    // 5. Log the conversion
    await ctx.db.insert("agent_logs", {
      agentType: "analyst",
      level: "info",
      message: `Lead ${lead._id} (${args.customerEmail}) converted via Stripe. Revenue: ${args.revenueGenerated} ${args.currency}. Onboarding sequence scheduled.`,
      leadId: lead._id,
      metadata: {
        stripeEventId: args.stripeEventId,
        revenueGenerated: args.revenueGenerated,
        currency: args.currency,
        stripeCustomerId: args.stripeCustomerId,
      },
      timestamp: now,
    });

    // 6. Record a conversion tracking event
    // Find the most recent sent message for attribution
    const recentMessage = await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
      .order("desc")
      .first();

    if (recentMessage) {
      await ctx.db.insert("tracking_events", {
        leadId: lead._id,
        messageId: recentMessage._id,
        type: "conversion",
        timestamp: now,
        metadata: {
          stripeEventId: args.stripeEventId,
          revenueGenerated: args.revenueGenerated,
          currency: args.currency,
        },
      });
    }

    return {
      leadFound: true,
      leadId: lead._id,
    };
  },
});
