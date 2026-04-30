"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const STATUS_LABELS: Record<string, string> = {
  pending_qualification: "En qualification",
  qualified: "Qualifié",
  hot: "Hot",
  pending: "En attente",
  converted: "Converti",
  archived: "Archivé",
  discarded: "Écarté",
  churned: "Churned",
};

const STATUS_COLORS: Record<string, string> = {
  pending_qualification: "bg-blue-500",
  qualified: "bg-emerald-500",
  hot: "bg-orange-500",
  pending: "bg-yellow-500",
  converted: "bg-green-500",
  archived: "bg-gray-400",
  discarded: "bg-red-500",
  churned: "bg-rose-500",
};

const AGENT_LABELS: Record<string, string> = {
  radar: "Radar",
  qualifier: "Qualificateur",
  copywriter: "Copywriter",
  objector: "Objecteur",
  timing: "Timing",
  analyst: "Analyste",
  channel_router: "Channel Router",
  sequence_engine: "Sequence Engine",
  churn_detector: "Churn Detector",
  upsell_engine: "Upsell Engine",
};

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-12 text-(--color-muted-foreground)">
      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      Chargement…
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
  }).format(amount);
}

function timeAgo(timestamp: number) {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}j`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-muted) p-4">
      <p className="text-xs font-medium text-(--color-muted-foreground)">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && (
        <p className="mt-0.5 text-xs text-(--color-muted-foreground)">{sub}</p>
      )}
    </div>
  );
}

function PipelineStageDetail({
  status,
}: {
  status: string;
}) {
  const leads = useQuery(api.router.analyticsQueries.getLeadsByStage, {
    status: status as "pending_qualification" | "qualified" | "discarded" | "hot" | "pending" | "converted" | "archived" | "churned",
  });

  if (leads === undefined) {
    return (
      <div className="py-2 pl-32 text-xs text-(--color-muted-foreground)">
        Chargement…
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="py-2 pl-32 text-xs text-(--color-muted-foreground)">
        Aucun lead dans cette étape.
      </div>
    );
  }

  const stuckLeads = leads.filter((l) => l.stuckSinceHours >= 24);
  const recentLeads = leads.filter((l) => l.stuckSinceHours < 24);

  return (
    <div className="mt-1 mb-2 ml-32 space-y-1">
      {stuckLeads.length > 0 && (
        <p className="text-xs font-medium text-amber-600">
          {stuckLeads.length} lead{stuckLeads.length > 1 ? "s" : ""} bloqué{stuckLeads.length > 1 ? "s" : ""} depuis &gt; 24h
        </p>
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border border-(--color-border)">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-(--color-border) bg-(--color-muted)">
              <th className="px-3 py-1.5 font-medium text-(--color-muted-foreground)">
                Lead
              </th>
              <th className="px-3 py-1.5 text-right font-medium text-(--color-muted-foreground)">
                Score
              </th>
              <th className="px-3 py-1.5 text-right font-medium text-(--color-muted-foreground)">
                Depuis
              </th>
              <th className="px-3 py-1.5 text-right font-medium text-(--color-muted-foreground)">
                Statut
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const isStuck = lead.stuckSinceHours >= 24;
              return (
                <tr
                  key={lead._id}
                  className={`border-b border-(--color-border) last:border-b-0 ${isStuck ? "bg-amber-50/50" : ""}`}
                >
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/dashboard/leads/${lead._id}`}
                      className="font-medium text-(--color-primary) hover:underline"
                    >
                      {lead.name ?? lead.email}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {lead.score ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {lead.stuckSinceHours >= 24
                      ? `${Math.floor(lead.stuckSinceHours / 24)}j`
                      : `${lead.stuckSinceHours}h`}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isStuck ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        Bloqué
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                        Récent
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {recentLeads.length > 0 && stuckLeads.length > 0 && (
        <p className="text-[10px] text-(--color-muted-foreground)">
          {recentLeads.length} lead{recentLeads.length > 1 ? "s" : ""} récent{recentLeads.length > 1 ? "s" : ""} (&lt; 24h)
        </p>
      )}
    </div>
  );
}

