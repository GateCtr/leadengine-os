"use node";

/**
 * Upsell Engine — Détection d'opportunités de ventes croisées
 *
 * Detects upsell/cross-sell opportunities for converted clients by evaluating
 * usage signals against dynamically loaded rules from the `upsell_rules` table.
 * Generates suggestion messages that go through HITL validation.
 *
 * This file uses "use node" because it calls the LLM (Vercel AI SDK) to
 * compose upsell messages. It can ONLY export actions (internalAction).
 * Queries and mutations are in upsellEngineHelpers.ts.
 *
 * Trigger: Cron job (daily).
 *
 * The 4 cross-sell rules from the design:
 * 1. Piksend → GateCtr (api_intensive_usage)
 * 2. GateCtr → Piksend (image_volume_growing)
 * 3. Ryan Sabowa → Joventy (recurring_projects)
 * 4. Joventy → Ryan Sabowa (consulting_need)
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

// ─── Zod schema for upsell LLM output ───────────────────────────────────────

const UpsellMessageSchema = z.object({
  subject: z
    .string()
    .describe("Email subject line — value-focused, not pushy"),
  body: z
    .string()
    .describe(
      "Full message body — personalized cross-sell suggestion, focused on complementary value",
    ),
  tone: z
    .enum(["expert", "support", "tech"])
    .describe("Tone used for this upsell message"),
});

// ─── Signal evaluation types ─────────────────────────────────────────────────

interface UpsellRule {
  _id: string;
  sourceProductSlug: string;
  signal: string;
  targetProductSlug: string;
  description?: string;
  isActive: boolean;
}

interface ConvertedLead {
  _id: string;
  email: string;
  name?: string;
  productId?: string;
  enrichmentData?: Record<string, unknown>;
  convertedAt?: number;
  lastActivityAt?: number;
}

interface TrackingEvent {
  type: string;
  timestamp: number;
  url?: string;
  metadata?: Record<string, unknown>;
}

interface WebhookEvent {
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

type ActionCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
  runAction: (ref: any, args: any) => Promise<any>;
};

// ─── Main Action: Detect Upsell Opportunities ───────────────────────────────

/**
 * Detect upsell/cross-sell opportunities across all converted clients.
 *
 * Pipeline:
 * 1. Load active upsell rules from `upsell_rules` table
 * 2. Load all converted leads
 * 3. For each lead, match against rules by sourceProductSlug
 * 4. Evaluate usage signals for each matching rule
 * 5. If signal detected → generate upsell message via LLM
 * 6. All generated messages go through HITL validation
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */
export const detectUpsellOpportunities = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "upsell_engine",
      level: "info",
      message: "Upsell detection scan started.",
    });

    let opportunitiesDetected = 0;

    try {
      // 1. Load active upsell rules dynamically
      const rules: UpsellRule[] = await ctx.runQuery(
        internal.engine.upsellEngineHelpers.getActiveUpsellRules,
        {},
      );

      if (!rules || rules.length === 0) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "upsell_engine",
          level: "info",
          message: "No active upsell rules found. Scan complete.",
        });
        return null;
      }

      // 2. Load all converted leads
      const convertedLeads: ConvertedLead[] = await ctx.runQuery(
        internal.engine.upsellEngineHelpers.getConvertedLeadsForUpsell,
        {},
      );

      if (!convertedLeads || convertedLeads.length === 0) {
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "upsell_engine",
          level: "info",
          message: "No converted leads found. Scan complete.",
        });
        return null;
      }

      // 3. For each lead, evaluate matching rules
      for (const lead of convertedLeads) {
        if (!lead.productId) continue;

        // Find rules where the lead's current product is the source
        const matchingRules = rules.filter(
          (rule) => rule.sourceProductSlug === lead.productId,
        );

        for (const rule of matchingRules) {
          try {
            // Check if we already sent an upsell message for this lead + target
            const hasExisting: boolean = await ctx.runQuery(
              internal.engine.upsellEngineHelpers.hasExistingUpsellMessage,
              {
                leadId: lead._id as any,
                targetProductSlug: rule.targetProductSlug,
              },
            );

            if (hasExisting) continue;

            // 4. Evaluate usage signal
            const signalDetected = await evaluateSignal(ctx, lead, rule);

            if (!signalDetected) continue;

            // 5. Generate upsell message via LLM
            await generateUpsellMessage(ctx, lead, rule);

            opportunitiesDetected++;

            await ctx.runMutation(internal.logs.createLog, {
              agentType: "upsell_engine",
              level: "info",
              message: `Upsell opportunity detected for lead ${lead._id}: ${rule.sourceProductSlug} → ${rule.targetProductSlug} (signal: ${rule.signal}).`,
              leadId: lead._id as any,
              metadata: {
                sourceProduct: rule.sourceProductSlug,
                targetProduct: rule.targetProductSlug,
                signal: rule.signal,
              },
            });
          } catch (error) {
            await ctx.runMutation(internal.logs.createLog, {
              agentType: "upsell_engine",
              level: "error",
              message: `Error evaluating upsell rule for lead ${lead._id} (${rule.sourceProductSlug} → ${rule.targetProductSlug}): ${
                error instanceof Error ? error.message : String(error)
              }`,
              leadId: lead._id as any,
              metadata: {
                ruleId: rule._id,
                signal: rule.signal,
              },
            });
          }
        }
      }
    } catch (error) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "upsell_engine",
        level: "error",
        message: `Upsell detection scan failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
      });
    }

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "upsell_engine",
      level: "info",
      message: `Upsell detection scan completed. ${opportunitiesDetected} opportunity(ies) detected.`,
      metadata: { opportunitiesDetected },
    });

    return null;
  },
});

// ─── Signal Evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate whether a specific usage signal is present for a lead.
 *
 * Signal types:
 * - api_intensive_usage: High volume of API-related tracking events (Piksend → GateCtr)
 * - image_volume_growing: Growing image processing events (GateCtr → Piksend)
 * - recurring_projects: Pattern of repeated project-related activity (Ryan Sabowa → Joventy)
 * - consulting_need: Signals indicating need for expert guidance (Joventy → Ryan Sabowa)
 */
async function evaluateSignal(
  ctx: ActionCtx,
  lead: ConvertedLead,
  rule: UpsellRule,
): Promise<boolean> {
  // Get tracking events for this lead
  const trackingEvents: TrackingEvent[] = await ctx.runQuery(
    internal.engine.upsellEngineHelpers.getLeadTrackingEvents,
    { leadId: lead._id as any },
  );

  // Get webhook events for the source product
  const webhookEvents: WebhookEvent[] = await ctx.runQuery(
    internal.engine.upsellEngineHelpers.getLeadWebhookEvents,
    { sourceSlug: rule.sourceProductSlug },
  );

  // Filter webhook events relevant to this lead
  const leadWebhookEvents = webhookEvents.filter((event) => {
    const payload = event.payload as Record<string, unknown>;
    const eventEmail =
      (payload.user_email ?? payload.email ?? payload.customer_email) as
        | string
        | undefined;
    return eventEmail === lead.email;
  });

  switch (rule.signal) {
    case "api_intensive_usage":
      return evaluateApiIntensiveUsage(trackingEvents, leadWebhookEvents);

    case "image_volume_growing":
      return evaluateImageVolumeGrowing(trackingEvents, leadWebhookEvents);

    case "recurring_projects":
      return evaluateRecurringProjects(trackingEvents, leadWebhookEvents);

    case "consulting_need":
      return evaluateConsultingNeed(trackingEvents, leadWebhookEvents);

    default:
      // For unknown signals, check if there's high general activity
      return trackingEvents.length >= 20 || leadWebhookEvents.length >= 10;
  }
}

/**
 * Requirement 13.1: Piksend → GateCtr (api_intensive_usage)
 * Detects high API usage patterns indicating the client could benefit
 * from GateCtr for LLM cost optimization.
 */
function evaluateApiIntensiveUsage(
  trackingEvents: TrackingEvent[],
  webhookEvents: WebhookEvent[],
): boolean {
  // Look for high click/interaction volume (proxy for API usage)
  const clickEvents = trackingEvents.filter((e) => e.type === "click");
  const apiWebhookEvents = webhookEvents.filter(
    (e) =>
      e.eventType.includes("api") ||
      e.eventType.includes("usage") ||
      e.eventType.includes("request"),
  );

  // Signal: 15+ click events or 10+ API-related webhook events in 30 days
  return clickEvents.length >= 15 || apiWebhookEvents.length >= 10;
}

/**
 * Requirement 13.2: GateCtr → Piksend (image_volume_growing)
 * Detects growing image processing volume indicating the client could
 * benefit from Piksend for professional photo management.
 */
function evaluateImageVolumeGrowing(
  trackingEvents: TrackingEvent[],
  webhookEvents: WebhookEvent[],
): boolean {
  const imageWebhookEvents = webhookEvents.filter(
    (e) =>
      e.eventType.includes("image") ||
      e.eventType.includes("upload") ||
      e.eventType.includes("process"),
  );

  // Check for growing trend: compare first half vs second half of the window
  if (imageWebhookEvents.length < 4) return false;

  const sorted = [...imageWebhookEvents].sort(
    (a, b) => a.receivedAt - b.receivedAt,
  );
  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint).length;
  const secondHalf = sorted.slice(midpoint).length;

  // Signal: second half has more events than first half (growing trend)
  // and total volume is meaningful
  return secondHalf > firstHalf && imageWebhookEvents.length >= 8;
}

/**
 * Requirement 13.3: Ryan Sabowa → Joventy (recurring_projects)
 * Detects patterns of repeated project-related activity indicating
 * the client could benefit from Joventy for workflow automation.
 */
function evaluateRecurringProjects(
  trackingEvents: TrackingEvent[],
  webhookEvents: WebhookEvent[],
): boolean {
  const projectWebhookEvents = webhookEvents.filter(
    (e) =>
      e.eventType.includes("project") ||
      e.eventType.includes("task") ||
      e.eventType.includes("milestone"),
  );

  // Signal: 5+ project-related events suggest recurring project patterns
  if (projectWebhookEvents.length >= 5) return true;

  // Also check for high general engagement as a proxy
  return trackingEvents.length >= 20;
}

/**
 * Requirement 13.4: Joventy → Ryan Sabowa (consulting_need)
 * Detects signals indicating the client needs expert guidance,
 * suggesting Ryan Sabowa for dedicated consulting.
 */
function evaluateConsultingNeed(
  trackingEvents: TrackingEvent[],
  webhookEvents: WebhookEvent[],
): boolean {
  const consultingSignals = webhookEvents.filter(
    (e) =>
      e.eventType.includes("support") ||
      e.eventType.includes("help") ||
      e.eventType.includes("question") ||
      e.eventType.includes("consult"),
  );

  // Signal: 3+ support/help requests suggest consulting need
  if (consultingSignals.length >= 3) return true;

  // Also check for support-ticket-like tracking events
  const replyEvents = trackingEvents.filter((e) => e.type === "reply");
  return replyEvents.length >= 5;
}

// ─── LLM Message Generation ─────────────────────────────────────────────────

/**
 * Generate an upsell/cross-sell message for a lead.
 * The message goes through the standard pipeline: Channel Router → Timing → HITL.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */
async function generateUpsellMessage(
  ctx: ActionCtx,
  lead: ConvertedLead,
  rule: UpsellRule,
): Promise<void> {
  // Load source product config
  let sourceProduct = null;
  if (lead.productId) {
    sourceProduct = await ctx.runQuery(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: lead.productId },
    );
  }

  // Load target product config
  const targetProduct = await ctx.runQuery(
    internal.agents.copywriterHelpers.getProductBySlug,
    { slug: rule.targetProductSlug },
  );

  const sourceProductName = sourceProduct?.name ?? lead.productId ?? "votre produit actuel";
  const targetProductName = targetProduct?.name ?? rule.targetProductSlug;
  const targetLandingPage = targetProduct?.landingPageBaseUrl ?? "";
  const ruleDescription = rule.description ?? buildDefaultRuleDescription(rule);

  const system = `You are a customer success specialist. Your job is to compose a personalized cross-sell/upsell message for an existing customer of ${sourceProductName}, suggesting they could also benefit from ${targetProductName}.

