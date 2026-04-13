# 🧠 JS-Ranker — Moteur de Notation ML pour JavaScript

> Un moteur de régression TensorFlow.js qui analyse le code JavaScript via l'AST et lui attribue une note de **0.0 à 5.0**, corrélant des métriques structurelles avec une appréciation humaine de la qualité.

---

## Table des Matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture du Projet](#architecture-du-projet)
3. [Installation](#installation)
4. [Utilisation](#utilisation)
5. [Pipeline ML — Explication Détaillée](#pipeline-ml--explication-détaillée)
6. [Les 5 Features AST](#les-5-features-ast)
7. [Architecture du Modèle](#architecture-du-modèle)
8. [Dataset d'Entraînement](#dataset-dentraînement)
9. [La Zen Console](#la-zen-console)
10. [Évolutions Possibles](#évolutions-possibles)
11. [Pourquoi ce Projet ?](#pourquoi-ce-projet-)

---

## Vue d'ensemble

JS-Ranker est un outil CLI qui combine :

- **Analyse statique d'AST** via `acorn` pour extraire 5 métriques quantitatives
- **Régression ML** via TensorFlow.js (réseau de neurones séquentiel)
- **UI Zen Console** avec barre de progression colorée et verdict en un mot

```
node index.js examples/perfect.js
```

```
  ╔══════════════════════════════════════════════╗
  ║     ⚡  JS-RANKER  v1.0  — Zen Console       ║
  ╚══════════════════════════════════════════════╝

  ┌────────────────────────────────────────────────────┐
  │  🧠  JS-RANKER — Analyse Complète                  │
  ├────────────────────────────────────────────────────┤
  │  Fichier : perfect.js                              │
  ├────────────────────────────────────────────────────┤
  │                                                    │
  │       ★★★★★   4.72 / 5.0                          │
  │                                                    │
  │  ████████████████████████████████░░░░             │
  │                                                    │
  │       ✨  ÉLÉGANT                                  │
  │                                                    │
  ├────────────────────────────────────────────────────┤
  │  Métriques AST                                     │
  ├────────────────────────────────────────────────────┤
  │  Complexité Cyclo.    ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪  95%   │
  │  Imbrication Max.     ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪  98%   │
  │  Ratio Nommage        ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ 100%   │
  │  Linéarité            ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪░░░░  80%   │
  │  Modularité           ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪░░░  85%   │
  └────────────────────────────────────────────────────┘
```

---

## Architecture du Projet

```
js-ranker/
│
├── index.js                  # Point d'entrée CLI (Commander.js)
├── package.json              # Dépendances npm
├── dataset.json              # 18 exemples annotés avec scores humains
│
├── src/
│   ├── features.js           # Extraction AST (acorn + acorn-walk)
│   ├── model.js              # Définition + utilitaires TensorFlow.js
│   ├── train.js              # Pipeline d'entraînement complet
│   ├── analyze.js            # Orchestration analyse + inférence
│   ├── ui.js                 # Zen Console (chalk + cli-progress)
│   └── demo.js               # Démo sans modèle pré-entraîné
│
├── models/
│   └── js-ranker/            # Modèle sauvegardé après npm run train
│       ├── model.json
│       ├── weights.bin
│       └── training-meta.json
│
└── examples/
    ├── perfect.js            # Code exemplaire (score ~4.5-5.0)
    ├── average.js            # Code moyen (score ~2.0-3.0)
    └── spaghetti.js          # Code catastrophique (score ~0.5-1.5)
```

---

## Installation

### Prérequis

- Node.js ≥ 18.x
- npm ≥ 9.x

### Étapes

```bash
# 1. Cloner ou télécharger le projet
cd js-ranker

# 2. Installer les dépendances
npm install

# 3. Entraîner le modèle ML (obligatoire avant la première analyse)
npm run train

# 4. Analyser un fichier
node index.js examples/perfect.js
```

---

## Utilisation

### Analyser un fichier JavaScript

```bash
node index.js analyze examples/perfect.js
# Raccourci :
node index.js examples/perfect.js
```

### Analyser un snippet de code inline

```bash
node index.js snippet "const add = (a, b) => a + b"
```

### Vérifier l'état du modèle

```bash
node index.js status
```

### Lancer la démonstration complète

```bash
npm run demo
```

---

## Pipeline ML — Explication Détaillée

```
Code JS Source
     │
     ▼
┌─────────────────────────────────────────────┐
│         1. Parsing AST (acorn)              │
│   code → Abstract Syntax Tree (JSON)        │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│      2. Extraction de Features (acorn-walk) │
│                                             │
│  AST → [5 nombres entre 0.0 et 1.0]        │
│                                             │
│  [cyclomatique, imbrication, nommage,       │
│   linéarité, modularité]                   │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│      3. Réseau de Neurones (TF.js)          │
│                                             │
│  Input(5) → Dense(12, relu) →               │
│  Dropout(0.1) → Dense(1, linear)            │
│                                             │
│  → Sortie brute (ex: 4.28)                 │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│      4. Clamping + Affichage                │
│                                             │
│  clamp(rawScore, 0.0, 5.0) → 4.28          │
│  → Zen Console + Progress Bar               │
└─────────────────────────────────────────────┘
```

### Pourquoi la normalisation est critique ?

Toutes les features sont normalisées entre **0.0 et 1.0** avant d'entrer dans le réseau. Sans normalisation, une feature comme "nombre de lignes" (valeur 50-200) dominerait numériquement les autres features (valeurs 0-5), rendant l'apprentissage instable.

```
Cyclomatique brut = 7 branchements → normalisé = 7/20 = 0.35
Imbrication brute = 3 niveaux     → normalisé = 3/8  = 0.375
```

---

## Les 5 Features AST

### Feature 1 — Complexité Cyclomatique

**Ce que c'est :** Le nombre de chemins d'exécution indépendants dans la fonction.

**Comment on le mesure :** On compte les nœuds AST qui créent des branches :
`IfStatement`, `ConditionalExpression`, `SwitchCase`, `ForStatement`, `WhileStatement`, `LogicalExpression`, `CatchClause`

**Normalisation :** `min(rawCount / 20, 1.0)`  
Un score de 20 branchements ou plus → feature = 1.0 (pire possible)

**Impact sur la note :** Une complexité élevée → **note basse**

```javascript
// Cyclomatique = 1 (score élevé = bon)
function add(a, b) { return a + b; }

// Cyclomatique = 4 (if + for + if + else)
function f(data, flag) {
  if (flag) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0) { ... } else { ... }
    }
  }
}
```

---

### Feature 2 — Imbrication Maximale

**Ce que c'est :** La profondeur maximale des blocs de code imbriqués.

**Comment on le mesure :** Via `acorn-walk.ancestor` — on compte les ancêtres qui sont des nœuds de contrôle de flux (`IfStatement`, `ForStatement`, `WhileStatement`, `BlockStatement`...) pour chaque `BlockStatement`.

**Normalisation :** `min(maxDepth / 8, 1.0)`  
8 niveaux ou plus → feature = 1.0 (pire possible)

**Impact sur la note :** Imbrication profonde → **note basse**

```javascript
// Nesting = 1 (bon)
function check(x) {
  if (x > 0) { return true; }
}

// Nesting = 4 (mauvais)
function f(a, b, c) {
  for (...) {         // niveau 1
    if (...) {        // niveau 2
      while (...) {   // niveau 3
        if (...) { }  // niveau 4
      }
    }
  }
}
```

---

### Feature 3 — Ratio de Nommage

**Ce que c'est :** Le pourcentage de variables et paramètres ayant un nom **significatif** (longueur > 3 caractères, hors `i`, `j`, `k`, `x`, `y`, `z`).

**Comment on le mesure :** On parcourt tous les `VariableDeclarator` et les paramètres de fonction. On exclut les noms triviaux (`i`, `j`, `k`, `x`, `y`, `z`, `n`, `m`, `e`, `t`).

**Normalisation :** `namedVars / totalVars` (déjà entre 0 et 1)

**Impact sur la note :** Bon nommage → **note haute**

```javascript
// Ratio = 1.0 (parfait)
function getUserById(userId, includeProfile) {
  const userData = fetchUser(userId);
  return userData;
}

// Ratio = 0.0 (terrible)
function f(a, b) {
  let x = a + b;
  return x;
}
```

---

### Feature 4 — Linéarité

**Ce que c'est :** Mesure si le code est trop dense (trop d'instructions par ligne) ou trop dilué (trop de lignes vides/commentaires). Détecte les one-liners illisibles et le code excessivement verbeux.

**Comment on le mesure :**  
`ratio = nbLignes / nbNœudsAST`

Un ratio idéal est autour de **1.0 à 2.0** lignes par nœud AST.

**Normalisation :** `max(0, 1 - |ratio - 1.5| / 5)`

**Impact sur la note :** Ratio équilibré → **note haute**

---

### Feature 5 — Modularité

**Ce que c'est :** Le nombre d'arguments de la fonction. Trop d'arguments indique une fonction qui fait trop de choses à la fois (violation du principe de responsabilité unique).

**Comment on le mesure :** On compte les `params` de la fonction principale détectée dans l'AST.

**Normalisation :** `max(0, 1 - paramCount / 7)`  
7 arguments ou plus → feature = 0.0 (pire possible)

**Impact sur la note :** Peu d'arguments → **note haute**

```javascript
// Modularité = 1.0 (0 argument, parfait)
const getTimestamp = () => Date.now();

// Modularité = 0.71 (2 arguments, bon)
const add = (a, b) => a + b;

// Modularité = 0.0 (7 arguments, critique)
function f(a, b, c, d, e, f, g) { ... }
```

---

## Architecture du Modèle

### Réseau de Neurones Séquentiel

```
Input Layer        Hidden Layer         Output Layer
[5 neurones]  →   [12 neurones]    →   [1 neurone]
                   activation: relu     activation: linear
                        │
                   Dropout(0.1)
                   (évite overfitting)
```

### Pourquoi ces choix ?

| Composant | Choix | Raison |
|-----------|-------|--------|
| **Couche cachée** | 12 neurones, ReLU | Suffit pour 5 features, évite la vanishing gradient |
| **Dropout 0.1** | 10% des neurones désactivés | Régularisation légère sur un petit dataset |
| **Sortie Linear** | 1 neurone, pas de borne | Régression libre, clamping en JS post-prédiction |
| **Optimizer Adam** | lr=0.01 | Adaptatif, converge vite sur petit dataset |
| **Loss MSE** | Mean Squared Error | Standard pour la régression |
| **Métrique MAE** | Mean Absolute Error | Plus lisible : "erreur moyenne en points de score" |

### Pourquoi `linear` en sortie et pas `sigmoid` ?

Une activation `sigmoid` bornerait la sortie entre 0 et 1, pas entre 0 et 5.  
Une activation `linear` (pas d'activation = sortie brute) permet au modèle d'apprendre n'importe quelle valeur.  
On applique ensuite un **clamping** en JavaScript : `Math.min(5.0, Math.max(0.0, rawScore))`.

---

## Dataset d'Entraînement

Le fichier `dataset.json` contient **18 exemples** annotés manuellement, répartis en 4 catégories :

### Distribution des scores

```
Score 4.5 - 5.0  ████████████   5 exemples  — Code ÉLÉGANT
Score 3.0 - 4.5  ████████████   5 exemples  — Code ROBUSTE/CORRECT
Score 2.0 - 3.0  ██████████     4 exemples  — Code BROUILLON/MESSY
Score 0.0 - 2.0  ██████████     4 exemples  — Code CRITIQUE/SPAGHETTI
```

### Exemples Représentatifs

**Score 5.0 — Code parfait**
```javascript
function calculateTotalPrice(items, taxRate) {
  return items.reduce((total, item) => total + item.price * (1 + taxRate), 0);
}
// → Features: [0.05, 0.10, 1.00, 0.90, 0.80]
```

**Score 2.5 — Code moyen**
```javascript
function process(data1, data2, flag) {
  let result = [];
  if (flag) {
    for (let i = 0; i < data1.length; i++) {
      if (data1[i] > 0) {
        result.push(data1[i] * data2);
      } else {
        result.push(0);
      }
    }
  }
  return result;
}
// → Features: [0.50, 0.55, 0.30, 0.50, 0.55]
```

**Score 0.5 — Spaghetti**
```javascript
function f(a,b,c,d,e,f) {
  let x=0;
  for(let i=0;i<a.length;i++) {
    for(let j=0;j<b.length;j++) {
      if(a[i]>0) { if(b[j]>0) { if(c) {
        for(let k=0;k<d.length;k++) {
          if(d[k]===a[i]) { x+=e?a[i]*b[j]:b[j]; }
          else { if(f>0) { x-=1; } else { x+=0.5; } }
        }
      }}}
    }
  }
  return x;
}
// → Features: [0.95, 0.95, 0.05, 0.10, 0.00]
```

### Améliorer le Dataset

Plus vous avez d'exemples, plus le modèle sera précis. Pour ajouter un exemple :

```json
{
  "id": "custom_001",
  "label": "Description de la fonction",
  "score": 3.7,
  "code": "function myFunc(param) { ... }",
  "features": [0.2, 0.3, 0.8, 0.7, 0.85],
  "verdict": "ROBUST"
}
```

**Note :** Les features dans le JSON ne sont pas utilisées à l'entraînement — elles sont recalculées dynamiquement à partir du code. Vous pouvez les laisser à zéro.

---

## La Zen Console

### Palette de Couleurs

| Score | Couleur | Signification |
|-------|---------|---------------|
| > 4.0 | 🩵 Cyan Émeraude | Code parfait |
| 2.5 - 4.0 | 💙 Bleu Calme | Code propre |
| 1.5 - 2.5 | 🟨 Ambre | Code à refactoriser |
| < 1.5 | 🪸 Corail | Code critique |

### Verdicts

| Score | Verdict | Emoji |
|-------|---------|-------|
| ≥ 4.5 | ÉLÉGANT | ✨ |
| ≥ 4.0 | ROBUSTE | 🔷 |
| ≥ 3.5 | SOLIDE | 🟦 |
| ≥ 3.0 | CORRECT | 🟨 |
| ≥ 2.5 | FONCTIONNEL | 🟧 |
| ≥ 2.0 | BROUILLON | ⚠️ |
| ≥ 1.5 | CHAOTIQUE | 🔶 |
| ≥ 1.0 | CRITIQUE | 🔴 |
| < 1.0 | SPAGHETTI | 💀 |

### Conseils Automatiques

JS-Ranker identifie automatiquement la feature la plus problématique et propose un conseil ciblé :

```
Conseil : Réduire les conditions imbriquées → Guard clauses
Conseil : Renommer les variables : a, b, x → noms explicites
Conseil : Trop d'arguments → Utiliser un objet paramètre
```

---

## Évolutions Possibles

### Court terme — Plus de données

Le modèle avec 18 exemples est une preuve de concept. Pour une précision industrielle :

- **100+ exemples** d'open source bien noté (axios, lodash, chalk)
- **Web scraping automatique** de fonctions GitHub avec leurs scores ESLint

### Moyen terme — Plus de features

```javascript
// Features supplémentaires à extraire de l'AST :
const additionalFeatures = [
  'commentRatio',        // Lignes de commentaires / total
  'returnComplexity',    // Nombre de points de retour (return multiples)
  'hasAsyncAwait',       // Utilisation de async/await vs callbacks
  'magicNumbers',        // Constantes littérales non nommées (0, 1, 42...)
  'chainLength',         // Profondeur des chaînes (a.b.c.d.e)
];
```

### Long terme — Explication des notes

```
Score : 3.8/5 — SOLIDE

Pourquoi pas 5/5 ?
  ├─ Complexité Cyclomatique trop élevée (-0.8 pts)
  │   → 4 if imbriqués détectés
  │   → Suggestion : Guard clauses ou switch
  └─ Nommage à améliorer (-0.4 pts)
      → Variables "data", "result", "temp" trop génériques
      → Suggestion : Renommer selon le domaine métier
```

### Intégration IDE

- **Extension VS Code** : Note en temps réel dans la barre de statut
- **Git Hook pre-commit** : Bloque les commits si score < 2.5
- **GitHub Action** : Rapport de qualité ML sur chaque Pull Request

---

## Pourquoi ce Projet ?

### Régression vs Classification

La plupart des tutoriels ML enseignent la **classification** (vrai/faux, chat/chien).  
JS-Ranker utilise la **régression** : prédire une valeur continue de 0.0 à 5.0.

C'est plus difficile, plus riche, et beaucoup plus représentatif des problèmes ML réels (prédiction de prix, scores de recommandation, évaluation de risque).

### Maîtrise de l'AST

L'Abstract Syntax Tree est la représentation structurée du code source. Savoir le parcourir avec `acorn` est une compétence de **développeur senior** utilisée dans :

- Babel (transpilation ES6+)
- ESLint (analyse statique)
- Prettier (formatage automatique)
- TypeScript (vérification de types)

### Technologies

| Technologie | Rôle |
|-------------|------|
| `acorn` | Parser JavaScript → AST |
| `acorn-walk` | Visiteur de nœuds AST |
| `@tensorflow/tfjs-node` | Réseau de neurones (CPU) |
| `chalk` | Couleurs terminal |
| `cli-progress` | Barre de progression |
| `commander` | CLI robuste |

---

## Licence

MIT — Libre d'utilisation, modification et distribution.

---

*JS-Ranker v1.0 — Fait avec 🧠 + ☕*

---

## Addendum v2 — Architecture Cloud-Ready

### 1. Pipeline In-Memory (Zéro Disque)

```
URL GitHub/GitLab/CDN
         │
         ▼
  ┌─────────────────┐
  │  src/fetcher.js │  → résolution URL + fetch HTTP en Buffer RAM
  └────────┬────────┘    aucun fichier temporaire, aucun fs.write
           │
           ▼
  ┌──────────────────────┐
  │  src/decomposer.js   │  → parse AST, isole chaque FunctionDeclaration
  │                      │    + ArrowFunctionExpression + méthodes
  └────────┬─────────────┘    tout en RAM
           │
           ▼  (pour chaque fonction)
  ┌─────────────────┐
  │  src/features.js│  → 5 métriques normalisées depuis slice AST
  └────────┬────────┘
           │
           ▼
  tf.tidy(() => predict())  → libération immédiate des tenseurs
           │
           ▼
  ┌──────────────────────┐
  │  Agrégation pondérée │  → score global + malus/bonus scope
  └────────┬─────────────┘
           │
           ▼
  Zen Console — Rapport Fichier Complet
```

### 2. Analyse de Fichiers Complets

JS-Ranker v2 ne note **jamais** un fichier entier comme un bloc.

**Algorithme d'agrégation :**

```
score_global = moyenne_pondérée(scores_fonctions, poids=nb_lignes)
             + ajustement_scope_global(-10% à +10%)
```

**Score du scope global** examine :
- Densité du code hors-fonctions (trop de code global → malus)
- Variables `var` au scope global (→ malus)
- Mutations directes de variables globales (→ fort malus)
- Présence d'un en-tête de fichier (→ bonus)
- Exports propres `module.exports = {}` (→ bonus)

### 3. Streaming Trainer — Dataset Distant

```bash
# Entraîner depuis un dataset GitHub (JSON brut)
node index.js stream-train https://raw.githubusercontent.com/you/datapool/main/dataset.json

# Entraîner depuis un fichier local volumineux
node index.js stream-train ./my-big-datapool.json --epochs 800
```

**Format du datapool distant** :
```json
{
  "samples": [
    {
      "id": "sample_001",
      "score": 4.2,
      "code": "function myFunc(param) { return param.map(x => x * 2); }"
    }
  ]
}
```

Si `code` est présent → les features sont **recalculées en live** via AST.  
Si seulement `features` est présent → les valeurs JSON sont utilisées directement.

**Courbe de loss en temps réel :**
```
  Progression  ████████████████████████████████░░░░░░░░░░░░░  68%
  Epoch 340/500  │  Loss: 0.041823  │  MAE: 0.1824  │  4.2s

  0.842 ┐ ·········································
        │ ····································
        │ ·······························
        │ ·····················
        │ ···············
        │ ·········
        │ ···██████████████████████████████████████
  0.041 ┘
              └──────────────────────────────────────
              Epoch 1                          Epoch 340
```

### 4. Nouvelles Commandes CLI

```bash
# Analyser une URL GitHub directement (blob ou raw)
node index.js url https://github.com/user/repo/blob/main/utils.js

# Analyser n'importe quoi (auto-détection URL/fichier/snippet)
node index.js auto https://raw.githubusercontent.com/lodash/lodash/main/chunk.js

# Entraînement streaming depuis URL
node index.js stream-train https://your-server.com/datapool.json

# Raccourci direct (auto-détection)
node index.js https://github.com/user/repo/blob/main/index.js
node index.js myfile.js
```

### 5. Transformateurs d'URL supportés

| Plateforme | URL d'entrée | URL résolue |
|-----------|-------------|-------------|
| **GitHub** | `github.com/user/repo/blob/main/file.js` | `raw.githubusercontent.com/user/repo/main/file.js` |
| **GitLab** | `gitlab.com/user/repo/-/blob/main/file.js` | `gitlab.com/user/repo/-/raw/main/file.js` |
| **jsDelivr** | `cdn.jsdelivr.net/npm/lodash/chunk.js` | identique (déjà raw) |
| **unpkg** | `unpkg.com/axios/dist/axios.js` | identique (déjà raw) |
| **Bitbucket** | `bitbucket.org/user/repo/src/main/file.js` | API Bitbucket 2.0 |

### 6. Nouveaux Fichiers

```
src/
├── fetcher.js         # NEW — Fetch in-memory URL + résolution platforms
├── decomposer.js      # NEW — Décomposition AST + agrégation pondérée
└── stream-trainer.js  # NEW — Entraînement dataset distant + loss curve
```
