# Plan d'Implémentation : LeadEngine OS

## Vue d'ensemble

Ce plan d'implémentation suit la roadmap de 4 semaines définie dans le document de projet. Chaque tâche est incrémentale, construit sur les précédentes, et se termine par un câblage complet. Les tests property-based valident les 27 propriétés de correction définies dans le design. Le stack technique est TypeScript end-to-end : Convex (backend/DB), Next.js 16+ (Dashboard), Vitest + fast-check (tests).

## Tâches

### Semaine 1 — Fondations : Schéma Convex, Agent Radar, Agent Qualificateur, Scoring

- [x] 1. Initialiser le projet et le schéma Convex
  - [x] 1.1 Configurer le projet Convex et les dépendances
    - Initialiser Convex dans le projet (`npx convex init` si pas déjà fait)
    - Installer les dépendances : `convex`, `@ai-sdk/anthropic`, `ai`, `zod`, `fast-check`, `vitest`
    - Configurer Vitest pour le projet (vitest.config.ts)
    - Créer la structure de dossiers : `convex/agents/`, `convex/engine/`, `convex/integrations/`, `convex/router/`, `convex/tracking/`, `test/`, `test/arbitraries/`
    - _Requirements: 20.1, 20.4_

  - [x] 1.2 Implémenter le schéma Convex complet (`convex/schema.ts`)
    - Définir toutes les tables : `products`, `upsell_rules`, `leads`, `messages`, `sequences`, `channels`, `prompt_configs`, `analytics`, `tracking_events`, `short_urls`, `blacklist`, `testimonials`, `notifications`, `agent_logs`, `webhook_events`
    - Implémenter tous les index définis dans le design (by_email, by_status, by_slug, etc.)
    - Valider les unions de types pour les statuts (leads.status, messages.validationStatus, etc.)
    - _Requirements: 20.1, 20.2, 15.2_

  - [ ]* 1.3 Écrire le test property-based pour la validité des statuts de lead
    - **Property 27 : Lead a toujours un statut de pipeline valide**
    - Vérifier que tout lead généré aléatoirement a un statut parmi les 8 valeurs autorisées
    - **Validates: Requirements 20.2**

  - [x] 1.4 Créer les générateurs custom fast-check (arbitraries)
    - Implémenter `test/arbitraries/lead.ts` : `arbitraryLead`, `arbitraryLeadStatus`, `arbitraryScoringBreakdown`, `arbitraryWebhookPayload`
    - Implémenter `test/arbitraries/product.ts` : `arbitraryProduct`, `arbitraryProductId`
    - Implémenter `test/arbitraries/message.ts` : `arbitraryMessage`
    - Ces générateurs seront utilisés par tous les tests PBT du projet
    - _Requirements: 20.1_

  - [x] 1.5 Créer le seed de données initiales pour la table `products`
    - Écrire une mutation Convex de seed pour insérer les 4 produits (Piksend, GateCtr, Joventy, Ryan Sabowa) avec leurs configurations complètes (senderEmail, replyToEmail, templateId, brandColor, logoUrl, landingPageBaseUrl, uspDescription)
    - Écrire une mutation de seed pour les `upsell_rules` initiales (4 règles cross-sell définies dans le design)
    - _Requirements: 6.3, 13.1, 13.2, 13.3, 13.4, 20.5_

  - [x] 1.6 Implémenter le système de journalisation des agents (`convex/logs.ts`)
    - Créer la mutation `createLog` pour insérer dans `agent_logs`
    - Supporter les niveaux `info`, `warn`, `error` et tous les types d'agents
    - _Requirements: 20.2, 20.3_

- [x] 2. Checkpoint — Vérifier que le schéma Convex se déploie correctement
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implémenter l'Agent Radar (Acquisition Web)
  - [x] 3.1 Créer l'intégration Serper.dev (`convex/integrations/serper.ts`)
    - Implémenter la fonction d'appel API Serper.dev avec les paramètres de recherche (q, num, gl, hl)
    - Parser les résultats de recherche en leads candidats
    - Gérer les erreurs API (timeout, rate limit, réponse invalide)
    - _Requirements: 1.1, 1.4_

  - [x] 3.2 Implémenter l'Agent Radar (`convex/agents/radar.ts`)
    - Créer l'action `runRadarScan` : charger les mots-clés depuis `prompt_configs`, exécuter les requêtes Serper.dev, dédupliquer par email, insérer les leads en base avec statut `pending_qualification`
    - Stocker source ("radar"), detectedAt, detectionChannel, consentSource et consentDate pour chaque lead créé
    - Implémenter la déduplification par vérification de l'email existant en base avant insertion
    - Journaliser les erreurs via `createLog`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 17.3_

  - [x] 3.3 Enregistrer le cron job Radar dans `convex/crons.ts`
    - Configurer le cron job périodique (toutes les 2 heures) pour `runRadarScan`
    - _Requirements: 1.1_

  - [ ]* 3.4 Écrire le test property-based pour la complétude de création de lead Radar
    - **Property 1 : Complétude de création de lead par le Radar**
    - Vérifier que tout lead créé par le Radar a le statut `pending_qualification` et contient les champs obligatoires (source="radar", detectedAt, detectionChannel, consentSource, consentDate)
    - **Validates: Requirements 1.2, 1.3, 17.3**

  - [ ]* 3.5 Écrire le test property-based pour la déduplification cross-canal
    - **Property 2 : Déduplification cross-canal des prospects**
    - Vérifier que pour un ensemble de détections partageant le même email, un seul enregistrement lead existe par email unique
    - **Validates: Requirements 1.5, 15.1, 15.3**

