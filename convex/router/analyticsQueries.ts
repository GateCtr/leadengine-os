import { v } from "convex/values";
import { query } from "../_generated/server";

/**
 * Analytics Queries — Fetch analytics data for the Dashboard Analytics page.
 *
 * Requirements: 14.4, 20.2
 */

const leadStatusValidator = v.union(
  v.literal("pending_qualification"),
  v.literal("qualified"),
  v.literal("discarded"),
  v.literal("hot"),
  v.literal("pending"),
  v.literal("converted"),
  v.literal("archived"),
  v.literal("churned"),
);

/**
 * getPipelineCounts — Count leads per pipeline stage (real-time).
 */
export const getPipelineCounts = query({
  args: {},
  returns: v.array(
    v.object({
      status: leadStatusValidator,
      count: v.number(),
    }),
  ),
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

    const counts = await Promise.all(
      statuses.map(async (status) => {
        const leads = await ctx.db
          .query("leads")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect();
        return { status, count: leads.length };
      }),
    );

    return counts;
  },
});

/**
 * getRevenueByProduct — Revenue generated per product.
 */
export const getRevenueByProduct = query({
  args: {},
  returns: v.array(
    v.object({
      productId: v.string(),
      productName: v.string(),
      brandColor: v.string(),
      totalRevenue: v.number(),
      convertedCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    const results = await Promise.all(
      products.map(async (product) => {
        const convertedLeads = await ctx.db
          .query("leads")
          .withIndex("by_productId", (q) => q.eq("productId", product.slug))
          .collect();

        const converted = convertedLeads.filter(
          (l) => l.status === "converted" && l.revenueGenerated,
        );
        const totalRevenue = converted.reduce(
          (sum, l) => sum + (l.revenueGenerated ?? 0),
          0,
        );

        return {
          productId: product.slug,
          productName: product.name,
          brandColor: product.brandColor,
          totalRevenue,
          convertedCount: converted.length,
        };
      }),
    );

    return results;
  },
});

/**
 * getConversionRate — Overall conversion rate (converted / total qualified).
 */
export const getConversionRate = query({
  args: {},
  returns: v.object({
    totalQualified: v.number(),
    totalConverted: v.number(),
    conversionRate: v.number(),
  }),
  handler: async (ctx) => {
    const qualified = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "qualified"))
      .collect();
    const hot = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "hot"))
      .collect();
    const converted = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "converted"))
      .collect();

    const totalQualified = qualified.length + hot.length + converted.length;
    const totalConverted = converted.length;
    const conversionRate =
      totalQualified > 0 ? (totalConverted / totalQualified) * 100 : 0;

    return {
      totalQualified,
      totalConverted,
      conversionRate: Math.round(conversionRate * 10) / 10,
    };
  },
});

/**
 * getWeeklyReports — Fetch the latest weekly reports from the Agent Analyste.
 */
