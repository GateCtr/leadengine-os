"use node";

/**
 * Agent Analyste — Optimisation Continue
 *
 * Correlates messages with Stripe conversions via multi-touch attribution,
 * proposes prompt revisions when performance is insufficient, and generates
 * weekly summary reports stored in the analytics table.
 *
 * This file uses "use node" because it depends on the Vercel AI SDK which
 * requires Node.js. It can ONLY export actions (internalAction).
 * Queries and mutations are in analystHelpers.ts.
 *
 * Requirements: 14.1, 14.3, 14.4
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// ─── Constants ───────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const PERFORMANCE_THRESHOLD = 30; // Below this score, prompt revision is proposed

// ─── Multi-touch Attribution ─────────────────────────────────────────────────

/**
 * Touchpoint representing a message interaction in the conversion path.
 */
interface Touchpoint {
  messageId: string;
  channel: string | undefined;
  sentAt: number | undefined;
  events: Array<{ type: string; timestamp: number }>;
}

/**
 * Attribution result for a single touchpoint.
 */
export interface TouchpointAttribution {
  messageId: string;
  channel: string | undefined;
  percentage: number;
}

/**
 * Compute multi-touch attribution using a position-based (U-shaped) model.
 *
 * - First touch: 40%
 * - Last touch: 40%
 * - Middle touches: split remaining 20% equally
 * - Single touch: 100%
 * - Two touches: 50% each
 *
 * Guarantees:
 * - Each percentage >= 0
 * - Sum of all percentages = 100
 *
 * Requirements: 14.1 (Property 18)
 */
export function computeMultiTouchAttribution(
  touchpoints: Touchpoint[],
): TouchpointAttribution[] {
  if (touchpoints.length === 0) {
    return [];
  }

  // Sort by earliest event timestamp (or sentAt as fallback)
  const sorted = [...touchpoints].sort((a, b) => {
    const aTime =
      a.events.length > 0
        ? Math.min(...a.events.map((e) => e.timestamp))
        : (a.sentAt ?? 0);
    const bTime =
      b.events.length > 0
        ? Math.min(...b.events.map((e) => e.timestamp))
        : (b.sentAt ?? 0);
    return aTime - bTime;
  });

  if (sorted.length === 1) {
    return [
      {
        messageId: sorted[0].messageId,
        channel: sorted[0].channel,
        percentage: 100,
      },
    ];
  }

  if (sorted.length === 2) {
    return sorted.map((tp) => ({
      messageId: tp.messageId,
      channel: tp.channel,
      percentage: 50,
    }));
  }

  // U-shaped: 40% first, 40% last, 20% split among middle
  const middleCount = sorted.length - 2;
  const middleShare = 20 / middleCount;

  // Use integer math to avoid floating point drift, then adjust remainder
  const middleShareRounded = Math.floor(middleShare * 100) / 100;
  const middleTotal = middleShareRounded * middleCount;
  const remainder = 20 - middleTotal;

  return sorted.map((tp, index) => {
    let percentage: number;
    if (index === 0) {
      percentage = 40 + remainder / 2;
    } else if (index === sorted.length - 1) {
      percentage = 40 + remainder / 2;
    } else {
      percentage = middleShareRounded;
    }
    return {
      messageId: tp.messageId,
      channel: tp.channel,
      percentage: Math.round(percentage * 100) / 100,
    };
  });
}

// ─── Performance Scoring ─────────────────────────────────────────────────────

/**
 * Calculate a performance score for a prompt config based on message outcomes.
 * Score is 0-100 based on open rate, click rate, reply rate, and conversion rate.
 */
export function calculatePromptPerformanceScore(metrics: {
  totalMessages: number;
  opens: number;
  clicks: number;
  replies: number;
  conversions: number;
}): number {
  if (metrics.totalMessages === 0) return 0;

  const openRate = metrics.opens / metrics.totalMessages;
  const clickRate = metrics.clicks / metrics.totalMessages;
  const replyRate = metrics.replies / metrics.totalMessages;
  const conversionRate = metrics.conversions / metrics.totalMessages;

  // Weighted score: open 20%, click 25%, reply 30%, conversion 25%
  const score =
    openRate * 20 + clickRate * 25 + replyRate * 30 + conversionRate * 25;

  return Math.round(Math.min(100, score) * 100) / 100;
}

