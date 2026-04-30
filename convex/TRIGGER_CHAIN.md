# LeadEngine OS — Trigger Chain Documentation

## Overview

This document maps every reactive trigger in the LeadEngine OS pipeline.
Each state change in the Convex database triggers the next agent in the chain
via `ctx.scheduler.runAfter(0, ...)` calls. Agents communicate exclusively
through the database — no direct inter-agent calls (Requirement 20.1).

## Flux 1 : Lead Froid (Radar → Envoi)

```
Cron (2h) → runRadarScan
  └─ insertRadarLead (convex/agents/radar.ts)
       ├─ Creates lead: status = "pending_qualification"
       └─ scheduler.runAfter → qualifyLead (convex/agents/qualifier.ts)
            ├─ runAction → enrichLead (convex/enrichment.ts) [Firecrawl, fail-safe]
            └─ runMutation → updateLeadQualification (convex/agents/qualifierHelpers.ts)
                 ├─ If score ≥ 40: status = "qualified", productId assigned
                 │    ├─ scheduler.runAfter → composeMessage (convex/agents/copywriter.ts)
                 │    │    └─ runMutation → insertMessage (convex/agents/copywriterHelpers.ts)
                 │    │         └─ scheduler.runAfter → routeMessage (convex/router/channelRouter.ts)
                 │    │              └─ scheduler.runAfter → suggestSendTime (convex/agents/timing.ts)
                 │    │                   └─ Sets validationStatus = "pending_validation"
                 │    │                        └─ [Dashboard real-time subscription picks up]
                 │    └─ If score > 85: scheduler.runAfter → triggerNotification (critical_lead)
                 └─ If score < 40: status = "discarded" [end of pipeline]
```

## Flux 2 : Lead Chaud (Webhook Produit → Envoi)

```
HTTP POST /webhooks/product → httpAction (convex/http.ts)
  └─ createLeadFromWebhook (convex/webhooks.ts)
       ├─ Creates/consolidates lead: status = "qualified", score = 100
       ├─ scheduler.runAfter → enrichLead (convex/enrichment.ts) [Firecrawl, fail-safe]
       ├─ scheduler.runAfter(2s) → composeMessage (convex/agents/copywriter.ts)
       │    └─ [same chain as Flux 1: insertMessage → routeMessage → suggestSendTime → Dashboard]
       └─ scheduler.runAfter → triggerNotification (critical_lead, score 100)
```

## Flux 3 : Validation HITL → Envoi → Séquence

```
Dashboard: approveMessage (convex/router/queueMutations.ts)
  ├─ Sets validationStatus = "approved", validatedBy, validatedAt
  └─ If channel = "email":
       scheduler.runAfter → sendApprovedEmail (convex/router/sendMessage.ts)
            ├─ Blacklist check (fail-safe: blocks send on failure)
            ├─ Sends via Resend API with branded template
            ├─ markMessageSent → validationStatus = "sent", sentAt recorded
            └─ If initial message (no existing sequence):
                 runMutation → createSequence (convex/engine/sequenceHelpers.ts)
                      └─ Creates outreach sequence: J+3, J+7, J+14, J+30
```

## Flux 4 : Séquence de Relance (Cron → Copywriter → Envoi)

```
Cron (6h) → processSequences (convex/engine/sequenceEngine.ts)
  └─ For each active sequence with due step:
       ├─ Check if lead replied → pauseSequence
       ├─ Check J+31 → archiveLeadAndCompleteSequence
       └─ If step due:
            ├─ insertSequenceMessage (placeholder, draft)
            └─ runAction → composeFollowUp (convex/engine/sequenceEngine.ts)
                 └─ runMutation → updateSequenceMessage (convex/engine/sequenceHelpers.ts)
                      └─ scheduler.runAfter → routeMessage (convex/router/channelRouter.ts)
                           └─ [same chain: routeMessage → suggestSendTime → Dashboard]
```

## Flux 5 : Réponse Prospect → Objecteur → Contre-réponse

```
HTTP POST /webhooks/resend/inbound → httpAction (convex/http.ts)
  └─ processInboundReply (convex/webhooks.ts)
       ├─ Finds lead by email, updates message with replyContent
       ├─ scheduler.runAfter → analyzeReply (convex/agents/objector.ts)
       │    ├─ LLM categorization: trop_cher | besoin_reflexion | question_technique | interet_confirme | refus
       │    ├─ updateReplyAnalysis (convex/agents/objectorHelpers.ts)
       │    │    ├─ interet_confirme → lead status "hot"
       │    │    ├─ refus → lead status "archived"
       │    │    └─ objection → lead status "pending"
       │    └─ If objection: LLM generates counter-response
       │         └─ insertCounterResponse (convex/agents/objectorHelpers.ts)
       │              └─ scheduler.runAfter → routeMessage → suggestSendTime → Dashboard
       └─ If reply within 2h of send:
            scheduler.runAfter → triggerNotification (hot_reply, priority high)
```

## Flux 6 : Conversion Stripe → Onboarding

