'use strict';

const acorn = require('acorn');
const walk  = require('acorn-walk');
const { extractFeatures } = require('./features');

const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const MIN_FUNCTION_LINES = 2;
const MIN_FUNCTION_CHARS = 20;

/**
 * Détermine si tous les ancêtres-fonctions d'un nœud sont des
 * "wrappers structurels" (IIFE ou callbacks anonymes d'événements),
 * ce qui permet de traiter la fonction comme "pseudo-top-level".
 *
 * Un wrapper structurel est une FunctionExpression ou ArrowFunctionExpression
 * qui N'EST PAS une FunctionDeclaration nommée.
 * Ex : (function(){})(), addEventListener('DOMContentLoaded', function(){})
 */
function isEffectiveTopLevel(ancestors) {
  const fnAncestors = ancestors
    .slice(0, -1)
    .filter(a => FUNCTION_NODE_TYPES.has(a.type));

  if (fnAncestors.length === 0) return true; // Vrai top-level

  // Toutes les fonctions parentes doivent être anonymes (pas de .id.name)
  // → IIFE ou callbacks d'événements
  return fnAncestors.every(fn => {
    // FunctionExpression/Arrow sans nom assigné = wrapper structurel
    return fn.type !== 'FunctionDeclaration' && !(fn.id && fn.id.name);
  });
}

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
  const seen = new Set();

  walk.ancestor(ast, {
    FunctionDeclaration(node, ancestors) {
      if (isEffectiveTopLevel(ancestors)) {
        collectFunction(node, code, functions, seen, 'declaration');
      }
    },

    VariableDeclaration(node, ancestors) {
      if (!isEffectiveTopLevel(ancestors)) return;

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

    MethodDefinition(node, ancestors) {
      if (isEffectiveTopLevel(ancestors) && node.value) {
        const name = node.key && node.key.type === 'Identifier' ? node.key.name : '<method>';
        collectFunction(node.value, code, functions, seen, 'method', name);
      }
    },
  });

  return { functions, ast, code };
}

function collectFunction(node, code, list, seen, type, forceName = null, parentNode = null) {
  const key = `${node.start}-${node.end}`;
  if (seen.has(key)) return;
  seen.add(key);

  const sliceStart = parentNode ? parentNode.start : node.start;
  const sliceEnd   = node.end;
  const slice = code.slice(sliceStart, sliceEnd);

  const lineCount = slice.split('\n').length;
  if (slice.length < MIN_FUNCTION_CHARS || lineCount < MIN_FUNCTION_LINES) return;

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

function analyzeGlobalScope(code, functions) {
  const covered = new Uint8Array(code.length);
  for (const fn of functions) {
    covered.fill(1, fn.start, fn.end);
  }

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
  const globalDensity = totalLines > 0 ? globalLines.length / totalLines : 0;

  const globalVarCount = (globalCode.match(/\bvar\s+/g) || []).length;
  const globalMutations = (globalCode.match(/^(?!\s*(?:const|let|var|function|class|import|export))\s*\w+\s*=/mg) || []).length;
  const hasFileHeader = /^\s*\/\*\*?/.test(code) || /^\s*\/\//.test(code);
  const hasCleanExports = /module\.exports\s*=\s*\{/.test(globalCode) ||
                          /^export\s+(default|const|function|class)/m.test(globalCode);

  let scopeScore = 0.5;
  scopeScore -= globalDensity      * 0.3;
  scopeScore -= globalVarCount     * 0.05;
  scopeScore -= globalMutations    * 0.08;
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

function aggregateScores(scoredFunctions, scopeAnalysis) {
  if (scoredFunctions.length === 0) {
    return {
      globalScore: parseFloat((scopeAnalysis.scopeScore * 5).toFixed(2)),
      breakdown: 'Aucune fonction détectée — note basée sur scope global',
      scopeAnalysis,
      weightedScores: [],
    };
  }

  const totalWeight = scoredFunctions.reduce((sum, fn) => sum + fn.lineCount, 0);
  const weightedSum = scoredFunctions.reduce((sum, fn) =>
    sum + fn.score * fn.lineCount, 0
  );

  let baseScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
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

function decomposeAndScore(code, scoreFn) {
  const { functions } = extractFunctionSlices(code);

  const scoredFunctions = [];
  const errors = [];

  for (const fn of functions) {
    try {
      const { features, details } = extractFeatures(fn.slice);
      const score = scoreFn(features);
      scoredFunctions.push({ ...fn, features, details, score });
    } catch (err) {
      errors.push({ name: fn.name, error: err.message });
    }
  }

  const scopeAnalysis = analyzeGlobalScope(code, functions);
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