# analysis/

Revue de code + dashboard dynamique intégré au CLI JS-Ranker.

## Deux modes d'utilisation

### 1. Via le CLI racine (intégration transparente)

Le dashboard est désormais le rendu par défaut des commandes `url`, `analyze`, `snippet` d'`index.js` :

```bash
node index.js analyze src/features.js
node index.js url https://github.com/user/repo
node index.js url https://raw.githubusercontent.com/.../file.js
node index.js snippet 'function f(x){return x*2}'
node index.js examples/perfect.js       # shortcut direct
```

Le score affiché vient du **modèle ML entraîné** (si disponible), la grille de critères vient du mapping heuristique des 16 features AST.

Pour revenir à l'ancienne UI : ajouter `--legacy`.

```bash
node index.js analyze src/features.js --legacy
node index.js url <repo> --legacy
```

### 2. En standalone

```bash
node analysis/dashboard.js                       # analyse src/features.js
node analysis/dashboard.js examples/spaghetti.js
node analysis/dashboard.js file.js --json        # JSON au lieu du dashboard
node analysis/dashboard.js file.js --save        # écrit analysis-output.json
```

En standalone, le score est heuristique (moyenne pondérée des 9 critères), pas ML.

## Fichiers

| Fichier | Rôle |
|---|---|
| `pipeline.js` | Pipeline complet — fetch (URL/repo/fichier) -> ML -> dashboard. Utilisé par `index.js`. |
| `generate.js` | Mapping 16 features AST -> 9 critères + templates de strengths/weaknesses. |
| `render-terminal.js` | Renderer ANSI (grille 3x3, progress bars, boîtes côte à côte). |
| `dashboard.js` | CLI standalone (sans ML). |
| `features.cleaned.js` | Version nettoyée de `src/features.js` (745 -> 525 lignes, logique identique). |
| `parity-test.js` | Vérifie que `features.cleaned.js` et `src/features.js` sont équivalents sur 5 samples. |
| `analysis-output.json` | Cache du dernier dashboard sauvegardé via `--save`. |
| `dataset-sample.strict.json` | Format strict ML-ready de l'analyse initiale. |

## Schéma du dashboard

Score global (0–5), verdict (EXCELLENT / GOOD / AVERAGE / POOR / CRITICAL), puis grille de 9 critères :

| Critère | Dérivé de |
|---|---|
| Naming quality | F3 (namingRatio) |
| Modularity / SRP | F5 + F16 (modularity + cyclomatic density) |
| Function length | F14 (longueur idéale 8–25) |
| Modern JS usage | F11 (destructuring, spread, template) |
| Cyclomatic cx | inv(F1) |
| Nesting depth | inv(F2) |
| Error handling | F13 (try/catch, throw new Error) |
| Purity / effects | F15 (mutations globales + param) |
| Maintainability | F6 + F12 + inv(F9) + inv(F10) |

Les 2 plus hautes pct -> strengths. Les 2 plus basses -> weaknesses.

## Score standalone vs ML

- **Standalone** (`node analysis/dashboard.js ...`) : score = somme pondérée des 9 critères × 5. Reproductible, déterministe, pas besoin du modèle.
- **Via index.js** : score = prédiction du modèle TensorFlow (chargé depuis `models/js-ranker/`). Les critères restent heuristiques (vue analytique complémentaire).

Si le modèle n'est pas entraîné, `pipeline.js` bascule automatiquement sur le score heuristique avec un warning.
