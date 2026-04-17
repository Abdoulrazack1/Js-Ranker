'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Décomposeur de fichiers JS        ║
 * ║   Découpe un fichier en tranches de fonctions         ║
 * ║   et agrège leurs scores individuels.                 ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');
const { extractFeatures } = require('./features');

// ── Constantes ──────────────────────────────────────────────────────

/** Types de nœuds AST représentant des fonctions. */
const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const MIN_FUNCTION_LINES = 2;
const MIN_FUNCTION_CHARS = 20;

// ── Parsing AST ─────────────────────────────────────────────────────

/**
 * Parse du code source en AST acorn avec fallback module → script.
 *
 * @param {string} code
 * @returns {acorn.Node} nœud racine AST
 * @throws {Error} si le code est syntaxiquement invalide
 */
function parseCodeToAST(code) {
  const parseOptions = { ecmaVersion: 2022, locations: true, ranges: true };
  try {
    return acorn.parse(code, { ...parseOptions, sourceType: 'module' });
  } catch {
    return acorn.parse(code, { ...parseOptions, sourceType: 'script' });
  }
}

// ── Détection du niveau pseudo-top-level ────────────────────────────

/**
 * Vérifie si un nœud fonction est au niveau top-level effectif.
 * Les IIFE et callbacks d'événements anonymes sont considérés comme wrappers structurels.
 *
 * @param {acorn.Node[]} ancestors — chemin depuis la racine jusqu'au nœud
 * @returns {boolean}
 */
function isEffectiveTopLevel(ancestors) {
  const functionAncestors = ancestors
    .slice(0, -1)
    .filter(ancestor => FUNCTION_NODE_TYPES.has(ancestor.type));

  if (functionAncestors.length === 0) return true;

  // Tous les ancêtres-fonctions doivent être des wrappers anonymes (IIFE / callbacks)
  return functionAncestors.every(ancestor => {
    return ancestor.type !== 'FunctionDeclaration' && !(ancestor.id && ancestor.id.name);
  });
}

// ── Collecte d'une tranche de fonction ──────────────────────────────

/**
 * Contexte de collecte partagé entre les visiteurs AST.
 *
 * @typedef {{ code: string, list: object[], seen: Set<string> }} CollectContext
 */

/**
 * Résout le nom d'un nœud fonction selon son type.
 *
 * @param {acorn.Node} node — nœud FunctionDeclaration / Expression / Arrow
 * @param {string} [forceName] — nom prioritaire (depuis VariableDeclarator ou MethodDefinition)
 * @param {string} [nodeType] — 'declaration' | 'arrow' | 'method'
 * @returns {string}
 */
/** Libellé utilisé pour les fonctions fléchées sans variable associée. */
const ANONYMOUS_ARROW_LABEL    = '<arrow>';

/** Libellé utilisé pour les fonctions expression sans nom détectable. */
const ANONYMOUS_FUNCTION_LABEL = '<anonymous>';

/**
 * Résout le nom affiché d'un nœud fonction selon la priorité suivante :
 * 1. forceName fourni explicitement (depuis VariableDeclarator ou MethodDefinition)
 * 2. node.id.name si la fonction est nommée (FunctionDeclaration)
 * 3. ANONYMOUS_ARROW_LABEL pour les fonctions fléchées
 * 4. ANONYMOUS_FUNCTION_LABEL pour tout autre cas
 *
 * @param {acorn.Node} node — nœud de la fonction AST
 * @param {string | null} forceName — nom prioritaire fourni par le contexte
 * @param {string} nodeType — 'declaration' | 'arrow' | 'method'
 * @returns {string}
 */
function resolveFunctionName(node, forceName, nodeType) {
  if (forceName)       return forceName;
  if (node.id?.name)   return node.id.name;
  if (nodeType === 'arrow') return ANONYMOUS_ARROW_LABEL;
  return ANONYMOUS_FUNCTION_LABEL;
}

/**
 * Extrait et enregistre une tranche de fonction dans le contexte de collecte.
 * Ignore les fonctions trop courtes (< MIN_FUNCTION_LINES ou MIN_FUNCTION_CHARS).
 *
 * @param {acorn.Node} node — nœud de la fonction
 * @param {CollectContext} ctx
 * @param {object} opts — { forceName?, nodeType?, parentNode? }
 */
