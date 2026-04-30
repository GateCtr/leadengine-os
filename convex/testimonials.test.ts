/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("submitTestimonial", () => {
  test("stores a testimonial with isValidated=false", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "alice@example.com",
        name: "Alice",
        source: "webhook_piksend",
        detectedAt: Date.now(),
        detectionChannel: "webhook",
        status: "converted",
        productId: "piksend",
        score: 100,
        consentSource: "webhook",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const testimonialId = await t.mutation(
      internal.testimonials.submitTestimonial,
      {
        leadId,
        productId: "piksend",
        content: "Piksend transformed our workflow!",
        authorName: "Alice",
      },
    );

    const testimonial = await t.run(async (ctx) => {
      return await ctx.db.get(testimonialId);
    });

    expect(testimonial).not.toBeNull();
    expect(testimonial!.leadId).toBe(leadId);
    expect(testimonial!.productId).toBe("piksend");
    expect(testimonial!.content).toBe("Piksend transformed our workflow!");
    expect(testimonial!.authorName).toBe("Alice");
    expect(testimonial!.isValidated).toBe(false);
    expect(testimonial!.validatedAt).toBeUndefined();
  });
});

describe("validateTestimonial", () => {
  test("marks a testimonial as validated with timestamp", async () => {
    const t = convexTest(schema, modules);
    const { leadId, testimonialId } = await t.run(async (ctx) => {
      const leadId = await ctx.db.insert("leads", {
        email: "bob@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        productId: "gatectr",
        consentSource: "radar",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
      const testimonialId = await ctx.db.insert("testimonials", {
        leadId,
        productId: "gatectr",
        content: "GateCtr saved us 40% on LLM costs.",
        authorName: "Bob",
        isValidated: false,
        createdAt: Date.now(),
      });
      return { leadId, testimonialId };
    });

    const beforeValidation = Date.now();

    await t.withIdentity({ subject: "admin-user" }).mutation(
      api.testimonials.validateTestimonial,
      { testimonialId },
    );

    const testimonial = await t.run(async (ctx) => {
      return await ctx.db.get(testimonialId);
    });

    expect(testimonial!.isValidated).toBe(true);
    expect(testimonial!.validatedAt).toBeDefined();
    expect(testimonial!.validatedAt!).toBeGreaterThanOrEqual(beforeValidation);
  });

  test("throws when not authenticated", async () => {
    const t = convexTest(schema, modules);
    const { testimonialId } = await t.run(async (ctx) => {
      const leadId = await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        consentSource: "radar",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
      const testimonialId = await ctx.db.insert("testimonials", {
        leadId,
        productId: "piksend",
        content: "Great product!",
        isValidated: false,
        createdAt: Date.now(),
      });
      return { testimonialId };
    });

    await expect(
      t.mutation(api.testimonials.validateTestimonial, { testimonialId }),
    ).rejects.toThrow("Authentication required");
  });
});

describe("rejectTestimonial", () => {
  test("deletes the testimonial from the database", async () => {
    const t = convexTest(schema, modules);
    const { testimonialId } = await t.run(async (ctx) => {
      const leadId = await ctx.db.insert("leads", {
        email: "carol@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        consentSource: "radar",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
      const testimonialId = await ctx.db.insert("testimonials", {
        leadId,
        productId: "joventy",
        content: "Not a great testimonial.",
        isValidated: false,
        createdAt: Date.now(),
      });
      return { testimonialId };
    });

    await t.withIdentity({ subject: "admin-user" }).mutation(
      api.testimonials.rejectTestimonial,
      { testimonialId },
    );

    const testimonial = await t.run(async (ctx) => {
      return await ctx.db.get(testimonialId);
    });

    expect(testimonial).toBeNull();
  });
});

describe("getValidatedByProduct", () => {
  test("returns only validated testimonials for the specified product", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const leadId = await ctx.db.insert("leads", {
        email: "dave@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        productId: "piksend",
        consentSource: "radar",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });

      // Validated testimonial for piksend
      await ctx.db.insert("testimonials", {
        leadId,
        productId: "piksend",
        content: "Piksend is amazing!",
        authorName: "Dave",
        isValidated: true,
        validatedAt: Date.now(),
        createdAt: Date.now(),
      });

      // Non-validated testimonial for piksend
      await ctx.db.insert("testimonials", {
        leadId,
        productId: "piksend",
        content: "Pending review",
        isValidated: false,
        createdAt: Date.now(),
      });

      // Validated testimonial for different product
      await ctx.db.insert("testimonials", {
        leadId,
        productId: "gatectr",
        content: "GateCtr is great!",
        isValidated: true,
        validatedAt: Date.now(),
        createdAt: Date.now(),
      });
    });

    const results = await t.query(api.testimonials.getValidatedByProduct, {
      productId: "piksend",
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Piksend is amazing!");
    expect(results[0].authorName).toBe("Dave");
  });

  test("returns empty array when no validated testimonials exist", async () => {
    const t = convexTest(schema, modules);
    const results = await t.query(api.testimonials.getValidatedByProduct, {
      productId: "nonexistent",
    });

    expect(results).toHaveLength(0);
  });
});

describe("triggerTestimonialCollection", () => {
  test("creates a testimonial collection message for a converted lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      await ctx.db.insert("products", {
        slug: "piksend",
        name: "Piksend",
        senderEmail: "hello@piksend.com",
        replyToEmail: "support@piksend.com",
        templateId: "piksend-outreach",
        brandColor: "#FF6B35",
        logoUrl: "https://piksend.com/logo.png",
        landingPageBaseUrl: "https://piksend.com/lp",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return await ctx.db.insert("leads", {
        email: "eve@example.com",
        name: "Eve",
        source: "webhook_piksend",
        detectedAt: Date.now(),
        detectionChannel: "webhook",
        status: "converted",
        productId: "piksend",
        score: 100,
        consentSource: "webhook",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.testimonials.triggerTestimonialCollection, {
      leadId,
    });

    // Verify a message was created
    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query("messages")
        .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
        .take(10);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].sequenceStep).toBe(-2);
    expect(messages[0].tone).toBe("support");
    expect(messages[0].validationStatus).toBe("draft");
    expect(messages[0].subject).toContain("Piksend");
    expect(messages[0].suggestedReply).toContain("Piksend");
    expect(messages[0].suggestedReply).toContain("témoignage");
  });

  test("does not create message for non-converted lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "frank@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        productId: "piksend",
        consentSource: "radar",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.testimonials.triggerTestimonialCollection, {
      leadId,
    });

    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query("messages")
        .withIndex("by_leadId", (q) => q.eq("leadId", leadId))
        .take(10);
    });

    expect(messages).toHaveLength(0);
  });
});

