import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Agent Analyste.
 *
 * These live in a separate file because analyst.ts uses "use node"
 * (for the Vercel AI SDK), and files with "use node" can only export actions.
 * Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 14.1, 14.3, 14.4
 */

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get recent tracking events for performance analysis.
 * Returns events from the last 7 days by default.
 */
export const getRecentTrackingEvents = internalQuery({
  args: { sinceTimestamp: v.number() },
  returns: v.any(),
  handler: async (ctx, { sinceTimestamp }) => {
    return await ctx.db
      .query("tracking_events")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", sinceTimestamp))
      .take(500);
  },
});

/**
 * Get all sent messages within a time period for correlation with conversions.
 */
export const getSentMessagesInPeriod = internalQuery({
  args: { sinceTimestamp: v.number() },
  returns: v.any(),
  handler: async (ctx, { sinceTimestamp }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_sentAt", (q) => q.gte("sentAt", sinceTimestamp))
      .take(500);
  },
});

/**
 * Get converted leads within a time period for revenue attribution.
 */
export const getConvertedLeadsInPeriod = internalQuery({
  args: { sinceTimestamp: v.number() },
  returns: v.any(),
  handler: async (ctx, { sinceTimestamp }) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "converted"))
      .take(200);
    return leads.filter(
      (l) => l.convertedAt !== undefined && l.convertedAt >= sinceTimestamp,
    );
  },
});

/**
 * Get all messages associated with a specific lead (for multi-touch attribution).
 */
export const getMessagesByLeadId = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(50);
  },
});

/**
 * Get tracking events for a specific message.
 */
export const getTrackingEventsByMessageId = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, { messageId }) => {
    return await ctx.db
      .query("tracking_events")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .take(100);
  },
});

/**
 * Get active prompt configs for performance evaluation.
 */
export const getActivePromptConfigs = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("prompt_configs")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .take(50);
  },
});

/**
 * Get lead counts by status for the weekly report.
 */
export const getLeadCountsByStatus = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const statuses = [
      "pending_qualification",
      "qualified",
      "discarded",
      "hot",
      "pending",
      "converted",
      "archived",
      "churned",
    ] as const;

    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const leads = await ctx.db
        .query("leads")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(1000);
      counts[status] = leads.length;
    }
    return counts;
  },
});

/**
 * Get active products for the report.
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

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Store a weekly report in the analytics table.
 */
export const storeWeeklyReport = internalMutation({
  args: {
    period: v.object({
      start: v.number(),
      end: v.number(),
    }),
    data: v.any(),
  },
  returns: v.id("analytics"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("analytics", {
      type: "weekly_report",
      period: args.period,
      data: args.data,
      createdAt: Date.now(),
    });
  },
});

/**
 * Store attribution data in the analytics table.
 */
export const storeAttributionData = internalMutation({
  args: {
    productId: v.optional(v.string()),
    period: v.object({
      start: v.number(),
      end: v.number(),
    }),
    data: v.any(),
  },
  returns: v.id("analytics"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("analytics", {
      type: "attribution",
      productId: args.productId,
      period: args.period,
      data: args.data,
      createdAt: Date.now(),
    });
  },
});

// ─── A/B Test Evaluation Helpers ─────────────────────────────────────────────

/**
 * Get sent messages that have A/B test versions (both suggestedReply and suggestedReplyB)
 * and were sent at least `minAgeDays` days ago.
 *
 * Groups messages by productId for per-product evaluation.
 * Requirements: 14.2
 */
export const getABTestMessagesForEvaluation = internalQuery({
  args: { cutoffTimestamp: v.number() },
  returns: v.any(),
  handler: async (ctx, { cutoffTimestamp }) => {
    // Get sent messages that have A/B versions and were sent before the cutoff
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_validationStatus", (q) => q.eq("validationStatus", "sent"))
      .take(500);

    // Filter to A/B test messages sent before cutoff
    return messages.filter(
      (msg) =>
        msg.suggestedReply &&
        msg.suggestedReplyB &&
        msg.activeVersion &&
        msg.sentAt &&
        msg.sentAt <= cutoffTimestamp,
    );
  },
});

/**
 * Get the productId for a lead (used to group A/B test results by product).
 */
export const getLeadProductId = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    return lead ? { productId: lead.productId } : null;
  },
});

/**
 * Store A/B test evaluation result in the analytics table.
 * Requirements: 14.2
 */
