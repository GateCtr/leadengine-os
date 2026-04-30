import fc from "fast-check";

/**
 * Arbitrary for valid product slugs matching the 4 products in the system.
 */
export const arbitraryProductId = fc.constantFrom(
  "piksend" as const,
  "gatectr" as const,
  "joventy" as const,
  "ryan_sabowa" as const,
);

/**
 * Arbitrary for a complete product document matching the Convex schema.
 * Does not include _id or _creationTime (Convex system fields).
 */
export const arbitraryProduct = fc.record({
  slug: arbitraryProductId,
  name: fc.constantFrom("Piksend", "GateCtr", "Joventy", "Ryan Sabowa"),
  senderEmail: fc
    .constantFrom("piksend", "gatectr", "joventy", "ryansabowa")
    .map((slug) => `hello@${slug}.com`),
  replyToEmail: fc
    .constantFrom("piksend", "gatectr", "joventy", "ryansabowa")
    .map((slug) => `support@${slug}.com`),
  templateId: fc
    .constantFrom("piksend", "gatectr", "joventy", "ryan-sabowa")
    .map((slug) => `${slug}-outreach`),
  brandColor: fc.constantFrom("#FF6B35", "#2563EB", "#10B981", "#8B5CF6"),
  logoUrl: fc
    .constantFrom("piksend", "gatectr", "joventy", "ryansabowa")
    .map((slug) => `https://cdn.leadengine.io/logos/${slug}.svg`),
  landingPageBaseUrl: fc
    .constantFrom("piksend", "gatectr", "joventy", "ryansabowa")
    .map((slug) => `https://${slug}.com/lp`),
  uspDescription: fc.option(fc.string({ minLength: 10, maxLength: 200 }), {
    nil: undefined,
  }),
  isActive: fc.boolean(),
  createdAt: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
  updatedAt: fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
});
