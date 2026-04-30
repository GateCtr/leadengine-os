import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

/**
 * GDPR Data Retention Cleanup — Archived Leads (12 months)
 *
 * Deletes leads that have been archived for more than 12 months, along with
 * all their associated data (messages, sequences, tracking_events, short_urls).
 *
 * Processing strategy:
 * - Fetches stale leads in batches to stay within Convex transaction limits
 * - Deletes each lead and its associated data in a separate mutation (transaction)
 * - If more leads remain after a batch, schedules itself to continue processing
 * - Leads that fail to delete are logged and retried on the next cron cycle
 *
 * Trigger: Monthly cron job registered in convex/crons.ts
 *
 * Requirements: 17.4
 */

/** 12 months in milliseconds (365 days to be safe). */
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Main cleanup action: find and delete archived leads older than 12 months.
 *
 * Processes leads in batches. After each batch, if more stale leads exist,
 * schedules itself to continue (avoids action timeout on large datasets).
 *
 * Requirements: 17.4
 */
export const cleanupArchivedLeads = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffTimestamp = now - TWELVE_MONTHS_MS;

    // Fetch a batch of stale archived leads
    const staleLeadIds = await ctx.runQuery(
      internal.compliance.cleanupHelpers.getStaleArchivedLeads,
      { cutoffTimestamp },
    );

    if (staleLeadIds.length === 0) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "sequence_engine",
        level: "info",
        message: "GDPR cleanup: no archived leads older than 12 months found.",
      });
      return null;
    }

    let totalDeleted = 0;
    let totalMessages = 0;
    let totalSequences = 0;
    let totalTrackingEvents = 0;
    let totalShortUrls = 0;

    for (const leadId of staleLeadIds) {
      try {
        const result = await ctx.runMutation(
          internal.compliance.cleanupHelpers.deleteLeadAndAssociatedData,
          { leadId },
        );
        totalDeleted++;
        totalMessages += result.messagesDeleted;
        totalSequences += result.sequencesDeleted;
        totalTrackingEvents += result.trackingEventsDeleted;
        totalShortUrls += result.shortUrlsDeleted;
      } catch (error) {
        // Log the error but continue with other leads (isolation principle)
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "sequence_engine",
          level: "error",
          message: `GDPR cleanup: failed to delete lead ${leadId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          leadId,
        });
      }
    }

    // Log the cleanup summary
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "sequence_engine",
      level: "info",
      message: `GDPR cleanup completed: ${totalDeleted}/${staleLeadIds.length} leads deleted (${totalMessages} messages, ${totalSequences} sequences, ${totalTrackingEvents} tracking events, ${totalShortUrls} short URLs).`,
      metadata: {
        totalLeadsDeleted: totalDeleted,
        totalMessages,
        totalSequences,
        totalTrackingEvents,
        totalShortUrls,
        batchSize: staleLeadIds.length,
        cutoffTimestamp,
      },
    });

    // If we processed a full batch, there may be more — schedule a continuation
    if (staleLeadIds.length >= 100) {
      await ctx.scheduler.runAfter(
        0,
        internal.compliance.cleanup.cleanupArchivedLeads,
        {},
      );
    }

    return null;
  },
});