```
HTTP POST /webhooks/stripe → httpAction (convex/http.ts)
  └─ processStripeWebhook (convex/stripeWebhook.ts)
       └─ processCheckoutCompleted (convex/stripeWebhookHelpers.ts)
            ├─ Lead status → "converted", revenueGenerated recorded
            ├─ Cancels active outreach sequences
            ├─ scheduler.runAfter → createSequence (type: "onboarding")
            │    └─ Onboarding steps: J0, J1, J3, J7, J14
            └─ Records conversion tracking_event for attribution
```

## Flux 7 : Notifications Cron

```
Cron (1h) → checkIdleHotLeads (convex/notifications/triggers.ts)
  └─ For each hot lead idle > 4h: triggerNotification (idle_hot_lead, high)

Cron (2h) → checkPendingValidation (convex/notifications/triggers.ts)
  └─ For each message pending > 8h: triggerNotification (pending_validation, medium)
```

## Flux 8 : Crons Périodiques (Analyste, Churn, Upsell, RGPD)

```
Cron (weekly Mon 08:00) → analyzePerformance (convex/agents/analyst.ts)
Cron (daily 06:00) → runABTestEvaluation (convex/agents/analyst.ts)
Cron (daily 10:00) → triggerWinLossSurvey (convex/agents/analyst.ts)
Cron (weekly Wed 09:00) → analyzeRejectionPatterns (convex/agents/analyst.ts)
Cron (6h) → detectChurnSignals (convex/engine/churnDetector.ts)
Cron (daily 07:00) → detectUpsellOpportunities (convex/engine/upsellEngine.ts)
Cron (monthly 1st 03:00) → cleanupArchivedLeads (convex/compliance/cleanup.ts)
```

## Trigger Summary Table

| Source File | Mutation/Action | Triggers | Target |
|---|---|---|---|
| `agents/radar.ts` | `insertRadarLead` | `scheduler.runAfter` | `qualifier.qualifyLead` |
| `agents/qualifierHelpers.ts` | `updateLeadQualification` | `scheduler.runAfter` | `copywriter.composeMessage` |
| `agents/qualifierHelpers.ts` | `updateLeadQualification` | `scheduler.runAfter` | `notifications.triggers.triggerNotification` (if score > 85) |
| `agents/copywriterHelpers.ts` | `insertMessage` | `scheduler.runAfter` | `channelRouter.routeMessage` |
| `router/channelRouter.ts` | `routeMessage` | `scheduler.runAfter` | `timing.suggestSendTime` |
| `agents/timing.ts` | `suggestSendTime` | DB patch | `validationStatus = "pending_validation"` (Dashboard) |
| `router/queueMutations.ts` | `approveMessage` | `scheduler.runAfter` | `sendMessage.sendApprovedEmail` |
| `router/sendMessage.ts` | `sendApprovedEmail` | `runMutation` | `sequenceHelpers.createSequence` |
| `engine/sequenceEngine.ts` | `composeFollowUp` | via `updateSequenceMessage` | `channelRouter.routeMessage` |
| `engine/sequenceHelpers.ts` | `updateSequenceMessage` | `scheduler.runAfter` | `channelRouter.routeMessage` |
| `webhooks.ts` | `createLeadFromWebhook` | `scheduler.runAfter` | `enrichment.enrichLead` + `copywriter.composeMessage` + `triggerNotification` |
| `webhooks.ts` | `processInboundReply` | `scheduler.runAfter` | `objector.analyzeReply` + `triggerNotification` (if reply < 2h) |
| `agents/objectorHelpers.ts` | `insertCounterResponse` | `scheduler.runAfter` | `channelRouter.routeMessage` |
| `stripeWebhookHelpers.ts` | `processCheckoutCompleted` | `scheduler.runAfter` | `sequenceHelpers.createSequence` (onboarding) |

## Fixes Applied (Task 29.1)

1. **Webhook leads now trigger enrichment** — `createLeadFromWebhook` schedules
   `enrichLead` before the Copywriter, with a 2s delay on the Copywriter to allow
   enrichment to complete (Requirement 3.1).

2. **Webhook leads now trigger critical_lead notification** — Score 100 leads from
   webhooks now dispatch a `critical_lead` notification (Requirement 16.1).

3. **Fixed `processCheckoutCompleted` scheduler return** — `ctx.scheduler.runAfter`
   returns a `ScheduledFunctionId`, not the function's return value. Removed the
   incorrect assignment to `sequenceId`.

## Fixes Applied (Task 29.2)

4. **Extracted shared copywriter utilities** — `sequenceEngine.ts` previously imported
   `determineTone`, `buildSocialProof`, `buildCopywriterPrompt`, and `MessageOutputSchema`
   directly from `agents/copywriter.ts` via `await import("../agents/copywriter")`.
   This violated Requirement 20.1 (no direct inter-agent calls). These pure utility
   functions and Zod schemas are now in `convex/shared/copywriterUtils.ts`, imported
   by both the Copywriter agent and the Sequence Engine without creating a direct
   inter-agent dependency.
