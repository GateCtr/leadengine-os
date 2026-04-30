import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Agent Objecteur.
 *
 * These live in a separate file because objector.ts uses "use node"
 * (for the Vercel AI SDK), and files with "use node" can only export actions.
 * Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

/**
 * Read a message by ID for reply analysis. Returns null if not found.
 */
export const getMessageForAnalysis = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, { messageId }) => {
    return await ctx.db.get(messageId);
  },
});

/**
 * Read a lead by ID. Returns null if not found.
 */
export const getLeadById = internalQuery({
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
 * Get the active prompt_config for the objector agent and a specific product.
 * Falls back to a product-agnostic objector config if no product-specific one exists.
 * Returns null if no config found.
 */
export const getObjectorPromptConfig = internalQuery({
  args: { productId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { productId }) => {
    if (productId) {
      const productConfig = await ctx.db
        .query("prompt_configs")
        .withIndex("by_agentType_productId", (q) =>
          q.eq("agentType", "objector").eq("productId", productId),
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();

      if (productConfig) {
        return productConfig;
      }
    }

    const genericConfig = await ctx.db
      .query("prompt_configs")
      .withIndex("by_agentType", (q) => q.eq("agentType", "objector"))
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
 * Update the message with reply analysis results (category) and
 * update the lead status based on the category.
 *
 * - interet_confirme → lead status "hot"
 * - refus → lead status "archived"
 * - trop_cher, besoin_reflexion, question_technique → lead status "pending"
 */
export const updateReplyAnalysis = internalMutation({
  args: {
    messageId: v.id("messages"),
    leadId: v.id("leads"),
    replyCategory: v.union(
      v.literal("trop_cher"),
      v.literal("besoin_reflexion"),
      v.literal("question_technique"),
      v.literal("interet_confirme"),
      v.literal("refus"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, leadId, replyCategory }) => {
    const now = Date.now();

    // Update message with reply category
    await ctx.db.patch(messageId, {
      replyCategory,
      updatedAt: now,
    });

    // Determine new lead status based on category
    let newStatus: "hot" | "archived" | "pending";
    if (replyCategory === "interet_confirme") {
      newStatus = "hot";
    } else if (replyCategory === "refus") {
      newStatus = "archived";
    } else {
      newStatus = "pending";
    }

    await ctx.db.patch(leadId, {
      status: newStatus,
      updatedAt: now,
    });

    return null;
  },
});

/**
 * Insert a counter-response message for HITL validation.
 * The counter-response is stored as a new message linked to the same lead,
 * with validationStatus "draft". It then triggers the Channel Router pipeline.
 *
 * Requirements: 10.5, 10.6
 */
export const insertCounterResponse = internalMutation({
  args: {
    leadId: v.id("leads"),
    suggestedReply: v.string(),
    subject: v.optional(v.string()),
    tone: v.union(v.literal("expert"), v.literal("support"), v.literal("tech")),
    contextualLink: v.optional(v.string()),
    originalMessageId: v.id("messages"),
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
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Schedule the Channel Router to determine delivery channel and brand identity
    // This starts the HITL pipeline: Channel Router → Timing → Dashboard validation
    await ctx.scheduler.runAfter(
      0,
      internal.router.channelRouter.routeMessage,
      { messageId },
    );

    return messageId;
  },
});
