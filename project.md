⬡
LeadEngine OS
Architecture d'Orchestration de Croissance Agentique

FICHE TECHNIQUE COMPLÈTE — v2.0
Système distribué • Event-Driven • Human-in-the-Loop
Ryan Sabowa  ·  2026
 
 
Vue d'ensemble


LeadEngine OS est un système distribué event-driven piloté par 6 agents IA spécialisés. Il automatise l'intégralité du cycle d'acquisition, de conversion et de rétention de leads — du premier signal détecté sur le web jusqu'au revenu récurrent protégé.

Principe fondateur : Aucun message n'est envoyé sans validation manuelle. Les agents préparent, enrichissent et optimisent. L'humain décide et déclenche l'envoi.

Dimension	Valeur
Architecture	Système distribué event-driven (Convex)
Nombre d'agents	6 agents spécialisés + 1 Channel Router
Sources d'entrée	Web externe (Radar) + Webhooks produits
Canaux de sortie	Email (domaine produit) + DM / Commentaires réseaux sociaux
Produits couverts	Piksend · GateCtr · Joventy · Ryan Sabowa
Modèle de validation	Human-in-the-Loop sur chaque message sortant
Objectif 1 mois	30 à 50 conversations actives + premières ventes

I. Sources d'Entrée


LeadEngine OS dispose de deux portes d'entrée distinctes dans le pipeline, traitées différemment selon la température du lead.

Source	Mécanisme	Type de lead	Passe par le Qualificateur ?
Web externe	Serper.dev — cron job périodique	Froid	Oui — analyse complète
Produit connecté	Webhook entrant (événement produit)	Chaud	Non — direct Copywriter

Payload Webhook (exemple — Piksend)
{
  "product_id":    "piksend",
  "event_type":    "onboarding_abandoned",
  "event_context": "Compte créé, aucune photo uploadée",
  "user_email":    "user@domain.com",
  "user_id":       "usr_xxxxx",
  "timestamp":     "2026-04-25T10:00:00Z"
}

Note : Un lead webhook est qualifié par définition — le produit et le problème sont connus. Il reçoit le score maximum et passe directement à l'Agent Copywriter.

II. Les 6 Agents Spécialisés