// ─── Zod schema for LLM prompt revision ──────────────────────────────────────

const PromptRevisionSchema = z.object({
  revisedPrompt: z
    .string()
    .describe("The revised prompt template with improvements"),
  reasoning: z
    .string()
    .describe("Explanation of what was changed and why"),
  expectedImprovement: z
    .string()
    .describe("Expected improvement from this revision"),
});

// ─── Main Action: Analyze Performance ────────────────────────────────────────

/**
 * Analyze performance of the messaging pipeline.
 *
 * Pipeline:
 * 1. Load recent tracking events (last 7 days)
 * 2. Correlate messages → conversions Stripe via multi-touch attribution
 * 3. Evaluate prompt performance and propose revisions if insufficient
 * 4. Generate weekly summary report stored in analytics
 *
 * Requirements: 14.1, 14.3, 14.4
 */
export const analyzePerformance = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - SEVEN_DAYS_MS;

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "analyst",
      level: "info",
      message: "Starting weekly performance analysis.",
    });

    try {
      // 1. Load recent tracking events
      const trackingEvents = await ctx.runQuery(
        internal.agents.analystHelpers.getRecentTrackingEvents,
        { sinceTimestamp: weekAgo },
      );

      // 2. Load sent messages in the period
      const sentMessages = await ctx.runQuery(
        internal.agents.analystHelpers.getSentMessagesInPeriod,
        { sinceTimestamp: weekAgo },
      );

      // 3. Load converted leads in the period
      const convertedLeads = await ctx.runQuery(
        internal.agents.analystHelpers.getConvertedLeadsInPeriod,
        { sinceTimestamp: weekAgo },
      );

      // 4. Load active products
      const products = await ctx.runQuery(
        internal.agents.analystHelpers.getActiveProducts,
      );

      // 5. Load lead counts by status for the report
      const leadCounts = await ctx.runQuery(
        internal.agents.analystHelpers.getLeadCountsByStatus,
      );

      // ── Multi-touch attribution for each converted lead ──

      const attributionResults: Array<{
        leadId: string;
        revenue: number;
        productId: string | undefined;
        touchpoints: TouchpointAttribution[];
      }> = [];

      for (const lead of convertedLeads) {
        const leadMessages = await ctx.runQuery(
          internal.agents.analystHelpers.getMessagesByLeadId,
          { leadId: lead._id as Id<"leads"> },
        );

        // Build touchpoints from messages that were actually sent
        const touchpoints: Touchpoint[] = [];
        for (const msg of leadMessages) {
          if (!msg.sentAt) continue;

          const msgEvents = await ctx.runQuery(
            internal.agents.analystHelpers.getTrackingEventsByMessageId,
            { messageId: msg._id as Id<"messages"> },
          );

          touchpoints.push({
            messageId: msg._id,
            channel: msg.channel ?? undefined,
            sentAt: msg.sentAt,
            events: msgEvents.map(
              (e: { type: string; timestamp: number }) => ({
                type: e.type,
                timestamp: e.timestamp,
              }),
            ),
          });
        }

        const attribution = computeMultiTouchAttribution(touchpoints);
        attributionResults.push({
          leadId: lead._id,
          revenue: lead.revenueGenerated ?? 0,
          productId: lead.productId ?? undefined,
          touchpoints: attribution,
        });
      }

      // Store attribution data
      if (attributionResults.length > 0) {
        await ctx.runMutation(
          internal.agents.analystHelpers.storeAttributionData,
          {
            period: { start: weekAgo, end: now },
            data: { attributions: attributionResults },
          },
        );
      }

      // ── Evaluate prompt performance ──

      const promptConfigs = await ctx.runQuery(
        internal.agents.analystHelpers.getActivePromptConfigs,
      );

      // Group messages by product to evaluate per-product performance
      const messagesByProduct: Record<
        string,
        Array<{
          _id: string;
          opened?: boolean;
          clicked?: boolean;
          replyContent?: string;
          leadId: string;
        }>
      > = {};

      for (const msg of sentMessages) {
        // Find the lead's productId for this message
        const lead = convertedLeads.find(
          (l: { _id: string }) => l._id === msg.leadId,
        );
        const productId = lead?.productId ?? "unknown";
        if (!messagesByProduct[productId]) {
          messagesByProduct[productId] = [];
        }
        messagesByProduct[productId].push(msg);
      }

      // Calculate performance for each prompt config
      const promptPerformanceUpdates: Array<{
        promptConfigId: string;
        performanceScore: number;
        agentType: string;
        productId: string | undefined;
      }> = [];

      for (const config of promptConfigs) {
        const productMessages =
          messagesByProduct[config.productId ?? "unknown"] ?? [];

        // Count events for messages associated with this product
        let opens = 0;
        let clicks = 0;
        let replies = 0;
        let conversions = 0;

        for (const msg of productMessages) {
          if (msg.opened) opens++;
          if (msg.clicked) clicks++;
          if (msg.replyContent) replies++;
        }

        // Count conversions from attribution results for this product
        for (const attr of attributionResults) {
          if (attr.productId === config.productId) {
            conversions++;
          }
        }

        const perfScore = calculatePromptPerformanceScore({
          totalMessages: productMessages.length,
          opens,
          clicks,
          replies,
          conversions,
        });

        promptPerformanceUpdates.push({
          promptConfigId: config._id,
          performanceScore: perfScore,
          agentType: config.agentType,
          productId: config.productId ?? undefined,
        });

        // Update the performance score in the prompt config
        await ctx.runMutation(
          internal.agents.analystHelpers.updatePromptPerformance,
          {
            promptConfigId: config._id as Id<"prompt_configs">,
            performanceScore: perfScore,
          },
        );
      }

      // ── Propose prompt revisions for underperforming configs ──

      const underperformingConfigs = promptPerformanceUpdates.filter(
        (p) => p.performanceScore < PERFORMANCE_THRESHOLD && p.performanceScore > 0,
      );

      for (const config of underperformingConfigs) {
        const originalConfig = promptConfigs.find(
          (c: { _id: string }) => c._id === config.promptConfigId,
        );
        if (!originalConfig) continue;

        try {
          const { output: revision } = await generateText({
            model: anthropic("claude-sonnet-4-20250514"),
            output: Output.object({
              schema: PromptRevisionSchema,
            }),
            system: `You are a prompt optimization specialist for LeadEngine OS. Your job is to improve underperforming prompts used by AI agents in a lead generation pipeline.

The prompt you are revising is used by the "${config.agentType}" agent${config.productId ? ` for the product "${config.productId}"` : ""}.

Current performance score: ${config.performanceScore}/100 (threshold: ${PERFORMANCE_THRESHOLD}).

Improve the prompt to increase engagement rates (opens, clicks, replies) and conversion rates. Keep the same structure and intent but make it more effective.`,
            prompt: `Here is the current prompt template that needs improvement:

---
${originalConfig.promptTemplate}
---

Provide a revised version that should perform better. Explain your changes.`,
          });

          if (revision) {
            await ctx.runMutation(
              internal.agents.analystHelpers.updatePromptPerformance,
              {
                promptConfigId: config.promptConfigId as Id<"prompt_configs">,
                performanceScore: config.performanceScore,
                revisedPromptTemplate: revision.revisedPrompt,
              },
            );

            await ctx.runMutation(internal.logs.createLog, {
              agentType: "analyst",
              level: "info",
              message: `Prompt revision proposed for ${config.agentType}${config.productId ? ` (${config.productId})` : ""}: ${revision.reasoning}`,
              metadata: {
                expectedImprovement: revision.expectedImprovement,
                previousScore: config.performanceScore,
              },
            });
          }
        } catch (llmError) {
          await ctx.runMutation(internal.logs.createLog, {
            agentType: "analyst",
            level: "warn",
            message: `Failed to generate prompt revision for ${config.agentType}: ${
              llmError instanceof Error
                ? llmError.message
                : String(llmError)
            }`,
            metadata: {
              promptConfigId: config.promptConfigId,
            },
          });
        }
      }

      // ── Generate weekly summary report ──

      // Aggregate tracking event counts by type
      const eventCounts: Record<string, number> = {};
      for (const event of trackingEvents) {
        eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      }

      // Revenue by product
      const revenueByProduct: Record<string, number> = {};
      for (const attr of attributionResults) {
        const pid = attr.productId ?? "unknown";
        revenueByProduct[pid] =
          (revenueByProduct[pid] ?? 0) + attr.revenue;
      }

      const weeklyReport = {
        period: { start: weekAgo, end: now },
        summary: {
          totalMessagesSent: sentMessages.length,
          totalConversions: convertedLeads.length,
          totalRevenue: convertedLeads.reduce(
            (sum: number, l: { revenueGenerated?: number }) =>
              sum + (l.revenueGenerated ?? 0),
            0,
          ),
          trackingEvents: eventCounts,
          revenueByProduct,
        },
        pipeline: leadCounts,
        attribution: {
          totalAttributedConversions: attributionResults.length,
          attributions: attributionResults.map((a) => ({
            leadId: a.leadId,
            revenue: a.revenue,
            productId: a.productId,
            touchpointCount: a.touchpoints.length,
          })),
        },
        promptPerformance: promptPerformanceUpdates.map((p) => ({
          agentType: p.agentType,
          productId: p.productId,
          score: p.performanceScore,
          needsRevision: p.performanceScore < PERFORMANCE_THRESHOLD,
        })),
        productsActive: products.length,
      };

      // Store the weekly report
      await ctx.runMutation(
        internal.agents.analystHelpers.storeWeeklyReport,
        {
          period: { start: weekAgo, end: now },
          data: weeklyReport,
        },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "info",
        message: `Weekly report generated: ${sentMessages.length} messages sent, ${convertedLeads.length} conversions, $${weeklyReport.summary.totalRevenue} revenue.`,
        metadata: {
          messagesSent: sentMessages.length,
          conversions: convertedLeads.length,
          revenue: weeklyReport.summary.totalRevenue,
        },
      });

      // Trigger weekly report notification (Requirement 14.4, 16.6)
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "weekly_report",
          priority: "info",
          title: "Rapport hebdomadaire LeadEngine OS",
          body: `${sentMessages.length} messages envoyés, ${convertedLeads.length} conversions, ${weeklyReport.summary.totalRevenue}€ de revenu cette semaine.`,
        },
      );
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "error",
        message: `Performance analysis failed: ${
          error instanceof Error ? error.message : String(error)
        }. Will retry at next scheduled cycle.`,
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
      });
    }

    return null;
  },
});

