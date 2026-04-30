"use node";

/**
 * Sequence Engine — Moteur de Relance et Onboarding
 *
 * Orchestrates follow-up sequences (outreach J+3/J+7/J+14/J+30) and
 * onboarding post-conversion sequences (J0/J1/J3/J7/J14).
 *
 * This file uses "use node" because it calls the Copywriter action
 * (which requires Node.js for the Vercel AI SDK). It can ONLY export
 * actions (internalAction). Queries and mutations are in sequenceHelpers.ts.
 *
 * Trigger: Cron job every 6 hours.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

/** Number of days after sequence start to auto-archive (outreach only). */
const ARCHIVE_DAY = 31;

/**
 * Process all active sequences: check due steps, trigger copywriter,
 * and archive leads at J+31.
 *
 * Pipeline:
 * 1. Load all active sequences
 * 2. For each sequence, check if the next step is due (nextStepDueAt <= now)
 * 3. Check if the lead has replied (if so, pause the sequence)
 * 4. For outreach sequences past J+31 without reply → archive the lead
 * 5. If step is due → trigger Agent Copywriter with the appropriate angle
 * 6. Advance the sequence to the next step
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export const processSequences = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    // 1. Load all active sequences
    const sequences = await ctx.runQuery(
      internal.engine.sequenceHelpers.getActiveSequencesDue,
      { now },
    );

    if (!sequences || sequences.length === 0) {
      return null;
    }

    for (const sequence of sequences) {
      try {
        await processOneSequence(ctx, sequence, now);
      } catch (error) {
        // Log error but continue processing other sequences (agent isolation)
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "sequence_engine",
          level: "error",
          message: `Error processing sequence ${sequence._id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          leadId: sequence.leadId,
          metadata: {
            sequenceId: sequence._id,
            errorType:
              error instanceof Error ? error.constructor.name : "unknown",
          },
        });
      }
    }

    return null;
  },
});

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Process a single sequence: check due step, handle replies, archive,
 * or trigger copywriter for the next follow-up.
 */
async function processOneSequence(
  ctx: {
    runQuery: (ref: any, args: any) => Promise<any>;
    runMutation: (ref: any, args: any) => Promise<any>;
    runAction: (ref: any, args: any) => Promise<any>;
  },
  sequence: {
    _id: string;
    leadId: string;
    type: "outreach" | "onboarding";
    status: string;
    currentStep: number;
    steps: Array<{
      day: number;
      type: string;
      angle: string;
      messageId?: string;
      completedAt?: number;
    }>;
    startedAt: number;
    nextStepDueAt?: number;
  },
  now: number,
): Promise<void> {
  // Check if the lead has replied — if so, pause the sequence
  const hasReplied: boolean = await ctx.runQuery(
    internal.engine.sequenceHelpers.hasLeadReplied,
    { leadId: sequence.leadId, sequenceId: sequence._id },
  );

  if (hasReplied) {
    await ctx.runMutation(internal.engine.sequenceHelpers.pauseSequence, {
      sequenceId: sequence._id,
    });

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "sequence_engine",
      level: "info",
      message: `Sequence ${sequence._id} paused: lead ${sequence.leadId} has replied.`,
      leadId: sequence.leadId,
    });
    return;
  }

  // For outreach sequences: check if we've passed J+31 → archive the lead
  if (sequence.type === "outreach") {
    const daysSinceStart = (now - sequence.startedAt) / (24 * 60 * 60 * 1000);
    if (daysSinceStart >= ARCHIVE_DAY) {
      await ctx.runMutation(
        internal.engine.sequenceHelpers.archiveLeadAndCompleteSequence,
        { leadId: sequence.leadId, sequenceId: sequence._id },
      );
      return;
    }
  }

  // Check if the next step is due
  if (!sequence.nextStepDueAt || sequence.nextStepDueAt > now) {
    return; // Not due yet
  }

  // Get the current step definition
  const currentStepDef = sequence.steps[sequence.currentStep];
  if (!currentStepDef) {
    return; // No more steps
  }

  // Verify the lead still exists and is in a valid state for follow-up
  const lead = await ctx.runQuery(
    internal.engine.sequenceHelpers.getLeadById,
    { leadId: sequence.leadId },
  );

  if (!lead) {
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "sequence_engine",
      level: "warn",
      message: `Sequence ${sequence._id} skipped: lead ${sequence.leadId} not found.`,
      leadId: sequence.leadId,
    });
    return;
  }

  // Don't send follow-ups to archived, converted, discarded, or churned leads
  if (
    lead.status === "archived" ||
    lead.status === "converted" ||
    lead.status === "discarded" ||
    lead.status === "churned"
  ) {
    await ctx.runMutation(internal.engine.sequenceHelpers.pauseSequence, {
      sequenceId: sequence._id,
    });

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "sequence_engine",
      level: "info",
      message: `Sequence ${sequence._id} paused: lead ${sequence.leadId} has status "${lead.status}".`,
      leadId: sequence.leadId,
    });
    return;
  }

  // Log the follow-up trigger
  await ctx.runMutation(internal.logs.createLog, {
    agentType: "sequence_engine",
    level: "info",
    message: `Triggering follow-up for sequence ${sequence._id}, step ${sequence.currentStep} (${currentStepDef.type}, day ${currentStepDef.day}): "${currentStepDef.angle}"`,
    leadId: sequence.leadId,
    metadata: {
      sequenceId: sequence._id,
      stepNumber: sequence.currentStep,
      stepType: currentStepDef.type,
      stepDay: currentStepDef.day,
      angle: currentStepDef.angle,
    },
  });

  // Create a placeholder message linked to the sequence, then trigger the
  // Copywriter to compose the actual content. The message goes through the
  // standard pipeline: Copywriter → Channel Router → Timing → HITL validation.
  const messageId = await ctx.runMutation(
    internal.engine.sequenceHelpers.insertSequenceMessage,
    {
      leadId: sequence.leadId,
      sequenceId: sequence._id,
      sequenceStep: sequence.currentStep,
      angle: currentStepDef.angle,
    },
  );

  // Trigger the Agent Copywriter for composing the follow-up with the
  // appropriate angle. The copywriter will fill in the message content.
  await ctx.runAction(
    internal.engine.sequenceEngine.composeFollowUp,
    {
      leadId: sequence.leadId,
      messageId,
      angle: currentStepDef.angle,
      sequenceType: sequence.type,
      stepType: currentStepDef.type,
    },
  );

  // Calculate the next step's due date (relative to sequence start)
  const nextStepIndex = sequence.currentStep + 1;
  let nextStepDueAt: number | undefined;
  if (nextStepIndex < sequence.steps.length) {
    const nextStepDef = sequence.steps[nextStepIndex];
    nextStepDueAt = sequence.startedAt + nextStepDef.day * 24 * 60 * 60 * 1000;
  }

  // Advance the sequence to the next step
  await ctx.runMutation(internal.engine.sequenceHelpers.advanceSequenceStep, {
    sequenceId: sequence._id,
    completedStepIndex: sequence.currentStep,
    messageId,
    nextStepDueAt,
  });
}

