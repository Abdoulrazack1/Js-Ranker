'use strict';

/**
 * Generator — transforme un (ou plusieurs) fichier(s) JS en objet d'analyse
 * compatible avec render-terminal.js.
 *
 * Pipeline :
 *   code source -> features.js (16 métriques AST)
 *               -> 9 critères du dashboard (invertis où nécessaire)
 *               -> strengths / weaknesses sélectionnés sur les 2 meilleurs / 2 pires
 *               -> score global (moyenne pondérée -> /5)
 */

const fs   = require('fs');
const path = require('path');

const { extractFeatures } = require('../src/features');

// Poids par critère pour le score global (somme = 1.0)
const CRITERION_WEIGHTS = {
  naming:          0.10,
  modularity:      0.15,
  functionLength:  0.10,
  modernJs:        0.08,
  cyclomatic:      0.15,
  nesting:         0.10,
  errorHandling:   0.10,
  purity:          0.10,
  maintainability: 0.12,
};

// Messages générés pour les criteria (choisis selon la valeur mesurée)
const STRENGTH_TEMPLATES = {
  naming:          (ctx) => `Naming is clean — ${ctx.namedVars}/${ctx.totalVars} non-trivial identifiers are descriptive.`,
  modularity:      (ctx) => `Good SRP — cyclomatic density stays at ${ctx.cycloPerLine}/line, each unit owns one concern.`,
  functionLength:  (ctx) => `Function length sits in the ideal zone (${ctx.lines} non-empty lines).`,
  modernJs:        (ctx) => `Modern syntax is used throughout (${ctx.modernPatterns} destructuring/spread/template patterns).`,
  cyclomatic:      (ctx) => `Cyclomatic complexity is low (${ctx.cyclomatic} branches over ${ctx.lines} lines).`,
  nesting:         (ctx) => `Nesting is shallow — max depth ${ctx.maxDepth}, early returns in use.`,
  errorHandling:   (ctx) => `Error handling is solid — try/catch${ctx.hasThrowError ? ' + typed throws' : ''}${ctx.hasCatchBody ? ' + non-empty catch blocks' : ''}.`,
  purity:          (ctx) => `Low mutation footprint — ${ctx.globalMutations} globals, ${ctx.paramMutations} param mutations.`,
  maintainability: (ctx) => `Maintainability is strong — ${ctx.commentLines} comment lines, const/let discipline, no magic-number sprawl.`,
};

const WEAKNESS_TEMPLATES = {
  naming:          (ctx) => `Naming is weak — only ${ctx.namedVars}/${ctx.totalVars} identifiers are descriptive, rest are short/trivial.`,
  modularity:      (ctx) => `SRP breaks — cyclomatic density ${ctx.cycloPerLine}/line suggests functions do too much.`,
  functionLength:  (ctx) => `Function length out of ideal zone (${ctx.lines} lines — target 8-25).`,
  modernJs:        (ctx) => `Sparse use of modern JS (${ctx.modernPatterns} patterns) — destructuring/spread would help readability.`,
  cyclomatic:      (ctx) => `High cyclomatic complexity (${ctx.cyclomatic} branches) — consider dispatch tables or early returns.`,
  nesting:         (ctx) => `Nesting too deep (max depth ${ctx.maxDepth}) — extract inner blocks or invert conditions.`,
  errorHandling:   (ctx) => `Thin error handling — no try/catch or no typed throws detected.`,
  purity:          (ctx) => `Mutation hotspots — ${ctx.globalMutations} global assignments, ${ctx.paramMutations} param mutations.`,
  maintainability: (ctx) => `Maintainability concerns — ${ctx.magicNumbers} magic numbers and low comment/const ratio.`,
};

