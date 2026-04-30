"use node";

/**
 * Churn Detector — Détection de Désengagement et Rétention
 *
 * Monitors converted/active clients for disengagement signals and triggers
 * retention actions. Generates alerts in the notification system and creates
 * retention/downsell messages through the standard pipeline
 * (Copywriter → Channel Router → Timing → HITL validation).
 *
 * This file uses "use node" because it calls the LLM (Vercel AI SDK) to
 * compose retention/downsell messages. It can ONLY export actions
 * (internalAction). Queries and mutations are in churnDetectorHelpers.ts.
 *
 * Trigger: Cron job every 6 hours.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  NO_LOGIN_THRESHOLD_MS,
  USAGE_DROP_WINDOW_MS,
  SUPPORT_TICKET_THRESHOLD_MS,
} from "./churnDetectorHelpers";

// ─── Zod schema for retention/downsell LLM output ───────────────────────────

const RetentionMessageSchema = z.object({
  subject: z
    .string()
    .describe("Email subject line — empathetic, re-engagement focused"),
  body: z
    .string()
    .describe(
      "Full message body — personalized retention message, empathetic tone, focused on value and help",
    ),
  tone: z
    .enum(["expert", "support", "tech"])
    .describe("Tone used for this retention message"),
});

const DownsellMessageSchema = z.object({
  subject: z
    .string()
    .describe("Email subject line — understanding, offering alternatives"),
  body: z
    .string()
    .describe(
      "Full message body — downsell offer with a lower-tier plan, empathetic and non-pushy",
    ),
  tone: z
    .enum(["expert", "support", "tech"])
    .describe("Tone used for this downsell message"),
});

// ─── Types ───────────────────────────────────────────────────────────────────

type ChurnSignalType =
  | "no_login"
  | "usage_drop"
  | "support_ticket"
  | "cancellation_attempt";

// ─── Main Action: Detect Churn Signals ───────────────────────────────────────

/**
 * Detect churn signals across all converted clients and trigger appropriate
 * retention actions.
 *
 * Pipeline:
 * 1. Check for inactive converted leads (no login > 7 days) → high alert
 * 2. Check for usage drops > 50% over 2 weeks → retention message
 * 3. Check for unresolved support tickets > 48h → escalation + follow-up
 * 4. Check for cancellation attempts → immediate downsell offer
 * 5. All generated messages go through HITL validation
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */
export const detectChurnSignals = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "churn_detector",
      level: "info",
      message: "Churn detection scan started.",
    });

    let signalsDetected = 0;

    try {
      // 1. Check for inactive converted leads (no login > 7 days)
      const inactiveCount = await checkInactiveLeads(ctx);
      signalsDetected += inactiveCount;

      // 2. Check for usage drops > 50% over 2 weeks
      const usageDropCount = await checkUsageDrops(ctx);
      signalsDetected += usageDropCount;

      // 3. Check for unresolved support tickets > 48h
      const ticketCount = await checkUnresolvedSupportTickets(ctx);
      signalsDetected += ticketCount;

      // 4. Check for cancellation attempts
      const cancellationCount = await checkCancellationAttempts(ctx);
      signalsDetected += cancellationCount;
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "error",
        message: `Churn detection scan failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
      });
    }

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "churn_detector",
      level: "info",
      message: `Churn detection scan completed. ${signalsDetected} signal(s) detected.`,
      metadata: { signalsDetected },
    });

    return null;
  },
});

// ─── Signal Check: Inactive Leads (Requirement 12.1) ────────────────────────

/**
 * Check for converted leads with no activity for > 7 days.
 * Generates a high-priority churn_signal notification for each.
 */
async function checkInactiveLeads(ctx: ActionCtx): Promise<number> {
  const inactiveLeads = await ctx.runQuery(
    internal.engine.churnDetectorHelpers.getInactiveConvertedLeads,
    { inactivityThresholdMs: NO_LOGIN_THRESHOLD_MS },
  );

  if (!inactiveLeads || inactiveLeads.length === 0) return 0;

  let count = 0;

  for (const lead of inactiveLeads) {
    try {
      // Update churn risk score
      const daysSinceActivity = Math.floor(
        (Date.now() - (lead.lastActivityAt ?? lead.convertedAt ?? lead.updatedAt)) /
          (24 * 60 * 60 * 1000),
      );
      const riskScore = Math.min(100, 40 + daysSinceActivity * 5);

      await ctx.runMutation(
        internal.engine.churnDetectorHelpers.updateChurnRiskScore,
        { leadId: lead._id, churnRiskScore: riskScore },
      );

      // Generate high-priority notification
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "churn_signal",
          priority: "high",
          title: `Inactivité détectée : ${lead.name ?? lead.email}`,
          body: `Le client ${lead.name ?? lead.email} (${lead.productId ?? "produit inconnu"}) n'a pas de connexion depuis ${daysSinceActivity} jours. Risque de churn : ${riskScore}/100.`,
          leadId: lead._id,
        },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "info",
        message: `Inactivity signal detected for lead ${lead._id}: ${daysSinceActivity} days without login. Risk score: ${riskScore}.`,
        leadId: lead._id,
        metadata: {
          signalType: "no_login" as ChurnSignalType,
          daysSinceActivity,
          riskScore,
        },
      });

      count++;
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "error",
        message: `Error processing inactive lead ${lead._id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        leadId: lead._id,
      });
    }
  }

  return count;
}

// ─── Signal Check: Usage Drops (Requirement 12.2) ────────────────────────────

/**
 * Check for converted leads with a usage drop > 50% over 2 weeks.
 * Triggers the generation of a retention message via LLM.
 */
async function checkUsageDrops(ctx: ActionCtx): Promise<number> {
  const convertedLeads = await ctx.runQuery(
    internal.engine.churnDetectorHelpers.getConvertedLeads,
    {},
  );

  if (!convertedLeads || convertedLeads.length === 0) return 0;

  let count = 0;

  for (const lead of convertedLeads) {
    try {
      const activity = await ctx.runQuery(
        internal.engine.churnDetectorHelpers.getLeadActivityForUsageDrop,
        { leadId: lead._id, windowMs: USAGE_DROP_WINDOW_MS },
      );

      // Only analyze if there was meaningful activity in the first half
      if (activity.firstHalf < 2) continue;

      // Check for > 50% drop
      const dropPercentage =
        activity.firstHalf > 0
          ? ((activity.firstHalf - activity.secondHalf) / activity.firstHalf) * 100
          : 0;

      if (dropPercentage <= 50) continue;

      // Update churn risk score
      const riskScore = Math.min(100, 50 + Math.floor(dropPercentage / 2));
      await ctx.runMutation(
        internal.engine.churnDetectorHelpers.updateChurnRiskScore,
        { leadId: lead._id, churnRiskScore: riskScore },
      );

      // Generate retention message via LLM
      await generateRetentionMessage(ctx, lead, "usage_drop", {
        dropPercentage: Math.round(dropPercentage),
        firstHalfEvents: activity.firstHalf,
        secondHalfEvents: activity.secondHalf,
      });

      // Generate notification
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "churn_signal",
          priority: "high",
          title: `Chute d'usage détectée : ${lead.name ?? lead.email}`,
          body: `Le client ${lead.name ?? lead.email} (${lead.productId ?? "produit inconnu"}) a une chute d'usage de ${Math.round(dropPercentage)}% sur les 2 dernières semaines. Un message de rétention a été généré.`,
          leadId: lead._id,
        },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "info",
        message: `Usage drop signal detected for lead ${lead._id}: ${Math.round(dropPercentage)}% drop. Retention message generated.`,
        leadId: lead._id,
        metadata: {
          signalType: "usage_drop" as ChurnSignalType,
          dropPercentage: Math.round(dropPercentage),
          firstHalfEvents: activity.firstHalf,
          secondHalfEvents: activity.secondHalf,
          riskScore,
        },
      });

      count++;
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "error",
        message: `Error checking usage drop for lead ${lead._id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        leadId: lead._id,
      });
    }
  }

  return count;
}

// ─── Signal Check: Unresolved Support Tickets (Requirement 12.3) ─────────────

/**
 * Check for support tickets open > 48h without response.
 * Triggers escalation notification and a follow-up message.
 */
async function checkUnresolvedSupportTickets(ctx: ActionCtx): Promise<number> {
  const unresolvedTickets = await ctx.runQuery(
    internal.engine.churnDetectorHelpers.getUnresolvedSupportTickets,
    { ticketThresholdMs: SUPPORT_TICKET_THRESHOLD_MS },
  );

  if (!unresolvedTickets || unresolvedTickets.length === 0) return 0;

  let count = 0;

  for (const ticket of unresolvedTickets) {
    try {
      // Find the associated lead
      const lead = await ctx.runQuery(
        internal.engine.churnDetectorHelpers.findLeadForWebhookEvent,
        { webhookEventId: ticket._id },
      );

      if (!lead) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "churn_detector",
          level: "warn",
          message: `Unresolved support ticket ${ticket._id} has no associated lead. Skipping.`,
          metadata: { webhookEventId: ticket._id, source: ticket.source },
        });
        // Mark as processed to avoid re-checking
        await ctx.runMutation(
          internal.engine.churnDetectorHelpers.markWebhookEventProcessed,
          { webhookEventId: ticket._id },
        );
        continue;
      }

      const hoursSinceTicket = Math.floor(
        (Date.now() - ticket.receivedAt) / (60 * 60 * 1000),
      );

      // Generate escalation notification
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "churn_signal",
          priority: "high",
          title: `Ticket support non résolu : ${lead.name ?? lead.email}`,
          body: `Un ticket support pour ${lead.name ?? lead.email} (${lead.productId ?? "produit inconnu"}) est ouvert depuis ${hoursSinceTicket}h sans réponse. Un message de suivi a été généré.`,
          leadId: lead._id,
        },
      );

      // Generate follow-up message via LLM
      await generateRetentionMessage(ctx, lead, "support_ticket", {
        hoursSinceTicket,
        ticketSource: ticket.source,
      });

      // Update churn risk score
      const riskScore = Math.min(100, 60 + Math.floor(hoursSinceTicket / 12) * 5);
      await ctx.runMutation(
        internal.engine.churnDetectorHelpers.updateChurnRiskScore,
        { leadId: lead._id, churnRiskScore: riskScore },
      );

      // Mark the webhook event as processed
      await ctx.runMutation(
        internal.engine.churnDetectorHelpers.markWebhookEventProcessed,
        { webhookEventId: ticket._id },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "info",
        message: `Support ticket escalation for lead ${lead._id}: ticket open for ${hoursSinceTicket}h. Follow-up message generated.`,
        leadId: lead._id,
        metadata: {
          signalType: "support_ticket" as ChurnSignalType,
          hoursSinceTicket,
          webhookEventId: ticket._id,
          riskScore,
        },
      });

      count++;
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "error",
        message: `Error processing support ticket ${ticket._id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        metadata: { webhookEventId: ticket._id },
      });
    }
  }

  return count;
}

