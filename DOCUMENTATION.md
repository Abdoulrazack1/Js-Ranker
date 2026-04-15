# Documentation Technique : JS-Ranker v2.1

**Date :** 14 Avril 2026  
**Version :** 2.1

---

## 1. Introduction

JS-Ranker v2.1 est un moteur de notation de code JavaScript basé sur le Machine Learning, conçu pour évaluer la qualité structurelle et la maintenabilité des fonctions et fichiers JavaScript. Contrairement aux linters traditionnels qui appliquent des règles binaires, JS-Ranker utilise un modèle de régression pour attribuer une note continue de 0.0 à 5.0.

La v2.1 introduit **5 nouvelles features AST** (10 au total), une **architecture de réseau étendue**, une **API REST intégrée**, une **intégration GitHub Actions**, et un système de **conseils de refactoring détaillés**.

### 1.1. Nouveautés v2.1

| Composant | v2.0 | v2.1 |
|---|---|---|
| Features AST | 5 | **10** |
| Architecture modèle | 5→12→1 | **10→16→8→1** |
| Conseils refactoring | 1 conseil | **3 conseils prioritisés** |
| API REST | ✗ | **✓ `server.js`** |
| GitHub Actions | ✗ | **✓ Quality Gate CI/CD** |
| Migration dataset | Manuel | **Automatique (`migrate-dataset.js`)** |

---

## 2. Architecture Technique

```
Entrée (code JS)
      │
      ▼
┌─────────────┐     ┌──────────────────┐
│   Fetcher   │────▶│  AST (acorn)     │
│ URL/fichier │     │  10 features     │
└─────────────┘     └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Modèle TF.js    │
                    │  10→16→8→1       │
                    └────────┬─────────┘
                             │ score [0–5]
                    ┌────────▼─────────┐
                    │  Zen Console     │
                    │  3 conseils      │
                    └──────────────────┘
```

### Modules

| Fichier | Rôle |
|---|---|
| `src/features.js` | Extraction des 10 métriques AST |
| `src/model.js` | Architecture réseau `10→16→8→1` |
| `src/train.js` | Pipeline d'entraînement avec auto-migration |
| `src/ui.js` | Zen Console + `getDetailedAdvice()` |
| `migrate-dataset.js` | Migration dataset 5→10 features |
| `server.js` | API REST HTTP (`/analyze`, `/status`) |
| `generate-dataset.js` | Collecte massive via GitHub API |
| `.github/workflows/js-ranker-ci.yml` | Quality Gate CI/CD |

---

## 3. Les 10 Features AST

Toutes les features sont normalisées dans l'intervalle `[0.0, 1.0]`.

### Features Originales (F1–F5)

| # | Feature | Formule | Interprétation |
|---|---|---|---|
| F1 | **Complexité Cyclomatique** | `min(branches / 20, 1.0)` | Élevé = MAUVAIS |
| F2 | **Imbrication Maximale** | `min(maxDepth / 8, 1.0)` | Élevé = MAUVAIS |
| F3 | **Ratio de Nommage** | `namedVars / totalVars` | Élevé = BON |
| F4 | **Linéarité** | `max(0, 1 - \|ratio - 1.5\| / 5)` | Proche 1 = BON |
| F5 | **Modularité** | `max(0, 1 - paramCount / 7)` | Élevé = BON |

### Nouvelles Features (F6–F10)

| # | Feature | Formule | Interprétation |
|---|---|---|---|
| F6 | **Comment Ratio** | `min(commentLines / nonEmptyLines, 1.0)` | Élevé = BON (code documenté) |
| F7 | **Return Complexity** | `min(returnCount / 8, 1.0)` | Élevé = MAUVAIS (trop de sorties) |
| F8 | **Async/Await** | `1.0` si async+await, `0.5` si l'un seulement, `0.0` sinon | Élevé = BON (code moderne) |
| F9 | **Magic Numbers** | `min(magicCount / 10, 1.0)` | Élevé = MAUVAIS (ex: `if (x > 42)`) |
| F10 | **Chain Length** | `min(maxChain / 6, 1.0)` | Élevé = MAUVAIS (ex: `a.b().c().d()`) |

**Détection des nombres magiques :** les valeurs `0`, `1`, `-1`, `2`, `100`, `1000` sont considérées comme courantes et exclues du comptage.

---

## 4. Modèle de Machine Learning

### 4.1. Architecture v2.1

```
Input (10)  →  Dense(16, relu)  →  Dropout(0.15)  →  Dense(8, relu)  →  Dense(1, linear)
```