// Notes courtes affichées sous chaque barre
const CRITERION_NOTES = {
  naming:          (ctx) => `${ctx.namedVars}/${ctx.totalVars} descriptive names`,
  modularity:      (ctx) => `${ctx.cycloPerLine} branches/line`,
  functionLength:  (ctx) => `${ctx.lines} non-empty lines`,
  modernJs:        (ctx) => `${ctx.modernPatterns} modern patterns`,
  cyclomatic:      (ctx) => `${ctx.cyclomatic} branches total`,
  nesting:         (ctx) => `max depth ${ctx.maxDepth}`,
  errorHandling:   (ctx) => `try/catch: ${ctx.hasTryCatch ? 'yes' : 'no'}`,
  purity:          (ctx) => `${ctx.globalMutations} globals, ${ctx.paramMutations} param mut.`,
  maintainability: (ctx) => `${ctx.magicNumbers} magic nums, const ${ctx.constCount}/let ${ctx.letCount}/var ${ctx.varCount}`,
};

// Conversion pct -> qualifier (pour cohérence avec le renderer)
function pctToQualifier(pct) {
  if (pct >= 90) return 'excellent';
  if (pct >= 80) return 'strong';
  if (pct >= 70) return 'good';
  if (pct >= 60) return 'acceptable';
  if (pct >= 50) return 'fair';
  return 'weak';
}

// Mapping features[16] -> 9 critères, en inversant celles où
// "higher = worse" pour obtenir partout "higher = better" dans l'UI.
function mapFeaturesToCriteria(features, raw) {
  const [
    f1_cyclo, f2_nest, f3_naming, f4_linear, f5_modular,
    f6_comment, f7_return, f8_async, f9_magic, f10_chain,
    f11_modern, f12_const, f13_error, f14_length, f15_purity, f16_srp,
  ] = features;

  // Inversions : f1 (cyclo), f2 (nesting), f9 (magic), f10 (chain), f7 (returns) sont raw-normalized
  const inv = (x) => 1 - x;

  return {
    naming:          f3_naming,
    modularity:      (f16_srp + f5_modular) / 2,
    functionLength:  f14_length,
    modernJs:        f11_modern,
    cyclomatic:      inv(f1_cyclo),
    nesting:         inv(f2_nest),
    errorHandling:   f13_error,
    purity:          f15_purity,
    maintainability: (f6_comment + f12_const + inv(f9_magic) + inv(f10_chain)) / 4,
  };
}

function computeScore(criteriaScores) {
  let total = 0;
  for (const [key, weight] of Object.entries(CRITERION_WEIGHTS)) {
    total += (criteriaScores[key] ?? 0) * weight;
  }
  return Math.round(total * 5 * 10) / 10;
}

function verdictFromScore(score) {
  if (score >= 4.4) return 'EXCELLENT';
  if (score >= 3.5) return 'GOOD';
  if (score >= 2.5) return 'AVERAGE';
  if (score >= 1.5) return 'POOR';
  return 'CRITICAL';
}

function bucketFromScore(score) {
  if (score >= 3.8) return 'high';
  if (score >= 2.5) return 'medium';
  return 'low';
}

// Contexte enrichi passé aux templates (raw metrics lisibles)
function buildContext(details) {
  return {
    cyclomatic:     details.cyclomaticComplexity.raw,
    maxDepth:       details.maxNesting.raw,
    namedVars:      details.namingRatio.named,
    totalVars:      details.namingRatio.total || 1,
    lines:          details.functionLength.lines,
    commentLines:   details.commentRatio.comments,
    modernPatterns: details.modernSyntax.patterns,
    constCount:     details.constVsVar.const,
    letCount:       details.constVsVar.let,
    varCount:       details.constVsVar.var,
    magicNumbers:   details.magicNumbers.count,
    hasTryCatch:    details.errorHandling.tryCatch,
    hasThrowError:  details.errorHandling.throwError,
    hasCatchBody:   false,
    globalMutations: details.purityScore.globalMutations,
    paramMutations:  details.purityScore.paramMutations,
    cycloPerLine:    details.singleResponsibility.cyclomaticPerLine,
  };
}