export const storeABTestResult = internalMutation({
  args: {
    productId: v.optional(v.string()),
    data: v.any(),
  },
  returns: v.id("analytics"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("analytics", {
      type: "ab_test_result",
      productId: args.productId,
      data: args.data,
      createdAt: Date.now(),
    });
  },
});

/**
 * Adopt the winning A/B test version by updating the prompt_config for the product.
 * If version B wins, update the prompt template to incorporate version B's approach.
 * If version A wins, keep the current template (it's already the standard).
 *
 * Requirements: 14.2
 */
export const adoptABTestWinner = internalMutation({
  args: {
    productId: v.string(),
    winningVersion: v.union(v.literal("A"), v.literal("B")),
    winningTemplate: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find the active copywriter prompt config for this product
    const configs = await ctx.db
      .query("prompt_configs")
      .withIndex("by_agentType_productId", (q) =>
        q.eq("agentType", "copywriter").eq("productId", args.productId),
      )
      .take(10);

    const activeConfig = configs.find((c) => c.isActive);
    if (!activeConfig) return null;

    if (args.winningVersion === "B" && args.winningTemplate) {
      // Deactivate the old config
      await ctx.db.patch(activeConfig._id, {
        isActive: false,
        updatedAt: Date.now(),
      });

      // Create a new version with the winning template
      await ctx.db.insert("prompt_configs", {
        agentType: activeConfig.agentType,
        productId: activeConfig.productId,
        promptTemplate: args.winningTemplate,
        version: activeConfig.version + 1,
        isActive: true,
        keywords: activeConfig.keywords,
        uspDescription: activeConfig.uspDescription,
        performanceScore: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      // Version A wins — just update the performance score note
      await ctx.db.patch(activeConfig._id, {
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Update a prompt config's performance score and optionally propose a revision.
 */
export const updatePromptPerformance = internalMutation({
  args: {
    promptConfigId: v.id("prompt_configs"),
    performanceScore: v.number(),
    revisedPromptTemplate: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      performanceScore: args.performanceScore,
      updatedAt: Date.now(),
    };

    if (args.revisedPromptTemplate !== undefined) {
      // Create a new version of the prompt config with the revision
      const existing = await ctx.db.get(args.promptConfigId);
      if (existing) {
        // Deactivate the old version
        await ctx.db.patch(args.promptConfigId, {
          isActive: false,
          performanceScore: args.performanceScore,
          updatedAt: Date.now(),
        });

        // Create the new version
        await ctx.db.insert("prompt_configs", {
          agentType: existing.agentType,
          productId: existing.productId,
          promptTemplate: args.revisedPromptTemplate,
          version: existing.version + 1,
          isActive: true,
          keywords: existing.keywords,
          uspDescription: existing.uspDescription,
          performanceScore: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    } else {
      await ctx.db.patch(args.promptConfigId, updates);
    }

    return null;
  },
});

// ─── Win/Loss Engine Helpers ─────────────────────────────────────────────────
// Requirements: 14.5

/**
 * Get recently converted leads that haven't received a micro-survey yet.
 *
 * A lead is eligible for a micro-survey if:
 * - Status is "converted"
 * - convertedAt is within the lookback window
 * - No message with sequenceStep = -1 (survey marker) exists for this lead
 *
 * Requirements: 14.5
 */
export const getConvertedLeadsForSurvey = internalQuery({
  args: { sinceTimestamp: v.number() },
  returns: v.any(),
  handler: async (ctx, { sinceTimestamp }) => {
    const convertedLeads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "converted"))
      .take(200);

    const eligible = [];
    for (const lead of convertedLeads) {
      if (!lead.convertedAt || lead.convertedAt < sinceTimestamp) continue;

      // Check if a survey message already exists (sequenceStep = -1 is our survey marker)
      const existingMessages = await ctx.db
        .query("messages")
        .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
        .take(50);

      const hasSurvey = existingMessages.some((m) => m.sequenceStep === -1);
      if (!hasSurvey) {
        eligible.push(lead);
      }
    }

    return eligible;
  },
});

/**
 * Get archived leads with rejection data for pattern analysis.
 *
 * Returns archived leads that have messages with reply categories,
 * grouped by product for pattern detection.
 *
 * Requirements: 14.5
 */
export const getArchivedLeadsWithRejections = internalQuery({
  args: { sinceTimestamp: v.number() },
  returns: v.any(),
  handler: async (ctx, { sinceTimestamp }) => {
    const archivedLeads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "archived"))
      .take(300);

    const results = [];
    for (const lead of archivedLeads) {
      if (lead.updatedAt < sinceTimestamp) continue;

      const messages = await ctx.db
        .query("messages")
        .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
        .take(20);

      const rejectionMessages = messages.filter(
        (m) => m.replyCategory && m.replyCategory === "refus",
      );
      const objectionMessages = messages.filter(
        (m) =>
          m.replyCategory &&
          ["trop_cher", "besoin_reflexion", "question_technique"].includes(
            m.replyCategory,
          ),
      );

      if (rejectionMessages.length > 0 || objectionMessages.length > 0) {
        results.push({
          leadId: lead._id,
          email: lead.email,
          productId: lead.productId,
          source: lead.source,
          detectionChannel: lead.detectionChannel,
          score: lead.score,
          rejections: rejectionMessages.map((m) => ({
            category: m.replyCategory,
            content: m.replyContent,
            channel: m.channel,
            sentAt: m.sentAt,
            replyReceivedAt: m.replyReceivedAt,
          })),
          objections: objectionMessages.map((m) => ({
            category: m.replyCategory,
            content: m.replyContent,
            channel: m.channel,
            sentAt: m.sentAt,
            replyReceivedAt: m.replyReceivedAt,
          })),
        });
      }
    }

    return results;
  },
});

/**
 * Insert a micro-survey message for a converted lead.
 * Uses sequenceStep = -1 as a marker for survey messages.
 *
 * Requirements: 14.5
 */
export const insertSurveyMessage = internalMutation({
  args: {
    leadId: v.id("leads"),
    suggestedReply: v.string(),
    subject: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      leadId: args.leadId,
      suggestedReply: args.suggestedReply,
      subject: args.subject,
      tone: "support",
      sequenceStep: -1, // Survey marker
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Trigger Channel Router for brand identity and delivery channel
    await ctx.scheduler.runAfter(
      0,
      internal.router.channelRouter.routeMessage,
      { messageId },
    );

    return messageId;
  },
});

/**
 * Store win/loss analysis results in the analytics table.
 *
 * Requirements: 14.5
 */
export const storeWinLossAnalysis = internalMutation({
  args: {
    productId: v.optional(v.string()),
    period: v.object({
      start: v.number(),
      end: v.number(),
    }),
    data: v.any(),
  },
  returns: v.id("analytics"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("analytics", {
      type: "win_loss",
      productId: args.productId,
      period: args.period,
      data: args.data,
      createdAt: Date.now(),
    });
  },
});

/**
 * Enrich a prompt config with win/loss insights by appending context
 * to the prompt template. Creates a new version of the config.
 *
 * Requirements: 14.5
 */
export const enrichPromptWithWinLossInsights = internalMutation({
  args: {
    agentType: v.union(v.literal("qualifier"), v.literal("copywriter")),
    productId: v.optional(v.string()),
    insights: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find the active prompt config for this agent type and product
    const configs = await ctx.db
      .query("prompt_configs")
      .withIndex("by_agentType_productId", (q) =>
        q.eq("agentType", args.agentType).eq("productId", args.productId),
      )
      .take(10);

    const activeConfig = configs.find((c) => c.isActive);
    if (!activeConfig) return null;

    // Check if insights are already embedded (avoid duplicate enrichment)
    if (activeConfig.promptTemplate.includes("[WIN/LOSS INSIGHTS]")) {
      // Replace existing insights section
      const beforeInsights = activeConfig.promptTemplate.split(
        "[WIN/LOSS INSIGHTS]",
      )[0];
      const afterInsights = activeConfig.promptTemplate.includes(
        "[/WIN/LOSS INSIGHTS]",
      )
        ? activeConfig.promptTemplate.split("[/WIN/LOSS INSIGHTS]")[1] ?? ""
        : "";

      const updatedTemplate = `${beforeInsights}[WIN/LOSS INSIGHTS]\n${args.insights}\n[/WIN/LOSS INSIGHTS]${afterInsights}`;

      await ctx.db.patch(activeConfig._id, {
        promptTemplate: updatedTemplate,
        updatedAt: Date.now(),
      });
    } else {
      // Append insights section to the existing template
      const updatedTemplate = `${activeConfig.promptTemplate}\n\n[WIN/LOSS INSIGHTS]\n${args.insights}\n[/WIN/LOSS INSIGHTS]`;

      await ctx.db.patch(activeConfig._id, {
        promptTemplate: updatedTemplate,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});