function PipelineSection() {
  const pipelineCounts = useQuery(api.router.analyticsQueries.getPipelineCounts);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  if (pipelineCounts === undefined) return <Spinner />;

  const totalLeads = pipelineCounts.reduce((sum, s) => sum + s.count, 0);
  const maxCount = Math.max(...pipelineCounts.map((s) => s.count), 1);

  return (
    <SectionCard title="Pipeline — Leads par étape">
      {totalLeads === 0 ? (
        <p className="text-sm text-(--color-muted-foreground)">
          Aucun lead dans le pipeline.
        </p>
      ) : (
        <div className="space-y-1">
          {pipelineCounts.map((stage) => (
            <div key={stage.status}>
              <button
                type="button"
                onClick={() =>
                  setExpandedStage(
                    expandedStage === stage.status ? null : stage.status,
                  )
                }
                className="flex w-full items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-(--color-muted)"
                aria-expanded={expandedStage === stage.status}
                disabled={stage.count === 0}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`shrink-0 transition-transform text-(--color-muted-foreground) ${
                    expandedStage === stage.status ? "rotate-90" : ""
                  } ${stage.count === 0 ? "opacity-0" : ""}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="w-28 shrink-0 text-right text-xs font-medium text-(--color-muted-foreground)">
                  {STATUS_LABELS[stage.status] ?? stage.status}
                </span>
                <div className="flex-1">
                  <div className="h-5 w-full overflow-hidden rounded-full bg-(--color-muted)">
                    <div
                      className={`h-full rounded-full transition-all ${STATUS_COLORS[stage.status] ?? "bg-gray-400"}`}
                      style={{
                        width: `${(stage.count / maxCount) * 100}%`,
                        minWidth: stage.count > 0 ? "8px" : "0",
                      }}
                    />
                  </div>
                </div>
                <span className="w-10 text-right text-sm font-semibold tabular-nums">
                  {stage.count}
                </span>
              </button>
              {expandedStage === stage.status && stage.count > 0 && (
                <PipelineStageDetail status={stage.status} />
              )}
            </div>
          ))}
          <p className="mt-2 text-right text-xs text-(--color-muted-foreground)">
            Total : {totalLeads} leads
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function ConversionSection() {
  const conversion = useQuery(api.router.analyticsQueries.getConversionRate);

  if (conversion === undefined) return <Spinner />;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <MetricCard
        label="Leads qualifiés"
        value={String(conversion.totalQualified)}
        sub="qualifiés + hot + convertis"
      />
      <MetricCard
        label="Convertis"
        value={String(conversion.totalConverted)}
      />
      <MetricCard
        label="Taux de conversion"
        value={`${conversion.conversionRate}%`}
        sub="convertis / qualifiés"
      />
    </div>
  );
}

function RevenueSection() {
  const revenue = useQuery(api.router.analyticsQueries.getRevenueByProduct);

  if (revenue === undefined) return <Spinner />;

  const totalRevenue = revenue.reduce((sum, r) => sum + r.totalRevenue, 0);

  return (
    <SectionCard title="Revenu par produit">
      {revenue.length === 0 ? (
        <p className="text-sm text-(--color-muted-foreground)">
          Aucune donnée de revenu disponible.
        </p>
      ) : (
        <div className="space-y-3">
          {revenue.map((product) => (
            <div
              key={product.productId}
              className="flex items-center justify-between rounded-md border border-(--color-border) px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: product.brandColor }}
                />
                <span className="text-sm font-medium">
                  {product.productName}
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">
                  {formatCurrency(product.totalRevenue)}
                </p>
                <p className="text-xs text-(--color-muted-foreground)">
                  {product.convertedCount} conversion
                  {product.convertedCount !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          ))}
          <p className="text-right text-xs font-medium text-(--color-muted-foreground)">
            Total : {formatCurrency(totalRevenue)}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function WeeklyReportsSection() {
  const reports = useQuery(api.router.analyticsQueries.getWeeklyReports);

  if (reports === undefined) return <Spinner />;

  return (
    <SectionCard title="Rapports hebdomadaires — Agent Analyste">
      {reports.length === 0 ? (
        <p className="text-sm text-(--color-muted-foreground)">
          Aucun rapport hebdomadaire disponible.
        </p>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const data = report.data as Record<string, unknown> | null;
            return (
              <div
                key={report._id}
                className="rounded-md border border-(--color-border) p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {report.period
                      ? `${formatDate(report.period.start)} → ${formatDate(report.period.end)}`
                      : formatDate(report.createdAt)}
                  </span>
                  {report.productId && (
                    <span className="inline-flex items-center rounded-full bg-(--color-primary)/10 px-2 py-0.5 text-xs font-medium text-(--color-primary)">
                      {report.productId}
                    </span>
                  )}
                </div>
                {data && typeof data === "object" ? (
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {Object.entries(data).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between rounded bg-(--color-muted) px-2 py-1"
                      >
                        <span className="text-(--color-muted-foreground)">
                          {key}
                        </span>
                        <span className="font-medium">
                          {typeof value === "number"
                            ? value.toLocaleString("fr-FR")
                            : String(value ?? "—")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-(--color-muted-foreground)">
                    Données non disponibles
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function ABTestSection() {
  const abTests = useQuery(api.router.analyticsQueries.getABTestResults);

  if (abTests === undefined) return <Spinner />;

  return (
    <SectionCard title="Résultats A/B Testing">
      {abTests.length === 0 ? (
        <p className="text-sm text-(--color-muted-foreground)">
          Aucun résultat A/B testing disponible.
        </p>
      ) : (
        <div className="space-y-3">
          {abTests.map((test) => {
            const data = test.data as Record<string, unknown> | null;
            const winner = data?.winner as string | undefined;
            const status = data?.status as string | undefined;
            return (
              <div
                key={test._id}
                className="rounded-md border border-(--color-border) p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      status === "completed"
                        ? "bg-green-100 text-green-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {status === "completed" ? "Terminé" : "En cours"}
                  </span>
                  {winner && (
                    <span className="text-xs font-medium text-(--color-foreground)">
                      Gagnant : Version {winner}
                    </span>
                  )}
                  {test.productId && (
                    <span className="inline-flex items-center rounded-full bg-(--color-primary)/10 px-2 py-0.5 text-xs font-medium text-(--color-primary)">
                      {test.productId}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-(--color-muted-foreground)">
                    {formatDateTime(test.createdAt)}
                  </span>
                </div>
                {data && typeof data === "object" ? (
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {Object.entries(data)
                      .filter(
                        ([key]) => key !== "status" && key !== "winner",
                      )
                      .map(([key, value]) => (
                        <div
                          key={key}
                          className="flex justify-between rounded bg-(--color-muted) px-2 py-1"
                        >
                          <span className="text-(--color-muted-foreground)">
                            {key}
                          </span>
                          <span className="font-medium">
                            {typeof value === "number"
                              ? value.toLocaleString("fr-FR")
                              : String(value ?? "—")}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-(--color-muted-foreground)">
                    Données non disponibles
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function WebhookErrorsSection() {
  const erroredWebhooks = useQuery(
    api.router.analyticsQueries.getErroredWebhookEvents,
  );

  if (erroredWebhooks === undefined) return <Spinner />;

  return (
    <SectionCard title="Webhooks en erreur — Non traités">
      {erroredWebhooks.length === 0 ? (
        <p className="text-sm text-(--color-muted-foreground)">
          Aucun webhook en erreur.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-red-600">
            {erroredWebhooks.length} webhook{erroredWebhooks.length > 1 ? "s" : ""} en erreur
          </p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-(--color-border)">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--color-border) bg-(--color-muted)">
                  <th className="px-4 py-2 font-medium text-(--color-muted-foreground)">
                    Source
                  </th>
                  <th className="px-4 py-2 font-medium text-(--color-muted-foreground)">
                    Type
                  </th>
                  <th className="px-4 py-2 font-medium text-(--color-muted-foreground)">
                    Erreur
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-(--color-muted-foreground)">
                    Reçu
                  </th>
                </tr>
              </thead>
              <tbody>
                {erroredWebhooks.map((event) => (
                  <tr
                    key={event._id}
                    className="border-b border-(--color-border) last:border-b-0"
                  >
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        {event.source}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs font-medium">
                      {event.eventType}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 text-xs text-red-600">
                      {event.error ?? "Erreur inconnue"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-(--color-muted-foreground)">
                      {timeAgo(event.receivedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function ObservabilitySection() {
  const agentErrors = useQuery(
    api.router.analyticsQueries.getAgentErrorRates,
  );
  const queueStats = useQuery(
    api.router.analyticsQueries.getValidationQueueStats,
  );

  if (agentErrors === undefined || queueStats === undefined)
    return <Spinner />;

  const activeAgents = agentErrors.filter((a) => a.totalLogs > 0);

  return (
    <SectionCard title="Observabilité — Santé des agents">
      <div className="mb-4 flex gap-4">
        <MetricCard
          label="File de validation"
          value={String(queueStats.pendingCount)}
          sub={
            queueStats.oldestPendingAt
              ? `Plus ancien : ${timeAgo(queueStats.oldestPendingAt)}`
              : undefined
          }
        />
      </div>

      {activeAgents.length === 0 ? (
        <p className="text-sm text-(--color-muted-foreground)">
          Aucun log d'agent enregistré.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-(--color-border)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-muted)">
                <th className="px-4 py-2 font-medium text-(--color-muted-foreground)">
                  Agent
                </th>
                <th className="px-4 py-2 text-right font-medium text-(--color-muted-foreground)">
                  Logs
                </th>
                <th className="px-4 py-2 text-right font-medium text-(--color-muted-foreground)">
                  Erreurs
                </th>
                <th className="px-4 py-2 text-right font-medium text-(--color-muted-foreground)">
                  Warnings
                </th>
                <th className="px-4 py-2 text-right font-medium text-(--color-muted-foreground)">
                  Taux d'erreur
                </th>
              </tr>
            </thead>
            <tbody>
              {activeAgents.map((agent) => (
                <tr
                  key={agent.agentType}
                  className="border-b border-(--color-border) last:border-b-0"
                >
                  <td className="px-4 py-2 font-medium">
                    {AGENT_LABELS[agent.agentType] ?? agent.agentType}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {agent.totalLogs}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {agent.errorCount > 0 ? (
                      <span className="font-semibold text-red-600">
                        {agent.errorCount}
                      </span>
                    ) : (
                      <span className="text-(--color-muted-foreground)">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {agent.warnCount > 0 ? (
                      <span className="font-semibold text-yellow-600">
                        {agent.warnCount}
                      </span>
                    ) : (
                      <span className="text-(--color-muted-foreground)">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        agent.errorRate > 10
                          ? "bg-red-100 text-red-700"
                          : agent.errorRate > 0
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {agent.errorRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {agentErrors.filter((a) => a.totalLogs === 0).length > 0 && (
        <p className="mt-3 text-xs text-(--color-muted-foreground)">
          Agents sans activité :{" "}
          {agentErrors
            .filter((a) => a.totalLogs === 0)
            .map((a) => AGENT_LABELS[a.agentType] ?? a.agentType)
            .join(", ")}
        </p>
      )}
    </SectionCard>
  );
}

function AgentLogsSection() {
  const [logFilter, setLogFilter] = useState<"all" | "error" | "warn" | "info">("all");

  const logs = useQuery(
    api.router.analyticsQueries.getRecentAgentLogs,
    logFilter === "all" ? {} : { level: logFilter },
  );

  const LEVEL_STYLES: Record<string, string> = {
    error: "bg-red-100 text-red-700",
    warn: "bg-yellow-100 text-yellow-700",
    info: "bg-blue-100 text-blue-700",
  };

  const LEVEL_LABELS: Record<string, string> = {
    error: "Erreur",
    warn: "Warning",
    info: "Info",
  };

  return (
    <SectionCard title="Logs des agents — Messages détaillés">
      <div className="mb-4 flex gap-2">
        {(["all", "error", "warn", "info"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setLogFilter(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              logFilter === f
                ? "bg-(--color-primary) text-(--color-primary-foreground)"
                : "border border-(--color-border) text-(--color-foreground) hover:bg-(--color-muted)"
            }`}
          >
            {f === "all" ? "Erreurs + Warnings" : LEVEL_LABELS[f] ?? f}
          </button>
        ))}
      </div>

      {logs === undefined ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <p className="py-6 text-center text-sm text-(--color-muted-foreground)">
          Aucun log {logFilter !== "all" ? `de type "${LEVEL_LABELS[logFilter]}"` : ""} trouvé.
        </p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log._id}
              className="rounded-lg border border-(--color-border) bg-(--color-background) p-3"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    LEVEL_STYLES[log.level] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {LEVEL_LABELS[log.level] ?? log.level}
                </span>
                <span className="inline-flex items-center rounded-full bg-(--color-primary)/10 px-2 py-0.5 text-[10px] font-medium text-(--color-primary)">
                  {AGENT_LABELS[log.agentType] ?? log.agentType}
                </span>
                <span className="text-[10px] text-(--color-muted-foreground)">
                  {formatDateTime(log.timestamp)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-xs text-(--color-foreground) leading-relaxed">
                {log.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export default function AnalyticsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-(--color-muted-foreground)">
          Métriques du pipeline, rapports de l'Agent Analyste et observabilité
          des agents — données temps réel.
        </p>
      </div>

      <div className="space-y-6">
        <ConversionSection />
        <PipelineSection />
        <RevenueSection />
        <WebhookErrorsSection />
        <WeeklyReportsSection />
        <ABTestSection />
        <ObservabilitySection />
        <AgentLogsSection />
      </div>
    </div>
  );
}
