/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("getActiveProductSlugs", () => {
  test("returns slugs of active products only", async () => {
    const t = convexTest(schema, modules);

    // Seed products: 2 active, 1 inactive
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("products", {
        slug: "piksend",
        name: "Piksend",
        senderEmail: "hello@piksend.com",
        replyToEmail: "support@piksend.com",
        templateId: "piksend-outreach",
        brandColor: "#FF6B35",
        logoUrl: "https://cdn.leadengine.io/logos/piksend.svg",
        landingPageBaseUrl: "https://piksend.com/lp",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("products", {
        slug: "gatectr",
        name: "GateCtr",
        senderEmail: "hello@gatectr.com",
        replyToEmail: "support@gatectr.com",
        templateId: "gatectr-outreach",
        brandColor: "#2563EB",
        logoUrl: "https://cdn.leadengine.io/logos/gatectr.svg",
        landingPageBaseUrl: "https://gatectr.com/lp",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("products", {
        slug: "inactive_product",
        name: "Inactive",
        senderEmail: "hello@inactive.com",
        replyToEmail: "support@inactive.com",
        templateId: "inactive-outreach",
        brandColor: "#000000",
        logoUrl: "https://cdn.leadengine.io/logos/inactive.svg",
        landingPageBaseUrl: "https://inactive.com/lp",
        isActive: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const slugs = await t.query(internal.webhooks.getActiveProductSlugs);

    expect(slugs).toContain("piksend");
    expect(slugs).toContain("gatectr");
    expect(slugs).not.toContain("inactive_product");
    expect(slugs).toHaveLength(2);
  });

  test("returns empty array when no active products exist", async () => {
    const t = convexTest(schema, modules);

    const slugs = await t.query(internal.webhooks.getActiveProductSlugs);

    expect(slugs).toEqual([]);
  });
});

describe("storeWebhookEvent", () => {
  test("stores a successful webhook event", async () => {
    const t = convexTest(schema, modules);

    const eventId = await t.mutation(internal.webhooks.storeWebhookEvent, {
      source: "piksend",
      eventType: "user.signup",
      payload: {
        product_id: "piksend",
        event_type: "user.signup",
        event_context: "New user signed up",
        user_email: "test@example.com",
        timestamp: 1700000000000,
      },
      processed: false,
      receivedAt: Date.now(),
    });

    expect(eventId).toBeDefined();

    const event = await t.run(async (ctx) => {
      return await ctx.db.get(eventId);
    });

    expect(event).not.toBeNull();
    expect(event!.source).toBe("piksend");
    expect(event!.eventType).toBe("user.signup");
    expect(event!.processed).toBe(false);
    expect(event!.error).toBeUndefined();
  });

  test("stores a failed webhook event with error", async () => {
    const t = convexTest(schema, modules);

    const eventId = await t.mutation(internal.webhooks.storeWebhookEvent, {
      source: "unknown",
      eventType: "validation_error",
      payload: { bad: "data" },
      processed: false,
      error: "Missing required fields: product_id, user_email",
      receivedAt: Date.now(),
    });

    const event = await t.run(async (ctx) => {
      return await ctx.db.get(eventId);
    });

    expect(event!.error).toBe(
      "Missing required fields: product_id, user_email",
    );
    expect(event!.processed).toBe(false);
  });
});

describe("createLeadFromWebhook", () => {
  test("creates a new lead with qualified status and score 100", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      productId: "piksend",
      eventType: "user.signup",
      eventContext: "New user signed up for Piksend",
      userEmail: "newlead@example.com",
      timestamp: 1700000000000,
    });

    expect(leadId).toBeDefined();

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead).not.toBeNull();
    expect(lead!.email).toBe("newlead@example.com");
    expect(lead!.status).toBe("qualified");
    expect(lead!.score).toBe(100);
    expect(lead!.productId).toBe("piksend");
    expect(lead!.source).toBe("webhook_piksend");
    expect(lead!.detectionChannel).toBe("webhook");
    expect(lead!.detectedAt).toBe(1700000000000);
  });

  test("stores webhook fields (webhookEventType, webhookEventContext, webhookUserId)", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      productId: "gatectr",
      eventType: "trial.started",
      eventContext: "User started a free trial",
      userEmail: "trial@example.com",
      timestamp: 1700000000000,
    });

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.webhookEventType).toBe("trial.started");
    expect(lead!.webhookEventContext).toBe("User started a free trial");
    expect(lead!.webhookUserId).toBe("trial@example.com");
  });

  test("sets scoringBreakdown with correct values summing to 100", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      productId: "piksend",
      eventType: "user.signup",
      eventContext: "Signup",
      userEmail: "score@example.com",
      timestamp: 1700000000000,
    });

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.scoringBreakdown).toBeDefined();
    const breakdown = lead!.scoringBreakdown!;
    const total =
      breakdown.urgency +
      breakdown.webhookSource +
      breakdown.productMatch +
      breakdown.activeProfile +
      breakdown.contextSignals;
    expect(total).toBe(100);
  });

  test("sets consent fields from webhook data", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      productId: "piksend",
      eventType: "user.signup",
      eventContext: "Signup",
      userEmail: "consent@example.com",
      timestamp: 1700000000000,
    });

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.consentSource).toBe("product_signup");
    expect(lead!.consentDate).toBe(1700000000000);
  });

  test("deduplicates by email — consolidates existing lead", async () => {
    const t = convexTest(schema, modules);

    // Create an existing lead with the same email (e.g., from Radar)
    const existingLeadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "existing@example.com",
        source: "radar",
        detectedAt: 1699000000000,
        detectionChannel: "web",
        status: "pending_qualification",
        score: 35,
        consentSource: "web_scraping",
        consentDate: 1699000000000,
        updatedAt: 1699000000000,
      });
    });

    // Now create a lead from webhook with the same email
    const returnedId = await t.mutation(
      internal.webhooks.createLeadFromWebhook,
      {
        productId: "piksend",
        eventType: "user.signup",
        eventContext: "User signed up",
        userEmail: "existing@example.com",
        timestamp: 1700000000000,
      },
    );

    // Should return the existing lead ID (consolidated, not duplicated)
    expect(returnedId).toEqual(existingLeadId);

    // Verify the lead was updated, not duplicated
    const allLeads = await t.run(async (ctx) => {
      return await ctx.db
        .query("leads")
        .withIndex("by_email", (q) => q.eq("email", "existing@example.com"))
        .collect();
    });

    expect(allLeads).toHaveLength(1);

    const lead = allLeads[0];
    expect(lead.status).toBe("qualified");
    expect(lead.score).toBe(100);
    expect(lead.productId).toBe("piksend");
    expect(lead.source).toBe("webhook_piksend");
    expect(lead.webhookEventType).toBe("user.signup");
    expect(lead.webhookEventContext).toBe("User signed up");
    expect(lead.consentSource).toBe("product_signup");
  });
});

describe("markWebhookProcessed", () => {
  test("marks a webhook event as processed with timestamp", async () => {
    const t = convexTest(schema, modules);

    const eventId = await t.mutation(internal.webhooks.storeWebhookEvent, {
      source: "piksend",
      eventType: "user.signup",
      payload: { test: true },
      processed: false,
      receivedAt: Date.now(),
    });

    await t.mutation(internal.webhooks.markWebhookProcessed, { eventId });

    const event = await t.run(async (ctx) => {
      return await ctx.db.get(eventId);
    });

    expect(event!.processed).toBe(true);
    expect(event!.processedAt).toBeDefined();
    expect(typeof event!.processedAt).toBe("number");
  });
});
