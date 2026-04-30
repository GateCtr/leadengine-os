/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  ONBOARDING_STEPS,
  OUTREACH_STEPS,
} from "./engine/sequenceHelpers";

const modules = import.meta.glob("./**/*.ts");

// ─── Helper: insert a qualified lead with a product ──────────────────────────

async function insertTestLead(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    // Insert a product first
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

    const leadId = await ctx.db.insert("leads", {
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

    return leadId;
  });
}

// ─── Step definition tests ───────────────────────────────────────────────────

describe("Sequence step definitions", () => {
  it("outreach sequence has 5 steps with correct day offsets", () => {
    expect(OUTREACH_STEPS).toHaveLength(5);
    expect(OUTREACH_STEPS.map((s) => s.day)).toEqual([0, 3, 7, 14, 30]);
  });

  it("outreach sequence has correct step types", () => {
    expect(OUTREACH_STEPS.map((s) => s.type)).toEqual([
      "initial",
      "relance_1",
      "relance_2",
      "valeur",
      "reactivation",
    ]);
  });

  it("onboarding sequence has 5 steps with correct day offsets", () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
    expect(ONBOARDING_STEPS.map((s) => s.day)).toEqual([0, 1, 3, 7, 14]);
  });

  it("onboarding sequence has correct step types", () => {
    expect(ONBOARDING_STEPS.map((s) => s.type)).toEqual([
      "bienvenue",
      "quick_win",
      "approfondissement",
      "check_in",
      "temoignage",
    ]);
  });

  it("all steps have non-empty angles", () => {
    for (const step of [...OUTREACH_STEPS, ...ONBOARDING_STEPS]) {
      expect(step.angle.length).toBeGreaterThan(0);
    }
  });
});

// ─── createSequence tests ────────────────────────────────────────────────────

describe("createSequence", () => {
  it("creates an outreach sequence with correct steps", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    const sequence = await t.run(async (ctx) => {
      return await ctx.db.get(sequenceId);
    });

    expect(sequence).not.toBeNull();
    expect(sequence!.type).toBe("outreach");
    expect(sequence!.status).toBe("active");
    expect(sequence!.currentStep).toBe(1); // Step 0 is initial (already sent)
    expect(sequence!.steps).toHaveLength(5);
    expect(sequence!.steps.map((s: { day: number }) => s.day)).toEqual([0, 3, 7, 14, 30]);
    expect(sequence!.nextStepDueAt).toBeDefined();
  });

  it("creates an onboarding sequence with correct steps", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "onboarding" },
    );

    const sequence = await t.run(async (ctx) => {
      return await ctx.db.get(sequenceId);
    });

    expect(sequence).not.toBeNull();
    expect(sequence!.type).toBe("onboarding");
    expect(sequence!.status).toBe("active");
    expect(sequence!.currentStep).toBe(1);
    expect(sequence!.steps).toHaveLength(5);
    expect(sequence!.steps.map((s: { day: number }) => s.day)).toEqual([0, 1, 3, 7, 14]);
  });

  it("sets nextStepDueAt relative to creation time", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const beforeCreate = Date.now();
    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    const sequence = await t.run(async (ctx) => {
      return await ctx.db.get(sequenceId);
    });

    // For outreach, step 1 is at day 3
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    expect(sequence!.nextStepDueAt).toBeGreaterThanOrEqual(beforeCreate + threeDaysMs - 1000);
  });
});

// ─── advanceSequenceStep tests ───────────────────────────────────────────────

describe("advanceSequenceStep", () => {
  it("advances to the next step and marks current as completed", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    // Create a message to link
    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        validationStatus: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const nextDue = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await t.mutation(internal.engine.sequenceHelpers.advanceSequenceStep, {
      sequenceId,
      completedStepIndex: 1,
      messageId,
      nextStepDueAt: nextDue,
    });

    const sequence = await t.run(async (ctx) => {
      return await ctx.db.get(sequenceId);
    });

    expect(sequence!.currentStep).toBe(2);
    expect(sequence!.status).toBe("active");
    expect(sequence!.steps[1].completedAt).toBeDefined();
    expect(sequence!.steps[1].messageId).toBe(messageId);
    expect(sequence!.nextStepDueAt).toBe(nextDue);
  });

  it("completes the sequence when advancing past the last step", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    // Advance through all steps (1 through 4, since step 0 is initial)
    for (let i = 1; i < 5; i++) {
      const msgId = await t.run(async (ctx) => {
        return await ctx.db.insert("messages", {
          leadId,
          validationStatus: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      await t.mutation(internal.engine.sequenceHelpers.advanceSequenceStep, {
        sequenceId,
        completedStepIndex: i,
        messageId: msgId,
        nextStepDueAt: i < 4 ? Date.now() + 1000 : undefined,
      });
    }

    const sequence = await t.run(async (ctx) => {
      return await ctx.db.get(sequenceId);
    });

    expect(sequence!.status).toBe("completed");
    expect(sequence!.completedAt).toBeDefined();
  });
});

// ─── archiveLeadAndCompleteSequence tests ────────────────────────────────────

describe("archiveLeadAndCompleteSequence", () => {
  it("archives the lead and completes the sequence", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    await t.mutation(
      internal.engine.sequenceHelpers.archiveLeadAndCompleteSequence,
      { leadId, sequenceId },
    );

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    const sequence = await t.run(async (ctx) => ctx.db.get(sequenceId));

    expect(lead!.status).toBe("archived");
    expect(sequence!.status).toBe("completed");
    expect(sequence!.completedAt).toBeDefined();
  });

  it("does not archive a converted lead", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t, { status: "converted" });

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    await t.mutation(
      internal.engine.sequenceHelpers.archiveLeadAndCompleteSequence,
      { leadId, sequenceId },
    );

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead!.status).toBe("converted"); // Should NOT be archived
  });
});

