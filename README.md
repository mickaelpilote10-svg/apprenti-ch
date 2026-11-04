# APPRENTI.CH

Application web en français pour organiser une recherche de place d’apprentissage en Suisse. Elle est conçue pour GitHub Pages et utilise Supabase pour les fonctions qui exigent un serveur.

## Ce qui est opérationnel dans cette livraison

- Interface responsive et navigation entre tableau de bord, recherche, documents, lettre, candidatures et profil.
- Profil, versions de lettre et suivi des candidatures sauvegardés localement dans le navigateur.
- Ouverture de la recherche officielle orientation.ch pour Fribourg.
- Connexion e-mail/mot de passe Supabase, téléversement privé des documents PDF/DOCX et création d’un lien de téléchargement à durée limitée.
- Fonction Edge de génération d’une lettre avec le fournisseur IA, qui exige une session authentifiée et une clé configurée côté serveur.
- Liste d’offres alimentée par la table `job_offers`; les cartes n’apparaissent qu’après import d’un flux autorisé et montrent leur source, date d’actualisation, et le bouton de candidature seulement si l’e-mail publié est vérifié.
- Écran de candidature avec destinataire officiel en lecture seule, message modifiable, pièces jointes privées et clic explicite « Confirmer et envoyer ».
- Fonction Edge Gmail qui ne permet l’envoi qu’à l’utilisateur indiqué par `APP_OWNER_USER_ID`, et relit l’offre et les documents depuis Supabase avant l’envoi.
- Schéma SQL avec RLS et bucket privé.

Le suivi du profil et des candidatures n’est pas encore synchronisé avec les tables Supabase dans cette version. Les contenus locaux ne sont pas chiffrés et restent dans le navigateur de l’appareil.

## Sources d’offres et données réelles

La page des offres **ne fabrique et ne recopie aucune annonce**. Le CSFO indique que les offres sont gérées dans les cantons du lieu de formation et transmises à orientation.ch. Je n’ai pas trouvé de documentation d’API publique utilisable ni de flux dont les conditions autorisent la réutilisation. La table `job_offers` et les filtres sont prêts, mais la liste reste vide tant que le CSFO/canton n’a pas autorisé une source et qu’un importeur ne l’alimente pas. Le bouton ouvre la recherche officielle entre-temps.

Pour afficher des annonces directement dans APPRENTI.CH, demander au CSFO (orientation.ch, `info@csfo.ch`) ou au canton de Fribourg un flux/API et les conditions écrites de réutilisation, l’attribution requise, la fréquence de mise à jour et les champs permis. Ensuite, créer un adaptateur serveur qui consomme ce flux autorisé et expose seulement les champs autorisés. Ne pas faire de scraping ni contourner de protections.

## Démarrage local et GitHub Pages

1. Créer un projet Supabase et ouvrir **SQL Editor**.
2. Exécuter `supabase/schema.sql`.
3. Copier `config.js` sous `config.local.js` pour conserver vos propres réglages dans votre dépôt privé, puis renseigner `supabaseUrl` et la clé **anon/publishable**. Ne jamais utiliser `service_role` dans le navigateur. Charger `config.local.js` avant `app.js` dans `index.html` si vous utilisez ce nom, ou modifier `config.js` localement.
4. Dans Supabase Auth, régler les URL de site et de redirection sur l’URL GitHub Pages, puis activer la confirmation d’adresse e-mail selon votre choix.
5. Ouvrir `index.html` par un serveur local (par exemple `python -m http.server` dans le dossier `outputs`) pour éviter les restrictions de navigateur sur les fichiers locaux.
6. Publier le contenu de ce dossier sur GitHub. Dans **Settings → Pages**, choisir la branche et le dossier où se trouve `index.html`. Si le dépôt utilise le dossier `/docs`, copier les fichiers du livrable dans `/docs`.

La clé anon est prévue pour le navigateur; la protection des données repose sur Auth, RLS et les politiques du bucket. Vérifier les URL de redirection avant d’ouvrir l’accès à d’autres utilisateurs.

## Fonction IA (lettres)

Prérequis: projet Supabase, authentification activée, clé de fournisseur IA et budget/limites configurés auprès du fournisseur.

```sh
supabase login
supabase link --project-ref VOTRE_REF
supabase secrets set AI_API_KEY=VOTRE_CLE AI_MODEL=gpt-4.1-mini
supabase functions deploy draft-content
```

La fonction `supabase/functions/draft-content/index.ts` vérifie l’utilisateur, limite la taille des entrées et appelle l’API Responses avec `store: false`. La lettre peut contenir des données personnelles: ne transmettre que les informations nécessaires et vérifier les règles de conservation du fournisseur. La proposition doit être relue; l’IA n’est pas autorisée à compléter les faits manquants.

## Gmail et envoi de candidature

La fonction d’envoi est fournie, mais reste désactivée avant sa configuration. Dans Google Cloud, créer un projet, activer Gmail API, configurer l’écran de consentement et un client OAuth web HTTPS. Autoriser `https://www.googleapis.com/auth/gmail.send`, récupérer côté serveur un jeton de rafraîchissement pour **le compte Gmail expéditeur**, et le conserver uniquement comme secret Supabase. Google peut exiger la vérification de l’application selon les utilisateurs/scopes.

Déployer ensuite la fonction et configurer les secrets serveur (ne jamais les coller dans `config.js`):

```sh
supabase secrets set APP_OWNER_USER_ID=UUID_AUTH_DE_MICKAEL
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
supabase functions deploy send-application
```

L’identifiant utilisateur se trouve dans Supabase **Authentication → Users**. La fonction refuse tous les autres comptes. Elle vérifie aussi que l’offre est active, que son adresse a été importée comme vérifiée, et que les deux pièces jointes appartiennent au compte. L’interface montre le destinataire et le message et attend le clic « Confirmer et envoyer ». Chaque déploiement doit être testé avec une offre de test et des documents non sensibles avant le premier envoi réel.

Les fichiers sont envoyés en pièces jointes avec des noms standardisés (`CV_Mickael_Rouiller.pdf`, `Lettre_Motivation_Mickael_Rouiller.pdf` ou `.docx`). Aucune adresse de candidature n’est devinée. Le message et l’offre sont enregistrés côté serveur après confirmation de Gmail.

## Architecture livrée

```text
outputs/
  index.html, styles.css, app.js, config.js
  supabase/schema.sql
  supabase/functions/draft-content/index.ts
```

Le navigateur ne contient aucune clé privée. Pour un usage réel avec documents personnels, garder les dépôts et journaux accessibles uniquement aux personnes autorisées, activer les protections du compte et vérifier le comportement de suppression/export des données.
