import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Testimonials — Collecte et gestion des témoignages clients
 *
 * Provides:
 * - Public mutation to submit a testimonial (from email link or form)
 * - Internal mutation to store testimonials from the sequence engine
 * - Dashboard mutations to validate/reject testimonials
 * - Dashboard query to list testimonials for management
 * - Query for validated testimonials by product (used by Copywriter)
 *
 * Requirements: 19.1, 19.2, 19.3
 */

// ─── Public Mutations (Dashboard) ────────────────────────────────────────────

/**
 * Submit a new testimonial. Called from the public testimonial submission
 * form/page or via the HTTP endpoint.
 *
 * Requirements: 19.1
 */
export const submitTestimonial = internalMutation({
  args: {
    leadId: v.id("leads"),
    productId: v.string(),
    content: v.string(),
    authorName: v.optional(v.string()),
  },
  returns: v.id("testimonials"),
  handler: async (ctx, args) => {
    const now = Date.now();

    const testimonialId = await ctx.db.insert("testimonials", {
      leadId: args.leadId,
      productId: args.productId,
      content: args.content,
      authorName: args.authorName,
      isValidated: false,
      createdAt: now,
    });

    await ctx.db.insert("agent_logs", {
      agentType: "sequence_engine",
      level: "info",
      message: `Testimonial received from lead ${args.leadId} for product ${args.productId}.`,
      leadId: args.leadId,
      timestamp: now,
    });

    return testimonialId;
  },
});

/**
 * Validate a testimonial — marks it as approved and available for
 * injection into Copywriter prompts and landing pages.
 *
 * Requirements: 19.2
 */
