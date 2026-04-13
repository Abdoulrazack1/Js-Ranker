'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          JS-RANKER — Décomposeur de Fichier                  ║
 * ║   Isole chaque fonction, la note individuellement,           ║
 * ║   puis agrège avec analyse du scope global.                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Algorithme :
 *   1. parse(code) → AST complet en RAM
 *   2. walk → collecter tous les nœuds de fonctions (décl + arrow)
 *   3. Pour chaque nœud → code.slice(node.start, node.end)
 *   4. extractFeatures(slice) → score individuel via ML
 *   5. Analyser le "global scope" (code hors fonctions)
 *   6. Agréger : moyenne pondérée + malus/bonus scope global
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');
const { extractFeatures } = require('./features');

// ─────────────────────────────────────────────────────────────────
//  Types de nœuds considérés comme "fonctions scorables"
// ─────────────────────────────────────────────────────────────────
const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

// Taille minimale d'une fonction pour qu'elle soit scorée (évite les stubs triviaux)
const MIN_FUNCTION_LINES = 2;
const MIN_FUNCTION_CHARS = 20;

/**
 * Parse un fichier JS complet (en mémoire) et isole toutes les fonctions.
 * @param {string} code — Source JS complet
 * @returns {Array<FunctionNode>}
 */
function extractFunctionSlices(code) {
  let ast;
  try {
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true,
        ranges: true,
      });
    } catch {
      ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: 'script',
        locations: true,
        ranges: true,
      });
    }
  } catch (err) {
    throw new Error(`Parsing AST impossible : ${err.message}`);
  }

  const functions = [];
  const seen = new Set(); // évite les doublons (nested functions)

  walk.ancestor(ast, {
    FunctionDeclaration(node, ancestors) {
      // On ne collecte que les fonctions de premier niveau (non imbriquées dans une autre)
      const parentFn = ancestors
        .slice(0, -1)
        .find(a => FUNCTION_NODE_TYPES.has(a.type));

      if (!parentFn) {
        collectFunction(node, code, functions, seen, 'declaration');
      }
    },

    // Arrow functions assignées à une variable au niveau module/top-level
    VariableDeclaration(node, ancestors) {
      const isTopLevel = ancestors.every(a => !FUNCTION_NODE_TYPES.has(a.type));
      if (!isTopLevel) return;

      for (const decl of node.declarations) {
        if (!decl.init) continue;
        const init = decl.init;

        if (
          init.type === 'ArrowFunctionExpression' ||
          init.type === 'FunctionExpression'
        ) {
          const name = decl.id && decl.id.type === 'Identifier'
            ? decl.id.name
            : '<anonymous>';
          collectFunction(init, code, functions, seen, 'arrow', name, node);
        }
      }
    },

    // Méthodes de classe ou d'objet littéral
    MethodDefinition(node, ancestors) {
      const isTopLevel = !ancestors
        .slice(0, -1)
        .some(a => FUNCTION_NODE_TYPES.has(a.type));
      if (isTopLevel && node.value) {
        const name = node.key && node.key.type === 'Identifier' ? node.key.name : '<method>';
        collectFunction(node.value, code, functions, seen, 'method', name);
      }
    },
  });

  return { functions, ast, code };
}

/**
 * Ajoute une fonction à la liste si elle est assez grande et pas déjà vue.
 */
function collectFunction(node, code, list, seen, type, forceName = null, parentNode = null) {
  const key = `${node.start}-${node.end}`;
  if (seen.has(key)) return;
  seen.add(key);

  // Utilise le nœud parent (VariableDeclaration) pour inclure "const f = " dans l'extrait
  const sliceStart = parentNode ? parentNode.start : node.start;
  const sliceEnd   = node.end;
  const slice = code.slice(sliceStart, sliceEnd);

  // Filtrage des stubs triviaux
  const lineCount = slice.split('\n').length;
  if (slice.length < MIN_FUNCTION_CHARS || lineCount < MIN_FUNCTION_LINES) return;

  // Nom de la fonction
  let name = forceName;
  if (!name) {
    if (node.id && node.id.name)   name = node.id.name;
    else if (type === 'arrow')     name = '<arrow>';
    else                           name = '<anonymous>';
  }

  list.push({
    name,
    type,
    slice,
    lineStart: node.loc ? node.loc.start.line : '?',
    lineEnd:   node.loc ? node.loc.end.line   : '?',
    charCount: slice.length,
    lineCount,
    start: sliceStart,
    end:   sliceEnd,
  });
}

