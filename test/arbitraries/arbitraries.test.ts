import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  arbitraryLead,
  arbitraryLeadStatus,
  arbitraryScoringBreakdown,
  arbitraryWebhookPayload,
} from "./lead";
import { arbitraryProduct, arbitraryProductId } from "./product";
import {
  arbitraryMessage,
  arbitraryValidationStatus,
  arbitraryChannel,
  arbitraryTone,
  arbitraryReplyCategory,
} from "./message";

const VALID_LEAD_STATUSES = [
  "pending_qualification",
  "qualified",
  "discarded",
  "hot",
  "pending",
  "converted",
  "archived",
  "churned",
] as const;

const VALID_PRODUCT_SLUGS = [
  "piksend",
  "gatectr",
  "joventy",
  "ryan_sabowa",
] as const;

const VALID_VALIDATION_STATUSES = [
  "draft",
  "pending_validation",
  "approved",
  "rejected",
  "sent",
] as const;

const VALID_CHANNELS = [
  "email",
  "twitter",
  "linkedin",
  "reddit",
  "instagram",
] as const;

const VALID_TONES = ["expert", "support", "tech"] as const;

describe("Lead arbitraries", () => {
  it("arbitraryLeadStatus generates only valid statuses", () => {
    fc.assert(
      fc.property(arbitraryLeadStatus, (status) => {
        expect(VALID_LEAD_STATUSES).toContain(status);
      }),
      { numRuns: 100 },
    );
  });

  it("arbitraryScoringBreakdown respects component bounds", () => {
    fc.assert(
      fc.property(arbitraryScoringBreakdown, (breakdown) => {
        expect(breakdown.urgency).toBeGreaterThanOrEqual(0);
        expect(breakdown.urgency).toBeLessThanOrEqual(30);
        expect(breakdown.webhookSource).toBeGreaterThanOrEqual(0);
        expect(breakdown.webhookSource).toBeLessThanOrEqual(25);
        expect(breakdown.productMatch).toBeGreaterThanOrEqual(0);
        expect(breakdown.productMatch).toBeLessThanOrEqual(20);
        expect(breakdown.activeProfile).toBeGreaterThanOrEqual(0);
        expect(breakdown.activeProfile).toBeLessThanOrEqual(15);
        expect(breakdown.contextSignals).toBeGreaterThanOrEqual(0);
        expect(breakdown.contextSignals).toBeLessThanOrEqual(10);
      }),
      { numRuns: 200 },
    );
  });

  it("arbitraryScoringBreakdown total score is between 0 and 100", () => {
    fc.assert(
      fc.property(arbitraryScoringBreakdown, (breakdown) => {
        const total =
          breakdown.urgency +
          breakdown.webhookSource +
          breakdown.productMatch +
          breakdown.activeProfile +
          breakdown.contextSignals;
        expect(total).toBeGreaterThanOrEqual(0);
        expect(total).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it("arbitraryWebhookPayload generates valid payloads", () => {
    fc.assert(
      fc.property(arbitraryWebhookPayload, (payload) => {
        expect(VALID_PRODUCT_SLUGS).toContain(payload.product_id);
        expect(payload.event_type.length).toBeGreaterThan(0);
        expect(payload.event_context.length).toBeGreaterThan(0);
        expect(payload.user_email).toMatch(/.+@.+\..+/);
        expect(payload.timestamp).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("arbitraryLead generates leads with all required fields", () => {
    fc.assert(
      fc.property(arbitraryLead, (lead) => {
        // Required fields must be present
        expect(lead.email).toMatch(/.+@.+\..+/);
        expect(lead.source).toBeDefined();
        expect(lead.detectedAt).toBeGreaterThan(0);
        expect(lead.detectionChannel).toBeDefined();
        expect(VALID_LEAD_STATUSES).toContain(lead.status);
        expect(lead.consentSource).toBeDefined();
        expect(lead.consentDate).toBeGreaterThan(0);
        expect(lead.updatedAt).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Product arbitraries", () => {
  it("arbitraryProductId generates only valid slugs", () => {
    fc.assert(
      fc.property(arbitraryProductId, (slug) => {
        expect(VALID_PRODUCT_SLUGS).toContain(slug);
      }),
      { numRuns: 100 },
    );
  });

  it("arbitraryProduct generates products with all required fields", () => {
    fc.assert(
      fc.property(arbitraryProduct, (product) => {
        expect(VALID_PRODUCT_SLUGS).toContain(product.slug);
        expect(product.name.length).toBeGreaterThan(0);
        expect(product.senderEmail).toMatch(/.+@.+\..+/);
        expect(product.replyToEmail).toMatch(/.+@.+\..+/);
        expect(product.templateId.length).toBeGreaterThan(0);
        expect(product.brandColor).toMatch(/^#[A-Fa-f0-9]{6}$/);
        expect(product.logoUrl).toMatch(/^https:\/\//);
        expect(product.landingPageBaseUrl).toMatch(/^https:\/\//);
        expect(typeof product.isActive).toBe("boolean");
        expect(product.createdAt).toBeGreaterThan(0);
        expect(product.updatedAt).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Message arbitraries", () => {
  it("arbitraryValidationStatus generates only valid statuses", () => {
    fc.assert(
      fc.property(arbitraryValidationStatus, (status) => {
        expect(VALID_VALIDATION_STATUSES).toContain(status);
      }),
      { numRuns: 100 },
    );
  });

  it("arbitraryChannel generates only valid channels", () => {
    fc.assert(
      fc.property(arbitraryChannel, (channel) => {
        expect(VALID_CHANNELS).toContain(channel);
      }),
      { numRuns: 100 },
    );
  });

  it("arbitraryTone generates only valid tones", () => {
    fc.assert(
      fc.property(arbitraryTone, (tone) => {
        expect(VALID_TONES).toContain(tone);
      }),
      { numRuns: 100 },
    );
  });

  it("arbitraryReplyCategory generates only valid categories", () => {
    const validCategories = [
      "trop_cher",
      "besoin_reflexion",
      "question_technique",
      "interet_confirme",
      "refus",
    ];
    fc.assert(
      fc.property(arbitraryReplyCategory, (category) => {
        expect(validCategories).toContain(category);
      }),
      { numRuns: 100 },
    );
  });

  it("arbitraryMessage generates messages with all required fields", () => {
    fc.assert(
      fc.property(arbitraryMessage, (message) => {
        expect(message.leadId).toBeDefined();
        expect(VALID_VALIDATION_STATUSES).toContain(message.validationStatus);
        expect(message.createdAt).toBeGreaterThan(0);
        expect(message.updatedAt).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
