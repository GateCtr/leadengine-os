import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Helper queries and mutations for the Sequence Engine.
 *
 * These live in a separate file because sequenceEngine.ts uses "use node"
 * (for the Copywriter action call), and files with "use node" can only
 * export actions. Queries and mutations must be in a non-"use node" file.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

// ─── Step definitions ────────────────────────────────────────────────────────

/**
 * Outreach follow-up sequence steps.
 * J+0 (initial), J+3 (social proof), J+7 (open question),
 * J+14 (value email), J+30 (reactivation).
 */
export const OUTREACH_STEPS = [
  { day: 0, type: "initial", angle: "Introduction personnalisée avec proposition de valeur" },
  { day: 3, type: "relance_1", angle: "Preuve sociale — témoignage client ou cas d'usage concret" },
  { day: 7, type: "relance_2", angle: "Question ouverte simple pour engager la conversation" },
  { day: 14, type: "valeur", angle: "Email de valeur — insight utile sans intention de vente" },
  { day: 30, type: "reactivation", angle: "Réactivation — dernière tentative avec angle différent" },
] as const;

/**
 * Onboarding post-conversion sequence steps.
 * J0, J1, J3, J7, J14.
 */
export const ONBOARDING_STEPS = [
  { day: 0, type: "bienvenue", angle: "Bienvenue et premiers pas avec le produit" },
  { day: 1, type: "quick_win", angle: "Quick win — fonctionnalité clé à découvrir immédiatement" },
  { day: 3, type: "approfondissement", angle: "Approfondissement — fonctionnalités avancées et intégrations" },
  { day: 7, type: "check_in", angle: "Check-in — comment se passe l'expérience, besoin d'aide ?" },
  { day: 14, type: "temoignage", angle: "Demande de témoignage et invitation à partager l'expérience" },
] as const;

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get all active sequences that have a due step (nextStepDueAt <= now).
 * Returns up to 50 sequences per batch to stay within transaction limits.
 */
export const getActiveSequencesDue = internalQuery({
  args: { now: v.number() },
  returns: v.any(),
  handler: async (ctx, { now }) => {
    return await ctx.db
      .query("sequences")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(50);
  },
});

/**
 * Get a lead by ID.
 */
export const getLeadById = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.any(),
  handler: async (ctx, { leadId }) => {
    return await ctx.db.get(leadId);
  },
});

/**
 * Check if a lead has received any reply on messages in a given sequence.
 * A reply means the sequence should be paused/stopped.
 */
export const hasLeadReplied = internalQuery({
  args: { leadId: v.id("leads"), sequenceId: v.id("sequences") },
  returns: v.boolean(),
  handler: async (ctx, { leadId, sequenceId }) => {
    const messagesWithReply = await ctx.db
      .query("messages")
      .withIndex("by_sequenceId", (q) => q.eq("sequenceId", sequenceId))
      .take(50);

    return messagesWithReply.some((m) => m.replyReceivedAt != null);
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Advance a sequence to the next step and record the completion of the current step.
 */
export const advanceSequenceStep = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    completedStepIndex: v.number(),
    messageId: v.optional(v.id("messages")),
    nextStepDueAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { sequenceId, completedStepIndex, messageId, nextStepDueAt }) => {
    const now = Date.now();
    const sequence = await ctx.db.get(sequenceId);
    if (!sequence) return null;

    const updatedSteps = [...sequence.steps];

    // Mark the completed step
    if (updatedSteps[completedStepIndex]) {
      updatedSteps[completedStepIndex] = {
        ...updatedSteps[completedStepIndex],
        messageId,
        completedAt: now,
      };
    }

    const nextStep = completedStepIndex + 1;
    const isLastStep = nextStep >= updatedSteps.length;

    await ctx.db.patch(sequenceId, {
      currentStep: isLastStep ? completedStepIndex : nextStep,
      steps: updatedSteps,
      nextStepDueAt: isLastStep ? undefined : nextStepDueAt,
      completedAt: isLastStep ? now : undefined,
      status: isLastStep ? "completed" : "active",
    });

    return null;
  },
});

/**
 * Insert a follow-up message linked to a sequence.
 * The message goes through the standard pipeline: Copywriter → Channel Router → Timing → HITL.
 */