- [x] 4. Implémenter l'ingestion de leads via webhooks produits
  - [x] 4.1 Créer la route HTTP webhook produit (`convex/http.ts`)
    - Implémenter la validation du payload webhook (product_id, event_type, event_context, user_email, timestamp)
    - Charger dynamiquement les slugs de produits actifs depuis la table `products` pour validation
    - Valider l'authenticité du webhook entrant
    - Retourner HTTP 400 pour les payloads invalides avec journalisation de l'erreur
    - Stocker l'événement webhook dans `webhook_events`
    - _Requirements: 2.1, 2.3, 2.4_

  - [x] 4.2 Implémenter la création de lead depuis webhook produit
    - Créer le lead avec statut `qualified`, score maximum (100), et productId correspondant
    - Stocker les champs webhook (webhookEventType, webhookEventContext, webhookUserId)
    - Le lead contourne l'Agent Qualificateur et passe directement au Copywriter
    - Dédupliquer par email (consolider si lead existant)
    - _Requirements: 2.1, 2.2_

  - [ ]* 4.3 Écrire le test property-based pour la création de lead webhook
    - **Property 3 : Création de lead webhook avec statut et routage corrects**
    - Vérifier que tout payload webhook valide crée un lead avec statut `qualified`, score 100, et productId correct
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 4.4 Écrire le test property-based pour le rejet des webhooks invalides
    - **Property 4 : Rejet des webhooks invalides**
    - Vérifier que tout payload incomplet ou invalide est rejeté avec HTTP 400 et qu'aucun lead n'est créé
    - **Validates: Requirements 2.3**

- [x] 5. Implémenter l'enrichissement contextuel (Firecrawl)
  - [x] 5.1 Créer l'intégration Firecrawl (`convex/integrations/firecrawl.ts`)
    - Implémenter l'appel API Firecrawl pour le scraping de profils publics (LinkedIn, GitHub, site personnel)
    - Parser les résultats en structure `enrichmentData` (linkedinUrl, githubUrl, websiteUrl, bio, skills, company, role, scrapedAt)
    - Gérer les erreurs (timeout, profil introuvable) avec 1 retry immédiat
    - _Requirements: 3.1, 3.3_

  - [x] 5.2 Implémenter la logique d'enrichissement dans le pipeline
    - Déclencher le scraping Firecrawl quand un lead atteint `pending_qualification` ou `qualified`
    - Stocker les données enrichies dans le champ `enrichmentData` du lead
    - Continuer le pipeline même si l'enrichissement échoue (fail-safe)
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 5.3 Écrire le test property-based pour le stockage des données d'enrichissement
    - **Property 5 : Stockage des données d'enrichissement Firecrawl**
    - Vérifier que toute réponse Firecrawl valide est correctement stockée dans `enrichmentData` avec les sous-champs appropriés
    - **Validates: Requirements 3.2**

- [x] 6. Implémenter l'Agent Qualificateur (Scoring & Filtrage)
  - [x] 6.1 Implémenter l'Agent Qualificateur (`convex/agents/qualifier.ts`)
    - Créer l'action `qualifyLead` : lire le lead, appeler le LLM Anthropic via Vercel AI SDK pour analyse sémantique
    - Implémenter le calcul de score pondéré /100 avec structured output Zod (urgence ≤30, webhookSource ≤25, productMatch ≤20, activeProfile ≤15, contextSignals ≤10)
    - Comparer le problème du lead aux USP des produits chargés dynamiquement depuis la table `products`
    - Si score ≥ 40 → statut `qualified` + productId assigné ; si score < 40 → statut `discarded`
    - Journaliser les erreurs LLM et conserver le lead en `pending_qualification` pour retraitement
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 6.2 Configurer le trigger réactif pour l'Agent Qualificateur
    - Déclencher `qualifyLead` automatiquement quand un lead passe en `pending_qualification`
    - Utiliser les triggers réactifs Convex (mutation trigger ou scheduled function)
    - _Requirements: 4.1_

  - [ ]* 6.3 Écrire le test property-based pour les bornes du score
    - **Property 6 : Bornes du score de qualification**
    - Vérifier que le score total est entre 0 et 100, chaque composante respecte ses bornes, et la somme des composantes égale le score total
    - **Validates: Requirements 4.2**

  - [ ]* 6.4 Écrire le test property-based pour le seuil de score
    - **Property 7 : Seuil de score détermine le destin du lead**
    - Vérifier que score ≥ 40 → statut `qualified` + productId valide ; score < 40 → statut `discarded` sans productId
    - **Validates: Requirements 4.3, 4.4**

