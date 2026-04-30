import { v } from "convex/values";
import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

/**
 * Alphabet for generating short codes.
 * Uses URL-safe characters, excluding ambiguous ones (0/O, 1/l/I).
 */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

/**
 * Generates a random short code of the given length using the safe alphabet.
 * Uses Math.random — sufficient for non-cryptographic short URL codes.
 */
function generateShortCode(length: number = CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Internal mutation to create a tracked short URL.
 *
 * Generates a unique short code, stores the mapping in the `short_urls` table,
 * and returns the short code. The caller is responsible for constructing the
 * full redirect URL (e.g. https://domain.com/t/{code}).
 *
 * Retries up to 5 times if a code collision occurs (extremely unlikely with
 * 8-char codes from a 55-char alphabet = ~55^8 ≈ 837 billion combinations).
 *
 * Requirements: 18.1
 */
export const createTrackedUrl = internalMutation({
  args: {
    originalUrl: v.string(),
    leadId: v.id("leads"),
    messageId: v.id("messages"),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return insertTrackedUrl(ctx, args);
  },
});

/**
 * Helper to insert a tracked short URL record and return the code.
 * Shared by both createTrackedUrl and replaceUrlsWithTracked to avoid
 * calling ctx.runMutation on the same file (Convex circularity).
 */
async function insertTrackedUrl(
  ctx: MutationCtx,
  args: { originalUrl: string; leadId: Id<"leads">; messageId: Id<"messages"> },
): Promise<string> {
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateShortCode();

    const existing = await ctx.db
      .query("short_urls")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();

    if (!existing) {
      await ctx.db.insert("short_urls", {
        code,
        originalUrl: args.originalUrl,
        leadId: args.leadId,
        messageId: args.messageId,
        clickCount: 0,
        createdAt: Date.now(),
      });
      return code;
    }
  }

  const fallbackCode = generateShortCode(6) + Date.now().toString(36).slice(-2);
  await ctx.db.insert("short_urls", {
    code: fallbackCode,
    originalUrl: args.originalUrl,
    leadId: args.leadId,
    messageId: args.messageId,
    clickCount: 0,
    createdAt: Date.now(),
  });
  return fallbackCode;
}

/**
 * Internal mutation to replace all URLs in a message body with tracked short URLs.
 *
 * Scans the message content for http/https URLs, creates a tracked short URL
 * for each one, and returns the rewritten content with short URLs substituted.
 *
 * Requirements: 18.1
 */
export const replaceUrlsWithTracked = internalMutation({
  args: {
    content: v.string(),
    leadId: v.id("leads"),
    messageId: v.id("messages"),
    baseUrl: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Match http/https URLs in the content
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    const urls = args.content.match(urlRegex);

    if (!urls || urls.length === 0) {
      return args.content;
    }

    // Deduplicate URLs to avoid creating multiple short codes for the same URL
    const uniqueUrls = [...new Set(urls)];
    const urlMap = new Map<string, string>();

    for (const originalUrl of uniqueUrls) {
      const code = await insertTrackedUrl(ctx, {
        originalUrl,
        leadId: args.leadId,
        messageId: args.messageId,
      });
      urlMap.set(originalUrl, `${args.baseUrl}/t/${code}`);
    }

    // Replace all occurrences of each URL with its tracked version
    let rewrittenContent = args.content;
    for (const [original, tracked] of urlMap) {
      // Use split+join for global replacement (avoids regex special char issues)
      rewrittenContent = rewrittenContent.split(original).join(tracked);
    }

    return rewrittenContent;
  },
});

/**
 * Internal query to resolve a short code to its original URL and associated IDs.
 *
 * Returns null if the code does not exist.
 *
 * Requirements: 18.2
 */
export const resolveShortUrl = internalQuery({
  args: {
    code: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("short_urls"),
      originalUrl: v.string(),
      leadId: v.id("leads"),
      messageId: v.id("messages"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const shortUrl = await ctx.db
      .query("short_urls")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (!shortUrl) {
      return null;
    }

    return {
      _id: shortUrl._id,
      originalUrl: shortUrl.originalUrl,
      leadId: shortUrl.leadId,
      messageId: shortUrl.messageId,
    };
  },
});

/**
 * Internal mutation to record a click on a short URL.
 *
 * Increments the clickCount on the short_urls record and creates a
 * tracking_event of type "click".
 *
 * Requirements: 18.2
 */
export const recordClick = internalMutation({
  args: {
    shortUrlId: v.id("short_urls"),
    leadId: v.id("leads"),
    messageId: v.id("messages"),
    originalUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Increment click count on the short URL record
    const shortUrl = await ctx.db.get(args.shortUrlId);
    if (shortUrl) {
      await ctx.db.patch(args.shortUrlId, {
        clickCount: shortUrl.clickCount + 1,
      });
    }

    // Create a tracking event
    await ctx.db.insert("tracking_events", {
      leadId: args.leadId,
      messageId: args.messageId,
      type: "click",
      url: args.originalUrl,
      timestamp: now,
    });

    // Update the message's clicked status
    const message = await ctx.db.get(args.messageId);
    if (message && !message.clicked) {
      await ctx.db.patch(args.messageId, {
        clicked: true,
        clickedAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});
