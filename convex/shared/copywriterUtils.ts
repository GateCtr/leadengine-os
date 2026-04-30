/**
 * Shared Copywriter Utilities
 *
 * Pure utility functions and Zod schemas used by both the Agent Copywriter
 * and the Sequence Engine. Extracted into a shared module to maintain
 * agent isolation (Requirement 20.1: no direct inter-agent imports).
 *
 * These are stateless, pure functions with no Convex dependencies.
 */

import { z } from "zod";

// ─── Zod schema for LLM structured output ───────────────────────────────────

/**
 * The LLM returns a composed message with tone, subject, body,
 * and social proof reference.
 */
export const MessageOutputSchema = z.object({
  subject: z
    .string()
    .describe("Email subject line — concise, personalized, no clickbait"),
  body: z
    .string()
    .describe(
      "Full message body — personalized, contextual, includes social proof and contextual link naturally woven in",
    ),
  tone: z
    .enum(["expert", "support", "tech"])
    .describe(
      "Tone used for this message: expert (thought leadership), support (empathetic helper), tech (technical peer)",
    ),
  socialProofSnippet: z
    .string()
    .describe(
      "The specific social proof element used in the message (testimonial quote or reference)",
    ),
});

export type MessageOutput = z.infer<typeof MessageOutputSchema>;

// ─── Determine tone from context ─────────────────────────────────────────────

/**
 * Determine the appropriate tone based on lead context.
 * - "tech" if the lead has GitHub or technical skills
 * - "support" if the lead came from a support/help context or webhook
 * - "expert" as default for thought leadership outreach
 */
export function determineTone(
  lead: {
    source: string;
    detectionChannel: string;
    webhookEventType?: string;
    enrichmentData?: {
      githubUrl?: string;
      skills?: string[];
      role?: string;
    };
  },
): "expert" | "support" | "tech" {
  const enrichment = lead.enrichmentData;

  // Tech tone: developer signals
  if (enrichment?.githubUrl) {
    return "tech";
  }
  if (enrichment?.skills?.some((s) =>
    /develop|engineer|program|code|devops|backend|frontend|fullstack/i.test(s),
  )) {
    return "tech";
  }
  if (enrichment?.role && /develop|engineer|cto|tech/i.test(enrichment.role)) {
    return "tech";
  }

  // Support tone: webhook leads (existing users needing help)
  if (lead.source.startsWith("webhook_")) {
    return "support";
  }
  if (lead.webhookEventType && /support|help|issue|bug|error/i.test(lead.webhookEventType)) {
    return "support";
  }

  // Default: expert tone for cold outreach
  return "expert";
}

// ─── Build social proof string ───────────────────────────────────────────────

/**
 * Build a social proof string from validated testimonials.
 * Returns a formatted string for prompt injection, or a fallback message.
 */
export function buildSocialProof(
  testimonials: Array<{
    content: string;
    authorName?: string;
  }>,
  productName: string,
): string {
  if (testimonials.length === 0) {
    return `${productName} is trusted by teams who have seen measurable improvements in their workflow.`;
  }

  // Pick the best testimonial (first one, as they're already sorted by validation)
  const best = testimonials[0];
  const attribution = best.authorName ? ` — ${best.authorName}` : "";
  return `"${best.content}"${attribution}`;
}

// ─── Build the LLM prompt ───────────────────────────────────────────────────

/**
 * Build the system and user prompts for the copywriter LLM call.
 */
export function buildCopywriterPrompt(
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
  product: {
    name: string;
    uspDescription?: string;
    landingPageBaseUrl: string;
  },
  tone: "expert" | "support" | "tech",
  socialProof: string,
  contextualLink: string,
  promptTemplate?: string,
  variant?: "A" | "B",
): { system: string; user: string } {
  const toneInstructions = {
    expert:
      "Write as a thought leader sharing valuable insight. Be authoritative but approachable. Lead with value, not sales.",
    support:
      "Write as a helpful support ally who understands the user's pain. Be empathetic, warm, and solution-oriented.",
    tech:
      "Write as a technical peer. Be precise, use relevant technical language, and focus on concrete capabilities and integrations.",
  };

  const variantInstruction =
    variant === "B"
      ? "\n\nIMPORTANT: This is version B of an A/B test. Use a DIFFERENT angle, opening hook, and structure than a standard approach. Try an alternative persuasion strategy (e.g., if version A would lead with pain points, lead with opportunity; if A uses a question opener, use a bold statement)."
      : "";

  const baseSystem = promptTemplate
    ? promptTemplate
    : `You are a copywriter for ${product.name}. Your job is to compose a personalized outreach message for a prospect.

Product: ${product.name}
USP: ${product.uspDescription ?? "A powerful solution for modern teams"}
Landing Page: ${contextualLink}

TONE: ${tone.toUpperCase()}
${toneInstructions[tone]}

RULES:
- Write a natural, human message — NO templates, NO generic phrases
- Personalize based on the prospect's profile, role, company, and context
- Naturally weave in the social proof (testimonial or trust signal)
- Include the contextual link to the landing page naturally in the message
- Keep the message concise (150-300 words for email body)
- The subject line should be personalized and compelling (under 60 chars)
- Do NOT use placeholder brackets like [Name] — use actual data or omit
- Write in the language most appropriate for the prospect (default: English)${variantInstruction}`;

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

  const user = `Compose a personalized message for this prospect:

Email: ${lead.email}
Name: ${lead.name ?? "Unknown"}
Source: ${lead.source}
Source URL: ${lead.sourceUrl ?? "N/A"}
Detection Channel: ${lead.detectionChannel}
${webhookInfo}
${enrichmentInfo}

Social Proof to include: ${socialProof}
Contextual Link to include: ${contextualLink}

Generate the message with the appropriate tone and include both the social proof and the contextual link naturally in the body.`;

  return { system: baseSystem, user };
}
