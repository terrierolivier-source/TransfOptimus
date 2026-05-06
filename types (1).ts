# Configuration du Projet - Consultant Pilotage

Ce projet a été migré de Firebase vers **Supabase** pour la gestion de l'authentification et des données en temps réel. Il est prêt à être déployé sur **Netlify**.

## Installation Locale

1. **Cloner le projet**
2. **Configuration des variables d'environnement**
   Copiez le fichier `.env.example` vers un nouveau fichier `.env.local` :
   ```bash
   cp .env.example .env.local
   ```
   Remplissez les variables suivantes avec vos clés Supabase :
   - `VITE_SUPABASE_URL` : L'URL de votre projet Supabase (Project Settings > API).
   - `VITE_SUPABASE_ANON_KEY` : La clé "anon public" (Project Settings > API).

3. **Installer les dépendances**
   ```bash
   npm install
   ```

4. **Lancer l'application en mode développement**
   ```bash
   npm run dev
   ```

## Structure du Projet

- `services/supabase.ts` : Initialisation du client Supabase.
- `services/authService.ts` : Fonctions liées à l'authentification (Login, Logout, Session).
- `services/dataService.ts` : Couche d'accès aux données PostgreSQL via Supabase.
- `components/LoginPage.tsx` : Interface de connexion unifiée.

## Déploiement sur Netlify

L'application est configurée avec un fichier `netlify.toml` qui gère les redirections nécessaires pour une Single Page Application (SPA).

1. Connectez votre dépôt Git à Netlify.
2. Configurez les variables d'environnement (`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`) dans l'interface de contrôle Netlify (Site settings > Build & deploy > Environment).
3. Netlify utilisera automatiquement `npm run build` et servira le dossier `dist`.

## Sécurité (Prochaines étapes côté Supabase)

L'application utilise la clé anonyme publique. Pour sécuriser réellement vos données, vous devez configurer le **Row Level Security (RLS)** sur vos tables Supabase :

1. Activez RLS sur les tables : `users`, `missions`, `planning`, `timesheets`, `config`, `budget_data`.
2. Créez des politiques (Policies) pour restreindre l'accès en fonction de `auth.uid()`.
3. **Important** : Ne partagez jamais la `service_role` key dans le code frontend.

## Commandes utiles

- `npm run dev` : Lancement local.
- `npm run build` : Compilation pour la production.
- `npm run preview` : Tester le build localement.
