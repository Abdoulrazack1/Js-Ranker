# Dev.to — Article technique

**Titre :** Can Machine Learning Score Your JavaScript Code Quality? Building Js-Ranker with TensorFlow.js + Acorn AST
**Tags :** `javascript`, `machinelearning`, `webdev`, `tensorflowjs`
**Canonical URL :** https://github.com/Abdoulrazack1/Js-Ranker

---

## Plan

### 1. Le problème avec ESLint
- ESLint = règles binaires (pass/fail)
- Difficile de mesurer la qualité **globale** d'une fonction
- Codacy, Sonar, CodeClimate font ça mais SaaS / payant / opaque

### 2. L'idée
- Score continu 0-100 par fonction
- Apprendre les coefficients depuis un dataset annoté → re-trainable sur ton style

### 3. Les 10 features AST (le cœur du sujet)
- F1 Cyclomatic complexity (McCabe)
- F2 Max nesting
- F3 Naming ratio (descriptive vs single-letter)
- F4 Linearity (inverse de complexity)
- F5 Modularity (nb args)
- F6 Comment ratio
- F7 Return complexity
- F8 Async/await usage
- F9 Magic numbers
- F10 Chain length

Pour chacune : pourquoi je l'ai choisie, comment je l'extrait avec Acorn, exemples haut/bas score.

### 4. Le modèle TF.js
- Architecture : simple MLP (3 layers, ReLU, sigmoid output)
- Pourquoi pas plus complexe (10 features → MLP suffit)
- Training : Adam, lr=1e-3, 200 epochs, ~15s CPU
- Dataset : seed annoté manuellement + extension via scraping GitHub

### 5. Generate dataset (deep-dive)
- `generate-dataset.js` : scrape top repos JS via GitHub API
- Extraction des fonctions via Acorn
- Annotation auto (par les 10 features extraites — un peu circulaire mais OK pour seed)
- Filtrage qualité (stars ≥ X, last commit < 6 mois)

### 6. CLI + API + Quality Gate
- CLI : 5 sous-commandes (status, analyze, snippet, url, stream-train)
- API REST : `POST /analyze` avec body JSON
- Quality Gate : intégration GitHub Actions

### 7. Limites (être honnête)
- JS uniquement (port TS = lots à faire)
- Pas de cross-file analysis
- Le score est un **signal**, pas une vérité
- Le modèle peut overfit à mon style perso (raison d'être du re-train)

### 8. Comparaisons
- vs ESLint (règles statiques) — Js-Ranker complémentaire
- vs SonarJS — Sonar plus large, Js-Ranker plus customisable
- vs Codacy / CodeClimate — eux SaaS, Js-Ranker self-host

### 9. Roadmap
- Port TS (avec typescript-eslint parser)
- Plugin VS Code (inline scoring)
- GitHub Action officielle marketplace
- Web demo (paste code → get score)

### 10. Liens
- Repo : https://github.com/Abdoulrazack1/Js-Ranker
- Demo : [à déployer]

---

## Notes

- Article 2000-2500 mots
- Snippets de chaque feature extraction
- Comparaison visuelle clean.js vs messy.js avec breakdown
- 3-4 visuels (architecture, loss curve, exemple Quality Gate failure GHA)
