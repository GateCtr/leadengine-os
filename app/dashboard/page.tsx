"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";
import { useState } from "react";

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

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-(--color-muted-foreground)">
      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Chargement…
    </div>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0 }).format(amount);
}

function StatCard({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const content = (
    <div className="rounded-xl border border-(--color-border) bg-(--color-background) p-5 transition-shadow hover:shadow-sm">
      <p className="text-xs font-medium text-(--color-muted-foreground)">{label}</p>
      <p className="mt-1.5 text-3xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-(--color-muted-foreground)">{sub}</p>}
    </div>
  );
  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

function KPIRow() {
  const conversion = useQuery(api.router.analyticsQueries.getConversionRate);
  const queue = useQuery(api.router.analyticsQueries.getValidationQueueStats);
  const pipeline = useQuery(api.router.analyticsQueries.getPipelineCounts);
  const revenue = useQuery(api.router.analyticsQueries.getRevenueByProduct);

  if (conversion === undefined || queue === undefined || pipeline === undefined || revenue === undefined) {
    return <Spinner />;
  }

  const totalLeads = pipeline.reduce((s, p) => s + p.count, 0);
  const hotLeads = pipeline.find((p) => p.status === "hot")?.count ?? 0;
  const totalRevenue = revenue.reduce((s, r) => s + r.totalRevenue, 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total leads" value={String(totalLeads)} sub={`${hotLeads} hot`} href="/dashboard/leads" />
      <StatCard label="Taux de conversion" value={`${conversion.conversionRate}%`} sub={`${conversion.totalConverted} convertis`} href="/dashboard/analytics" />
      <StatCard label="Revenu total" value={formatCurrency(totalRevenue)} sub={`${revenue.length} produit(s)`} href="/dashboard/analytics" />
      <StatCard label="File de validation" value={String(queue.pendingCount)} sub={queue.pendingCount > 0 ? "messages en attente" : "tout est traité"} href="/dashboard/queue" />
    </div>
  );
}

function MiniPipeline() {
  const pipeline = useQuery(api.router.analyticsQueries.getPipelineCounts);

  if (pipeline === undefined) return <Spinner />;

  const total = pipeline.reduce((s, p) => s + p.count, 0);
  if (total === 0) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-background) p-6 text-center">
        <p className="text-sm text-(--color-muted-foreground)">Aucun lead dans le pipeline. Le système attend des signaux.</p>
      </div>
    );
  }

  const maxCount = Math.max(...pipeline.map((s) => s.count), 1);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-background) p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Pipeline</h2>
        <Link href="/dashboard/analytics" className="text-xs text-(--color-primary) hover:underline">Voir détails →</Link>
      </div>
      <div className="space-y-2">
        {pipeline.filter((s) => s.count > 0).map((stage) => (
          <div key={stage.status} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-right text-xs font-medium text-(--color-muted-foreground)">
              {STATUS_LABELS[stage.status] ?? stage.status}
            </span>
            <div className="flex-1">
              <div className="h-4 w-full overflow-hidden rounded-full bg-(--color-muted)">
                <div
                  className={`h-full rounded-full transition-all ${STATUS_COLORS[stage.status] ?? "bg-gray-400"}`}
                  style={{ width: `${(stage.count / maxCount) * 100}%`, minWidth: "6px" }}
                />
              </div>
            </div>
            <span className="w-8 text-right text-sm font-semibold tabular-nums">{stage.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueByProduct() {
  const revenue = useQuery(api.router.analyticsQueries.getRevenueByProduct);

  if (revenue === undefined) return <Spinner />;

  const totalRevenue = revenue.reduce((s, r) => s + r.totalRevenue, 0);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-background) p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Revenu par produit</h2>
        <Link href="/dashboard/analytics" className="text-xs text-(--color-primary) hover:underline">Voir détails →</Link>
      </div>
      {revenue.length === 0 || totalRevenue === 0 ? (
        <p className="py-4 text-center text-sm text-(--color-muted-foreground)">Aucun revenu enregistré.</p>
      ) : (
        <div className="space-y-3">
          {revenue.filter((r) => r.totalRevenue > 0 || r.convertedCount > 0).map((product) => (
            <div key={product.productId} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: product.brandColor }} />
                <span className="text-sm font-medium">{product.productName}</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold">{formatCurrency(product.totalRevenue)}</span>
                <span className="ml-2 text-xs text-(--color-muted-foreground)">{product.convertedCount} conv.</span>
              </div>
            </div>
          ))}
          {revenue.some((r) => r.totalRevenue > 0) && (
            <div className="border-t border-(--color-border) pt-2 text-right text-xs font-medium text-(--color-muted-foreground)">
              Total : {formatCurrency(totalRevenue)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentHealth() {
  const agents = useQuery(api.router.analyticsQueries.getAgentErrorRates);
  const triggerRadar = useMutation(api.settings.triggerRadarScan);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarResult, setRadarResult] = useState<string | null>(null);

  async function handleTriggerRadar() {
    setRadarLoading(true);
    setRadarResult(null);
    try {
      await triggerRadar();
      setRadarResult("Scan Radar déclenché — vérifiez les leads dans quelques secondes.");
    } catch (e) {
      setRadarResult(`Erreur: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRadarLoading(false);
    }
  }

  if (agents === undefined) return <Spinner />;

  const AGENT_LABELS: Record<string, string> = {
    radar: "Radar", qualifier: "Qualificateur", copywriter: "Copywriter",
    objector: "Objecteur", timing: "Timing", analyst: "Analyste",
    channel_router: "Router", sequence_engine: "Séquences",
    churn_detector: "Churn", upsell_engine: "Upsell",
  };

  const active = agents.filter((a) => a.totalLogs > 0);
  const withErrors = active.filter((a) => a.errorCount > 0);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-background) p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Santé des agents</h2>
        <Link href="/dashboard/analytics" className="text-xs text-(--color-primary) hover:underline">Voir détails →</Link>
      </div>
      {active.length === 0 ? (
        <p className="py-4 text-center text-sm text-(--color-muted-foreground)">Aucune activité d&apos;agent enregistrée.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => {
            const label = AGENT_LABELS[agent.agentType] ?? agent.agentType;
            const hasError = agent.errorCount > 0;
            const isActive = agent.totalLogs > 0;
            return (
              <span
                key={agent.agentType}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  !isActive
                    ? "bg-(--color-muted) text-(--color-muted-foreground)"
                    : hasError
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${!isActive ? "bg-gray-400" : hasError ? "bg-red-500" : "bg-green-500"}`} />
                {label}
              </span>
            );
          })}
        </div>
      )}
      {withErrors.length > 0 && (
        <p className="mt-3 text-xs text-red-600">
          {withErrors.length} agent(s) avec erreurs — vérifier dans Analytics
        </p>
      )}
      <div className="mt-4 flex items-center gap-3 border-t border-(--color-border) pt-4">
        <button
          onClick={handleTriggerRadar}
          disabled={radarLoading}
          className="rounded-md bg-(--color-primary) px-3 py-1.5 text-xs font-medium text-(--color-primary-foreground) transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {radarLoading ? "Scan en cours…" : "🔍 Lancer un scan Radar"}
        </button>
        {radarResult && (
          <span className="text-xs text-(--color-muted-foreground)">{radarResult}</span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-(--color-muted-foreground)">
          Vue d&apos;ensemble du système LeadEngine OS — données temps réel.
        </p>
      </div>

      <div className="space-y-6">
        <KPIRow />

        <div className="grid gap-6 lg:grid-cols-2">
          <MiniPipeline />
          <RevenueByProduct />
        </div>

        <AgentHealth />
      </div>
    </div>
  );
}
