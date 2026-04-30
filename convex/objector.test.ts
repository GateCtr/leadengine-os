/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  buildAnalysisPrompt,
  buildCounterResponsePrompt,
  ReplyCategorySchema,
  ReplyAnalysisSchema,
  CounterResponseSchema,
} from "./agents/objector";

const modules = import.meta.glob("./**/*.ts");

// ─── Helper: insert test data ────────────────────────────────────────────────

async function insertTestData(
  t: ReturnType<typeof convexTest>,
  overrides: {
    leadOverrides?: Record<string, unknown>;
    messageOverrides?: Record<string, unknown>;
  } = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    // Insert a product
    await ctx.db.insert("products", {
      slug: "piksend",
      name: "Piksend",
      senderEmail: "hello@piksend.com",
      replyToEmail: "support@piksend.com",
      templateId: "piksend-outreach",
      brandColor: "#FF6B35",
      logoUrl: "https://cdn.leadengine.io/logos/piksend.svg",
      landingPageBaseUrl: "https://piksend.com/lp",
      uspDescription: "Professional photo management for teams",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const leadId = await ctx.db.insert("leads", {
      email: "prospect@example.com",
      name: "Jean Dupont",
      source: "radar",
      detectedAt: now,
      detectionChannel: "web",
      status: "qualified",
      score: 75,
      productId: "piksend",
      consentSource: "radar_detection",
      consentDate: now,
      updatedAt: now,
      ...overrides.leadOverrides,
    });

    const messageId = await ctx.db.insert("messages", {
      leadId,
      suggestedReply: "Hi Jean, I noticed you're looking for a photo management solution...",
      subject: "Photo management for your team",
      tone: "expert" as const,
      validationStatus: "sent",
      sentAt: now - 86400000, // sent 1 day ago
      createdAt: now - 86400000,
      updatedAt: now,
      ...overrides.messageOverrides,
    });

    return { leadId, messageId };
  });
}

// ─── Zod schema validation tests ─────────────────────────────────────────────

describe("Zod schemas", () => {
  it("ReplyCategorySchema accepts all valid categories", () => {
    const categories = [
      "trop_cher",
      "besoin_reflexion",
      "question_technique",
      "interet_confirme",
      "refus",
    ];
    for (const cat of categories) {
      expect(ReplyCategorySchema.parse(cat)).toBe(cat);
    }
  });

  it("ReplyCategorySchema rejects invalid categories", () => {
    expect(() => ReplyCategorySchema.parse("invalid")).toThrow();
    expect(() => ReplyCategorySchema.parse("")).toThrow();
    expect(() => ReplyCategorySchema.parse(123)).toThrow();
  });

  it("ReplyAnalysisSchema validates a complete analysis", () => {
    const analysis = {
      category: "trop_cher",
      reasoning: "The prospect mentions budget constraints",
      sentiment: "negative",
    };
    expect(ReplyAnalysisSchema.parse(analysis)).toEqual(analysis);
  });

  it("ReplyAnalysisSchema rejects incomplete data", () => {
    expect(() =>
      ReplyAnalysisSchema.parse({ category: "trop_cher" }),
    ).toThrow();
  });

  it("CounterResponseSchema validates a complete counter-response", () => {
    const response = {
      subject: "Understanding your budget concerns",
      body: "I completely understand budget is a key factor...",
      tone: "support",
    };
    expect(CounterResponseSchema.parse(response)).toEqual(response);
  });
});

// ─── Prompt building tests ───────────────────────────────────────────────────

