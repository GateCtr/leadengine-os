import { v } from "convex/values";
import { query } from "../_generated/server";

/**
 * Queue Queries — Fetch messages pending validation for the Dashboard.
 *
 * Returns messages with validationStatus = "pending_validation",
 * joined with lead data for score, and sorted by lead score descending.
 *
 * Requirements: 7.1, 7.2, 7.5
 */
export const listPendingValidation = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      leadId: v.id("leads"),
      suggestedReply: v.optional(v.string()),
      suggestedReplyB: v.optional(v.string()),
      activeVersion: v.optional(v.union(v.literal("A"), v.literal("B"))),
      subject: v.optional(v.string()),
      channel: v.optional(
        v.union(
          v.literal("email"),
          v.literal("twitter"),
          v.literal("linkedin"),
          v.literal("reddit"),
          v.literal("instagram"),
        ),
      ),
      sendAtSuggested: v.optional(v.number()),
      validationStatus: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      leadName: v.optional(v.string()),
      leadEmail: v.string(),
      leadScore: v.optional(v.number()),
      productId: v.optional(v.string()),
      productName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_validationStatus", (q) =>
        q.eq("validationStatus", "pending_validation"),
      )
      .collect();

    const enriched = await Promise.all(
      messages.map(async (msg) => {
        const lead = await ctx.db.get(msg.leadId);

        let productName: string | undefined;
        if (lead?.productId) {
          const product = await ctx.db
            .query("products")
            .withIndex("by_slug", (q) => q.eq("slug", lead.productId!))
            .unique();
          productName = product?.name;
        }

        return {
          _id: msg._id,
          _creationTime: msg._creationTime,
          leadId: msg.leadId,
          suggestedReply: msg.suggestedReply,
          suggestedReplyB: msg.suggestedReplyB,
          activeVersion: msg.activeVersion,
          subject: msg.subject,
          channel: msg.channel,
          sendAtSuggested: msg.sendAtSuggested,
          validationStatus: msg.validationStatus,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
          leadName: lead?.name,
          leadEmail: lead?.email ?? "",
          leadScore: lead?.score,
          productId: lead?.productId,
          productName,
        };
      }),
    );

    // Sort by lead score descending (highest score first)
    enriched.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));

    return enriched;
  },
});