function collectFunctionSlice(node, ctx, opts = {}) {
  const dedupeKey = `${node.start}-${node.end}`;
  if (ctx.seen.has(dedupeKey)) return;
  ctx.seen.add(dedupeKey);

  const sliceStart = opts.parentNode ? opts.parentNode.start : node.start;
  const slice      = ctx.code.slice(sliceStart, node.end);
  const lineCount  = slice.split('\n').length;

  if (slice.length < MIN_FUNCTION_CHARS || lineCount < MIN_FUNCTION_LINES) return;

  ctx.list.push({
    name:      resolveFunctionName(node, opts.forceName, opts.nodeType),
    type:      opts.nodeType || 'declaration',
    slice,
    lineStart: node.loc?.start.line ?? '?',
    lineEnd:   node.loc?.end.line   ?? '?',
    charCount: slice.length,
    lineCount,
    start:     sliceStart,
    end:       node.end,
  });
}

// ── Visiteurs AST ────────────────────────────────────────────────────

/**
 * Visite les FunctionDeclarations au niveau top-level effectif.
 * Collecte chaque déclaration de fonction nommée pour analyse.
 *
 * @param {CollectContext} ctx — contexte de collecte partagé (code, list, seen)
 * @returns {function(acorn.Node, acorn.Node[]): void} visiteur compatible acorn-walk
 */
function visitFunctionDeclaration(ctx) {
  return (functionNode, ancestorNodes) => {
    const shouldCollect = isEffectiveTopLevel(ancestorNodes);
    if (shouldCollect) collectFunctionSlice(functionNode, ctx, { nodeType: 'declaration' });
  };
}

/**
 * Visite les VariableDeclarations top-level contenant des fonctions fléchées ou expressions.
 * Associe automatiquement le nom de la variable à la fonction anonyme déclarée.
 *
 * @param {CollectContext} ctx — contexte de collecte partagé
 * @returns {function(acorn.Node, acorn.Node[]): void} visiteur compatible acorn-walk
 */
/**
 * Tente de collecter une tranche de fonction depuis un VariableDeclarator.
 * Vérifie que l'initialiseur est une fonction fléchée ou expression.
 * Associe le nom de la variable à la fonction anonyme pour un meilleur rapport.
 *
 * @param {acorn.Node} declarator — nœud VariableDeclarator (const fn = () => {})
 * @param {acorn.Node} parentDeclaration — nœud VariableDeclaration parent
 * @param {CollectContext} ctx — contexte de collecte partagé
 */
function collectArrowDeclarator(declarator, parentDeclaration, ctx) {
  const initNode = declarator.init;
  if (!initNode) return;

  const isFunctionExpression = initNode.type === 'ArrowFunctionExpression'
                             || initNode.type === 'FunctionExpression';
  if (!isFunctionExpression) return;

  const inferredName = declarator.id?.type === 'Identifier' ? declarator.id.name : '<anonymous>';
  collectFunctionSlice(initNode, ctx, { forceName: inferredName, nodeType: 'arrow', parentNode: parentDeclaration });
}

/**
 * Traite une VariableDeclaration top-level en collectant les déclarateurs
 * qui initialisent une fonction fléchée ou expression.
 * Délègue chaque déclarateur à collectArrowDeclarator.
 *
 * @param {acorn.Node} declarationNode — nœud VariableDeclaration (const fn = () => {})
 * @param {acorn.Node[]} ancestorNodes — chemin depuis la racine AST
 * @param {CollectContext} ctx — contexte de collecte partagé (code, list, seen)
 */
function handleArrowDeclaration(declarationNode, ancestorNodes, ctx) {
  if (!isEffectiveTopLevel(ancestorNodes)) return;
  for (const declarator of declarationNode.declarations) {
    collectArrowDeclarator(declarator, declarationNode, ctx);
  }
}

