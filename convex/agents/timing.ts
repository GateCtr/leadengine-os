import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Agent Timing — Optimisation Horaire
 *
 * Suggests the optimal send time for a message based on the prospect's
 * timezone and B2B statistical best practices (Tuesday–Thursday, 9–11 AM).
 *
 * This is an internalMutation (not an action) because it only performs
 * pure timezone/time calculations and DB reads/writes — no external API
 * calls or LLM needed.
 *
 * Trigger: Message routed (has a channel) without `sendAtSuggested`.
 *
 * Requirements: 8.1, 8.2, 8.4
 */

// ─── Optimal B2B send windows ────────────────────────────────────────────────

/**
 * Preferred days for B2B outreach (Tuesday=2, Wednesday=3, Thursday=4).
 * Based on email marketing statistics showing highest open/reply rates.
 */
const OPTIMAL_DAYS = [2, 3, 4] as const;

/**
 * Optimal send window in the prospect's local time (24h format).
 * 9:00–11:00 AM is the statistical sweet spot for B2B emails.
 */
const OPTIMAL_HOUR_START = 9;
const OPTIMAL_HOUR_END = 11;

/**
 * Default timezone when we can't determine the prospect's location.
 */
const DEFAULT_TIMEZONE = "Europe/Paris";

// ─── Timezone detection ──────────────────────────────────────────────────────

/**
 * Mapping of common company location keywords to IANA timezones.
 * Used to infer timezone from enrichment data (company, bio, role).
 */
const LOCATION_TIMEZONE_MAP: Array<{ pattern: RegExp; timezone: string }> = [
  // North America
  { pattern: /\b(new york|nyc|boston|miami|atlanta|washington|dc|philadelphia|east coast)\b/i, timezone: "America/New_York" },
  { pattern: /\b(chicago|dallas|houston|austin|denver|minneapolis|central)\b/i, timezone: "America/Chicago" },
  { pattern: /\b(los angeles|la|san francisco|sf|seattle|portland|silicon valley|bay area|west coast|california)\b/i, timezone: "America/Los_Angeles" },
  { pattern: /\b(toronto|montreal|vancouver|canada)\b/i, timezone: "America/Toronto" },
  // Europe
  { pattern: /\b(london|uk|united kingdom|britain|manchester|edinburgh)\b/i, timezone: "Europe/London" },
  { pattern: /\b(paris|france|lyon|marseille)\b/i, timezone: "Europe/Paris" },
  { pattern: /\b(berlin|germany|munich|hamburg|frankfurt)\b/i, timezone: "Europe/Berlin" },
  { pattern: /\b(amsterdam|netherlands|rotterdam)\b/i, timezone: "Europe/Amsterdam" },
  { pattern: /\b(madrid|spain|barcelona)\b/i, timezone: "Europe/Madrid" },
  { pattern: /\b(rome|italy|milan)\b/i, timezone: "Europe/Rome" },
  { pattern: /\b(lisbon|portugal)\b/i, timezone: "Europe/Lisbon" },
  { pattern: /\b(stockholm|sweden)\b/i, timezone: "Europe/Stockholm" },
  { pattern: /\b(zurich|switzerland|geneva)\b/i, timezone: "Europe/Zurich" },
  // Asia-Pacific
  { pattern: /\b(tokyo|japan)\b/i, timezone: "Asia/Tokyo" },
  { pattern: /\b(singapore)\b/i, timezone: "Asia/Singapore" },
  { pattern: /\b(sydney|melbourne|australia)\b/i, timezone: "Australia/Sydney" },
  { pattern: /\b(mumbai|bangalore|india|delhi|hyderabad)\b/i, timezone: "Asia/Kolkata" },
  { pattern: /\b(dubai|uae)\b/i, timezone: "Asia/Dubai" },
  { pattern: /\b(tel aviv|israel)\b/i, timezone: "Asia/Jerusalem" },
  // South America
  { pattern: /\b(sao paulo|brazil|rio)\b/i, timezone: "America/Sao_Paulo" },
  { pattern: /\b(buenos aires|argentina)\b/i, timezone: "America/Argentina/Buenos_Aires" },
];

/**
 * Detect the prospect's timezone from lead enrichment data.
 *
 * Strategy:
 * 1. Check company name/location for geographic hints
 * 2. Check bio for location mentions
 * 3. Check LinkedIn URL for country hints
 * 4. Default to Europe/Paris
 */
