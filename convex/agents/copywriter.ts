"use node";

/**
 * Agent Copywriter — Rédaction Contextuelle
 *
 * Composes personalized, contextual messages for qualified leads.
 * Uses Vercel AI SDK with structured output (Zod) for reliable message generation.
 * Adapts tone (Expert/Support/Tech), injects social proof and contextual links.
 * Supports A/B testing with two distinct message versions.
 *
 * This file uses "use node" because it depends on the Vercel AI SDK which
 * requires Node.js. It can ONLY export actions (internalAction).
 * Queries and mutations are in copywriterHelpers.ts.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 3.4
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

// Re-export shared utilities so existing imports continue to work.
// The canonical definitions live in convex/shared/copywriterUtils.ts
// to avoid direct inter-agent imports (Requirement 20.1).
export {
  MessageOutputSchema,
  type MessageOutput,
  determineTone,
  buildSocialProof,
  buildCopywriterPrompt,
} from "../shared/copywriterUtils";

import {
  MessageOutputSchema,
  determineTone,
  buildSocialProof,
  buildCopywriterPrompt,
} from "../shared/copywriterUtils";

// ─── Main Action: Compose Message ────────────────────────────────────────────

/**
 * Compose a personalized message for a qualified lead.
 *
 * Pipeline:
 * 1. Read the lead from DB — verify it's qualified and has no existing message
 * 2. Load the product config from the products table
 * 3. Load the copywriter prompt_config for the product
 * 4. Load validated testimonials for social proof
 * 5. Determine tone (Expert/Support/Tech) from lead context
 * 6. Build contextual link from product's landingPageBaseUrl
 * 7. Call Anthropic LLM with structured output (Zod schema)
 * 8. If A/B testing enabled → generate version B with different angle
 * 9. Store message in messages table with validationStatus "draft"
 * 10. On LLM error → log and mark lead for reprocessing
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 3.4
 */