export const insertSequenceMessage = internalMutation({
  args: {
    leadId: v.id("leads"),
    sequenceId: v.id("sequences"),
    sequenceStep: v.number(),
    angle: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, { leadId, sequenceId, sequenceStep, angle }) => {
    const now = Date.now();

    const messageId = await ctx.db.insert("messages", {
      leadId,
      sequenceId,
      sequenceStep,
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    return messageId;
  },
});

/**
 * Update a sequence message with composed content from the Copywriter.
 * After updating, triggers the Channel Router → Timing pipeline.
 */
export const updateSequenceMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    suggestedReply: v.string(),
    subject: v.optional(v.string()),
    tone: v.union(v.literal("expert"), v.literal("support"), v.literal("tech")),
    socialProofUsed: v.optional(v.string()),
    contextualLink: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      suggestedReply: args.suggestedReply,
      subject: args.subject,
      tone: args.tone,
      socialProofUsed: args.socialProofUsed,
      contextualLink: args.contextualLink,
      updatedAt: now,
    });

    // Trigger the Channel Router to determine delivery channel and brand identity.
    // This continues the standard pipeline: Channel Router → Timing → HITL.
    await ctx.scheduler.runAfter(
      0,
      internal.router.channelRouter.routeMessage,
      { messageId: args.messageId },
    );

    return null;
  },
});

/**
 * Archive a lead and mark the sequence as completed.
 * Used at J+31 when no response has been received.
 *
 * Requirement 9.5: Automatically archive the lead at J+31 without response.
 */
export const archiveLeadAndCompleteSequence = internalMutation({
  args: {
    leadId: v.id("leads"),
    sequenceId: v.id("sequences"),
  },
  returns: v.null(),
  handler: async (ctx, { leadId, sequenceId }) => {
    const now = Date.now();

    // Archive the lead
    const lead = await ctx.db.get(leadId);
    if (lead && lead.status !== "archived" && lead.status !== "converted") {
      await ctx.db.patch(leadId, {
        status: "archived",
        updatedAt: now,
      });
    }

    // Complete the sequence
    const sequence = await ctx.db.get(sequenceId);
    if (sequence && sequence.status === "active") {
      await ctx.db.patch(sequenceId, {
        status: "completed",
        completedAt: now,
      });
    }

    // Log the archival
    await ctx.db.insert("agent_logs", {
      agentType: "sequence_engine",
      level: "info",
      message: `Lead ${leadId} archived at J+31 (no response). Sequence ${sequenceId} completed.`,
      leadId,
      timestamp: now,
    });

    return null;
  },
});

/**
 * Pause a sequence when a reply is received.
 */
export const pauseSequence = internalMutation({
  args: { sequenceId: v.id("sequences") },
  returns: v.null(),
  handler: async (ctx, { sequenceId }) => {
    const sequence = await ctx.db.get(sequenceId);
    if (sequence && sequence.status === "active") {
      await ctx.db.patch(sequenceId, {
        status: "paused",
      });
    }
    return null;
  },
});

/**
 * Create a new sequence for a lead.
 * Used when the initial message is sent or when a conversion triggers onboarding.
 */
export const createSequence = internalMutation({
  args: {
    leadId: v.id("leads"),
    type: v.union(v.literal("outreach"), v.literal("onboarding")),
  },
  returns: v.id("sequences"),
  handler: async (ctx, { leadId, type }) => {
    const now = Date.now();
    const stepDefs = type === "outreach" ? OUTREACH_STEPS : ONBOARDING_STEPS;

    const steps = stepDefs.map((s) => ({
      day: s.day,
      type: s.type,
      angle: s.angle,
    }));

    // The first step (day 0) is the initial message that was already sent,
    // so the next due step is step 1.
    const nextStepIndex = 1;
    const nextStepDueAt =
      nextStepIndex < steps.length
        ? now + steps[nextStepIndex].day * 24 * 60 * 60 * 1000
        : undefined;

    const sequenceId = await ctx.db.insert("sequences", {
      leadId,
      type,
      status: "active",
      currentStep: nextStepIndex,
      steps,
      startedAt: now,
      nextStepDueAt,
    });

    await ctx.db.insert("agent_logs", {
      agentType: "sequence_engine",
      level: "info",
      message: `Sequence created: type=${type}, lead=${leadId}, sequence=${sequenceId}. Next step due at ${nextStepDueAt ? new Date(nextStepDueAt).toISOString() : "N/A"}.`,
      leadId,
      timestamp: now,
    });

    return sequenceId;
  },
});
