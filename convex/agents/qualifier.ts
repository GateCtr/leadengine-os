"use node";

/**
 * Agent Qualificateur — Scoring & Filtrage
 *
 * Analyzes leads semantically via Anthropic LLM and assigns a weighted score /100.
 * Uses Vercel AI SDK with structured output (Zod) for reliable scoring.
 *
 * This file uses "use node" because it depends on the Vercel AI SDK which
 * requires Node.js. It can ONLY export actions (internalAction).
 * Queries and mutations are in qualifierHelpers.ts.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

// ─── Zod schema for LLM structured output ───────────────────────────────────

/**
 * The LLM returns scores for 4 dimensions (urgency, productMatch,
 * activeProfile, contextSignals). The 5th dimension (webhookSource)
 * is calculated programmatically — not by the LLM.
 */
export const ScoringResultSchema = z.object({
  urgency: z
    .number()
    .min(0)
    .max(30)
    .describe("Score for urgency expressed in the lead's text (0-30)"),
  productMatch: z
    .number()
    .min(0)
    .max(20)
    .describe(
      "Score for alignment between the lead's problem and the best product USP (0-20)",
    ),
  activeProfile: z
    .number()
    .min(0)
    .max(15)
    .describe(
      "Score for active profile signals — existing account, recent activity, enriched data (0-15)",
    ),
  contextSignals: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Score for contextual signals — engagement, profile completeness, social presence (0-10)",
    ),
  bestProduct: z
    .string()
    .describe(
      "Slug of the best matching product from the provided list (e.g. 'piksend', 'gatectr')",
    ),
  reasoning: z
    .string()
    .describe("Brief explanation of the scoring rationale"),
});

export type ScoringResult = z.infer<typeof ScoringResultSchema>;

// ─── Programmatic webhookSource score ────────────────────────────────────────

/**
 * Calculate the webhookSource score programmatically.
 * 25 points if the lead source starts with "webhook_", 0 otherwise.
 */
export function calculateWebhookSourceScore(source: string): number {
  return source.startsWith("webhook_") ? 25 : 0;
}

// ─── Build the LLM prompt ───────────────────────────────────────────────────

/**
 * Build the system and user prompts for the qualifier LLM call.
 */
export function buildQualifierPrompt(
  lead: {
    email: string;
    name?: string;
    source: string;
    sourceUrl?: string;
    detectionChannel: string;
    webhookEventType?: string;
    webhookEventContext?: string;
    enrichmentData?: {
      linkedinUrl?: string;
      githubUrl?: string;
      websiteUrl?: string;
      bio?: string;
      skills?: string[];
      company?: string;
      role?: string;
    };
  },
  products: Array<{
    slug: string;
    name: string;
    uspDescription?: string;
  }>,
): { system: string; user: string } {
  const productDescriptions = products
    .map(
      (p) =>
        `- ${p.name} (slug: "${p.slug}"): ${p.uspDescription ?? "No USP description available"}`,
    )
    .join("\n");

  const system = `You are a lead qualification agent for LeadEngine OS. Your job is to analyze incoming leads and score them based on their potential value.

You must evaluate the lead across 4 dimensions:
1. **Urgency (0-30)**: How urgently does the lead need a solution? Look for pain keywords, deadlines, frustration signals.
2. **Product Match (0-20)**: How well does the lead's problem align with one of our products' USPs?
3. **Active Profile (0-15)**: Does the lead have an active online presence? Enriched profile data, company info, skills?
4. **Context Signals (0-10)**: Additional engagement signals — profile completeness, social presence, detection channel quality.

Available products:
${productDescriptions}

Choose the best matching product slug from the list above. If no product matches well, still pick the closest one but give a low productMatch score.

Be precise and fair in your scoring. Do not inflate scores.`;

  const enrichmentInfo = lead.enrichmentData
    ? `
Enrichment Data:
- LinkedIn: ${lead.enrichmentData.linkedinUrl ?? "N/A"}
- GitHub: ${lead.enrichmentData.githubUrl ?? "N/A"}
- Website: ${lead.enrichmentData.websiteUrl ?? "N/A"}
- Bio: ${lead.enrichmentData.bio ?? "N/A"}
- Skills: ${lead.enrichmentData.skills?.join(", ") ?? "N/A"}
- Company: ${lead.enrichmentData.company ?? "N/A"}
- Role: ${lead.enrichmentData.role ?? "N/A"}`
    : "Enrichment Data: Not available";

  const webhookInfo =
    lead.webhookEventType || lead.webhookEventContext
      ? `
Webhook Event: ${lead.webhookEventType ?? "N/A"}
Webhook Context: ${lead.webhookEventContext ?? "N/A"}`
      : "";

  const user = `Analyze this lead and provide a qualification score:

Email: ${lead.email}
Name: ${lead.name ?? "Unknown"}
Source: ${lead.source}
Source URL: ${lead.sourceUrl ?? "N/A"}
Detection Channel: ${lead.detectionChannel}
${webhookInfo}
${enrichmentInfo}

Provide your scoring for each dimension and select the best matching product.`;

  return { system, user };
}

// ─── Main Action: Qualify Lead ───────────────────────────────────────────────