// ─── A/B Test Metrics Evaluation ─────────────────────────────────────────────

/**
 * Metrics for one version of an A/B test.
 */
export interface ABVersionMetrics {
  totalMessages: number;
  opens: number;
  clicks: number;
  replies: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  combinedScore: number;
}

/**
 * Result of an A/B test evaluation for a single product.
 */
export interface ABTestEvaluationResult {
  productId: string;
  versionA: ABVersionMetrics;
  versionB: ABVersionMetrics;
  winner: "A" | "B";
  scoreDifference: number;
}

/**
 * Compute metrics for a set of messages belonging to one A/B version.
 *
 * Combined score uses weighted rates:
 * open 30%, click 35%, reply 35%.
 *
 * Requirements: 14.2 (Property 19)
 */
export function computeABVersionMetrics(
  messages: Array<{
    opened?: boolean;
    clicked?: boolean;
    replyContent?: string;
  }>,
): ABVersionMetrics {
  const total = messages.length;
  if (total === 0) {
    return {
      totalMessages: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0,
      combinedScore: 0,
    };
  }

  let opens = 0;
  let clicks = 0;
  let replies = 0;

  for (const msg of messages) {
    if (msg.opened) opens++;
    if (msg.clicked) clicks++;
    if (msg.replyContent) replies++;
  }

  const openRate = opens / total;
  const clickRate = clicks / total;
  const replyRate = replies / total;

  // Combined score: open 30%, click 35%, reply 35%
  const combinedScore =
    Math.round((openRate * 30 + clickRate * 35 + replyRate * 35) * 100) / 100;

  return {
    totalMessages: total,
    opens,
    clicks,
    replies,
    openRate: Math.round(openRate * 10000) / 10000,
    clickRate: Math.round(clickRate * 10000) / 10000,
    replyRate: Math.round(replyRate * 10000) / 10000,
    combinedScore,
  };
}

