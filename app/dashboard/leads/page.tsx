"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import Link from "next/link";

type LeadStatus =
  | "pending_qualification"
  | "qualified"
  | "discarded"
  | "hot"
  | "pending"
  | "converted"
  | "archived"
  | "churned";

const STATUS_OPTIONS: { value: LeadStatus | "all"; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "pending_qualification", label: "En qualification" },
  { value: "qualified", label: "Qualifié" },
  { value: "hot", label: "Hot" },
  { value: "pending", label: "En attente" },
  { value: "converted", label: "Converti" },
  { value: "archived", label: "Archivé" },
  { value: "discarded", label: "Écarté" },
  { value: "churned", label: "Churned" },
];

const STATUS_STYLES: Record<string, string> = {
  pending_qualification: "bg-blue-100 text-blue-700",
  qualified: "bg-emerald-100 text-emerald-700",
  hot: "bg-orange-100 text-orange-700",
  pending: "bg-yellow-100 text-yellow-700",
  converted: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-600",
  discarded: "bg-red-100 text-red-700",
  churned: "bg-rose-100 text-rose-700",
};

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

function ScoreBadge({ score }: { score?: number }) {
  if (score == null)
    return (
      <span className="text-(--color-muted-foreground) text-xs">—</span>
    );

  let colorClass = "bg-red-100 text-red-700";
  if (score >= 70) colorClass = "bg-green-100 text-green-700";
  else if (score >= 40) colorClass = "bg-yellow-100 text-yellow-700";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      {score}/100
    </span>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function LeadsPage() {
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [productFilter, setProductFilter] = useState("");
  const [minScore, setMinScore] = useState<number | undefined>(undefined);

  const leads = useQuery(api.router.leadQueries.listLeads, {
    status: statusFilter === "all" ? undefined : statusFilter,
    productId: productFilter || undefined,
    minScore,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="mt-1 text-sm text-(--color-muted-foreground)">
          Liste des prospects dans le pipeline — filtrez par statut, produit ou
          score.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="status-filter"
            className="mb-1 block text-xs font-medium text-(--color-muted-foreground)"
          >
            Statut
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as LeadStatus | "all")
            }
            className="rounded-md border border-(--color-border) bg-(--color-background) px-3 py-1.5 text-sm text-(--color-foreground) focus:border-(--color-primary) focus:outline-none focus:ring-1 focus:ring-(--color-primary)"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="product-filter"
            className="mb-1 block text-xs font-medium text-(--color-muted-foreground)"
          >
            Produit (slug)
          </label>
          <input
            id="product-filter"
            type="text"
            placeholder="ex: piksend"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="w-36 rounded-md border border-(--color-border) bg-(--color-background) px-3 py-1.5 text-sm text-(--color-foreground) placeholder:text-(--color-muted-foreground) focus:border-(--color-primary) focus:outline-none focus:ring-1 focus:ring-(--color-primary)"
          />
        </div>

        <div>
          <label
            htmlFor="score-filter"
            className="mb-1 block text-xs font-medium text-(--color-muted-foreground)"
          >
            Score min
          </label>
          <input
            id="score-filter"
            type="number"
            min={0}
            max={100}
            placeholder="0"
            value={minScore ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setMinScore(val === "" ? undefined : Number(val));
            }}
            className="w-20 rounded-md border border-(--color-border) bg-(--color-background) px-3 py-1.5 text-sm text-(--color-foreground) placeholder:text-(--color-muted-foreground) focus:border-(--color-primary) focus:outline-none focus:ring-1 focus:ring-(--color-primary)"
          />
        </div>
      </div>

      {leads === undefined ? (
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
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-(--color-border) bg-(--color-muted) px-6 py-12 text-center">
          <p className="text-(--color-muted-foreground)">
            Aucun lead ne correspond aux filtres sélectionnés.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-(--color-border)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-muted)">
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">
                  Nom
                </th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">
                  Email
                </th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">
                  Statut
                </th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">
                  Score
                </th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">
                  Produit
                </th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">
                  Détecté le
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead._id}
                  className="border-b border-(--color-border) transition-colors last:border-b-0 hover:bg-(--color-muted)/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/leads/${lead._id}`}
                      className="font-medium text-(--color-primary) hover:underline"
                    >
                      {lead.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-(--color-foreground)">
                    {lead.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[lead.status] ?? "bg-gray-100 text-gray-600"}`}
                    >
                      {STATUS_LABELS[lead.status] ?? lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBadge score={lead.score} />
                  </td>
                  <td className="px-4 py-3 text-(--color-foreground)">
                    {lead.productName ?? lead.productId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-(--color-muted-foreground)">
                    {formatDate(lead.detectedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