export const validateTestimonial = mutation({
  args: { testimonialId: v.id("testimonials") },
  returns: v.null(),
  handler: async (ctx, { testimonialId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const testimonial = await ctx.db.get(testimonialId);
    if (!testimonial) {
      throw new Error("Testimonial not found");
    }

    await ctx.db.patch(testimonialId, {
      isValidated: true,
      validatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Reject (delete) a testimonial.
 *
 * Requirements: 19.2
 */
export const rejectTestimonial = mutation({
  args: { testimonialId: v.id("testimonials") },
  returns: v.null(),
  handler: async (ctx, { testimonialId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const testimonial = await ctx.db.get(testimonialId);
    if (!testimonial) {
      throw new Error("Testimonial not found");
    }

    await ctx.db.delete(testimonialId);

    return null;
  },
});

// ─── Dashboard Queries ───────────────────────────────────────────────────────

/**
 * List all testimonials for the Dashboard management interface.
 * Returns testimonials with lead and product info, sorted by creation date (newest first).
 *
 * Requirements: 19.2
 */
export const listAllTestimonials = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("testimonials"),
      leadId: v.id("leads"),
      productId: v.string(),
      content: v.string(),
      authorName: v.optional(v.string()),
      isValidated: v.boolean(),
      validatedAt: v.optional(v.number()),
      createdAt: v.number(),
      leadEmail: v.optional(v.string()),
      productName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const testimonials = await ctx.db
      .query("testimonials")
      .order("desc")
      .take(100);

    const enriched = await Promise.all(
      testimonials.map(async (t) => {
        const lead = await ctx.db.get(t.leadId);
        const product = await ctx.db
          .query("products")
          .withIndex("by_slug", (q) => q.eq("slug", t.productId))
          .unique();

        return {
          _id: t._id,
          leadId: t.leadId,
          productId: t.productId,
          content: t.content,
          authorName: t.authorName,
          isValidated: t.isValidated,
          validatedAt: t.validatedAt,
          createdAt: t.createdAt,
          leadEmail: lead?.email,
          productName: product?.name,
        };
      }),
    );

    return enriched;
  },
});

/**
 * Get validated testimonials for a specific product.
 * Public query used by landing pages to display social proof.
 *
 * Requirements: 19.3
 */
export const getValidatedByProduct = query({
  args: { productId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("testimonials"),
      content: v.string(),
      authorName: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { productId }) => {
    const testimonials = await ctx.db
      .query("testimonials")
      .withIndex("by_productId_isValidated", (q) =>
        q.eq("productId", productId).eq("isValidated", true),
      )
      .take(10);

    return testimonials.map((t) => ({
      _id: t._id,
      content: t.content,
      authorName: t.authorName,
      createdAt: t.createdAt,
    }));
  },
});

// ─── Internal: Testimonial Collection Email ──────────────────────────────────

/**
 * Trigger testimonial collection email for a converted lead.
 * Creates a message through the standard pipeline (Channel Router → Timing → HITL).
 *
 * Called by the Sequence Engine at J+14 of the onboarding sequence,
 * or can be triggered manually.
 *
 * Requirements: 19.1
 */
export const triggerTestimonialCollection = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    const now = Date.now();

    const lead = await ctx.db.get(leadId);
    if (!lead || !lead.productId) {
      return null;
    }

    // Don't send if lead is not in a converted/active state
    if (lead.status !== "converted") {
      return null;
    }

    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", lead.productId!))
      .unique();

    if (!product) {
      return null;
    }

    const leadName = lead.name ?? lead.email.split("@")[0];

    // Build the testimonial collection email
    const subject = `${leadName}, partagez votre expérience avec ${product.name}`;
    const body = `Bonjour ${leadName},

Cela fait maintenant quelques semaines que vous utilisez ${product.name}, et nous espérons que tout se passe bien !

Votre avis compte énormément pour nous. Pourriez-vous prendre 2 minutes pour partager votre expérience ?

Répondez simplement à cet email avec :
1. Ce que ${product.name} a changé pour vous
2. Le résultat concret que vous avez obtenu
3. Ce que vous diriez à quelqu'un qui hésite

Votre témoignage pourra être utilisé (avec votre accord) pour aider d'autres professionnels à découvrir ${product.name}.

Merci pour votre confiance,
L'équipe ${product.name}`;

    // Insert the testimonial collection message through the standard pipeline
    const messageId = await ctx.db.insert("messages", {
      leadId,
      suggestedReply: body,
      subject,
      tone: "support",
      sequenceStep: -2, // Testimonial collection marker
      validationStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Trigger Channel Router for brand identity and delivery channel
    await ctx.scheduler.runAfter(
      0,
      internal.router.channelRouter.routeMessage,
      { messageId },
    );

    await ctx.db.insert("agent_logs", {
      agentType: "sequence_engine",
      level: "info",
      message: `Testimonial collection email created for lead ${leadId} (${lead.email}, product: ${lead.productId}).`,
      leadId,
      timestamp: now,
      metadata: {
        messageId,
        productSlug: lead.productId,
      },
    });

    return null;
  },
});


// ─── Internal helpers for HTTP endpoint ──────────────────────────────────────

/**
 * Get lead info for the testimonial form (used by HTTP GET handler).
 */
export const getLeadInfoForForm = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.union(
    v.object({
      productName: v.string(),
      leadName: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);

    if (!lead || !lead.productId) {
      return null;
    }

    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", lead.productId!))
      .unique();

    return {
      productName: product?.name ?? lead.productId,
      leadName: lead.name ?? undefined,
    };
  },
});

/**
 * Submit a testimonial from the HTTP endpoint.
 * Validates the lead exists and has a productId before storing.
 */
export const submitTestimonialFromHttp = internalMutation({
  args: {
    leadId: v.id("leads"),
    content: v.string(),
    authorName: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    testimonialId: v.optional(v.id("testimonials")),
  }),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    if (!lead.productId) {
      return { success: false, error: "Lead has no product assigned" };
    }

    const now = Date.now();
    const testimonialId = await ctx.db.insert("testimonials", {
      leadId: args.leadId,
      productId: lead.productId,
      content: args.content,
      authorName: args.authorName ?? lead.name,
      isValidated: false,
      createdAt: now,
    });

    await ctx.db.insert("agent_logs", {
      agentType: "sequence_engine",
      level: "info",
      message: `Testimonial submitted via form by lead ${args.leadId} for product ${lead.productId}.`,
      leadId: args.leadId,
      timestamp: now,
    });

    return { success: true, testimonialId };
  },
});
