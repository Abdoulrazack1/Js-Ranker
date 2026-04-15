'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║          JS-RANKER — Feature Extractor (AST)          ║
 * ║   Analyse statique via acorn pour 10 métriques clés   ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Features 1–5  : métriques originales
 * Features 6–10 : nouvelles métriques d'explicabilité
 *   F6  — commentRatio      : ratio commentaires / lignes de code
 *   F7  — returnComplexity  : nb de return statements (fonctions multi-sortie)
 *   F8  — hasAsyncAwait     : usage de async/await (modernité)
 *   F9  — magicNumbers      : nb de nombres magiques (littéraux numériques bruts)
 *   F10 — chainLength       : longueur maximale des chaînes de méthodes
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');

const MAX_CYCLOMATIC   = 20;
const MAX_NESTING      = 8;
const MAX_ARGS         = 7;
const MAX_LINE_RATIO   = 5;
const MAX_RETURN_STMTS = 8;
const MAX_MAGIC_NUMS   = 10;
const MAX_CHAIN_LENGTH = 6;

const ALLOWED_MAGIC_NUMBERS = new Set([0, 1, -1, 2, 100, 1000]);
const TRIVIAL_NAMES = new Set(['i', 'j', 'k', 'x', 'y', 'z', 'n', 'm', 'e', 't']);

function extractFeatures(code) {
  let ast;
  try {
    try { ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' }); }
    catch { ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' }); }
  } catch (err) {
    throw new Error(`Erreur de parsing AST : ${err.message}`);
  }

  const meta = {
    rawCyclomatic: 0, maxDepth: 0, totalVars: 0, namedVars: 0,
    totalLines: code.split('\n').length, nodeCount: 0, paramCount: 0,
    commentLines: 0, returnCount: 0, hasAsync: false, hasAwait: false,
    magicNumbers: 0, maxChainLen: 0,
  };

  // F6 — Commentaires (analyse du source brut)
  const commentSingleLine = (code.match(/\/\/.*/g) || []).length;
  const commentMultiLine  = (code.match(/\/\*[\s\S]*?\*\//g) || [])
    .reduce((acc, c) => acc + c.split('\n').length, 0);
  meta.commentLines = commentSingleLine + commentMultiLine;

  const branchNodes = new Set([
    'IfStatement', 'ConditionalExpression', 'SwitchCase',
    'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement', 'LogicalExpression', 'CatchClause',
  ]);

  const nestingNodes = new Set([
    'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement', 'BlockStatement',
    'SwitchStatement', 'TryStatement', 'FunctionExpression', 'ArrowFunctionExpression',
  ]);

  let paramNames = [];

  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (meta.paramCount === 0) {
        meta.paramCount = node.params.length;
        paramNames = node.params.filter(p => p.type === 'Identifier').map(p => p.name);
        if (node.async) meta.hasAsync = true;
      }
    },
    ArrowFunctionExpression(node) {
      if (meta.paramCount === 0) {
        meta.paramCount = node.params.length;
        paramNames = node.params.filter(p => p.type === 'Identifier').map(p => p.name);
        if (node.async) meta.hasAsync = true;
      }
    },
    FunctionExpression(node) {
      if (meta.paramCount === 0) {
        meta.paramCount = node.params.length;
        paramNames = node.params.filter(p => p.type === 'Identifier').map(p => p.name);
        if (node.async) meta.hasAsync = true;
      }
    },
  });

  walk.full(ast, (node) => {
    meta.nodeCount++;

    if (branchNodes.has(node.type)) meta.rawCyclomatic++;

    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier') {
      const name = node.id.name;
      if (!TRIVIAL_NAMES.has(name)) { meta.totalVars++; if (name.length > 3) meta.namedVars++; }
    }
    if (node.type === 'Identifier' && paramNames.includes(node.name)) {
      const name = node.name;
      if (!TRIVIAL_NAMES.has(name)) { meta.totalVars++; if (name.length > 3) meta.namedVars++; }
    }

    if (node.type === 'ReturnStatement') meta.returnCount++;
    if (node.type === 'AwaitExpression') meta.hasAwait = true;
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
         node.type === 'ArrowFunctionExpression') && node.async) meta.hasAsync = true;

    if (node.type === 'Literal' && typeof node.value === 'number' &&
        !ALLOWED_MAGIC_NUMBERS.has(node.value)) {
      meta.magicNumbers++;
    }

    if (node.type === 'CallExpression') {
      let depth = 0, cur = node;
      while (cur && cur.type === 'CallExpression') {
        if (cur.callee && cur.callee.type === 'MemberExpression') {
          depth++;
          cur = cur.callee.object;
          if (cur && cur.type === 'CallExpression') continue;
        }
        break;
      }
      if (depth > meta.maxChainLen) meta.maxChainLen = depth;
    }
  });

  walk.ancestor(ast, {
    BlockStatement(node, ancestors) {
      const nestCount = ancestors.filter(a => nestingNodes.has(a.type)).length;
      if (nestCount > meta.maxDepth) meta.maxDepth = nestCount;
    },
  });

  // ── 10 features normalisées ──────────────────────────
  const f1 = Math.min(meta.rawCyclomatic / MAX_CYCLOMATIC, 1.0);
  const f2 = Math.min(meta.maxDepth / MAX_NESTING, 1.0);
  const f3 = meta.totalVars > 0 ? meta.namedVars / meta.totalVars : 0.5;
  const lineRatio = meta.nodeCount > 0 ? meta.totalLines / meta.nodeCount : 1;
  const f4 = lineRatio > 0 ? Math.max(0, 1 - Math.abs(lineRatio - 1.5) / MAX_LINE_RATIO) : 0.5;
  const f5 = Math.max(0, 1 - meta.paramCount / MAX_ARGS);
  const nonEmptyLines = meta.totalLines - (code.match(/^\s*$/gm) || []).length;
  const f6 = nonEmptyLines > 0 ? Math.min(meta.commentLines / nonEmptyLines, 1.0) : 0.0;
  const f7 = Math.min(meta.returnCount / MAX_RETURN_STMTS, 1.0);
  const f8 = (meta.hasAsync && meta.hasAwait) ? 1.0 : (meta.hasAsync || meta.hasAwait) ? 0.5 : 0.0;
  const f9  = Math.min(meta.magicNumbers / MAX_MAGIC_NUMS, 1.0);
  const f10 = Math.min(meta.maxChainLen / MAX_CHAIN_LENGTH, 1.0);

  const features = [f1, f2, f3, f4, f5, f6, f7, f8, f9, f10]
    .map(v => parseFloat(v.toFixed(4)));

  return {
    features,
    details: {
      cyclomaticComplexity: { raw: meta.rawCyclomatic,  normalized: f1 },
      maxNesting:           { raw: meta.maxDepth,        normalized: f2 },
      namingRatio:          { named: meta.namedVars, total: meta.totalVars, normalized: f3 },
      linearity:            { lines: meta.totalLines, nodes: meta.nodeCount, ratio: lineRatio.toFixed(2), normalized: f4 },
      modularity:           { params: meta.paramCount,   normalized: f5 },
      commentRatio:         { comments: meta.commentLines, lines: nonEmptyLines, normalized: f6 },
      returnComplexity:     { count: meta.returnCount,   normalized: f7 },
      asyncAwait:           { hasAsync: meta.hasAsync, hasAwait: meta.hasAwait, normalized: f8 },
      magicNumbers:         { count: meta.magicNumbers,  normalized: f9 },
      chainLength:          { max: meta.maxChainLen,     normalized: f10 },
    },
  };
}

module.exports = { extractFeatures };