- [x] 7. Checkpoint Semaine 1 — Pipeline de leads qualifiés opérationnel
  - Ensure all tests pass, ask the user if questions arise.
  - Vérifier que le flux complet fonctionne : Radar → Enrichissement → Qualificateur → Lead qualifié/discarded
  - Vérifier que les webhooks produits créent des leads qualifiés directement


### Semaine 2 — Agent Copywriter, Channel Router, Dashboard, Validation HITL

- [x] 8. Implémenter l'Agent Copywriter (Rédaction Contextuelle)
  - [x] 8.1 Implémenter l'Agent Copywriter (`convex/agents/copywriter.ts`)
    - Créer l'action `composeMessage` : charger le lead + données enrichies + prompt_config du produit + témoignages validés
    - Appeler le LLM Anthropic avec ton adapté (Expert/Support/Tech) via structured output Zod
    - Injecter automatiquement la preuve sociale pertinente et le lien contextuel vers la landing page dédiée (chargée depuis `products.landingPageBaseUrl`)
    - Si A/B testing activé → générer 2 versions distinctes (suggestedReply + suggestedReplyB)
    - Stocker le message dans la table `messages` avec validationStatus `draft`
    - Journaliser les erreurs LLM et marquer le lead pour retraitement
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 3.4_

  - [x] 8.2 Configurer le trigger réactif pour l'Agent Copywriter
    - Déclencher `composeMessage` quand un lead qualifié sans `suggested_reply` est détecté
    - Gérer les leads webhook (chauds) qui arrivent directement sans passer par le Qualificateur
    - _Requirements: 5.1, 2.2_

  - [ ]* 8.3 Écrire le test property-based pour la preuve sociale et le lien contextuel
    - **Property 8 : Message contient preuve sociale et lien contextuel**
    - Vérifier que tout message composé contient une référence à la preuve sociale et un lien contextuel vers la landing page du produit assigné
    - **Validates: Requirements 5.3, 3.4**

  - [ ]* 8.4 Écrire le test property-based pour l'A/B testing
    - **Property 9 : A/B testing génère deux versions distinctes**
    - Vérifier que quand l'A/B testing est activé, les deux versions (suggestedReply et suggestedReplyB) sont non-vides et différentes
    - **Validates: Requirements 5.4**

- [x] 9. Implémenter le Channel Router (Routage Canal & Marque)
  - [x] 9.1 Implémenter le Channel Router (`convex/router/channelRouter.ts`)
    - Créer la mutation `routeMessage` : lire le message et le lead associé, charger la config produit depuis la table `products` (lookup par productId/slug)
    - Déterminer le canal (email ou social) selon les données du lead
    - Résoudre l'identité de marque dynamiquement depuis la config produit (senderEmail, replyToEmail, templateId, brandColor, logoUrl)
    - Si email → préparer l'injection dans le template React Email du produit
    - Si social → préparer le lien direct vers la plateforme cible
    - Mettre à jour le message avec canal + identité de marque
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 9.2 Configurer le trigger réactif pour le Channel Router
    - Déclencher `routeMessage` quand un message est composé sans canal assigné
    - _Requirements: 6.1_

  - [ ]* 9.3 Écrire le test property-based pour le routage canal et identité de marque
    - **Property 10 : Routage canal et identité de marque corrects**
    - Vérifier que pour tout message avec un produit assigné, le canal est valide et l'identité de marque correspond à la config du produit dans la table `products`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 20.5**

- [x] 10. Implémenter le Dashboard Next.js — Structure et Authentification
  - [x] 10.1 Initialiser le Dashboard Next.js 16+ avec App Router
    - Configurer Next.js 16+ avec App Router, Tailwind CSS
    - Installer et configurer Clerk v7 (`@clerk/nextjs`)
    - Installer et configurer le client Convex pour Next.js (`convex/react`)
    - Créer le layout principal avec navigation latérale
    - Configurer le middleware Clerk v7 pour protéger les routes `/dashboard/*`
    - _Requirements: 7.6_

  - [x] 10.2 Implémenter les formulaires d'authentification custom Clerk v7
    - Créer la page `/sign-in` avec formulaire custom utilisant le hook `useSignIn` de Clerk v7 (email/password + OAuth)
    - Créer la page `/sign-up` avec formulaire custom utilisant le hook `useSignUp` de Clerk v7
    - Gérer les sessions avec `useSession` — aucun composant pré-construit Clerk
    - Implémenter la gestion d'erreurs et les états de chargement
    - _Requirements: 7.6, 7.7_

