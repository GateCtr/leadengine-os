import { v } from "convex/values";
import { mutation } from "../_generated/server";

/**
 * GDPR Right to Erasure — Delete all prospect data in one click.
 *
 * Deletes a lead and ALL associated data across related tables:
 * tracking_events, short_urls, messages, sequences, testimonials, notifications.
 * Then adds the email to the blacklist to prevent future contact.
 *
 * Runs as a single Convex transaction — all-or-nothing.
 *
 * Requirements: 17.5
 */

const DELETE_BATCH = 500;

export const deleteProspectData = mutation({
  args: {
    leadId: v.id("leads"),
  },
  returns: v.object({
    email: v.string(),
    messagesDeleted: v.number(),
    sequencesDeleted: v.number(),
    trackingEventsDeleted: v.number(),
    shortUrlsDeleted: v.number(),
    testimonialsDeleted: v.number(),
    notificationsDeleted: v.number(),
  }),
  handler: async (ctx, { leadId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required to delete prospect data.");
    }

    const lead = await ctx.db.get(leadId);
    if (!lead) {
      throw new Error(`Lead ${leadId} not found.`);
    }

    const email = lead.email;
    let messagesDeleted = 0;
    let sequencesDeleted = 0;
    let trackingEventsDeleted = 0;
    let shortUrlsDeleted = 0;
    let testimonialsDeleted = 0;
    let notificationsDeleted = 0;

    // 1. Delete tracking_events for this lead
    const trackingEvents = await ctx.db
      .query("tracking_events")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(DELETE_BATCH);
    for (const event of trackingEvents) {
      await ctx.db.delete(event._id);
      trackingEventsDeleted++;
    }

    // 2. Delete short_urls for this lead
    const shortUrls = await ctx.db
      .query("short_urls")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(DELETE_BATCH);
    for (const url of shortUrls) {
      await ctx.db.delete(url._id);
      shortUrlsDeleted++;
    }

    // 3. Delete messages for this lead
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(DELETE_BATCH);
    for (const message of messages) {
      await ctx.db.delete(message._id);
      messagesDeleted++;
    }

    // 4. Delete sequences for this lead
    const sequences = await ctx.db
      .query("sequences")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(DELETE_BATCH);
    for (const sequence of sequences) {
      await ctx.db.delete(sequence._id);
      sequencesDeleted++;
    }

    // 5. Delete testimonials for this lead
    const testimonials = await ctx.db
      .query("testimonials")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(DELETE_BATCH);
    for (const testimonial of testimonials) {
      await ctx.db.delete(testimonial._id);
      testimonialsDeleted++;
    }

    // 6. Delete notifications for this lead
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
      .take(DELETE_BATCH);
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
      notificationsDeleted++;
    }

    // 7. Delete the lead itself
    await ctx.db.delete(leadId);

    // 8. Add email to blacklist to prevent future contact (GDPR)
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await ctx.db
      .query("blacklist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();

    if (!existing) {
      await ctx.db.insert("blacklist", {
        email: normalizedEmail,
        reason: "gdpr_request",
        addedAt: Date.now(),
      });
    }

    return {
      email,
      messagesDeleted,
      sequencesDeleted,
      trackingEventsDeleted,
      shortUrlsDeleted,
      testimonialsDeleted,
      notificationsDeleted,
    };
  },
});
