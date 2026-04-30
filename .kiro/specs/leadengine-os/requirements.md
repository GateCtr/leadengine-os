# Document de Requirements — LeadEngine OS

## Introduction

LeadEngine OS est un système distribué event-driven piloté par 6 agents IA spécialisés. Il automatise l'intégralité du cycle d'acquisition, de conversion et de rétention de leads — du premier signal détecté sur le web jusqu'au revenu récurrent protégé. Le principe fondateur est le Human-in-the-Loop : aucun message n'est envoyé sans validation manuelle. Les agents préparent, enrichissent et optimisent. L'humain décide et déclenche l'envoi.

Le système couvre 4 produits (Piksend, GateCtr, Joventy, Ryan Sabowa) et opère sur deux canaux de sortie (Email via domaine produit, DM/Commentaires réseaux sociaux). Deux sources d'entrée alimentent le pipeline : le web externe (Agent Radar) pour les leads froids et les webhooks produits pour les leads chauds.

## Glossaire

- **LeadEngine_OS** : Le système distribué event-driven complet d'orchestration de croissance agentique.
- **Agent_Radar** : Agent IA spécialisé dans l'acquisition web via Serper.dev et le scraping Firecrawl.
- **Agent_Qualificateur** : Agent IA spécialisé dans le filtrage et le scoring des leads par analyse sémantique LLM.
- **Agent_Copywriter** : Agent IA spécialisé dans la composition contextuelle de messages (sans template figé).
- **Agent_Objecteur** : Agent IA spécialisé dans l'analyse des réponses prospects et la gestion des objections.
- **Agent_Timing** : Agent IA spécialisé dans la suggestion de l'heure d'envoi optimale.
- **Agent_Analyste** : Agent IA spécialisé dans l'optimisation continue, l'A/B testing et le feedback loop.
- **Channel_Router** : Composant intermédiaire entre le Copywriter et le Dashboard qui identifie le canal et l'identité de marque pour chaque message.
- **Dashboard** : Interface Next.js 16+ + Tailwind CSS de validation humaine et de pilotage du système.
- **Lead** : Un prospect potentiel détecté par le système, identifié par email ou identifiant unique.
- **Score** : Note pondérée sur 100 attribuée à un lead par l'Agent_Qualificateur.
- **Fiche_Prospect** : Enregistrement CRM unifié consolidant l'historique cross-canal d'un prospect.
- **Séquence_Relance** : Suite de messages planifiés (J+0, J+3, J+7, J+14, J+30) envoyés en l'absence de réponse.
- **Churn_Detector** : Sous-système surveillant les signaux de désengagement des clients existants.
- **Upsell_Engine** : Sous-système suggérant des ventes additionnelles ou croisées entre les 4 produits.
- **Convex** : Backend temps réel utilisé pour l'orchestration, la persistance et les cron jobs.
- **Resend** : Service d'envoi d'emails utilisé pour l'expédition depuis les domaines produits.
- **Stripe** : Plateforme de paiement utilisée pour la conversion et le suivi des revenus.
- **Clerk** : Service d'authentification (Clerk v7) utilisé pour sécuriser l'accès au Dashboard. L'intégration utilise exclusivement des composants UI custom construits avec les hooks headless et l'API de Clerk v7 (pas de composants pré-construits Clerk).
- **Produit** : L'un des 4 produits couverts — Piksend, GateCtr, Joventy ou Ryan Sabowa.
- **Human_in_the_Loop** : Principe fondateur imposant une validation humaine avant tout message sortant.
- **Prompt_Config** : Configuration de prompt spécifique à un agent et un produit, ajustable par l'Agent_Analyste.

## Requirements

### Requirement 1 : Ingestion de leads via le web externe (Agent Radar)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système détecte automatiquement des leads potentiels sur le web via des requêtes de mots-clés de douleur utilisateur, afin d'alimenter le pipeline d'acquisition en leads froids.

#### Critères d'acceptation

