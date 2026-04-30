/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("addToBlacklist", () => {
  test("adds an email to the blacklist with unsubscribe reason", async () => {
    const t = convexTest(schema, modules);

    const id = await t.mutation(internal.compliance.blacklist.addToBlacklist, {
      email: "user@example.com",
      reason: "unsubscribe",
    });

    expect(id).toBeDefined();

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(id);
    });

    expect(entry).not.toBeNull();
    expect(entry!.email).toBe("user@example.com");
    expect(entry!.reason).toBe("unsubscribe");
    expect(entry!.addedAt).toBeTypeOf("number");
  });

  test("normalizes email to lowercase", async () => {
    const t = convexTest(schema, modules);

    const id = await t.mutation(internal.compliance.blacklist.addToBlacklist, {
      email: "User@Example.COM",
      reason: "unsubscribe",
    });

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(id);
    });

    expect(entry!.email).toBe("user@example.com");
  });

  test("is idempotent — returns existing entry ID for duplicate email", async () => {
    const t = convexTest(schema, modules);

    const id1 = await t.mutation(internal.compliance.blacklist.addToBlacklist, {
      email: "dup@example.com",
      reason: "unsubscribe",
    });

    const id2 = await t.mutation(internal.compliance.blacklist.addToBlacklist, {
      email: "dup@example.com",
      reason: "gdpr_request",
    });

    expect(id1).toBe(id2);

    // Only one entry should exist
    const entries = await t.run(async (ctx) => {
      return await ctx.db
        .query("blacklist")
        .withIndex("by_email", (q) => q.eq("email", "dup@example.com"))
        .collect();
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("unsubscribe"); // original reason preserved
  });

  test("supports all three reason types", async () => {
    const t = convexTest(schema, modules);

    const reasons = ["unsubscribe", "manual_removal", "gdpr_request"] as const;

    for (const reason of reasons) {
      const id = await t.mutation(
        internal.compliance.blacklist.addToBlacklist,
        { email: `${reason}@example.com`, reason },
      );

      const entry = await t.run(async (ctx) => {
        return await ctx.db.get(id);
      });

      expect(entry!.reason).toBe(reason);
    }
  });
});

describe("isBlacklisted", () => {
  test("returns true for a blacklisted email", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.compliance.blacklist.addToBlacklist, {
      email: "blocked@example.com",
      reason: "unsubscribe",
    });

    const result = await t.query(
      internal.compliance.blacklist.isBlacklisted,
      { email: "blocked@example.com" },
    );

    expect(result).toBe(true);
  });

  test("returns false for a non-blacklisted email", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(
      internal.compliance.blacklist.isBlacklisted,
      { email: "clean@example.com" },
    );

    expect(result).toBe(false);
  });

  test("is case-insensitive", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.compliance.blacklist.addToBlacklist, {
      email: "CaseTest@Example.com",
      reason: "unsubscribe",
    });

    const result = await t.query(
      internal.compliance.blacklist.isBlacklisted,
      { email: "casetest@example.com" },
    );

    expect(result).toBe(true);
  });
});
