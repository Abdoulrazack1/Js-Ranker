'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║          JS-RANKER — Feature Extractor (AST)          ║
 * ║   Analyse statique via acorn pour 5 métriques clés    ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const acorn = require('acorn');
const walk = require('acorn-walk');

// ─────────────────────────────────────────────────────────
//  Constantes de normalisation
// ─────────────────────────────────────────────────────────
const MAX_CYCLOMATIC   = 20;   // complexité au-delà = score max (pire)
const MAX_NESTING      = 8;    // imbrication au-delà = score max (pire)
const MAX_ARGS         = 7;    // arguments au-delà = score max (pire)
const MAX_LINE_RATIO   = 5;    // ratio lignes/instructions au-delà considéré anormal

// Noms de variable "triviaux" exclus du ratio de nommage
const TRIVIAL_NAMES = new Set(['i', 'j', 'k', 'x', 'y', 'z', 'n', 'm', 'e', 't']);

/**
 * Parse et extrait les 5 features normalisées d'une fonction JS.
 * @param {string} code — Le code source de la fonction JS
 * @returns {Object} features & méta-données détaillées
 */
function extractFeatures(code) {
  let ast;

  try {
    // Essai en mode module d'abord, puis script
    try {
      ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
    } catch {
      ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    }
  } catch (err) {
    throw new Error(`❌ Erreur de parsing AST : ${err.message}`);
  }

  const meta = {
    rawCyclomatic: 0,
    maxDepth: 0,
    currentDepth: 0,
    totalVars: 0,
    namedVars: 0,
    totalLines: code.split('\n').length,
    nodeCount: 0,
    paramCount: 0,
  };

  // ── 1. Complexité Cyclomatique ─────────────────────────
  // Compte les nœuds qui créent des branches
  const branchNodes = new Set([
    'IfStatement', 'ConditionalExpression',
    'SwitchCase', 'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement',
    'LogicalExpression', 'CatchClause', 'TernaryExpression'
  ]);

  // ── 2. Imbrication Max ────────────────────────────────
  const nestingNodes = new Set([
    'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement', 'BlockStatement',
    'SwitchStatement', 'TryStatement', 'FunctionExpression',
    'ArrowFunctionExpression'
  ]);

  // ── 3. Variables & nommage ────────────────────────────
  let paramNames = [];

  // Récupère les paramètres de la première fonction trouvée
  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (meta.paramCount === 0) {
        meta.paramCount = node.params.length;
        paramNames = node.params
          .filter(p => p.type === 'Identifier')
          .map(p => p.name);
      }
    },
    ArrowFunctionExpression(node) {
      if (meta.paramCount === 0) {
        meta.paramCount = node.params.length;
        paramNames = node.params
          .filter(p => p.type === 'Identifier')
          .map(p => p.name);
      }
    },
    FunctionExpression(node) {
      if (meta.paramCount === 0) {
        meta.paramCount = node.params.length;
        paramNames = node.params
          .filter(p => p.type === 'Identifier')
          .map(p => p.name);
      }
    }
  });

  // Parcours complet pour toutes les métriques
  let depthStack = 0;

  walk.full(ast, (node) => {
    meta.nodeCount++;

    // Complexité cyclomatique
    if (branchNodes.has(node.type)) {
      meta.rawCyclomatic++;
    }

    // Nommage des variables (VariableDeclarator)
    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier') {
      const name = node.id.name;
      if (!TRIVIAL_NAMES.has(name)) {
        meta.totalVars++;
        if (name.length > 3) {
          meta.namedVars++;
        }
      }
    }

    // Paramètres comptabilisés dans le nommage
    if (node.type === 'Identifier' && paramNames.includes(node.name)) {
      const name = node.name;
      if (!TRIVIAL_NAMES.has(name)) {
        meta.totalVars++;
        if (name.length > 3) meta.namedVars++;
      }
    }
  });

  // Calcul de l'imbrication max via ancestor walk
  walk.ancestor(ast, {
    BlockStatement(node, ancestors) {
      const nestCount = ancestors.filter(a => nestingNodes.has(a.type)).length;
      if (nestCount > meta.maxDepth) meta.maxDepth = nestCount;
    }
  });

  // ─────────────────────────────────────────────────────
  //  Calcul des 5 features normalisées [0, 1]
  // ─────────────────────────────────────────────────────

  // Feature 1 — Complexité Cyclomatique (plus c'est élevé, pire c'est)
  const cyclomaticRaw = meta.rawCyclomatic;
  const cyclomaticNorm = Math.min(cyclomaticRaw / MAX_CYCLOMATIC, 1.0);

  // Feature 2 — Imbrication Max (plus c'est profond, pire c'est)
  const nestingNorm = Math.min(meta.maxDepth / MAX_NESTING, 1.0);

  // Feature 3 — Ratio de Nommage (plus c'est élevé, MIEUX c'est)
  const namingRatio = meta.totalVars > 0
    ? meta.namedVars / meta.totalVars
    : 0.5; // Neutre si aucune variable déclarée

  // Feature 4 — Linéarité : lignes / nœuds AST
  // Idéal : ~1-3 lignes par nœud. Trop dense ou trop dilué = mauvais
  const lineRatio = meta.nodeCount > 0
    ? meta.totalLines / meta.nodeCount
    : 1;
  // On normalise : 0 = très anormal, 1 = ratio parfait
  const linearityNorm = lineRatio > 0
    ? Math.max(0, 1 - Math.abs(lineRatio - 1.5) / MAX_LINE_RATIO)
    : 0.5;

  // Feature 5 — Modularité : nb d'arguments (moins = mieux)
  const modularityNorm = Math.max(0, 1 - meta.paramCount / MAX_ARGS);

  const features = [
    parseFloat(cyclomaticNorm.toFixed(4)),
    parseFloat(nestingNorm.toFixed(4)),
    parseFloat(namingRatio.toFixed(4)),
    parseFloat(linearityNorm.toFixed(4)),
    parseFloat(modularityNorm.toFixed(4)),
  ];

  return {
    features,
    details: {
      cyclomaticComplexity: { raw: cyclomaticRaw, normalized: features[0] },
      maxNesting:           { raw: meta.maxDepth, normalized: features[1] },
      namingRatio:          { named: meta.namedVars, total: meta.totalVars, normalized: features[2] },
      linearity:            { lines: meta.totalLines, nodes: meta.nodeCount, ratio: lineRatio.toFixed(2), normalized: features[3] },
      modularity:           { params: meta.paramCount, normalized: features[4] },
    }
  };
}

module.exports = { extractFeatures };