1. THE Agent_Radar SHALL exécuter des requêtes Serper.dev sur les mots-clés de douleur utilisateur configurés via un cron job périodique dans Convex.
2. WHEN l'Agent_Radar détecte un signal web correspondant à un mot-clé configuré, THE Agent_Radar SHALL créer un document Lead dans la base Convex avec le statut `pending_qualification`.
3. WHEN un nouveau lead est créé par l'Agent_Radar, THE Agent_Radar SHALL stocker la source, la date de détection et le canal d'origine dans le document Lead.
4. IF une requête Serper.dev échoue ou retourne une erreur, THEN THE Agent_Radar SHALL journaliser l'erreur dans Convex et réessayer lors du prochain cycle de cron job.
5. THE Agent_Radar SHALL dédupliquer les leads détectés en vérifiant l'email ou l'identifiant unique avant insertion en base.

### Requirement 2 : Ingestion de leads via webhooks produits

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système reçoive et traite les événements provenant des webhooks des 4 produits (Piksend, GateCtr, Joventy, Ryan Sabowa), afin d'intégrer les leads chauds directement dans le pipeline sans passer par la qualification.

#### Critères d'acceptation

1. WHEN un webhook produit est reçu avec un payload valide contenant `product_id`, `event_type`, `event_context`, `user_email` et `timestamp`, THE LeadEngine_OS SHALL créer un document Lead dans Convex avec le statut `qualified` et le score maximum.
2. WHEN un lead est créé via webhook produit, THE LeadEngine_OS SHALL associer automatiquement le Produit correspondant au lead et transmettre le lead directement à l'Agent_Copywriter sans passer par l'Agent_Qualificateur.
3. IF un webhook produit est reçu avec un payload invalide ou incomplet, THEN THE LeadEngine_OS SHALL rejeter le webhook, journaliser l'erreur et retourner un code HTTP 400.
4. THE LeadEngine_OS SHALL valider l'authenticité de chaque webhook entrant avant traitement.

### Requirement 3 : Enrichissement contextuel des profils prospects

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système enrichisse automatiquement les profils des prospects avec des données publiques (LinkedIn, GitHub, site personnel), afin que les messages générés soient ultra-personnalisés.

#### Critères d'acceptation

1. WHEN un lead atteint le statut `pending_qualification` ou `qualified`, THE LeadEngine_OS SHALL déclencher un scraping Firecrawl du profil public du prospect.
2. WHEN le scraping Firecrawl retourne des données, THE LeadEngine_OS SHALL stocker les données enrichies dans le document Lead en base Convex.
3. IF le scraping Firecrawl échoue ou ne retourne aucune donnée, THEN THE LeadEngine_OS SHALL poursuivre le pipeline avec les données disponibles sans bloquer le traitement du lead.
4. THE LeadEngine_OS SHALL injecter les données enrichies dans le prompt de l'Agent_Copywriter avant la rédaction du message.

### Requirement 4 : Qualification et scoring des leads (Agent Qualificateur)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que les leads froids soient automatiquement analysés et scorés par un agent IA spécialisé, afin de prioriser les leads les plus prometteurs.

#### Critères d'acceptation

1. WHEN un document Lead avec le statut `pending_qualification` est détecté dans Convex, THE Agent_Qualificateur SHALL analyser le lead par analyse sémantique LLM.
2. THE Agent_Qualificateur SHALL attribuer un score pondéré sur 100 basé sur les critères suivants : urgence exprimée (30 pts), source webhook produit (25 pts), correspondance produit (20 pts), profil actif (15 pts), signaux contextuels (10 pts).
3. WHEN le score calculé est supérieur ou égal à 40, THE Agent_Qualificateur SHALL mettre à jour le statut du lead à `qualified` et assigner un `product_id`.
4. WHEN le score calculé est inférieur à 40, THE Agent_Qualificateur SHALL mettre à jour le statut du lead à `discarded`.
5. THE Agent_Qualificateur SHALL comparer le problème du lead aux USP des 4 produits pour déterminer le produit le plus pertinent.
6. IF l'analyse LLM échoue ou retourne une erreur, THEN THE Agent_Qualificateur SHALL journaliser l'erreur et conserver le lead en statut `pending_qualification` pour un nouveau traitement.

### Requirement 5 : Rédaction contextuelle de messages (Agent Copywriter)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système compose des messages personnalisés et contextuels pour chaque lead qualifié, afin de maximiser le taux de réponse sans utiliser de templates figés.

#### Critères d'acceptation

