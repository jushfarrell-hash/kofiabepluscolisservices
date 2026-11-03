# COLIS SERVICE App

Application web de gestion de colis basée sur le cahier des charges de livraison nationale à Madagascar.

## Fonctionnalités principales

- Authentification sécurisée avec mot de passe hashé
- Gestion des comptes utilisateurs par rôle
- Gestion des agences
- Enregistrement des colis et calcul du tarif
- Suivi public par code de colis
- Gestion des paiements
- Tableau de bord opérationnel
- Base de données SQLite locale avec persistance

## Comptes et rôles

Le système prend en charge les rôles suivants :

- ADMIN
- RESPONSABLE
- AGENT
- LIVREUR

L’admin peut créer les comptes depuis l’interface web.

## Base de données

Le projet utilise SQLite pour la persistance locale.

Le fichier de base est généré dans :

- `data/colis.db`

Les tables principales incluent :

- `users`
- `agencies`
- `shipments`
- `shipment_events`
- `payments`
- `audit_logs`

> Le fichier SQLite est ignoré dans GitHub pour éviter de versionner des données locales d’exploitation.

## Démarrage rapide

```bash
npm install
npm start
```

Puis ouvrez : http://localhost:3000

## Identifiants par défaut

- En local : `admin@colis.mg` / `admin123`
- En production : `admin@colis.mg` et le mot de passe configuré dans la variable `ADMIN_PASSWORD`

Ne réutilisez pas le mot de passe local en production.

## Hébergement sur Render

Le fichier `render.yaml` configure le palier gratuit Render, sans disque persistant. L’adresse du service reste stable, mais Render met le service en veille après une période d’inactivité. Les fichiers SQLite et les sessions sont éphémères : les données peuvent être perdues lors d’un redémarrage ou redéploiement. Ce mode convient aux essais, pas à l’exploitation réelle.

1. Dans Render, choisissez **New +** puis **Blueprint**.
2. Connectez le dépôt `jushfarrell-hash/kofiabepluscolisservices` et sélectionnez la branche `main`.
3. Lors de la configuration, définissez `ADMIN_PASSWORD` avec un mot de passe fort. `SESSION_SECRET` est généré automatiquement.
4. Lancez le déploiement et ouvrez l’URL fournie par Render.

En production, les comptes et colis de démonstration ne sont pas créés. Le premier compte admin est initialisé avec `ADMIN_PASSWORD`.

## Publier le code sur GitHub

GitHub héberge ici le code source; il ne démarre pas l'application. Pour publier les prochains changements depuis un dépôt déjà configuré :

```bash
git add .
git commit -m "Décrire les changements"
git push origin main
```

Le dépôt du projet est https://github.com/jushfarrell-hash/kofiabepluscolisservices. Pour lancer l'application, suivez la section « Démarrage rapide »; un hébergement en ligne nécessite un service de déploiement compatible avec Node.js et une configuration adaptée de la base de données et des secrets.

## Structure du projet

- `server.js` : backend principal
- `views/` : pages EJS
- `public/` : fichiers statiques et CSS
- `data/` : données SQLite
- `.gitignore` : fichiers à ignorer dans GitHub

## Bonnes pratiques

- ne pas versionner le fichier de base SQLite de production
- garder les migrations dans le code ou dans des scripts dédiés
- sécuriser les variables d’environnement plus tard (JWT, secrets, SMTP, etc.)
- ajouter un vrai système de rôles par permissions plus robuste à l’avenir