- [x] 11. Implémenter le Dashboard — File de Validation HITL
  - [x] 11.1 Créer la page de file de validation (`/dashboard/queue`)
    - Afficher tous les messages en attente de validation (validationStatus = `pending_validation`)
    - Trier les messages par score de lead décroissant
    - Afficher pour chaque message : aperçu du contenu, score du lead, produit assigné, canal, heure d'envoi suggérée
    - Implémenter les actions : Valider, Modifier, Rejeter pour chaque message
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 11.2 Implémenter la logique d'envoi de messages validés
    - Quand l'opérateur valide un message email → envoyer via Resend depuis le domaine du produit assigné
    - Quand l'opérateur valide un message social → afficher le lien direct vers la plateforme cible
    - Mettre à jour le validationStatus à `approved` puis `sent`, enregistrer validatedBy (Clerk userId) et sentAt
    - Interdire tout envoi sans validation humaine préalable
    - _Requirements: 7.3, 7.4, 7.8_

  - [ ]* 11.3 Écrire le test property-based pour le tri par score décroissant
    - **Property 11 : Messages triés par score décroissant dans la file de validation**
    - Vérifier que les messages retournés par la requête Dashboard sont ordonnés par score de lead décroissant
    - **Validates: Requirements 7.1**

  - [ ]* 11.4 Écrire le test property-based pour l'invariant Human-in-the-Loop
    - **Property 12 : Invariant Human-in-the-Loop — Aucun envoi sans validation**
    - Vérifier que tout message avec un `sentAt` défini a un `validationStatus` = `approved` et un `validatedBy` non-null
    - **Validates: Requirements 7.8, 9.6, 10.6, 12.5, 13.5**

- [x] 12. Implémenter l'intégration Resend (Envoi Email)
  - [x] 12.1 Créer l'intégration Resend (`convex/integrations/resend.ts`)
    - Implémenter l'envoi d'email via l'API Resend avec les paramètres : from (domaine produit), to, replyTo, subject, react (template React Email)
    - Inclure automatiquement le lien de désinscription dans chaque email (RGPD/CAN-SPAM)
    - Implémenter le retry avec backoff exponentiel (3 retries)
    - Retourner le messageId Resend pour tracking
    - _Requirements: 7.3, 17.1_

  - [x] 12.2 Créer les templates React Email par produit
    - Implémenter un template React Email paramétrable par produit (couleur de marque, logo, signature)
    - Charger dynamiquement la configuration depuis la table `products`
    - Inclure le lien de désinscription dans le footer de chaque template
    - Générer l'aperçu visuel pour le Dashboard
    - _Requirements: 6.2, 6.5, 17.1_

  - [ ]* 12.3 Écrire le test property-based pour le lien de désinscription
    - **Property 21 : Lien de désinscription dans chaque email**
    - Vérifier que tout email envoyé via Resend contient un lien de désinscription fonctionnel
    - **Validates: Requirements 17.1**

- [x] 13. Checkpoint Semaine 2 — Premiers messages envoyés depuis les domaines produits
  - Ensure all tests pass, ask the user if questions arise.
  - Vérifier le flux complet : Lead qualifié → Copywriter → Channel Router → Dashboard → Validation → Envoi Resend
  - Vérifier l'authentification Clerk v7 custom et la protection des routes

### Semaine 3 — Agent Timing, Sequence Engine, Agent Objecteur, Notifications

- [x] 14. Implémenter l'Agent Timing (Optimisation Horaire)
  - [x] 14.1 Implémenter l'Agent Timing (`convex/agents/timing.ts`)
    - Créer l'action `suggestSendTime` : lire le message et le lead associé, déterminer le fuseau horaire du prospect
    - Analyser le niveau d'activité détecté et appliquer les créneaux statistiques optimaux (mardi-jeudi matin pour B2B)
    - Remplir le champ `sendAtSuggested` du message avec l'heure d'envoi recommandée
    - Ne pas bloquer la possibilité d'envoi immédiat par l'opérateur
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 14.2 Configurer le trigger réactif pour l'Agent Timing
    - Déclencher `suggestSendTime` quand un message est routé sans `sendAtSuggested`
    - Mettre à jour le validationStatus à `pending_validation` après la suggestion de timing
    - _Requirements: 8.1, 8.3_