1. WHEN un lead qualifié sans champ `suggested_reply` est détecté, THE Agent_Copywriter SHALL composer un message contextuel adapté au profil du prospect et au produit assigné.
2. THE Agent_Copywriter SHALL adapter le ton du message selon le contexte : Expert, Support ou Tech.
3. THE Agent_Copywriter SHALL injecter automatiquement la preuve sociale pertinente et un lien contextuel vers la landing page dédiée dans chaque message composé.
4. WHEN l'A/B testing est activé, THE Agent_Copywriter SHALL générer 2 versions de chaque message avec des angles différents.
5. THE Agent_Copywriter SHALL stocker le message composé dans le champ `suggested_reply` de la table `messages` dans Convex.
6. IF la génération LLM échoue, THEN THE Agent_Copywriter SHALL journaliser l'erreur et marquer le lead pour un nouveau traitement.

### Requirement 6 : Routage des canaux de diffusion (Channel Router)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système identifie automatiquement le canal de diffusion et l'identité de marque appropriés pour chaque message, afin d'assurer une communication cohérente depuis les domaines produits.

#### Critères d'acceptation

1. WHEN un message est composé par l'Agent_Copywriter, THE Channel_Router SHALL déterminer le canal de diffusion (Email ou Social) et l'identité de marque du produit assigné.
2. WHEN le canal déterminé est Email, THE Channel_Router SHALL injecter le corps du message dans le template React du produit concerné avec la couleur de marque, le logo et la signature appropriés.
3. WHEN le canal déterminé est Email, THE Channel_Router SHALL configurer l'expéditeur et le reply-to selon le produit : Piksend (hello@piksend.com), GateCtr (hello@gatectr.com), Joventy (hello@joventy.com), Ryan Sabowa (contact@ryansabowa.com).
4. WHEN le canal déterminé est Social (Twitter/X, LinkedIn, Reddit, Instagram), THE Channel_Router SHALL préparer le message et fournir un lien direct vers la conversation ou le post cible dans le Dashboard.
5. THE Channel_Router SHALL générer un aperçu visuel complet du message avant envoi dans le Dashboard.

### Requirement 7 : Validation Human-in-the-Loop via le Dashboard

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux valider, modifier ou rejeter chaque message avant envoi depuis une interface dédiée, afin de garder le contrôle total sur les communications sortantes.

#### Critères d'acceptation

1. THE Dashboard SHALL afficher tous les messages en attente de validation, triés par score de lead décroissant.
2. THE Dashboard SHALL permettre à l'opérateur de valider, modifier ou rejeter chaque message individuellement.
3. WHEN l'opérateur valide un message email, THE LeadEngine_OS SHALL envoyer le message via Resend depuis le domaine du produit assigné.
4. WHEN l'opérateur valide un message social, THE Dashboard SHALL afficher le lien direct vers la plateforme cible pour un envoi manuel.
5. THE Dashboard SHALL afficher l'heure d'envoi optimale suggérée par l'Agent_Timing pour chaque message.
6. THE Dashboard SHALL exiger une authentification via Clerk v7 avant tout accès, en utilisant des composants UI custom (formulaires de connexion et d'inscription construits sur mesure) alimentés par les hooks headless et l'API de Clerk v7, sans recourir aux composants pré-construits de Clerk.
7. THE Dashboard SHALL implémenter les formulaires de connexion et d'inscription avec des composants React custom utilisant les hooks headless de Clerk v7 (useSignIn, useSignUp, useSession) pour gérer l'authentification, la création de compte et la gestion de session.
8. THE LeadEngine_OS SHALL interdire tout envoi de message sans validation humaine préalable.

### Requirement 8 : Suggestion de timing d'envoi optimal (Agent Timing)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux recevoir une suggestion d'heure d'envoi optimale pour chaque message, afin de maximiser les taux d'ouverture et de réponse.

#### Critères d'acceptation

1. WHEN un message est prêt pour validation dans le Dashboard, THE Agent_Timing SHALL analyser l'heure locale du prospect, le niveau d'activité détecté et les créneaux statistiques optimaux.
2. THE Agent_Timing SHALL remplir le champ `send_at_suggested` du message avec l'heure d'envoi recommandée.
3. THE Agent_Timing SHALL afficher un indicateur visuel de la suggestion de timing dans le Dashboard.
4. THE Agent_Timing SHALL suggérer l'heure optimale sans bloquer la possibilité d'envoi immédiat par l'opérateur.

### Requirement 9 : Séquence de relance automatisée

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système génère automatiquement des messages de relance selon un calendrier défini (J+3, J+7, J+14, J+30) lorsqu'un prospect ne répond pas, afin de maximiser les chances de conversion.

#### Critères d'acceptation

1. WHEN un message initial est envoyé et qu'aucune réponse n'est reçue après 3 jours, THE LeadEngine_OS SHALL déclencher la génération d'un message de relance avec un angle différent (preuve sociale ou cas d'usage).
2. WHEN aucune réponse n'est reçue après 7 jours suivant le message initial, THE LeadEngine_OS SHALL déclencher la génération d'une relance sous forme de question ouverte simple.
3. WHEN aucune réponse n'est reçue après 14 jours suivant le message initial, THE LeadEngine_OS SHALL déclencher la génération d'un email de valeur contenant un insight utile sans intention de vente.
4. WHEN aucune réponse n'est reçue après 30 jours suivant le message initial, THE LeadEngine_OS SHALL déclencher la génération d'un message de réactivation.
5. WHEN aucune réponse n'est reçue après 31 jours suivant le message initial, THE LeadEngine_OS SHALL archiver automatiquement le lead.
6. THE LeadEngine_OS SHALL soumettre chaque message de relance à la validation Human-in-the-Loop avant envoi.

