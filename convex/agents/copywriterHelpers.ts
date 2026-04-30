import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Agent Copywriter.
 *
 * These live in a separate file because copywriter.ts uses "use node"
 * (for the Vercel AI SDK), and files with "use node" can only export actions.
 * Queries and mutations must be in a non-"use node" file.
 */

/**
 * Read a lead by ID for message composition. Returns null if not found.
 */
export const getLeadForComposition = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    return await ctx.db.get(leadId);
  },
});

/**
 * Get the product config by slug from the products table.
 * Returns null if not found.
 */
export const getProductBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
  },
});

/**
 * Get the active prompt_config for the copywriter agent and a specific product.
 * Falls back to a product-agnostic copywriter config if no product-specific one exists.
 * Returns null if no config found.
 */
export const getCopywriterPromptConfig = internalQuery({
  args: { productId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { productId }) => {
    // Try product-specific config first
    if (productId) {
      const productConfig = await ctx.db
        .query("prompt_configs")
        .withIndex("by_agentType_productId", (q) =>
          q.eq("agentType", "copywriter").eq("productId", productId),
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();

      if (productConfig) {
        return productConfig;
      }
    }

    // Fall back to generic copywriter config (no productId)
    const genericConfig = await ctx.db
      .query("prompt_configs")
      .withIndex("by_agentType", (q) => q.eq("agentType", "copywriter"))
      .filter((q) =>
        q.and(
          q.eq(q.field("isActive"), true),
          q.eq(q.field("productId"), undefined),
        ),
      )
      .first();

    return genericConfig;
  },
});

/**
 * Get validated testimonials for a specific product.
 * Returns up to 5 validated testimonials for social proof injection.
 */
export const getValidatedTestimonials = internalQuery({
  args: { productId: v.string() },
  returns: v.any(),
  handler: async (ctx, { productId }) => {
    return await ctx.db
      .query("testimonials")
      .withIndex("by_productId_isValidated", (q) =>
        q.eq("productId", productId).eq("isValidated", true),
      )
      .take(5);
  },
});

/**
 * Check if a lead already has a message (to avoid duplicate composition).
 */
export const getExistingMessageForLead = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .first();
  },
});

/**
 * Insert a new message into the messages table with validationStatus "draft".
 */
export const insertMessage = internalMutation({
  args: {
    leadId: v.id("leads"),
    suggestedReply: v.string(),
    suggestedReplyB: v.optional(v.string()),
    activeVersion: v.optional(v.union(v.literal("A"), v.literal("B"))),
    subject: v.optional(v.string()),
    tone: v.union(v.literal("expert"), v.literal("support"), v.literal("tech")),
    socialProofUsed: v.optional(v.string()),
    contextualLink: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      leadId: args.leadId,
      suggestedReply: args.suggestedReply,
      suggestedReplyB: args.suggestedReplyB,
      activeVersion: args.activeVersion,
      subject: args.subject,
      tone: args.tone,
      socialProofUsed: args.socialProofUsed,
      contextualLink: args.contextualLink,
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // When a message is composed without a channel assigned, schedule the
    // Channel Router to determine the delivery channel and brand identity.
    // (Requirement 6.1)
    await ctx.scheduler.runAfter(
      0,
      internal.router.channelRouter.routeMessage,
      { messageId },
    );

    return messageId;
  },
});

/**
 * Mark a lead for reprocessing by keeping it in qualified status.
 * This is a no-op if the lead is already qualified — the lead stays
 * available for the next copywriter trigger cycle.
 */
export const markLeadForReprocessing = internalMutation({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    await ctx.db.patch(leadId, {
      updatedAt: Date.now(),
    });
    return null;
  },
});
