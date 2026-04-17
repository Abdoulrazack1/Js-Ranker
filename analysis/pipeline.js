'use strict';

/**
 * Pipeline dashboard — combine :
 *   1. fetcher (src/fetcher.js) -> récupère code depuis URL, repo ou fichier
 *   2. features (src/features.js) -> 16 features AST
 *   3. model (src/model.js) -> prédit le score (si le modèle est entraîné)
 *   4. decomposer (src/decomposer.js) -> décompose par fonction
 *   5. generate.js -> mappe vers les 9 critères du dashboard
 *   6. render-terminal.js -> affichage final
 *
 * Priorité de score : ML model si disponible, sinon fallback heuristique.
 */

const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');

const { fetchCode }          = require('../src/fetcher');
const { extractFeatures }    = require('../src/features');
const { loadModel, predict } = require('../src/model');
const { decomposeAndScore }  = require('../src/decomposer');

const {
  mapFeaturesToCriteria,
  buildContext,
  buildCriteriaArray,
  selectStrengthsWeaknesses,
  buildReasoning,
  computeScore,
  verdictFromScore,
  bucketFromScore,
} = require('./generate');

const { render } = require('./render-terminal');

const MODEL_PATH = path.join(__dirname, '..', 'models', 'js-ranker');

// ── Modèle ML (chargé une fois, mis en cache) ───────────────────────

let cachedModel = null;
let modelLoadFailed = false;

async function tryLoadModel() {
  if (cachedModel || modelLoadFailed) return cachedModel;

  const modelJson = path.join(MODEL_PATH, 'model.json');
  if (!fs.existsSync(modelJson)) {
    modelLoadFailed = true;
    return null;
  }

  try {
    cachedModel = await loadModel(MODEL_PATH);
    return cachedModel;
  } catch (err) {
    modelLoadFailed = true;
    console.error(chalk.yellow(`  [!] Modèle ML non chargeable (${err.message}) — fallback heuristique.`));
    return null;
  }
}

// ── Moyenne de vecteurs de features pour agrégation multi-fichiers ──

function averageFeatures(featureVectors) {
  if (featureVectors.length === 0) return new Array(16).fill(0);
  const summed = new Array(16).fill(0);
  for (const vec of featureVectors) {
    for (let i = 0; i < 16; i++) summed[i] += vec[i] || 0;
  }
  return summed.map(s => parseFloat((s / featureVectors.length).toFixed(4)));
}

// Agrège les champs "raw" des details pour produire un context moyen
function averageDetails(detailsList) {
  if (detailsList.length === 0) return null;
  const n = detailsList.length;
  const sum = (getter) => detailsList.reduce((acc, d) => acc + (Number(getter(d)) || 0), 0);
  const any = (getter) => detailsList.some(d => Boolean(getter(d)));

  return {
    cyclomaticComplexity: { raw: Math.round(sum(d => d.cyclomaticComplexity.raw) / n) },
    maxNesting:           { raw: Math.max(...detailsList.map(d => d.maxNesting.raw)) },
    namingRatio:          { named: sum(d => d.namingRatio.named), total: sum(d => d.namingRatio.total) },
    functionLength:       { lines: Math.round(sum(d => d.functionLength.lines) / n) },
    commentRatio:         { comments: sum(d => d.commentRatio.comments) },
    modernSyntax:         { patterns: sum(d => d.modernSyntax.patterns) },
    constVsVar:           {
      const: sum(d => d.constVsVar.const),
      let:   sum(d => d.constVsVar.let),
      var:   sum(d => d.constVsVar.var),
    },
    magicNumbers:         { count: sum(d => d.magicNumbers.count) },
    errorHandling:        { tryCatch: any(d => d.errorHandling.tryCatch), throwError: any(d => d.errorHandling.throwError) },
    purityScore:          { globalMutations: sum(d => d.purityScore.globalMutations), paramMutations: sum(d => d.purityScore.paramMutations) },
    singleResponsibility: { cyclomaticPerLine: (sum(d => Number(d.singleResponsibility.cyclomaticPerLine)) / n).toFixed(2) },
  };
}

// ── Assemble l'objet analysis final ─────────────────────────────────

function buildAnalysis({ score, features, details, meta }) {
  const context        = buildContext(details);
  const criteriaScores = mapFeaturesToCriteria(features, details);
  const finalScore     = score != null ? Math.round(score * 10) / 10 : computeScore(criteriaScores);
  const verdict        = verdictFromScore(finalScore);
  const criteria       = buildCriteriaArray(criteriaScores, context);
  const { strengths, weaknesses } = selectStrengthsWeaknesses(criteriaScores, context);

  return {
    score: finalScore,
    verdict,
    meta,
    criteria,
    strengths,
    weaknesses,
    reasoning: buildReasoning(finalScore, criteriaScores, context),
    dataset_sample: {
      score: finalScore,
      quality_bucket: bucketFromScore(finalScore),
    },
  };
}