| Couche | Unités | Activation | Rôle |
|---|---|---|---|
| Entrée | 10 | — | 1 neurone par feature normalisée |
| Cachée 1 | 16 | `relu` | Corrélations non-linéaires primaires |
| Dropout | — | — | Désactive 15% des neurones (anti-overfitting) |
| Cachée 2 | 8 | `relu` | Abstraction de 2e ordre |
| Sortie | 1 | `linear` | Score brut → clampé `[0, 5]` |

### 4.2. Hyperparamètres

| Hyperparamètre | Valeur (classique) | Valeur (streaming) |
|---|---|---|
| Optimizer | Adam | Adam |
| Learning Rate | 0.01 | 0.02 |
| Epochs | 300 | 500 |
| Batch Size | 8 | 32 |
| Loss | MSE | MSE |
| Metric | MAE | MAE |
| Validation Split | 15% | 10% |

---

## 5. Dataset d'Entraînement

### 5.1. Format v2.1

```json
{
  "version": "2.1",
  "schema": {
    "features": [
      "cyclomaticComplexity", "maxNesting", "namingRatio",
      "linearity", "modularity",
      "commentRatio", "returnComplexity", "asyncAwait",
      "magicNumbers", "chainLength"
    ]
  },
  "samples": [
    {
      "id": "perfect_001",
      "score": 5.0,
      "code": "function calculateTotalPrice(items, taxRate) { ... }",
      "features": [0.05, 0.1, 1.0, 0.9, 0.8, 0.0, 0.125, 0.0, 0.0, 0.0],
      "verdict": "ELEGANT"
    }
  ]
}
```

### 5.2. Migration 5→10 features

```bash
node migrate-dataset.js              # migre dataset.json (avec backup auto)
node migrate-dataset.js --dry-run    # simulation sans écriture
node migrate-dataset.js --in autre.json --out migré.json
```

### 5.3. Génération massive (GitHub API)

```bash
node generate-dataset.js --max 2000 --token ghp_xxx --out dataset-large.json
node index.js stream-train dataset-large.json
```

---

## 6. Explicabilité & Conseils de Refactoring

La v2.1 expose jusqu'à **3 conseils prioritisés** par ordre de sévérité via `getDetailedAdvice(score, details)`.

### Exemple de sortie

```
  Conseils de Refactoring
  ────────────────────────────────────────────────────
  🔧 Guard clauses → réduire la complexité cyclomatique
      ↳ 17 branches logiques
  💡 Nommage explicite → renommer les variables courtes
      ↳ 3/11 variables bien nommées
  📌 Constantes nommées → remplacer les nombres magiques
      ↳ 6 littéraux numériques
```

### Matrice des conseils

| Feature problématique | Conseil généré |
|---|---|
| F1 cyclomatique élevée | Guard clauses & early return |
| F2 imbrication profonde | Extract function |
| F3 nommage faible | Renommer les variables courtes |
| F5 trop d'arguments | Regrouper en objet options |
| F6 pas de commentaires | Ajouter JSDoc |
| F7 trop de return | Unifier les points de sortie |
| F9 nombres magiques | Déclarer des constantes nommées |
| F10 chaînes longues | Variables intermédiaires |

---

## 7. API REST

### Démarrage

```bash
node server.js              # port 3000 par défaut
node server.js --port 8080  # port personnalisé
PORT=4000 node server.js    # via variable d'environnement
```

### Endpoints

#### `POST /analyze`

Analyse un snippet de code JS.

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "const add = (a, b) => a + b;"}'
```

**Réponse :**
```json
{
  "score": 4.87,
  "verdict": "ÉLÉGANT",
  "emoji": "✨",
  "source": "snippet",
  "features": {
    "cyclomaticComplexity": { "raw": 0, "normalized": 0 },
    "namingRatio": { "named": 2, "total": 2, "normalized": 1 },
    "asyncAwait": { "hasAsync": false, "hasAwait": false, "normalized": 0 }
  },
  "advice": [
    { "message": "Code exemplaire. Excellent travail ! 🎉", "context": null }
  ],
  "analyzedAt": "2026-04-14T10:00:00.000Z"
}
```

#### `POST /analyze/url`

```bash
curl -X POST http://localhost:3000/analyze/url \
  -d '{"url": "https://raw.githubusercontent.com/user/repo/main/index.js"}'
