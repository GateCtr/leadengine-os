import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ═══════════════════════════════════════════
  // TABLE PRODUCTS — Configuration dynamique des produits
  // ═══════════════════════════════════════════
  products: defineTable({
    slug: v.string(), // Ex: "piksend", "gatectr", "joventy", "ryan_sabowa"
    name: v.string(), // Nom d'affichage (ex: "Piksend")
    senderEmail: v.string(), // Ex: "hello@piksend.com"
    replyToEmail: v.string(), // Ex: "support@piksend.com"
    templateId: v.string(), // Ex: "piksend-outreach"
    brandColor: v.string(), // Ex: "#FF6B35"
    logoUrl: v.string(), // URL du logo produit
    landingPageBaseUrl: v.string(), // Ex: "https://piksend.com/lp"
    uspDescription: v.optional(v.string()), // USP pour le Qualificateur
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_isActive", ["isActive"]),

  // ═══════════════════════════════════════════
  // TABLE UPSELL_RULES — Règles d'upsell/cross-sell configurables
  // ═══════════════════════════════════════════
  upsell_rules: defineTable({
    sourceProductSlug: v.string(), // Slug du produit source
    signal: v.string(), // Signal déclencheur (ex: "api_intensive_usage")
    targetProductSlug: v.string(), // Slug du produit cible
    description: v.optional(v.string()), // Description de la règle
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_sourceProductSlug", ["sourceProductSlug"])
    .index("by_isActive", ["isActive"]),

  // ═══════════════════════════════════════════
  // TABLE LEADS — Cœur du pipeline
  // ═══════════════════════════════════════════
  leads: defineTable({
    // Identité
    email: v.string(),
    externalId: v.optional(v.string()), // ID unique cross-canal
    name: v.optional(v.string()),

    // Source — pattern dynamique "webhook_{productSlug}" ou "radar"
    source: v.string(), // Ex: "radar", "webhook_piksend", "webhook_gatectr", etc.
    sourceUrl: v.optional(v.string()),
    detectedAt: v.number(), // Timestamp première détection
    detectionChannel: v.string(), // Canal d'origine

    // Qualification
    status: v.union(
      v.literal("pending_qualification"),
      v.literal("qualified"),
      v.literal("discarded"),
      v.literal("hot"),
      v.literal("pending"),
      v.literal("converted"),
      v.literal("archived"),
      v.literal("churned"),
    ),
    score: v.optional(v.number()), // Score /100
    scoringBreakdown: v.optional(
      v.object({
        urgency: v.number(),
        webhookSource: v.number(),
        productMatch: v.number(),
        activeProfile: v.number(),
        contextSignals: v.number(),
      }),
    ),
    productId: v.optional(v.string()), // Slug du produit (référence dynamique vers products.slug)
    scoringReasoning: v.optional(v.string()),

    // Enrichissement
    enrichmentData: v.optional(
      v.object({
        linkedinUrl: v.optional(v.string()),
        githubUrl: v.optional(v.string()),
        websiteUrl: v.optional(v.string()),
        bio: v.optional(v.string()),
        skills: v.optional(v.array(v.string())),
        company: v.optional(v.string()),
        role: v.optional(v.string()),
        scrapedAt: v.optional(v.number()),
      }),
    ),

    // Webhook produit (leads chauds)
    webhookEventType: v.optional(v.string()),
    webhookEventContext: v.optional(v.string()),
    webhookUserId: v.optional(v.string()),

    // Conversion
    revenueGenerated: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    convertedAt: v.optional(v.number()),

    // Churn
    churnRiskScore: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),

    // Conformité
    consentSource: v.string(), // Source du consentement
    consentDate: v.number(), // Date du consentement

    // Métadonnées
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_status_score", ["status", "score"])
    .index("by_productId", ["productId"])
    .index("by_source", ["source"])
    .index("by_externalId", ["externalId"]),

  // ═══════════════════════════════════════════
  // TABLE MESSAGES — Messages composés et envoyés
  // ═══════════════════════════════════════════
  messages: defineTable({
    leadId: v.id("leads"),

    // Contenu
    suggestedReply: v.optional(v.string()),
    suggestedReplyB: v.optional(v.string()), // Version B pour A/B test
    activeVersion: v.optional(v.union(v.literal("A"), v.literal("B"))),
    finalContent: v.optional(v.string()), // Contenu validé par l'opérateur
    subject: v.optional(v.string()), // Sujet email

    // Ton et contexte
    tone: v.optional(
      v.union(v.literal("expert"), v.literal("support"), v.literal("tech")),
    ),
    socialProofUsed: v.optional(v.string()),
    contextualLink: v.optional(v.string()),

    // Canal et routage
    channel: v.optional(
      v.union(
        v.literal("email"),
        v.literal("twitter"),
        v.literal("linkedin"),
        v.literal("reddit"),
        v.literal("instagram"),
      ),
    ),
    brandIdentity: v.optional(
      v.object({
        sender: v.string(),
        replyTo: v.string(),
        templateId: v.string(),
      }),
    ),
    socialDirectLink: v.optional(v.string()), // Lien direct plateforme sociale

    // Timing
    sendAtSuggested: v.optional(v.number()), // Timestamp suggéré par Agent Timing
    sentAt: v.optional(v.number()), // Timestamp réel d'envoi

    // Validation HITL
    validationStatus: v.union(
      v.literal("draft"),
      v.literal("pending_validation"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent"),
    ),
    validatedBy: v.optional(v.string()), // Clerk userId
    validatedAt: v.optional(v.number()),

    // Séquence
    sequenceId: v.optional(v.id("sequences")),
    sequenceStep: v.optional(v.number()), // 0=initial, 1=J+3, 2=J+7, etc.

    // Réponse
    replyContent: v.optional(v.string()),
    replyCategory: v.optional(
      v.union(
        v.literal("trop_cher"),
        v.literal("besoin_reflexion"),
        v.literal("question_technique"),
        v.literal("interet_confirme"),
        v.literal("refus"),
      ),
    ),
    replyReceivedAt: v.optional(v.number()),

    // Tracking
    resendMessageId: v.optional(v.string()),
    opened: v.optional(v.boolean()),
    openedAt: v.optional(v.number()),
    clicked: v.optional(v.boolean()),
    clickedAt: v.optional(v.number()),

    // Métadonnées
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_leadId", ["leadId"])
    .index("by_validationStatus", ["validationStatus"])
    .index("by_sequenceId", ["sequenceId"])
    .index("by_channel", ["channel"])
    .index("by_sentAt", ["sentAt"]),

  // ═══════════════════════════════════════════
  // TABLE SEQUENCES — Séquences de relance et onboarding
  // ═══════════════════════════════════════════
  sequences: defineTable({
    leadId: v.id("leads"),
    type: v.union(
      v.literal("outreach"), // Séquence de relance standard
      v.literal("onboarding"), // Séquence post-conversion
    ),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    currentStep: v.number(), // Step actuel (0-indexed)
    steps: v.array(
      v.object({
        day: v.number(), // Jour relatif (0, 3, 7, 14, 30)
        type: v.string(), // "initial", "relance_1", "valeur", etc.
        angle: v.string(), // Description de l'angle
        messageId: v.optional(v.id("messages")),
        completedAt: v.optional(v.number()),
      }),
    ),
    startedAt: v.number(),
    nextStepDueAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_leadId", ["leadId"])
    .index("by_status", ["status"])
    .index("by_nextStepDueAt", ["nextStepDueAt"]),

  // ═══════════════════════════════════════════
  // TABLE CHANNELS — Configuration des canaux par produit
  // ═══════════════════════════════════════════
  channels: defineTable({
    productId: v.string(), // Slug du produit (référence dynamique vers products.slug)
    type: v.union(v.literal("email"), v.literal("social")),
    config: v.object({
      sender: v.optional(v.string()),
      replyTo: v.optional(v.string()),
      templateId: v.optional(v.string()),
      platform: v.optional(v.string()),
      brandColor: v.optional(v.string()),
      logoUrl: v.optional(v.string()),
    }),
    isActive: v.boolean(),
  })
    .index("by_productId", ["productId"])
    .index("by_type", ["type"]),

  // ═══════════════════════════════════════════
  // TABLE PROMPT_CONFIGS — Prompts des agents par produit
  // ═══════════════════════════════════════════
  prompt_configs: defineTable({
    agentType: v.union(
      v.literal("radar"),
      v.literal("qualifier"),
      v.literal("copywriter"),
      v.literal("objector"),
      v.literal("timing"),
      v.literal("analyst"),
    ),
    productId: v.optional(v.string()), // Slug du produit (référence dynamique vers products.slug)
    promptTemplate: v.string(),
    version: v.number(),
    isActive: v.boolean(),
    keywords: v.optional(v.array(v.string())), // Mots-clés Radar
    uspDescription: v.optional(v.string()), // USP produit pour Qualificateur
    performanceScore: v.optional(v.number()), // Score perf calculé par Analyste
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agentType", ["agentType"])
    .index("by_agentType_productId", ["agentType", "productId"])
    .index("by_isActive", ["isActive"]),

  // ═══════════════════════════════════════════
  // TABLE ANALYTICS — Métriques et rapports
  // ═══════════════════════════════════════════
  analytics: defineTable({
    type: v.union(
      v.literal("weekly_report"),
      v.literal("ab_test_result"),
      v.literal("attribution"),
      v.literal("win_loss"),
    ),
    productId: v.optional(v.string()), // Slug du produit (référence dynamique vers products.slug)
    period: v.optional(
      v.object({
        start: v.number(),
        end: v.number(),
      }),
    ),
    data: v.any(), // Données flexibles selon le type
    createdAt: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_type_createdAt", ["type", "createdAt"])
    .index("by_productId", ["productId"]),

  // ═══════════════════════════════════════════
  // TABLE TRACKING_EVENTS — Événements comportementaux
  // ═══════════════════════════════════════════
  tracking_events: defineTable({
    leadId: v.id("leads"),
    messageId: v.id("messages"),
    type: v.union(
      v.literal("click"),
      v.literal("open"),
      v.literal("reply"),
      v.literal("unsubscribe"),
      v.literal("conversion"),
    ),
    url: v.optional(v.string()),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
  })
    .index("by_leadId", ["leadId"])
    .index("by_messageId", ["messageId"])
    .index("by_type", ["type"])
    .index("by_timestamp", ["timestamp"]),

  // ═══════════════════════════════════════════
  // TABLE SHORT_URLS — URLs courtes pour tracking
  // ═══════════════════════════════════════════
  short_urls: defineTable({
    code: v.string(), // Code court unique
    originalUrl: v.string(),
    leadId: v.id("leads"),
    messageId: v.id("messages"),
    clickCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_leadId", ["leadId"])
    .index("by_messageId", ["messageId"]),

  // ═══════════════════════════════════════════
  // TABLE BLACKLIST — Prospects désinscrits (RGPD)
  // ═══════════════════════════════════════════
  blacklist: defineTable({
    email: v.string(),
    reason: v.union(
      v.literal("unsubscribe"),
      v.literal("manual_removal"),
      v.literal("gdpr_request"),
    ),
    addedAt: v.number(),
  }).index("by_email", ["email"]),

  // ═══════════════════════════════════════════
  // TABLE TESTIMONIALS — Témoignages clients
  // ═══════════════════════════════════════════
  testimonials: defineTable({
    leadId: v.id("leads"),
    productId: v.string(), // Slug du produit (référence dynamique vers products.slug)
    content: v.string(),
    authorName: v.optional(v.string()),
    isValidated: v.boolean(),
    validatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_leadId", ["leadId"])
    .index("by_productId", ["productId"])
    .index("by_isValidated", ["isValidated"])
    .index("by_productId_isValidated", ["productId", "isValidated"]),

  // ═══════════════════════════════════════════
  // TABLE NOTIFICATIONS — Historique des notifications
  // ═══════════════════════════════════════════
  notifications: defineTable({
    type: v.union(
      v.literal("critical_lead"),
      v.literal("hot_reply"),
      v.literal("idle_hot_lead"),
      v.literal("churn_signal"),
      v.literal("pending_validation"),
      v.literal("weekly_report"),
    ),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("info"),
    ),
    title: v.string(),
    body: v.string(),
    leadId: v.optional(v.id("leads")),
    messageId: v.optional(v.id("messages")),
    isRead: v.boolean(),
    sentViaNovu: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_leadId", ["leadId"])
    .index("by_type", ["type"])
    .index("by_isRead", ["isRead"])
    .index("by_priority", ["priority"])
    .index("by_createdAt", ["createdAt"]),

  // ═══════════════════════════════════════════
  // TABLE AGENT_LOGS — Journalisation des agents
  // ═══════════════════════════════════════════
  agent_logs: defineTable({
    agentType: v.union(
      v.literal("radar"),
      v.literal("qualifier"),
      v.literal("copywriter"),
      v.literal("objector"),
      v.literal("timing"),
      v.literal("analyst"),
      v.literal("channel_router"),
      v.literal("sequence_engine"),
      v.literal("churn_detector"),
      v.literal("upsell_engine"),
    ),
    level: v.union(
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
    ),
    message: v.string(),
    leadId: v.optional(v.id("leads")),
    messageId: v.optional(v.id("messages")),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_agentType", ["agentType"])
    .index("by_level", ["level"])
    .index("by_agentType_level", ["agentType", "level"])
    .index("by_timestamp", ["timestamp"]),

  // ═══════════════════════════════════════════
  // TABLE WEBHOOK_EVENTS — Événements webhook entrants
  // ═══════════════════════════════════════════
  webhook_events: defineTable({
    source: v.string(), // Ex: "stripe", "piksend", "gatectr", "resend", ou tout nouveau produit
    eventType: v.string(),
    payload: v.any(),
    processed: v.boolean(),
    processedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_source", ["source"])
    .index("by_processed", ["processed"])
    .index("by_receivedAt", ["receivedAt"]),
});