// ─────────────────────────────────────────────────────────────────
//  Analyse du "Global Scope"
//  Examine le code hors fonctions pour malus/bonus
// ─────────────────────────────────────────────────────────────────
function analyzeGlobalScope(code, functions) {
  // Construit un masque des zones couvertes par des fonctions
  const covered = new Uint8Array(code.length);
  for (const fn of functions) {
    covered.fill(1, fn.start, fn.end);
  }

  // Extrait le code hors-fonctions
  let globalCode = '';
  let inGap = false;
  let gapStart = 0;

  for (let i = 0; i <= code.length; i++) {
    const inFn = i < code.length && covered[i] === 1;
    if (!inFn && !inGap) {
      inGap = true;
      gapStart = i;
    } else if (inFn && inGap) {
      inGap = false;
      globalCode += code.slice(gapStart, i) + '\n';
    }
  }
  if (inGap) globalCode += code.slice(gapStart);

  const globalLines = globalCode.split('\n').filter(l => l.trim().length > 0);
  const totalLines  = code.split('\n').filter(l => l.trim().length > 0).length;

  // Métriques du scope global
  const globalDensity = totalLines > 0 ? globalLines.length / totalLines : 0;

  // Détection de variables globales mutables (var au scope global → malus)
  const globalVarCount = (globalCode.match(/\bvar\s+/g) || []).length;
  // Mutations directes de variables au scope global (hors modules)
  const globalMutations = (globalCode.match(/^(?!\s*(?:const|let|var|function|class|import|export))\s*\w+\s*=/mg) || []).length;

  // Présence de commentaires en-tête (bonus)
  const hasFileHeader = /^\s*\/\*\*?/.test(code) || /^\s*\/\//.test(code);
  // Présence d'exports propres
  const hasCleanExports = /module\.exports\s*=\s*\{/.test(globalCode) ||
                          /^export\s+(default|const|function|class)/m.test(globalCode);

  // Score du scope global : [0, 1] → sera converti en malus/bonus
  let scopeScore = 0.5; // neutre par défaut

  scopeScore -= globalDensity      * 0.3;  // beaucoup de code global → malus
  scopeScore -= globalVarCount     * 0.05; // var globaux → malus
  scopeScore -= globalMutations    * 0.08; // mutations globales → fort malus
  scopeScore += hasFileHeader      ? 0.10 : 0;
  scopeScore += hasCleanExports    ? 0.10 : 0;

  scopeScore = Math.max(0, Math.min(1, scopeScore));

  return {
    globalLines: globalLines.length,
    totalLines,
    globalDensity: parseFloat(globalDensity.toFixed(3)),
    globalVarCount,
    globalMutations,
    hasFileHeader,
    hasCleanExports,
    scopeScore: parseFloat(scopeScore.toFixed(3)),
  };
}

// ─────────────────────────────────────────────────────────────────
//  Agrégation finale
//  Moyenne pondérée par taille + ajustement scope global
// ─────────────────────────────────────────────────────────────────
function aggregateScores(scoredFunctions, scopeAnalysis) {
  if (scoredFunctions.length === 0) {
    // Fichier sans fonction → note basée sur scope global uniquement
    return {
      globalScore: parseFloat((scopeAnalysis.scopeScore * 5).toFixed(2)),
      breakdown: 'Aucune fonction détectée — note basée sur scope global',
      scopeAnalysis,
      weightedScores: [],
    };
  }

  // Poids = nombre de lignes de la fonction (les grandes fonctions ont plus d'impact)
  const totalWeight = scoredFunctions.reduce((sum, fn) => sum + fn.lineCount, 0);
  const weightedSum = scoredFunctions.reduce((sum, fn) =>
    sum + fn.score * fn.lineCount, 0
  );

  let baseScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Ajustement du scope global : ±10% maximum
  const scopeAdjustment = (scopeAnalysis.scopeScore - 0.5) * 0.2 * 5;
  let finalScore = baseScore + scopeAdjustment;
  finalScore = Math.min(5.0, Math.max(0.0, parseFloat(finalScore.toFixed(2))));

  const breakdown = scoredFunctions.length === 1
    ? 'Score fonction unique + ajustement scope'
    : `Moyenne pondérée de ${scoredFunctions.length} fonctions + scope global`;

  return {
    globalScore: finalScore,
    baseScore:   parseFloat(baseScore.toFixed(2)),
    scopeAdjustment: parseFloat(scopeAdjustment.toFixed(2)),
    breakdown,
    scopeAnalysis,
    weightedScores: scoredFunctions.map(fn => ({
      name:      fn.name,
      score:     fn.score,
      lines:     fn.lineCount,
      weight:    totalWeight > 0 ? parseFloat((fn.lineCount / totalWeight * 100).toFixed(1)) : 0,
      lineStart: fn.lineStart,
      lineEnd:   fn.lineEnd,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────
//  Pipeline principal : code → rapport complet
// ─────────────────────────────────────────────────────────────────
/**
 * Analyse complète d'un fichier JS en mémoire.
 * @param {string} code — Source JS complet
 * @param {Function} scoreFn — Fonction (features) → score (fournie par le modèle ML)
 * @returns {Object} Rapport complet
 */
function decomposeAndScore(code, scoreFn) {
  // 1. Extraction des fonctions depuis l'AST (tout en RAM)
  const { functions } = extractFunctionSlices(code);

  // 2. Score individuel de chaque fonction
  const scoredFunctions = [];
  const errors = [];

  for (const fn of functions) {
    try {
      const { features, details } = extractFeatures(fn.slice);
      const score = scoreFn(features);

      scoredFunctions.push({
        ...fn,
        features,
        details,
        score,
      });
    } catch (err) {
      errors.push({ name: fn.name, error: err.message });
    }
  }

  // 3. Analyse du scope global
  const scopeAnalysis = analyzeGlobalScope(code, functions);

  // 4. Agrégation
  const aggregation = aggregateScores(scoredFunctions, scopeAnalysis);

  return {
    ...aggregation,
    functions: scoredFunctions,
    parseErrors: errors,
    totalFunctions: functions.length,
    scoredCount: scoredFunctions.length,
  };
}

module.exports = { decomposeAndScore, extractFunctionSlices, analyzeGlobalScope };