/**
 * Evaluate A/B test results for a set of messages grouped by version.
 *
 * Selects the version with the higher combined score as the winner.
 * If scores are equal, version A wins (incumbent advantage).
 *
 * Requirements: 14.2 (Property 19)
 */
export function evaluateABTest(
  productId: string,
  versionAMessages: Array<{
    opened?: boolean;
    clicked?: boolean;
    replyContent?: string;
  }>,
  versionBMessages: Array<{
    opened?: boolean;
    clicked?: boolean;
    replyContent?: string;
  }>,
): ABTestEvaluationResult {
  const metricsA = computeABVersionMetrics(versionAMessages);
  const metricsB = computeABVersionMetrics(versionBMessages);

  // Version with higher combined score wins; ties go to A (incumbent)
  const winner: "A" | "B" =
    metricsB.combinedScore > metricsA.combinedScore ? "B" : "A";

  return {
    productId,
    versionA: metricsA,
    versionB: metricsB,
    winner,
    scoreDifference: Math.abs(metricsA.combinedScore - metricsB.combinedScore),
  };
}

// ─── Main Action: A/B Test Evaluation ────────────────────────────────────────

/**
 * Evaluate A/B tests that have been running for at least 14 days.
 *
 * Pipeline:
 * 1. Load all sent messages with A/B versions sent ≥ 14 days ago
 * 2. Group messages by product and version (A vs B)
 * 3. Compare open, click, and reply rates between versions
 * 4. Adopt the winning version as standard
 * 5. Update prompt_configs with the winning version
 * 6. Store A/B test results in analytics
 *
 * Requirements: 14.2
 */
