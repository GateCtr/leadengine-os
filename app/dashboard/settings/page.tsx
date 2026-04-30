"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

// ─── Shared helpers ──────────────────────────────────────────────────────────

type SettingsTab = "products" | "prompts" | "upsell" | "testimonials";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "products", label: "Produits" },
  { key: "prompts", label: "Prompts" },
  { key: "upsell", label: "Upsell Rules" },
  { key: "testimonials", label: "Témoignages" },
];

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-12 text-(--color-muted-foreground)">
      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Chargement…
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-muted) px-6 py-12 text-center">
      <p className="text-(--color-muted-foreground)">{message}</p>
    </div>
  );
}

function ActiveToggle({
  isActive,
  loading,
  onToggle,
}: {
  isActive: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
        isActive ? "bg-green-500" : "bg-gray-300"
      }`}
      aria-label={isActive ? "Désactiver" : "Activer"}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          isActive ? "translate-x-4.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border border-(--color-border)"
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}

const inputClass =
  "w-full rounded-md border border-(--color-border) bg-(--color-background) px-3 py-1.5 text-sm text-(--color-foreground) placeholder:text-(--color-muted-foreground) focus:border-(--color-primary) focus:outline-none focus:ring-1 focus:ring-(--color-primary)";

const labelClass = "mb-1 block text-xs font-medium text-(--color-muted-foreground)";

const btnPrimary =
  "rounded-md bg-(--color-primary) px-3 py-1.5 text-xs font-medium text-(--color-primary-foreground) transition-colors hover:opacity-90 disabled:opacity-50";

const btnSecondary =
  "rounded-md border border-(--color-border) px-3 py-1.5 text-xs font-medium text-(--color-foreground) transition-colors hover:bg-(--color-muted) disabled:opacity-50";


// ─── Products Tab ────────────────────────────────────────────────────────────

function ProductsTab() {
  const products = useQuery(api.settings.listProducts);
  const createProduct = useMutation(api.settings.createProduct);
  const updateProduct = useMutation(api.settings.updateProduct);
  const toggleActive = useMutation(api.settings.toggleProductActive);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);

  const emptyProduct = {
    slug: "",
    name: "",
    senderEmail: "",
    replyToEmail: "",
    templateId: "",
    brandColor: "#000000",
    logoUrl: "",
    landingPageBaseUrl: "",
    uspDescription: "",
    isActive: true,
  };

  const [editForm, setEditForm] = useState(emptyProduct);

  function startCreate() {
    setCreating(true);
    setExpandedId(null);
    setEditForm(emptyProduct);
  }

  function startEdit(product: NonNullable<typeof products>[number]) {
    setCreating(false);
    setExpandedId(product._id);
    setEditForm({
      slug: product.slug,
      name: product.name,
      senderEmail: product.senderEmail,
      replyToEmail: product.replyToEmail,
      templateId: product.templateId,
      brandColor: product.brandColor,
      logoUrl: product.logoUrl,
      landingPageBaseUrl: product.landingPageBaseUrl,
      uspDescription: product.uspDescription ?? "",
      isActive: product.isActive,
    });
  }

  function cancel() {
    setCreating(false);
    setExpandedId(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (creating) {
        await createProduct(editForm);
        setCreating(false);
      } else if (expandedId) {
        await updateProduct({
          id: expandedId as Id<"products">,
          ...editForm,
        });
        setExpandedId(null);
      }
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: Id<"products">) {
    setToggleLoading(id);
    try {
      await toggleActive({ id });
    } catch (e) {
      console.error("Toggle failed:", e);
    } finally {
      setToggleLoading(null);
    }
  }

  function ProductForm() {
    return (
      <div className="grid grid-cols-2 gap-3 border-t border-(--color-border) bg-(--color-muted)/30 p-4">
        <div>
          <label className={labelClass}>Slug</label>
          <input className={inputClass} value={editForm.slug} onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })} placeholder="piksend" />
        </div>
        <div>
          <label className={labelClass}>Nom</label>
          <input className={inputClass} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Piksend" />
        </div>
        <div>
          <label className={labelClass}>Email expéditeur</label>
          <input className={inputClass} value={editForm.senderEmail} onChange={(e) => setEditForm({ ...editForm, senderEmail: e.target.value })} placeholder="hello@piksend.com" />
        </div>
        <div>
          <label className={labelClass}>Email réponse</label>
          <input className={inputClass} value={editForm.replyToEmail} onChange={(e) => setEditForm({ ...editForm, replyToEmail: e.target.value })} placeholder="support@piksend.com" />
        </div>
        <div>
          <label className={labelClass}>Template ID</label>
          <input className={inputClass} value={editForm.templateId} onChange={(e) => setEditForm({ ...editForm, templateId: e.target.value })} placeholder="piksend-outreach" />
        </div>
        <div>
          <label className={labelClass}>Couleur marque</label>
          <div className="flex items-center gap-2">
            <input type="color" value={editForm.brandColor} onChange={(e) => setEditForm({ ...editForm, brandColor: e.target.value })} className="h-8 w-8 cursor-pointer rounded border border-(--color-border)" />
            <input className={inputClass} value={editForm.brandColor} onChange={(e) => setEditForm({ ...editForm, brandColor: e.target.value })} placeholder="#FF6B35" />
          </div>
        </div>
        <div>
          <label className={labelClass}>Logo URL</label>
          <input className={inputClass} value={editForm.logoUrl} onChange={(e) => setEditForm({ ...editForm, logoUrl: e.target.value })} placeholder="https://cdn.example.com/logo.svg" />
        </div>
        <div>
          <label className={labelClass}>Landing page base URL</label>
          <input className={inputClass} value={editForm.landingPageBaseUrl} onChange={(e) => setEditForm({ ...editForm, landingPageBaseUrl: e.target.value })} placeholder="https://piksend.com/lp" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Description USP</label>
          <textarea className={`${inputClass} min-h-16 resize-y`} value={editForm.uspDescription} onChange={(e) => setEditForm({ ...editForm, uspDescription: e.target.value })} placeholder="Description de la proposition de valeur…" rows={2} />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <button className={btnSecondary} onClick={cancel}>Annuler</button>
          <button className={btnPrimary} onClick={handleSave} disabled={saving || !editForm.slug || !editForm.name}>
            {saving ? "Enregistrement…" : creating ? "Créer" : "Enregistrer"}
          </button>
        </div>
      </div>
    );
  }

  if (products === undefined) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-muted-foreground)">{products.length} produit(s) configuré(s)</p>
        <button className={btnPrimary} onClick={startCreate}>+ Nouveau produit</button>
      </div>

      {creating && (
        <div className="mb-4 rounded-lg border border-(--color-border) bg-(--color-background) overflow-hidden">
          <div className="px-4 py-3 text-sm font-medium">Nouveau produit</div>
          <ProductForm />
        </div>
      )}

      {products.length === 0 && !creating ? (
        <EmptyState message="Aucun produit configuré." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--color-border)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-muted)">
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Slug</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Nom</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Email</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Couleur</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Actif</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p._id} className="border-b border-(--color-border) last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs">{p.slug}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-(--color-muted-foreground)">{p.senderEmail}</td>
                  <td className="px-4 py-3"><ColorDot color={p.brandColor} /></td>
                  <td className="px-4 py-3">
                    <ActiveToggle isActive={p.isActive} loading={toggleLoading === p._id} onToggle={() => handleToggle(p._id)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="text-xs text-(--color-primary) hover:underline"
                      onClick={() => expandedId === p._id ? cancel() : startEdit(p)}
                    >
                      {expandedId === p._id ? "Fermer" : "Modifier"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expandedId && <ProductForm />}
        </div>
      )}
    </div>
  );
}


// ─── Prompts Tab ─────────────────────────────────────────────────────────────

const AGENT_TYPES = ["radar", "qualifier", "copywriter", "objector", "timing", "analyst"] as const;
type AgentType = (typeof AGENT_TYPES)[number];

const AGENT_LABELS: Record<AgentType, string> = {
  radar: "Radar",
  qualifier: "Qualificateur",
  copywriter: "Copywriter",
  objector: "Objector",
  timing: "Timing",
  analyst: "Analyste",
};

function PromptsTab() {
  const configs = useQuery(api.settings.listPromptConfigs);
  const createConfig = useMutation(api.settings.createPromptConfig);
  const updateConfig = useMutation(api.settings.updatePromptConfig);
  const toggleActive = useMutation(api.settings.togglePromptConfigActive);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);

  const emptyConfig = {
    agentType: "copywriter" as AgentType,
    productId: "",
    promptTemplate: "",
    version: 1,
    isActive: true,
    keywords: "",
    uspDescription: "",
  };

  const [editForm, setEditForm] = useState(emptyConfig);

  function startCreate() {
    setCreating(true);
    setExpandedId(null);
    setEditForm(emptyConfig);
  }

  function startEdit(config: NonNullable<typeof configs>[number]) {
    setCreating(false);
    setExpandedId(config._id);
    setEditForm({
      agentType: config.agentType as AgentType,
      productId: config.productId ?? "",
      promptTemplate: config.promptTemplate,
      version: config.version,
      isActive: config.isActive,
      keywords: config.keywords?.join(", ") ?? "",
      uspDescription: config.uspDescription ?? "",
    });
  }

  function cancel() {
    setCreating(false);
    setExpandedId(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const keywords = editForm.keywords
        ? editForm.keywords.split(",").map((k) => k.trim()).filter(Boolean)
        : undefined;

      if (creating) {
        await createConfig({
          agentType: editForm.agentType,
          productId: editForm.productId || undefined,
          promptTemplate: editForm.promptTemplate,
          version: editForm.version,
          isActive: editForm.isActive,
          keywords,
          uspDescription: editForm.uspDescription || undefined,
        });
        setCreating(false);
      } else if (expandedId) {
        await updateConfig({
          id: expandedId as Id<"prompt_configs">,
          agentType: editForm.agentType,
          productId: editForm.productId || undefined,
          promptTemplate: editForm.promptTemplate,
          version: editForm.version,
          isActive: editForm.isActive,
          keywords,
          uspDescription: editForm.uspDescription || undefined,
        });
        setExpandedId(null);
      }
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: Id<"prompt_configs">) {
    setToggleLoading(id);
    try {
      await toggleActive({ id });
    } catch (e) {
      console.error("Toggle failed:", e);
    } finally {
      setToggleLoading(null);
    }
  }

  function PromptForm() {
    return (
      <div className="grid grid-cols-2 gap-3 border-t border-(--color-border) bg-(--color-muted)/30 p-4">
        <div>
          <label className={labelClass}>Type d&apos;agent</label>
          <select className={inputClass} value={editForm.agentType} onChange={(e) => setEditForm({ ...editForm, agentType: e.target.value as AgentType })}>
            {AGENT_TYPES.map((t) => (
              <option key={t} value={t}>{AGENT_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Produit (slug)</label>
          <input className={inputClass} value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value })} placeholder="piksend (optionnel)" />
        </div>
        <div>
          <label className={labelClass}>Version</label>
          <input type="number" className={inputClass} value={editForm.version} onChange={(e) => setEditForm({ ...editForm, version: Number(e.target.value) })} min={1} />
        </div>
        <div>
          <label className={labelClass}>Mots-clés (séparés par virgule)</label>
          <input className={inputClass} value={editForm.keywords} onChange={(e) => setEditForm({ ...editForm, keywords: e.target.value })} placeholder="saas, api, cloud" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Template du prompt</label>
          <textarea className={`${inputClass} min-h-32 resize-y font-mono text-xs`} value={editForm.promptTemplate} onChange={(e) => setEditForm({ ...editForm, promptTemplate: e.target.value })} rows={6} placeholder="Vous êtes un agent spécialisé…" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Description USP</label>
          <textarea className={`${inputClass} min-h-16 resize-y`} value={editForm.uspDescription} onChange={(e) => setEditForm({ ...editForm, uspDescription: e.target.value })} rows={2} placeholder="Description USP optionnelle…" />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <button className={btnSecondary} onClick={cancel}>Annuler</button>
          <button className={btnPrimary} onClick={handleSave} disabled={saving || !editForm.promptTemplate}>
            {saving ? "Enregistrement…" : creating ? "Créer" : "Enregistrer"}
          </button>
        </div>
      </div>
    );
  }

  if (configs === undefined) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-muted-foreground)">{configs.length} configuration(s) de prompt</p>
        <button className={btnPrimary} onClick={startCreate}>+ Nouveau prompt</button>
      </div>

      {creating && (
        <div className="mb-4 rounded-lg border border-(--color-border) bg-(--color-background) overflow-hidden">
          <div className="px-4 py-3 text-sm font-medium">Nouvelle configuration de prompt</div>
          <PromptForm />
        </div>
      )}

      {configs.length === 0 && !creating ? (
        <EmptyState message="Aucune configuration de prompt." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--color-border)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-muted)">
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Agent</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Produit</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Version</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Score perf.</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Actif</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)"></th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c._id} className="border-b border-(--color-border) last:border-b-0">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-(--color-primary)/10 px-2 py-0.5 text-xs font-medium text-(--color-primary)">
                      {AGENT_LABELS[c.agentType as AgentType] ?? c.agentType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-(--color-muted-foreground)">{c.productName ?? c.productId ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">v{c.version}</td>
                  <td className="px-4 py-3">
                    {c.performanceScore != null ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        c.performanceScore >= 70 ? "bg-green-100 text-green-700" : c.performanceScore >= 40 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                      }`}>
                        {c.performanceScore}%
                      </span>
                    ) : (
                      <span className="text-xs text-(--color-muted-foreground)">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ActiveToggle isActive={c.isActive} loading={toggleLoading === c._id} onToggle={() => handleToggle(c._id)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="text-xs text-(--color-primary) hover:underline"
                      onClick={() => expandedId === c._id ? cancel() : startEdit(c)}
                    >
                      {expandedId === c._id ? "Fermer" : "Modifier"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expandedId && <PromptForm />}
        </div>
      )}
    </div>
  );
}


