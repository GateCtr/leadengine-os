/**
 * Enrichment Pipeline — Firecrawl Profile Scraping for Leads
 *
 * Triggers Firecrawl scraping when a lead reaches `pending_qualification` or `qualified`.
 * Stores enrichment data in the lead's `enrichmentData` field.
 * Fail-safe: continues the pipeline even if enrichment fails.
 *
 * Requirements: 3.1, 3.2, 3.3
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  scrapeAndEnrichProfile,
  type EnrichmentData,
} from "./integrations/firecrawl";

// ─── Helper: Read lead for enrichment ────────────────────────────────────────

/**
 * Read a lead from the database for enrichment processing.
 * Returns the lead document or null if not found.
 */
export const getLeadForEnrichment = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.union(
    v.object({
      _id: v.id("leads"),
      email: v.string(),
      name: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      status: v.string(),
      enrichmentData: v.optional(
        v.object({
          linkedinUrl: v.optional(v.string()),
          githubUrl: v.optional(v.string()),
          websiteUrl: v.optional(v.string()),
          bio: v.optional(v.string()),
          skills: v.optional(v.array(v.string())),
          company: v.optional(v.string()),
          role: v.optional(v.string()),
          scrapedAt: v.optional(v.number()),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead) return null;

    return {
      _id: lead._id,
      email: lead.email,
      name: lead.name,
      sourceUrl: lead.sourceUrl,
      status: lead.status,
      enrichmentData: lead.enrichmentData,
    };
  },
});

// ─── Helper: Update lead with enrichment data ────────────────────────────────

/**
 * Patch a lead document with enrichment data from Firecrawl scraping.
 * Merges new enrichment data with any existing data.
 */
export const updateLeadEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    enrichmentData: v.object({
      linkedinUrl: v.optional(v.string()),
      githubUrl: v.optional(v.string()),
      websiteUrl: v.optional(v.string()),
      bio: v.optional(v.string()),
      skills: v.optional(v.array(v.string())),
      company: v.optional(v.string()),
      role: v.optional(v.string()),
      scrapedAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { leadId, enrichmentData }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead) return null;

    // Merge with existing enrichment data — new data takes precedence
    // but we keep existing fields that are not overwritten
    const existing = lead.enrichmentData ?? {};
    const merged: EnrichmentData = {
      linkedinUrl: enrichmentData.linkedinUrl ?? existing.linkedinUrl,
      githubUrl: enrichmentData.githubUrl ?? existing.githubUrl,
      websiteUrl: enrichmentData.websiteUrl ?? existing.websiteUrl,
      bio: enrichmentData.bio ?? existing.bio,
      skills: enrichmentData.skills ?? existing.skills,
      company: enrichmentData.company ?? existing.company,
      role: enrichmentData.role ?? existing.role,
      scrapedAt: enrichmentData.scrapedAt ?? existing.scrapedAt,
    };

    await ctx.db.patch(leadId, {
      enrichmentData: merged,
      updatedAt: Date.now(),
    });

    return null;
  },
});

// ─── Helper: Build URLs to scrape from lead data ─────────────────────────────

/**
 * Determine which URLs to scrape based on lead data.
 * Priority: sourceUrl first, then construct LinkedIn/GitHub URLs from name/email.
 */
export function buildUrlsToScrape(lead: {
  email: string;
  name?: string;
  sourceUrl?: string;
  enrichmentData?: EnrichmentData;
}): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // 1. Use sourceUrl if available
  if (lead.sourceUrl && lead.sourceUrl.trim().length > 0) {
    urls.push(lead.sourceUrl);
    seen.add(lead.sourceUrl.toLowerCase());
  }

  // 2. Use existing enrichment URLs if available (e.g., from a previous partial scrape)
  if (lead.enrichmentData?.linkedinUrl) {
    const url = lead.enrichmentData.linkedinUrl;
    if (!seen.has(url.toLowerCase())) {
      urls.push(url);
      seen.add(url.toLowerCase());
    }
  }
  if (lead.enrichmentData?.githubUrl) {
    const url = lead.enrichmentData.githubUrl;
    if (!seen.has(url.toLowerCase())) {
      urls.push(url);
      seen.add(url.toLowerCase());
    }
  }

  // 3. Construct LinkedIn URL from name if we don't already have one
  const hasLinkedin = urls.some((u) =>
    u.toLowerCase().includes("linkedin.com"),
  );
  if (!hasLinkedin && lead.name) {
    const slug = lead.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    if (slug.length > 0) {
      const linkedinUrl = `https://www.linkedin.com/in/${slug}`;
      if (!seen.has(linkedinUrl.toLowerCase())) {
        urls.push(linkedinUrl);
        seen.add(linkedinUrl.toLowerCase());
      }
    }
  }

  // 4. Construct GitHub URL from email username if we don't already have one
  const hasGithub = urls.some((u) => u.toLowerCase().includes("github.com"));
  if (!hasGithub && lead.email) {
    const username = lead.email.split("@")[0];
    if (username && username.length > 0) {
      const githubUrl = `https://github.com/${username}`;
      if (!seen.has(githubUrl.toLowerCase())) {
        urls.push(githubUrl);
        seen.add(githubUrl.toLowerCase());
      }
    }
  }

  return urls;
}