export const runABTestEvaluation = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - FOURTEEN_DAYS_MS;

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "analyst",
      level: "info",
      message: "Starting A/B test evaluation for tests active ≥ 14 days.",
    });

    try {
      // 1. Load A/B test messages sent ≥ 14 days ago
      const abMessages = await ctx.runQuery(
        internal.agents.analystHelpers.getABTestMessagesForEvaluation,
        { cutoffTimestamp: cutoff },
      );

      if (abMessages.length === 0) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "info",
          message: "No A/B tests found with ≥ 14 days of data. Skipping evaluation.",
        });
        return null;
      }

      // 2. Group messages by product and resolve productIds
      const messagesByProduct: Record<
        string,
        {
          versionA: Array<{
            opened?: boolean;
            clicked?: boolean;
            replyContent?: string;
          }>;
          versionB: Array<{
            opened?: boolean;
            clicked?: boolean;
            replyContent?: string;
          }>;
          sampleBContent?: string;
        }
      > = {};

      for (const msg of abMessages) {
        // Resolve the product for this message's lead
        const leadInfo = await ctx.runQuery(
          internal.agents.analystHelpers.getLeadProductId,
          { leadId: msg.leadId as Id<"leads"> },
        );

        const productId = leadInfo?.productId ?? "unknown";

        if (!messagesByProduct[productId]) {
          messagesByProduct[productId] = { versionA: [], versionB: [] };
        }

        const msgData = {
          opened: msg.opened,
          clicked: msg.clicked,
          replyContent: msg.replyContent,
        };

        if (msg.activeVersion === "B") {
          messagesByProduct[productId].versionB.push(msgData);
          // Keep a sample of version B content for prompt adoption
          if (!messagesByProduct[productId].sampleBContent && msg.suggestedReplyB) {
            messagesByProduct[productId].sampleBContent = msg.suggestedReplyB;
          }
        } else {
          // Default to version A
          messagesByProduct[productId].versionA.push(msgData);
        }
      }

      // 3. Evaluate each product's A/B test
      let evaluatedCount = 0;

      for (const [productId, data] of Object.entries(messagesByProduct)) {
        // Need at least 1 message per version to evaluate
        if (data.versionA.length === 0 || data.versionB.length === 0) {
          await ctx.runMutation(internal.logs.createLog, {
            agentType: "analyst",
            level: "info",
            message: `A/B test for product "${productId}" skipped: insufficient data (A: ${data.versionA.length}, B: ${data.versionB.length} messages).`,
          });
          continue;
        }

        const result = evaluateABTest(productId, data.versionA, data.versionB);

        // 4. Store A/B test result in analytics
        await ctx.runMutation(
          internal.agents.analystHelpers.storeABTestResult,
          {
            productId: productId !== "unknown" ? productId : undefined,
            data: {
              evaluatedAt: now,
              productId,
              versionA: result.versionA,
              versionB: result.versionB,
              winner: result.winner,
              scoreDifference: result.scoreDifference,
            },
          },
        );

        // 5. Adopt the winning version
        if (productId !== "unknown") {
          await ctx.runMutation(
            internal.agents.analystHelpers.adoptABTestWinner,
            {
              productId,
              winningVersion: result.winner,
              winningTemplate:
                result.winner === "B" ? data.sampleBContent : undefined,
            },
          );
        }

        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "info",
          message: `A/B test evaluated for product "${productId}": Version ${result.winner} wins (A: ${result.versionA.combinedScore}, B: ${result.versionB.combinedScore}, diff: ${result.scoreDifference}).`,
          metadata: {
            productId,
            winner: result.winner,
            versionAScore: result.versionA.combinedScore,
            versionBScore: result.versionB.combinedScore,
            versionAMessages: result.versionA.totalMessages,
            versionBMessages: result.versionB.totalMessages,
          },
        });

        evaluatedCount++;
      }

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "info",
        message: `A/B test evaluation complete: ${evaluatedCount} product(s) evaluated from ${abMessages.length} total A/B messages.`,
      });
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "error",
        message: `A/B test evaluation failed: ${
          error instanceof Error ? error.message : String(error)
        }. Will retry at next scheduled cycle.`,
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
      });
    }

    return null;
  },
});

