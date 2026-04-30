import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Settings — CRUD pour Products, Prompt Configs et Upsell Rules
 *
 * Provides dashboard management for:
 * - Products: create, update, toggle active
 * - Prompt Configs: create, update, toggle active
 * - Upsell Rules: create, update, toggle active
 *
 * All mutations require authentication via ctx.auth.getUserIdentity().
 */

// ─── Products ────────────────────────────────────────────────────────────────

export const listProducts = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("products"),
      _creationTime: v.number(),
      slug: v.string(),
      name: v.string(),
      senderEmail: v.string(),
      replyToEmail: v.string(),
      templateId: v.string(),
      brandColor: v.string(),
      logoUrl: v.string(),
      landingPageBaseUrl: v.string(),
      uspDescription: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const products = await ctx.db.query("products").order("desc").take(100);
    return products;
  },
});

export const createProduct = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    senderEmail: v.string(),
    replyToEmail: v.string(),
    templateId: v.string(),
    brandColor: v.string(),
    logoUrl: v.string(),
    landingPageBaseUrl: v.string(),
    uspDescription: v.optional(v.string()),
    isActive: v.boolean(),
  },
  returns: v.id("products"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const now = Date.now();
    return await ctx.db.insert("products", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateProduct = mutation({
  args: {
    id: v.id("products"),
    slug: v.optional(v.string()),
    name: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    replyToEmail: v.optional(v.string()),
    templateId: v.optional(v.string()),
    brandColor: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    landingPageBaseUrl: v.optional(v.string()),
    uspDescription: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Product not found");

    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
    return null;
  },
});

export const toggleProductActive = mutation({
  args: { id: v.id("products") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const product = await ctx.db.get(id);
    if (!product) throw new Error("Product not found");

    await ctx.db.patch(id, {
      isActive: !product.isActive,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ─── Prompt Configs ──────────────────────────────────────────────────────────

export const listPromptConfigs = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("prompt_configs"),
      _creationTime: v.number(),
      agentType: v.string(),
      productId: v.optional(v.string()),
      productName: v.optional(v.string()),
      promptTemplate: v.string(),
      version: v.number(),
      isActive: v.boolean(),
      keywords: v.optional(v.array(v.string())),
      uspDescription: v.optional(v.string()),
      performanceScore: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const configs = await ctx.db
      .query("prompt_configs")
      .order("desc")
      .take(100);

    const enriched = await Promise.all(
      configs.map(async (c) => {
        let productName: string | undefined;
        if (c.productId) {
          const product = await ctx.db
            .query("products")
            .withIndex("by_slug", (q) => q.eq("slug", c.productId!))
            .unique();
          productName = product?.name;
        }
        return {
          _id: c._id,
          _creationTime: c._creationTime,
          agentType: c.agentType,
          productId: c.productId,
          productName,
          promptTemplate: c.promptTemplate,
          version: c.version,
          isActive: c.isActive,
          keywords: c.keywords,
          uspDescription: c.uspDescription,
          performanceScore: c.performanceScore,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      }),
    );

    return enriched;
  },
});

export const createPromptConfig = mutation({
  args: {
    agentType: v.union(
      v.literal("radar"),
      v.literal("qualifier"),
      v.literal("copywriter"),
      v.literal("objector"),
      v.literal("timing"),
      v.literal("analyst"),
    ),
    productId: v.optional(v.string()),
    promptTemplate: v.string(),
    version: v.number(),
    isActive: v.boolean(),
    keywords: v.optional(v.array(v.string())),
    uspDescription: v.optional(v.string()),
  },
  returns: v.id("prompt_configs"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const now = Date.now();
    return await ctx.db.insert("prompt_configs", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updatePromptConfig = mutation({
  args: {
    id: v.id("prompt_configs"),
    agentType: v.optional(
      v.union(
        v.literal("radar"),
        v.literal("qualifier"),
        v.literal("copywriter"),
        v.literal("objector"),
        v.literal("timing"),
        v.literal("analyst"),
      ),
    ),
    productId: v.optional(v.string()),
    promptTemplate: v.optional(v.string()),
    version: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    keywords: v.optional(v.array(v.string())),
    uspDescription: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Prompt config not found");

    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
    return null;
  },
});

export const togglePromptConfigActive = mutation({
  args: { id: v.id("prompt_configs") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const config = await ctx.db.get(id);
    if (!config) throw new Error("Prompt config not found");

    await ctx.db.patch(id, {
      isActive: !config.isActive,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ─── Upsell Rules ────────────────────────────────────────────────────────────

export const listUpsellRules = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("upsell_rules"),
      _creationTime: v.number(),
      sourceProductSlug: v.string(),
      sourceProductName: v.optional(v.string()),
      signal: v.string(),
      targetProductSlug: v.string(),
      targetProductName: v.optional(v.string()),
      description: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const rules = await ctx.db
      .query("upsell_rules")
      .order("desc")
      .take(100);

    const enriched = await Promise.all(
      rules.map(async (r) => {
        const sourceProduct = await ctx.db
          .query("products")
          .withIndex("by_slug", (q) => q.eq("slug", r.sourceProductSlug))
          .unique();
        const targetProduct = await ctx.db
          .query("products")
          .withIndex("by_slug", (q) => q.eq("slug", r.targetProductSlug))
          .unique();

        return {
          _id: r._id,
          _creationTime: r._creationTime,
          sourceProductSlug: r.sourceProductSlug,
          sourceProductName: sourceProduct?.name,
          signal: r.signal,
          targetProductSlug: r.targetProductSlug,
          targetProductName: targetProduct?.name,
          description: r.description,
          isActive: r.isActive,
          createdAt: r.createdAt,
        };
      }),
    );

    return enriched;
  },
});

export const createUpsellRule = mutation({
  args: {
    sourceProductSlug: v.string(),
    signal: v.string(),
    targetProductSlug: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
  },
  returns: v.id("upsell_rules"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    return await ctx.db.insert("upsell_rules", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const updateUpsellRule = mutation({
  args: {
    id: v.id("upsell_rules"),
    sourceProductSlug: v.optional(v.string()),
    signal: v.optional(v.string()),
    targetProductSlug: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Upsell rule not found");

    await ctx.db.patch(id, fields);
    return null;
  },
});

export const toggleUpsellRuleActive = mutation({
  args: { id: v.id("upsell_rules") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const rule = await ctx.db.get(id);
    if (!rule) throw new Error("Upsell rule not found");

    await ctx.db.patch(id, { isActive: !rule.isActive });
    return null;
  },
});


// ─── Seed Data ───────────────────────────────────────────────────────────────

/**
 * Run the initial seed to populate products and upsell rules.
 * Idempotent — skips existing records.
 * Callable from the Dashboard Settings page.
 */
export const runSeed = mutation({
  args: {},
  returns: v.object({
    productsCreated: v.number(),
    rulesCreated: v.number(),
    promptsCreated: v.number(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const now = Date.now();
    let productsCreated = 0;
    let rulesCreated = 0;

    const products = [
      { slug: "piksend", name: "Piksend", senderEmail: "hello@piksend.com", replyToEmail: "support@piksend.com", templateId: "piksend-outreach", brandColor: "#FF6B35", logoUrl: "https://cdn.leadengine.io/logos/piksend.svg", landingPageBaseUrl: "https://piksend.com/lp", uspDescription: "Gestion professionnelle des photos — upload, traitement et diffusion d'images optimisés pour les équipes créatives et les marketeurs.", isActive: true, createdAt: now, updatedAt: now },
      { slug: "gatectr", name: "GateCtr", senderEmail: "hello@gatectr.com", replyToEmail: "support@gatectr.com", templateId: "gatectr-outreach", brandColor: "#2563EB", logoUrl: "https://cdn.leadengine.io/logos/gatectr.svg", landingPageBaseUrl: "https://gatectr.com/lp", uspDescription: "Optimisation des coûts LLM — gateway intelligente pour contrôler, router et réduire les dépenses API des modèles de langage.", isActive: true, createdAt: now, updatedAt: now },
      { slug: "joventy", name: "Joventy", senderEmail: "hello@joventy.com", replyToEmail: "support@joventy.com", templateId: "joventy-outreach", brandColor: "#10B981", logoUrl: "https://cdn.leadengine.io/logos/joventy.svg", landingPageBaseUrl: "https://joventy.com/lp", uspDescription: "Automatisation de workflow — plateforme no-code pour automatiser les processus récurrents et gagner en productivité.", isActive: true, createdAt: now, updatedAt: now },
      { slug: "ryan_sabowa", name: "Ryan Sabowa", senderEmail: "contact@ryansabowa.com", replyToEmail: "ryan@ryansabowa.com", templateId: "ryan-sabowa-outreach", brandColor: "#8B5CF6", logoUrl: "https://cdn.leadengine.io/logos/ryansabowa.svg", landingPageBaseUrl: "https://ryansabowa.com/lp", uspDescription: "Accompagnement dédié — conseil stratégique et technique personnalisé pour les projets digitaux ambitieux.", isActive: true, createdAt: now, updatedAt: now },
    ];

    for (const product of products) {
      const existing = await ctx.db.query("products").withIndex("by_slug", (q) => q.eq("slug", product.slug)).unique();
      if (!existing) { await ctx.db.insert("products", product); productsCreated++; }
    }

    const rules = [
      { sourceProductSlug: "piksend", signal: "api_intensive_usage", targetProductSlug: "gatectr", description: "Usage intensif de l'API détecté chez un client Piksend — suggérer GateCtr pour l'optimisation des coûts LLM.", isActive: true, createdAt: now },
      { sourceProductSlug: "gatectr", signal: "image_volume_growing", targetProductSlug: "piksend", description: "Volume d'images traité croissant détecté chez un client GateCtr — suggérer Piksend pour la gestion professionnelle des photos.", isActive: true, createdAt: now },
      { sourceProductSlug: "ryan_sabowa", signal: "recurring_projects", targetProductSlug: "joventy", description: "Client Ryan Sabowa avec pattern de projets récurrents — suggérer Joventy pour l'automatisation du workflow.", isActive: true, createdAt: now },
      { sourceProductSlug: "joventy", signal: "consulting_need_identified", targetProductSlug: "ryan_sabowa", description: "Besoin de conseil identifié chez un client Joventy — suggérer Ryan Sabowa pour un accompagnement dédié.", isActive: true, createdAt: now },
    ];

    for (const rule of rules) {
      const existing = await ctx.db.query("upsell_rules").withIndex("by_sourceProductSlug", (q) => q.eq("sourceProductSlug", rule.sourceProductSlug)).filter((q) => q.eq(q.field("signal"), rule.signal)).unique();
      if (!existing) { await ctx.db.insert("upsell_rules", rule); rulesCreated++; }
    }

    // --- Seed Prompt Configs ---
    let promptsCreated = 0;

    const promptConfigs: Array<{
      agentType: "radar" | "qualifier" | "copywriter" | "objector" | "timing" | "analyst";
      productId?: string;
      promptTemplate: string;
      version: number;
      isActive: boolean;
      keywords?: string[];
      uspDescription?: string;
    }> = [
      // Radar — keywords for web lead detection
      {
        agentType: "radar",
        promptTemplate: "Rechercher des leads potentiels sur le web en utilisant les mots-clés de douleur utilisateur configurés. Identifier les signaux d'intention d'achat et les besoins non satisfaits.",
        version: 1,
        isActive: true,
        keywords: [
          "saas pricing too expensive",
          "looking for automation tool",
          "need photo management solution",
          "LLM API cost optimization",
          "freelance project management tool",
          "besoin consultant digital",
          "outil automatisation workflow",
          "gestion photos professionnelle",
        ],
      },

      // Qualifier — per product
      { agentType: "qualifier", productId: "piksend", promptTemplate: "Tu es l'Agent Qualificateur de LeadEngine OS pour Piksend. Analyse sémantiquement le lead et attribue un score pondéré /100.\n\nPRODUIT: Piksend — Gestion professionnelle des photos (upload, traitement, diffusion d'images optimisés pour les équipes créatives et les marketeurs).\n\nCRITÈRES DE SCORING:\n- Urgence exprimée (≤30 pts): Le prospect mentionne-t-il un besoin urgent de gestion d'images ?\n- Source webhook (≤25 pts): Le lead provient-il d'un webhook produit ?\n- Correspondance produit (≤20 pts): Le problème du prospect correspond-il à l'USP de Piksend ?\n- Profil actif (≤15 pts): Le prospect a-t-il un profil enrichi, un compte actif ?\n- Signaux contextuels (≤10 pts): Y a-t-il des signaux d'engagement supplémentaires ?\n\nSi score ≥ 40 → qualifier avec productId 'piksend'. Si score < 40 → discard.", version: 1, isActive: true, uspDescription: "Gestion professionnelle des photos — upload, traitement et diffusion d'images optimisés pour les équipes créatives et les marketeurs." },
      { agentType: "qualifier", productId: "gatectr", promptTemplate: "Tu es l'Agent Qualificateur de LeadEngine OS pour GateCtr. Analyse sémantiquement le lead et attribue un score pondéré /100.\n\nPRODUIT: GateCtr — Gateway intelligente pour contrôler, router et réduire les dépenses API des modèles de langage.\n\nCRITÈRES DE SCORING:\n- Urgence exprimée (≤30 pts): Le prospect mentionne-t-il des coûts LLM élevés ?\n- Source webhook (≤25 pts): Le lead provient-il d'un webhook produit ?\n- Correspondance produit (≤20 pts): Le problème correspond-il à l'optimisation des coûts API ?\n- Profil actif (≤15 pts): Le prospect a-t-il un profil technique enrichi ?\n- Signaux contextuels (≤10 pts): Signaux d'engagement supplémentaires ?\n\nSi score ≥ 40 → qualifier avec productId 'gatectr'. Si score < 40 → discard.", version: 1, isActive: true, uspDescription: "Optimisation des coûts LLM — gateway intelligente pour contrôler, router et réduire les dépenses API des modèles de langage." },
      { agentType: "qualifier", productId: "joventy", promptTemplate: "Tu es l'Agent Qualificateur de LeadEngine OS pour Joventy. Analyse sémantiquement le lead et attribue un score pondéré /100.\n\nPRODUIT: Joventy — Plateforme no-code pour automatiser les processus récurrents et gagner en productivité.\n\nCRITÈRES DE SCORING:\n- Urgence exprimée (≤30 pts): Le prospect mentionne-t-il un besoin d'automatisation ?\n- Source webhook (≤25 pts): Le lead provient-il d'un webhook produit ?\n- Correspondance produit (≤20 pts): Le problème correspond-il à l'automatisation de workflow ?\n- Profil actif (≤15 pts): Le prospect a-t-il un profil enrichi ?\n- Signaux contextuels (≤10 pts): Signaux d'engagement supplémentaires ?\n\nSi score ≥ 40 → qualifier avec productId 'joventy'. Si score < 40 → discard.", version: 1, isActive: true, uspDescription: "Automatisation de workflow — plateforme no-code pour automatiser les processus récurrents et gagner en productivité." },
      { agentType: "qualifier", productId: "ryan_sabowa", promptTemplate: "Tu es l'Agent Qualificateur de LeadEngine OS pour Ryan Sabowa. Analyse sémantiquement le lead et attribue un score pondéré /100.\n\nPRODUIT: Ryan Sabowa — Accompagnement dédié en conseil stratégique et technique personnalisé pour les projets digitaux ambitieux.\n\nCRITÈRES DE SCORING:\n- Urgence exprimée (≤30 pts): Le prospect mentionne-t-il un besoin de conseil ?\n- Source webhook (≤25 pts): Le lead provient-il d'un webhook produit ?\n- Correspondance produit (≤20 pts): Le problème correspond-il à un besoin d'accompagnement ?\n- Profil actif (≤15 pts): Le prospect a-t-il un profil enrichi ?\n- Signaux contextuels (≤10 pts): Signaux d'engagement supplémentaires ?\n\nSi score ≥ 40 → qualifier avec productId 'ryan_sabowa'. Si score < 40 → discard.", version: 1, isActive: true, uspDescription: "Accompagnement dédié — conseil stratégique et technique personnalisé pour les projets digitaux ambitieux." },

      // Copywriter — per product
      { agentType: "copywriter", productId: "piksend", promptTemplate: "Tu es le Copywriter de LeadEngine OS pour Piksend.\n\nPRODUIT: Piksend — Gestion professionnelle des photos.\n\nRÈGLES:\n- Compose un message personnalisé et contextuel — PAS de template figé\n- Adapte le ton: Expert (thought leadership), Support (empathique), Tech (pair technique)\n- Intègre naturellement la preuve sociale (témoignage client)\n- Intègre le lien contextuel vers la landing page\n- 150-300 mots pour le corps du message\n- Sujet personnalisé et accrocheur (< 60 caractères)\n- Écris dans la langue du prospect (défaut: français)", version: 1, isActive: true },
      { agentType: "copywriter", productId: "gatectr", promptTemplate: "Tu es le Copywriter de LeadEngine OS pour GateCtr.\n\nPRODUIT: GateCtr — Gateway intelligente d'optimisation des coûts LLM.\n\nRÈGLES:\n- Compose un message personnalisé et contextuel — PAS de template figé\n- Adapte le ton selon le profil technique du prospect\n- Mets en avant les économies concrètes et le ROI\n- Intègre naturellement la preuve sociale et le lien landing page\n- 150-300 mots, sujet < 60 caractères\n- Langue du prospect (défaut: français)", version: 1, isActive: true },
      { agentType: "copywriter", productId: "joventy", promptTemplate: "Tu es le Copywriter de LeadEngine OS pour Joventy.\n\nPRODUIT: Joventy — Plateforme no-code d'automatisation de workflow.\n\nRÈGLES:\n- Compose un message personnalisé et contextuel — PAS de template figé\n- Mets en avant le gain de temps et la simplicité no-code\n- Adapte le ton selon le profil du prospect\n- Intègre naturellement la preuve sociale et le lien landing page\n- 150-300 mots, sujet < 60 caractères\n- Langue du prospect (défaut: français)", version: 1, isActive: true },
      { agentType: "copywriter", productId: "ryan_sabowa", promptTemplate: "Tu es le Copywriter de LeadEngine OS pour Ryan Sabowa.\n\nPRODUIT: Ryan Sabowa — Accompagnement stratégique et technique dédié.\n\nRÈGLES:\n- Compose un message personnalisé et contextuel — PAS de template figé\n- Ton chaleureux et professionnel, axé sur la relation humaine\n- Mets en avant la valeur de l'accompagnement personnalisé\n- Intègre naturellement la preuve sociale et le lien landing page\n- 150-300 mots, sujet < 60 caractères\n- Langue du prospect (défaut: français)", version: 1, isActive: true },

      // Objector — per product
      { agentType: "objector", productId: "piksend", promptTemplate: "Tu es l'Agent Objecteur de LeadEngine OS pour Piksend.\n\nTÂCHE: Analyse la réponse du prospect et catégorise-la.\n\nCATÉGORIES:\n- trop_cher: Le prospect trouve le prix trop élevé\n- besoin_reflexion: Le prospect veut réfléchir\n- question_technique: Le prospect pose une question technique\n- interet_confirme: Le prospect est intéressé\n- refus: Le prospect refuse catégoriquement\n\nSi objection (trop_cher, besoin_reflexion, question_technique):\n→ Génère une contre-réponse empathique basée sur les forces de Piksend (gestion photo pro, gain de temps, qualité d'image).\n→ Ne sois jamais agressif ou insistant.", version: 1, isActive: true },
      { agentType: "objector", productId: "gatectr", promptTemplate: "Tu es l'Agent Objecteur de LeadEngine OS pour GateCtr.\n\nTÂCHE: Analyse la réponse du prospect et catégorise-la.\n\nCATÉGORIES: trop_cher | besoin_reflexion | question_technique | interet_confirme | refus\n\nSi objection:\n→ Génère une contre-réponse technique et factuelle basée sur les économies concrètes que GateCtr apporte (réduction coûts API, ROI mesurable).\n→ Utilise des chiffres et des exemples concrets.", version: 1, isActive: true },
      { agentType: "objector", productId: "joventy", promptTemplate: "Tu es l'Agent Objecteur de LeadEngine OS pour Joventy.\n\nTÂCHE: Analyse la réponse du prospect et catégorise-la.\n\nCATÉGORIES: trop_cher | besoin_reflexion | question_technique | interet_confirme | refus\n\nSi objection:\n→ Génère une contre-réponse axée sur le gain de temps et la simplicité no-code.\n→ Mets en avant la facilité de prise en main et les résultats rapides.", version: 1, isActive: true },
      { agentType: "objector", productId: "ryan_sabowa", promptTemplate: "Tu es l'Agent Objecteur de LeadEngine OS pour Ryan Sabowa.\n\nTÂCHE: Analyse la réponse du prospect et catégorise-la.\n\nCATÉGORIES: trop_cher | besoin_reflexion | question_technique | interet_confirme | refus\n\nSi objection:\n→ Génère une contre-réponse personnalisée mettant en avant la valeur de l'accompagnement dédié.\n→ Ton empathique, axé sur la relation et les résultats passés.", version: 1, isActive: true },

      // Analyst — global
      {
        agentType: "analyst",
        promptTemplate: "Tu es l'Agent Analyste de LeadEngine OS.\n\nTÂCHES:\n1. Analyse les performances du pipeline (taux d'ouverture, clic, réponse, conversion)\n2. Corrèle les messages avec les conversions Stripe via attribution multi-touch\n3. Évalue les A/B tests matures (≥ 14 jours) et adopte le gagnant\n4. Propose des révisions de prompts pour les configs sous-performantes (score < 30%)\n5. Génère un rapport hebdomadaire récapitulatif\n\nSois data-driven et actionnable dans tes recommandations.",
        version: 1,
        isActive: true,
      },

      // Timing — global
      {
        agentType: "timing",
        promptTemplate: "Tu es l'Agent Timing de LeadEngine OS.\n\nTÂCHE: Détermine l'heure d'envoi optimale pour chaque message.\n\nCRITÈRES:\n- Fuseau horaire du prospect (déduit du profil enrichi ou de la localisation)\n- Niveau d'activité détecté (heures de connexion, engagement)\n- Créneaux statistiques optimaux: mardi-jeudi 9h-11h pour B2B\n- Ne jamais bloquer l'envoi immédiat — c'est une suggestion\n\nRetourne un timestamp UTC pour le champ sendAtSuggested.",
        version: 1,
        isActive: true,
      },
    ];

    for (const config of promptConfigs) {
      // Check for existing active config with same agentType + productId
      const existing = await ctx.db.query("prompt_configs")
        .withIndex("by_agentType_productId", (q) => {
          const q1 = q.eq("agentType", config.agentType);
          return config.productId ? q1.eq("productId", config.productId) : q1;
        })
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();

      if (!existing) {
        await ctx.db.insert("prompt_configs", {
          agentType: config.agentType,
          productId: config.productId,
          promptTemplate: config.promptTemplate,
          version: config.version,
          isActive: config.isActive,
          keywords: config.keywords,
          uspDescription: config.uspDescription,
          createdAt: now,
          updatedAt: now,
        });
        promptsCreated++;
      }
    }

    return { productsCreated, rulesCreated, promptsCreated };
  },
});


// ─── Test Utilities (dev only) ───────────────────────────────────────────────

/**
 * Trigger a manual Radar scan from the Dashboard.
 * Calls the internal runRadarScan action.
 */
export const triggerRadarScan = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    await ctx.scheduler.runAfter(0, internal.agents.radar.runRadarScan, {});
    return null;
  },
});