TONE: EXPERT (knowledgeable, helpful, value-focused)

RULES:
- Write a natural, human message — NO templates, NO generic phrases
- Focus on COMPLEMENTARY VALUE: explain how ${targetProductName} enhances what they already do with ${sourceProductName}
- Reference their current usage pattern that triggered this suggestion
- Do NOT be pushy or salesy — this is about helping them get more value
- Include a clear value proposition for ${targetProductName}
- Keep the message concise (100-200 words for email body)
- The subject line should be value-focused and personal (under 60 chars)
- Write in the language most appropriate for the customer (default: French)

CROSS-SELL CONTEXT: ${ruleDescription}`;

  const user = `Compose a cross-sell message for this customer:

Email: ${lead.email}
Name: ${lead.name ?? "Client"}
Current Product: ${sourceProductName}
Suggested Product: ${targetProductName}
Signal Detected: ${rule.signal}
Rule Description: ${ruleDescription}

Generate a helpful, value-focused cross-sell message that explains how ${targetProductName} complements their use of ${sourceProductName}.`;

  try {
    const { output: result } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      output: Output.object({ schema: UpsellMessageSchema }),
      system,
      prompt: user,
    });

    // Insert the upsell message — it goes through Channel Router → Timing → HITL
    const messageId = await ctx.runMutation(
      internal.engine.upsellEngineHelpers.insertUpsellMessage,
      {
        leadId: lead._id as any,
        suggestedReply: result.body,
        subject: result.subject,
        tone: result.tone,
        contextualLink: targetLandingPage,
      },
    );

    await ctx.runMutation(internal.logs.createLog, {
      agentType: "upsell_engine",
      level: "info",
      message: `Upsell message composed for lead ${lead._id} → message ${messageId} (${rule.sourceProductSlug} → ${rule.targetProductSlug}, tone: ${result.tone}).`,
      leadId: lead._id as any,
      messageId,
      metadata: {
        sourceProduct: rule.sourceProductSlug,
        targetProduct: rule.targetProductSlug,
        signal: rule.signal,
        tone: result.tone,
      },
    });
  } catch (llmError) {
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "upsell_engine",
      level: "error",
      message: `Upsell message LLM generation failed for lead ${lead._id}: ${
        llmError instanceof Error ? llmError.message : String(llmError)
      }`,
      leadId: lead._id as any,
      metadata: {
        sourceProduct: rule.sourceProductSlug,
        targetProduct: rule.targetProductSlug,
        signal: rule.signal,
        errorType:
          llmError instanceof Error ? llmError.constructor.name : "unknown",
      },
    });
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Build a default human-readable description for a rule without a description.
 */
function buildDefaultRuleDescription(rule: UpsellRule): string {
  const descriptions: Record<string, string> = {
    api_intensive_usage: `Le client utilise intensivement l'API de ${rule.sourceProductSlug}. ${rule.targetProductSlug} pourrait optimiser ses coûts et performances.`,
    image_volume_growing: `Le volume d'images traitées par le client via ${rule.sourceProductSlug} est en croissance. ${rule.targetProductSlug} offre une gestion professionnelle des photos.`,
    recurring_projects: `Le client ${rule.sourceProductSlug} présente un pattern de projets récurrents. ${rule.targetProductSlug} pourrait automatiser son workflow.`,
    consulting_need: `Le client ${rule.sourceProductSlug} montre des signaux de besoin d'accompagnement expert. ${rule.targetProductSlug} offre un consulting dédié.`,
  };

  return (
    descriptions[rule.signal] ??
    `Signal "${rule.signal}" détecté pour un client ${rule.sourceProductSlug}. ${rule.targetProductSlug} pourrait apporter une valeur complémentaire.`
  );
}
