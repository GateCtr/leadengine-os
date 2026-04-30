import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Seed de données initiales pour la table `products`.
 * Insère les 4 produits (Piksend, GateCtr, Joventy, Ryan Sabowa)
 * avec leurs configurations complètes.
 *
 * Usage: Appeler via le Dashboard Convex ou via ctx.runMutation(internal.seed.seedProducts)
 */
export const seedProducts = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    const products = [
      {
        slug: "piksend",
        name: "Piksend",
        senderEmail: "hello@piksend.com",
        replyToEmail: "support@piksend.com",
        templateId: "piksend-outreach",
        brandColor: "#FF6B35",
        logoUrl: "https://cdn.leadengine.io/logos/piksend.svg",
        landingPageBaseUrl: "https://piksend.com/lp",
        uspDescription:
          "Gestion professionnelle des photos — upload, traitement et diffusion d'images optimisés pour les équipes créatives et les marketeurs.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "gatectr",
        name: "GateCtr",
        senderEmail: "hello@gatectr.com",
        replyToEmail: "support@gatectr.com",
        templateId: "gatectr-outreach",
        brandColor: "#2563EB",
        logoUrl: "https://cdn.leadengine.io/logos/gatectr.svg",
        landingPageBaseUrl: "https://gatectr.com/lp",
        uspDescription:
          "Optimisation des coûts LLM — gateway intelligente pour contrôler, router et réduire les dépenses API des modèles de langage.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "joventy",
        name: "Joventy",
        senderEmail: "hello@joventy.com",
        replyToEmail: "support@joventy.com",
        templateId: "joventy-outreach",
        brandColor: "#10B981",
        logoUrl: "https://cdn.leadengine.io/logos/joventy.svg",
        landingPageBaseUrl: "https://joventy.com/lp",
        uspDescription:
          "Automatisation de workflow — plateforme no-code pour automatiser les processus récurrents et gagner en productivité.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "ryan_sabowa",
        name: "Ryan Sabowa",
        senderEmail: "contact@ryansabowa.com",
        replyToEmail: "ryan@ryansabowa.com",
        templateId: "ryan-sabowa-outreach",
        brandColor: "#8B5CF6",
        logoUrl: "https://cdn.leadengine.io/logos/ryansabowa.svg",
        landingPageBaseUrl: "https://ryansabowa.com/lp",
        uspDescription:
          "Accompagnement dédié — conseil stratégique et technique personnalisé pour les projets digitaux ambitieux.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    // Check for existing products to avoid duplicates
    for (const product of products) {
      const existing = await ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", product.slug))
        .unique();

      if (existing === null) {
        await ctx.db.insert("products", product);
      }
    }

    return null;
  },
});

/**
 * Seed de données initiales pour la table `upsell_rules`.
 * Insère les 4 règles cross-sell définies dans le design :
 * - Piksend → GateCtr (api_intensive_usage)
 * - GateCtr → Piksend (image_volume_growing)
 * - Ryan Sabowa → Joventy (recurring_projects)
 * - Joventy → Ryan Sabowa (consulting_need_identified)
 *
 * Usage: Appeler via le Dashboard Convex ou via ctx.runMutation(internal.seed.seedUpsellRules)
 */
export const seedUpsellRules = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    const rules = [
      {
        sourceProductSlug: "piksend",
        signal: "api_intensive_usage",
        targetProductSlug: "gatectr",
        description:
          "Usage intensif de l'API détecté chez un client Piksend — suggérer GateCtr pour l'optimisation des coûts LLM.",
        isActive: true,
        createdAt: now,
      },
      {
        sourceProductSlug: "gatectr",
        signal: "image_volume_growing",
        targetProductSlug: "piksend",
        description:
          "Volume d'images traité croissant détecté chez un client GateCtr — suggérer Piksend pour la gestion professionnelle des photos.",
        isActive: true,
        createdAt: now,
      },
      {
        sourceProductSlug: "ryan_sabowa",
        signal: "recurring_projects",
        targetProductSlug: "joventy",
        description:
          "Client Ryan Sabowa avec pattern de projets récurrents — suggérer Joventy pour l'automatisation du workflow.",
        isActive: true,
        createdAt: now,
      },
      {
        sourceProductSlug: "joventy",
        signal: "consulting_need_identified",
        targetProductSlug: "ryan_sabowa",
        description:
          "Besoin de conseil identifié chez un client Joventy — suggérer Ryan Sabowa pour un accompagnement dédié.",
        isActive: true,
        createdAt: now,
      },
    ];

    // Check for existing rules to avoid duplicates
    for (const rule of rules) {
      const existing = await ctx.db
        .query("upsell_rules")
        .withIndex("by_sourceProductSlug", (q) =>
          q.eq("sourceProductSlug", rule.sourceProductSlug),
        )
        .filter((q) => q.eq(q.field("signal"), rule.signal))
        .unique();

      if (existing === null) {
        await ctx.db.insert("upsell_rules", rule);
      }
    }

    return null;
  },
});

