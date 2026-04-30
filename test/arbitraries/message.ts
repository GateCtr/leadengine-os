import fc from "fast-check";

/**
 * Arbitrary for valid message validation statuses matching the Convex schema union.
 */
export const arbitraryValidationStatus = fc.constantFrom(
  "draft" as const,
  "pending_validation" as const,
  "approved" as const,
  "rejected" as const,
  "sent" as const,
);

/**
 * Arbitrary for valid message channels matching the Convex schema union.
 */
export const arbitraryChannel = fc.constantFrom(
  "email" as const,
  "twitter" as const,
  "linkedin" as const,
  "reddit" as const,
  "instagram" as const,
);

/**
 * Arbitrary for valid message tones matching the Convex schema union.
 */
export const arbitraryTone = fc.constantFrom(
  "expert" as const,
  "support" as const,
  "tech" as const,
);

/**
 * Arbitrary for valid reply categories matching the Convex schema union.
 */
export const arbitraryReplyCategory = fc.constantFrom(
  "trop_cher" as const,
  "besoin_reflexion" as const,
  "question_technique" as const,
  "interet_confirme" as const,
  "refus" as const,
);

/**
 * Arbitrary for a complete message document matching the Convex schema.
 * Uses a placeholder string for leadId since actual Convex IDs require a running DB.
 * Does not include _id or _creationTime (Convex system fields).
 */
export const arbitraryMessage = fc.record({
  // leadId is a Convex Id<"leads"> — use a placeholder for pure logic tests
  leadId: fc.constant("leads_placeholder" as unknown),

  // Content
  suggestedReply: fc.option(fc.string({ minLength: 10, maxLength: 500 }), {
    nil: undefined,
  }),
  suggestedReplyB: fc.option(fc.string({ minLength: 10, maxLength: 500 }), {
    nil: undefined,
  }),
  activeVersion: fc.option(
    fc.constantFrom("A" as const, "B" as const),
    { nil: undefined },
  ),
  finalContent: fc.option(fc.string({ minLength: 10, maxLength: 500 }), {
    nil: undefined,
  }),
  subject: fc.option(fc.string({ minLength: 1, maxLength: 100 }), {
    nil: undefined,
  }),

  // Tone and context
  tone: fc.option(arbitraryTone, { nil: undefined }),
  socialProofUsed: fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
    nil: undefined,
  }),
  contextualLink: fc.option(fc.webUrl(), { nil: undefined }),

  // Channel and routing
  channel: fc.option(arbitraryChannel, { nil: undefined }),
  brandIdentity: fc.option(
    fc.record({
      sender: fc
        .constantFrom("piksend", "gatectr", "joventy", "ryansabowa")
        .map((slug) => `hello@${slug}.com`),
      replyTo: fc
        .constantFrom("piksend", "gatectr", "joventy", "ryansabowa")
        .map((slug) => `support@${slug}.com`),
      templateId: fc
        .constantFrom("piksend", "gatectr", "joventy", "ryan-sabowa")
        .map((slug) => `${slug}-outreach`),
    }),
    { nil: undefined },
  ),
  socialDirectLink: fc.option(fc.webUrl(), { nil: undefined }),

  // Timing
  sendAtSuggested: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),
  sentAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),

  // HITL validation
  validationStatus: arbitraryValidationStatus,
  validatedBy: fc.option(fc.uuid(), { nil: undefined }),
  validatedAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),

  // Sequence
  sequenceId: fc.option(fc.constant("sequences_placeholder" as unknown), {
    nil: undefined,
  }),
  sequenceStep: fc.option(fc.integer({ min: 0, max: 5 }), {
    nil: undefined,
  }),

  // Reply
  replyContent: fc.option(fc.string({ minLength: 1, maxLength: 500 }), {
    nil: undefined,
  }),
  replyCategory: fc.option(arbitraryReplyCategory, { nil: undefined }),
  replyReceivedAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),

  // Tracking
  resendMessageId: fc.option(fc.uuid(), { nil: undefined }),
  opened: fc.option(fc.boolean(), { nil: undefined }),
  openedAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),
  clicked: fc.option(fc.boolean(), { nil: undefined }),
  clickedAt: fc.option(
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
    { nil: undefined },
  ),

  // Metadata
  createdAt: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
  updatedAt: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
});
