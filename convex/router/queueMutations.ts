import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";

/**
 * Queue Mutations — Approve, reject, or edit messages from the validation queue.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.8
 */

/**
 * Approve a message: set validationStatus to "approved",
 * record the validating user and timestamp.
 *
 * For email messages: schedules the sendApprovedEmail action to send via Resend.
 * For social messages: marks as approved — the Dashboard displays the socialDirectLink.
 *
 * Requirements: 7.3, 7.4, 7.8
 */
export const approveMessage = mutation({
  args: {
    messageId: v.id("messages"),
  },
  returns: v.object({
    channel: v.optional(v.string()),
    socialDirectLink: v.optional(v.string()),
  }),
  handler: async (ctx, { messageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required to approve messages.");
    }

    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found.`);
    }

    if (message.validationStatus !== "pending_validation") {
      throw new Error(
        `Message ${messageId} is not pending validation (current: ${message.validationStatus}).`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(messageId, {
      validationStatus: "approved",
      validatedBy: identity.tokenIdentifier,
      validatedAt: now,
      finalContent: message.suggestedReply,
      updatedAt: now,
    });

    if (message.channel === "email") {
      // Schedule the email send action — it will transition to "sent" after delivery
      await ctx.scheduler.runAfter(
        0,
        internal.router.sendMessage.sendApprovedEmail,
        { messageId },
      );
    }
    // For social channels (twitter, linkedin, reddit, instagram):
    // The message stays "approved" — the Dashboard shows the socialDirectLink
    // for the operator to send manually on the platform.

    return {
      channel: message.channel ?? undefined,
      socialDirectLink: message.socialDirectLink ?? undefined,
    };
  },
});

/**
 * Reject a message: set validationStatus to "rejected",
 * record the validating user and timestamp.
 */
export const rejectMessage = mutation({
  args: {
    messageId: v.id("messages"),
  },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required to reject messages.");
    }

    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found.`);
    }

    if (message.validationStatus !== "pending_validation") {
      throw new Error(
        `Message ${messageId} is not pending validation (current: ${message.validationStatus}).`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(messageId, {
      validationStatus: "rejected",
      validatedBy: identity.tokenIdentifier,
      validatedAt: now,
      updatedAt: now,
    });

    return null;
  },
});

/**
 * Edit a message's content and keep it in pending_validation.
 */
export const editMessage = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, content }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required to edit messages.");
    }

    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found.`);
    }

    if (message.validationStatus !== "pending_validation") {
      throw new Error(
        `Message ${messageId} is not pending validation (current: ${message.validationStatus}).`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(messageId, {
      suggestedReply: content,
      updatedAt: now,
    });

    return null;
  },
});
