import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run Agent Radar scan every 2 hours to detect new leads via Serper.dev
crons.interval(
  "radar-scan",
  { hours: 2 },
  internal.agents.radar.runRadarScan,
  {},
);

// Run Sequence Engine every 6 hours to process follow-up and onboarding sequences
crons.interval(
  "sequence-check",
  { hours: 6 },
  internal.engine.sequenceEngine.processSequences,
  {},
);

// Check for hot leads idle for > 4h every hour (Requirement 16.3)
crons.interval(
  "check-idle-hot-leads",
  { hours: 1 },
  internal.notifications.triggers.checkIdleHotLeads,
  {},
);

// Check for messages pending validation > 8h every 2 hours (Requirement 16.5)
crons.interval(
  "check-pending-validation",
  { hours: 2 },
  internal.notifications.triggers.checkPendingValidation,
  {},
);

// Run Agent Analyste weekly performance analysis (report + prompt optimization)
// Requirement 14.4 — Every Monday at 08:00 UTC
crons.cron(
  "analyst-weekly-report",
  "0 8 * * 1",
  internal.agents.analyst.analyzePerformance,
  {},
);

// Run A/B test evaluation daily for mature tests (>= 14 days)
// Requirement 14.2 — Every day at 06:00 UTC
crons.cron(
  "analyst-ab-test-evaluation",
  "0 6 * * *",
  internal.agents.analyst.runABTestEvaluation,
  {},
);

// Run Win/Loss Engine: micro-survey trigger daily for recent conversions
// Requirement 14.5 — Every day at 10:00 UTC
crons.cron(
  "analyst-win-loss-survey",
  "0 10 * * *",
  internal.agents.analyst.triggerWinLossSurvey,
  {},
);

// Run Win/Loss Engine: rejection pattern analysis weekly (Wednesdays)
// Requirement 14.5 — Every Wednesday at 09:00 UTC
crons.cron(
  "analyst-rejection-patterns",
  "0 9 * * 3",
  internal.agents.analyst.analyzeRejectionPatterns,
  {},
);

// Run Churn Detector every 6 hours to detect disengagement signals (Requirement 12.1)
crons.interval(
  "churn-detector",
  { hours: 6 },
  internal.engine.churnDetector.detectChurnSignals,
  {},
);

// Run Upsell Engine daily to detect cross-sell opportunities (Requirement 13.1)
// Every day at 07:00 UTC
crons.cron(
  "upsell-engine",
  "0 7 * * *",
  internal.engine.upsellEngine.detectUpsellOpportunities,
  {},
);

// GDPR cleanup: delete archived leads older than 12 months (monthly, 1st of each month at 3:00 UTC)
// Requirement 17.4
crons.cron(
  "gdpr-cleanup-archived-leads",
  "0 3 1 * *",
  internal.compliance.cleanup.cleanupArchivedLeads,
  {},
);

export default crons;