// ─── Win/Loss Engine ─────────────────────────────────────────────────────────
// Requirements: 14.5

/**
 * Zod schema for LLM-generated rejection pattern analysis.
 */
const RejectionPatternSchema = z.object({
  topObjections: z.array(
    z.object({
      category: z.string().describe("Objection category (e.g. trop_cher, besoin_reflexion)"),
      frequency: z.number().describe("Number of occurrences"),
      commonPhrases: z.array(z.string()).describe("Representative phrases from rejections"),
    }),
  ),
  timingPatterns: z.object({
    avgDaysToRejection: z.number().describe("Average days between first contact and rejection"),
    peakRejectionDay: z.string().describe("Day of week with most rejections"),
    fastestRejectionHours: z.number().describe("Fastest rejection time in hours"),
  }),
  channelAnalysis: z.array(
    z.object({
      channel: z.string().describe("Channel name"),
      rejectionRate: z.number().describe("Rejection rate as percentage 0-100"),
      commonObjection: z.string().describe("Most common objection on this channel"),
    }),
  ),
  qualifierInsights: z.string().describe(
    "Actionable insights for the Qualifier agent to improve lead scoring and filtering",
  ),
  copywriterInsights: z.string().describe(
    "Actionable insights for the Copywriter agent to improve messaging and reduce objections",
  ),
});

/**
 * Analyze rejection patterns from archived leads and feed insights
 * into the Qualifier and Copywriter prompt configs.
 *
 * Pipeline:
 * 1. Load archived leads with rejection/objection data (last 30 days)
 * 2. Aggregate patterns: recurring objections, timing, channel
 * 3. Use LLM to synthesize actionable insights
 * 4. Update prompt_configs for Qualifier and Copywriter with insights
 * 5. Store win/loss analysis in analytics table
 *
 * Requirements: 14.5
 */