/**
 * Seed complet — exécute les deux seeds (products + upsell_rules) en une seule mutation.
 *
 * Usage: Appeler via le Dashboard Convex ou via ctx.runMutation(internal.seed.seedAll)
 */
export const seedAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    // --- Seed Products ---
    const products = [
      {
        slug: "piksend",
        name: "Piksend",
        senderEmail: "hello@piksend.com",
        replyToEmail: "support@piksend.com",
        templateId: "piksend-outreach",
        brandColor: "#FF6B35",
        logoUrl: "https://cdn.leadengine.io/logos/piksend.svg",
        landingPageBaseUrl: "https://piksend.com/lp",
        uspDescription:
          "Gestion professionnelle des photos — upload, traitement et diffusion d'images optimisés pour les équipes créatives et les marketeurs.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "gatectr",
        name: "GateCtr",
        senderEmail: "hello@gatectr.com",
        replyToEmail: "support@gatectr.com",
        templateId: "gatectr-outreach",
        brandColor: "#2563EB",
        logoUrl: "https://cdn.leadengine.io/logos/gatectr.svg",
        landingPageBaseUrl: "https://gatectr.com/lp",
        uspDescription:
          "Optimisation des coûts LLM — gateway intelligente pour contrôler, router et réduire les dépenses API des modèles de langage.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "joventy",
        name: "Joventy",
        senderEmail: "hello@joventy.com",
        replyToEmail: "support@joventy.com",
        templateId: "joventy-outreach",
        brandColor: "#10B981",
        logoUrl: "https://cdn.leadengine.io/logos/joventy.svg",
        landingPageBaseUrl: "https://joventy.com/lp",
        uspDescription:
          "Automatisation de workflow — plateforme no-code pour automatiser les processus récurrents et gagner en productivité.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "ryan_sabowa",
        name: "Ryan Sabowa",
        senderEmail: "contact@ryansabowa.com",
        replyToEmail: "ryan@ryansabowa.com",
        templateId: "ryan-sabowa-outreach",
        brandColor: "#8B5CF6",
        logoUrl: "https://cdn.leadengine.io/logos/ryansabowa.svg",
        landingPageBaseUrl: "https://ryansabowa.com/lp",
        uspDescription:
          "Accompagnement dédié — conseil stratégique et technique personnalisé pour les projets digitaux ambitieux.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const product of products) {
      const existing = await ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", product.slug))
        .unique();

      if (existing === null) {
        await ctx.db.insert("products", product);
      }
    }

    // --- Seed Upsell Rules ---
    const rules = [
      {
        sourceProductSlug: "piksend",
        signal: "api_intensive_usage",
        targetProductSlug: "gatectr",
        description:
          "Usage intensif de l'API détecté chez un client Piksend — suggérer GateCtr pour l'optimisation des coûts LLM.",
        isActive: true,
        createdAt: now,
      },
      {
        sourceProductSlug: "gatectr",
        signal: "image_volume_growing",
        targetProductSlug: "piksend",
        description:
          "Volume d'images traité croissant détecté chez un client GateCtr — suggérer Piksend pour la gestion professionnelle des photos.",
        isActive: true,
        createdAt: now,
      },
      {
        sourceProductSlug: "ryan_sabowa",
        signal: "recurring_projects",
        targetProductSlug: "joventy",
        description:
          "Client Ryan Sabowa avec pattern de projets récurrents — suggérer Joventy pour l'automatisation du workflow.",
        isActive: true,
        createdAt: now,
      },
      {
        sourceProductSlug: "joventy",
        signal: "consulting_need_identified",
        targetProductSlug: "ryan_sabowa",
        description:
          "Besoin de conseil identifié chez un client Joventy — suggérer Ryan Sabowa pour un accompagnement dédié.",
        isActive: true,
        createdAt: now,
      },
    ];

    for (const rule of rules) {
      const existing = await ctx.db
        .query("upsell_rules")
        .withIndex("by_sourceProductSlug", (q) =>
          q.eq("sourceProductSlug", rule.sourceProductSlug),
        )
        .filter((q) => q.eq(q.field("signal"), rule.signal))
        .unique();

      if (existing === null) {
        await ctx.db.insert("upsell_rules", rule);
      }
    }

    return null;
  },
});
