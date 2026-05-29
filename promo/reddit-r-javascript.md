# Reddit — r/javascript

**Subreddit cible :** r/javascript
**Flair :** `Showoff Saturday`
**Best time :** samedi matin

---

## Titre

> Js-Ranker — ML-powered code quality scorer for JavaScript functions (10 AST features, TensorFlow.js, CLI + API + Quality Gate)

---

## Body

Hey r/javascript,

Petit outil que j'ai construit : **Js-Ranker**, un évaluateur de qualité de code basé sur Machine Learning au lieu de règles statiques type ESLint.

### L'idée

Au lieu de "ça respecte/ça respecte pas la règle X", Js-Ranker donne un **score continu 0-100** par fonction, basé sur **10 features extraites par analyse AST** :

| # | Feature | Sens |
|---|---|---|
| F1 | Complexité Cyclomatique | élevé = mauvais |
| F2 | Imbrication Maximale | élevé = mauvais |
| F3 | Ratio de Nommage descriptif | élevé = bon |
| F4 | Linéarité | élevé = bon |
| F5 | Modularité (nb args) | élevé = bon |
| F6 | Comment Ratio | élevé = bon |
| F7 | Return Complexity | élevé = mauvais |
| F8 | Async/Await usage | élevé = bon |
| F9 | Magic Numbers | élevé = mauvais |
| F10 | Chain Length | élevé = mauvais |

Le modèle TF.js apprend les poids depuis un dataset annoté (que tu peux étendre via `generate-dataset.js` qui scrape GitHub).

### Pourquoi c'est intéressant

**Re-trainable sur ton style** : ESLint = config statique, Sonar = ML cloud opaque. Js-Ranker tu peux re-train sur ton propre codebase pour qu'il colle à ce qui est jugé "bon" dans **ton équipe**.

### Utilisation

```bash
# CLI
node index.js examples/messy.js           # score rapide
node index.js analyze examples/messy.js   # breakdown features

# API REST
npm run serve
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "const add = (a, b) => a + b;"}'

# Quality Gate CI
- name: Js-Ranker Quality Gate
  run: npx js-ranker analyze src/ --min-score 60 --fail-on-low
```

### Stack

- Node.js + Acorn (parser AST)
- TensorFlow.js (CPU backend, pas de GPU requis)
- Express pour l'API REST
- Commander pour la CLI

### Limites connues

- JavaScript uniquement (pas de TS types)
- Pas de cross-file analysis
- Dataset relativement petit en seed (~quelques centaines) → gain net avec `generate-dataset.js`
- Le score est un signal, pas une vérité absolue

### Code

https://github.com/Abdoulrazack1/Js-Ranker

MIT. Contributions bienvenues — surtout les nouvelles features AST, plugin VS Code, GitHub Action officielle.

Heureux d'avoir vos retours sur :
- Les 10 features choisies (j'en ai loupé une importante ?)
- Si vous l'intégreriez dans votre CI
- Si quelqu'un a expérience avec d'autres approches ML pour qualité de code

---

## Notes

- Cible : devs JS qui font de la review
- Mentionner explicitement les limites (rigueur appréciée sur r/javascript)
- Si possible, montrer un score "messy.js" vs "clean.js" en visuel