### Requirement 10 : Gestion des réponses et objections (Agent Objecteur)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système analyse automatiquement les réponses des prospects et suggère la meilleure contre-réponse, afin de gérer efficacement les objections et faire avancer les conversations.

#### Critères d'acceptation

1. WHEN une réponse entrante d'un prospect est détectée (email ou réseau social), THE Agent_Objecteur SHALL analyser sémantiquement le contenu de la réponse.
2. THE Agent_Objecteur SHALL catégoriser chaque réponse dans l'une des catégories suivantes : trop cher, besoin de réfléchir, question technique, intérêt confirmé, refus.
3. WHEN la réponse est catégorisée comme « intérêt confirmé », THE Agent_Objecteur SHALL mettre à jour le statut du lead à `hot`.
4. WHEN la réponse est catégorisée comme « refus », THE Agent_Objecteur SHALL mettre à jour le statut du lead à `archived`.
5. WHEN la réponse est catégorisée comme « trop cher », « besoin de réfléchir » ou « question technique », THE Agent_Objecteur SHALL générer une contre-réponse suggérée et mettre à jour le statut du lead à `pending`.
6. THE Agent_Objecteur SHALL soumettre chaque contre-réponse suggérée à la validation Human-in-the-Loop avant envoi.

### Requirement 11 : Conversion et suivi des revenus via Stripe

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système détecte automatiquement les conversions via les webhooks Stripe et mette à jour le statut des leads, afin de suivre précisément le revenu généré par le pipeline.

#### Critères d'acceptation

1. WHEN un webhook Stripe confirme un paiement réussi, THE LeadEngine_OS SHALL mettre à jour le statut du lead correspondant à `converted` et enregistrer le montant dans le champ `revenue_generated`.
2. WHEN un lead est converti, THE LeadEngine_OS SHALL déclencher la séquence d'onboarding automatisée (J0, J1, J3, J7, J14).
3. THE LeadEngine_OS SHALL valider l'authenticité de chaque webhook Stripe entrant via la signature Stripe avant traitement.
4. IF un webhook Stripe est reçu sans lead correspondant en base, THEN THE LeadEngine_OS SHALL journaliser l'événement pour investigation manuelle.

### Requirement 12 : Détection de churn et rétention

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système surveille en continu les signaux de désengagement des clients existants et suggère des actions de rétention, afin de protéger le revenu récurrent.

#### Critères d'acceptation

