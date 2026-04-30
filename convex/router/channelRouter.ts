import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/**
 * Channel Router — Routage Canal & Identité de Marque
 *
 * Determines the delivery channel (email or social) and resolves
 * brand identity dynamically from the product config for each message.
 *
 * This is an internalMutation (not an action) because it only reads
 * from the DB and updates the message — no external API calls needed.
 *
 * Trigger: Message composed without a channel assigned.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

/**
 * Social platform domains used to detect social channels from sourceUrl.
 */
const SOCIAL_PLATFORM_PATTERNS: Array<{
  pattern: RegExp;
  channel: "twitter" | "linkedin" | "reddit" | "instagram";
}> = [
  { pattern: /twitter\.com|x\.com/i, channel: "twitter" },
  { pattern: /linkedin\.com/i, channel: "linkedin" },
  { pattern: /reddit\.com/i, channel: "reddit" },
  { pattern: /instagram\.com/i, channel: "instagram" },
];

/**
 * Valid social detection channels that map directly to a social channel.
 */
const SOCIAL_DETECTION_CHANNELS = new Set([
  "twitter",
  "linkedin",
  "reddit",
  "instagram",
]);

/**
 * Determine the delivery channel based on lead data.
 *
 * Logic:
 * 1. If the lead's detectionChannel is a known social platform → use that
 * 2. If the lead's sourceUrl points to a social platform → use that
 * 3. Default → email
 */
export function determineChannel(lead: {
  detectionChannel: string;
  sourceUrl?: string | null;
}): "email" | "twitter" | "linkedin" | "reddit" | "instagram" {
  // 1. Check detectionChannel directly
  if (SOCIAL_DETECTION_CHANNELS.has(lead.detectionChannel)) {
    return lead.detectionChannel as
      | "twitter"
      | "linkedin"
      | "reddit"
      | "instagram";
  }

  // 2. Check sourceUrl for social platform patterns
  if (lead.sourceUrl) {
    for (const { pattern, channel } of SOCIAL_PLATFORM_PATTERNS) {
      if (pattern.test(lead.sourceUrl)) {
        return channel;
      }
    }
  }

  // 3. Default to email
  return "email";
}

/**
 * Build a direct link to the social platform for a given channel and sourceUrl.
 * Returns the sourceUrl if available, or a generic platform URL.
 */
export function buildSocialDirectLink(
  channel: "twitter" | "linkedin" | "reddit" | "instagram",
  sourceUrl?: string | null,
): string {
  if (sourceUrl) {
    return sourceUrl;
  }

  const platformUrls: Record<string, string> = {
    twitter: "https://twitter.com",
    linkedin: "https://linkedin.com",
    reddit: "https://reddit.com",
    instagram: "https://instagram.com",
  };

  return platformUrls[channel] ?? "https://twitter.com";
}

/**
 * Route a message: determine channel, resolve brand identity from product config,
 * and update the message document.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
export const routeMessage = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const now = Date.now();

    // 1. Read the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      await ctx.db.insert("agent_logs", {
        agentType: "channel_router",
        level: "warn",
        message: `Routing skipped: message ${messageId} not found.`,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // Skip if already routed
    if (message.channel) {
      await ctx.db.insert("agent_logs", {
        agentType: "channel_router",
        level: "info",
        message: `Routing skipped: message ${messageId} already has channel "${message.channel}".`,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // 2. Read the associated lead
    const lead = await ctx.db.get(message.leadId);
    if (!lead) {
      await ctx.db.insert("agent_logs", {
        agentType: "channel_router",
        level: "error",
        message: `Routing failed: lead ${message.leadId} not found for message ${messageId}.`,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // 3. Load product config from the products table (lookup by productId/slug)
    if (!lead.productId) {
      await ctx.db.insert("agent_logs", {
        agentType: "channel_router",
        level: "error",
        message: `Routing failed: lead ${lead._id} has no productId assigned.`,
        leadId: lead._id,
        messageId,
        timestamp: now,
      });
      return null;
    }

    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", lead.productId!))
      .unique();

    if (!product) {
      await ctx.db.insert("agent_logs", {
        agentType: "channel_router",
        level: "error",
        message: `Routing failed: product "${lead.productId}" not found in products table.`,
        leadId: lead._id,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // 4. Determine the channel (email or social) based on lead data
    const channel = determineChannel({
      detectionChannel: lead.detectionChannel,
      sourceUrl: lead.sourceUrl ?? null,
    });

    // 5. Resolve brand identity dynamically from product config
    const brandIdentity = {
      sender: product.senderEmail,
      replyTo: product.replyToEmail,
      templateId: product.templateId,
    };

    // 6. Build update payload based on channel type
    const updatePayload: Record<string, unknown> = {
      channel,
      brandIdentity,
      updatedAt: now,
    };

    if (channel === "email") {
      // Email channel: brand identity is set via brandIdentity object
      // The template injection happens at send time via Resend + React Email
    } else {
      // Social channel: prepare direct link to the target platform
      updatePayload.socialDirectLink = buildSocialDirectLink(
        channel,
        lead.sourceUrl ?? null,
      );
    }

    // 7. Update the message with channel + brand identity
    await ctx.db.patch(messageId, updatePayload);

    await ctx.db.insert("agent_logs", {
      agentType: "channel_router",
      level: "info",
      message: `Message ${messageId} routed: channel=${channel}, product=${lead.productId}, sender=${product.senderEmail}.`,
      leadId: lead._id,
      messageId,
      metadata: {
        channel,
        productSlug: lead.productId,
        brandIdentity,
        socialDirectLink:
          channel !== "email"
            ? buildSocialDirectLink(channel, lead.sourceUrl ?? null)
            : undefined,
      },
      timestamp: now,
    });

    // 8. Schedule the Agent Timing to suggest the optimal send time.
    // The timing agent will set sendAtSuggested and update validationStatus
    // to pending_validation, making the message ready for the Dashboard.
    // (Requirements: 8.1, 8.3)
    if (!message.sendAtSuggested) {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.timing.suggestSendTime,
        { messageId },
      );
    }

    return null;
  },
});
