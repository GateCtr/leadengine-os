/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  buildSocialDirectLink,
  determineChannel,
} from "./router/channelRouter";

const modules = import.meta.glob("./**/*.ts");

// ─── determineChannel (pure function tests) ─────────────────────────────────

describe("determineChannel", () => {
  test("returns 'twitter' when detectionChannel is 'twitter'", () => {
    const channel = determineChannel({
      detectionChannel: "twitter",
    });
    expect(channel).toBe("twitter");
  });

  test("returns 'linkedin' when detectionChannel is 'linkedin'", () => {
    const channel = determineChannel({
      detectionChannel: "linkedin",
    });
    expect(channel).toBe("linkedin");
  });

  test("returns 'reddit' when detectionChannel is 'reddit'", () => {
    const channel = determineChannel({
      detectionChannel: "reddit",
    });
    expect(channel).toBe("reddit");
  });

  test("returns 'instagram' when detectionChannel is 'instagram'", () => {
    const channel = determineChannel({
      detectionChannel: "instagram",
    });
    expect(channel).toBe("instagram");
  });

  test("returns 'twitter' when sourceUrl contains twitter.com", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: "https://twitter.com/user/status/123",
    });
    expect(channel).toBe("twitter");
  });

  test("returns 'twitter' when sourceUrl contains x.com", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: "https://x.com/user/status/456",
    });
    expect(channel).toBe("twitter");
  });

  test("returns 'linkedin' when sourceUrl contains linkedin.com", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: "https://www.linkedin.com/in/johndoe",
    });
    expect(channel).toBe("linkedin");
  });

  test("returns 'reddit' when sourceUrl contains reddit.com", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: "https://www.reddit.com/r/programming/comments/abc",
    });
    expect(channel).toBe("reddit");
  });

  test("returns 'instagram' when sourceUrl contains instagram.com", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: "https://www.instagram.com/p/abc123",
    });
    expect(channel).toBe("instagram");
  });

  test("returns 'email' as default when no social signals", () => {
    const channel = determineChannel({
      detectionChannel: "web",
    });
    expect(channel).toBe("email");
  });

  test("returns 'email' when detectionChannel is 'webhook'", () => {
    const channel = determineChannel({
      detectionChannel: "webhook",
    });
    expect(channel).toBe("email");
  });

  test("returns 'email' when sourceUrl is a non-social URL", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: "https://example.com/blog/post",
    });
    expect(channel).toBe("email");
  });

  test("detectionChannel takes priority over sourceUrl", () => {
    const channel = determineChannel({
      detectionChannel: "twitter",
      sourceUrl: "https://www.linkedin.com/in/johndoe",
    });
    expect(channel).toBe("twitter");
  });

  test("returns 'email' when sourceUrl is null", () => {
    const channel = determineChannel({
      detectionChannel: "web",
      sourceUrl: null,
    });
    expect(channel).toBe("email");
  });
});

// ─── buildSocialDirectLink (pure function tests) ────────────────────────────

describe("buildSocialDirectLink", () => {
  test("returns sourceUrl when provided", () => {
    const link = buildSocialDirectLink(
      "twitter",
      "https://twitter.com/user/status/123",
    );
    expect(link).toBe("https://twitter.com/user/status/123");
  });

  test("returns generic twitter URL when no sourceUrl", () => {
    const link = buildSocialDirectLink("twitter");
    expect(link).toBe("https://twitter.com");
  });

  test("returns generic linkedin URL when no sourceUrl", () => {
    const link = buildSocialDirectLink("linkedin");
    expect(link).toBe("https://linkedin.com");
  });

  test("returns generic reddit URL when no sourceUrl", () => {
    const link = buildSocialDirectLink("reddit");
    expect(link).toBe("https://reddit.com");
  });

  test("returns generic instagram URL when no sourceUrl", () => {
    const link = buildSocialDirectLink("instagram");
    expect(link).toBe("https://instagram.com");
  });

  test("returns sourceUrl even when it does not match the channel", () => {
    const link = buildSocialDirectLink(
      "twitter",
      "https://linkedin.com/in/user",
    );
    expect(link).toBe("https://linkedin.com/in/user");
  });

  test("returns generic URL when sourceUrl is null", () => {
    const link = buildSocialDirectLink("linkedin", null);
    expect(link).toBe("https://linkedin.com");
  });
});

// ─── routeMessage (Convex integration tests) ────────────────────────────────