- [x] 15. Implémenter le Sequence Engine (Moteur de Relance)
  - [x] 15.1 Implémenter le Sequence Engine (`convex/engine/sequenceEngine.ts`)
    - Créer l'action `processSequences` : charger toutes les séquences actives, vérifier si le prochain step est dû
    - Implémenter la séquence de relance outreach : J+0 (initial), J+3 (relance 1 — preuve sociale), J+7 (relance 2 — question ouverte), J+14 (email de valeur), J+30 (réactivation)
    - Implémenter la séquence d'onboarding post-conversion : J0, J1, J3, J7, J14
    - Déclencher l'Agent Copywriter pour la rédaction de chaque relance avec l'angle approprié
    - Archiver automatiquement le lead à J+31 sans réponse
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 15.2 Créer la séquence initiale lors de l'envoi du premier message
    - Quand un message initial est envoyé (validé + sent), créer une séquence de type `outreach` avec les steps définis
    - Calculer les dates de chaque step relatif au message initial
    - _Requirements: 9.1_

  - [x] 15.3 Enregistrer le cron job du Sequence Engine dans `convex/crons.ts`
    - Configurer le cron job périodique (toutes les 6 heures) pour `processSequences`
    - _Requirements: 9.1_

  - [x] 15.4 Soumettre chaque message de relance à la validation HITL
    - Chaque relance générée passe par le même flux : Copywriter → Channel Router → Timing → Dashboard → Validation
    - _Requirements: 9.6_

  - [ ]* 15.5 Écrire le test property-based pour le moteur de séquence
    - **Property 13 : Moteur de séquence déclenche le bon step au bon moment**
    - Vérifier que chaque step est déclenché au jour correct (J+3, J+7, J+14, J+30) et crée un message avec le sequenceStep correspondant
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ]* 15.6 Écrire le test property-based pour l'archivage automatique à J+31
    - **Property 14 : Archivage automatique à J+31**
    - Vérifier que tout lead avec une séquence outreach active dépassant 31 jours sans réponse est archivé et la séquence marquée `completed`
    - **Validates: Requirements 9.5**

- [x] 16. Implémenter l'Agent Objecteur (Gestion des Réponses)
  - [x] 16.1 Implémenter l'Agent Objecteur (`convex/agents/objector.ts`)
    - Créer l'action `analyzeReply` : analyser sémantiquement la réponse du prospect via LLM Anthropic
    - Catégoriser la réponse : `trop_cher`, `besoin_reflexion`, `question_technique`, `interet_confirme`, `refus`
    - Si `interet_confirme` → statut lead `hot`
    - Si `refus` → statut lead `archived`
    - Si `trop_cher`, `besoin_reflexion` ou `question_technique` → statut lead `pending` + génération contre-réponse suggérée
    - Soumettre chaque contre-réponse à la validation HITL
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 16.2 Implémenter la réception des réponses entrantes
    - Créer la route HTTP pour les webhooks Resend (inbound email)
    - Associer la réponse au lead et au message source via l'email du prospect
    - Stocker le contenu de la réponse dans `messages.replyContent` et `replyReceivedAt`
    - Déclencher l'Agent Objecteur automatiquement
    - _Requirements: 10.1_

  - [ ]* 16.3 Écrire le test property-based pour la catégorisation des réponses
    - **Property 15 : Catégorie de réponse détermine la transition de statut du lead**
    - Vérifier que `interet_confirme` → `hot`, `refus` → `archived`, et les 3 autres → `pending` + contre-réponse
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5**

- [x] 17. Implémenter les Notifications temps réel (Novu)
  - [x] 17.1 Créer l'intégration Novu (`convex/integrations/novu.ts`)
    - Configurer le client Novu avec les workflows d'alerte : `critical_lead`, `hot_reply`, `idle_hot_lead`, `churn_signal`, `pending_validation`, `weekly_report`
    - Implémenter l'envoi de notifications push et in-app via Novu
    - Gérer les erreurs avec 2 retries et fallback vers notification en base uniquement
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 17.2 Implémenter les déclencheurs de notifications
    - Lead score > 85 → notification `critical` push immédiat
    - Réponse reçue dans les 2h post-envoi → notification `high` push immédiat
    - Lead `hot` sans action depuis > 4h → notification `high` push + bannière Dashboard
    - Signal churn détecté → notification `high` push + alerte Dashboard
    - Message en attente de validation depuis > 8h → notification `medium` Dashboard
    - Stocker chaque notification dans la table `notifications`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 17.3 Intégrer le composant Novu Inbox dans le Dashboard
    - Ajouter le composant `<Inbox />` de Novu dans le layout principal du Dashboard
    - Afficher les notifications temps réel avec indicateur de non-lues
    - _Requirements: 16.3, 16.5_

  - [ ]* 17.4 Écrire le test property-based pour les seuils de notification
    - **Property 26 : Notifications déclenchées aux seuils de priorité corrects**
    - Vérifier que chaque type d'événement déclenche la notification avec la priorité correcte (critical, high, medium)
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.5**

- [x] 18. Implémenter le Dashboard — Fiche Prospect CRM Unifié
  - [x] 18.1 Créer la page liste des leads (`/dashboard/leads`)
    - Afficher tous les leads avec filtres par statut, produit, score
    - Afficher les colonnes : nom, email, statut, score, produit, date de détection
    - _Requirements: 15.4_

  - [x] 18.2 Créer la page fiche prospect détaillée (`/dashboard/leads/[id]`)
    - Afficher la fiche prospect complète : première détection (canal, date, source), score d'entrée, historique des contacts horodatés avec canal, réponses reçues catégorisées, statut actuel, produit assigné, revenu généré, risque churn
    - Afficher la timeline des interactions
    - _Requirements: 15.2, 15.4_

