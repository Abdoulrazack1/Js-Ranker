# Contribuer à Js-Ranker

Merci de t'intéresser au projet ! Js-Ranker est un outil pour développeurs — les contributions qui améliorent les features AST, l'intégration CI/CD ou l'écosystème sont très bienvenues.

## 🚀 Setup local

```bash
git clone https://github.com/Abdoulrazack1/Js-Ranker.git
cd Js-Ranker
npm install
node migrate-dataset.js   # si dataset hérité < 10 features
npm run train             # ~15s sur CPU
node index.js status
```

## 🎯 Bonnes premières contributions

### 1. Ajouter une feature AST

Les 10 features actuelles sont définies dans `src/ast/extract-features.js`. Pour en ajouter une 11ème :

1. Implémente la fonction d'extraction (parcourt l'AST `acorn`, retourne un nombre normalisé 0-1)
2. Ajoute-la au tableau de features
3. Régénère le dataset : `node migrate-dataset.js`
4. Ré-entraîne : `npm run train`
5. Vérifie l'amélioration sur `examples/clean.js` et `examples/messy.js`

Idées de features qui manquent :
- **Pure function detection** (pas de side effects)
- **Recursion depth max**
- **Higher-order function usage**
- **Destructuring usage** (signe de code moderne)

### 2. Port TypeScript

Js-Ranker n'utilise pas les types TS pour l'instant. Un parser TS-aware (via `@typescript-eslint/parser`) qui ajoute des features comme :
- Strict mode usage
- Type coverage
- `any` count

…apporterait une vraie valeur.

### 3. Plugin VS Code

Inline scoring dans l'éditeur (style "code lens" au-dessus de chaque fonction).

### 4. GitHub Action

Un wrapper officiel à publier sur le Marketplace : `Abdoulrazack1/js-ranker-action@v1` avec inputs `min-score`, `fail-on-low`, `report-format`.

### 5. Améliorer le dataset

`generate-dataset.js` scrape GitHub. Améliorer :
- Filtres de qualité (étoiles ≥ X, last commit < 6 mois)
- Pondération par popularité
- Dataset multi-style (React, Node backend, library code)

## 🐛 Signaler un bug

Ouvre une [issue](https://github.com/Abdoulrazack1/Js-Ranker/issues) avec :

1. **Code d'entrée** (snippet ou URL)
2. **Score attendu** (intuition humaine)
3. **Score obtenu** + breakdown des 10 features
4. **Version**, Node, OS

## 🔀 Proposer une PR

1. **Fork** le repo
2. Crée une branche : `git checkout -b feat/<nom>`
3. Si tu touches au modèle, **inclus une métrique de régression** (score moyen avant/après sur `examples/`)
4. Commit clair, PR vers `main`

## 🧪 Tests

```bash
npm test
```

Lance `node index.js analyze examples/clean.js` et `examples/messy.js` après chaque modif — si le delta change de plus de ±10 points sans justification, il y a un souci.

## 📜 Licence

MIT.