describe("buildAnalysisPrompt", () => {
  it("includes reply content in user prompt", () => {
    const { user } = buildAnalysisPrompt(
      "C'est trop cher pour nous",
      "Hi, check out our product",
      { name: "Piksend", uspDescription: "Photo management" },
    );
    expect(user).toContain("C'est trop cher pour nous");
  });

  it("includes original message when provided", () => {
    const { user } = buildAnalysisPrompt(
      "Interesting!",
      "Check out Piksend for your team",
      { name: "Piksend" },
    );
    expect(user).toContain("Check out Piksend for your team");
  });

  it("handles missing original message gracefully", () => {
    const { user } = buildAnalysisPrompt(
      "Not interested",
      undefined,
      { name: "Piksend" },
    );
    expect(user).toContain("Not interested");
    expect(user).not.toContain("undefined");
  });

  it("includes product context in system prompt", () => {
    const { system } = buildAnalysisPrompt(
      "reply",
      undefined,
      { name: "Piksend", uspDescription: "Photo management for teams" },
    );
    expect(system).toContain("Piksend");
    expect(system).toContain("Photo management for teams");
  });

  it("uses custom prompt template when provided", () => {
    const customTemplate = "Custom analysis prompt for testing";
    const { system } = buildAnalysisPrompt(
      "reply",
      undefined,
      { name: "Piksend" },
      customTemplate,
    );
    expect(system).toBe(customTemplate);
  });

  it("includes all category descriptions in default system prompt", () => {
    const { system } = buildAnalysisPrompt(
      "reply",
      undefined,
      { name: "Piksend" },
    );
    expect(system).toContain("trop_cher");
    expect(system).toContain("besoin_reflexion");
    expect(system).toContain("question_technique");
    expect(system).toContain("interet_confirme");
    expect(system).toContain("refus");
  });
});

describe("buildCounterResponsePrompt", () => {
  it("includes objection type in system prompt", () => {
    const { system } = buildCounterResponsePrompt(
      "C'est trop cher",
      "trop_cher",
      "Original message",
      { name: "Piksend", uspDescription: "Photo management", landingPageBaseUrl: "https://piksend.com/lp" },
      { name: "Jean" },
    );
    expect(system).toContain("trop_cher");
    expect(system).toContain("value proposition");
  });

  it("includes lead context when available", () => {
    const { user } = buildCounterResponsePrompt(
      "I need to think about it",
      "besoin_reflexion",
      "Original message",
      { name: "Piksend", uspDescription: "Photo management", landingPageBaseUrl: "https://piksend.com/lp" },
      { name: "Marie", enrichmentData: { company: "Acme Corp", role: "CTO" } },
    );
    expect(user).toContain("Marie");
    expect(user).toContain("Acme Corp");
    expect(user).toContain("CTO");
  });

  it("handles missing lead context gracefully", () => {
    const { user } = buildCounterResponsePrompt(
      "Technical question here",
      "question_technique",
      undefined,
      undefined,
      {},
    );
    expect(user).toContain("Technical question here");
  });

  it("provides specific instructions for each objection type", () => {
    const categories = ["trop_cher", "besoin_reflexion", "question_technique"] as const;
    for (const cat of categories) {
      const { system } = buildCounterResponsePrompt(
        "reply",
        cat,
        "original",
        { name: "Piksend", uspDescription: "USP", landingPageBaseUrl: "https://piksend.com/lp" },
        {},
      );
      expect(system).toContain(cat);
    }
  });
});

// ─── Helper function tests (DB operations) ───────────────────────────────────

describe("getMessageForAnalysis", () => {
  it("returns the message when it exists", async () => {
    const t = convexTest(schema, modules);
    const { messageId } = await insertTestData(t);

    const message = await t.query(
      internal.agents.objectorHelpers.getMessageForAnalysis,
      { messageId },
    );

    expect(message).not.toBeNull();
    expect(message!._id).toBe(messageId);
    expect(message!.validationStatus).toBe("sent");
  });
});

describe("getLeadById", () => {
  it("returns the lead when it exists", async () => {
    const t = convexTest(schema, modules);
    const { leadId } = await insertTestData(t);

    const lead = await t.query(
      internal.agents.objectorHelpers.getLeadById,
      { leadId },
    );

    expect(lead).not.toBeNull();
    expect(lead!._id).toBe(leadId);
    expect(lead!.email).toBe("prospect@example.com");
  });
});

describe("getProductBySlug", () => {
  it("returns the product when it exists", async () => {
    const t = convexTest(schema, modules);
    await insertTestData(t);

    const product = await t.query(
      internal.agents.objectorHelpers.getProductBySlug,
      { slug: "piksend" },
    );

    expect(product).not.toBeNull();
    expect(product!.slug).toBe("piksend");
    expect(product!.name).toBe("Piksend");
  });

  it("returns null for non-existent product", async () => {
    const t = convexTest(schema, modules);

    const product = await t.query(
      internal.agents.objectorHelpers.getProductBySlug,
      { slug: "nonexistent" },
    );

    expect(product).toBeNull();
  });
});

