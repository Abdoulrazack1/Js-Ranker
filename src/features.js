'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║       JS-RANKER — Feature Extractor    (AST)          ║
 * ║                                                       ║
 * ║  16 métriques de qualité JavaScript :                 ║
 * ║   F1  cyclomaticComplexity  — branches logiques       ║
 * ║   F2  maxNesting            — profondeur imbrication  ║
 * ║   F3  namingRatio           — noms descriptifs        ║
 * ║   F4  linearity             — densité lignes/nœuds    ║
 * ║   F5  modularity            — pénalité paramètres     ║
 * ║   F6  commentRatio          — couverture commentaires ║
 * ║   F7  returnComplexity      — points de sortie        ║
 * ║   F8  hasAsyncAwait         — usage async/await       ║
 * ║   F9  magicNumbers          — littéraux bruts         ║
 * ║   F10 chainLength           — chaînes de méthodes     ║
 * ║   F11 modernSyntax          — destructuring, spread…  ║
 * ║   F12 constVsVar            — const > let >> var      ║
 * ║   F13 errorHandling         — try/catch/throw         ║
 * ║   F14 functionLength        — longueur idéale 8–25    ║
 * ║   F15 purityScore           — mutations globales      ║
 * ║   F16 singleResponsibility  — densité cyclomatique    ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');

// ── Seuils de normalisation ───────────────────────────────────────────

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

// ── Parsing AST ─────────────────────────────────────────────────────

/**
 * Parse le code source en AST acorn (essaie module puis script en fallback).
 *
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

// ── Commentaires ─────────────────────────────────────────────────────

/**
 * Compte les lignes couvertes par des commentaires (regex sur source brut).
 * Additionne single-line et blocs multi-lignes.
 *
 * @param {string} code
 * @returns {number}
 */