export const getWeeklyReports = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("analytics"),
      _creationTime: v.number(),
      type: v.literal("weekly_report"),
      productId: v.optional(v.string()),
      period: v.optional(
        v.object({
          start: v.number(),
          end: v.number(),
        }),
      ),
      data: v.any(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const reports = await ctx.db
      .query("analytics")
      .withIndex("by_type_createdAt", (q) => q.eq("type", "weekly_report"))
      .order("desc")
      .take(10);

    return reports.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      type: r.type as "weekly_report",
      productId: r.productId,
      period: r.period,
      data: r.data,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * getABTestResults — Fetch A/B test results (active and completed).
 */
export const getABTestResults = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("analytics"),
      _creationTime: v.number(),
      type: v.literal("ab_test_result"),
      productId: v.optional(v.string()),
      data: v.any(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const results = await ctx.db
      .query("analytics")
      .withIndex("by_type_createdAt", (q) => q.eq("type", "ab_test_result"))
      .order("desc")
      .take(20);

    return results.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      type: r.type as "ab_test_result",
      productId: r.productId,
      data: r.data,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * getAgentErrorRates — Observability: error rates per agent type.
 */
export const getAgentErrorRates = query({
  args: {},
  returns: v.array(
    v.object({
      agentType: v.string(),
      totalLogs: v.number(),
      errorCount: v.number(),
      warnCount: v.number(),
      errorRate: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const agentTypes = [
      "radar",
      "qualifier",
      "copywriter",
      "objector",
      "timing",
      "analyst",
      "channel_router",
      "sequence_engine",
      "churn_detector",
      "upsell_engine",
    ] as const;

    const results = await Promise.all(
      agentTypes.map(async (agentType) => {
        const allLogs = await ctx.db
          .query("agent_logs")
          .withIndex("by_agentType", (q) => q.eq("agentType", agentType))
          .take(500);

        const errorCount = allLogs.filter((l) => l.level === "error").length;
        const warnCount = allLogs.filter((l) => l.level === "warn").length;
        const totalLogs = allLogs.length;
        const errorRate =
          totalLogs > 0 ? (errorCount / totalLogs) * 100 : 0;

        return {
          agentType,
          totalLogs,
          errorCount,
          warnCount,
          errorRate: Math.round(errorRate * 10) / 10,
        };
      }),
    );

    return results;
  },
});

/**
 * getLeadsByStage — Fetch leads for a specific pipeline stage with stuck indicator.
 * A lead is considered "stuck" if it has been in the same stage for more than 24 hours.
 *
 * Requirements: 20.2
 */
export const getLeadsByStage = query({
  args: {
    status: leadStatusValidator,
  },
  returns: v.array(
    v.object({
      _id: v.id("leads"),
      name: v.optional(v.string()),
      email: v.string(),
      score: v.optional(v.number()),
      productId: v.optional(v.string()),
      updatedAt: v.number(),
      stuckSinceHours: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .take(50);

    const now = Date.now();

    return leads.map((lead) => ({
      _id: lead._id,
      name: lead.name,
      email: lead.email,
      score: lead.score,
      productId: lead.productId,
      updatedAt: lead.updatedAt,
      stuckSinceHours: Math.floor((now - lead.updatedAt) / (1000 * 60 * 60)),
    }));
  },
});

/**
 * getErroredWebhookEvents — Fetch unprocessed webhook events that have errors.
 *
 * Requirements: 20.2
 */
export const getErroredWebhookEvents = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("webhook_events"),
      source: v.string(),
      eventType: v.string(),
      error: v.optional(v.string()),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const unprocessed = await ctx.db
      .query("webhook_events")
      .withIndex("by_processed", (q) => q.eq("processed", false))
      .order("desc")
      .take(50);

    const errored = unprocessed.filter((e) => e.error);

    return errored.map((e) => ({
      _id: e._id,
      source: e.source,
      eventType: e.eventType,
      error: e.error,
      receivedAt: e.receivedAt,
    }));
  },
});

/**
 * getValidationQueueStats — Observability: pending validation queue size and age.
 */
export const getValidationQueueStats = query({
  args: {},
  returns: v.object({
    pendingCount: v.number(),
    oldestPendingAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("messages")
      .withIndex("by_validationStatus", (q) =>
        q.eq("validationStatus", "pending_validation"),
      )
      .collect();

    let oldestPendingAt: number | undefined;
    if (pending.length > 0) {
      oldestPendingAt = Math.min(...pending.map((m) => m.createdAt));
    }

    return {
      pendingCount: pending.length,
      oldestPendingAt,
    };
  },
});

/**
 * getRecentAgentLogs — Fetch recent error and warning logs with full messages.
 * Returns the 50 most recent error/warn logs across all agents.
 *
 * Requirements: 20.2
 */
export const getRecentAgentLogs = query({
  args: {
    level: v.optional(v.union(v.literal("error"), v.literal("warn"), v.literal("info"))),
  },
  returns: v.array(
    v.object({
      _id: v.id("agent_logs"),
      agentType: v.string(),
      level: v.string(),
      message: v.string(),
      timestamp: v.number(),
      leadId: v.optional(v.id("leads")),
      messageId: v.optional(v.id("messages")),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.level) {
      const logs = await ctx.db
        .query("agent_logs")
        .withIndex("by_level", (q) => q.eq("level", args.level!))
        .order("desc")
        .take(50);
      return logs.map((l) => ({
        _id: l._id,
        agentType: l.agentType,
        level: l.level,
        message: l.message,
        timestamp: l.timestamp,
        leadId: l.leadId,
        messageId: l.messageId,
      }));
    }

    // Default: errors + warnings only
    const errors = await ctx.db
      .query("agent_logs")
      .withIndex("by_level", (q) => q.eq("level", "error"))
      .order("desc")
      .take(30);
    const warns = await ctx.db
      .query("agent_logs")
      .withIndex("by_level", (q) => q.eq("level", "warn"))
      .order("desc")
      .take(20);

    const combined = [...errors, ...warns]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);

    return combined.map((l) => ({
      _id: l._id,
      agentType: l.agentType,
      level: l.level,
      message: l.message,
      timestamp: l.timestamp,
      leadId: l.leadId,
      messageId: l.messageId,
    }));
  },
});
