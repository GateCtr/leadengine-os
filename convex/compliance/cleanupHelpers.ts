import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Cleanup Helpers — GDPR Data Retention (12 months)
 *
 * Internal queries and mutations used by the cleanup action to find and
 * delete archived leads and all their associated data.
 *
 * Requirements: 17.4 (automatic deletion of archived leads after 12 months)
 */

/** Batch size for each deletion pass to stay within Convex transaction limits. */
const BATCH_SIZE = 100;

/**
 * Find a batch of leads that have been archived for more than 12 months.
 *
 * Uses the `by_status` index to efficiently query only archived leads,
 * then filters by `updatedAt` to find those older than the cutoff.
 *
 * Returns up to BATCH_SIZE lead IDs for processing.
 */
export const getStaleArchivedLeads = internalQuery({
  args: {
    cutoffTimestamp: v.number(),
  },
  returns: v.array(v.id("leads")),
  handler: async (ctx, { cutoffTimestamp }) => {
    const archivedLeads = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "archived"))
      .take(BATCH_SIZE);

    // Filter to only those archived before the cutoff (12 months ago)
    const staleLeadIds = archivedLeads
      .filter((lead) => lead.updatedAt <= cutoffTimestamp)
      .map((lead) => lead._id);

    return staleLeadIds;
  },
});

/**
 * Delete a single lead and ALL associated data across related tables.
 *
 * Deletes in order: tracking_events, short_urls, messages, sequences,
 * then the lead itself. Each related table is queried by the lead's ID
 * using the appropriate index.
 *
 * This runs as a single Convex transaction — all-or-nothing.
 */
export const deleteLeadAndAssociatedData = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  returns: v.object({
    messagesDeleted: v.number(),
    sequencesDeleted: v.number(),
    trackingEventsDeleted: v.number(),
    shortUrlsDeleted: v.number(),
  }),
  handler: async (ctx, { leadId }) => {
    let messagesDeleted = 0;
    let sequencesDeleted = 0;
    let trackingEventsDeleted = 0;
    let shortUrlsDeleted = 0;

    // 1. Delete tracking_events for this lead
    const trackingEvents = await ctx.db
      .query("tracking_events")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(500);
    for (const event of trackingEvents) {
      await ctx.db.delete(event._id);
      trackingEventsDeleted++;
    }

    // 2. Delete short_urls for this lead
    const shortUrls = await ctx.db
      .query("short_urls")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(500);
    for (const url of shortUrls) {
      await ctx.db.delete(url._id);
      shortUrlsDeleted++;
    }

    // 3. Delete messages for this lead
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(500);
    for (const message of messages) {
      await ctx.db.delete(message._id);
      messagesDeleted++;
    }

    // 4. Delete sequences for this lead
    const sequences = await ctx.db
      .query("sequences")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(500);
    for (const sequence of sequences) {
      await ctx.db.delete(sequence._id);
      sequencesDeleted++;
    }

    // 5. Delete the lead itself
    await ctx.db.delete(leadId);

    return {
      messagesDeleted,
      sequencesDeleted,
      trackingEventsDeleted,
      shortUrlsDeleted,
    };
  },
});