Chaque agent est une fonction asynchrone isolée. La communication inter-agents passe exclusivement par la base de données Convex (pas d'appels directs entre agents).

AGENT 01
RADAR
Acquisition	Déclencheur  Cron job périodique
Logique          Requêtes Serper.dev sur mots-clés de douleur utilisateur. Scraping ciblé via Firecrawl.
Sortie             Insertion de leads en base → statut pending_qualification

AGENT 02
QUALIFICATEUR
Filtrage & Scoring	Déclencheur  Nouveau document pending_qualification détecté
Logique          Analyse sémantique LLM — comparaison du problème lead aux USP des 4 produits. Attribution d'un score /100 pondéré (urgence, source, correspondance produit, profil actif).
Sortie             Statut qualified (productId + score) ou discarded

AGENT 03
COPYWRITER
Rédaction	Déclencheur  Lead qualifié sans suggested_reply
Logique          Composition contextuelle. Aucun template figé. Ton adapté : Expert / Support / Tech. Injection automatique de la preuve sociale et du lien contextuel (landing page dédiée).
Sortie             Champ suggested_reply rempli dans la table messages

AGENT 04
OBJECTEUR
Gestion des réponses	Déclencheur  Réponse entrante d'un prospect (email ou réseau social)
Logique          Analyse sémantique de la réponse. Catégorisation automatique : trop cher / besoin de réfléchir / question technique / intérêt confirmé / refus. Suggestion de la meilleure contre-réponse.
Sortie             Statut hot, pending ou archived + réponse suggérée

AGENT 05
TIMING
Optimisation temporelle	Déclencheur  Message prêt pour validation dans le Dashboard
Logique          Analyse de l'heure locale du prospect, du niveau d'activité détecté et du meilleur créneau statistique (mardi-jeudi matin pour le B2B). Ne bloque pas l'envoi — suggère une heure optimale.
Sortie             Champ send_at_suggested rempli + indicateur affiché dans le Dashboard

AGENT 06
ANALYSTE
Optimisation & Feedback	Déclencheur  Données de tracking post-envoi (clics, réponses, conversions Stripe)
Logique          Corrélation message → revenu réel. Attribution multi-touch. A/B testing automatique (2 versions par message, adoption du gagnant à J+14). Proposition de révision des prompts si performance insuffisante.
Sortie             Mise à jour prompt_configs + rapports Dashboard

III. Cycle de Vie Complet d'un Lead


①	INGESTION	Radar détecte un signal web ou webhook produit reçu.
②	ENRICHISSEMENT	Firecrawl scrape le profil public du prospect (LinkedIn, GitHub, site). Données injectées dans le prompt.
③	SCORING	Qualificateur attribue un score /100 et assigne le lead à un produit.
④	RÉDACTION	Copywriter compose la réponse avec preuve sociale et lien contextuel.
⑤	TIMING	Agent Timing suggère l'heure d'envoi optimale.
⑥	VALIDATION ✋	Dashboard : tu valides / modifies / envoies. Aucune action automatique.
⑦	SUIVI SÉQUENCE	Si pas de réponse : relance J+3, J+7, J+14, J+30 — chaque relance validée manuellement.
⑧	GESTION RÉPONSE	Agent Objecteur analyse la réponse et suggère la suite de conversation.
⑨	CONVERSION	Stripe webhook confirme la vente → lead.status = converted + revenue_generated.
⑩	ACTIVATION	Séquence onboarding automatisée J0/J1/J3/J7/J14.
⑪	EXPANSION	Upsell / cross-sell suggéré selon l'usage détecté via webhook produit.
⑫	RÉTENTION	Churn Detector surveille les signaux de désengagement. Alerte Dashboard + message de rétention suggéré.
⑬	OPTIMISATION	Analyste corrèle chaque touchpoint avec le revenu réel. A/B Testing continu.

IV. Channel Router — Canaux de Diffusion


Le Channel Router est le composant entre le Copywriter et le Dashboard. Il identifie par quel canal et sous quelle identité de marque le message doit partir.

Canal Email — Domaine produit

Produit	Expéditeur	Reply-to	Service
Piksend	Piksend <hello@piksend.com>	support@piksend.com	Resend
GateCtr	GateCtr <hello@gatectr.com>	support@gatectr.com	Resend
Joventy	Joventy <hello@joventy.com>	support@joventy.com	Resend
Ryan Sabowa	Ryan Sabowa <contact@ryansabowa.com>	ryan@ryansabowa.com	Resend

Template Email : Le Copywriter génère le corps du texte. Le Channel Router l'injecte dans le template React du produit concerné (couleur de marque, logo, signature). Aperçu visuel complet avant envoi dans le Dashboard.

Canal Social — DM et Commentaires

Plateforme	Mécanisme auth	Limite	Mode d'envoi
Twitter / X	OAuth 2.0 — API v2	50 DMs/jour (plan gratuit)	Lien direct — envoi manuel
LinkedIn	OAuth 2.0 — API officielle	Restrictif	Lien direct — envoi manuel
Reddit	OAuth 2.0 — Reddit API	60 requêtes/min	Lien direct — envoi manuel
Instagram	Meta Graph API	Comptes Business uniquement	Lien direct — envoi manuel

Sécurité plateforme : Pour les réseaux sociaux, le système ne poste jamais seul. Il prépare le message, affiche l'aperçu dans le Dashboard, et fournit un lien direct vers le post ou la conversation. L'envoi reste manuel — risque de bannissement structurellement éliminé.

V. Tunnel de Conversion par Produit


Produits SaaS (Piksend · GateCtr · Joventy)

Étape	Action	Déclencheur
1. Outreach	Message initial avec lien contextuel	Agent Copywriter
2. Landing page	Page dédiée au contexte du lead (pas la homepage)	Channel Router
3. Essai gratuit	Inscription sans CB — 14 jours	Prospect
4. Onboarding J0	Email bienvenue + première action	Stripe webhook
5. Onboarding J1	Vérification de l'activation	Webhook produit
6. Onboarding J7	Invitation au feedback	Séquence auto
7. Upgrade	Message de conversion vers le plan payant	Usage détecté
8. Upsell	Suggestion cross-produit selon l'usage	Churn / usage score

Produit Service (Ryan Sabowa)

Étape	Action	Déclencheur
1. Outreach	Message initial personnalisé	Agent Copywriter
2. Page réservation	Lien Cal.com ou Calendly dédié	Channel Router
3. Call découverte	Appel 30 min — qualification fine	Prospect
4. Devis	Proposition commerciale formalisée	Post-call
5. Paiement	Stripe — paiement unique ou mensuel	Prospect
6. Livraison	Suivi de projet + points étapes	Webhook Stripe

VI. Composants d'Optimisation


Système de Scoring — Priorité des leads

Signal	Poids	Description
Urgence exprimée	+30 pts	"J'ai besoin", "urgent", "bloqué" dans le texte
Source webhook produit	+25 pts	Lead déjà dans l'écosystème — contexte connu
Correspondance produit	+20 pts	Problème aligné précisément avec un USP
Profil actif	+15 pts	Compte existant, activité récente détectée
Signaux contextuels	+10 pts	Profil enrichi, signaux d'engagement

Dashboard : Les leads sont triés par score décroissant. Tu valides les leads à 80+ en priorité. En dessous de 40, le lead est archivé automatiquement sans action requise.

Séquence de Relance

Jour	Type	Angle	Déclencheur
J+0	Message initial	Valeur directe + lien contextuel	Manuel après validation
J+3	Relance 1	Angle différent — preuve sociale / cas d'usage	Pas de réponse
J+7	Relance 2	Question ouverte simple	Pas de réponse
J+14	Email de valeur	Insight utile — aucune vente	Pas de réponse
J+30	Réactivation	"Toujours d'actualité ?"	Pas de réponse
J+31	Archivage	Lead archivé automatiquement	Automatique

A/B Testing Automatique
▸	Le Copywriter génère 2 versions de chaque message (ex : ton Expert vs ton Tech)
▸	L'Analyste track les taux d'ouverture, de clic et de réponse pour chaque version
▸	À J+14 : adoption automatique de la version gagnante comme standard
▸	Aucune intervention manuelle requise — le système apprend seul

Enrichissement Contextuel
▸	Avant rédaction, Firecrawl scrape le profil public du prospect (LinkedIn, GitHub, site personnel)
▸	Les données récupérées sont injectées dans le prompt du Copywriter
▸	Résultat : messages ultra-personnalisés référençant le contexte réel du prospect

VII. Rétention & Expansion


Churn Detector
Surveille en continu les signaux de désengagement via les webhooks produits :

Signal	Seuil	Réaction automatique
Absence de connexion	> 7 jours	Alerte Dashboard priorité haute
Chute d'usage	> 50% en 2 semaines	Message de rétention suggéré
Ticket support ouvert	> 48h sans réponse	Escalade Dashboard + message
Tentative d'annulation	Immédiat	Message de downsell suggéré

Downsell : Plutôt que de perdre totalement un client voulant annuler, le système suggère automatiquement une offre de plan inférieur. Conserver 50% du revenu vaut mieux que zéro.

Upsell / Cross-sell Engine
Tes 4 produits se complètent naturellement. Le système exploite cette synergie :

Produit source	Signal détecté	Suggestion
Piksend	Usage intensif de l'API	GateCtr — optimisation des coûts LLM
GateCtr	Volume d'images traité croissant	Piksend — gestion pro des photos
Ryan Sabowa	Client récurrent — projet récurrent	Joventy — automatisation du workflow
Joventy	Besoin de conseil identifié	Ryan Sabowa — accompagnement dédié

VIII. CRM Unifié & Intelligence Analytique


Fiche Prospect Unifiée
Un même prospect peut apparaître sur plusieurs canaux. Le système l'identifie via email ou identifiant unique et consolide toute l'historique en une fiche unique.

Champ	Description
Première détection	Canal, date, source (Radar ou Webhook)
Score d'entrée	Score /100 calculé lors de la qualification
Historique des contacts	Chaque message envoyé, horodaté, avec canal
Réponses reçues	Catégorisées par l'Agent Objecteur
Statut actuel	pending / qualified / hot / converted / churned
Produit assigné	Produit principal + suggestions cross-sell
Revenu généré	Montant total (Stripe), plan souscrit
Risque churn	Score calculé par le Churn Detector

Attribution Multi-touch
▸	Chaque prospect reçoit un identifiant unique cross-canal dès sa première détection
▸	Chaque point de contact est logué (message envoyé, lien cliqué, email ouvert)
▸	L'Analyste corrèle les touchpoints avec la date de conversion Stripe
▸	Résultat : tu sais exactement quel message, sur quel canal, à quelle étape a déclenché l'achat

Win/Loss Engine
▸	Après conversion : micro-enquête automatique ("qu'est-ce qui t'a convaincu ?")
▸	Après archivage : analyse des patterns de rejet (objections récurrentes, timing, canal)
▸	Ces données alimentent directement les prompts du Qualificateur et du Copywriter
▸	Le système devient plus précis à chaque cycle

Preuve Sociale
▸	Collecte automatique des témoignages via email post-conversion
▸	Les témoignages validés sont injectés dans les prompts du Copywriter
▸	Affichage dynamique sur les landing pages contextuelles selon le produit concerné

IX. Notifications & Alertes Temps Réel


Événement	Priorité	Type d'alerte
Lead score > 85 détecté	Critique	Push mobile immédiat
Réponse reçue dans les 2h post-envoi	Haute	Push mobile immédiat
Lead hot sans action depuis 4h	Haute	Push mobile + bannière Dashboard
Signal churn détecté	Haute	Push mobile + alerte Dashboard
Message non validé depuis 8h	Moyenne	Notification Dashboard
Rapport hebdomadaire Analyste	Info	Email récapitulatif automatique

X. Conformité Légale


Attention : Sans conformité RGPD / CAN-SPAM, un seul signalement de spam suffit à faire blacklister le domaine produit sur Resend. Ce composant est non-négociable.

Obligation	Mécanisme	Statut
Unsubscribe link	Lien de désinscription dans chaque email envoyé	Requis — Resend natif
Liste noire	Opt-out stocké en base — jamais recontacté	Requis — automatique
Rétention des données	Leads archivés supprimés après 12 mois	Requis — cron job
Consentement tracé	Source du lead + date + canal logués à l'insertion	Requis — schema
Droit à l'effacement	Suppression complète sur demande en 1 clic	Requis — Dashboard

XI. Stack Technique Complète


Composant	Technologie	Rôle
Backend / DB	Convex	Orchestration temps réel, persistance, cron jobs
IA / LLM	Anthropic (Vercel AI SDK)	Cerveau des 6 agents
Ingestion web	Serper.dev + Firecrawl	Détection leads + enrichissement profil
Email	Resend + Templates React	Envoi depuis domaine produit, délivrabilité
Paiements	Stripe + Webhooks	Conversion, revenus, onboarding post-achat
Dashboard	Next.js 14 + Tailwind CSS	Interface de validation humaine
Notifications	Push API + Novu	Alertes temps réel mobile et web
Hébergement	Vercel	Fonctions serverless, déploiement continu
Auth Dashboard	Clerk	Accès sécurisé à l'interface
Tracking liens	Custom short URLs + Convex	Suivi comportemental post-envoi

XII. Roadmap — Objectif 1 Mois


Semaine	Livrables	Résultat attendu
Semaine 1	schema.ts Convex · Agent Radar · Agent Qualificateur · Scoring	Pipeline de leads qualifiés et triés opérationnel
Semaine 2	Agent Copywriter · Channel Router · Dashboard · Validation	Premiers messages envoyés depuis les domaines produits
Semaine 3	Agent Timing · Sequence Engine · Agent Objecteur · Notifications	Relances automatiques + gestion des réponses
Semaine 4	Agent Analyste · A/B Testing · Stripe · Churn Detector · RGPD	Système auto-apprenant + revenus trackés

Objectif réaliste semaine 4 : Avec 10 à 15 leads qualifiés validés par jour sur 4 produits, l'objectif est d'atteindre 30 à 50 conversations actives à J+30, avec un taux de conversion dépendant de la qualité de l'offre — pas de la disponibilité humaine.

XIII. Propriétés Architecturales


Propriété	Description
Découplage	Chaque agent est indépendant. Un prompt défaillant sur le Copywriter n'affecte ni le Radar ni le Qualificateur. Correction isolée sans refonte.
Observabilité	Convex trace exactement à quelle étape un lead est bloqué dans le pipeline. Debugging en temps réel depuis le Dashboard.
Sécurité	Aucun message automatique. Chaque action sortante passe par validation humaine. Risque de bannissement structurellement éliminé.
Scalabilité	Chaque agent peut être remplacé, amélioré ou dupliqué en isolation. L'ajout d'un nouveau produit ne nécessite qu'un nouveau prompt_config.
Auto-optimisation	L'Analyste améliore continuellement les prompts basé sur les données de conversion réelles. Le système devient plus précis à chaque cycle.

Prochaine étape
Définir le schema.ts Convex pour que les données
des 6 agents circulent proprement entre les tables :
leads · messages · sequences · channels · prompt_configs · analytics · prospects