/**
 * Compose a follow-up message for a sequence step.
 *
 * This is a dedicated action that calls the Copywriter with sequence-specific
 * context (angle, step type). It uses the same LLM pipeline as the initial
 * message composition but with a follow-up prompt.
 *
 * The composed message then flows through the standard pipeline:
 * Channel Router → Timing → Dashboard (HITL validation)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.6
 */
export const composeFollowUp = internalAction({
  args: {
    leadId: v.id("leads"),
    messageId: v.id("messages"),
    angle: v.string(),
    sequenceType: v.union(v.literal("outreach"), v.literal("onboarding")),
    stepType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { leadId, messageId, angle, sequenceType, stepType }) => {
    // Load the lead data
    const lead = await ctx.runQuery(
      internal.agents.copywriterHelpers.getLeadForComposition,
      { leadId },
    );

    if (!lead || !lead.productId) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "sequence_engine",
        level: "warn",
        message: `Follow-up composition skipped: lead ${leadId} not found or has no productId.`,
        leadId,
        messageId,
      });
      return null;
    }

    // Load the product config
    const product = await ctx.runQuery(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: lead.productId },
    );

    if (!product) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "sequence_engine",
        level: "error",
        message: `Follow-up composition failed: product "${lead.productId}" not found.`,
        leadId,
        messageId,
      });
      return null;
    }

    // Load testimonials for social proof
    const testimonials = await ctx.runQuery(
      internal.agents.copywriterHelpers.getValidatedTestimonials,
      { productId: lead.productId },
    );

    // Import shared copywriter utilities (not from the agent directly — Requirement 20.1)
    const { determineTone, buildSocialProof, buildCopywriterPrompt, MessageOutputSchema } =
      await import("../shared/copywriterUtils");

    const tone = determineTone({
      source: lead.source,
      detectionChannel: lead.detectionChannel,
      webhookEventType: lead.webhookEventType ?? undefined,
      enrichmentData: lead.enrichmentData ?? undefined,
    });

    const socialProof = buildSocialProof(testimonials, product.name);
    const contextualLink = product.landingPageBaseUrl;

    // Build a follow-up specific system prompt
    const sequenceContext =
      sequenceType === "outreach"
        ? `This is a FOLLOW-UP message in an outreach sequence. Step type: ${stepType}. Angle: ${angle}. Do NOT repeat the initial message. Use a fresh approach based on the specified angle.`
        : `This is an ONBOARDING message for a new customer. Step type: ${stepType}. Angle: ${angle}. Focus on helping the customer succeed with the product.`;

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

    const { system, user } = buildCopywriterPrompt(
      leadData,
      {
        name: product.name,
        uspDescription: product.uspDescription ?? undefined,
        landingPageBaseUrl: product.landingPageBaseUrl,
      },
      tone,
      socialProof,
      contextualLink,
      undefined,
      "A",
    );

    // Augment the system prompt with sequence context
    const followUpSystem = `${system}\n\nSEQUENCE CONTEXT:\n${sequenceContext}`;

    try {
      const { generateText, Output } = await import("ai");
      const { anthropic } = await import("@ai-sdk/anthropic");

      const { output: result } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        output: Output.object({
          schema: MessageOutputSchema,
        }),
        system: followUpSystem,
        prompt: user,
      });

      // Update the message with the composed content
      await ctx.runMutation(
        internal.engine.sequenceHelpers.updateSequenceMessage,
        {
          messageId,
          suggestedReply: result.body,
          subject: result.subject,
          tone: result.tone,
          socialProofUsed: result.socialProofSnippet,
          contextualLink,
        },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "sequence_engine",
        level: "info",
        message: `Follow-up composed for message ${messageId} (lead ${leadId}, step ${stepType}, tone: ${result.tone}).`,
        leadId,
        messageId,
        metadata: {
          stepType,
          angle,
          sequenceType,
          tone: result.tone,
        },
      });
    } catch (llmError) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "sequence_engine",
        level: "error",
        message: `Follow-up LLM composition failed for message ${messageId}: ${
          llmError instanceof Error ? llmError.message : String(llmError)
        }`,
        leadId,
        messageId,
        metadata: {
          errorType:
            llmError instanceof Error ? llmError.constructor.name : "unknown",
        },
      });
    }

    return null;
  },
});
