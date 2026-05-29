# Product Hunt — Launch

**Catégorie :** Developer Tools

---

## Tagline (60 chars)

> ML-powered quality scorer for JavaScript code — open source

---

## Description (260 chars)

> Js-Ranker scores JavaScript functions from 0 to 100 using 10 AST features + TensorFlow.js. Use as CLI, REST API, or CI Quality Gate. Self-hostable, re-trainable on your team's style. MIT, Node.js, 2 deps.

---

## Gallery

1. Hero — split-screen comparing "messy.js → 32/100" vs "clean.js → 87/100"
2. CLI demo GIF — `node index.js analyze` showing breakdown
3. API REST screenshot — curl + JSON response
4. GitHub Action — Quality Gate failing on low-score PR
5. Comparison table (Js-Ranker vs ESLint vs Sonar vs Codacy)

---

## First comment (maker)

Hey Product Hunt 👋

Js-Ranker est né de ma frustration sur les outils existants de qualité de code JS.

**ESLint** te dit "pass/fail" sur des règles statiques. C'est bien, mais ça ne te donne pas une **mesure globale** d'une fonction.

**SonarJS, Codacy, CodeClimate** font de la mesure globale, mais ils sont :
- Soit SaaS payants
- Soit opaques (tu ne sais pas exactement quels features pèsent)
- Soit non-customisables (impossible de re-train sur ton style maison)

Js-Ranker est :
- **Open source** (MIT)
- **Self-host** (Node.js, 2 deps runtime)
- **Re-trainable** sur ton propre codebase
- **Explicable** (les 10 features sont documentées)
- **3 interfaces** : CLI, API REST, Quality Gate CI

Stack : Node.js + Acorn (parser AST) + TensorFlow.js (CPU backend, pas de GPU requis).

GitHub : https://github.com/Abdoulrazack1/Js-Ranker

Heureux d'avoir vos retours sur :
- Les 10 features (j'en ai loupé une importante ?)
- Si vous l'intégreriez dans votre CI
- Si vous voulez voir un port TypeScript

---

## Topics

- Developer Tools
- Open Source
- GitHub Actions
- Artificial Intelligence

---

## Notes

- Coordonner avec un lancement Reddit r/javascript le même jour (boost cross-canal)
- Préparer une démo live (Quality Gate failing → fix → passing dans 1 minute)
