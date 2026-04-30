"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { sendEmail, buildUnsubscribeUrl } from "../integrations/resend";
import { renderProductEmail } from "../../lib/emails/ProductEmailTemplate";

/**
 * Send Message — Internal actions for sending approved messages.
 *
 * The sendApprovedEmail action is scheduled by the approveMessage mutation
 * after an operator validates an email message. It enforces the HITL invariant:
 * only messages with validationStatus = "approved" can be sent.
 *
 * Requirements: 7.3, 7.4, 7.8
 */

/**
 * Send an approved email message via Resend from the product's domain.
 *
 * This action:
 * 1. Reads the message and verifies it is "approved" (HITL invariant)
 * 2. Reads the lead and product config for sender/replyTo
 * 3. Calls Resend to send the email
 * 4. Updates validationStatus to "sent" and records sentAt
 * 5. Logs the send event
 *
 * Requirements: 7.3, 7.8, 17.1
 */
export const sendApprovedEmail = internalAction({
  args: {
    messageId: v.id("messages"),
  },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    // 1. Read the message and enforce HITL invariant
    const message = await ctx.runQuery(
      internal.router.sendMessageHelpers.getMessage,
      { messageId },
    );

    if (!message) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "channel_router",
        level: "error",
        message: `Send failed: message ${messageId} not found.`,
        messageId,
      });
      return null;
    }

    // HITL invariant: only approved messages can be sent
    if (message.validationStatus !== "approved") {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "channel_router",
        level: "error",
        message: `Send blocked: message ${messageId} has validationStatus "${message.validationStatus}" — must be "approved". HITL invariant enforced.`,
        messageId,
      });
      return null;
    }

    // 2. Read the lead
    const lead = await ctx.runQuery(
      internal.router.sendMessageHelpers.getLead,
      { leadId: message.leadId },
    );

    if (!lead) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "channel_router",
        level: "error",
        message: `Send failed: lead ${message.leadId} not found for message ${messageId}.`,
        messageId,
      });
      return null;
    }

    // 2b. Blacklist check — fail-safe: block send if check fails (Requirement 17.6)
    let isRecipientBlacklisted: boolean;
    try {
      isRecipientBlacklisted = await ctx.runQuery(
        internal.compliance.blacklist.isBlacklisted,
        { email: lead.email },
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "channel_router",
        level: "error",
        message: `Send blocked (fail-safe): blacklist check failed for message ${messageId}, email ${lead.email}. Error: ${errorMessage}`,
        leadId: lead._id,
        messageId,
      });
      return null;
    }

    if (isRecipientBlacklisted) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "channel_router",
        level: "warn",
        message: `Send blocked: recipient ${lead.email} is blacklisted. Message ${messageId} will not be sent. (Requirement 17.6)`,
        leadId: lead._id,
        messageId,
      });
      return null;
    }

    // 3. Load product config for sender identity
    let product = null;
    if (lead.productId) {
      product = await ctx.runQuery(
        internal.router.sendMessageHelpers.getProductBySlug,
        { slug: lead.productId },
      );
    }

    // 4. Send via Resend API with retry and unsubscribe link
    const senderEmail = product?.senderEmail ?? "noreply@leadengine.io";
    const replyToEmail = product?.replyToEmail ?? senderEmail;
    const recipientEmail = lead.email;
    const subject = message.subject ?? "Message from LeadEngine";
    const body = message.finalContent ?? message.suggestedReply ?? "";

    // Build the unsubscribe URL for this recipient
    const unsubscribeUrl = buildUnsubscribeUrl(recipientEmail);

    // Wrap the body in the branded product email template if product config is available
    const htmlBody = product
      ? renderProductEmail({
          product: {
            productName: product.name,
            brandColor: product.brandColor,
            logoUrl: product.logoUrl,
            senderEmail: product.senderEmail,
          },
          content: {
            subject,
            body,
            unsubscribeUrl,
          },
        })
      : body;

    let resendMessageId: string | undefined;
    try {
      const result = await sendEmail({
        from: senderEmail,
        to: recipientEmail,
        replyTo: replyToEmail,
        subject,
        html: htmlBody,
        unsubscribeUrl,
      });
      resendMessageId = result.messageId;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "channel_router",
        level: "error",
        message: `Resend send failed for message ${messageId}: ${errorMessage}`,
        leadId: lead._id,
        messageId,
        metadata: {
          from: senderEmail,
          to: recipientEmail,
          error: errorMessage,
        },
      });
      return null;
    }

    // 5. Update message to "sent" and record sentAt
    const now = Date.now();
    await ctx.runMutation(
      internal.router.sendMessageHelpers.markMessageSent,
      {
        messageId,
        sentAt: now,
      },
    );

    // 6. Log the send event
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "channel_router",
      level: "info",
      message: `Email sent: message ${messageId} from ${senderEmail} to ${recipientEmail}. Resend ID: ${resendMessageId}`,
      leadId: lead._id,
      messageId,
      metadata: {
        from: senderEmail,
        to: recipientEmail,
        replyTo: replyToEmail,
        subject,
        productSlug: lead.productId,
        resendMessageId,
      },
    });

    // 7. Create outreach sequence for the initial message (Requirement 9.1)
    // Only create a sequence for the first message sent to this lead,
    // not for follow-up messages that are already part of a sequence.
    const isInitialMessage =
      message.sequenceStep === undefined || message.sequenceStep === 0;
    const isNotAlreadyInSequence = message.sequenceId === undefined;

    if (isInitialMessage && isNotAlreadyInSequence) {
      const hasSequence = await ctx.runQuery(
        internal.router.sendMessageHelpers.hasExistingSequence,
        { leadId: message.leadId },
      );

      if (!hasSequence) {
        try {
          const sequenceId = await ctx.runMutation(
            internal.engine.sequenceHelpers.createSequence,
            { leadId: message.leadId, type: "outreach" },
          );

          await ctx.runMutation(internal.logs.createLog, {
            agentType: "sequence_engine",
            level: "info",
            message: `Outreach sequence ${sequenceId} created for lead ${message.leadId} after initial message ${messageId} was sent.`,
            leadId: message.leadId,
            messageId,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          await ctx.runMutation(internal.logs.createLog, {
            agentType: "sequence_engine",
            level: "error",
            message: `Failed to create outreach sequence for lead ${message.leadId}: ${errorMessage}`,
            leadId: message.leadId,
            messageId,
          });
        }
      }
    }

    return null;
  },
});
