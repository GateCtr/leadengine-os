/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("createLog", () => {
  test("inserts an info log for the radar agent", async () => {
    const t = convexTest(schema, modules);

    const logId = await t.mutation(internal.logs.createLog, {
      agentType: "radar",
      level: "info",
      message: "Radar scan completed successfully",
    });

    expect(logId).toBeDefined();

    const log = await t.run(async (ctx) => {
      return await ctx.db.get(logId);
    });

    expect(log).not.toBeNull();
    expect(log!.agentType).toBe("radar");
    expect(log!.level).toBe("info");
    expect(log!.message).toBe("Radar scan completed successfully");
    expect(log!.timestamp).toBeTypeOf("number");
    expect(log!.leadId).toBeUndefined();
    expect(log!.messageId).toBeUndefined();
    expect(log!.metadata).toBeUndefined();
  });

  test("inserts an error log with leadId and metadata", async () => {
    const t = convexTest(schema, modules);

    // Create a lead to reference
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "pending_qualification",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const logId = await t.mutation(internal.logs.createLog, {
      agentType: "qualifier",
      level: "error",
      message: "LLM call failed: timeout",
      leadId,
      metadata: { errorCode: "TIMEOUT", retryCount: 3 },
    });

    const log = await t.run(async (ctx) => {
      return await ctx.db.get(logId);
    });

    expect(log).not.toBeNull();
    expect(log!.agentType).toBe("qualifier");
    expect(log!.level).toBe("error");
    expect(log!.message).toBe("LLM call failed: timeout");
    expect(log!.leadId).toBe(leadId);
    expect(log!.metadata).toEqual({ errorCode: "TIMEOUT", retryCount: 3 });
  });

  test("supports warn level", async () => {
    const t = convexTest(schema, modules);

    const logId = await t.mutation(internal.logs.createLog, {
      agentType: "copywriter",
      level: "warn",
      message: "A/B testing disabled, generating single version",
    });

    const log = await t.run(async (ctx) => {
      return await ctx.db.get(logId);
    });

    expect(log!.level).toBe("warn");
    expect(log!.agentType).toBe("copywriter");
  });

  test("supports all 10 agent types", async () => {
    const t = convexTest(schema, modules);

    const agentTypes = [
      "radar",
      "qualifier",
      "copywriter",
      "objector",
      "timing",
      "analyst",
      "channel_router",
      "sequence_engine",
      "churn_detector",
      "upsell_engine",
    ] as const;

    for (const agentType of agentTypes) {
      const logId = await t.mutation(internal.logs.createLog, {
        agentType,
        level: "info",
        message: `Log from ${agentType}`,
      });

      const log = await t.run(async (ctx) => {
        return await ctx.db.get(logId);
      });

      expect(log!.agentType).toBe(agentType);
    }

    // Verify all 10 logs were created
    const allLogs = await t.run(async (ctx) => {
      return await ctx.db.query("agent_logs").collect();
    });

    expect(allLogs).toHaveLength(10);
  });

  test("inserts a log with messageId reference", async () => {
    const t = convexTest(schema, modules);

    // Create a lead first (required for message)
    const leadId = await t.run(async (ctx) => {
      return await ctx.db.insert("leads", {
        email: "test@example.com",
        source: "radar",
        detectedAt: Date.now(),
        detectionChannel: "web",
        status: "qualified",
        consentSource: "web_scraping",
        consentDate: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Create a message to reference
    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        leadId,
        validationStatus: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const logId = await t.mutation(internal.logs.createLog, {
      agentType: "channel_router",
      level: "info",
      message: "Message routed to email channel",
      leadId,
      messageId,
    });

    const log = await t.run(async (ctx) => {
      return await ctx.db.get(logId);
    });

    expect(log!.messageId).toBe(messageId);
    expect(log!.leadId).toBe(leadId);
  });

  test("timestamp is set automatically", async () => {
    const t = convexTest(schema, modules);

    const before = Date.now();

    const logId = await t.mutation(internal.logs.createLog, {
      agentType: "timing",
      level: "info",
      message: "Send time suggested",
    });

    const after = Date.now();

    const log = await t.run(async (ctx) => {
      return await ctx.db.get(logId);
    });

    expect(log!.timestamp).toBeGreaterThanOrEqual(before);
    expect(log!.timestamp).toBeLessThanOrEqual(after);
  });
});
