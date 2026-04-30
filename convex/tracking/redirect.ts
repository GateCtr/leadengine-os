import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

/**
 * Internal query to check if a lead's email is on the blacklist.
 *
 * Looks up the lead by ID, then checks the blacklist table for the lead's email.
 * Returns true if the lead is blacklisted, false otherwise.
 *
 * Requirements: 18.4
 */
export const isLeadBlacklisted = internalQuery({
  args: {
    leadId: v.id("leads"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return false;
    }

    const blacklistEntry = await ctx.db
      .query("blacklist")
      .withIndex("by_email", (q) => q.eq("email", lead.email))
      .unique();

    return blacklistEntry !== null;
  },
});