// ─── Upsell Rules Tab ────────────────────────────────────────────────────────

function UpsellRulesTab() {
  const rules = useQuery(api.settings.listUpsellRules);
  const createRule = useMutation(api.settings.createUpsellRule);
  const updateRule = useMutation(api.settings.updateUpsellRule);
  const toggleActive = useMutation(api.settings.toggleUpsellRuleActive);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);

  const emptyRule = {
    sourceProductSlug: "",
    signal: "",
    targetProductSlug: "",
    description: "",
    isActive: true,
  };

  const [editForm, setEditForm] = useState(emptyRule);

  function startCreate() {
    setCreating(true);
    setExpandedId(null);
    setEditForm(emptyRule);
  }

  function startEdit(rule: NonNullable<typeof rules>[number]) {
    setCreating(false);
    setExpandedId(rule._id);
    setEditForm({
      sourceProductSlug: rule.sourceProductSlug,
      signal: rule.signal,
      targetProductSlug: rule.targetProductSlug,
      description: rule.description ?? "",
      isActive: rule.isActive,
    });
  }

  function cancel() {
    setCreating(false);
    setExpandedId(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (creating) {
        await createRule({
          ...editForm,
          description: editForm.description || undefined,
        });
        setCreating(false);
      } else if (expandedId) {
        await updateRule({
          id: expandedId as Id<"upsell_rules">,
          ...editForm,
          description: editForm.description || undefined,
        });
        setExpandedId(null);
      }
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: Id<"upsell_rules">) {
    setToggleLoading(id);
    try {
      await toggleActive({ id });
    } catch (e) {
      console.error("Toggle failed:", e);
    } finally {
      setToggleLoading(null);
    }
  }

  function RuleForm() {
    return (
      <div className="grid grid-cols-2 gap-3 border-t border-(--color-border) bg-(--color-muted)/30 p-4">
        <div>
          <label className={labelClass}>Produit source (slug)</label>
          <input className={inputClass} value={editForm.sourceProductSlug} onChange={(e) => setEditForm({ ...editForm, sourceProductSlug: e.target.value })} placeholder="piksend" />
        </div>
        <div>
          <label className={labelClass}>Produit cible (slug)</label>
          <input className={inputClass} value={editForm.targetProductSlug} onChange={(e) => setEditForm({ ...editForm, targetProductSlug: e.target.value })} placeholder="gatectr" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Signal déclencheur</label>
          <input className={inputClass} value={editForm.signal} onChange={(e) => setEditForm({ ...editForm, signal: e.target.value })} placeholder="api_intensive_usage" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Description</label>
          <textarea className={`${inputClass} min-h-16 resize-y`} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} placeholder="Description de la règle d'upsell…" />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <button className={btnSecondary} onClick={cancel}>Annuler</button>
          <button className={btnPrimary} onClick={handleSave} disabled={saving || !editForm.sourceProductSlug || !editForm.targetProductSlug || !editForm.signal}>
            {saving ? "Enregistrement…" : creating ? "Créer" : "Enregistrer"}
          </button>
        </div>
      </div>
    );
  }

  if (rules === undefined) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-muted-foreground)">{rules.length} règle(s) d&apos;upsell</p>
        <button className={btnPrimary} onClick={startCreate}>+ Nouvelle règle</button>
      </div>

      {creating && (
        <div className="mb-4 rounded-lg border border-(--color-border) bg-(--color-background) overflow-hidden">
          <div className="px-4 py-3 text-sm font-medium">Nouvelle règle d&apos;upsell</div>
          <RuleForm />
        </div>
      )}

      {rules.length === 0 && !creating ? (
        <EmptyState message="Aucune règle d'upsell configurée." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--color-border)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-muted)">
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Source → Cible</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Signal</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)">Actif</th>
                <th className="px-4 py-3 font-medium text-(--color-muted-foreground)"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r._id} className="border-b border-(--color-border) last:border-b-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.sourceProductName ?? r.sourceProductSlug}</span>
                    <span className="mx-2 text-(--color-muted-foreground)">→</span>
                    <span className="font-medium">{r.targetProductName ?? r.targetProductSlug}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                      {r.signal}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ActiveToggle isActive={r.isActive} loading={toggleLoading === r._id} onToggle={() => handleToggle(r._id)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="text-xs text-(--color-primary) hover:underline"
                      onClick={() => expandedId === r._id ? cancel() : startEdit(r)}
                    >
                      {expandedId === r._id ? "Fermer" : "Modifier"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expandedId && <RuleForm />}
        </div>
      )}
    </div>
  );
}


