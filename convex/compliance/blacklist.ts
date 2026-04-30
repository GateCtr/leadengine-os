import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Blacklist Management — GDPR/CAN-SPAM Compliance
 *
 * Manages the blacklist of unsubscribed prospects. Any email on the blacklist
 * must be excluded from all outgoing messages and behavioral tracking.
 *
 * Requirements: 17.2 (immediate blacklist on unsubscribe click),
 *               17.6 (verify blacklist before every send)
 */

/**
 * Add an email to the blacklist immediately.
 *
 * Called when a prospect clicks the unsubscribe link. Idempotent: if the email
 * is already blacklisted, this is a no-op and returns the existing entry ID.
 *
 * Requirements: 17.2
 */
export const addToBlacklist = internalMutation({
  args: {
    email: v.string(),
    reason: v.union(
      v.literal("unsubscribe"),
      v.literal("manual_removal"),
      v.literal("gdpr_request"),
    ),
  },
  returns: v.id("blacklist"),
  handler: async (ctx, { email, reason }) => {
    const normalizedEmail = email.toLowerCase().trim();

    // Idempotent: check if already blacklisted
    const existing = await ctx.db
      .query("blacklist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();

    if (existing) {
      return existing._id;
    }

    const id = await ctx.db.insert("blacklist", {
      email: normalizedEmail,
      reason,
      addedAt: Date.now(),
    });

    return id;
  },
});

/**
 * Check if an email is on the blacklist.
 *
 * Used as a pre-send check before any message is dispatched. The fail-safe
 * principle applies: if this query cannot determine the status, the caller
 * should block the send.
 *
 * Requirements: 17.6
 */
export const isBlacklisted = internalQuery({
  args: {
    email: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { email }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const entry = await ctx.db
      .query("blacklist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();

    return entry !== null;
  },
});
