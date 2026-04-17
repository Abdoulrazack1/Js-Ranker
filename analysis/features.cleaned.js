'use strict';

/**
 * Feature Extractor v4 — 16 métriques AST pour JS-Ranker.
 * F1..F16 : cyclomatic, nesting, naming, linearity, modularity,
 * commentRatio, returnComplexity, asyncAwait, magicNumbers, chainLength,
 * modernSyntax, constVsVar, errorHandling, functionLength, purity, SRP.
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');

// Seuils de normalisation

const MAX_CYCLOMATIC      = 20;
const MAX_NESTING         = 8;
const MAX_ARGS            = 7;
const MAX_LINE_RATIO      = 5;
const MAX_RETURN_STMTS    = 8;
const MAX_MAGIC_NUMS      = 10;
const MAX_CHAIN_LENGTH    = 6;
const MAX_MODERN_PATTERNS = 5;
const IDEAL_MIN_LINES     = 8;
const IDEAL_MAX_LINES     = 25;
const MAX_LINES           = 60;

const ALLOWED_MAGIC_NUMBERS = new Set([0, 1, -1, 2, 100, 1000]);
const TRIVIAL_VAR_NAMES     = new Set(['i', 'j', 'k', 'x', 'y', 'z', 'n', 'm', 'e', 't']);

const BRANCH_NODES = new Set([
  'IfStatement', 'ConditionalExpression', 'SwitchCase',
  'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'LogicalExpression', 'CatchClause',
]);

const NESTING_NODES = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'BlockStatement',
  'SwitchStatement', 'TryStatement', 'FunctionExpression', 'ArrowFunctionExpression',
]);

const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
]);

const MODERN_SYNTAX_NODE_TYPES = new Set([
  'ObjectPattern', 'ArrayPattern', 'TemplateLiteral', 'SpreadElement', 'RestElement',
]);

// Parsing AST — module puis script en fallback

/**
 * @param {string} code
 * @returns {acorn.Node}
 * @throws {Error} si syntaxiquement invalide
 */
function parseToAST(code) {
  const parseOptions = { ecmaVersion: 2022, locations: true, ranges: true };
  try {
    return acorn.parse(code, { ...parseOptions, sourceType: 'module' });
  } catch {
    return acorn.parse(code, { ...parseOptions, sourceType: 'script' });
  }
}

// Commentaires — comptage par regex sur source brut

/**
 * @param {string} code
 * @returns {number}
 */
