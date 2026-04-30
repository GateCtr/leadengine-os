/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function insertTestLead(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
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

    return await ctx.db.insert("leads", {
      email: "test@example.com",
      source: "radar",
      detectedAt: now,
      detectionChannel: "web",
      status: "qualified",
      score: 75,
      productId: "piksend",
      consentSource: "radar_detection",
      consentDate: now,
      updatedAt: now,
      ...overrides,
    });
  });
}

describe("hasExistingSequence", () => {
  it("returns false when no sequence exists for the lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const result = await t.query(
      internal.router.sendMessageHelpers.hasExistingSequence,
      { leadId },
    );

    expect(result).toBe(false);
  });

  it("returns true when an outreach sequence exists for the lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    await t.mutation(internal.engine.sequenceHelpers.createSequence, {
      leadId,
      type: "outreach",
    });

    const result = await t.query(
      internal.router.sendMessageHelpers.hasExistingSequence,
      { leadId },
    );

    expect(result).toBe(true);
  });

  it("returns true when an onboarding sequence exists for the lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    await t.mutation(internal.engine.sequenceHelpers.createSequence, {
      leadId,
      type: "onboarding",
    });

    const result = await t.query(
      internal.router.sendMessageHelpers.hasExistingSequence,
      { leadId },
    );

    expect(result).toBe(true);
  });
});

describe("getMessage returns sequence fields", () => {
  it("returns sequenceId and sequenceStep when present", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        sequenceId,
        sequenceStep: 1,
        validationStatus: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const message = await t.query(
      internal.router.sendMessageHelpers.getMessage,
      { messageId },
    );

    expect(message).not.toBeNull();
    expect(message!.sequenceId).toBe(sequenceId);
    expect(message!.sequenceStep).toBe(1);
  });

  it("returns undefined for sequenceId and sequenceStep when not set", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        validationStatus: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const message = await t.query(
      internal.router.sendMessageHelpers.getMessage,
      { messageId },
    );

    expect(message).not.toBeNull();
    expect(message!.sequenceId).toBeUndefined();
    expect(message!.sequenceStep).toBeUndefined();
  });
});
