"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return <span className="text-(--color-muted-foreground) text-xs">—</span>;

  let colorClass = "bg-red-100 text-red-700";
  if (score >= 70) colorClass = "bg-green-100 text-green-700";
  else if (score >= 40) colorClass = "bg-yellow-100 text-yellow-700";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}>
      {score}/100
    </span>
  );
}

function ChannelBadge({ channel }: { channel?: string }) {
  if (!channel) return <span className="text-(--color-muted-foreground) text-xs">—</span>;

  const labels: Record<string, string> = {
    email: "📧 Email",
    twitter: "𝕏 Twitter",
    linkedin: "💼 LinkedIn",
    reddit: "🔗 Reddit",
    instagram: "📷 Instagram",
  };

  return (
    <span className="inline-flex items-center rounded-full bg-(--color-muted) px-2 py-0.5 text-xs font-medium text-(--color-foreground)">
      {labels[channel] ?? channel}
    </span>
  );
}

function formatSuggestedTime(timestamp?: number) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return date.toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

export default function QueuePage() {
  const messages = useQuery(api.router.queueQueries.listPendingValidation);
  const approveMessage = useMutation(api.router.queueMutations.approveMessage);
  const rejectMessage = useMutation(api.router.queueMutations.rejectMessage);
  const editMessage = useMutation(api.router.queueMutations.editMessage);

  const [editingId, setEditingId] = useState<Id<"messages"> | null>(null);
  const [editContent, setEditContent] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [socialLink, setSocialLink] = useState<{ messageId: string; link: string; channel: string } | null>(null);

  function startEdit(messageId: Id<"messages">, currentContent: string) {
    setEditingId(messageId);
    setEditContent(currentContent);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  async function handleSaveEdit(messageId: Id<"messages">) {
    setActionLoading(`edit-${messageId}`);
    try {
      await editMessage({ messageId, content: editContent });
      cancelEdit();
    } catch (error) {
      console.error("Failed to save edit:", error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApprove(messageId: Id<"messages">) {
    setActionLoading(`approve-${messageId}`);
    try {
      const result = await approveMessage({ messageId });
      if (result.channel && result.channel !== "email" && result.socialDirectLink) {
        setSocialLink({
          messageId,
          link: result.socialDirectLink,
          channel: result.channel,
        });
      }
    } catch (error) {
      console.error("Failed to approve:", error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(messageId: Id<"messages">) {
    setActionLoading(`reject-${messageId}`);
    try {
      await rejectMessage({ messageId });
    } catch (error) {
      console.error("Failed to reject:", error);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">File de Validation</h1>
        <p className="mt-1 text-sm text-(--color-muted-foreground)">
          Messages en attente de validation HITL — triés par score décroissant.
        </p>
      </div>

      {socialLink && (
        <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-blue-900">
                Message social approuvé — envoi manuel requis
              </p>
              <p className="mt-1 text-xs text-blue-700">
                Ouvrez le lien ci-dessous pour envoyer le message sur {socialLink.channel} :
              </p>
              <a
                href={socialLink.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                Ouvrir {socialLink.channel} ↗
              </a>
            </div>
            <button
              onClick={() => setSocialLink(null)}
              className="text-blue-400 transition-colors hover:text-blue-600"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {messages === undefined ? (
        <div className="flex items-center gap-2 py-12 text-(--color-muted-foreground)">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Chargement…
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-lg border border-(--color-border) bg-(--color-muted) px-6 py-12 text-center">
          <p className="text-(--color-muted-foreground)">
            Aucun message en attente de validation.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg._id}
              className="rounded-lg border border-(--color-border) bg-(--color-background) p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <ScoreBadge score={msg.leadScore} />
                    <ChannelBadge channel={msg.channel} />
                    {msg.productName && (
                      <span className="inline-flex items-center rounded-full bg-(--color-primary)/10 px-2 py-0.5 text-xs font-medium text-(--color-primary)">
                        {msg.productName}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium">
                    {msg.leadName ?? msg.leadEmail}
                    {msg.leadName && (
                      <span className="ml-1 text-(--color-muted-foreground) font-normal">
                        ({msg.leadEmail})
                      </span>
                    )}
                  </p>

                  {msg.subject && (
                    <p className="mt-1 text-sm text-(--color-muted-foreground)">
                      Sujet : {msg.subject}
                    </p>
                  )}

                  {editingId === msg._id ? (
                    <div className="mt-3">
                      <textarea
                        className="w-full rounded-md border border-(--color-border) bg-(--color-muted) p-3 text-sm text-(--color-foreground) focus:border-(--color-primary) focus:outline-none focus:ring-1 focus:ring-(--color-primary)"
                        rows={5}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleSaveEdit(msg._id)}
                          disabled={actionLoading === `edit-${msg._id}`}
                          className="rounded-md bg-(--color-primary) px-3 py-1.5 text-xs font-medium text-(--color-primary-foreground) transition-colors hover:opacity-90 disabled:opacity-50"
                        >
                          {actionLoading === `edit-${msg._id}` ? "Enregistrement…" : "Enregistrer"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs font-medium text-(--color-foreground) transition-colors hover:bg-(--color-muted)"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap rounded-md bg-(--color-muted) p-3 text-sm text-(--color-foreground)">
                      {truncate(msg.suggestedReply ?? "", 300)}
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-3 text-xs text-(--color-muted-foreground)">
                    <span>
                      ⏰ Envoi suggéré : {formatSuggestedTime(msg.sendAtSuggested)}
                    </span>
                  </div>
                </div>
              </div>

              {editingId !== msg._id && (
                <div className="mt-3 flex gap-2 border-t border-(--color-border) pt-3">
                  <button
                    onClick={() => handleApprove(msg._id)}
                    disabled={actionLoading === `approve-${msg._id}`}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading === `approve-${msg._id}` ? "Validation…" : "✓ Valider"}
                  </button>
                  <button
                    onClick={() => startEdit(msg._id, msg.suggestedReply ?? "")}
                    className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs font-medium text-(--color-foreground) transition-colors hover:bg-(--color-muted)"
                  >
                    ✎ Modifier
                  </button>
                  <button
                    onClick={() => handleReject(msg._id)}
                    disabled={actionLoading === `reject-${msg._id}`}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {actionLoading === `reject-${msg._id}` ? "Rejet…" : "✕ Rejeter"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