export const analyzeRejectionPatterns = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "analyst",
      level: "info",
      message: "Starting Win/Loss Engine: rejection pattern analysis.",
    });

    try {
      // 1. Load archived leads with rejection data
      const archivedData = await ctx.runQuery(
        internal.agents.analystHelpers.getArchivedLeadsWithRejections,
        { sinceTimestamp: thirtyDaysAgo },
      );

      if (!archivedData || archivedData.length === 0) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "info",
          message: "Win/Loss Engine: no archived leads with rejections found in the last 30 days.",
        });
        return null;
      }

      // 2. Aggregate raw patterns for the LLM
      const rejectionsByCategory: Record<string, number> = {};
      const rejectionsByChannel: Record<string, number> = {};
      const rejectionsByProduct: Record<string, number> = {};
      const timingData: number[] = [];

      for (const lead of archivedData) {
        const productId = lead.productId ?? "unknown";
        rejectionsByProduct[productId] =
          (rejectionsByProduct[productId] ?? 0) + 1;

        for (const rejection of [...lead.rejections, ...lead.objections]) {
          const cat = rejection.category ?? "unknown";
          rejectionsByCategory[cat] = (rejectionsByCategory[cat] ?? 0) + 1;

          const ch = rejection.channel ?? "unknown";
          rejectionsByChannel[ch] = (rejectionsByChannel[ch] ?? 0) + 1;

          if (rejection.sentAt && rejection.replyReceivedAt) {
            const hoursToReject =
              (rejection.replyReceivedAt - rejection.sentAt) / (1000 * 60 * 60);
            timingData.push(hoursToReject);
          }
        }
      }

      // 3. Use LLM to synthesize actionable insights
      const analysisPrompt = `Analyze the following rejection and objection data from our lead pipeline and provide actionable insights.

REJECTION DATA SUMMARY:
- Total archived leads with rejections: ${archivedData.length}
- Rejections by category: ${JSON.stringify(rejectionsByCategory)}
- Rejections by channel: ${JSON.stringify(rejectionsByChannel)}
- Rejections by product: ${JSON.stringify(rejectionsByProduct)}
- Average time to rejection: ${timingData.length > 0 ? (timingData.reduce((a, b) => a + b, 0) / timingData.length).toFixed(1) : "N/A"} hours
- Fastest rejection: ${timingData.length > 0 ? Math.min(...timingData).toFixed(1) : "N/A"} hours

SAMPLE REJECTION CONTENTS (up to 10):
${archivedData
  .flatMap((l) => [...l.rejections, ...l.objections])
  .slice(0, 10)
  .map(
    (r, i) =>
      `${i + 1}. [${r.category}] ${r.content ? r.content.slice(0, 200) : "(no content)"}`,
  )
  .join("\n")}

Provide structured analysis with:
1. Top objections ranked by frequency with representative phrases
2. Timing patterns (when do rejections happen most)
3. Channel-specific rejection analysis
4. Specific, actionable insights for the Qualifier agent (to better filter leads)
5. Specific, actionable insights for the Copywriter agent (to craft better messages)`;

      const { output: analysis } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        output: Output.object({
          schema: RejectionPatternSchema,
        }),
        system: `You are a sales analytics expert for LeadEngine OS. Analyze rejection patterns and provide actionable insights to improve lead qualification and messaging. Be specific and data-driven.`,
        prompt: analysisPrompt,
      });

      if (!analysis) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "warn",
          message: "Win/Loss Engine: LLM returned no analysis. Skipping prompt enrichment.",
        });
        return null;
      }

      // 4. Store win/loss analysis in analytics
      await ctx.runMutation(
        internal.agents.analystHelpers.storeWinLossAnalysis,
        {
          period: { start: thirtyDaysAgo, end: now },
          data: {
            archivedLeadsAnalyzed: archivedData.length,
            rejectionsByCategory,
            rejectionsByChannel,
            rejectionsByProduct,
            topObjections: analysis.topObjections,
            timingPatterns: analysis.timingPatterns,
            channelAnalysis: analysis.channelAnalysis,
            qualifierInsights: analysis.qualifierInsights,
            copywriterInsights: analysis.copywriterInsights,
          },
        },
      );

      // 5. Feed insights into Qualifier and Copywriter prompt configs
      // Get all active products to update per-product configs
      const products = await ctx.runQuery(
        internal.agents.analystHelpers.getActiveProducts,
      );

      for (const product of products) {
        const productRejections = rejectionsByProduct[product.slug] ?? 0;
        if (productRejections === 0) continue;

        // Enrich Qualifier prompt
        await ctx.runMutation(
          internal.agents.analystHelpers.enrichPromptWithWinLossInsights,
          {
            agentType: "qualifier",
            productId: product.slug,
            insights: `Win/Loss data for ${product.name} (last 30 days, ${productRejections} rejections):\n${analysis.qualifierInsights}\n\nTop objections: ${analysis.topObjections.map((o) => `${o.category} (${o.frequency}x)`).join(", ")}`,
          },
        );

        // Enrich Copywriter prompt
        await ctx.runMutation(
          internal.agents.analystHelpers.enrichPromptWithWinLossInsights,
          {
            agentType: "copywriter",
            productId: product.slug,
            insights: `Win/Loss data for ${product.name} (last 30 days, ${productRejections} rejections):\n${analysis.copywriterInsights}\n\nAvoid triggering: ${analysis.topObjections.map((o) => `${o.category} — ${o.commonPhrases.slice(0, 2).join(", ")}`).join("; ")}`,
          },
        );
      }

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "info",
        message: `Win/Loss Engine: rejection pattern analysis complete. ${archivedData.length} leads analyzed, ${Object.keys(rejectionsByCategory).length} objection categories found. Qualifier and Copywriter prompts enriched.`,
        metadata: {
          leadsAnalyzed: archivedData.length,
          categories: Object.keys(rejectionsByCategory),
          productsEnriched: products
            .filter((p) => (rejectionsByProduct[p.slug] ?? 0) > 0)
            .map((p) => p.slug),
        },
      });
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "error",
        message: `Win/Loss Engine rejection analysis failed: ${
          error instanceof Error ? error.message : String(error)
        }. Will retry at next scheduled cycle.`,
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
      });
    }

    return null;
  },
});

