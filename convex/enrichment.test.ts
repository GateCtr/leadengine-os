/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { buildUrlsToScrape } from "./enrichment";

const modules = import.meta.glob("./**/*.ts");

// ─── buildUrlsToScrape (pure function) ──────────────────────────────────────

describe("buildUrlsToScrape", () => {
  test("returns sourceUrl as first URL when available", () => {
    const urls = buildUrlsToScrape({
      email: "john@example.com",
      sourceUrl: "https://linkedin.com/in/johndoe",
    });
    expect(urls[0]).toBe("https://linkedin.com/in/johndoe");
  });

  test("constructs LinkedIn URL from name when no LinkedIn URL exists", () => {
    const urls = buildUrlsToScrape({
      email: "john@example.com",
      name: "John Doe",
    });
    expect(urls).toContain("https://www.linkedin.com/in/john-doe");
  });

  test("constructs GitHub URL from email username", () => {
    const urls = buildUrlsToScrape({
      email: "jdoe@example.com",
    });
    expect(urls).toContain("https://github.com/jdoe");
  });

  test("does not duplicate LinkedIn URL if sourceUrl is already LinkedIn", () => {
    const urls = buildUrlsToScrape({
      email: "john@example.com",
      name: "John Doe",
      sourceUrl: "https://linkedin.com/in/johndoe",
    });
    const linkedinUrls = urls.filter((u) =>
      u.toLowerCase().includes("linkedin.com"),
    );
    expect(linkedinUrls).toHaveLength(1);
  });

  test("does not duplicate GitHub URL if sourceUrl is already GitHub", () => {
    const urls = buildUrlsToScrape({
      email: "jdoe@example.com",
      sourceUrl: "https://github.com/jdoe",
    });
    const githubUrls = urls.filter((u) =>
      u.toLowerCase().includes("github.com"),
    );
    expect(githubUrls).toHaveLength(1);
  });

  test("includes existing enrichment URLs", () => {
    const urls = buildUrlsToScrape({
      email: "john@example.com",
      enrichmentData: {
        linkedinUrl: "https://linkedin.com/in/existing",
        githubUrl: "https://github.com/existing",
      },
    });
    expect(urls).toContain("https://linkedin.com/in/existing");
    expect(urls).toContain("https://github.com/existing");
  });

  test("returns empty array when no data available", () => {
    const urls = buildUrlsToScrape({
      email: "",
    });
    // email is empty so no github URL, no name so no linkedin URL, no sourceUrl
    expect(urls).toHaveLength(0);
  });

  test("handles email-only lead with GitHub URL construction", () => {
    const urls = buildUrlsToScrape({
      email: "developer@company.com",
    });
    expect(urls).toContain("https://github.com/developer");
    expect(urls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── getLeadForEnrichment ────────────────────────────────────────────────────

describe("getLeadForEnrichment", () => {
  test("returns lead data when lead exists", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        name: "Test User",
        source: "radar",
        sourceUrl: "https://linkedin.com/in/testuser",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const lead = await t.query(internal.enrichment.getLeadForEnrichment, {
      leadId,
    });

    expect(lead).not.toBeNull();
    expect(lead!._id).toEqual(leadId);
    expect(lead!.email).toBe("test@example.com");
    expect(lead!.name).toBe("Test User");
    expect(lead!.sourceUrl).toBe("https://linkedin.com/in/testuser");
    expect(lead!.status).toBe("pending_qualification");
  });

  test("returns null when lead does not exist", async () => {
    const t = convexTest(schema, modules);

    // Use a fake ID — we need to create and delete a lead to get a valid-format ID
    const tempId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("leads", {
        email: "temp@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    const lead = await t.query(internal.enrichment.getLeadForEnrichment, {
      leadId: tempId,
    });

    expect(lead).toBeNull();
  });

  test("returns existing enrichment data if present", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "enriched@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        enrichmentData: {
          linkedinUrl: "https://linkedin.com/in/enriched",
          bio: "A developer",
          scrapedAt: Date.now(),
        },
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const lead = await t.query(internal.enrichment.getLeadForEnrichment, {
      leadId,
    });

    expect(lead).not.toBeNull();
    expect(lead!.enrichmentData).toBeDefined();
    expect(lead!.enrichmentData!.linkedinUrl).toBe(
      "https://linkedin.com/in/enriched",
    );
    expect(lead!.enrichmentData!.bio).toBe("A developer");
  });
});

// ─── updateLeadEnrichment ────────────────────────────────────────────────────

describe("updateLeadEnrichment", () => {
  test("stores enrichment data on a lead", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "update@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const scrapedAt = Date.now();
    await t.mutation(internal.enrichment.updateLeadEnrichment, {
      leadId,
      enrichmentData: {
        linkedinUrl: "https://linkedin.com/in/testuser",
        githubUrl: "https://github.com/testuser",
        bio: "Full-stack developer",
        skills: ["TypeScript", "React"],
        company: "TechCorp",
        role: "Senior Engineer",
        scrapedAt,
      },
    });

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.enrichmentData).toBeDefined();
    expect(lead!.enrichmentData!.linkedinUrl).toBe(
      "https://linkedin.com/in/testuser",
    );
    expect(lead!.enrichmentData!.githubUrl).toBe(
      "https://github.com/testuser",
    );
    expect(lead!.enrichmentData!.bio).toBe("Full-stack developer");
    expect(lead!.enrichmentData!.skills).toEqual(["TypeScript", "React"]);
    expect(lead!.enrichmentData!.company).toBe("TechCorp");
    expect(lead!.enrichmentData!.role).toBe("Senior Engineer");
    expect(lead!.enrichmentData!.scrapedAt).toBe(scrapedAt);
  });

  test("merges new enrichment data with existing data", async () => {
    const t = convexTest(schema, modules);

    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "merge@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        enrichmentData: {
          linkedinUrl: "https://linkedin.com/in/existing",
          bio: "Original bio",
          scrapedAt: 1000,
        },
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Update with partial new data — should merge, not overwrite
    await t.mutation(internal.enrichment.updateLeadEnrichment, {
      leadId,
      enrichmentData: {
        githubUrl: "https://github.com/newuser",
        company: "NewCorp",
        scrapedAt: 2000,
      },
    });

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    // New fields should be set
    expect(lead!.enrichmentData!.githubUrl).toBe(
      "https://github.com/newuser",
    );
    expect(lead!.enrichmentData!.company).toBe("NewCorp");
    expect(lead!.enrichmentData!.scrapedAt).toBe(2000);
    // Existing fields should be preserved
    expect(lead!.enrichmentData!.linkedinUrl).toBe(
      "https://linkedin.com/in/existing",
    );
    expect(lead!.enrichmentData!.bio).toBe("Original bio");
  });

  test("updates the updatedAt timestamp", async () => {
    const t = convexTest(schema, modules);

    const originalUpdatedAt = Date.now() - 10000;
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "timestamp@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: originalUpdatedAt,
      });
    });

    await t.mutation(internal.enrichment.updateLeadEnrichment, {
      leadId,
      enrichmentData: {
        bio: "Updated bio",
        scrapedAt: Date.now(),
      },
    });

    const lead = await t.run(async (ctx) => {
      return await ctx.db.get(leadId);
    });

    expect(lead!.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  test("does nothing when lead does not exist", async () => {
    const t = convexTest(schema, modules);

    // Create and delete a lead to get a valid-format ID
    const tempId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("leads", {
        email: "temp@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    // Should not throw
    await t.mutation(internal.enrichment.updateLeadEnrichment, {
      leadId: tempId,
      enrichmentData: {
        bio: "Should not be stored",
        scrapedAt: Date.now(),
      },
    });
  });
});
