# zamble-comparatifs

Site de comparatifs jeux/jouets avec liens d'affiliation, v1 centrée sur le thème
LEGO Star Wars. Déployé sur zamble.fr (domaine et hébergement OVH réutilisés depuis
l'ancien projet [zamble-archive](https://github.com/contactzamble/zamble-archive)).

Stack : [Astro](https://astro.build), site 100% statique, déployé via FTP sur OVH
(GitHub Actions, `.github/workflows/deploy.yml`).

## Développement

```bash
npm install
npm run dev       # aperçu local sur http://localhost:4321
npm run build     # build de production dans dist/
```

## Contenu

Les produits (fiches LEGO) sont dans `src/content/produits/*.md`. Chaque fiche a un champ
`prixVerifie: false` par défaut — un badge "Prix à vérifier" s'affiche automatiquement sur
le site tant que ce champ n'est pas passé à `true` après vérification manuelle du prix
réel. Le champ `affiliateUrl` reste `null` (bouton désactivé "Lien à venir") tant que les
clés Amazon Product Advertising API ne sont pas confirmées actives.

## Déploiement

Secrets GitHub Actions requis (mêmes valeurs que l'ancien repo `zamble-archive`, à
recopier dans les secrets de *ce* repo) :

- `FTP_SERVER`
- `FTP_USERNAME`
- `FTP_PASSWORD`
- `FTP_SERVER_DIR`

Un push sur `main` déclenche le build + déploiement automatique.