// ─── Signal Check: Cancellation Attempts (Requirement 12.4) ──────────────────

/**
 * Check for cancellation attempts and immediately generate a downsell offer.
 */
async function checkCancellationAttempts(ctx: ActionCtx): Promise<number> {
  const cancellationEvents = await ctx.runQuery(
    internal.engine.churnDetectorHelpers.getCancellationAttempts,
    {},
  );

  if (!cancellationEvents || cancellationEvents.length === 0) return 0;

  let count = 0;

  for (const event of cancellationEvents) {
    try {
      // Find the associated lead
      const lead = await ctx.runQuery(
        internal.engine.churnDetectorHelpers.findLeadForWebhookEvent,
        { webhookEventId: event._id },
      );

      if (!lead) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "churn_detector",
          level: "warn",
          message: `Cancellation event ${event._id} has no associated lead. Skipping.`,
          metadata: { webhookEventId: event._id, source: event.source },
        });
        await ctx.runMutation(
          internal.engine.churnDetectorHelpers.markWebhookEventProcessed,
          { webhookEventId: event._id },
        );
        continue;
      }

      // Set churn risk to maximum
      await ctx.runMutation(
        internal.engine.churnDetectorHelpers.updateChurnRiskScore,
        { leadId: lead._id, churnRiskScore: 100 },
      );

      // Generate immediate high-priority notification
      await ctx.runAction(
        internal.notifications.triggers.triggerNotification,
        {
          type: "churn_signal",
          priority: "critical",
          title: `Tentative d'annulation : ${lead.name ?? lead.email}`,
          body: `Le client ${lead.name ?? lead.email} (${lead.productId ?? "produit inconnu"}) a tenté d'annuler son abonnement. Une offre de downsell a été générée et attend validation.`,
          leadId: lead._id,
        },
      );

      // Generate downsell message via LLM
      await generateDownsellMessage(ctx, lead, {
        eventType: event.eventType,
        source: event.source,
      });

      // Mark the webhook event as processed
      await ctx.runMutation(
        internal.engine.churnDetectorHelpers.markWebhookEventProcessed,
        { webhookEventId: event._id },
      );

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "info",
        message: `Cancellation attempt detected for lead ${lead._id}. Downsell offer generated.`,
        leadId: lead._id,
        metadata: {
          signalType: "cancellation_attempt" as ChurnSignalType,
          webhookEventId: event._id,
          eventType: event.eventType,
        },
      });

      count++;
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "churn_detector",
        level: "error",
        message: `Error processing cancellation event ${event._id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        metadata: { webhookEventId: event._id },
      });
    }
  }

  return count;
}

// ─── LLM Message Generation ─────────────────────────────────────────────────

type ActionCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
  runAction: (ref: any, args: any) => Promise<any>;
};

/**
 * Generate a retention message for a lead showing churn signals.
 * The message goes through the standard pipeline: Channel Router → Timing → HITL.
 *
 * Requirements: 12.2, 12.3, 12.5
 */
async function generateRetentionMessage(
  ctx: ActionCtx,
  lead: {
    _id: string;
    email: string;
    name?: string;
    productId?: string;
    enrichmentData?: Record<string, unknown>;
  },
  signalType: ChurnSignalType,
  signalDetails: Record<string, unknown>,
): Promise<void> {
  // Load product config for contextual link and branding
  let product = null;
  if (lead.productId) {
    product = await ctx.runQuery(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: lead.productId },
    );
  }

  const productName = product?.name ?? "notre produit";
  const contextualLink = product?.landingPageBaseUrl ?? "";

  const signalDescription = buildSignalDescription(signalType, signalDetails);

  const system = `You are a customer success specialist for ${productName}. Your job is to compose a personalized retention message for a customer showing signs of disengagement.