/**
 * Trigger micro-survey emails for recently converted leads.
 *
 * For each converted lead that hasn't received a survey yet, compose
 * a short "What convinced you?" email and submit it through the
 * standard message pipeline (Channel Router → Timing → HITL validation).
 *
 * Requirements: 14.5
 */
export const triggerWinLossSurvey = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    // Look back 7 days for recent conversions
    const sevenDaysAgo = now - SEVEN_DAYS_MS;

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "analyst",
      level: "info",
      message: "Starting Win/Loss Engine: micro-survey trigger for recent conversions.",
    });

    try {
      // 1. Get converted leads eligible for survey
      const eligibleLeads = await ctx.runQuery(
        internal.agents.analystHelpers.getConvertedLeadsForSurvey,
        { sinceTimestamp: sevenDaysAgo },
      );

      if (!eligibleLeads || eligibleLeads.length === 0) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "info",
          message: "Win/Loss Engine: no eligible leads for micro-survey.",
        });
        return null;
      }

      let surveysSent = 0;

      for (const lead of eligibleLeads) {
        if (!lead.productId) continue;

        // Load product config for brand context
        const product = await ctx.runQuery(
          internal.agents.copywriterHelpers.getProductBySlug,
          { slug: lead.productId },
        );

        if (!product) continue;

        // Compose the micro-survey email content
        const leadName = lead.name ?? lead.email.split("@")[0];
        const surveyBody = `Bonjour ${leadName},\n\nMerci d'avoir choisi ${product.name} ! Nous aimerions comprendre ce qui vous a convaincu.\n\nUne seule question : qu'est-ce qui a fait la différence dans votre décision ?\n\n- La fonctionnalité principale\n- Un témoignage ou cas d'usage\n- Le prix / rapport qualité-prix\n- La recommandation d'un pair\n- L'urgence de votre besoin\n- Autre (répondez librement)\n\nVotre retour nous aide à mieux accompagner les futurs utilisateurs.\n\nMerci,\nL'équipe ${product.name}`;

        const surveySubject = `${leadName}, qu'est-ce qui vous a convaincu de choisir ${product.name} ?`;

        // Insert the survey message through the standard pipeline
        const messageId = await ctx.runMutation(
          internal.agents.analystHelpers.insertSurveyMessage,
          {
            leadId: lead._id,
            suggestedReply: surveyBody,
            subject: surveySubject,
          },
        );

        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "info",
          message: `Win/Loss micro-survey created for lead ${lead._id} (${lead.email}, product: ${lead.productId}).`,
          leadId: lead._id,
          messageId,
        });

        surveysSent++;
      }

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "info",
        message: `Win/Loss Engine: ${surveysSent} micro-survey(s) created from ${eligibleLeads.length} eligible leads.`,
      });
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "analyst",
        level: "error",
        message: `Win/Loss Engine survey trigger failed: ${
          error instanceof Error ? error.message : String(error)
        }. Will retry at next scheduled cycle.`,
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
      });
    }

    return null;
  },
});
