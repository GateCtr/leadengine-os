import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Internal helpers for the sendApprovedEmail action.
 *
 * Actions cannot access ctx.db directly, so these internal queries/mutations
 * provide the necessary database operations.
 */

/**
 * Read a message by ID.
 */
export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.object({
      _id: v.id("messages"),
      leadId: v.id("leads"),
      validationStatus: v.string(),
      finalContent: v.optional(v.string()),
      suggestedReply: v.optional(v.string()),
      subject: v.optional(v.string()),
      channel: v.optional(v.string()),
      socialDirectLink: v.optional(v.string()),
      sequenceId: v.optional(v.id("sequences")),
      sequenceStep: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, { messageId }) => {
    const msg = await ctx.db.get(messageId);
    if (!msg) return null;
    return {
      _id: msg._id,
      leadId: msg.leadId,
      validationStatus: msg.validationStatus,
      finalContent: msg.finalContent,
      suggestedReply: msg.suggestedReply,
      subject: msg.subject,
      channel: msg.channel ?? undefined,
      socialDirectLink: msg.socialDirectLink ?? undefined,
      sequenceId: msg.sequenceId ?? undefined,
      sequenceStep: msg.sequenceStep ?? undefined,
    };
  },
});

/**
 * Read a lead by ID.
 */
export const getLead = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.union(
    v.object({
      _id: v.id("leads"),
      email: v.string(),
      productId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead) return null;
    return {
      _id: lead._id,
      email: lead.email,
      productId: lead.productId,
    };
  },
});

/**
 * Look up a product by slug.
 */
export const getProductBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("products"),
      slug: v.string(),
      name: v.string(),
      senderEmail: v.string(),
      replyToEmail: v.string(),
      templateId: v.string(),
      brandColor: v.string(),
      logoUrl: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { slug }) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!product) return null;
    return {
      _id: product._id,
      slug: product.slug,
      name: product.name,
      senderEmail: product.senderEmail,
      replyToEmail: product.replyToEmail,
      templateId: product.templateId,
      brandColor: product.brandColor,
      logoUrl: product.logoUrl,
    };
  },
});

/**
 * Mark a message as "sent" and record the sentAt timestamp.
 *
 * Enforces the HITL invariant: only messages with validationStatus = "approved"
 * can transition to "sent".
 */
export const markMessageSent = internalMutation({
  args: {
    messageId: v.id("messages"),
    sentAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, sentAt }) => {
    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error(`markMessageSent: message ${messageId} not found.`);
    }

    // HITL invariant: only "approved" messages can become "sent"
    if (message.validationStatus !== "approved") {
      throw new Error(
        `markMessageSent: message ${messageId} has validationStatus "${message.validationStatus}" — must be "approved".`,
      );
    }

    await ctx.db.patch(messageId, {
      validationStatus: "sent",
      sentAt,
      updatedAt: sentAt,
    });

    return null;
  },
});

/**
 * Check if a lead already has an active or completed outreach sequence.
 * Used to avoid creating duplicate sequences when the initial message is sent.
 *
 * Requirements: 9.1
 */
export const hasExistingSequence = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.boolean(),
  handler: async (ctx, { leadId }) => {
    const existing = await ctx.db
      .query("sequences")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(1);

    return existing.length > 0;
  },
});