TONE: SUPPORT (empathetic, warm, solution-oriented)

RULES:
- Write a natural, human message — NO templates, NO generic phrases
- Be empathetic and understanding — acknowledge the customer's situation
- Focus on value: remind them what they're getting, offer help
- Do NOT be pushy or salesy — this is about retention, not upselling
- Keep the message concise (100-200 words for email body)
- The subject line should be warm and personal (under 60 chars)
- Write in the language most appropriate for the customer (default: French)

CHURN SIGNAL DETECTED: ${signalDescription}`;

  const user = `Compose a retention message for this customer:

Email: ${lead.email}
Name: ${lead.name ?? "Client"}
Product: ${productName}
Signal: ${signalDescription}

Generate a warm, empathetic retention message that addresses the specific disengagement signal and offers help.`;

  try {
    const { output: result } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      output: Output.object({ schema: RetentionMessageSchema }),
      system,
      prompt: user,
    });

    // Insert the retention message — it goes through Channel Router → Timing → HITL
    const messageId = await ctx.runMutation(
      internal.engine.churnDetectorHelpers.insertRetentionMessage,
      {
        leadId: lead._id as any,
        suggestedReply: result.body,
        subject: result.subject,
        tone: result.tone,
        contextualLink,
      },
    );

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "churn_detector",
      level: "info",
      message: `Retention message composed for lead ${lead._id} → message ${messageId} (signal: ${signalType}, tone: ${result.tone}).`,
      leadId: lead._id as any,
      messageId,
      metadata: { signalType, tone: result.tone },
    });
  } catch (llmError) {
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "churn_detector",
      level: "error",
      message: `Retention message LLM generation failed for lead ${lead._id}: ${
        llmError instanceof Error ? llmError.message : String(llmError)
      }`,
      leadId: lead._id as any,
      metadata: {
        signalType,
        errorType:
          llmError instanceof Error ? llmError.constructor.name : "unknown",
      },
    });
  }
}

/**
 * Generate a downsell message for a lead attempting to cancel.
 * The message goes through the standard pipeline: Channel Router → Timing → HITL.
 *
 * Requirements: 12.4, 12.5
 */
async function generateDownsellMessage(
  ctx: ActionCtx,
  lead: {
    _id: string;
    email: string;
    name?: string;
    productId?: string;
    enrichmentData?: Record<string, unknown>;
  },
  cancellationDetails: Record<string, unknown>,
): Promise<void> {
  // Load product config
  let product = null;
  if (lead.productId) {
    product = await ctx.runQuery(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: lead.productId },
    );
  }

  const productName = product?.name ?? "notre produit";
  const contextualLink = product?.landingPageBaseUrl ?? "";

  const system = `You are a customer success specialist for ${productName}. A customer is trying to cancel their subscription. Your job is to compose a personalized downsell offer — suggesting a lower-tier plan that might better fit their needs.

