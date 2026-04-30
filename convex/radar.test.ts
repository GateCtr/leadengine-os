/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ─── getRadarKeywords ────────────────────────────────────────────────────────

describe("getRadarKeywords", () => {
  test("returns empty array when no prompt_configs exist", async () => {
    const t = convexTest(schema, modules);

    const keywords = await t.query(internal.agents.radar.getRadarKeywords);
    expect(keywords).toEqual([]);
  });

  test("returns keywords from active radar prompt_configs", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Search for leads",
        version: 1,
        isActive: true,
        keywords: ["need email automation", "struggling with outreach"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const keywords = await t.query(internal.agents.radar.getRadarKeywords);
    expect(keywords).toEqual([
      "need email automation",
      "struggling with outreach",
    ]);
  });

  test("ignores inactive prompt_configs", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Search for leads",
        version: 1,
        isActive: false,
        keywords: ["inactive keyword"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Active search",
        version: 1,
        isActive: true,
        keywords: ["active keyword"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const keywords = await t.query(internal.agents.radar.getRadarKeywords);
    expect(keywords).toEqual(["active keyword"]);
  });

  test("ignores non-radar prompt_configs", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "qualifier",
        promptTemplate: "Qualify leads",
        version: 1,
        isActive: true,
        keywords: ["qualifier keyword"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Search",
        version: 1,
        isActive: true,
        keywords: ["radar keyword"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const keywords = await t.query(internal.agents.radar.getRadarKeywords);
    expect(keywords).toEqual(["radar keyword"]);
  });

  test("merges keywords from multiple active radar configs", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Search 1",
        version: 1,
        isActive: true,
        keywords: ["keyword A"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Search 2",
        version: 1,
        isActive: true,
        keywords: ["keyword B", "keyword C"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const keywords = await t.query(internal.agents.radar.getRadarKeywords);
    expect(keywords).toHaveLength(3);
    expect(keywords).toContain("keyword A");
    expect(keywords).toContain("keyword B");
    expect(keywords).toContain("keyword C");
  });

  test("skips empty and whitespace-only keywords", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("prompt_configs", {
        agentType: "radar",
        promptTemplate: "Search",
        version: 1,
        isActive: true,
        keywords: ["valid keyword", "", "  ", "another valid"],
        createdAt: now,
        updatedAt: now,
      });
    });

    const keywords = await t.query(internal.agents.radar.getRadarKeywords);
    expect(keywords).toEqual(["valid keyword", "another valid"]);
  });
});

// ─── checkLeadExists ─────────────────────────────────────────────────────────

describe("checkLeadExists", () => {
  test("returns false when no lead with email exists", async () => {
    const t = convexTest(schema, modules);

    const exists = await t.query(internal.agents.radar.checkLeadExists, {
      email: "nonexistent@example.com",
    });
    expect(exists).toBe(false);
  });

  test("returns true when lead with email exists", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("leads", {
        email: "existing@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const exists = await t.query(internal.agents.radar.checkLeadExists, {
      email: "existing@example.com",
    });
    expect(exists).toBe(true);
  });
});

// ─── insertRadarLead ─────────────────────────────────────────────────────────

describe("insertRadarLead", () => {
  test("inserts a new lead with correct fields", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.mutation(internal.agents.radar.insertRadarLead, {
      email: "john@example.com",
      name: "John Doe",
      sourceUrl: "https://linkedin.com/in/johndoe",
      detectionChannel: "linkedin",
    });

    expect(leadId).not.toBeNull();

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId!);
    });

    expect(lead).not.toBeNull();
    expect(lead!.email).toBe("john@example.com");
    expect(lead!.name).toBe("John Doe");
    expect(lead!.source).toBe("radar");
    expect(lead!.sourceUrl).toBe("https://linkedin.com/in/johndoe");
    expect(lead!.detectionChannel).toBe("linkedin");
    expect(lead!.status).toBe("pending_qualification");
    expect(lead!.consentSource).toBe("web_scraping");
    expect(lead!.consentDate).toBeTypeOf("number");
    expect(lead!.detectedAt).toBeTypeOf("number");
    expect(lead!.updatedAt).toBeTypeOf("number");
  });

  test("returns null for duplicate email (deduplication)", async () => {
    const t = convexTest(schema, modules);

    // Insert first lead
    const firstId = await t.mutation(internal.agents.radar.insertRadarLead, {
      email: "duplicate@example.com",
      sourceUrl: "https://example.com/1",
      detectionChannel: "web",
    });
    expect(firstId).not.toBeNull();

    // Try to insert duplicate
    const secondId = await t.mutation(internal.agents.radar.insertRadarLead, {
      email: "duplicate@example.com",
      sourceUrl: "https://example.com/2",
      detectionChannel: "twitter",
    });
    expect(secondId).toBeNull();

    // Verify only one lead exists
    const leads = await t.run(async (ctx) => {
      return await ctx.db
        .query("leads")
        .withIndex("by_email", (q) => q.eq("email", "duplicate@example.com"))
        .collect();
    });
    expect(leads).toHaveLength(1);
  });

  test("inserts lead without name when not provided", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.mutation(internal.agents.radar.insertRadarLead, {
      email: "noname@example.com",
      sourceUrl: "https://example.com",
      detectionChannel: "web",
    });

    expect(leadId).not.toBeNull();

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId!);
    });

    expect(lead!.name).toBeUndefined();
  });

  test("deduplicates against leads from other sources", async () => {
    const t = convexTest(schema, modules);

    // Insert a lead from webhook source
    await t.run(async (ctx) => {
      await ctx.db.insert("leads", {
        email: "webhook@example.com",
        source: "webhook_piksend",
        detectedAt: Date.now(),
        detectionChannel: "webhook",
        status: "qualified",
        score: 100,
        consentSource: "product_signup",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Try to insert same email via radar
    const leadId = await t.mutation(internal.agents.radar.insertRadarLead, {
      email: "webhook@example.com",
      sourceUrl: "https://example.com",
      detectionChannel: "web",
    });

    expect(leadId).toBeNull();
  });
});
