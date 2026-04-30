import fc from "fast-check";

/**
 * Arbitrary for valid lead statuses matching the Convex schema union.
 */
export const arbitraryLeadStatus = fc.constantFrom(
  "pending_qualification" as const,
  "qualified" as const,
  "discarded" as const,
  "hot" as const,
  "pending" as const,
  "converted" as const,
  "archived" as const,
  "churned" as const,
);

/**
 * Arbitrary for scoring breakdown respecting per-component bounds:
 * - urgency: 0–30
 * - webhookSource: 0–25
 * - productMatch: 0–20
 * - activeProfile: 0–15
 * - contextSignals: 0–10
 */
export const arbitraryScoringBreakdown = fc.record({
  urgency: fc.integer({ min: 0, max: 30 }),
  webhookSource: fc.integer({ min: 0, max: 25 }),
  productMatch: fc.integer({ min: 0, max: 20 }),
  activeProfile: fc.integer({ min: 0, max: 15 }),
  contextSignals: fc.integer({ min: 0, max: 10 }),
});

/**
 * Arbitrary for webhook payloads matching the expected inbound format:
 * product_id, event_type, event_context, user_email, timestamp
 */
export const arbitraryWebhookPayload = fc.record({
  product_id: fc.constantFrom("piksend", "gatectr", "joventy", "ryan_sabowa"),
  event_type: fc.stringMatching(/^[a-z][a-z0-9_.]{2,30}$/),
  event_context: fc.string({ minLength: 1, maxLength: 200 }),
  user_email: fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
      fc.constantFrom("com", "io", "dev", "fr", "net"),
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`),
  timestamp: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
});

/**
 * Arbitrary for a complete lead document matching the Convex schema.
 * Does not include _id or _creationTime (Convex system fields).
 */
export const arbitraryLead = fc.record({
  // Identity
  email: fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
      fc.constantFrom("com", "io", "dev", "fr", "net"),
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`),
  externalId: fc.option(fc.uuid(), { nil: undefined }),
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
    nil: undefined,
  }),

  // Source
  source: fc.constantFrom(
    "radar",
    "webhook_piksend",
    "webhook_gatectr",
    "webhook_joventy",
    "webhook_ryan_sabowa",
  ),
  sourceUrl: fc.option(fc.webUrl(), { nil: undefined }),
  detectedAt: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
  detectionChannel: fc.constantFrom(
    "web",
    "email",
    "twitter",
    "linkedin",
    "reddit",
    "instagram",
  ),

  // Qualification
  status: arbitraryLeadStatus,
  score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  scoringBreakdown: fc.option(arbitraryScoringBreakdown, { nil: undefined }),
  productId: fc.option(
    fc.constantFrom("piksend", "gatectr", "joventy", "ryan_sabowa"),
    { nil: undefined },
  ),
  scoringReasoning: fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
    nil: undefined,
  }),

  // Enrichment
  enrichmentData: fc.option(
    fc.record({
      linkedinUrl: fc.option(fc.webUrl(), { nil: undefined }),
      githubUrl: fc.option(fc.webUrl(), { nil: undefined }),
      websiteUrl: fc.option(fc.webUrl(), { nil: undefined }),
      bio: fc.option(fc.string({ minLength: 1, maxLength: 300 }), {
        nil: undefined,
      }),
      skills: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
          minLength: 0,
          maxLength: 10,
        }),
        { nil: undefined },
      ),
      company: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
        nil: undefined,
      }),
      role: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
        nil: undefined,
      }),
      scrapedAt: fc.option(
        fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),

  // Webhook product (hot leads)
  webhookEventType: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
    nil: undefined,
  }),
  webhookEventContext: fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
    nil: undefined,
  }),
  webhookUserId: fc.option(fc.uuid(), { nil: undefined }),

  // Conversion
  revenueGenerated: fc.option(fc.integer({ min: 0, max: 100_000 }), {
    nil: undefined,
  }),
  stripeCustomerId: fc.option(
    fc.stringMatching(/^cus_[A-Za-z0-9]{14}$/),
    { nil: undefined },
  ),
  convertedAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),

  // Churn
  churnRiskScore: fc.option(fc.integer({ min: 0, max: 100 }), {
    nil: undefined,
  }),
  lastActivityAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),

  // Compliance
  consentSource: fc.constantFrom(
    "radar_detection",
    "webhook_signup",
    "manual_import",
    "form_submission",
  ),
  consentDate: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),

  // Metadata
  updatedAt: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
});