- [x] 19. Checkpoint Semaine 3 — Relances automatiques + gestion des réponses
  - Ensure all tests pass, ask the user if questions arise.
  - Vérifier le flux de relance : Message envoyé → Pas de réponse → Séquence J+3/J+7/J+14/J+30 → Archivage J+31
  - Vérifier le flux de réponse : Réponse reçue → Objecteur → Catégorisation → Contre-réponse → Validation HITL
  - Vérifier les notifications temps réel dans le Dashboard

### Semaine 4 — Agent Analyste, A/B Testing, Stripe, Churn Detector, RGPD

- [x] 20. Implémenter le Tracking Comportemental (URLs Courtes)
  - [x] 20.1 Implémenter le système d'URLs courtes (`convex/tracking/shortUrls.ts`)
    - Créer la mutation `createTrackedUrl` : générer un code court unique (nanoid), stocker le mapping en base (short_urls), retourner l'URL courte
    - Remplacer chaque URL dans un message par une URL courte trackée, associée au leadId et messageId
    - _Requirements: 18.1_

  - [x] 20.2 Implémenter la route de redirection et tracking (`convex/http.ts`)
    - Créer la route HTTP `/t/:code` : résoudre le code court, vérifier la blacklist du lead, enregistrer le tracking_event (clic, timestamp, lead, message), rediriger vers l'URL originale
    - Exclure les prospects blacklistés de tout tracking
    - _Requirements: 18.2, 18.4_

  - [ ]* 20.3 Écrire le test property-based pour les URLs courtes
    - **Property 24 : URLs courtes générées pour chaque lien dans un message**
    - Vérifier que chaque URL dans un message est remplacée par une URL courte trackée associée au leadId et messageId
    - **Validates: Requirements 18.1**

  - [ ]* 20.4 Écrire le test property-based pour le tracking des clics
    - **Property 25 : Clic sur URL trackée enregistre un événement**
    - Vérifier que chaque clic sur une URL courte crée un tracking_event de type `click` avec les données correctes
    - **Validates: Requirements 18.2**

- [x] 21. Implémenter l'intégration Stripe (Conversion & Revenus)
  - [x] 21.1 Créer la route HTTP webhook Stripe (`convex/http.ts`)
    - Implémenter la validation de la signature Stripe (`stripe.webhooks.constructEvent`)
    - Traiter l'événement `checkout.session.completed` : mettre à jour le statut du lead à `converted`, enregistrer `revenueGenerated` et `convertedAt`
    - Déclencher la création d'une séquence d'onboarding (J0, J1, J3, J7, J14)
    - Journaliser les webhooks sans lead correspondant pour investigation
    - Stocker l'événement dans `webhook_events`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]* 21.2 Écrire le test property-based pour la conversion Stripe
    - **Property 16 : Conversion Stripe met à jour le lead et déclenche l'onboarding**
    - Vérifier que tout webhook Stripe de paiement réussi met à jour le lead à `converted`, enregistre le revenu, et crée une séquence d'onboarding avec les steps corrects
    - **Validates: Requirements 11.1, 11.2**

- [x] 22. Implémenter l'Agent Analyste (Optimisation Continue)
  - [x] 22.1 Implémenter l'Agent Analyste (`convex/agents/analyst.ts`)
    - Créer l'action `analyzePerformance` : charger les tracking_events récents, corréler messages → conversions Stripe via attribution multi-touch
    - Implémenter l'attribution multi-touch : chaque touchpoint reçoit un pourcentage ≥ 0, la somme = 100%
    - Proposer des révisions de prompts si performance insuffisante (mise à jour `prompt_configs`)
    - Générer un rapport hebdomadaire récapitulatif stocké dans `analytics`
    - _Requirements: 14.1, 14.3, 14.4_

  - [x] 22.2 Implémenter l'évaluation A/B testing (`convex/agents/analyst.ts`)
    - Créer l'action `runABTestEvaluation` : charger les A/B tests actifs depuis ≥ 14 jours
    - Comparer les taux d'ouverture, clic et réponse entre versions A et B
    - Adopter automatiquement la version gagnante comme standard
    - Mettre à jour `prompt_configs` avec la version gagnante
    - _Requirements: 14.2_

  - [x] 22.3 Enregistrer les cron jobs de l'Analyste dans `convex/crons.ts`
    - Cron hebdomadaire pour `analyzePerformance` (rapport + optimisation prompts)
    - Cron quotidien pour `runABTestEvaluation` (évaluation A/B tests matures)
    - _Requirements: 14.2, 14.4_

  - [x] 22.4 Implémenter le Win/Loss Engine
    - Déclencher l'envoi d'un email de micro-enquête post-conversion ("qu'est-ce qui t'a convaincu ?")
    - Analyser les patterns de rejet post-archivage (objections récurrentes, timing, canal)
    - Alimenter les prompts du Qualificateur et du Copywriter avec ces données
    - _Requirements: 14.5_

  - [ ]* 22.5 Écrire le test property-based pour l'attribution multi-touch
    - **Property 18 : Attribution multi-touch somme à 100%**
    - Vérifier que pour tout ensemble de touchpoints, les pourcentages d'attribution somment à exactement 100% et chaque pourcentage est ≥ 0
    - **Validates: Requirements 14.1**

  - [ ]* 22.6 Écrire le test property-based pour l'évaluation A/B
    - **Property 19 : Évaluation A/B sélectionne le gagnant correct**
    - Vérifier que pour tout A/B test actif depuis ≥ 14 jours, la version avec le meilleur score combiné est adoptée comme standard
    - **Validates: Requirements 14.2**