export function detectTimezone(
  enrichmentData?: {
    company?: string;
    bio?: string;
    role?: string;
    linkedinUrl?: string;
    websiteUrl?: string;
  } | null,
): string {
  if (!enrichmentData) {
    return DEFAULT_TIMEZONE;
  }

  // Build a searchable text from all available enrichment fields
  const searchText = [
    enrichmentData.company,
    enrichmentData.bio,
    enrichmentData.role,
    enrichmentData.linkedinUrl,
    enrichmentData.websiteUrl,
  ]
    .filter(Boolean)
    .join(" ");

  if (!searchText) {
    return DEFAULT_TIMEZONE;
  }

  for (const { pattern, timezone } of LOCATION_TIMEZONE_MAP) {
    if (pattern.test(searchText)) {
      return timezone;
    }
  }

  return DEFAULT_TIMEZONE;
}

// ─── Optimal send time calculation ───────────────────────────────────────────

/**
 * Calculate the next optimal B2B send time for a given timezone.
 *
 * Algorithm:
 * 1. Get the current time in the prospect's timezone
 * 2. Find the next Tuesday–Thursday window at 9–11 AM local time
 * 3. If we're currently in an optimal window, suggest a time within it
 * 4. Otherwise, advance to the next optimal day/time
 *
 * The function returns a UTC timestamp (number) suitable for `sendAtSuggested`.
 *
 * @param nowMs - Current time in milliseconds (UTC). Defaults to Date.now().
 * @param timezone - IANA timezone string for the prospect.
 * @returns UTC timestamp (ms) of the suggested send time.
 */
export function calculateOptimalSendTime(
  nowMs: number,
  timezone: string,
): number {
  // Format the current time in the prospect's timezone to extract local components
  const localParts = getLocalTimeParts(nowMs, timezone);

  const localDay = localParts.dayOfWeek; // 0=Sunday, 6=Saturday
  const localHour = localParts.hour;

  // Check if we're currently in an optimal window
  if (
    isOptimalDay(localDay) &&
    localHour >= OPTIMAL_HOUR_START &&
    localHour < OPTIMAL_HOUR_END
  ) {
    // We're in the window — suggest 30 minutes from now to give time for review
    return nowMs + 30 * 60 * 1000;
  }

  // Find the next optimal day
  let daysToAdd = 0;
  let targetDay = localDay;

  // If we're on an optimal day but past the window, start looking from tomorrow
  if (isOptimalDay(localDay) && localHour >= OPTIMAL_HOUR_END) {
    daysToAdd = 1;
    targetDay = (localDay + 1) % 7;
  }

  // If we're on an optimal day but before the window, use today
  if (isOptimalDay(localDay) && localHour < OPTIMAL_HOUR_START) {
    daysToAdd = 0;
    targetDay = localDay;
  } else {
    // Advance until we find an optimal day
    while (!isOptimalDay(targetDay) || (daysToAdd === 0 && localHour >= OPTIMAL_HOUR_START)) {
      daysToAdd++;
      targetDay = (localDay + daysToAdd) % 7;
      if (isOptimalDay(targetDay)) break;
    }
  }

  // Build the target date: today + daysToAdd, at 9:30 AM local time
  // We use 9:30 as the sweet spot within the 9–11 window
  const targetLocalDate = new Date(nowMs);
  // Adjust to the prospect's local date by working in UTC and offsetting
  const targetTimestamp = buildTargetTimestamp(
    nowMs,
    timezone,
    daysToAdd,
    9,
    30,
  );

  return targetTimestamp;
}

/**
 * Check if a day of the week is an optimal B2B send day.
 * @param day - Day of week (0=Sunday, 6=Saturday)
 */
export function isOptimalDay(day: number): boolean {
  return (OPTIMAL_DAYS as readonly number[]).includes(day);
}

/**
 * Extract local time components for a given UTC timestamp and timezone.
 */
export function getLocalTimeParts(
  utcMs: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  const date = new Date(utcMs);

  // Use Intl.DateTimeFormat to get local time parts
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const weekdayStr = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
  };
}

