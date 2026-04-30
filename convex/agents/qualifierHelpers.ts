import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Agent Qualificateur.
 *
 * These live in a separate file because qualifier.ts uses "use node"
 * (for the Vercel AI SDK), and files with "use node" can only export actions.
 * Queries and mutations must be in a non-"use node" file.
 */

/**
 * Read a lead by ID for qualification. Returns null if not found.
 */
export const getLeadForQualification = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    return await ctx.db.get(leadId);
  },
});

/**
 * Get all active products (for USP comparison during scoring).
 */
export const getActiveProducts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("products")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
  },
});

/**
 * Update a lead with qualification results (score, status, productId).
 */
export const updateLeadQualification = internalMutation({
  args: {
    leadId: v.id("leads"),
    status: v.union(v.literal("qualified"), v.literal("discarded")),
    score: v.number(),
    scoringBreakdown: v.object({
      urgency: v.number(),
      webhookSource: v.number(),
      productMatch: v.number(),
      activeProfile: v.number(),
      contextSignals: v.number(),
    }),
    productId: v.optional(v.string()),
    scoringReasoning: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      status: args.status,
      score: args.score,
      scoringBreakdown: args.scoringBreakdown,
      productId: args.productId,
      scoringReasoning: args.scoringReasoning,
      updatedAt: Date.now(),
    });

    // When a lead becomes qualified, schedule the Agent Copywriter to compose a message.
    // This is the reactive trigger: qualified lead without suggested_reply → Copywriter.
    // (Requirements: 5.1, 2.2)
    if (args.status === "qualified") {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.copywriter.composeMessage,
        { leadId: args.leadId },
      );
    }

    // Requirement 16.1: Lead score > 85 → notification critical push immediate
    if (args.score > 85) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.triggers.triggerNotification,
        {
          type: "critical_lead",
          priority: "critical",
          title: "Lead critique détecté",
          body: `Un lead avec un score de ${args.score} a été qualifié pour ${args.productId ?? "un produit"}.`,
          leadId: args.leadId,
        },
      );
    }

    return null;
  },
});