describe("getObjectorPromptConfig", () => {
  it("returns null when no config exists", async () => {
    const t = convexTest(schema, modules);

    const config = await t.query(
      internal.agents.objectorHelpers.getObjectorPromptConfig,
      { productId: "piksend" },
    );

    expect(config).toBeNull();
  });

  it("returns product-specific config when available", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "objector",
        productId: "piksend",
        promptTemplate: "Custom objector prompt for Piksend",
        version: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const config = await t.query(
      internal.agents.objectorHelpers.getObjectorPromptConfig,
      { productId: "piksend" },
    );

    expect(config).not.toBeNull();
    expect(config!.promptTemplate).toBe("Custom objector prompt for Piksend");
  });

  it("falls back to generic config when no product-specific config exists", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "objector",
        promptTemplate: "Generic objector prompt",
        version: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const config = await t.query(
      internal.agents.objectorHelpers.getObjectorPromptConfig,
      { productId: "piksend" },
    );

    expect(config).not.toBeNull();
    expect(config!.promptTemplate).toBe("Generic objector prompt");
  });
});

// ─── updateReplyAnalysis tests ───────────────────────────────────────────────

describe("updateReplyAnalysis", () => {
  it("sets lead to 'hot' when category is interet_confirme", async () => {
    const t = convexTest(schema, modules);
    const { leadId, messageId } = await insertTestData(t);

    await t.mutation(internal.agents.objectorHelpers.updateReplyAnalysis, {
      messageId,
      leadId,
      replyCategory: "interet_confirme",
    });

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    const message = await t.run(async (ctx) => ctx.db.get(messageId));

    expect(lead!.status).toBe("hot");
    expect(message!.replyCategory).toBe("interet_confirme");
  });

  it("sets lead to 'archived' when category is refus", async () => {
    const t = convexTest(schema, modules);
    const { leadId, messageId } = await insertTestData(t);

    await t.mutation(internal.agents.objectorHelpers.updateReplyAnalysis, {
      messageId,
      leadId,
      replyCategory: "refus",
    });

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    const message = await t.run(async (ctx) => ctx.db.get(messageId));

    expect(lead!.status).toBe("archived");
    expect(message!.replyCategory).toBe("refus");
  });

  it("sets lead to 'pending' when category is trop_cher", async () => {
    const t = convexTest(schema, modules);
    const { leadId, messageId } = await insertTestData(t);

    await t.mutation(internal.agents.objectorHelpers.updateReplyAnalysis, {
      messageId,
      leadId,
      replyCategory: "trop_cher",
    });

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead!.status).toBe("pending");
  });

  it("sets lead to 'pending' when category is besoin_reflexion", async () => {
    const t = convexTest(schema, modules);
    const { leadId, messageId } = await insertTestData(t);

    await t.mutation(internal.agents.objectorHelpers.updateReplyAnalysis, {
      messageId,
      leadId,
      replyCategory: "besoin_reflexion",
    });

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead!.status).toBe("pending");
  });

  it("sets lead to 'pending' when category is question_technique", async () => {
    const t = convexTest(schema, modules);
    const { leadId, messageId } = await insertTestData(t);

    await t.mutation(internal.agents.objectorHelpers.updateReplyAnalysis, {
      messageId,
      leadId,
      replyCategory: "question_technique",
    });

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead!.status).toBe("pending");
  });
});

// ─── insertCounterResponse tests ─────────────────────────────────────────────

describe("insertCounterResponse", () => {
  it("creates a new message with draft status for HITL validation", async () => {
    const t = convexTest(schema, modules);
    const { leadId, messageId } = await insertTestData(t);

    const counterMessageId = await t.mutation(
      internal.agents.objectorHelpers.insertCounterResponse,
      {
        leadId,
        suggestedReply: "I understand your budget concerns...",
        subject: "Re: Budget considerations",
        tone: "support" as const,
        contextualLink: "https://piksend.com/lp",
        originalMessageId: messageId,
      },
    );

    const counterMessage = await t.run(async (ctx) =>
      ctx.db.get(counterMessageId),
    );

    expect(counterMessage).not.toBeNull();
    expect(counterMessage!.leadId).toBe(leadId);
    expect(counterMessage!.suggestedReply).toBe(
      "I understand your budget concerns...",
    );
    expect(counterMessage!.subject).toBe("Re: Budget considerations");
    expect(counterMessage!.tone).toBe("support");
    expect(counterMessage!.validationStatus).toBe("draft");
    expect(counterMessage!.contextualLink).toBe("https://piksend.com/lp");
  });
});
