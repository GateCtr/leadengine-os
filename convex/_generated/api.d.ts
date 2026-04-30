/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_analyst from "../agents/analyst.js";
import type * as agents_analystHelpers from "../agents/analystHelpers.js";
import type * as agents_copywriter from "../agents/copywriter.js";
import type * as agents_copywriterHelpers from "../agents/copywriterHelpers.js";
import type * as agents_objector from "../agents/objector.js";
import type * as agents_objectorHelpers from "../agents/objectorHelpers.js";
import type * as agents_qualifier from "../agents/qualifier.js";
import type * as agents_qualifierHelpers from "../agents/qualifierHelpers.js";
import type * as agents_radar from "../agents/radar.js";
import type * as agents_timing from "../agents/timing.js";
import type * as compliance_blacklist from "../compliance/blacklist.js";
import type * as compliance_cleanup from "../compliance/cleanup.js";
import type * as compliance_cleanupHelpers from "../compliance/cleanupHelpers.js";
import type * as compliance_deleteProspect from "../compliance/deleteProspect.js";
import type * as crons from "../crons.js";
import type * as engine_churnDetector from "../engine/churnDetector.js";
import type * as engine_churnDetectorHelpers from "../engine/churnDetectorHelpers.js";
import type * as engine_sequenceEngine from "../engine/sequenceEngine.js";
import type * as engine_sequenceHelpers from "../engine/sequenceHelpers.js";
import type * as engine_upsellEngine from "../engine/upsellEngine.js";
import type * as engine_upsellEngineHelpers from "../engine/upsellEngineHelpers.js";
import type * as enrichment from "../enrichment.js";
import type * as http from "../http.js";
import type * as integrations_firecrawl from "../integrations/firecrawl.js";
import type * as integrations_novu from "../integrations/novu.js";
import type * as integrations_resend from "../integrations/resend.js";
import type * as integrations_serper from "../integrations/serper.js";
import type * as logs from "../logs.js";
import type * as notifications_triggerHelpers from "../notifications/triggerHelpers.js";
import type * as notifications_triggers from "../notifications/triggers.js";
import type * as router_analyticsQueries from "../router/analyticsQueries.js";
import type * as router_channelRouter from "../router/channelRouter.js";
import type * as router_leadQueries from "../router/leadQueries.js";
import type * as router_queueMutations from "../router/queueMutations.js";
import type * as router_queueQueries from "../router/queueQueries.js";
import type * as router_sendMessage from "../router/sendMessage.js";
import type * as router_sendMessageHelpers from "../router/sendMessageHelpers.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as shared_copywriterUtils from "../shared/copywriterUtils.js";
import type * as stripeWebhook from "../stripeWebhook.js";
import type * as stripeWebhookHelpers from "../stripeWebhookHelpers.js";
import type * as testimonials from "../testimonials.js";
import type * as tracking_redirect from "../tracking/redirect.js";
import type * as tracking_shortUrls from "../tracking/shortUrls.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/analyst": typeof agents_analyst;
  "agents/analystHelpers": typeof agents_analystHelpers;
  "agents/copywriter": typeof agents_copywriter;
  "agents/copywriterHelpers": typeof agents_copywriterHelpers;
  "agents/objector": typeof agents_objector;
  "agents/objectorHelpers": typeof agents_objectorHelpers;
  "agents/qualifier": typeof agents_qualifier;
  "agents/qualifierHelpers": typeof agents_qualifierHelpers;
  "agents/radar": typeof agents_radar;
  "agents/timing": typeof agents_timing;
  "compliance/blacklist": typeof compliance_blacklist;
  "compliance/cleanup": typeof compliance_cleanup;
  "compliance/cleanupHelpers": typeof compliance_cleanupHelpers;
  "compliance/deleteProspect": typeof compliance_deleteProspect;
  crons: typeof crons;
  "engine/churnDetector": typeof engine_churnDetector;
  "engine/churnDetectorHelpers": typeof engine_churnDetectorHelpers;
  "engine/sequenceEngine": typeof engine_sequenceEngine;
  "engine/sequenceHelpers": typeof engine_sequenceHelpers;
  "engine/upsellEngine": typeof engine_upsellEngine;
  "engine/upsellEngineHelpers": typeof engine_upsellEngineHelpers;
  enrichment: typeof enrichment;
  http: typeof http;
  "integrations/firecrawl": typeof integrations_firecrawl;
  "integrations/novu": typeof integrations_novu;
  "integrations/resend": typeof integrations_resend;
  "integrations/serper": typeof integrations_serper;
  logs: typeof logs;
  "notifications/triggerHelpers": typeof notifications_triggerHelpers;
  "notifications/triggers": typeof notifications_triggers;
  "router/analyticsQueries": typeof router_analyticsQueries;
  "router/channelRouter": typeof router_channelRouter;
  "router/leadQueries": typeof router_leadQueries;
  "router/queueMutations": typeof router_queueMutations;
  "router/queueQueries": typeof router_queueQueries;
  "router/sendMessage": typeof router_sendMessage;
  "router/sendMessageHelpers": typeof router_sendMessageHelpers;
  seed: typeof seed;
  settings: typeof settings;
  "shared/copywriterUtils": typeof shared_copywriterUtils;
  stripeWebhook: typeof stripeWebhook;
  stripeWebhookHelpers: typeof stripeWebhookHelpers;
  testimonials: typeof testimonials;
  "tracking/redirect": typeof tracking_redirect;
  "tracking/shortUrls": typeof tracking_shortUrls;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