TONE: SUPPORT (empathetic, understanding, non-pushy)

RULES:
- Write a natural, human message — NO templates, NO generic phrases
- Acknowledge their desire to cancel — do NOT ignore it
- Offer a concrete alternative: a lower-tier plan with reduced price
- Highlight what they'd keep on the lower plan
- Make it easy to switch (one-click or simple reply)
- Do NOT be aggressive or guilt-trip — respect their decision
- Keep the message concise (100-200 words for email body)
- The subject line should be understanding and offer-focused (under 60 chars)
- Write in the language most appropriate for the customer (default: French)`;

  const user = `Compose a downsell offer for this customer who is trying to cancel:

Email: ${lead.email}
Name: ${lead.name ?? "Client"}
Product: ${productName}
Cancellation event: ${JSON.stringify(cancellationDetails)}

Generate an empathetic downsell message that offers a lower-tier alternative.`;

  try {
    const { output: result } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      output: Output.object({ schema: DownsellMessageSchema }),
      system,
      prompt: user,
    });

    // Insert the downsell message — it goes through Channel Router → Timing → HITL
    const messageId = await ctx.runMutation(
      internal.engine.churnDetectorHelpers.insertRetentionMessage,
      {
        leadId: lead._id as any,
        suggestedReply: result.body,
        subject: result.subject,
        tone: result.tone,
        contextualLink,
      },
    );

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "churn_detector",
      level: "info",
      message: `Downsell message composed for lead ${lead._id} → message ${messageId} (tone: ${result.tone}).`,
      leadId: lead._id as any,
      messageId,
      metadata: { signalType: "cancellation_attempt", tone: result.tone },
    });
  } catch (llmError) {
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "churn_detector",
      level: "error",
      message: `Downsell message LLM generation failed for lead ${lead._id}: ${
        llmError instanceof Error ? llmError.message : String(llmError)
      }`,
      leadId: lead._id as any,
      metadata: {
        signalType: "cancellation_attempt",
        errorType:
          llmError instanceof Error ? llmError.constructor.name : "unknown",
      },
    });
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Build a human-readable description of the churn signal for the LLM prompt.
 */
function buildSignalDescription(
  signalType: ChurnSignalType,
  details: Record<string, unknown>,
): string {
  switch (signalType) {
    case "no_login":
      return `Le client ne s'est pas connecté depuis ${details.daysSinceActivity ?? "7+"} jours.`;
    case "usage_drop":
      return `Chute d'usage de ${details.dropPercentage ?? "50+"}% sur les 2 dernières semaines (${details.firstHalfEvents ?? "?"} événements → ${details.secondHalfEvents ?? "?"} événements).`;
    case "support_ticket":
      return `Un ticket support est ouvert depuis ${details.hoursSinceTicket ?? "48+"}h sans réponse.`;
    case "cancellation_attempt":
      return `Le client a tenté d'annuler son abonnement.`;
    default:
      return `Signal de désengagement détecté.`;
  }
}
