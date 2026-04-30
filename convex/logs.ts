import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Agent log levels supported by the system.
 */
export const logLevelValidator = v.union(
  v.literal("info"),
  v.literal("warn"),
  v.literal("error"),
);

/**
 * All agent types that can produce logs.
 * Matches the agent_logs.agentType union in schema.ts.
 */
export const agentTypeValidator = v.union(
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
);

/**
 * Internal mutation to insert a log entry into the `agent_logs` table.
 *
 * Used by all agents to record info, warnings, and errors.
 * This is an internal function — not exposed to the public API.
 *
 * Requirements: 20.2 (pipeline traceability), 20.3 (error isolation per agent)
 */
export const createLog = internalMutation({
  args: {
    agentType: agentTypeValidator,
    level: logLevelValidator,
    message: v.string(),
    leadId: v.optional(v.id("leads")),
    messageId: v.optional(v.id("messages")),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agent_logs"),
  handler: async (ctx, args) => {
    const logId = await ctx.db.insert("agent_logs", {
      agentType: args.agentType,
      level: args.level,
      message: args.message,
      leadId: args.leadId,
      messageId: args.messageId,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
    return logId;
  },
});