// ── Analyse d'un fichier unique (code en mémoire) ───────────────────

async function analyzeSingleFile(code, displayName, extraMeta = {}) {
  const model = await tryLoadModel();
  const scoreFn = model ? (features) => predict(model, features) : null;

  let features, details, mlScore = null;

  try {
    const extraction = extractFeatures(code);
    features = extraction.features;
    details  = extraction.details;
  } catch (err) {
    throw new Error(`Parsing impossible : ${err.message}`);
  }

  if (scoreFn) {
    try {
      const fileReport = decomposeAndScore(code, scoreFn);
      // si le fichier a plusieurs fonctions on prend le globalScore
      if (fileReport.scoredCount > 0) {
        mlScore = fileReport.globalScore;
      } else {
        mlScore = scoreFn(features);
      }
    } catch {
      mlScore = scoreFn(features);
    }
  }

  return buildAnalysis({
    score: mlScore,
    features,
    details,
    meta: {
      primaryFile:   displayName,
      filesReviewed: 1,
      originalLines: code.split('\n').length,
      cleanedLines:  code.split('\n').length,
      stack:         extraMeta.stack || (scoreFn ? 'Node.js / acorn AST / ML' : 'Node.js / acorn AST'),
    },
  });
}

// ── Analyse d'un repo complet (agrégation multi-fichiers) ───────────

async function analyzeRepoFiles(files, repoMeta) {
  const model = await tryLoadModel();
  const scoreFn = model ? (features) => predict(model, features) : null;

  const perFile = [];

  for (const file of files) {
    try {
      const { features, details } = extractFeatures(file.code);
      let fileScore = null;
      if (scoreFn) {
        try {
          const report = decomposeAndScore(file.code, scoreFn);
          fileScore = report.scoredCount > 0 ? report.globalScore : scoreFn(features);
        } catch {
          fileScore = scoreFn(features);
        }
      }
      perFile.push({ path: file.path, features, details, score: fileScore });
    } catch {
      // fichier non parsable — ignoré
    }
  }

  if (perFile.length === 0) {
    throw new Error('Aucun fichier JS parsable dans ce repo');
  }

  const avgFeatures = averageFeatures(perFile.map(f => f.features));
  const avgDetails  = averageDetails(perFile.map(f => f.details));

  const globalScore = scoreFn && perFile.every(f => f.score != null)
    ? parseFloat((perFile.reduce((s, f) => s + f.score, 0) / perFile.length).toFixed(2))
    : null;

  // trouver le fichier dominant (max lignes)
  const primary = perFile.reduce((best, f) => (f.details.functionLength.lines > best.details.functionLength.lines ? f : best), perFile[0]);

  return buildAnalysis({
    score: globalScore,
    features: avgFeatures,
    details: avgDetails,
    meta: {
      primaryFile:   primary.path.split('/').pop(),
      filesReviewed: perFile.length,
      originalLines: files.reduce((s, f) => s + f.code.split('\n').length, 0),
      cleanedLines:  files.reduce((s, f) => s + f.code.split('\n').length, 0),
      stack:         `${repoMeta.owner}/${repoMeta.repo}@${repoMeta.branch} · ${perFile.length} JS files`,
    },
  });
}

// ── Point d'entrée unifié ────────────────────────────────────────────

/**
 * @param {string} input — chemin de fichier, URL ou snippet inline
 */
async function analyzeAndRenderDashboard(input) {
  const trimmed = input.trim();

  try {
    // URL (http/https)
    if (/^https?:\/\//i.test(trimmed)) {
      console.log(chalk.gray(`  ... fetch ${trimmed}`));
      const fetched = await fetchCode(trimmed);

      let analysis;
      if (fetched.isRepo) {
        console.log(chalk.gray(`  ... repo ${fetched.owner}/${fetched.repo} — ${fetched.files.length} fichiers`));
        analysis = await analyzeRepoFiles(fetched.files, fetched);
      } else {
        const displayName = (fetched.resolvedUrl || trimmed).split('/').pop() || 'remote';
        analysis = await analyzeSingleFile(fetched.code, displayName);
      }
      render(analysis);
      return analysis;
    }

    // Fichier local
    if (fs.existsSync(trimmed) && trimmed.endsWith('.js')) {
      const absolute = path.resolve(trimmed);
      const code     = fs.readFileSync(absolute, 'utf-8');
      const analysis = await analyzeSingleFile(code, path.basename(absolute));
      render(analysis);
      return analysis;
    }

    // Sinon : traité comme snippet inline
    const analysis = await analyzeSingleFile(trimmed, 'inline snippet');
    render(analysis);
    return analysis;
  } catch (err) {
    console.error(chalk.red(`\n  ❌ ${err.message}\n`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

module.exports = {
  analyzeAndRenderDashboard,
  analyzeSingleFile,
  analyzeRepoFiles,
  tryLoadModel,
};