// ─── Testimonials Tab (preserved from original) ─────────────────────────────

function ProductBadge({ name }: { name?: string }) {
  if (!name) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-(--color-primary)/10 px-2 py-0.5 text-xs font-medium text-(--color-primary)">
      {name}
    </span>
  );
}

function StatusBadge({ isValidated }: { isValidated: boolean }) {
  return isValidated ? (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
      ✓ Validé
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
      En attente
    </span>
  );
}

type FilterStatus = "all" | "pending" | "validated";

function TestimonialsTab() {
  const testimonials = useQuery(api.testimonials.listAllTestimonials);
  const validateTestimonial = useMutation(api.testimonials.validateTestimonial);
  const rejectTestimonial = useMutation(api.testimonials.rejectTestimonial);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");

  async function handleValidate(testimonialId: Id<"testimonials">) {
    setActionLoading(`validate-${testimonialId}`);
    try {
      await validateTestimonial({ testimonialId });
    } catch (error) {
      console.error("Failed to validate testimonial:", error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(testimonialId: Id<"testimonials">) {
    setActionLoading(`reject-${testimonialId}`);
    try {
      await rejectTestimonial({ testimonialId });
    } catch (error) {
      console.error("Failed to reject testimonial:", error);
    } finally {
      setActionLoading(null);
    }
  }

  const filteredTestimonials = testimonials?.filter((t) => {
    if (filter === "pending") return !t.isValidated;
    if (filter === "validated") return t.isValidated;
    return true;
  });

  const pendingCount = testimonials?.filter((t) => !t.isValidated).length ?? 0;
  const validatedCount = testimonials?.filter((t) => t.isValidated).length ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-muted-foreground)">
          Validez les témoignages clients pour les rendre disponibles dans les messages sortants.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-(--color-muted-foreground)">
            {pendingCount} en attente · {validatedCount} validés
          </span>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {(["all", "pending", "validated"] as FilterStatus[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f
                ? "bg-(--color-primary) text-(--color-primary-foreground)"
                : "border border-(--color-border) text-(--color-foreground) hover:bg-(--color-muted)"
            }`}
          >
            {f === "all" ? "Tous" : f === "pending" ? "En attente" : "Validés"}
          </button>
        ))}
      </div>

      {testimonials === undefined ? (
        <Spinner />
      ) : filteredTestimonials && filteredTestimonials.length === 0 ? (
        <EmptyState
          message={
            filter === "pending"
              ? "Aucun témoignage en attente de validation."
              : filter === "validated"
                ? "Aucun témoignage validé."
                : "Aucun témoignage reçu."
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredTestimonials?.map((t) => (
            <div
              key={t._id}
              className="rounded-lg border border-(--color-border) bg-(--color-background) p-4 transition-shadow hover:shadow-sm"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge isValidated={t.isValidated} />
                <ProductBadge name={t.productName} />
                <span className="text-xs text-(--color-muted-foreground)">
                  {formatDate(t.createdAt)}
                </span>
              </div>

              <blockquote className="my-2 whitespace-pre-wrap rounded-md bg-(--color-muted) p-3 text-sm italic text-(--color-foreground)">
                &ldquo;{t.content}&rdquo;
              </blockquote>

              <div className="flex items-center justify-between">
                <div className="text-sm text-(--color-muted-foreground)">
                  {t.authorName && (
                    <span className="font-medium text-(--color-foreground)">
                      {t.authorName}
                    </span>
                  )}
                  {t.authorName && t.leadEmail && " · "}
                  {t.leadEmail && <span>{t.leadEmail}</span>}
                </div>

                {!t.isValidated && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleValidate(t._id)}
                      disabled={actionLoading === `validate-${t._id}`}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionLoading === `validate-${t._id}` ? "Validation…" : "✓ Valider"}
                    </button>
                    <button
                      onClick={() => handleReject(t._id)}
                      disabled={actionLoading === `reject-${t._id}`}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      {actionLoading === `reject-${t._id}` ? "Suppression…" : "✕ Rejeter"}
                    </button>
                  </div>
                )}

                {t.isValidated && t.validatedAt && (
                  <span className="text-xs text-(--color-muted-foreground)">
                    Validé le {formatDate(t.validatedAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Seed Button ─────────────────────────────────────────────────────────────

function SeedButton() {
  const runSeed = useMutation(api.settings.runSeed);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ productsCreated: number; rulesCreated: number; promptsCreated: number } | null>(null);

  async function handleSeed() {
    setLoading(true);
    setResult(null);
    try {
      const res = await runSeed();
      setResult(res);
    } catch (e) {
      console.error("Seed failed:", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className={btnPrimary} onClick={handleSeed} disabled={loading}>
        {loading ? "Initialisation…" : "Initialiser les données"}
      </button>
      {result && (
        <span className="text-xs text-(--color-muted-foreground)">
          {result.productsCreated} produit(s) + {result.rulesCreated} règle(s) + {result.promptsCreated} prompt(s) créé(s)
          {result.productsCreated === 0 && result.rulesCreated === 0 && result.promptsCreated === 0 && " (déjà initialisé)"}
        </span>
      )}
    </div>
  );
}

// ─── Main Settings Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("products");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Paramètres</h1>
          <p className="mt-1 text-sm text-(--color-muted-foreground)">
            Configuration du système LeadEngine OS.
          </p>
        </div>
        <SeedButton />
      </div>

      <div className="mb-6 flex gap-1 border-b border-(--color-border)">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-(--color-primary) text-(--color-primary)"
                : "text-(--color-muted-foreground) hover:text-(--color-foreground)"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "products" && <ProductsTab />}
      {activeTab === "prompts" && <PromptsTab />}
      {activeTab === "upsell" && <UpsellRulesTab />}
      {activeTab === "testimonials" && <TestimonialsTab />}
    </div>
  );
}