/**
 * Qualify a lead by analyzing it with the Anthropic LLM.
 *
 * Pipeline:
 * 1. Read the lead from DB
 * 2. Trigger enrichment via Firecrawl
 * 3. Re-read the lead to get enrichment data
 * 4. Load active products from DB
 * 5. Call Anthropic LLM with structured output (Zod schema)
 * 6. Calculate total score (LLM scores + programmatic webhookSource)
 * 7. If score >= 40 → qualified + productId; if < 40 → discarded
 * 8. On LLM error → log and keep lead in pending_qualification
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
export const qualifyLead = internalAction({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    // 1. Read the lead from DB
    const lead = await ctx.runQuery(
      internal.agents.qualifierHelpers.getLeadForQualification,
      { leadId },
    );

    if (!lead) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "warn",
        message: `Qualification skipped: lead ${leadId} not found.`,
        leadId,
      });
      return null;
    }

    // Only qualify leads in pending_qualification status
    if (lead.status !== "pending_qualification") {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "info",
        message: `Qualification skipped: lead ${leadId} has status "${lead.status}" (expected pending_qualification).`,
        leadId,
      });
      return null;
    }

    // 2. Trigger enrichment via Firecrawl (fail-safe — continues even if enrichment fails)
    try {
      await ctx.runAction(internal.enrichment.enrichLead, { leadId });
    } catch (enrichError) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "warn",
        message: `Enrichment failed for lead ${leadId}, continuing with available data: ${
          enrichError instanceof Error
            ? enrichError.message
            : String(enrichError)
        }`,
        leadId,
      });
    }

    // 3. Re-read the lead to get enrichment data
    const enrichedLead = await ctx.runQuery(
      internal.agents.qualifierHelpers.getLeadForQualification,
      { leadId },
    );

    if (!enrichedLead) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "error",
        message: `Qualification failed: lead ${leadId} disappeared after enrichment.`,
        leadId,
      });
      return null;
    }

    // 4. Load active products from DB
    const products = await ctx.runQuery(
      internal.agents.qualifierHelpers.getActiveProducts,
    );

    if (products.length === 0) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "error",
        message: `Qualification failed: no active products found in database.`,
        leadId,
      });
      return null;
    }

    // 5. Call Anthropic LLM with structured output
    try {
      const { system, user } = buildQualifierPrompt(
        {
          email: enrichedLead.email,
          name: enrichedLead.name ?? undefined,
          source: enrichedLead.source,
          sourceUrl: enrichedLead.sourceUrl ?? undefined,
          detectionChannel: enrichedLead.detectionChannel,
          webhookEventType: enrichedLead.webhookEventType ?? undefined,
          webhookEventContext: enrichedLead.webhookEventContext ?? undefined,
          enrichmentData: enrichedLead.enrichmentData ?? undefined,
        },
        products,
      );

      const { output: scoringResult } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        output: Output.object({
          schema: ScoringResultSchema,
        }),
        system,
        prompt: user,
      });

      // 6. Calculate total score (LLM scores + programmatic webhookSource)
      const webhookSourceScore = calculateWebhookSourceScore(
        enrichedLead.source,
      );

      const totalScore =
        scoringResult.urgency +
        webhookSourceScore +
        scoringResult.productMatch +
        scoringResult.activeProfile +
        scoringResult.contextSignals;

      const scoringBreakdown = {
        urgency: scoringResult.urgency,
        webhookSource: webhookSourceScore,
        productMatch: scoringResult.productMatch,
        activeProfile: scoringResult.activeProfile,
        contextSignals: scoringResult.contextSignals,
      };

      // Validate that bestProduct is a known product slug
      const validProductSlugs = products.map((p) => p.slug);
      const assignedProduct = validProductSlugs.includes(
        scoringResult.bestProduct,
      )
        ? scoringResult.bestProduct
        : validProductSlugs[0]; // Fallback to first product if LLM returns unknown slug

      // 7. If score >= 40 → qualified + productId; if < 40 → discarded
      const newStatus = totalScore >= 40 ? "qualified" : "discarded";

      await ctx.runMutation(
        internal.agents.qualifierHelpers.updateLeadQualification,
        {
          leadId,
          status: newStatus,
          score: totalScore,
          scoringBreakdown,
          productId: newStatus === "qualified" ? assignedProduct : undefined,
          scoringReasoning: scoringResult.reasoning,
        },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "info",
        message: `Lead ${leadId} qualified with score ${totalScore}/100 → ${newStatus}${newStatus === "qualified" ? ` (product: ${assignedProduct})` : ""}.`,
        leadId,
        metadata: {
          score: totalScore,
          breakdown: scoringBreakdown,
          bestProduct: assignedProduct,
          status: newStatus,
        },
      });
    } catch (llmError) {
      // 8. On LLM error → log and keep lead in pending_qualification for reprocessing
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "error",
        message: `LLM qualification failed for lead ${leadId}: ${
          llmError instanceof Error ? llmError.message : String(llmError)
        }. Lead remains in pending_qualification for reprocessing.`,
        leadId,
        metadata: {
          errorType:
            llmError instanceof Error
              ? llmError.constructor.name
              : "unknown",
          errorMessage:
            llmError instanceof Error ? llmError.message : String(llmError),
        },
      });
      // Lead stays in pending_qualification — no status change
    }

    return null;
  },
});