describe("submitTestimonialFromHttp", () => {
  test("stores testimonial and returns success", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "grace@example.com",
        name: "Grace",
        source: "webhook_piksend",
        detectedAt: Date.now(),
        detectionChannel: "webhook",
        status: "converted",
        productId: "piksend",
        consentSource: "webhook",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.testimonials.submitTestimonialFromHttp,
      {
        leadId,
        content: "Piksend changed everything for us!",
        authorName: "Grace",
      },
    );

    expect(result.success).toBe(true);
    expect(result.testimonialId).toBeDefined();

    const testimonial = await t.run(async (ctx) => {
      return await ctx.db.get(result.testimonialId!);
    });

    expect(testimonial!.content).toBe("Piksend changed everything for us!");
    expect(testimonial!.productId).toBe("piksend");
    expect(testimonial!.isValidated).toBe(false);
  });

  test("uses lead name as authorName when not provided", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "henry@example.com",
        name: "Henry",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        productId: "gatectr",
        consentSource: "radar",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.testimonials.submitTestimonialFromHttp,
      {
        leadId,
        content: "Great product!",
      },
    );

    expect(result.success).toBe(true);

    const testimonial = await t.run(async (ctx) => {
      return await ctx.db.get(result.testimonialId!);
    });

    expect(testimonial!.authorName).toBe("Henry");
  });
});
