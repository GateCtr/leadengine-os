/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Helper to seed active products for webhook validation tests.
 */
async function seedProducts(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const products = [
      {
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
      },
      {
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
      },
    ];
    for (const product of products) {
      await ctx.db.insert("products", product);
    }
  });
}

/**
 * Valid webhook payload for testing.
 */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "piksend",
    event_type: "user.signup",
    event_context: "New user signed up for Piksend",
    user_email: "lead@example.com",
    timestamp: 1700000000000,
    ...overrides,
  };
}

const WEBHOOK_SECRET = "test-webhook-secret-123";

describe("POST /webhooks/product", () => {
  let originalWebhookSecret: string | undefined;

  beforeEach(() => {
    originalWebhookSecret = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  describe("authentication (Requirement 2.4)", () => {
    test("returns 401 when X-Webhook-Secret header is missing", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload()),
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain("Unauthorized");
    });

    test("returns 401 when X-Webhook-Secret header is incorrect", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "wrong-secret",
        },
        body: JSON.stringify(validPayload()),
      });

      expect(response.status).toBe(401);
    });

    test("stores auth failure in webhook_events", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "wrong-secret",
        },
        body: JSON.stringify(validPayload()),
      });

      const events = await t.run(async (ctx) => {
        return await ctx.db.query("webhook_events").collect();
      });

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("auth_failed");
      expect(events[0].error).toContain("X-Webhook-Secret");
    });
  });

  describe("payload validation (Requirement 2.3)", () => {
    test("returns 400 for invalid JSON body", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: "not-json",
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Invalid JSON");
    });

    test("returns 400 when required fields are missing", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify({ product_id: "piksend" }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Missing required fields");
    });

    test("returns 400 when product_id has wrong type", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload({ product_id: 123 })),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("product_id");
    });

    test("returns 400 when user_email is not a valid email", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload({ user_email: "not-an-email" })),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("user_email");
    });

    test("returns 400 when timestamp is not a number", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload({ timestamp: "not-a-number" })),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("timestamp");
    });

    test("returns 400 when product_id does not match an active product", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload({ product_id: "nonexistent" })),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nonexistent");
      expect(body.error).toContain("active product");
    });

    test("stores validation errors in webhook_events", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify({ product_id: "piksend" }),
      });

      const events = await t.run(async (ctx) => {
        return await ctx.db.query("webhook_events").collect();
      });

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("validation_error");
      expect(events[0].error).toBeDefined();
      expect(events[0].processed).toBe(false);
    });
  });

  describe("successful webhook processing (Requirement 2.1)", () => {
    test("returns 200 for a valid webhook payload", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload()),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.eventId).toBeDefined();
      expect(body.leadId).toBeDefined();
    });

    test("stores the webhook event in webhook_events table", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload()),
      });

      const events = await t.run(async (ctx) => {
        return await ctx.db.query("webhook_events").collect();
      });

      expect(events).toHaveLength(1);
      expect(events[0].source).toBe("piksend");
      expect(events[0].eventType).toBe("user.signup");
      expect(events[0].processed).toBe(true);
      expect(events[0].processedAt).toBeDefined();
      expect(events[0].error).toBeUndefined();
      expect(events[0].payload).toEqual(validPayload());
    });

    test("creates a qualified lead from valid webhook", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      const response = await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload()),
      });

      const body = await response.json();
      expect(body.leadId).toBeDefined();

      // Verify the lead was created with correct fields
      const leads = await t.run(async (ctx) => {
        return await ctx.db
          .query("leads")
          .withIndex("by_email", (q) => q.eq("email", "lead@example.com"))
          .collect();
      });

      expect(leads).toHaveLength(1);
      const lead = leads[0];
      expect(lead.status).toBe("qualified");
      expect(lead.score).toBe(100);
      expect(lead.productId).toBe("piksend");
      expect(lead.source).toBe("webhook_piksend");
      expect(lead.webhookEventType).toBe("user.signup");
      expect(lead.webhookEventContext).toBe("New user signed up for Piksend");
      expect(lead.consentSource).toBe("product_signup");
    });

    test("deduplicates leads by email via webhook route", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      // Send the same webhook twice
      await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(validPayload()),
      });

      await t.fetch("/webhooks/product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(
          validPayload({ event_type: "user.upgraded", event_context: "User upgraded plan" }),
        ),
      });

      // Should only have 1 lead (deduplicated)
      const leads = await t.run(async (ctx) => {
        return await ctx.db
          .query("leads")
          .withIndex("by_email", (q) => q.eq("email", "lead@example.com"))
          .collect();
      });

      expect(leads).toHaveLength(1);
      // Should have the latest webhook data
      expect(leads[0].webhookEventType).toBe("user.upgraded");
      expect(leads[0].webhookEventContext).toBe("User upgraded plan");
    });

    test("works with all active product slugs", async () => {
      const t = convexTest(schema, modules);
      await seedProducts(t);

      for (const slug of ["piksend", "gatectr"]) {
        const response = await t.fetch("/webhooks/product", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": WEBHOOK_SECRET,
          },
          body: JSON.stringify(
            validPayload({
              product_id: slug,
              user_email: `user-${slug}@example.com`,
            }),
          ),
        });

        expect(response.status).toBe(200);
      }

      const events = await t.run(async (ctx) => {
        return await ctx.db.query("webhook_events").collect();
      });

      expect(events).toHaveLength(2);

      // Verify leads were created for each product
      const leads = await t.run(async (ctx) => {
        return await ctx.db.query("leads").collect();
      });

      expect(leads).toHaveLength(2);
      expect(leads.map((l) => l.productId).sort()).toEqual(["gatectr", "piksend"]);
    });
  });
});