/**
 * Build a UTC timestamp for a target local time in a given timezone.
 *
 * @param nowMs - Current UTC time in ms
 * @param timezone - IANA timezone
 * @param daysToAdd - Number of days to add from today
 * @param targetHour - Target hour in local time (24h)
 * @param targetMinute - Target minute in local time
 * @returns UTC timestamp in ms
 */
export function buildTargetTimestamp(
  nowMs: number,
  timezone: string,
  daysToAdd: number,
  targetHour: number,
  targetMinute: number,
): number {
  // Get the current local date parts
  const local = getLocalTimeParts(nowMs, timezone);

  // Build a date string for the target local time
  const targetMonth = String(local.month).padStart(2, "0");
  const targetDay = String(local.day).padStart(2, "0");
  const targetDateStr = `${local.year}-${targetMonth}-${targetDay}T${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}:00`;

  // Parse as UTC first, then adjust for timezone offset
  const naiveUtc = new Date(targetDateStr + "Z").getTime();

  // Calculate the timezone offset by comparing local and UTC representations
  const offsetMs = getTimezoneOffsetMs(nowMs, timezone);

  // The target UTC time = local time - offset
  let targetUtc = naiveUtc - offsetMs + daysToAdd * 24 * 60 * 60 * 1000;

  return targetUtc;
}

/**
 * Get the timezone offset in milliseconds (local - UTC) for a given timezone.
 * Positive means local is ahead of UTC (e.g., +1h for Europe/Paris in winter).
 */
export function getTimezoneOffsetMs(utcMs: number, timezone: string): number {
  const local = getLocalTimeParts(utcMs, timezone);
  const utcDate = new Date(utcMs);

  // Build a comparable date from local parts
  const localDateStr = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}T${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:00Z`;
  const localAsUtc = new Date(localDateStr).getTime();

  // Offset = localAsUtc - utcMs (rounded to nearest minute)
  const rawOffset = localAsUtc - utcMs;
  return Math.round(rawOffset / 60000) * 60000;
}

// ─── Main Mutation: Suggest Send Time ────────────────────────────────────────

/**
 * Suggest the optimal send time for a message.
 *
 * Pipeline:
 * 1. Read the message — verify it exists and has no sendAtSuggested yet
 * 2. Read the associated lead for enrichment data
 * 3. Detect the prospect's timezone from enrichment data
 * 4. Calculate the next optimal B2B send window
 * 5. Update the message's sendAtSuggested field
 * 6. Update validationStatus to pending_validation (message is ready for Dashboard)
 *
 * The operator can always override and send immediately — this is a suggestion only.
 *
 * Requirements: 8.1, 8.2, 8.4
 */
export const suggestSendTime = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const now = Date.now();

    // 1. Read the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      await ctx.db.insert("agent_logs", {
        agentType: "timing",
        level: "warn",
        message: `Timing skipped: message ${messageId} not found.`,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // Skip if already has a suggested send time
    if (message.sendAtSuggested) {
      await ctx.db.insert("agent_logs", {
        agentType: "timing",
        level: "info",
        message: `Timing skipped: message ${messageId} already has sendAtSuggested.`,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // 2. Read the associated lead
    const lead = await ctx.db.get(message.leadId);
    if (!lead) {
      await ctx.db.insert("agent_logs", {
        agentType: "timing",
        level: "error",
        message: `Timing failed: lead ${message.leadId} not found for message ${messageId}.`,
        messageId,
        timestamp: now,
      });
      return null;
    }

    // 3. Detect the prospect's timezone from enrichment data
    const timezone = detectTimezone(lead.enrichmentData ?? null);

    // 4. Calculate the next optimal B2B send window
    const suggestedTime = calculateOptimalSendTime(now, timezone);

    // 5. Update the message with the suggested send time
    // 6. Update validationStatus to pending_validation (ready for Dashboard)
    await ctx.db.patch(messageId, {
      sendAtSuggested: suggestedTime,
      validationStatus: "pending_validation",
      updatedAt: now,
    });

    await ctx.db.insert("agent_logs", {
      agentType: "timing",
      level: "info",
      message: `Send time suggested for message ${messageId}: ${new Date(suggestedTime).toISOString()} (timezone: ${timezone}).`,
      leadId: lead._id,
      messageId,
      metadata: {
        timezone,
        suggestedTime,
        suggestedTimeISO: new Date(suggestedTime).toISOString(),
      },
      timestamp: now,
    });

    return null;
  },
});