export const composeMessage = internalAction({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    // 1. Read the lead from DB
    const lead = await ctx.runQuery(
      internal.agents.copywriterHelpers.getLeadForComposition,
      { leadId },
    );

    if (!lead) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "warn",
        message: `Composition skipped: lead ${leadId} not found.`,
        leadId,
      });
      return null;
    }

    // Only compose for qualified leads (or hot/pending for re-engagement)
    if (lead.status !== "qualified" && lead.status !== "hot" && lead.status !== "pending") {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "info",
        message: `Composition skipped: lead ${leadId} has status "${lead.status}" (expected qualified, hot, or pending).`,
        leadId,
      });
      return null;
    }

    // Check if lead already has a message (avoid duplicates)
    const existingMessage = await ctx.runQuery(
      internal.agents.copywriterHelpers.getExistingMessageForLead,
      { leadId },
    );

    if (existingMessage && existingMessage.suggestedReply) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "info",
        message: `Composition skipped: lead ${leadId} already has a suggested_reply.`,
        leadId,
      });
      return null;
    }

    // Verify lead has a productId assigned
    if (!lead.productId) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "warn",
        message: `Composition skipped: lead ${leadId} has no productId assigned.`,
        leadId,
      });
      return null;
    }

    // 2. Load the product config
    const product = await ctx.runQuery(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: lead.productId },
    );

    if (!product) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "error",
        message: `Composition failed: product "${lead.productId}" not found in products table.`,
        leadId,
      });
      return null;
    }

    // 3. Load the copywriter prompt_config for the product
    const promptConfig = await ctx.runQuery(
      internal.agents.copywriterHelpers.getCopywriterPromptConfig,
      { productId: lead.productId },
    );

    // 4. Load validated testimonials for social proof
    const testimonials = await ctx.runQuery(
      internal.agents.copywriterHelpers.getValidatedTestimonials,
      { productId: lead.productId },
    );

    // 5. Determine tone from lead context
    const tone = determineTone({
      source: lead.source,
      detectionChannel: lead.detectionChannel,
      webhookEventType: lead.webhookEventType ?? undefined,
      enrichmentData: lead.enrichmentData ?? undefined,
    });

    // 6. Build contextual link from product's landingPageBaseUrl
    const contextualLink = product.landingPageBaseUrl;

    // 7. Build social proof string
    const socialProof = buildSocialProof(testimonials, product.name);

    // 8. Check if A/B testing is enabled (via prompt_config or default)
    const abTestingEnabled = promptConfig?.promptTemplate?.includes("[AB_TEST]") ?? false;

    // 9. Call Anthropic LLM for version A
    try {
      const leadData = {
        email: lead.email,
        name: lead.name ?? undefined,
        source: lead.source,
        sourceUrl: lead.sourceUrl ?? undefined,
        detectionChannel: lead.detectionChannel,
        webhookEventType: lead.webhookEventType ?? undefined,
        webhookEventContext: lead.webhookEventContext ?? undefined,
        enrichmentData: lead.enrichmentData ?? undefined,
      };

      const { system: systemA, user: userA } = buildCopywriterPrompt(
        leadData,
        {
          name: product.name,
          uspDescription: product.uspDescription ?? undefined,
          landingPageBaseUrl: product.landingPageBaseUrl,
        },
        tone,
        socialProof,
        contextualLink,
        promptConfig?.promptTemplate ?? undefined,
        "A",
      );

      const { output: resultA } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        output: Output.object({
          schema: MessageOutputSchema,
        }),
        system: systemA,
        prompt: userA,
      });

      let suggestedReplyB: string | undefined;

      // 10. If A/B testing enabled → generate version B
      if (abTestingEnabled) {
        const { system: systemB, user: userB } = buildCopywriterPrompt(
          leadData,
          {
            name: product.name,
            uspDescription: product.uspDescription ?? undefined,
            landingPageBaseUrl: product.landingPageBaseUrl,
          },
          tone,
          socialProof,
          contextualLink,
          promptConfig?.promptTemplate ?? undefined,
          "B",
        );

        try {
          const { output: resultB } = await generateText({
            model: anthropic("claude-sonnet-4-20250514"),
            output: Output.object({
              schema: MessageOutputSchema,
            }),
            system: systemB,
            prompt: userB,
          });

          suggestedReplyB = resultB.body;
        } catch (abError) {
          // A/B version B failure is non-critical — continue with version A only
          await ctx.runMutation(internal.logs.createLog, {
            agentType: "copywriter",
            level: "warn",
            message: `A/B version B generation failed for lead ${leadId}: ${
              abError instanceof Error ? abError.message : String(abError)
            }. Continuing with version A only.`,
            leadId,
          });
        }
      }

      // 11. Store message in messages table with validationStatus "draft"
      const messageId = await ctx.runMutation(
        internal.agents.copywriterHelpers.insertMessage,
        {
          leadId,
          suggestedReply: resultA.body,
          suggestedReplyB,
          activeVersion: abTestingEnabled && suggestedReplyB ? "A" : undefined,
          subject: resultA.subject,
          tone: resultA.tone,
          socialProofUsed: resultA.socialProofSnippet,
          contextualLink,
        },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "info",
        message: `Message composed for lead ${leadId} → message ${messageId} (tone: ${resultA.tone}, A/B: ${abTestingEnabled && suggestedReplyB ? "yes" : "no"}).`,
        leadId,
        messageId,
        metadata: {
          tone: resultA.tone,
          abTesting: abTestingEnabled && !!suggestedReplyB,
          productSlug: lead.productId,
          hasEnrichment: !!lead.enrichmentData,
          testimonialCount: testimonials.length,
        },
      });
    } catch (llmError) {
      // 12. On LLM error → log and mark lead for reprocessing
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "copywriter",
        level: "error",
        message: `LLM composition failed for lead ${leadId}: ${
          llmError instanceof Error ? llmError.message : String(llmError)
        }. Lead marked for reprocessing.`,
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

      // Mark lead for reprocessing (touch updatedAt so it can be picked up again)
      await ctx.runMutation(
        internal.agents.copywriterHelpers.markLeadForReprocessing,
        { leadId },
      );
    }

    return null;
  },
});
