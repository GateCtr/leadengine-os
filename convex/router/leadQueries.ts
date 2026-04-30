import { v } from "convex/values";
import { query } from "../_generated/server";

/**
 * Lead Queries — Fetch leads for the Dashboard CRM pages.
 *
 * Requirements: 15.2, 15.4
 */

const leadStatusValidator = v.union(
  v.literal("pending_qualification"),
  v.literal("qualified"),
  v.literal("discarded"),
  v.literal("hot"),
  v.literal("pending"),
  v.literal("converted"),
  v.literal("archived"),
  v.literal("churned"),
);

const channelValidator = v.union(
  v.literal("email"),
  v.literal("twitter"),
  v.literal("linkedin"),
  v.literal("reddit"),
  v.literal("instagram"),
);

const replyCategoryValidator = v.union(
  v.literal("trop_cher"),
  v.literal("besoin_reflexion"),
  v.literal("question_technique"),
  v.literal("interet_confirme"),
  v.literal("refus"),
);

/**
 * listLeads — Fetch all leads with optional filters by status, product, and minimum score.
 * Returns leads sorted by score descending.
 */
export const listLeads = query({
  args: {
    status: v.optional(leadStatusValidator),
    productId: v.optional(v.string()),
    minScore: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("leads"),
      _creationTime: v.number(),
      name: v.optional(v.string()),
      email: v.string(),
      status: leadStatusValidator,
      score: v.optional(v.number()),
      productId: v.optional(v.string()),
      productName: v.optional(v.string()),
      detectedAt: v.number(),
      detectionChannel: v.string(),
      source: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    let leadsQuery;

    if (args.status) {
      leadsQuery = ctx.db
        .query("leads")
        .withIndex("by_status", (q) => q.eq("status", args.status!));
    } else {
      leadsQuery = ctx.db.query("leads");
    }

    const leads = await leadsQuery.collect();

    let filtered = leads;

    if (args.productId) {
      filtered = filtered.filter((l) => l.productId === args.productId);
    }
    if (args.minScore !== undefined) {
      filtered = filtered.filter(
        (l) => l.score !== undefined && l.score >= args.minScore!,
      );
    }

    // Sort by score descending
    filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Resolve product names
    const productCache = new Map<string, string>();
    const enriched = await Promise.all(
      filtered.map(async (lead) => {
        let productName: string | undefined;
        if (lead.productId) {
          if (productCache.has(lead.productId)) {
            productName = productCache.get(lead.productId);
          } else {
            const product = await ctx.db
              .query("products")
              .withIndex("by_slug", (q) => q.eq("slug", lead.productId!))
              .unique();
            productName = product?.name;
            if (productName) {
              productCache.set(lead.productId, productName);
            }
          }
        }

        return {
          _id: lead._id,
          _creationTime: lead._creationTime,
          name: lead.name,
          email: lead.email,
          status: lead.status,
          score: lead.score,
          productId: lead.productId,
          productName,
          detectedAt: lead.detectedAt,
          detectionChannel: lead.detectionChannel,
          source: lead.source,
        };
      }),
    );

    return enriched;
  },
});

/**
 * getLeadDetail — Fetch a single lead with all messages and timeline data.
 * Returns the complete prospect file for the CRM detail page.
 */
export const getLeadDetail = query({
  args: {
    leadId: v.id("leads"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("leads"),
      _creationTime: v.number(),
      name: v.optional(v.string()),
      email: v.string(),
      source: v.string(),
      sourceUrl: v.optional(v.string()),
      detectedAt: v.number(),
      detectionChannel: v.string(),
      status: leadStatusValidator,
      score: v.optional(v.number()),
      scoringBreakdown: v.optional(
        v.object({
          urgency: v.number(),
          webhookSource: v.number(),
          productMatch: v.number(),
          activeProfile: v.number(),
          contextSignals: v.number(),
        }),
      ),
      productId: v.optional(v.string()),
      productName: v.optional(v.string()),
      scoringReasoning: v.optional(v.string()),
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
      revenueGenerated: v.optional(v.number()),
      convertedAt: v.optional(v.number()),
      churnRiskScore: v.optional(v.number()),
      lastActivityAt: v.optional(v.number()),
      consentSource: v.string(),
      consentDate: v.number(),
      updatedAt: v.number(),
      messages: v.array(
        v.object({
          _id: v.id("messages"),
          _creationTime: v.number(),
          suggestedReply: v.optional(v.string()),
          finalContent: v.optional(v.string()),
          subject: v.optional(v.string()),
          channel: v.optional(channelValidator),
          validationStatus: v.string(),
          sentAt: v.optional(v.number()),
          sendAtSuggested: v.optional(v.number()),
          sequenceStep: v.optional(v.number()),
          replyContent: v.optional(v.string()),
          replyCategory: v.optional(replyCategoryValidator),
          replyReceivedAt: v.optional(v.number()),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return null;

    let productName: string | undefined;
    if (lead.productId) {
      const product = await ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", lead.productId!))
        .unique();
      productName = product?.name;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", args.leadId))
      .collect();

    // Sort messages by createdAt ascending (chronological timeline)
    messages.sort((a, b) => a.createdAt - b.createdAt);

    return {
      _id: lead._id,
      _creationTime: lead._creationTime,
      name: lead.name,
      email: lead.email,
      source: lead.source,
      sourceUrl: lead.sourceUrl,
      detectedAt: lead.detectedAt,
      detectionChannel: lead.detectionChannel,
      status: lead.status,
      score: lead.score,
      scoringBreakdown: lead.scoringBreakdown,
      productId: lead.productId,
      productName,
      scoringReasoning: lead.scoringReasoning,
      enrichmentData: lead.enrichmentData,
      revenueGenerated: lead.revenueGenerated,
      convertedAt: lead.convertedAt,
      churnRiskScore: lead.churnRiskScore,
      lastActivityAt: lead.lastActivityAt,
      consentSource: lead.consentSource,
      consentDate: lead.consentDate,
      updatedAt: lead.updatedAt,
      messages: messages.map((msg) => ({
        _id: msg._id,
        _creationTime: msg._creationTime,
        suggestedReply: msg.suggestedReply,
        finalContent: msg.finalContent,
        subject: msg.subject,
        channel: msg.channel,
        validationStatus: msg.validationStatus,
        sentAt: msg.sentAt,
        sendAtSuggested: msg.sendAtSuggested,
        sequenceStep: msg.sequenceStep,
        replyContent: msg.replyContent,
        replyCategory: msg.replyCategory,
        replyReceivedAt: msg.replyReceivedAt,
        createdAt: msg.createdAt,
      })),
    };
  },
});
