/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  buildCopywriterPrompt,
  buildSocialProof,
  determineTone,
} from "./agents/copywriter";

const modules = import.meta.glob("./**/*.ts");

// ─── determineTone ───────────────────────────────────────────────────────────

describe("determineTone", () => {
  test("returns 'tech' when lead has a GitHub URL", () => {
    const tone = determineTone({
      source: "radar",
      detectionChannel: "web",
      enrichmentData: {
        githubUrl: "https://github.com/johndoe",
      },
    });
    expect(tone).toBe("tech");
  });

  test("returns 'tech' when lead has developer skills", () => {
    const tone = determineTone({
      source: "radar",
      detectionChannel: "web",
      enrichmentData: {
        skills: ["JavaScript", "Backend Developer", "React"],
      },
    });
    expect(tone).toBe("tech");
  });

  test("returns 'tech' when lead has a technical role", () => {
    const tone = determineTone({
      source: "radar",
      detectionChannel: "web",
      enrichmentData: {
        role: "CTO",
      },
    });
    expect(tone).toBe("tech");
  });

  test("returns 'support' when lead comes from a webhook", () => {
    const tone = determineTone({
      source: "webhook_piksend",
      detectionChannel: "webhook",
    });
    expect(tone).toBe("support");
  });

  test("returns 'support' when webhookEventType contains support keywords", () => {
    const tone = determineTone({
      source: "radar",
      detectionChannel: "web",
      webhookEventType: "support_ticket_opened",
    });
    expect(tone).toBe("support");
  });

  test("returns 'expert' as default for cold outreach", () => {
    const tone = determineTone({
      source: "radar",
      detectionChannel: "web",
    });
    expect(tone).toBe("expert");
  });

  test("returns 'expert' when enrichment has no tech signals", () => {
    const tone = determineTone({
      source: "radar",
      detectionChannel: "web",
      enrichmentData: {
        role: "Marketing Manager",
        skills: ["Marketing", "SEO", "Content Strategy"],
      },
    });
    expect(tone).toBe("expert");
  });

  test("prioritizes tech over support when both signals present", () => {
    const tone = determineTone({
      source: "webhook_piksend",
      detectionChannel: "webhook",
      enrichmentData: {
        githubUrl: "https://github.com/dev",
      },
    });
    expect(tone).toBe("tech");
  });
});

// ─── buildSocialProof ────────────────────────────────────────────────────────

describe("buildSocialProof", () => {
  test("returns testimonial quote with author name", () => {
    const result = buildSocialProof(
      [{ content: "Great product!", authorName: "Jane Doe" }],
      "Piksend",
    );
    expect(result).toBe('"Great product!" — Jane Doe');
  });

  test("returns testimonial quote without author name", () => {
    const result = buildSocialProof(
      [{ content: "Amazing tool for our team" }],
      "GateCtr",
    );
    expect(result).toBe('"Amazing tool for our team"');
  });

  test("returns fallback message when no testimonials", () => {
    const result = buildSocialProof([], "Joventy");
    expect(result).toContain("Joventy");
    expect(result).toContain("trusted");
  });

  test("uses the first testimonial when multiple are provided", () => {
    const result = buildSocialProof(
      [
        { content: "First testimonial", authorName: "Alice" },
        { content: "Second testimonial", authorName: "Bob" },
      ],
      "Piksend",
    );
    expect(result).toContain("First testimonial");
    expect(result).toContain("Alice");
    expect(result).not.toContain("Second testimonial");
  });
});

// ─── buildCopywriterPrompt ───────────────────────────────────────────────────