```

#### `GET /status`

```bash
curl http://localhost:3000/status
```

#### `GET /health`

```bash
curl http://localhost:3000/health
# → {"ok":true,"uptime":"42.3s"}
```

---

## 8. Intégration GitHub Actions

Le fichier `.github/workflows/js-ranker-ci.yml` définit deux jobs :

### Job 1 — Quality Gate (tous les push/PR)

1. Détecte les fichiers JS modifiés dans le commit
2. Analyse chaque fichier avec `node index.js analyze`
3. Vérifie le score minimum contre deux seuils :

| Seuil | Comportement |
|---|---|
| Score ≥ 2.5 | ✅ Gate passé |
| 1.8 ≤ Score < 2.5 | ⚠️ Warning (merge autorisé) |
| Score < 1.8 | ❌ Gate échoué (bloque le merge) |

4. Poste un commentaire récapitulatif sur la PR :

```
## ✅ JS-Ranker Quality Gate — PASSÉ

| Fichier         | Score        | Verdict  |
|-----------------|--------------|----------|
| `src/index.js`  | 🟢 4.2 / 5.0 | ROBUSTE  |
| `src/utils.js`  | 🟡 2.8 / 5.0 | CORRECT  |

Score minimum : 2.8 / 5.0
```

### Job 2 — Model Check (push vers main uniquement)

- Re-migre le dataset et réentraîne le modèle
- Vérifie que la MAE finale est ≤ 0.8
- Archive le modèle entraîné comme artifact GitHub

---

## 9. Installation et Utilisation

### 9.1. Installation

```bash
git clone <URL_DU_DEPOT>
cd js-ranker
npm install

# Première utilisation
node migrate-dataset.js   # migre le dataset vers 10 features
npm run train             # entraîne le modèle (~15-30s)
node index.js status      # vérifie
```

### 9.2. Commandes CLI

```bash
node index.js <fichier.js>          # analyse rapide
node index.js analyze <fichier.js>  # analyse détaillée
node index.js url <url>             # analyse depuis URL
node index.js snippet "<code>"      # analyse snippet inline
node index.js train                 # réentraîner
node index.js stream-train <url>    # entraîner depuis dataset distant
node index.js status                # état du modèle
```

### 9.3. API REST

```bash
node server.js                      # démarre l'API sur :3000
node server.js --port 8080          # port personnalisé
```

### 9.4. Génération de dataset massif

```bash
# Sans token GitHub (60 req/h → ~300 samples)
node generate-dataset.js

# Avec token GitHub (5000 req/h → plusieurs milliers)
node generate-dataset.js --max 5000 --token ghp_xxx

# Puis entraîner
node index.js stream-train dataset-large.json
```

---

## 10. Structure des Fichiers

```
js-ranker/
├── index.js                          # CLI principal
├── server.js                         # API REST
├── migrate-dataset.js                # Migration 5→10 features
├── generate-dataset.js               # Collecte dataset GitHub API
├── package.json
├── dataset.json                      # Dataset v2.1 (10 features)
├── DOCUMENTATION.md
├── src/
│   ├── features.js                   # 10 métriques AST
│   ├── model.js                      # Architecture 10→16→8→1
│   ├── train.js                      # Pipeline entraînement v2.1
│   ├── stream-trainer.js             # Entraînement dataset distant
│   ├── analyze.js                    # Orchestration analyse
│   ├── decomposer.js                 # Isolation fonctions
│   ├── fetcher.js                    # Récupération URL/GitHub
│   ├── ui.js                         # Zen Console + getDetailedAdvice
│   ├── model-io.js                   # Sauvegarde/chargement modèle
│   └── tf-setup.js                   # Backend TF.js CPU
├── examples/
│   ├── perfect.js
│   ├── average.js
│   └── spaghetti.js
├── models/js-ranker/
│   ├── model.json
│   ├── weights.bin
│   └── training-meta.json
└── .github/workflows/
    └── js-ranker-ci.yml              # Quality Gate CI/CD
```

---

## 11. Feuille de Route

| Priorité | Feature | Statut |
|---|---|---|
| ✅ | 10 features AST | v2.1 |
| ✅ | Architecture 10→16→8→1 | v2.1 |
| ✅ | Conseils refactoring enrichis | v2.1 |
| ✅ | API REST | v2.1 |
| ✅ | GitHub Actions Quality Gate | v2.1 |
| 🔜 | Extension VS Code | v3.0 |
| 🔜 | Support TypeScript | v3.0 |
| 🔜 | Git hooks pre-commit | v3.0 |
| 🔜 | Dashboard web (React) | v3.0 |
