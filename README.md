#  JS-Ranker

> Moteur de notation ML pour fonctions JavaScript — 10 features AST, API REST, Quality Gate CI/CD

## Installation

```bash
npm install
node migrate-dataset.js   # migre le dataset vers 10 features
npm run train             # entraîne le modèle (~15s)
node index.js status      # vérifie
```

## Utilisation CLI

```bash
node index.js <fichier.js>           # analyse rapide
node index.js analyze <fichier.js>   # analyse détaillée
node index.js url <url-github>       # analyse depuis URL
node index.js snippet "const f = x => x"
node index.js stream-train dataset-large.json
```

## API REST

```bash
npm run serve   # démarre sur :3000

curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "const add = (a, b) => a + b;"}'
```

## Dataset massif (GitHub API)

```bash
node generate-dataset.js --max 2000 --token ghp_xxx
node index.js stream-train dataset-large.json
```

## 10 Features AST

| # | Feature | Élevé = |
|---|---|---|
| F1 | Complexité Cyclomatique | MAUVAIS |
| F2 | Imbrication Maximale | MAUVAIS |
| F3 | Ratio de Nommage | BON |
| F4 | Linéarité | BON |
| F5 | Modularité (nb args) | BON |
| F6 | Comment Ratio | BON |
| F7 | Return Complexity | MAUVAIS |
| F8 | Async/Await | BON |
| F9 | Magic Numbers | MAUVAIS |
| F10 | Chain Length | MAUVAIS |

Voir `DOCUMENTATION.md` pour la documentation complète.