// ─── Main Action: Enrich Lead ────────────────────────────────────────────────

/**
 * Enrich a lead by scraping public profile URLs via Firecrawl.
 *
 * This is an internalAction because it makes external HTTP calls (Firecrawl API).
 * It uses ctx.runQuery to read the lead and ctx.runMutation to update it.
 *
 * Fail-safe: if Firecrawl fails for any URL, the error is logged and the
 * pipeline continues with whatever data was successfully scraped.
 *
 * Requirements: 3.1, 3.2, 3.3
 */
export const enrichLead = internalAction({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    // 1. Read the lead from DB
    const lead = await ctx.runQuery(internal.enrichment.getLeadForEnrichment, {
      leadId,
    });

    if (!lead) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "warn",
        message: `Enrichment skipped: lead ${leadId} not found.`,
        leadId,
      });
      return null;
    }

    // 2. Only enrich leads in pending_qualification or qualified status
    if (
      lead.status !== "pending_qualification" &&
      lead.status !== "qualified"
    ) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "info",
        message: `Enrichment skipped: lead ${leadId} has status "${lead.status}" (expected pending_qualification or qualified).`,
        leadId,
      });
      return null;
    }

    // 3. Determine URLs to scrape
    const urlsToScrape = buildUrlsToScrape({
      email: lead.email,
      name: lead.name,
      sourceUrl: lead.sourceUrl,
      enrichmentData: lead.enrichmentData ?? undefined,
    });

    if (urlsToScrape.length === 0) {
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "info",
        message: `Enrichment skipped: no URLs to scrape for lead ${leadId}.`,
        leadId,
      });
      return null;
    }

    // 4. Scrape each URL and merge results (fail-safe per URL)
    let mergedData: EnrichmentData = {};
    let successCount = 0;
    let failCount = 0;

    for (const url of urlsToScrape) {
      try {
        const data = await scrapeAndEnrichProfile(url);

        if (data) {
          // Merge: first non-null value wins for each field
          mergedData = {
            linkedinUrl: mergedData.linkedinUrl ?? data.linkedinUrl,
            githubUrl: mergedData.githubUrl ?? data.githubUrl,
            websiteUrl: mergedData.websiteUrl ?? data.websiteUrl,
            bio: mergedData.bio ?? data.bio,
            skills: mergedData.skills ?? data.skills,
            company: mergedData.company ?? data.company,
            role: mergedData.role ?? data.role,
            scrapedAt: data.scrapedAt ?? Date.now(),
          };
          successCount++;
        }
      } catch (error) {
        failCount++;
        // Fail-safe: log the error and continue with next URL
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "qualifier",
          level: "warn",
          message: `Firecrawl scraping failed for URL "${url}" (lead ${leadId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          leadId,
          metadata: {
            url,
            errorType:
              error instanceof Error ? error.constructor.name : "unknown",
          },
        });
      }
    }

    // 5. Store enrichment data if we got anything
    if (successCount > 0) {
      // Ensure scrapedAt is set
      if (!mergedData.scrapedAt) {
        mergedData.scrapedAt = Date.now();
      }

      await ctx.runMutation(internal.enrichment.updateLeadEnrichment, {
        leadId,
        enrichmentData: mergedData,
      });

      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "info",
        message: `Enrichment completed for lead ${leadId}: ${successCount} URL(s) scraped successfully, ${failCount} failed.`,
        leadId,
        metadata: {
          successCount,
          failCount,
          urlsScraped: urlsToScrape.length,
        },
      });
    } else if (failCount > 0) {
      // All URLs failed — log but don't block the pipeline (fail-safe)
      await ctx.runMutation(internal.logs.createLog, {
        agentType: "qualifier",
        level: "warn",
        message: `Enrichment failed for all ${failCount} URL(s) for lead ${leadId}. Pipeline continues without enrichment data.`,
        leadId,
        metadata: {
          failCount,
          urlsAttempted: urlsToScrape.length,
        },
      });
    }

    return null;
  },
});
