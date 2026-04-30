"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

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

const CHANNEL_LABELS: Record<string, string> = {
  email: "📧 Email",
  twitter: "𝕏 Twitter",
  linkedin: "💼 LinkedIn",
  reddit: "🔗 Reddit",
  instagram: "📷 Instagram",
};

const REPLY_CATEGORY_LABELS: Record<string, string> = {
  trop_cher: "Trop cher",
  besoin_reflexion: "Besoin de réfléchir",
  question_technique: "Question technique",
  interet_confirme: "Intérêt confirmé",
  refus: "Refus",
};

const REPLY_CATEGORY_STYLES: Record<string, string> = {
  trop_cher: "bg-orange-100 text-orange-700",
  besoin_reflexion: "bg-yellow-100 text-yellow-700",
  question_technique: "bg-blue-100 text-blue-700",
  interet_confirme: "bg-green-100 text-green-700",
  refus: "bg-red-100 text-red-700",
};

const VALIDATION_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  pending_validation: "En validation",
  approved: "Approuvé",
  rejected: "Rejeté",
  sent: "Envoyé",
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ScoreBadge({ score }: { score?: number }) {
  if (score == null)
    return <span className="text-(--color-muted-foreground) text-sm">—</span>;

  let colorClass = "bg-red-100 text-red-700";
  if (score >= 70) colorClass = "bg-green-100 text-green-700";
  else if (score >= 40) colorClass = "bg-yellow-100 text-yellow-700";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${colorClass}`}
    >
      {score}/100
    </span>
  );
}

function ScoringBreakdown({
  breakdown,
}: {
  breakdown: {
    urgency: number;
    webhookSource: number;
    productMatch: number;
    activeProfile: number;
    contextSignals: number;
  };
}) {
  const items = [
    { label: "Urgence", value: breakdown.urgency, max: 30 },
    { label: "Source webhook", value: breakdown.webhookSource, max: 25 },
    { label: "Match produit", value: breakdown.productMatch, max: 20 },
    { label: "Profil actif", value: breakdown.activeProfile, max: 15 },
    { label: "Signaux contextuels", value: breakdown.contextSignals, max: 10 },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-(--color-muted-foreground)">{item.label}</span>
            <span className="font-medium">
              {item.value}/{item.max}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 w-full rounded-full bg-(--color-muted)">
            <div
              className="h-1.5 rounded-full bg-(--color-primary)"
              style={{ width: `${(item.value / item.max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-36 shrink-0 text-xs font-medium text-(--color-muted-foreground)">
        {label}
      </span>
      <span className="text-sm text-(--color-foreground)">{children}</span>
    </div>
  );
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

function DeleteProspectButton({ leadId, email }: { leadId: Id<"leads">; email: string }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteProspect = useMutation(api.compliance.deleteProspect.deleteProspectData);
  const router = useRouter();

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteProspect({ leadId });
      router.push("/dashboard/leads");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la suppression.");
      setIsDeleting(false);
    }
  }, [deleteProspect, leadId, router]);

  if (!showConfirm) {
    return (
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <line x1="10" x2="10" y1="11" y2="17" />
          <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
        Supprimer toutes les données
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">
        Supprimer définitivement toutes les données de {email} ?
      </p>
      <p className="mt-1 text-xs text-red-600">
        Cette action est irréversible. Toutes les données associées (messages, séquences, tracking, témoignages, notifications) seront supprimées et l&apos;email sera ajouté à la liste noire.
      </p>
      {error && (
        <p className="mt-2 text-xs font-medium text-red-700">{error}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {isDeleting ? "Suppression…" : "Confirmer la suppression"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowConfirm(false);
            setError(null);
          }}
          disabled={isDeleting}
          className="inline-flex items-center rounded-md border border-(--color-border) bg-(--color-background) px-3 py-1.5 text-xs font-medium text-(--color-foreground) transition-colors hover:bg-(--color-muted) disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const lead = useQuery(api.router.leadQueries.getLeadDetail, {
    leadId: id as Id<"leads">,
  });

  if (lead === undefined) {
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

  if (lead === null) {
    return (
      <div className="py-12 text-center">
        <p className="text-(--color-muted-foreground)">Lead introuvable.</p>
        <Link
          href="/dashboard/leads"
          className="mt-4 inline-block text-sm text-(--color-primary) hover:underline"
        >
          ← Retour à la liste
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard/leads"
          className="rounded-md p-1.5 text-(--color-muted-foreground) transition-colors hover:bg-(--color-muted) hover:text-(--color-foreground)"
          aria-label="Retour à la liste des leads"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">
            {lead.name ?? lead.email}
          </h1>
          {lead.name && (
            <p className="text-sm text-(--color-muted-foreground)">
              {lead.email}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — Lead info */}
        <div className="space-y-6 lg:col-span-1">
          {/* Status & Score card */}
          <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
            <h2 className="mb-3 text-sm font-semibold text-(--color-foreground)">
              Statut & Score
            </h2>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[lead.status] ?? "bg-gray-100 text-gray-600"}`}
              >
                {STATUS_LABELS[lead.status] ?? lead.status}
              </span>
              <ScoreBadge score={lead.score} />
            </div>
            {lead.scoringBreakdown && (
              <div className="mt-4">
                <ScoringBreakdown breakdown={lead.scoringBreakdown} />
              </div>
            )}
            {lead.scoringReasoning && (
              <p className="mt-3 rounded-md bg-(--color-muted) p-2 text-xs text-(--color-muted-foreground)">
                {lead.scoringReasoning}
              </p>
            )}
          </div>

          {/* Detection card */}
          <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
            <h2 className="mb-3 text-sm font-semibold text-(--color-foreground)">
              Détection
            </h2>
            <InfoRow label="Source">{lead.source}</InfoRow>
            <InfoRow label="Canal">{lead.detectionChannel}</InfoRow>
            <InfoRow label="Détecté le">{formatDate(lead.detectedAt)}</InfoRow>
            {lead.sourceUrl && (
              <InfoRow label="URL source">
                <a
                  href={lead.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-(--color-primary) hover:underline"
                >
                  {truncate(lead.sourceUrl, 40)}
                </a>
              </InfoRow>
            )}
            <InfoRow label="Consentement">
              {lead.consentSource} — {formatDate(lead.consentDate)}
            </InfoRow>
          </div>

          {/* Product card */}
          <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
            <h2 className="mb-3 text-sm font-semibold text-(--color-foreground)">
              Produit
            </h2>
            <InfoRow label="Produit assigné">
              {lead.productName ?? lead.productId ?? "—"}
            </InfoRow>
            {lead.revenueGenerated != null && (
              <InfoRow label="Revenu généré">
                {lead.revenueGenerated.toLocaleString("fr-FR", {
                  style: "currency",
                  currency: "EUR",
                })}
              </InfoRow>
            )}
            {lead.convertedAt && (
              <InfoRow label="Converti le">
                {formatDate(lead.convertedAt)}
              </InfoRow>
            )}
          </div>

          {/* Churn risk card */}
          {(lead.churnRiskScore != null || lead.lastActivityAt != null) && (
            <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
              <h2 className="mb-3 text-sm font-semibold text-(--color-foreground)">
                Risque Churn
              </h2>
              {lead.churnRiskScore != null && (
                <InfoRow label="Score churn">
                  <span
                    className={`font-semibold ${lead.churnRiskScore >= 70 ? "text-red-600" : lead.churnRiskScore >= 40 ? "text-yellow-600" : "text-green-600"}`}
                  >
                    {lead.churnRiskScore}/100
                  </span>
                </InfoRow>
              )}
              {lead.lastActivityAt != null && (
                <InfoRow label="Dernière activité">
                  {formatDateTime(lead.lastActivityAt)}
                </InfoRow>
              )}
            </div>
          )}

          {/* Enrichment card */}
          {lead.enrichmentData && (
            <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
              <h2 className="mb-3 text-sm font-semibold text-(--color-foreground)">
                Profil enrichi
              </h2>
              {lead.enrichmentData.company && (
                <InfoRow label="Entreprise">
                  {lead.enrichmentData.company}
                </InfoRow>
              )}
              {lead.enrichmentData.role && (
                <InfoRow label="Rôle">{lead.enrichmentData.role}</InfoRow>
              )}
              {lead.enrichmentData.bio && (
                <InfoRow label="Bio">
                  {truncate(lead.enrichmentData.bio, 120)}
                </InfoRow>
              )}
              {lead.enrichmentData.skills &&
                lead.enrichmentData.skills.length > 0 && (
                  <InfoRow label="Compétences">
                    <div className="flex flex-wrap gap-1">
                      {lead.enrichmentData.skills.map((skill) => (
                        <span
                          key={skill}
                          className="inline-flex rounded-full bg-(--color-muted) px-2 py-0.5 text-xs"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </InfoRow>
                )}
              <div className="mt-2 flex flex-wrap gap-2">
                {lead.enrichmentData.linkedinUrl && (
                  <a
                    href={lead.enrichmentData.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-(--color-primary) hover:underline"
                  >
                    LinkedIn ↗
                  </a>
                )}
                {lead.enrichmentData.githubUrl && (
                  <a
                    href={lead.enrichmentData.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-(--color-primary) hover:underline"
                  >
                    GitHub ↗
                  </a>
                )}
                {lead.enrichmentData.websiteUrl && (
                  <a
                    href={lead.enrichmentData.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-(--color-primary) hover:underline"
                  >
                    Site web ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {/* GDPR — Delete all prospect data */}
          <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
            <h2 className="mb-3 text-sm font-semibold text-(--color-foreground)">
              Conformité RGPD
            </h2>
            <p className="mb-3 text-xs text-(--color-muted-foreground)">
              Droit à l&apos;effacement — Supprimer toutes les données de ce prospect conformément au RGPD.
            </p>
            <DeleteProspectButton leadId={id as Id<"leads">} email={lead.email} />
          </div>
        </div>

        {/* Right column — Timeline */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-(--color-border) bg-(--color-background) p-4">
            <h2 className="mb-4 text-sm font-semibold text-(--color-foreground)">
              Timeline des interactions
            </h2>

            {lead.messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-(--color-muted-foreground)">
                Aucune interaction enregistrée.
              </p>
            ) : (
              <div className="relative space-y-0">
                {/* Vertical line */}
                <div className="absolute top-2 bottom-2 left-3 w-px bg-(--color-border)" />

                {lead.messages.map((msg) => (
                  <div key={msg._id} className="relative flex gap-4 py-3">
                    {/* Dot */}
                    <div className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-(--color-primary) bg-(--color-background)" />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-(--color-foreground)">
                          {msg.sentAt
                            ? `Envoyé le ${formatDateTime(msg.sentAt)}`
                            : `Créé le ${formatDateTime(msg.createdAt)}`}
                        </span>
                        {msg.channel && (
                          <span className="inline-flex items-center rounded-full bg-(--color-muted) px-2 py-0.5 text-xs text-(--color-foreground)">
                            {CHANNEL_LABELS[msg.channel] ?? msg.channel}
                          </span>
                        )}
                        <span className="rounded-full bg-(--color-muted) px-2 py-0.5 text-xs text-(--color-muted-foreground)">
                          {VALIDATION_STATUS_LABELS[msg.validationStatus] ??
                            msg.validationStatus}
                        </span>
                        {msg.sequenceStep != null && (
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                            Séquence étape {msg.sequenceStep}
                          </span>
                        )}
                      </div>

                      {msg.subject && (
                        <p className="mt-1 text-xs text-(--color-muted-foreground)">
                          Sujet : {msg.subject}
                        </p>
                      )}

                      {(msg.finalContent ?? msg.suggestedReply) && (
                        <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-(--color-muted) p-2.5 text-xs text-(--color-foreground)">
                          {truncate(
                            msg.finalContent ?? msg.suggestedReply ?? "",
                            250,
                          )}
                        </p>
                      )}

                      {/* Reply section */}
                      {msg.replyContent && (
                        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-xs font-medium text-emerald-700">
                              Réponse reçue
                              {msg.replyReceivedAt &&
                                ` le ${formatDateTime(msg.replyReceivedAt)}`}
                            </span>
                            {msg.replyCategory && (
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${REPLY_CATEGORY_STYLES[msg.replyCategory] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {REPLY_CATEGORY_LABELS[msg.replyCategory] ??
                                  msg.replyCategory}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-xs text-emerald-900">
                            {truncate(msg.replyContent, 250)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