// ─── pauseSequence tests ─────────────────────────────────────────────────────

describe("pauseSequence", () => {
  it("pauses an active sequence", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    await t.mutation(internal.engine.sequenceHelpers.pauseSequence, {
      sequenceId,
    });

    const sequence = await t.run(async (ctx) => ctx.db.get(sequenceId));
    expect(sequence!.status).toBe("paused");
  });
});

// ─── hasLeadReplied tests ────────────────────────────────────────────────────

describe("hasLeadReplied", () => {
  it("returns false when no messages have replies", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    // Insert a message without a reply
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        sequenceId,
        sequenceStep: 0,
        validationStatus: "sent",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.engine.sequenceHelpers.hasLeadReplied,
      { leadId, sequenceId },
    );

    expect(result).toBe(false);
  });

  it("returns true when a message has a reply", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    // Insert a message with a reply
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        leadId,
        sequenceId,
        sequenceStep: 0,
        validationStatus: "sent",
        replyContent: "I'm interested!",
        replyReceivedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.engine.sequenceHelpers.hasLeadReplied,
      { leadId, sequenceId },
    );

    expect(result).toBe(true);
  });
});

// ─── insertSequenceMessage tests ─────────────────────────────────────────────

describe("insertSequenceMessage", () => {
  it("creates a message linked to the sequence", async () => {
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    const messageId = await t.mutation(
      internal.engine.sequenceHelpers.insertSequenceMessage,
      {
        leadId,
        sequenceId,
        sequenceStep: 1,
        angle: "Preuve sociale",
      },
    );

    const message = await t.run(async (ctx) => ctx.db.get(messageId));

    expect(message).not.toBeNull();
    expect(message!.leadId).toBe(leadId);
    expect(message!.sequenceId).toBe(sequenceId);
    expect(message!.sequenceStep).toBe(1);
    expect(message!.validationStatus).toBe("draft");
  });
});


// ─── updateSequenceMessage → Channel Router → Timing → HITL pipeline tests ──

describe("updateSequenceMessage triggers HITL pipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules the Channel Router after updating message content", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    // Insert a sequence message (draft)
    const messageId = await t.mutation(
      internal.engine.sequenceHelpers.insertSequenceMessage,
      {
        leadId,
        sequenceId,
        sequenceStep: 1,
        angle: "Preuve sociale — témoignage client",
      },
    );

    // Simulate the Copywriter completing composition by calling updateSequenceMessage.
    // This should update the message content AND schedule the Channel Router.
    await t.mutation(
      internal.engine.sequenceHelpers.updateSequenceMessage,
      {
        messageId,
        suggestedReply: "Bonjour, voici un témoignage client...",
        subject: "Un client partage son expérience",
        tone: "expert" as const,
        socialProofUsed: "Témoignage de Jean Dupont",
        contextualLink: "https://piksend.com/lp",
      },
    );

    // Wait for the full chain of scheduled functions:
    // updateSequenceMessage → Channel Router → Timing
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify the message was updated with the composed content
    const message = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(message).not.toBeNull();
    expect(message!.suggestedReply).toBe("Bonjour, voici un témoignage client...");
    expect(message!.subject).toBe("Un client partage son expérience");
    expect(message!.tone).toBe("expert");
    expect(message!.socialProofUsed).toBe("Témoignage de Jean Dupont");
    expect(message!.contextualLink).toBe("https://piksend.com/lp");

    // After the full pipeline (Channel Router → Timing), the message
    // should have a channel, brand identity, sendAtSuggested, and
    // validationStatus = "pending_validation".
    expect(message!.channel).toBeDefined();
    expect(message!.brandIdentity).toBeDefined();
    expect(message!.sendAtSuggested).toBeDefined();
    expect(message!.validationStatus).toBe("pending_validation");
  });

  it("follow-up message starts as draft and ends as pending_validation", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const leadId = await insertTestLead(t);

    const sequenceId = await t.mutation(
      internal.engine.sequenceHelpers.createSequence,
      { leadId, type: "outreach" },
    );

    // Insert a sequence message — should start as draft
    const messageId = await t.mutation(
      internal.engine.sequenceHelpers.insertSequenceMessage,
      {
        leadId,
        sequenceId,
        sequenceStep: 2,
        angle: "Question ouverte simple",
      },
    );

    const draftMessage = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(draftMessage!.validationStatus).toBe("draft");

    // Trigger the pipeline via updateSequenceMessage
    await t.mutation(
      internal.engine.sequenceHelpers.updateSequenceMessage,
      {
        messageId,
        suggestedReply: "Avez-vous eu le temps de tester notre solution ?",
        subject: "Une question rapide",
        tone: "support" as const,
        contextualLink: "https://piksend.com/lp",
      },
    );

    // Wait for the full chain: Channel Router → Timing
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // After the full pipeline (Channel Router → Timing), the message
    // should be pending_validation and ready for the Dashboard
    const finalMessage = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(finalMessage!.validationStatus).toBe("pending_validation");
    expect(finalMessage!.channel).toBeDefined();
    expect(finalMessage!.sendAtSuggested).toBeDefined();
  });
});