describe("buildCopywriterPrompt", () => {
  const baseLead = {
    email: "john@example.com",
    name: "John Doe",
    source: "radar",
    detectionChannel: "web",
  };

  const baseProduct = {
    name: "Piksend",
    uspDescription: "Professional photo management",
    landingPageBaseUrl: "https://piksend.com/lp",
  };

  test("includes product name and USP in system prompt", () => {
    const { system } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(system).toContain("Piksend");
    expect(system).toContain("Professional photo management");
  });

  test("includes contextual link in system prompt", () => {
    const { system } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(system).toContain("https://piksend.com/lp");
  });

  test("includes lead info in user prompt", () => {
    const { user } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(user).toContain("john@example.com");
    expect(user).toContain("John Doe");
    expect(user).toContain("radar");
  });

  test("includes social proof in user prompt", () => {
    const { user } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      '"Amazing tool!" — Jane',
      "https://piksend.com/lp",
    );
    expect(user).toContain('"Amazing tool!" — Jane');
  });

  test("includes enrichment data when available", () => {
    const leadWithEnrichment = {
      ...baseLead,
      enrichmentData: {
        company: "Acme Corp",
        role: "CTO",
        skills: ["TypeScript", "React"],
        bio: "Tech leader",
      },
    };
    const { user } = buildCopywriterPrompt(
      leadWithEnrichment,
      baseProduct,
      "tech",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(user).toContain("Acme Corp");
    expect(user).toContain("CTO");
    expect(user).toContain("TypeScript, React");
  });

  test("includes webhook info when available", () => {
    const leadWithWebhook = {
      ...baseLead,
      webhookEventType: "signup_completed",
      webhookEventContext: "Free trial started",
    };
    const { user } = buildCopywriterPrompt(
      leadWithWebhook,
      baseProduct,
      "support",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(user).toContain("signup_completed");
    expect(user).toContain("Free trial started");
  });

  test("uses custom prompt template when provided", () => {
    const { system } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
      "Custom system prompt for Piksend outreach",
    );
    expect(system).toBe("Custom system prompt for Piksend outreach");
  });

  test("includes A/B variant B instruction when variant is B", () => {
    const { system } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
      undefined,
      "B",
    );
    expect(system).toContain("version B");
    expect(system).toContain("DIFFERENT angle");
  });

  test("does not include A/B variant instruction for variant A", () => {
    const { system } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
      undefined,
      "A",
    );
    expect(system).not.toContain("version B");
    expect(system).not.toContain("DIFFERENT angle");
  });

  test("includes tone-specific instructions", () => {
    const { system: expertSystem } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "expert",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(expertSystem).toContain("thought leader");

    const { system: supportSystem } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "support",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(supportSystem).toContain("empathetic");

    const { system: techSystem } = buildCopywriterPrompt(
      baseLead,
      baseProduct,
      "tech",
      "Great product!",
      "https://piksend.com/lp",
    );
    expect(techSystem).toContain("technical peer");
  });
});

// ─── copywriterHelpers (Convex integration tests) ────────────────────────────

