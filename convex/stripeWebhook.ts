"use node";

/**
 * Stripe Webhook Processing — Conversion & Revenue Tracking
 *
 * Handles Stripe webhook events (checkout.session.completed) to:
 * 1. Validate the webhook signature using Stripe's SDK
 * 2. Update the lead status to `converted` with revenue data
 * 3. Trigger an onboarding sequence (J0, J1, J3, J7, J14)
 * 4. Log unmatched webhooks for investigation
 *
 * This file uses "use node" because Stripe's `constructEvent` relies on
 * Node.js crypto. Only actions can be exported from this file.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import Stripe from "stripe";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/**
 * Process a raw Stripe webhook request.
 *
 * This action is called from the HTTP route in http.ts. It receives the raw
 * body and signature header, verifies the signature, and processes the event.
 *
 * Pipeline:
 * 1. Verify the Stripe signature using `stripe.webhooks.constructEvent`
 * 2. Store the webhook event in `webhook_events`
 * 3. For `checkout.session.completed`:
 *    a. Find the lead by customer_email
 *    b. Update lead status to `converted`, record revenue and convertedAt
 *    c. Create an onboarding sequence (J0, J1, J3, J7, J14)
 * 4. Log webhooks without a matching lead for investigation
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
export const processStripeWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.string(),
    receivedAt: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    eventId: v.optional(v.id("webhook_events")),
    leadId: v.optional(v.id("leads")),
  }),
  handler: async (ctx, { rawBody, signature, receivedAt }) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      const eventId: Id<"webhook_events"> = await ctx.runMutation(
        internal.webhooks.storeWebhookEvent,
        {
          source: "stripe",
          eventType: "config_error",
          payload: null,
          processed: false,
          error: "STRIPE_WEBHOOK_SECRET environment variable is not set",
          receivedAt,
        },
      );
      return { success: false, error: "Stripe webhook secret not configured", eventId };
    }

    // 1. Verify the Stripe signature (Requirement 11.3)
    let event: Stripe.Event;
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      const eventId: Id<"webhook_events"> = await ctx.runMutation(
        internal.webhooks.storeWebhookEvent,
        {
          source: "stripe",
          eventType: "signature_verification_failed",
          payload: null,
          processed: false,
          error: `Stripe signature verification failed: ${errorMessage}`,
          receivedAt,
        },
      );

      return {
        success: false,
        error: `Webhook signature verification failed: ${errorMessage}`,
        eventId,
      };
    }

    // 2. Store the webhook event (Requirement 11.4)
    const eventId: Id<"webhook_events"> = await ctx.runMutation(
      internal.webhooks.storeWebhookEvent,
      {
        source: "stripe",
        eventType: event.type,
        payload: {
          stripeEventId: event.id,
          type: event.type,
          created: event.created,
          livemode: event.livemode,
        },
        processed: false,
        receivedAt,
      },
    );

    // 3. Process the event based on type
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const customerEmail = session.customer_email ?? session.customer_details?.email;
      const amountTotal = session.amount_total; // in cents
      const currency = session.currency;
      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;

      if (!customerEmail) {
        // Log webhook without email for investigation (Requirement 11.4)
        await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
          source: "stripe",
          eventType: "checkout_no_email",
          payload: {
            stripeEventId: event.id,
            sessionId: session.id,
            note: "checkout.session.completed received but no customer email found",
          },
          processed: false,
          error: "No customer email in checkout session",
          receivedAt,
        });

        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "warn",
          message: `Stripe checkout.session.completed received but no customer email found. Session: ${session.id}, Event: ${event.id}`,
          metadata: {
            stripeEventId: event.id,
            sessionId: session.id,
          },
        });

        await ctx.runMutation(internal.webhooks.markWebhookProcessed, {
          eventId,
        });

        return { success: true, eventId };
      }

      // Convert amount from cents to the base unit
      const revenueAmount = amountTotal ? amountTotal / 100 : 0;

      // Update the lead and create onboarding sequence
      const result: {
        leadFound: boolean;
        leadId?: Id<"leads">;
        sequenceId?: Id<"sequences">;
      } = await ctx.runMutation(
        internal.stripeWebhookHelpers.processCheckoutCompleted,
        {
          customerEmail,
          revenueGenerated: revenueAmount,
          stripeCustomerId: stripeCustomerId ?? undefined,
          stripeEventId: event.id,
          currency: currency ?? "eur",
        },
      );

      // Mark webhook as processed
      await ctx.runMutation(internal.webhooks.markWebhookProcessed, {
        eventId,
      });

      if (!result.leadFound) {
        // Log for investigation (Requirement 11.4)
        await ctx.runMutation(internal.logs.createLog, {
          agentType: "analyst",
          level: "warn",
          message: `Stripe checkout.session.completed for ${customerEmail} but no matching lead found. Event: ${event.id}`,
          metadata: {
            stripeEventId: event.id,
            customerEmail,
            revenueGenerated: revenueAmount,
            currency: currency ?? "eur",
          },
        });

        return { success: true, eventId };
      }

      return { success: true, eventId, leadId: result.leadId };
    }

    // For other event types, just mark as processed
    await ctx.runMutation(internal.webhooks.markWebhookProcessed, {
      eventId,
    });

    return { success: true, eventId };
  },
});