- [x] 23. Implémenter le Churn Detector (Détection de Désengagement)
  - [x] 23.1 Implémenter le Churn Detector (`convex/engine/churnDetector.ts`)
    - Créer l'action `detectChurnSignals` : vérifier absence de connexion > 7 jours, chute d'usage > 50% sur 2 semaines, tickets support > 48h sans réponse, tentatives d'annulation
    - Générer les alertes appropriées dans la table `notifications` et le Dashboard
    - Déclencher la génération de messages de rétention ou de downsell suggérés
    - Soumettre chaque message de rétention/downsell à la validation HITL
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 23.2 Enregistrer le cron job du Churn Detector dans `convex/crons.ts`
    - Configurer le cron job périodique (toutes les 6 heures) pour `detectChurnSignals`
    - _Requirements: 12.1_

  - [ ]* 23.3 Écrire le test property-based pour la détection de churn
    - **Property 17 : Détection de churn aux seuils corrects**
    - Vérifier que les alertes sont générées aux bons seuils : > 7 jours sans connexion → alerte haute, chute > 50% → message rétention, ticket > 48h → escalade
    - **Validates: Requirements 12.1, 12.2, 12.3**

- [x] 24. Implémenter l'Upsell Engine (Ventes Croisées)
  - [x] 24.1 Implémenter l'Upsell Engine (`convex/engine/upsellEngine.ts`)
    - Créer l'action `detectUpsellOpportunities` : charger dynamiquement les règles actives depuis la table `upsell_rules`
    - Pour chaque client converti, évaluer les signaux d'usage contre les règles d'upsell
    - Générer des suggestions d'upsell/cross-sell soumises à la validation HITL
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 24.2 Enregistrer le cron job de l'Upsell Engine dans `convex/crons.ts`
    - Configurer le cron job périodique (quotidien) pour `detectUpsellOpportunities`
    - _Requirements: 13.1_

- [x] 25. Implémenter la conformité RGPD et CAN-SPAM
  - [x] 25.1 Implémenter la gestion de la blacklist (`convex/compliance/blacklist.ts`)
    - Créer la mutation `addToBlacklist` : ajouter immédiatement un email à la table `blacklist` lors d'un clic sur le lien de désinscription
    - Créer la query `isBlacklisted` : vérifier si un email est dans la blacklist avant tout envoi
    - Implémenter la vérification blacklist dans le flux d'envoi de messages (fail-safe : si la vérification échoue, bloquer l'envoi)
    - _Requirements: 17.2, 17.6_

  - [x] 25.2 Implémenter la route de désinscription (`convex/http.ts`)
    - Créer la route HTTP pour le lien de désinscription dans les emails
    - Ajouter l'email à la blacklist et cesser tout contact futur
    - Afficher une page de confirmation de désinscription
    - _Requirements: 17.1, 17.2_

  - [x] 25.3 Implémenter le cron job de nettoyage des données (12 mois)
    - Créer l'action `cleanupArchivedLeads` : supprimer les leads archivés depuis plus de 12 mois et toutes leurs données associées (messages, séquences, tracking_events, short_urls)
    - Traitement par lots (batch) pour éviter les timeouts
    - Enregistrer le cron job mensuel dans `convex/crons.ts`
    - _Requirements: 17.4_

  - [x] 25.4 Implémenter le droit à l'effacement (1 clic Dashboard)
    - Créer la mutation `deleteProspectData` : supprimer complètement toutes les données d'un prospect (lead, messages, séquences, tracking_events, short_urls, testimonials, notifications)
    - Ajouter le bouton "Supprimer toutes les données" dans la fiche prospect du Dashboard
    - Opération transactionnelle : tout ou rien
    - _Requirements: 17.5_

  - [ ]* 25.5 Écrire le test property-based pour l'exclusion des prospects blacklistés
    - **Property 20 : Prospects blacklistés exclus de toute activité sortante**
    - Vérifier que tout email dans la blacklist bloque l'envoi de messages ET exclut le prospect du tracking comportemental
    - **Validates: Requirements 17.6, 18.4**

  - [ ]* 25.6 Écrire le test property-based pour la désinscription → blacklist
    - **Property 22 : Désinscription → ajout immédiat à la blacklist**
    - Vérifier que tout clic sur un lien de désinscription ajoute immédiatement l'email à la blacklist
    - **Validates: Requirements 17.2**

  - [ ]* 25.7 Écrire le test property-based pour la suppression des leads archivés
    - **Property 23 : Suppression des leads archivés après 12 mois**
    - Vérifier que tout lead archivé depuis plus de 12 mois est supprimé avec toutes ses données associées
    - **Validates: Requirements 17.4**