describe("routeMessage", () => {
  async function setupProduct(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("products", {
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
  }

  async function setupLead(
    t: ReturnType<typeof convexTest>,
    overrides: Record<string, unknown> = {},
  ) {
    return await t.run(async (ctx) => {
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
        ...overrides,
      });
    });
  }

  async function setupMessage(
    t: ReturnType<typeof convexTest>,
    leadId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId: leadId as any,
        suggestedReply: "Hello, I noticed your work...",
        validationStatus: "draft",
        tone: "expert",
        contextualLink: "https://piksend.com/lp",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
      });
    });
  }

  test("routes email message with correct brand identity", async () => {
    const t = convexTest(schema, modules);
    await setupProduct(t);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message).not.toBeNull();
    expect(message!.channel).toBe("email");
    expect(message!.brandIdentity).toEqual({
      sender: "hello@piksend.com",
      replyTo: "support@piksend.com",
      templateId: "piksend-outreach",
    });
    expect(message!.socialDirectLink).toBeUndefined();
  });

  test("routes twitter message when detectionChannel is twitter", async () => {
    const t = convexTest(schema, modules);
    await setupProduct(t);
    const leadId = await setupLead(t, {
      detectionChannel: "twitter",
      sourceUrl: "https://twitter.com/user/status/123",
    });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.channel).toBe("twitter");
    expect(message!.brandIdentity).toEqual({
      sender: "hello@piksend.com",
      replyTo: "support@piksend.com",
      templateId: "piksend-outreach",
    });
    expect(message!.socialDirectLink).toBe(
      "https://twitter.com/user/status/123",
    );
  });

  test("routes linkedin message when sourceUrl contains linkedin.com", async () => {
    const t = convexTest(schema, modules);
    await setupProduct(t);
    const leadId = await setupLead(t, {
      detectionChannel: "web",
      sourceUrl: "https://www.linkedin.com/in/johndoe",
    });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.channel).toBe("linkedin");
    expect(message!.socialDirectLink).toBe(
      "https://www.linkedin.com/in/johndoe",
    );
  });

  test("skips routing when message already has a channel", async () => {
    const t = convexTest(schema, modules);
    await setupProduct(t);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string, {
      channel: "email",
    });

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    // Channel should remain unchanged
    expect(message!.channel).toBe("email");
    // brandIdentity should NOT have been set (routing was skipped)
    expect(message!.brandIdentity).toBeUndefined();
  });

  test("logs error when lead has no productId", async () => {
    const t = convexTest(schema, modules);
    const leadId = await setupLead(t, { productId: undefined });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    // Message should not be routed
    expect(message!.channel).toBeUndefined();

    // Check that an error log was created
    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("agent_logs")
        .withIndex("by_agentType", (q) => q.eq("agentType", "channel_router"))
        .collect();
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });

  test("logs error when product is not found", async () => {
    const t = convexTest(schema, modules);
    // No product seeded — lead references a non-existent product
    const leadId = await setupLead(t, { productId: "nonexistent" });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.channel).toBeUndefined();

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("agent_logs")
        .withIndex("by_agentType", (q) => q.eq("agentType", "channel_router"))
        .collect();
    });
    expect(logs.some((l) => l.level === "error")).toBe(true);
    expect(
      logs.some((l) => l.message.includes("nonexistent")),
    ).toBe(true);
  });

  test("routes with different product brand identity (gatectr)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", {
        slug: "gatectr",
        name: "GateCtr",
        senderEmail: "hello@gatectr.com",
        replyToEmail: "support@gatectr.com",
        templateId: "gatectr-outreach",
        brandColor: "#2563EB",
        logoUrl: "https://cdn.leadengine.io/logos/gatectr.svg",
        landingPageBaseUrl: "https://gatectr.com/lp",
        uspDescription: "LLM cost optimization",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const leadId = await setupLead(t, { productId: "gatectr" });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.channel).toBe("email");
    expect(message!.brandIdentity).toEqual({
      sender: "hello@gatectr.com",
      replyTo: "support@gatectr.com",
      templateId: "gatectr-outreach",
    });
  });

  test("routes reddit message with social direct link", async () => {
    const t = convexTest(schema, modules);
    await setupProduct(t);
    const leadId = await setupLead(t, {
      detectionChannel: "reddit",
      sourceUrl: "https://www.reddit.com/r/saas/comments/abc",
    });
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message!.channel).toBe("reddit");
    expect(message!.socialDirectLink).toBe(
      "https://www.reddit.com/r/saas/comments/abc",
    );
    expect(message!.brandIdentity).toBeDefined();
  });

  test("creates info log on successful routing", async () => {
    const t = convexTest(schema, modules);
    await setupProduct(t);
    const leadId = await setupLead(t);
    const messageId = await setupMessage(t, leadId as string);

    await t.mutation(internal.router.channelRouter.routeMessage, {
      messageId,
    });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("agent_logs")
        .withIndex("by_agentType", (q) => q.eq("agentType", "channel_router"))
        .collect();
    });

    const infoLog = logs.find((l) => l.level === "info" && l.message.includes("routed"));
    expect(infoLog).toBeDefined();
    expect(infoLog!.message).toContain("channel=email");
    expect(infoLog!.message).toContain("piksend");
  });
});