1. WHEN un client converti n'a pas de connexion depuis plus de 7 jours, THE Churn_Detector SHALL générer une alerte de priorité haute dans le Dashboard.
2. WHEN une chute d'usage supérieure à 50% est détectée sur une période de 2 semaines, THE Churn_Detector SHALL déclencher la génération d'un message de rétention suggéré.
3. WHEN un ticket support est ouvert depuis plus de 48 heures sans réponse, THE Churn_Detector SHALL déclencher une escalade dans le Dashboard et la génération d'un message de suivi.
4. WHEN une tentative d'annulation est détectée, THE Churn_Detector SHALL déclencher immédiatement la génération d'une offre de downsell (plan inférieur) suggérée.
5. THE Churn_Detector SHALL soumettre chaque message de rétention ou de downsell à la validation Human-in-the-Loop avant envoi.

### Requirement 13 : Upsell et cross-sell entre produits

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système détecte les opportunités de vente additionnelle ou croisée entre les 4 produits, afin de maximiser la valeur vie client.

#### Critères d'acceptation

1. WHEN un usage intensif de l'API est détecté chez un client Piksend, THE Upsell_Engine SHALL suggérer GateCtr pour l'optimisation des coûts LLM.
2. WHEN un volume d'images traité croissant est détecté chez un client GateCtr, THE Upsell_Engine SHALL suggérer Piksend pour la gestion professionnelle des photos.
3. WHEN un client Ryan Sabowa présente un pattern de projets récurrents, THE Upsell_Engine SHALL suggérer Joventy pour l'automatisation du workflow.
4. WHEN un besoin de conseil est identifié chez un client Joventy, THE Upsell_Engine SHALL suggérer Ryan Sabowa pour un accompagnement dédié.
5. THE Upsell_Engine SHALL soumettre chaque suggestion d'upsell ou de cross-sell à la validation Human-in-the-Loop avant envoi.

### Requirement 14 : Optimisation continue et A/B testing (Agent Analyste)

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système analyse en continu les performances des messages et optimise automatiquement les prompts des agents, afin que le système devienne plus précis à chaque cycle.

#### Critères d'acceptation

1. WHEN des données de tracking post-envoi sont disponibles (clics, réponses, conversions Stripe), THE Agent_Analyste SHALL corréler chaque message avec le revenu réel généré via une attribution multi-touch.
2. WHEN deux versions A/B d'un message sont en circulation depuis 14 jours, THE Agent_Analyste SHALL adopter automatiquement la version gagnante comme standard en se basant sur les taux d'ouverture, de clic et de réponse.
3. WHEN la performance d'un prompt est jugée insuffisante par l'Agent_Analyste, THE Agent_Analyste SHALL proposer une révision du prompt dans la table `prompt_configs`.
4. THE Agent_Analyste SHALL générer un rapport hebdomadaire récapitulatif accessible dans le Dashboard.
5. THE Agent_Analyste SHALL alimenter un Win/Loss Engine : micro-enquête post-conversion et analyse des patterns de rejet post-archivage.

### Requirement 15 : CRM unifié et fiche prospect consolidée

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système consolide toutes les interactions d'un prospect en une fiche unique cross-canal, afin d'avoir une vue complète de chaque relation.

#### Critères d'acceptation

1. THE LeadEngine_OS SHALL identifier un prospect unique via son email ou identifiant unique, quel que soit le canal de détection.
2. THE Fiche_Prospect SHALL contenir les champs suivants : première détection (canal, date, source), score d'entrée, historique des contacts horodatés avec canal, réponses reçues catégorisées, statut actuel, produit assigné, revenu généré et risque churn.
3. WHEN un prospect est détecté sur un nouveau canal, THE LeadEngine_OS SHALL consolider les données dans la Fiche_Prospect existante au lieu de créer un doublon.
4. THE Dashboard SHALL afficher la Fiche_Prospect complète pour chaque lead sélectionné.

### Requirement 16 : Notifications et alertes temps réel

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux recevoir des notifications en temps réel selon la priorité des événements, afin de réagir rapidement aux opportunités et aux risques.

#### Critères d'acceptation

1. WHEN un lead avec un score supérieur à 85 est détecté, THE LeadEngine_OS SHALL envoyer une notification push mobile immédiate de priorité critique.
2. WHEN une réponse prospect est reçue dans les 2 heures suivant un envoi, THE LeadEngine_OS SHALL envoyer une notification push mobile immédiate de priorité haute.
3. WHEN un lead avec le statut `hot` n'a reçu aucune action depuis 4 heures, THE LeadEngine_OS SHALL envoyer une notification push mobile et afficher une bannière dans le Dashboard.
4. WHEN un signal churn est détecté, THE LeadEngine_OS SHALL envoyer une notification push mobile et afficher une alerte dans le Dashboard.
5. WHEN un message est en attente de validation depuis plus de 8 heures, THE LeadEngine_OS SHALL afficher une notification dans le Dashboard.
6. THE Agent_Analyste SHALL envoyer un email récapitulatif hebdomadaire automatique.

