/**
 * Agent Radar — Acquisition Web
 *
 * Detects potential leads on the web via Serper.dev keyword searches
 * and inserts them into the Convex database for qualification.
 *
 * Triggered by a periodic cron job (every 2 hours).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 17.3
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { searchAndParseLeads } from "../integrations/serper";

// ─── Helper: Load radar keywords from prompt_configs ─────────────────────────

/**
 * Load all active radar prompt_configs and extract their keywords.
 * Returns a flat array of keyword strings to search for.
 */
export const getRadarKeywords = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx): Promise<string[]> => {
    const configs = await ctx.db
      .query("prompt_configs")
      .withIndex("by_agentType", (q) => q.eq("agentType", "radar"))
      .take(100);

    const keywords: string[] = [];
    for (const config of configs) {
      if (config.isActive && config.keywords) {
        for (const kw of config.keywords) {
          if (kw.trim().length > 0) {
            keywords.push(kw.trim());
          }
        }
      }
    }
    return keywords;
  },
});

// ─── Helper: Check if lead email already exists ──────────────────────────────

/**
 * Check if a lead with the given email already exists in the database.
 * Uses the by_email index for efficient lookup.
 */
export const checkLeadExists = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }): Promise<boolean> => {
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    return existing !== null;
  },
});

// ─── Helper: Insert a single radar lead (with deduplication) ─────────────────

/**
 * Insert a lead detected by the radar into the database.
 * Deduplicates by checking if a lead with the same email already exists.
 * Only inserts leads that have a valid email.
 *
 * Returns the lead ID if inserted, or null if skipped (duplicate or no email).
 */
export const insertRadarLead = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    sourceUrl: v.string(),
    detectionChannel: v.string(),
  },
  returns: v.union(v.id("leads"), v.null()),
  handler: async (ctx, args) => {
    // Deduplication: check if lead with same email already exists
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing !== null) {
      return null;
    }

    const now = Date.now();

    const leadId = await ctx.db.insert("leads", {
      email: args.email,
      name: args.name,
      source: "radar",
      sourceUrl: args.sourceUrl,
      detectedAt: now,
      detectionChannel: args.detectionChannel,
      status: "pending_qualification",
      consentSource: "web_scraping",
      consentDate: now,
      updatedAt: now,
    });

    // Schedule the Agent Qualificateur to qualify this lead immediately.
    // Using ctx.scheduler.runAfter(0, ...) ensures every radar lead
    // entering pending_qualification is automatically queued for qualification.
    // (Requirement 4.1: trigger réactif Convex)
    await ctx.scheduler.runAfter(
      0,
      internal.agents.qualifier.qualifyLead,
      { leadId },
    );

    return leadId;
  },
});

// ─── Main Action: Run Radar Scan ─────────────────────────────────────────────

/**
 * Main radar scan action.
 *
 * 1. Load keywords from prompt_configs
 * 2. Execute Serper.dev searches for each keyword
 * 3. Deduplicate candidates by email (in-memory + DB check)
 * 4. Insert new leads with status pending_qualification
 * 5. Log errors via createLog
 */
export const runRadarScan = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // 1. Load keywords from prompt_configs
    const keywords: string[] = await ctx.runQuery(
      internal.agents.radar.getRadarKeywords,
    );

    if (keywords.length === 0) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "radar",
        level: "warn",
        message: "No radar keywords found in prompt_configs. Skipping scan.",
      });
      return null;
    }

    // Track emails seen in this scan to deduplicate across keywords
    const seenEmails = new Set<string>();
    let totalInserted = 0;
    let totalSkipped = 0;

    // 2. Execute Serper.dev searches for each keyword
    for (const keyword of keywords) {
      try {
        const candidates = await searchAndParseLeads({
          q: keyword,
          num: 20,
          gl: "fr",
          hl: "fr",
        });

        // 3. Process each candidate
        for (const candidate of candidates) {
          // Skip candidates without email
          if (!candidate.email) {
            totalSkipped++;
            continue;
          }

          const email = candidate.email.toLowerCase();

          // In-memory deduplication across keywords in this scan
          if (seenEmails.has(email)) {
            totalSkipped++;
            continue;
          }
          seenEmails.add(email);

          // 4. Insert lead (mutation handles DB-level deduplication)
          try {
            const leadId = await ctx.runMutation(
              internal.agents.radar.insertRadarLead,
              {
                email,
                name: candidate.name ?? undefined,
                sourceUrl: candidate.sourceUrl,
                detectionChannel: candidate.detectionChannel,
              },
            );

            if (leadId !== null) {
              totalInserted++;
            } else {
              totalSkipped++;
            }
          } catch (insertError) {
            await ctx.runMutation(internal.logs.createLog, {
              agentType: "radar",
              level: "error",
              message: `Failed to insert lead for email ${email}: ${
                insertError instanceof Error
                  ? insertError.message
                  : String(insertError)
              }`,
              metadata: { keyword, email },
            });
          }
        }
      } catch (searchError) {
        // 5. Log Serper.dev errors — continue with next keyword
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "radar",
          level: "error",
          message: `Serper.dev search failed for keyword "${keyword}": ${
            searchError instanceof Error
              ? searchError.message
              : String(searchError)
          }`,
          metadata: {
            keyword,
            errorType:
              searchError instanceof Error
                ? searchError.constructor.name
                : "unknown",
          },
        });
      }
    }

    // Log scan summary
    await ctx.runMutation(internal.logs.createLog, {
      agentType: "radar",
      level: "info",
      message: `Radar scan completed: ${totalInserted} leads inserted, ${totalSkipped} skipped (duplicates or no email). Keywords scanned: ${keywords.length}.`,
      metadata: {
        totalInserted,
        totalSkipped,
        keywordsScanned: keywords.length,
      },
    });

    return null;
  },
});