function selectStrengthsWeaknesses(criteriaScores, context) {
  const sorted = Object.entries(criteriaScores)
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score);

  const topTwo    = sorted.slice(0, 2);
  const bottomTwo = sorted.slice(-2).reverse();

  const strengths  = topTwo.map(({ key }) => STRENGTH_TEMPLATES[key](context));
  const weaknesses = bottomTwo.map(({ key }) => WEAKNESS_TEMPLATES[key](context));

  return { strengths, weaknesses };
}

// Ordre d'affichage dans la grille 3x3
const DISPLAY_ORDER = [
  { key: 'naming',          label: 'naming quality'    },
  { key: 'modularity',      label: 'modularity / srp'  },
  { key: 'functionLength',  label: 'function length'   },
  { key: 'modernJs',        label: 'modern js usage'   },
  { key: 'cyclomatic',      label: 'cyclomatic cx'     },
  { key: 'nesting',         label: 'nesting depth'     },
  { key: 'errorHandling',   label: 'error handling'    },
  { key: 'purity',          label: 'purity / effects'  },
  { key: 'maintainability', label: 'maintainability'   },
];

function buildCriteriaArray(criteriaScores, context) {
  return DISPLAY_ORDER.map(({ key, label }) => ({
    name: label,
    pct:  Math.round(criteriaScores[key] * 100),
    note: CRITERION_NOTES[key](context),
  }));
}

function buildReasoning(score, criteriaScores, context) {
  const sorted = Object.entries(criteriaScores)
    .map(([key, s]) => ({ key, score: s }))
    .sort((a, b) => b.score - a.score);

  const best  = sorted[0];
  const worst = sorted[sorted.length - 1];

  return `Score ${score.toFixed(1)}/5.0 computed from ${context.lines} non-empty lines, ` +
         `${context.cyclomatic} branches, max nesting ${context.maxDepth}. ` +
         `Strongest axis: ${best.key} (${Math.round(best.score * 100)}%). ` +
         `Weakest axis: ${worst.key} (${Math.round(worst.score * 100)}%). ` +
         `Verdict: ${verdictFromScore(score)}.`;
}

/**
 * Produit l'objet analysis complet à partir d'un fichier source.
 *
 * @param {string} filePath — chemin absolu ou relatif vers le fichier JS
 * @param {object} [meta]   — surcharges pour le bloc meta du dashboard
 * @returns {object} analysis ready pour render-terminal.render()
 */
function analyzeFile(filePath, meta = {}) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const { features, details } = extractFeatures(code);

  const context        = buildContext(details);
  const criteriaScores = mapFeaturesToCriteria(features, details);
  const score          = computeScore(criteriaScores);
  const verdict        = verdictFromScore(score);
  const criteria       = buildCriteriaArray(criteriaScores, context);
  const { strengths, weaknesses } = selectStrengthsWeaknesses(criteriaScores, context);

  const lineCount = code.split('\n').length;

  return {
    score,
    verdict,
    meta: {
      primaryFile:   meta.primaryFile   || path.basename(filePath),
      filesReviewed: meta.filesReviewed || 1,
      originalLines: meta.originalLines || lineCount,
      cleanedLines:  meta.cleanedLines  || lineCount,
      stack:         meta.stack         || 'Node.js / acorn AST',
    },
    criteria,
    strengths,
    weaknesses,
    reasoning: buildReasoning(score, criteriaScores, context),
    dataset_sample: {
      score,
      quality_bucket: bucketFromScore(score),
    },
    // Payload brut utile pour du debug ou export dataset
    _raw: { features, details },
  };
}

module.exports = {
  analyzeFile,
  verdictFromScore,
  bucketFromScore,
  mapFeaturesToCriteria,
  buildContext,
  buildCriteriaArray,
  selectStrengthsWeaknesses,
  buildReasoning,
  computeScore,
  CRITERION_WEIGHTS,
  DISPLAY_ORDER,
};