function countCommentLines(code) {
  const singleLineCount = (code.match(/\/\/.*/g) || []).length;
  const multiLineCount  = (code.match(/\/\*[\s\S]*?\*\//g) || [])
    .reduce((total, block) => total + block.split('\n').length, 0);
  return singleLineCount + multiLineCount;
}

// ── Méta de la première fonction ─────────────────────────────────────

/**
 * Extrait le nombre de paramètres et le flag async de la première fonction rencontrée.
 * Ces valeurs servent à scorer la modularité (F5) et l'async/await (F8).
 *
 * @param {acorn.Node} ast
 * @returns {{ paramCount: number, paramNames: string[], hasAsync: boolean }}
 */
/**
 * Extrait les noms d'identifiants parmi les paramètres d'un nœud fonction.
 * Filtre les patterns de destructuring qui ne sont pas de simples identifiants.
 *
 * @param {acorn.Node[]} params — tableau params[] d'un nœud fonction
 * @returns {string[]}
 */
function extractIdentifierParamNames(params) {
  return params.filter(paramNode => paramNode.type === 'Identifier').map(paramNode => paramNode.name);
}

/**
 * Collecte tous les nœuds fonctions présents dans l'AST (déclarations, expressions, arrows).
 * Retourne la liste brute avant sélection du premier élément.
 *
 * @param {acorn.Node} ast — arbre AST acorn
 * @returns {acorn.Node[]} tous les nœuds de type fonction rencontrés
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
 * Extrait le nombre de paramètres, leurs noms et le flag async de la première
 * fonction rencontrée dans l'AST.
 * Sert à scorer la modularité (F5) et l'usage async/await (F8).
 *
 * @param {acorn.Node} ast — arbre AST acorn
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

// ── État initial des métriques ───────────────────────────────────────

/**
 * Crée et retourne l'objet d'état initial pour l'accumulation des métriques.
 *
 * @returns {object}
 */
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

// ── Visiteurs de nœuds AST (un par catégorie de métrique) ────────────

/**
 * Accumule le compteur de nommage pour un identifiant si non trivial.
 * Un nom trivial est une lettre unique (i, j, x…) ou très court.
 *
 * @param {object} state — état mutable des métriques
 * @param {string} varName — nom de variable à évaluer
 */
function accumulateNaming(state, varName) {
  if (TRIVIAL_VAR_NAMES.has(varName)) return;
  state.totalVars++;
  if (varName.length > 3) state.namedVars++;
}

/**
 * Traite les nœuds de nommage (VariableDeclarator et paramètres).
 *
 * @param {acorn.Node} node
 * @param {object} state
 * @param {string[]} paramNames — noms des paramètres de la fonction analysée
 */
/**
 * Traite un nœud de déclaration de variable ou d'usage de paramètre.
 * Délègue le comptage à accumulateNaming pour filtrer les noms triviaux.
 *
 * @param {acorn.Node} node — nœud AST courant
 * @param {object} state — état des métriques (totalVars / namedVars)
 * @param {string[]} paramNames — paramètres de la fonction analysée
 */
function visitNamingNode(node, state, paramNames) {
  const isVariableDeclarator = node.type === 'VariableDeclarator' && node.id?.type === 'Identifier';
  const isParameterUsage     = node.type === 'Identifier' && paramNames.includes(node.name);

  if (isVariableDeclarator) accumulateNaming(state, node.id.name);
  if (isParameterUsage)     accumulateNaming(state, node.name);
}

/**
 * Traite les nœuds de flux de contrôle : return, await et fonctions async.
 *
 * @param {acorn.Node} node
 * @param {object} state
 */
/**
 * Table de dispatch pour les nœuds de flux de contrôle.
 * Chaque entrée définit un prédicat de correspondance et l'action à appliquer sur state.
 * Cette approche évite une densité cyclomatique élevée dans visitControlFlowNode.
 */
const CONTROL_FLOW_ACTIONS = [
  { matches: (node) => node.type === 'ReturnStatement',                       apply: (state) => { state.returnCount++;      } },
  { matches: (node) => node.type === 'AwaitExpression',                        apply: (state) => { state.hasAwait = true;    } },
  { matches: (node) => FUNCTION_NODE_TYPES.has(node.type) && node.async,       apply: (state) => { state.hasAsync = true;    } },
];

/**
 * Traite les nœuds de flux de contrôle : return, await, et fonctions async.
 * Utilise CONTROL_FLOW_ACTIONS pour un dispatch sans branches if/else accumulées.
 * Contribue aux métriques F7 (returnComplexity) et F8 (asyncAwait).
 *
 * @param {acorn.Node} node — nœud AST courant à inspecter
 * @param {object} state — état mutable des métriques (returnCount / hasAwait / hasAsync)
 */
function visitControlFlowNode(node, state) {
  for (const action of CONTROL_FLOW_ACTIONS) {
    if (action.matches(node)) action.apply(state);
  }
}

/**
 * Détecte et comptabilise les littéraux numériques magiques (non-triviaux).
 *
 * @param {acorn.Node} node
 * @param {object} state
 */
/**
 * Détecte les littéraux numériques magiques (non présents dans ALLOWED_MAGIC_NUMBERS).
 * Contribue à la métrique F9 (magicNumbers) — favorise les constantes nommées.
 *
 * @param {acorn.Node} node — nœud AST à inspecter
 * @param {object} state — état des métriques (magicNumbers)
 */
function visitMagicNumberNode(node, state) {
  const isNumericLiteral   = node.type === 'Literal' && typeof node.value === 'number';
  const isUnallowedLiteral = isNumericLiteral && !ALLOWED_MAGIC_NUMBERS.has(node.value);
  if (isUnallowedLiteral) state.magicNumbers++;
}

/**
 * Mesure la longueur d'une chaîne de méthodes depuis un nœud CallExpression.
 * Remonte récursivement les MemberExpression imbriqués.
 *
 * @param {acorn.Node} callNode
 * @returns {number} profondeur de la chaîne
 */
/**
 * Vérifie si un nœud constitue un maillon valide d'une chaîne de méthodes.
 * Un maillon valide est un CallExpression dont le callee est un MemberExpression.
 *
 * @param {acorn.Node | null | undefined} node
 * @returns {boolean}
 */
function isMethodChainLink(node) {
  return node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression';
}

/**
 * Avance d'un cran dans la chaîne de méthodes en remontant vers l'objet racine.
 * Retourne le nœud suivant (l'objet du callee du nœud courant).
 *
 * @param {acorn.Node} chainNode — maillon courant (CallExpression avec MemberExpression)
 * @returns {acorn.Node} nœud parent dans la chaîne
 */
function advanceChainNode(chainNode) {
  return chainNode.callee.object;
}

/**
 * Mesure la profondeur d'une chaîne de méthodes depuis un nœud CallExpression.
 * Remonte les MemberExpression imbriqués en comptant les maillons.
 * Ex : array.filter(fn).map(fn).join(',') → profondeur 3.
 *
 * @param {acorn.Node} callNode — nœud CallExpression de départ
 * @returns {number} nombre d'appels de méthode enchaînés
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
 * Met à jour la longueur maximale de chaîne si le nœud CallExpression dépasse l'actuelle.
 *
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitCallChainNode(node, state) {
  if (node.type !== 'CallExpression') return;
  const chainDepth = measureCallChainDepth(node);
  if (chainDepth > state.maxChainLen) state.maxChainLen = chainDepth;
}

/**
 * Détecte les patterns de syntaxe moderne ES6+ : destructuring, spread, template literals.
 *
 * @param {acorn.Node} node
 * @param {object} state
 */
function visitModernSyntaxNode(node, state) {
  if (MODERN_SYNTAX_NODE_TYPES.has(node.type)) state.modernPatterns++;
}

/**
 * Comptabilise les déclarations const / let / var pour évaluer la préférence d'immutabilité.
 *
 * @param {acorn.Node} node
 * @param {object} state
 */
/** Correspondance entre le mot-clé de déclaration et le compteur dans state. */
const DECLARATION_KIND_COUNTER = { const: 'constCount', let: 'letCount', var: 'varCount' };

/**
 * Comptabilise les déclarations const / let / var pour la métrique F12 (constVsVar).
 * Utilise DECLARATION_KIND_COUNTER pour éviter les branches if/else enchevêtrées.
 *
 * @param {acorn.Node} node — nœud VariableDeclaration à inspecter
 * @param {object} state — état des métriques (constCount / letCount / varCount)
 */
function visitDeclarationKindNode(node, state) {
  if (node.type !== 'VariableDeclaration') return;
  const counterKey = DECLARATION_KIND_COUNTER[node.kind];
  if (counterKey) state[counterKey] += node.declarations.length;
}

/**
 * Détecte la présence de gestion d'erreurs : try/catch, catch avec corps, throw Error.
 *
 * @param {acorn.Node} node
 * @param {object} state
 */
/**
 * Vérifie si un ThrowStatement lance bien une instance (new Error) et non une valeur brute.
 *
 * @param {acorn.Node} throwNode — nœud ThrowStatement
 * @returns {boolean}
 */
function isProperThrowError(throwNode) {
  return throwNode.type === 'ThrowStatement' && throwNode.argument?.type === 'NewExpression';
}

/**
 * Vérifie si un CatchClause possède un corps non vide (catch qui fait quelque chose).
 *
 * @param {acorn.Node} catchNode — nœud CatchClause
 * @returns {boolean}
 */
function isNonEmptyCatchClause(catchNode) {
  return catchNode.type === 'CatchClause' && catchNode.body?.body?.length > 0;
}

/**
 * Table de dispatch : prédicat → clé d'état à mettre à true.
 * Évite les branches if/else répétées dans visitErrorHandlingNode.
 * Chaque entrée associe un test sur le nœud à la propriété qu'il active.
 */
const ERROR_HANDLING_DETECTORS = [
  { detect: (node) => node.type === 'TryStatement', stateKey: 'hasTryCatch'  },
  { detect: isProperThrowError,                      stateKey: 'hasThrowError' },
  { detect: isNonEmptyCatchClause,                   stateKey: 'hasCatchBody'  },
];

/**
 * Détecte les patterns de gestion d'erreurs pour la métrique F13 (errorHandling).
 * Récompense try/catch, throw new Error(), et les catch avec corps non vide.
 * Utilise ERROR_HANDLING_DETECTORS pour un dispatch sans branches accumulées.
 *
 * @param {acorn.Node} node — nœud AST courant à inspecter
 * @param {object} state — état des métriques (hasTryCatch / hasThrowError / hasCatchBody)
 */
function visitErrorHandlingNode(node, state) {
  for (const detector of ERROR_HANDLING_DETECTORS) {
    if (detector.detect(node)) state[detector.stateKey] = true;
  }
}

/**
 * Détecte les mutations impures : assignation globale et mutation de paramètre objet.
 *
 * @param {acorn.Node} node
 * @param {object} state
 * @param {string[]} paramNames — paramètres à surveiller pour mutation
 */
/**
 * Vérifie si un nœud MemberExpression cible un paramètre de la fonction analysée.
 * Détecte les mutations du type param.propriété = valeur.
 *
 * @param {acorn.Node} memberNode — nœud MemberExpression (côté gauche d'une assignation)
 * @param {string[]} paramNames — noms des paramètres à surveiller
 * @returns {boolean}
 */
function isParamMutation(memberNode, paramNames) {
  const rootObject = memberNode.object;
  return rootObject?.type === 'Identifier' && paramNames.includes(rootObject.name);
}

/**
 * Détecte les mutations impures pour la métrique F15 (purityScore).
 * Pénalise les assignations globales et les mutations de paramètres via membre.
 *
 * @param {acorn.Node} node — nœud AST courant
 * @param {object} state — état des métriques (globalAssignments / paramMutations)
 * @param {string[]} paramNames — paramètres de la fonction analysée
 */
function visitPurityNode(node, state, paramNames) {
  if (node.type !== 'AssignmentExpression') return;

  const leftSide = node.left;
  const isGlobalAssignment = leftSide?.type === 'Identifier';
  const isParamPropertyMutation = leftSide?.type === 'MemberExpression' && isParamMutation(leftSide, paramNames);

  if (isGlobalAssignment)       state.globalAssignments++;
  if (isParamPropertyMutation)  state.paramMutations++;
}

// ── Parcours AST principal ────────────────────────────────────────────

/**
 * Parcourt tous les nœuds AST et accumule les 16 métriques brutes.
 * Délègue chaque catégorie à son visiteur dédié pour rester lisible.
 *
 * @param {acorn.Node} ast
 * @param {string[]} paramNames — noms des paramètres de la fonction principale
 * @returns {object} état complet des métriques brutes
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

// ── Profondeur d'imbrication ─────────────────────────────────────────

/**
 * Calcule la profondeur maximale d'imbrication de blocs via les ancêtres AST.
 * Chaque type de nœud de contrôle (if, for, while…) ajoute un niveau.
 *
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

// ── F14 — Score de longueur idéale ───────────────────────────────────

/** Facteur de pénalité pour les fonctions dépassant la longueur idéale. */
const LENGTH_OVERRUN_PENALTY = 0.9;

/**
 * Score la longueur d'une fonction : idéal entre 8 et 25 lignes non vides.
 * Pénalise les fonctions triviales (≤ 2 lignes) et les monolithes (> 60 lignes).
 *
 * @param {number} nonEmptyLineCount — lignes non vides de la fonction
 * @returns {number} score dans [0..1]
 */
/** Score accordé à une fonction triviale (≤ 2 lignes non vides). */
const TRIVIAL_FUNCTION_SCORE = 0.3;

/** Score plancher pour les monolithes dépassant MAX_LINES. */
const MONOLITH_FUNCTION_SCORE = 0.1;

/** Score minimal pour les fonctions dans la zone de dépassement [IDEAL_MAX..MAX]. */
const OVERRUN_FLOOR_SCORE = 0.1;

/**
 * Calcule le score d'interpolation pour une fonction légèrement courte (sous IDEAL_MIN_LINES).
 * Produit un score entre 0.5 (1 ligne) et 1.0 (IDEAL_MIN_LINES lignes).
 *
 * @param {number} lineCount — nombre de lignes non vides
 * @returns {number} score dans [0.5..1.0]
 */
function interpolateShortFunctionScore(lineCount) {
  return 0.5 + (lineCount / IDEAL_MIN_LINES) * 0.5;
}

/**
 * Calcule le score de pénalité pour une fonction dépassant la longueur idéale.
 * La pénalité est proportionnelle au dépassement jusqu'à MAX_LINES.
 *
 * @param {number} lineCount — nombre de lignes non vides
 * @returns {number} score dans [OVERRUN_FLOOR_SCORE..1.0]
 */
function computeOverrunPenaltyScore(lineCount) {
  const overrunRatio = (lineCount - IDEAL_MAX_LINES) / (MAX_LINES - IDEAL_MAX_LINES);
  return Math.max(OVERRUN_FLOOR_SCORE, 1.0 - overrunRatio * LENGTH_OVERRUN_PENALTY);
}

/**
 * Table de règles pour le scoring de longueur de fonction.
 * Chaque règle définit un prédicat de correspondance et le calcul associé.
 * L'ordre est prioritaire — la première règle correspondante est appliquée.
 */
const FUNCTION_LENGTH_RULES = [
  { matches: (count) => count <= 2,                 score: () => TRIVIAL_FUNCTION_SCORE                      },
  { matches: (count) => count < IDEAL_MIN_LINES,    score: (count) => interpolateShortFunctionScore(count)   },
  { matches: (count) => count <= IDEAL_MAX_LINES,   score: () => 1.0                                         },
  { matches: (count) => count <= MAX_LINES,         score: (count) => computeOverrunPenaltyScore(count)      },
  { matches: () => true,                            score: () => MONOLITH_FUNCTION_SCORE                     },
];

/**
 * Score la longueur d'une fonction selon sa proximité à la zone idéale (8–25 lignes).
 * Utilise FUNCTION_LENGTH_RULES pour un dispatch sans chaîne de if/return.
 * Pénalise les fonctions triviales (≤ 2 lignes) et les monolithes (> MAX_LINES).
 *
 * @param {number} nonEmptyLineCount — lignes non vides de la fonction analysée
 * @returns {number} score de longueur dans [0..1]
 */
function scoreFunctionLength(nonEmptyLineCount) {
  const matchingRule = FUNCTION_LENGTH_RULES.find(rule => rule.matches(nonEmptyLineCount));
  return matchingRule.score(nonEmptyLineCount);
}

// ── Normalisation F12 — const vs var ─────────────────────────────────

/**
 * Calcule le score d'immutabilité depuis les compteurs de déclarations.
 * const → 1.0, let → 0.6, var → pénalité −0.1 par déclaration.
 *
 * @param {object} declCounts — { constCount, letCount, varCount }
 * @returns {number} score dans [0..1]
 */
function computeConstVarScore(declCounts) {
  const { constCount, letCount, varCount } = declCounts;
  const totalDeclarations = constCount + letCount + varCount;
  if (totalDeclarations === 0) return 0.5;

  const weightedScore = (constCount * 1.0 + letCount * 0.6) / totalDeclarations;
  return parseFloat(Math.max(0, weightedScore - varCount * 0.1).toFixed(4));
}

// ── Assemblage du vecteur de 16 features normalisées ─────────────────

/**
 * Calcule les features fondamentales F1–F5 (complexité, nommage, structure, modularité).
 * Ces métriques mesurent la qualité architecturale de base de la fonction.
 *
 * @param {object} metrics — métriques brutes collectées par gatherNodeMetrics
 * @param {object} topMeta — { paramCount } de la première fonction rencontrée
 * @param {number} nonEmptyLines — lignes non vides du code analysé
 * @returns {number[]} vecteur [f1, f2, f3, f4, f5] dans [0..1]
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
 * Calcule les features avancées F6–F10 (commentaires, retours, async, nombres magiques, chaînes).
 * Ces métriques mesurent la lisibilité et les pratiques de code modernes.
 *
 * @param {object} metrics — métriques brutes collectées par gatherNodeMetrics
 * @param {number} commentLineCount — nb de lignes couvertes par des commentaires
 * @param {number} nonEmptyLines — lignes non vides du code analysé
 * @returns {number[]} vecteur [f6, f7, f8, f9, f10] dans [0..1]
 */
function computeAdvancedFeatures(metrics, commentLineCount, nonEmptyLines) {
  const commentScore = nonEmptyLines > 0 ? Math.min(commentLineCount / nonEmptyLines, 1.0) : 0.0;
  const returnScore  = Math.min(metrics.returnCount / MAX_RETURN_STMTS, 1.0);
  const asyncScore   = metrics.hasAsync && metrics.hasAwait ? 1.0
                     : metrics.hasAsync || metrics.hasAwait  ? 0.5
                     : 0.0;
  const magicScore   = Math.min(metrics.magicNumbers / MAX_MAGIC_NUMS,  1.0);
  const chainScore   = Math.min(metrics.maxChainLen   / MAX_CHAIN_LENGTH, 1.0);

  return [commentScore, returnScore, asyncScore, magicScore, chainScore];
}

/**
 * Calcule les features structurelles F11–F16 (syntaxe moderne, const/var, erreurs, longueur, pureté, SRP).
 * Ces métriques évaluent la qualité architecturale de haut niveau.
 *
 * @param {object} metrics — métriques brutes collectées par gatherNodeMetrics
 * @param {number} nonEmptyLines — lignes non vides du code analysé
 * @returns {number[]} vecteur [f11, f12, f13, f14, f15, f16] dans [0..1]
 */
function computeStructuralFeatures(metrics, nonEmptyLines) {
  const modernScore  = Math.min(metrics.modernPatterns / MAX_MODERN_PATTERNS, 1.0);
  const constScore   = computeConstVarScore(metrics);

  const errorScore   = (metrics.hasTryCatch  ? 0.40 : 0)
                     + (metrics.hasThrowError ? 0.35 : 0)
                     + (metrics.hasCatchBody  ? 0.25 : 0);
  const handlingScore = Math.min(errorScore, 1.0);

  const lengthScore      = scoreFunctionLength(nonEmptyLines);
  const mutationPenalty  = Math.min(metrics.globalAssignments * 0.15 + metrics.paramMutations * 0.2, 1.0);
  const purityScore      = Math.max(0, 1.0 - mutationPenalty);
  const cycloDensity     = nonEmptyLines > 0 ? metrics.rawCyclomatic / nonEmptyLines : 0;
  const srpScore         = Math.max(0, 1.0 - Math.min(cycloDensity * 3, 1.0));

  return [modernScore, constScore, handlingScore, lengthScore, purityScore, srpScore];
}

/**
 * Assemble le vecteur complet de 16 features normalisées depuis les métriques brutes.
 * Délègue le calcul à trois sous-fonctions thématiques puis fusionne les résultats.
 * Convention uniforme : 1.0 = favorable, 0.0 = défavorable.
 *
 * @param {object} metrics — métriques brutes (gatherNodeMetrics + maxDepth + totalLines)
 * @param {object} topMeta — { paramCount, hasAsync } de la fonction principale
 * @param {number} commentLineCount — nb de lignes commentaires
 * @param {string} code — code source brut (pour compter les lignes non vides)
 * @returns {number[]} vecteur de 16 features arrondies à 4 décimales
 */
function buildFeatureVector(metrics, topMeta, commentLineCount, code) {
  const nonEmptyLines      = code.split('\n').filter(line => line.trim().length > 0).length;
  const baseFeatures       = computeBaseFeatures(metrics, topMeta, nonEmptyLines);
  const advancedFeatures   = computeAdvancedFeatures(metrics, commentLineCount, nonEmptyLines);
  const structuralFeatures = computeStructuralFeatures(metrics, nonEmptyLines);

  return [...baseFeatures, ...advancedFeatures, ...structuralFeatures]
    .map(value => parseFloat(value.toFixed(4)));
}

// ── Assemblage de l'objet details ────────────────────────────────────

/**
 * Construit l'objet details associant chaque feature à ses valeurs brutes.
 * Utilisé par l'UI pour afficher les métriques enrichies.
 *
 * @param {object} metrics
 * @param {object} topMeta
 * @param {number[]} features
 * @param {number} commentLineCount
 * @param {number} nonEmptyLines
 * @returns {object}
 */
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

// ── API publique ──────────────────────────────────────────────────────

/**
 * Extrait les 16 features de qualité d'un extrait de code JavaScript.
 *
 * @param  {string} code — code source à analyser (fonction ou fichier entier)
 * @returns {{ features: number[], details: object }}
 * @throws  {Error} si le code est syntaxiquement invalide
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