- [x] 26. Implémenter la Preuve Sociale et les Témoignages
  - [x] 26.1 Implémenter la collecte de témoignages
    - Déclencher l'envoi d'un email de collecte de témoignage post-conversion via le Sequence Engine
    - Stocker les témoignages reçus dans la table `testimonials`
    - Créer l'interface de validation des témoignages dans le Dashboard (page `/dashboard/settings` ou section dédiée)
    - Rendre les témoignages validés disponibles pour injection dans les prompts du Copywriter
    - _Requirements: 19.1, 19.2, 19.3_

- [x] 27. Implémenter le Dashboard — Pages Analytics et Rapports
  - [x] 27.1 Créer la page Analytics (`/dashboard/analytics`)
    - Afficher les métriques clés : nombre de leads par étape du pipeline (temps réel), taux de conversion, revenu généré par produit
    - Afficher les rapports hebdomadaires de l'Agent Analyste
    - Afficher les résultats A/B testing en cours et terminés
    - Afficher les métriques d'observabilité : taux d'erreur par agent, temps de traitement, file d'attente de validation
    - _Requirements: 14.4, 20.2_

  - [x] 27.2 Implémenter la vue pipeline dans le Dashboard
    - Afficher le nombre de leads par étape du pipeline en temps réel via Convex subscriptions
    - Permettre de tracer à quelle étape un lead est bloqué
    - Afficher les webhooks en erreur non traités
    - _Requirements: 20.2_

- [x] 28. Checkpoint Semaine 4 — Système auto-apprenant + revenus trackés
  - Ensure all tests pass, ask the user if questions arise.
  - Vérifier le flux Stripe : Paiement → Conversion → Onboarding → Revenu tracké
  - Vérifier l'A/B testing : 2 versions → 14 jours → adoption automatique du gagnant
  - Vérifier le Churn Detector : signaux de désengagement → alertes → messages de rétention
  - Vérifier la conformité RGPD : désinscription → blacklist → exclusion totale

- [x] 29. Câblage final et intégration complète
  - [x] 29.1 Vérifier et câbler tous les triggers réactifs Convex
    - S'assurer que chaque changement d'état en base déclenche les agents concernés dans le bon ordre
    - Vérifier le flux complet end-to-end : Radar → Enrichissement → Qualificateur → Copywriter → Channel Router → Timing → Dashboard → Validation → Envoi → Tracking → Analyste
    - Vérifier le flux webhook : Webhook produit → Lead qualifié → Copywriter → ... → Envoi
    - _Requirements: 20.1, 20.4_

  - [x] 29.2 Vérifier l'isolation des agents
    - Tester qu'une erreur dans un agent n'affecte pas les autres agents
    - Vérifier que chaque agent peut être remplacé ou amélioré en isolation
    - Vérifier que l'ajout d'un nouveau produit dans la table `products` + un `prompt_config` suffit sans modification de code
    - _Requirements: 20.3, 20.4, 20.5_

  - [ ]* 29.3 Écrire les tests d'intégration end-to-end
    - Tester le flux complet d'un lead froid : détection → qualification → rédaction → routage → validation → envoi → tracking
    - Tester le flux complet d'un lead chaud : webhook → rédaction → routage → validation → envoi
    - Tester le flux de conversion : envoi → réponse → objection → conversion Stripe → onboarding
    - Tester le flux de rétention : client actif → signal churn → alerte → message rétention
    - _Requirements: 20.1, 20.2_

- [x] 30. Checkpoint final — Système LeadEngine OS complet et opérationnel
  - Ensure all tests pass, ask the user if questions arise.
  - Vérifier que toutes les 27 propriétés de correction sont couvertes par des tests
  - Vérifier que tous les 20 requirements sont couverts par des tâches d'implémentation
  - Valider le déploiement sur Convex + Vercel

## Notes

- Les tâches marquées avec `*` sont optionnelles et peuvent être ignorées pour un MVP plus rapide
- Chaque tâche référence les requirements spécifiques pour la traçabilité
- Les checkpoints assurent une validation incrémentale à chaque étape clé
- Les tests property-based valident les propriétés universelles de correction définies dans le design
- Les tests unitaires valident les cas spécifiques et les conditions d'erreur
- La configuration des produits et des règles d'upsell est data-driven (tables `products` et `upsell_rules`) — aucune constante hardcodée
