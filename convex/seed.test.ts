/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("seedProducts", () => {
  test("inserts all 4 products with correct configurations", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedProducts, {});

    // Query all products
    const products = await t.run(async (ctx) => {
      return await ctx.db.query("products").collect();
    });

    expect(products).toHaveLength(4);

    // Verify Piksend
    const piksend = products.find((p) => p.slug === "piksend");
    expect(piksend).toBeDefined();
    expect(piksend!.name).toBe("Piksend");
    expect(piksend!.senderEmail).toBe("hello@piksend.com");
    expect(piksend!.replyToEmail).toBe("support@piksend.com");
    expect(piksend!.templateId).toBe("piksend-outreach");
    expect(piksend!.brandColor).toBe("#FF6B35");
    expect(piksend!.landingPageBaseUrl).toBe("https://piksend.com/lp");
    expect(piksend!.isActive).toBe(true);

    // Verify GateCtr
    const gatectr = products.find((p) => p.slug === "gatectr");
    expect(gatectr).toBeDefined();
    expect(gatectr!.name).toBe("GateCtr");
    expect(gatectr!.senderEmail).toBe("hello@gatectr.com");
    expect(gatectr!.replyToEmail).toBe("support@gatectr.com");
    expect(gatectr!.templateId).toBe("gatectr-outreach");
    expect(gatectr!.brandColor).toBe("#2563EB");
    expect(gatectr!.landingPageBaseUrl).toBe("https://gatectr.com/lp");
    expect(gatectr!.isActive).toBe(true);

    // Verify Joventy
    const joventy = products.find((p) => p.slug === "joventy");
    expect(joventy).toBeDefined();
    expect(joventy!.name).toBe("Joventy");
    expect(joventy!.senderEmail).toBe("hello@joventy.com");
    expect(joventy!.replyToEmail).toBe("support@joventy.com");
    expect(joventy!.templateId).toBe("joventy-outreach");
    expect(joventy!.brandColor).toBe("#10B981");
    expect(joventy!.landingPageBaseUrl).toBe("https://joventy.com/lp");
    expect(joventy!.isActive).toBe(true);

    // Verify Ryan Sabowa
    const ryanSabowa = products.find((p) => p.slug === "ryan_sabowa");
    expect(ryanSabowa).toBeDefined();
    expect(ryanSabowa!.name).toBe("Ryan Sabowa");
    expect(ryanSabowa!.senderEmail).toBe("contact@ryansabowa.com");
    expect(ryanSabowa!.replyToEmail).toBe("ryan@ryansabowa.com");
    expect(ryanSabowa!.templateId).toBe("ryan-sabowa-outreach");
    expect(ryanSabowa!.brandColor).toBe("#8B5CF6");
    expect(ryanSabowa!.landingPageBaseUrl).toBe("https://ryansabowa.com/lp");
    expect(ryanSabowa!.isActive).toBe(true);

    // Verify all products have USP descriptions
    for (const product of products) {
      expect(product.uspDescription).toBeDefined();
      expect(typeof product.uspDescription).toBe("string");
      expect(product.uspDescription!.length).toBeGreaterThan(0);
    }
  });

  test("is idempotent — running twice does not create duplicates", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedProducts, {});
    await t.mutation(internal.seed.seedProducts, {});

    const products = await t.run(async (ctx) => {
      return await ctx.db.query("products").collect();
    });

    expect(products).toHaveLength(4);
  });
});

describe("seedUpsellRules", () => {
  test("inserts all 4 upsell rules with correct configurations", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedUpsellRules, {});

    const rules = await t.run(async (ctx) => {
      return await ctx.db.query("upsell_rules").collect();
    });

    expect(rules).toHaveLength(4);

    // Verify Piksend → GateCtr
    const piksendToGatectr = rules.find(
      (r) =>
        r.sourceProductSlug === "piksend" && r.signal === "api_intensive_usage",
    );
    expect(piksendToGatectr).toBeDefined();
    expect(piksendToGatectr!.targetProductSlug).toBe("gatectr");
    expect(piksendToGatectr!.isActive).toBe(true);

    // Verify GateCtr → Piksend
    const gatectrToPiksend = rules.find(
      (r) =>
        r.sourceProductSlug === "gatectr" &&
        r.signal === "image_volume_growing",
    );
    expect(gatectrToPiksend).toBeDefined();
    expect(gatectrToPiksend!.targetProductSlug).toBe("piksend");
    expect(gatectrToPiksend!.isActive).toBe(true);

    // Verify Ryan Sabowa → Joventy
    const ryanToJoventy = rules.find(
      (r) =>
        r.sourceProductSlug === "ryan_sabowa" &&
        r.signal === "recurring_projects",
    );
    expect(ryanToJoventy).toBeDefined();
    expect(ryanToJoventy!.targetProductSlug).toBe("joventy");
    expect(ryanToJoventy!.isActive).toBe(true);

    // Verify Joventy → Ryan Sabowa
    const joventyToRyan = rules.find(
      (r) =>
        r.sourceProductSlug === "joventy" &&
        r.signal === "consulting_need_identified",
    );
    expect(joventyToRyan).toBeDefined();
    expect(joventyToRyan!.targetProductSlug).toBe("ryan_sabowa");
    expect(joventyToRyan!.isActive).toBe(true);

    // Verify all rules have descriptions
    for (const rule of rules) {
      expect(rule.description).toBeDefined();
      expect(typeof rule.description).toBe("string");
      expect(rule.description!.length).toBeGreaterThan(0);
    }
  });

  test("is idempotent — running twice does not create duplicates", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedUpsellRules, {});
    await t.mutation(internal.seed.seedUpsellRules, {});

    const rules = await t.run(async (ctx) => {
      return await ctx.db.query("upsell_rules").collect();
    });

    expect(rules).toHaveLength(4);
  });
});

describe("seedAll", () => {
  test("seeds both products and upsell rules in a single mutation", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedAll, {});

    const products = await t.run(async (ctx) => {
      return await ctx.db.query("products").collect();
    });
    const rules = await t.run(async (ctx) => {
      return await ctx.db.query("upsell_rules").collect();
    });

    expect(products).toHaveLength(4);
    expect(rules).toHaveLength(4);
  });

  test("is idempotent — running twice does not create duplicates", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.seedAll, {});
    await t.mutation(internal.seed.seedAll, {});

    const products = await t.run(async (ctx) => {
      return await ctx.db.query("products").collect();
    });
    const rules = await t.run(async (ctx) => {
      return await ctx.db.query("upsell_rules").collect();
    });

    expect(products).toHaveLength(4);
    expect(rules).toHaveLength(4);
  });
});