describe("copywriterHelpers", () => {
  test("getLeadForComposition returns lead data when lead exists", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        productId: "piksend",
        score: 75,
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const lead = await t.query(
      internal.agents.copywriterHelpers.getLeadForComposition,
      { leadId },
    );
    expect(lead).not.toBeNull();
    expect(lead!.email).toBe("test@example.com");
    expect(lead!.status).toBe("qualified");
    expect(lead!.productId).toBe("piksend");
  });

  test("getProductBySlug returns product config", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", {
        slug: "piksend",
        name: "Piksend",
        senderEmail: "hello@piksend.com",
        replyToEmail: "support@piksend.com",
        templateId: "piksend-outreach",
        brandColor: "#FF6B35",
        logoUrl: "https://cdn.leadengine.io/logos/piksend.svg",
        landingPageBaseUrl: "https://piksend.com/lp",
        uspDescription: "Professional photo management",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const product = await t.query(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: "piksend" },
    );
    expect(product).not.toBeNull();
    expect(product!.name).toBe("Piksend");
    expect(product!.landingPageBaseUrl).toBe("https://piksend.com/lp");
  });

  test("getProductBySlug returns null for unknown slug", async () => {
    const t = convexTest(schema, modules);
    const product = await t.query(
      internal.agents.copywriterHelpers.getProductBySlug,
      { slug: "nonexistent" },
    );
    expect(product).toBeNull();
  });

  test("getValidatedTestimonials returns only validated testimonials for product", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const leadId = await ctx.db.insert("leads", {
        email: "client@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "converted",
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });

      // Validated testimonial for piksend
      await ctx.db.insert("testimonials", {
        leadId,
        productId: "piksend",
        content: "Piksend transformed our workflow!",
        authorName: "Alice",
        isValidated: true,
        validatedAt: Date.now(),
        createdAt: Date.now(),
      });

      // Non-validated testimonial for piksend
      await ctx.db.insert("testimonials", {
        leadId,
        productId: "piksend",
        content: "Not yet validated",
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

    const testimonials = await t.query(
      internal.agents.copywriterHelpers.getValidatedTestimonials,
      { productId: "piksend" },
    );
    expect(testimonials).toHaveLength(1);
    expect(testimonials[0].content).toBe("Piksend transformed our workflow!");
    expect(testimonials[0].authorName).toBe("Alice");
  });

  test("getExistingMessageForLead returns null when no message exists", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const message = await t.query(
      internal.agents.copywriterHelpers.getExistingMessageForLead,
      { leadId },
    );
    expect(message).toBeNull();
  });

  test("getExistingMessageForLead returns message when it exists", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("messages", {
        leadId: id,
        suggestedReply: "Hello, I noticed your work...",
        validationStatus: "draft",
        tone: "expert",
        contextualLink: "https://piksend.com/lp",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return id;
    });

    const message = await t.query(
      internal.agents.copywriterHelpers.getExistingMessageForLead,
      { leadId },
    );
    expect(message).not.toBeNull();
    expect(message!.suggestedReply).toBe("Hello, I noticed your work...");
  });

  test("insertMessage creates a message with draft status", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const messageId = await t.mutation(
      internal.agents.copywriterHelpers.insertMessage,
      {
        leadId,
        suggestedReply: "Hi John, I noticed your work at Acme...",
        subject: "Quick question about your workflow",
        tone: "expert",
        socialProofUsed: '"Great product!" — Jane',
        contextualLink: "https://piksend.com/lp",
      },
    );

    expect(messageId).toBeDefined();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message).not.toBeNull();
    expect(message!.validationStatus).toBe("draft");
    expect(message!.suggestedReply).toBe(
      "Hi John, I noticed your work at Acme...",
    );
    expect(message!.subject).toBe("Quick question about your workflow");
    expect(message!.tone).toBe("expert");
    expect(message!.socialProofUsed).toBe('"Great product!" — Jane');
    expect(message!.contextualLink).toBe("https://piksend.com/lp");
    expect(message!.createdAt).toBeDefined();
    expect(message!.updatedAt).toBeDefined();
  });

  test("insertMessage supports A/B testing fields", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const messageId = await t.mutation(
      internal.agents.copywriterHelpers.insertMessage,
      {
        leadId,
        suggestedReply: "Version A message",
        suggestedReplyB: "Version B message",
        activeVersion: "A",
        subject: "Test subject",
        tone: "tech",
        contextualLink: "https://gatectr.com/lp",
      },
    );

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.suggestedReply).toBe("Version A message");
    expect(message!.suggestedReplyB).toBe("Version B message");
    expect(message!.activeVersion).toBe("A");
  });

  test("getCopywriterPromptConfig returns product-specific config", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        productId: "piksend",
        promptTemplate: "Custom Piksend copywriter prompt",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const config = await t.query(
      internal.agents.copywriterHelpers.getCopywriterPromptConfig,
      { productId: "piksend" },
    );
    expect(config).not.toBeNull();
    expect(config!.promptTemplate).toBe("Custom Piksend copywriter prompt");
  });

  test("getCopywriterPromptConfig falls back to generic config", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "copywriter",
        promptTemplate: "Generic copywriter prompt",
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const config = await t.query(
      internal.agents.copywriterHelpers.getCopywriterPromptConfig,
      { productId: "piksend" },
    );
    expect(config).not.toBeNull();
    expect(config!.promptTemplate).toBe("Generic copywriter prompt");
  });

  test("getCopywriterPromptConfig returns null when no config exists", async () => {
    const t = convexTest(schema, modules);
    const config = await t.query(
      internal.agents.copywriterHelpers.getCopywriterPromptConfig,
      { productId: "piksend" },
    );
    expect(config).toBeNull();
  });

  test("markLeadForReprocessing updates the lead's updatedAt", async () => {
    const t = convexTest(schema, modules);
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        consentSource: "radar_detection",
        consentDate: Date.now(),
        updatedAt: 1000,
      });
    });

    await t.mutation(
      internal.agents.copywriterHelpers.markLeadForReprocessing,
      { leadId },
    );

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });
    expect(lead!.updatedAt).toBeGreaterThan(1000);
  });
});