function countCommentLines(code) {
  const singleLineCount = (code.match(/\/\/.*/g) || []).length;
  const multiLineCount  = (code.match(/\/\*[\s\S]*?\*\//g) || [])
    .reduce((total, block) => total + block.split('\n').length, 0);
  return singleLineCount + multiLineCount;
}

// Méta de la première fonction rencontrée

/**
 * @param {acorn.Node[]} params
 * @returns {string[]}
 */
function extractIdentifierParamNames(params) {
  return params.filter(paramNode => paramNode.type === 'Identifier').map(paramNode => paramNode.name);
}

/**
 * @param {acorn.Node} ast
 * @returns {acorn.Node[]}
 */
function collectAllFunctionNodes(ast) {
  const functionNodes = [];
  walk.simple(ast, {
    FunctionDeclaration:     (node) => functionNodes.push(node),
    ArrowFunctionExpression: (node) => functionNodes.push(node),
    FunctionExpression:      (node) => functionNodes.push(node),
  });
  return functionNodes;
}

/**
 * @param {acorn.Node} ast
 * @returns {{ paramCount: number, paramNames: string[], hasAsync: boolean }}
 */
function extractTopFunctionMeta(ast) {
  const allFunctions = collectAllFunctionNodes(ast);
  if (allFunctions.length === 0) return { paramCount: 0, paramNames: [], hasAsync: false };

  const firstFunction = allFunctions[0];
  const paramCount    = firstFunction.params.length;
  const paramNames    = extractIdentifierParamNames(firstFunction.params);
  const hasAsync      = Boolean(firstFunction.async);

  return { paramCount, paramNames, hasAsync };
}

// État initial des métriques

function createMetricsState() {
  return {
    rawCyclomatic: 0, totalVars: 0,    namedVars: 0,
    nodeCount:     0, returnCount: 0,  hasAsync: false, hasAwait: false,
    magicNumbers:  0, maxChainLen: 0,  totalLines: 0,   maxDepth: 0,
    modernPatterns: 0,
    constCount: 0, letCount: 0, varCount: 0,
    hasTryCatch: false, hasThrowError: false, hasCatchBody: false,
    globalAssignments: 0, paramMutations: 0,
  };
}

// Visiteurs AST — un par catégorie de métrique

/**
 * @param {object} state
 * @param {string} varName
 */
function accumulateNaming(state, varName) {
  if (TRIVIAL_VAR_NAMES.has(varName)) return;
  state.totalVars++;
  if (varName.length > 3) state.namedVars++;
}

/**
 * @param {acorn.Node} node
 * @param {object} state
 * @param {string[]} paramNames
 */
function visitNamingNode(node, state, paramNames) {
  const isVariableDeclarator = node.type === 'VariableDeclarator' && node.id?.type === 'Identifier';
  const isParameterUsage     = node.type === 'Identifier' && paramNames.includes(node.name);

  if (isVariableDeclarator) accumulateNaming(state, node.id.name);
  if (isParameterUsage)     accumulateNaming(state, node.name);
}

// Dispatch table — évite une cascade if/else dans visitControlFlowNode
const CONTROL_FLOW_ACTIONS = [
  { matches: (node) => node.type === 'ReturnStatement',                       apply: (state) => { state.returnCount++;      } },
  { matches: (node) => node.type === 'AwaitExpression',                       apply: (state) => { state.hasAwait = true;    } },
  { matches: (node) => FUNCTION_NODE_TYPES.has(node.type) && node.async,      apply: (state) => { state.hasAsync = true;    } },
];

/**
 * Contribue à F7 (returnComplexity) et F8 (asyncAwait).
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitControlFlowNode(node, state) {
  for (const action of CONTROL_FLOW_ACTIONS) {
    if (action.matches(node)) action.apply(state);
  }
}

/**
 * F9 — littéraux numériques hors ALLOWED_MAGIC_NUMBERS.
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitMagicNumberNode(node, state) {
  const isNumericLiteral   = node.type === 'Literal' && typeof node.value === 'number';
  const isUnallowedLiteral = isNumericLiteral && !ALLOWED_MAGIC_NUMBERS.has(node.value);
  if (isUnallowedLiteral) state.magicNumbers++;
}

/**
 * @param {acorn.Node | null | undefined} node
 * @returns {boolean}
 */
function isMethodChainLink(node) {
  return node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression';
}

/**
 * @param {acorn.Node} chainNode
 * @returns {acorn.Node}
 */
function advanceChainNode(chainNode) {
  return chainNode.callee.object;
}

/**
 * Ex : array.filter(fn).map(fn).join(',') -> profondeur 3.
 * @param {acorn.Node} callNode
 * @returns {number}
 */
function measureCallChainDepth(callNode) {
  const accumulator = { node: callNode, depth: 0 };

  const finalState = Array.from({ length: MAX_CHAIN_LENGTH + 1 }).reduce(
    (state) => isMethodChainLink(state.node)
      ? { node: advanceChainNode(state.node), depth: state.depth + 1 }
      : state,
    accumulator
  );

  return finalState.depth;
}

/**
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitCallChainNode(node, state) {
  if (node.type !== 'CallExpression') return;
  const chainDepth = measureCallChainDepth(node);
  if (chainDepth > state.maxChainLen) state.maxChainLen = chainDepth;
}

/**
 * F11 — destructuring, spread, template literals.
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitModernSyntaxNode(node, state) {
  if (MODERN_SYNTAX_NODE_TYPES.has(node.type)) state.modernPatterns++;
}

const DECLARATION_KIND_COUNTER = { const: 'constCount', let: 'letCount', var: 'varCount' };

/**
 * F12 — compteurs const/let/var.
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitDeclarationKindNode(node, state) {
  if (node.type !== 'VariableDeclaration') return;
  const counterKey = DECLARATION_KIND_COUNTER[node.kind];
  if (counterKey) state[counterKey] += node.declarations.length;
}

/**
 * @param {acorn.Node} throwNode
 * @returns {boolean}
 */
function isProperThrowError(throwNode) {
  return throwNode.type === 'ThrowStatement' && throwNode.argument?.type === 'NewExpression';
}

/**
 * @param {acorn.Node} catchNode
 * @returns {boolean}
 */
function isNonEmptyCatchClause(catchNode) {
  return catchNode.type === 'CatchClause' && catchNode.body?.body?.length > 0;
}

const ERROR_HANDLING_DETECTORS = [
  { detect: (node) => node.type === 'TryStatement', stateKey: 'hasTryCatch'   },
  { detect: isProperThrowError,                     stateKey: 'hasThrowError' },
  { detect: isNonEmptyCatchClause,                  stateKey: 'hasCatchBody'  },
];

/**
 * F13 — try/catch, throw new Error(), catch avec corps.
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitErrorHandlingNode(node, state) {
  for (const detector of ERROR_HANDLING_DETECTORS) {
    if (detector.detect(node)) state[detector.stateKey] = true;
  }
}

/**
 * @param {acorn.Node} memberNode
 * @param {string[]} paramNames
 * @returns {boolean}
 */
function isParamMutation(memberNode, paramNames) {
  const rootObject = memberNode.object;
  return rootObject?.type === 'Identifier' && paramNames.includes(rootObject.name);
}

/**
 * F15 — pénalise assignations globales et mutations de paramètres.
 * @param {acorn.Node} node
 * @param {object} state
 * @param {string[]} paramNames
 */
function visitPurityNode(node, state, paramNames) {
  if (node.type !== 'AssignmentExpression') return;

  const leftSide = node.left;
  const isGlobalAssignment = leftSide?.type === 'Identifier';
  const isParamPropertyMutation = leftSide?.type === 'MemberExpression' && isParamMutation(leftSide, paramNames);

  if (isGlobalAssignment)       state.globalAssignments++;
  if (isParamPropertyMutation)  state.paramMutations++;
}

// Parcours AST principal

/**
 * @param {acorn.Node} ast
 * @param {string[]} paramNames
 * @returns {object}
 */
function gatherNodeMetrics(ast, paramNames) {
  const metricsState = createMetricsState();

  walk.full(ast, (node) => {
    metricsState.nodeCount++;
    if (BRANCH_NODES.has(node.type)) metricsState.rawCyclomatic++;

    visitNamingNode(node, metricsState, paramNames);
    visitControlFlowNode(node, metricsState);
    visitMagicNumberNode(node, metricsState);
    visitCallChainNode(node, metricsState);
    visitModernSyntaxNode(node, metricsState);
    visitDeclarationKindNode(node, metricsState);
    visitErrorHandlingNode(node, metricsState);
    visitPurityNode(node, metricsState, paramNames);
  });

  return metricsState;
}

/**
 * @param {acorn.Node} ast
 * @returns {number}
 */
function computeMaxNestingDepth(ast) {
  let maximumDepth = 0;
  walk.ancestor(ast, {
    BlockStatement(_node, ancestors) {
      const nestingDepth = ancestors.filter(ancestor => NESTING_NODES.has(ancestor.type)).length;
      if (nestingDepth > maximumDepth) maximumDepth = nestingDepth;
    },
  });
  return maximumDepth;
}

// F14 — score de longueur idéale

const LENGTH_OVERRUN_PENALTY  = 0.9;
const TRIVIAL_FUNCTION_SCORE  = 0.3;
const MONOLITH_FUNCTION_SCORE = 0.1;
const OVERRUN_FLOOR_SCORE     = 0.1;

function interpolateShortFunctionScore(lineCount) {
  return 0.5 + (lineCount / IDEAL_MIN_LINES) * 0.5;
}

function computeOverrunPenaltyScore(lineCount) {
  const overrunRatio = (lineCount - IDEAL_MAX_LINES) / (MAX_LINES - IDEAL_MAX_LINES);
  return Math.max(OVERRUN_FLOOR_SCORE, 1.0 - overrunRatio * LENGTH_OVERRUN_PENALTY);
}

// Ordre prioritaire — première règle correspondante gagne
const FUNCTION_LENGTH_RULES = [
  { matches: (count) => count <= 2,                 score: () => TRIVIAL_FUNCTION_SCORE                    },
  { matches: (count) => count < IDEAL_MIN_LINES,    score: (count) => interpolateShortFunctionScore(count) },
  { matches: (count) => count <= IDEAL_MAX_LINES,   score: () => 1.0                                       },
  { matches: (count) => count <= MAX_LINES,         score: (count) => computeOverrunPenaltyScore(count)    },
  { matches: () => true,                            score: () => MONOLITH_FUNCTION_SCORE                   },
];

/**
 * @param {number} nonEmptyLineCount
 * @returns {number}
 */
function scoreFunctionLength(nonEmptyLineCount) {
  const matchingRule = FUNCTION_LENGTH_RULES.find(rule => rule.matches(nonEmptyLineCount));
  return matchingRule.score(nonEmptyLineCount);
}

// F12 — const > let >> var

/**
 * @param {object} declCounts
 * @returns {number}
 */
function computeConstVarScore(declCounts) {
  const { constCount, letCount, varCount } = declCounts;
  const totalDeclarations = constCount + letCount + varCount;
  if (totalDeclarations === 0) return 0.5;

  const weightedScore = (constCount * 1.0 + letCount * 0.6) / totalDeclarations;
  return parseFloat(Math.max(0, weightedScore - varCount * 0.1).toFixed(4));
}

// Assemblage du vecteur de 16 features normalisées

/**
 * @returns {number[]} [f1..f5]
 */
function computeBaseFeatures(metrics, topMeta, nonEmptyLines) {
  const lineRatio = metrics.nodeCount > 0 ? metrics.totalLines / metrics.nodeCount : 1;

  const cyclomaticScore = Math.min(metrics.rawCyclomatic / MAX_CYCLOMATIC, 1.0);
  const nestingScore    = Math.min(metrics.maxDepth / MAX_NESTING, 1.0);
  const namingScore     = metrics.totalVars > 0 ? metrics.namedVars / metrics.totalVars : 0.5;
  const linearityScore  = Math.max(0, 1 - Math.abs(lineRatio - 1.5) / MAX_LINE_RATIO);
  const modularityScore = Math.max(0, 1 - topMeta.paramCount / MAX_ARGS);

  return [cyclomaticScore, nestingScore, namingScore, linearityScore, modularityScore];
}

/**
 * @returns {number[]} [f6..f10]
 */
function computeAdvancedFeatures(metrics, commentLineCount, nonEmptyLines) {
  const commentScore = nonEmptyLines > 0 ? Math.min(commentLineCount / nonEmptyLines, 1.0) : 0.0;
  const returnScore  = Math.min(metrics.returnCount / MAX_RETURN_STMTS, 1.0);
  const asyncScore   = metrics.hasAsync && metrics.hasAwait ? 1.0
                     : metrics.hasAsync || metrics.hasAwait  ? 0.5
                     : 0.0;
  const magicScore   = Math.min(metrics.magicNumbers / MAX_MAGIC_NUMS,  1.0);
  const chainScore   = Math.min(metrics.maxChainLen  / MAX_CHAIN_LENGTH, 1.0);

  return [commentScore, returnScore, asyncScore, magicScore, chainScore];
}

/**
 * @returns {number[]} [f11..f16]
 */
function computeStructuralFeatures(metrics, nonEmptyLines) {
  const modernScore  = Math.min(metrics.modernPatterns / MAX_MODERN_PATTERNS, 1.0);
  const constScore   = computeConstVarScore(metrics);

  const errorScore   = (metrics.hasTryCatch   ? 0.40 : 0)
                     + (metrics.hasThrowError ? 0.35 : 0)
                     + (metrics.hasCatchBody  ? 0.25 : 0);
  const handlingScore = Math.min(errorScore, 1.0);

  const lengthScore     = scoreFunctionLength(nonEmptyLines);
  const mutationPenalty = Math.min(metrics.globalAssignments * 0.15 + metrics.paramMutations * 0.2, 1.0);
  const purityScore     = Math.max(0, 1.0 - mutationPenalty);
  const cycloDensity    = nonEmptyLines > 0 ? metrics.rawCyclomatic / nonEmptyLines : 0;
  const srpScore        = Math.max(0, 1.0 - Math.min(cycloDensity * 3, 1.0));

  return [modernScore, constScore, handlingScore, lengthScore, purityScore, srpScore];
}

/**
 * Convention : 1.0 = favorable, 0.0 = défavorable.
 * @returns {number[]} 16 features arrondies à 4 décimales
 */
function buildFeatureVector(metrics, topMeta, commentLineCount, code) {
  const nonEmptyLines      = code.split('\n').filter(line => line.trim().length > 0).length;
  const baseFeatures       = computeBaseFeatures(metrics, topMeta, nonEmptyLines);
  const advancedFeatures   = computeAdvancedFeatures(metrics, commentLineCount, nonEmptyLines);
  const structuralFeatures = computeStructuralFeatures(metrics, nonEmptyLines);

  return [...baseFeatures, ...advancedFeatures, ...structuralFeatures]
    .map(value => parseFloat(value.toFixed(4)));
}

// details = vue enrichie pour l'UI

function buildDetailsObject(metrics, topMeta, features, commentLineCount, nonEmptyLines) {
  return {
    cyclomaticComplexity: { raw: metrics.rawCyclomatic,    normalized: features[0]  },
    maxNesting:           { raw: metrics.maxDepth,         normalized: features[1]  },
    namingRatio:          { named: metrics.namedVars, total: metrics.totalVars, normalized: features[2] },
    linearity:            { lines: metrics.totalLines, nodes: metrics.nodeCount, ratio: (metrics.totalLines / (metrics.nodeCount || 1)).toFixed(2), normalized: features[3] },
    modularity:           { params: topMeta.paramCount,    normalized: features[4]  },
    commentRatio:         { comments: commentLineCount, lines: nonEmptyLines, normalized: features[5] },
    returnComplexity:     { count: metrics.returnCount,    normalized: features[6]  },
    asyncAwait:           { hasAsync: metrics.hasAsync, hasAwait: metrics.hasAwait, normalized: features[7] },
    magicNumbers:         { count: metrics.magicNumbers,   normalized: features[8]  },
    chainLength:          { max: metrics.maxChainLen,      normalized: features[9]  },
    modernSyntax:         { patterns: metrics.modernPatterns, normalized: features[10] },
    constVsVar:           { const: metrics.constCount, let: metrics.letCount, var: metrics.varCount, normalized: features[11] },
    errorHandling:        { tryCatch: metrics.hasTryCatch, throwError: metrics.hasThrowError, normalized: features[12] },
    functionLength:       { lines: nonEmptyLines,          normalized: features[13] },
    purityScore:          { globalMutations: metrics.globalAssignments, paramMutations: metrics.paramMutations, normalized: features[14] },
    singleResponsibility: { cyclomaticPerLine: (metrics.rawCyclomatic / (nonEmptyLines || 1)).toFixed(2), normalized: features[15] },
  };
}

// API publique

/**
 * @param {string} code
 * @returns {{ features: number[], details: object }}
 * @throws {Error} si syntaxe invalide
 */
function extractFeatures(code) {
  let ast;
  try {
    ast = parseToAST(code);
  } catch (parseError) {
    throw new Error(`Erreur de parsing AST : ${parseError.message}`);
  }

  const commentLineCount = countCommentLines(code);
  const topMeta          = extractTopFunctionMeta(ast);
  const rawMetrics       = gatherNodeMetrics(ast, topMeta.paramNames);
  const maxNestingDepth  = computeMaxNestingDepth(ast);

  rawMetrics.maxDepth   = maxNestingDepth;
  rawMetrics.totalLines = code.split('\n').length;
  if (topMeta.hasAsync) rawMetrics.hasAsync = true;

  const features      = buildFeatureVector(rawMetrics, topMeta, commentLineCount, code);
  const nonEmptyLines = code.split('\n').filter(line => line.trim().length > 0).length;
  const details       = buildDetailsObject(rawMetrics, topMeta, features, commentLineCount, nonEmptyLines);

  return { features, details };
}

module.exports = { extractFeatures };