/**
 * Crée le visiteur acorn-walk pour les VariableDeclarations contenant des fonctions.
 * Délègue le traitement à handleArrowDeclaration pour rester testable et lisible.
 *
 * @param {CollectContext} ctx — contexte de collecte partagé
 * @returns {function(acorn.Node, acorn.Node[]): void} visiteur compatible acorn-walk ancestor
 */
function visitArrowFunctions(ctx) {
  return (declarationNode, ancestorNodes) => handleArrowDeclaration(declarationNode, ancestorNodes, ctx);
}

/** Libellé de fallback pour les méthodes de classe sans nom d'identifiant. */
const ANONYMOUS_METHOD_LABEL = '<method>';

/**
 * Résout le nom affiché d'un nœud MethodDefinition.
 * Retourne le nom de la clé si c'est un identifiant, sinon ANONYMOUS_METHOD_LABEL.
 *
 * @param {acorn.Node} methodNode — nœud MethodDefinition
 * @returns {string}
 */
function resolveMethodName(methodNode) {
  return methodNode.key?.type === 'Identifier' ? methodNode.key.name : ANONYMOUS_METHOD_LABEL;
}

/**
 * Visite les MethodDefinitions au niveau top-level (dans des classes non imbriquées).
 * Associe le nom de la méthode et collecte la tranche de code de sa valeur.
 *
 * @param {CollectContext} ctx — contexte de collecte partagé (code, list, seen)
 * @returns {function(acorn.Node, acorn.Node[]): void} visiteur acorn-walk ancestor
 */
function visitMethodDefinitions(ctx) {
  return (methodNode, ancestorNodes) => {
    const isValidMethod = isEffectiveTopLevel(ancestorNodes) && methodNode.value;
    if (!isValidMethod) return;

    const methodName = resolveMethodName(methodNode);
    collectFunctionSlice(methodNode.value, ctx, { forceName: methodName, nodeType: 'method' });
  };
}

// ── Extraction principale ────────────────────────────────────────────

/**
 * Extrait toutes les fonctions top-level d'un fichier JS en tranches de code.
 *
 * @param {string} code — source complet du fichier
 * @returns {{ functions: object[], ast: acorn.Node, code: string }}
 * @throws {Error} si le code est syntaxiquement invalide
 */
function extractFunctionSlices(code) {
  let ast;
  try {
    ast = parseCodeToAST(code);
  } catch (err) {
    throw new Error(`Parsing AST impossible : ${err.message}`);
  }

  const ctx = { code, list: [], seen: new Set() };

  walk.ancestor(ast, {
    FunctionDeclaration: visitFunctionDeclaration(ctx),
    VariableDeclaration:  visitArrowFunctions(ctx),
    MethodDefinition:     visitMethodDefinitions(ctx),
  });

  return { functions: ctx.list, ast, code };
}

// ── Analyse du scope global ──────────────────────────────────────────

/**
 * Analyse le code hors-fonctions (scope global) pour détecter var, mutations,
 * en-tête de fichier et exports propres.
 *
 * @param {string} code — source complet
 * @param {object[]} functions — fonctions déjà extraites (pour masquage)
 * @returns {object} métriques de scope global
 */