### Requirement 17 : Conformité RGPD et CAN-SPAM

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système respecte les obligations légales RGPD et CAN-SPAM, afin de protéger les domaines produits contre le blacklistage et de respecter les droits des prospects.

#### Critères d'acceptation

1. THE LeadEngine_OS SHALL inclure un lien de désinscription fonctionnel dans chaque email envoyé via Resend.
2. WHEN un prospect clique sur le lien de désinscription, THE LeadEngine_OS SHALL ajouter immédiatement le prospect à la liste noire et cesser tout contact futur.
3. THE LeadEngine_OS SHALL journaliser la source du lead, la date de détection et le canal d'origine à l'insertion de chaque lead en base.
4. THE LeadEngine_OS SHALL supprimer automatiquement les leads archivés après 12 mois via un cron job Convex.
5. WHEN une demande de droit à l'effacement est reçue, THE LeadEngine_OS SHALL permettre la suppression complète des données du prospect en 1 clic depuis le Dashboard.
6. THE LeadEngine_OS SHALL vérifier la liste noire avant tout envoi de message pour garantir qu'aucun prospect désinscrit ne soit recontacté.

### Requirement 18 : Tracking comportemental post-envoi

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système suive les interactions post-envoi (clics sur liens, ouvertures d'emails), afin d'alimenter l'Agent_Analyste en données de performance.

#### Critères d'acceptation

1. THE LeadEngine_OS SHALL générer des URLs courtes personnalisées via le système de tracking custom + Convex pour chaque lien inclus dans un message.
2. WHEN un prospect clique sur un lien tracké, THE LeadEngine_OS SHALL enregistrer l'événement de clic avec l'horodatage, le lead associé et le message source dans Convex.
3. THE LeadEngine_OS SHALL transmettre les données de tracking à l'Agent_Analyste pour corrélation avec les conversions.
4. WHEN un prospect est identifié sur la liste noire, THE LeadEngine_OS SHALL exclure le prospect de tout tracking comportemental.

### Requirement 19 : Preuve sociale et témoignages

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que le système collecte et exploite automatiquement les témoignages clients, afin de renforcer la crédibilité des messages sortants et des landing pages.

#### Critères d'acceptation

1. WHEN un lead est converti, THE LeadEngine_OS SHALL déclencher l'envoi d'un email de collecte de témoignage post-conversion.
2. WHEN un témoignage est reçu et validé par l'opérateur, THE LeadEngine_OS SHALL stocker le témoignage en base et le rendre disponible pour injection dans les prompts de l'Agent_Copywriter.
3. THE LeadEngine_OS SHALL afficher dynamiquement les témoignages validés sur les landing pages contextuelles selon le produit concerné.

### Requirement 20 : Architecture découplée et observabilité

**User Story :** En tant qu'opérateur de LeadEngine OS, je veux que chaque agent fonctionne de manière isolée et que le système offre une observabilité complète du pipeline, afin de pouvoir diagnostiquer et corriger les problèmes sans refonte.

#### Critères d'acceptation

1. THE LeadEngine_OS SHALL assurer que la communication inter-agents passe exclusivement par la base de données Convex, sans appels directs entre agents.
2. THE LeadEngine_OS SHALL permettre de tracer à quelle étape du pipeline un lead est bloqué, en temps réel depuis le Dashboard.
3. IF un agent rencontre une erreur, THEN THE LeadEngine_OS SHALL isoler l'erreur à l'agent concerné sans affecter le fonctionnement des autres agents.
4. THE LeadEngine_OS SHALL permettre le remplacement, l'amélioration ou la duplication de chaque agent en isolation.
5. WHEN un nouveau produit est ajouté, THE LeadEngine_OS SHALL permettre son intégration en ajoutant uniquement un nouveau `prompt_config` sans modification des agents existants.