function analyzeGlobalScope(code, functions) {
  const covered = buildCoverageMap(code.length, functions);
  const globalCode = extractGlobalCode(code, covered);

  const globalLines  = globalCode.split('\n').filter(line => line.trim().length > 0);
  const totalLines   = code.split('\n').filter(line => line.trim().length > 0).length;
  const globalDensity = totalLines > 0 ? globalLines.length / totalLines : 0;

  // Strip comments before counting var keywords to avoid false positives
  // (e.g. "// const > let >> var" or JSDoc @param lines with "var" in them)
  const globalCodeNoComments = globalCode
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const globalVarCount  = (globalCodeNoComments.match(/\bvar\s+/g) || []).length;
  const globalMutations = (globalCode.match(/^(?!\s*(?:const|let|var|function|class|import|export))\s*\w+\s*=/mg) || []).length;

  // Detect file header in the first 8 lines — handles 'use strict'; before JSDoc
  const fileHeaderRegion = code.split('\n').slice(0, 8).join('\n');
  const hasFileHeader = /\/\*\*?/.test(fileHeaderRegion) || /^\s*\/\//.test(fileHeaderRegion);
  const hasCleanExports = /module\.exports\s*=\s*\{/.test(globalCode) ||
                          /^export\s+(default|const|function|class)/m.test(globalCode);

  const scopeScore = computeScopeScore(globalDensity, globalVarCount, globalMutations, hasFileHeader, hasCleanExports);

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

/**
 * Construit un Uint8Array marquant les positions couvertes par les fonctions.
 *
 * @param {number} codeLength
 * @param {object[]} functions
 * @returns {Uint8Array}
 */
function buildCoverageMap(codeLength, functions) {
  const covered = new Uint8Array(codeLength);
  for (const fn of functions) covered.fill(1, fn.start, fn.end);
  return covered;
}

/**
 * Détecte les intervalles de code hors-fonctions (les "gaps" entre les fonctions).
 * Parcourt le tableau de couverture et retourne les paires { gapStart, gapEnd }.
 *
 * @param {Uint8Array} covered — tableau de couverture (1 = dans une fonction)
 * @param {number} totalLength — longueur totale du code source
 * @returns {Array<{ gapStart: number, gapEnd: number }>}
 */
/**
 * Détermine si la position courante est dans une zone couverte par une fonction.
 *
 * @param {Uint8Array} covered — tableau de couverture (1 = dans une fonction)
 * @param {number} position — position courante dans le code source
 * @param {number} totalLength — longueur totale du code
 * @returns {boolean}
 */
function isPositionInsideFunction(covered, position, totalLength) {
  return position < totalLength && covered[position] === 1;
}

/**
 * Traite une transition "entrée dans un gap" — mémorise la position de début.
 * Retourne l'état de gap mis à jour.
 *
 * @param {number} position — position de début du gap
 * @returns {{ insideGap: true, currentGapStart: number }}
 */
function openNewGap(position) {
  return { insideGap: true, currentGapStart: position };
}

/**
 * Traite une transition "sortie du gap" — enregistre le gap dans la liste.
 * Retourne l'état de gap mis à jour et pousse l'intervalle dans gaps.
 *
 * @param {Array<{ gapStart, gapEnd }>} gaps — liste des gaps accumulés
 * @param {number} currentGapStart — début du gap en cours
 * @param {number} position — position de fin du gap (exclusive)
 * @returns {{ insideGap: false, currentGapStart: number }}
 */
function closeCurrentGap(gaps, currentGapStart, position) {
  gaps.push({ gapStart: currentGapStart, gapEnd: position });
  return { insideGap: false, currentGapStart: position };
}

/**
 * Détecte les intervalles de code hors-fonctions ("gaps") dans le tableau de couverture.
 * Chaque gap correspond à une zone du code non couverte par une déclaration de fonction.
 *
 * @param {Uint8Array} covered — tableau de couverture (buildCoverageMap)
 * @param {number} totalLength — longueur du code source
 * @returns {Array<{ gapStart: number, gapEnd: number }>}
 */
function detectCodeGaps(covered, totalLength) {
  const gaps = [];
  let insideGap = false;
  let currentGapStart = 0;

  for (let position = 0; position <= totalLength; position++) {
    const positionInsideFunction = isPositionInsideFunction(covered, position, totalLength);
    const shouldOpenGap  = !positionInsideFunction && !insideGap;
    const shouldCloseGap = positionInsideFunction  && insideGap;

    if (shouldOpenGap)  ({ insideGap, currentGapStart } = openNewGap(position));
    if (shouldCloseGap) ({ insideGap, currentGapStart } = closeCurrentGap(gaps, currentGapStart, position));
  }

  // Dernier gap non fermé : s'étend jusqu'à la fin du fichier
  if (insideGap) gaps.push({ gapStart: currentGapStart, gapEnd: totalLength });

  return gaps;
}

/**
 * Extrait le code du scope global en assemblant les slices correspondant aux gaps détectés.
 * Un saut de ligne sépare chaque gap pour conserver la lisibilité.
 *
 * @param {string} code — code source complet
 * @param {Uint8Array} covered — tableau de couverture (buildCoverageMap)
 * @returns {string} code global (hors toutes les fonctions)
 */
function extractGlobalCode(code, covered) {
  const codeGaps = detectCodeGaps(covered, code.length);
  return codeGaps
    .map(({ gapStart, gapEnd }) => code.slice(gapStart, gapEnd))
    .join('\n');
}

/** Score de base avant ajustements du scope global. */
const SCOPE_BASE_SCORE = 0.5;

/** Pénalité par unité de densité de code global (hors fonctions). */
const GLOBAL_DENSITY_PENALTY = 0.3;

/** Pénalité par déclaration var au niveau global. */
const VAR_DECLARATION_PENALTY = 0.05;

/** Pénalité par mutation globale détectée. */
const GLOBAL_MUTATION_PENALTY = 0.08;

/** Bonus accordé si un en-tête de fichier JSDoc/commentaire est présent. */
const FILE_HEADER_BONUS = 0.10;

/** Bonus accordé si les exports sont propres (module.exports = {} ou export). */
const CLEAN_EXPORTS_BONUS = 0.10;

/**
 * Calcule le score de scope global normalisé dans [0..1].
 * Pénalise le code hors-fonctions, les var, les mutations.
 * Récompense les en-têtes de fichier et les exports propres.
 *
 * @param {number} globalDensity — proportion de code global vs total
 * @param {number} varDeclarationCount — nb de déclarations var globales
 * @param {number} mutationCount — nb de mutations globales
 * @param {boolean} hasFileHeader — présence d'un en-tête de fichier
 * @param {boolean} hasCleanExports — présence d'exports propres
 * @returns {number} score dans [0..1]
 */
/**
 * Calcule les pénalités cumulées sur le score de scope selon les métriques détectées.
 * Les pénalités réduisent le score de base ; les bonus le remontent.
 *
 * @param {number} globalDensity — proportion de code global vs total lignes
 * @param {number} varCount — nb de déclarations var au scope global
 * @param {number} mutationCount — nb de mutations globales détectées
 * @returns {number} pénalité totale (valeur positive à soustraire)
 */
function computeScopePenalties(globalDensity, varCount, mutationCount) {
  return globalDensity * GLOBAL_DENSITY_PENALTY
       + varCount      * VAR_DECLARATION_PENALTY
       + mutationCount * GLOBAL_MUTATION_PENALTY;
}

/**
 * Calcule les bonus accordés pour un scope bien structuré.
 * Récompense la présence d'un en-tête de fichier et d'exports propres.
 *
 * @param {boolean} hasFileHeader — en-tête JSDoc ou commentaire en début de fichier
 * @param {boolean} hasCleanExports — module.exports = {} ou export modern
 * @returns {number} bonus total (valeur positive à ajouter)
 */
function computeScopeBonuses(hasFileHeader, hasCleanExports) {
  return (hasFileHeader   ? FILE_HEADER_BONUS   : 0)
       + (hasCleanExports ? CLEAN_EXPORTS_BONUS : 0);
}

/**
 * Calcule le score de scope global normalisé dans [0..1].
 * Pénalise la densité de code hors-fonctions, les var et les mutations.
 * Récompense les en-têtes de fichier et les exports propres.
 *
 * @param {number} globalDensity — proportion lignes globales / lignes totales
 * @param {number} varDeclarationCount — nombre de var au scope global
 * @param {number} mutationCount — nombre de mutations globales
 * @param {boolean} hasFileHeader — présence d'un en-tête de fichier
 * @param {boolean} hasCleanExports — présence d'exports propres
 * @returns {number} score de scope dans [0..1]
 */
function computeScopeScore(globalDensity, varDeclarationCount, mutationCount, hasFileHeader, hasCleanExports) {
  const penalties  = computeScopePenalties(globalDensity, varDeclarationCount, mutationCount);
  const bonuses    = computeScopeBonuses(hasFileHeader, hasCleanExports);
  const rawScore   = SCOPE_BASE_SCORE - penalties + bonuses;
  return Math.max(0, Math.min(1, rawScore));
}

// ── Agrégation des scores ────────────────────────────────────────────

/**
 * Agrège les scores individuels des fonctions en un score global de fichier.
 * La moyenne est pondérée par le nombre de lignes de chaque fonction.
 *
 * @param {object[]} scoredFunctions — fonctions avec .score et .lineCount
 * @param {object} scopeAnalysis — résultat de analyzeGlobalScope
 * @returns {object} agrégation avec globalScore, breakdown, weightedScores
 */
function aggregateScores(scoredFunctions, scopeAnalysis) {
  if (scoredFunctions.length === 0) {
    return buildEmptyAggregation(scopeAnalysis);
  }

  const totalWeight = scoredFunctions.reduce((sum, fn) => sum + fn.lineCount, 0);
  const weightedSum = scoredFunctions.reduce((sum, fn) => sum + fn.score * fn.lineCount, 0);

  const baseScore      = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const scopeAdj       = (scopeAnalysis.scopeScore - 0.5) * 0.2 * 5;
  const finalScore     = Math.min(5.0, Math.max(0.0, parseFloat((baseScore + scopeAdj).toFixed(2))));
  const breakdown      = `Moyenne pondérée de ${scoredFunctions.length} fonctions + scope global`;

  return {
    globalScore: finalScore,
    baseScore:   parseFloat(baseScore.toFixed(2)),
    scopeAdjustment: parseFloat(scopeAdj.toFixed(2)),
    breakdown,
    scopeAnalysis,
    weightedScores: buildWeightedScoresList(scoredFunctions, totalWeight),
  };
}

/**
 * Construit le résultat d'agrégation pour un fichier sans fonctions détectées.
 *
 * @param {object} scopeAnalysis
 * @returns {object}
 */
function buildEmptyAggregation(scopeAnalysis) {
  return {
    globalScore: parseFloat((scopeAnalysis.scopeScore * 5).toFixed(2)),
    breakdown:   'Aucune fonction détectée — note basée sur scope global',
    scopeAnalysis,
    weightedScores: [],
  };
}

/**
 * Construit la liste des scores pondérés par fonction pour l'affichage.
 *
 * @param {object[]} scoredFunctions
 * @param {number} totalWeight
 * @returns {object[]}
 */
function buildWeightedScoresList(scoredFunctions, totalWeight) {
  return scoredFunctions.map(fn => ({
    name:      fn.name,
    score:     fn.score,
    lines:     fn.lineCount,
    weight:    totalWeight > 0 ? parseFloat((fn.lineCount / totalWeight * 100).toFixed(1)) : 0,
    lineStart: fn.lineStart,
    lineEnd:   fn.lineEnd,
  }));
}

// ── API publique ─────────────────────────────────────────────────────

/**
 * Décompose un fichier JS en fonctions, score chacune via scoreFn,
 * et retourne un rapport agrégé.
 *
 * @param {string} code — source complet du fichier
 * @param {function(number[]): number} scoreFn — prédit un score depuis des features
 * @returns {object} rapport avec globalScore, functions, parseErrors…
 */
function decomposeAndScore(code, scoreFn) {
  const { functions } = extractFunctionSlices(code);
  const scoredFunctions = [];
  const parseErrors = [];

  for (const fn of functions) {
    try {
      const { features, details } = extractFeatures(fn.slice);
      const result = scoreFn(features, details);
      // scoreFn peut retourner un nombre (mode repo) ou { score, cappedBy, penalty } (mode analyse v5.0)
      const score    = typeof result === 'object' ? result.score    : result;
      const cappedBy = typeof result === 'object' ? result.cappedBy : null;
      const penalty  = typeof result === 'object' ? result.penalty  : 0;
      scoredFunctions.push({ ...fn, features, details, score, cappedBy, penalty });
    } catch (err) {
      parseErrors.push({ name: fn.name, error: err.message });
    }
  }

  const scopeAnalysis = analyzeGlobalScope(code, functions);
  const aggregation   = aggregateScores(scoredFunctions, scopeAnalysis);

  return {
    ...aggregation,
    functions:      scoredFunctions,
    parseErrors,
    totalFunctions: functions.length,
    scoredCount:    scoredFunctions.length,
  };
}

module.exports = { decomposeAndScore, extractFunctionSlices, analyzeGlobalScope };
