'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Pipeline d'Analyse                ║
 * ║   Orchestre snippet / fichier / URL / repo            ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const path  = require('path');
const fs    = require('fs');
const chalk = require('chalk');

const { extractFeatures }   = require('./features');
const { loadModel, predict } = require('./model');
const { fetchCode }          = require('./fetcher');
const { decomposeAndScore }  = require('./decomposer');
const {
  displayResult, displayBanner, displayError,
  displayFileReport, displayFetchInfo,
} = require('./ui');

const MODEL_PATH = path.join(__dirname, '../models/js-ranker');

// ── Modèle ───────────────────────────────────────────────────────────

/**
 * Vérifie si le modèle entraîné est présent sur disque.
 *
 * @returns {boolean}
 */
function modelExists() {
  return fs.existsSync(path.join(MODEL_PATH, 'model.json'));
}

/**
 * Charge le modèle depuis le disque ou lève une erreur si absent.
 *
 * @returns {Promise<tf.LayersModel>}
 */
async function getModel() {
  if (!modelExists()) throw new Error('Modèle non trouvé. Lancez : npm run train');
  return loadModel(MODEL_PATH);
}

// ── Analyse d'un snippet inline ──────────────────────────────────────

/**
 * Analyse une chaîne de code JavaScript fournie directement.
 *
 * @param {string} code — code source à évaluer
 * @returns {Promise<number>} score dans [0..5]
 */
async function analyzeSnippet(code) {
  displayBanner();

  let extraction;
  try {
    extraction = extractFeatures(code);
  } catch (parseError) {
    displayError('Parsing impossible : ' + parseError.message);
    process.exit(1);
  }

  const model = await getModel();
  const score = predict(model, extraction.features);
  displayResult(score, extraction.details, 'inline snippet');
  return score;
}

// ── Analyse d'un fichier local ────────────────────────────────────────

/**
 * Analyse un fichier JavaScript local par son chemin.
 *
 * @param {string} filePath — chemin relatif ou absolu vers le .js
 * @returns {Promise<number>} score dans [0..5]
 */
async function analyzeFile(filePath) {
  displayBanner();

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    displayError('Fichier introuvable : ' + filePath);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(absolutePath, 'utf-8');
  return analyzeCodeFull(sourceCode, path.basename(absolutePath));
}

// ── Analyse d'une URL ─────────────────────────────────────────────────

/**
 * Extrait le nom d'affichage depuis le résultat de fetch d'un fichier unique.
 * Utilise le dernier segment de l'URL résolue ou 'remote' comme fallback.
 *
 * @param {object} fetchResult — résultat de fetchCode (isRepo = false)
 * @param {string} originalUrl — URL originale (fallback si resolvedUrl absent)
 * @returns {string}
 */
function extractDisplayNameFromFetch(fetchResult, originalUrl) {
  const resolvedSource = fetchResult.resolvedUrl || originalUrl;
  return resolvedSource.split('/').pop() || 'remote';
}

/**
 * Analyse le contenu JavaScript d'une URL distante.
 * Dispatche automatiquement vers analyzeRepo si l'URL pointe vers un repo GitHub,
 * ou vers analyzeCodeFull pour un fichier unique.
 *
 * @param {string} url — URL GitHub (repo/blob/tree), CDN, GitLab, ou directe
 * @returns {Promise<number>} score global dans [0..5]
 */
async function analyzeUrl(url) {
  displayBanner();

  let fetchResult;
  try {
    fetchResult = await fetchCode(url);
  } catch (fetchError) {
    displayError(fetchError.message);
    process.exit(1);
  }

  if (fetchResult.isRepo) return analyzeRepo(fetchResult);

  displayFetchInfo(fetchResult);
  const displayName = extractDisplayNameFromFetch(fetchResult, url);
  return analyzeCodeFull(fetchResult.code, displayName);
}

// ── Rapport d'un repo complet ─────────────────────────────────────────

/**
 * Tente de scorer un fichier du repo et retourne le rapport ou null.
 * Retourne null si le fichier n'est pas parsable ou ne contient aucune fonction.
 *
 * @param {{ path: string, code: string }} repoFile
 * @param {Function} scoreFn — prédicateur de score depuis features
 * @returns {{ path, score, functions, sizeKb } | null}
 */
function scoreRepoFile(repoFile, scoreFn) {
  try {
    const fileReport = decomposeAndScore(repoFile.code, scoreFn);
    if (fileReport.scoredCount === 0) return null;

    return {
      path:      repoFile.path,
      score:     fileReport.globalScore,
      functions: fileReport.scoredCount,
      sizeKb:    repoFile.sizeKb,
    };
  } catch {
    return null; // Fichier non parsable — ignoré silencieusement
  }
}

/**
 * Score tous les fichiers d'un repo et retourne les rapports valides.
 * Les fichiers sans fonctions détectables sont filtrés.
 *
 * @param {Array<{ path, code, sizeKb }>} files
 * @param {Function} scoreFn
 * @returns {object[]} rapports valides avec path, score, functions, sizeKb
 */
function collectRepoFileReports(files, scoreFn) {
  return files
    .map(repoFile => scoreRepoFile(repoFile, scoreFn))
    .filter(Boolean);
}

/**
 * Calcule le score global d'un repo comme moyenne pondérée par le nombre de fonctions.
 * Un repo sans fonctions retourne 0.
 *
 * @param {object[]} fileReports — liste de { score, functions }
 * @returns {number} score global dans [0..5]
 */
function computeGlobalRepoScore(fileReports) {
  const totalWeight = fileReports.reduce((sum, report) => sum + report.functions, 0);
  if (totalWeight === 0) return 0;

  const weightedSum = fileReports.reduce(
    (sum, report) => sum + report.score * report.functions, 0
  );

  return Math.min(5, Math.max(0, parseFloat((weightedSum / totalWeight).toFixed(2))));
}

/**
 * Génère et affiche le rapport complet d'un repo GitHub.
 * Affiche un tableau trié par score avec le score global final.
 *
 * @param {object} fetchResult — résultat de fetchCode avec isRepo = true
 * @returns {Promise<number>} score global dans [0..5]
 */
async function analyzeRepo(fetchResult) {
  const model   = await getModel();
  const scoreFn = (features) => predict(model, features);

  console.log('');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold(`   📦  RAPPORT REPO : ${fetchResult.owner}/${fetchResult.repo}`.padEnd(53)) + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════════╝'));

  const fileReports = collectRepoFileReports(fetchResult.files, scoreFn);

  if (fileReports.length === 0) {
    displayError('Aucune fonction JS analysable trouvée dans ce repo');
    process.exit(1);
  }

  const globalScore = computeGlobalRepoScore(fileReports);
  printRepoTable(fileReports, globalScore, fetchResult);

  return globalScore;
}

// ── Tableau récapitulatif du repo ─────────────────────────────────────

/** Seuils de score et couleurs chalk associées, du meilleur au moins bon. */
const REPO_SCORE_COLOR_THRESHOLDS = [
  { threshold: 4.0,  color: () => chalk.cyan   },
  { threshold: 2.5,  color: () => chalk.blue   },
  { threshold: 1.5,  color: () => chalk.yellow },
  { threshold: 0,    color: () => chalk.red    },
];

/**
 * Retourne la fonction de colorisation chalk correspondant au niveau de score.
 * Utilise REPO_SCORE_COLOR_THRESHOLDS pour éviter une série de if/else fragiles.
 *
 * @param {number} score — score de qualité dans [0..5]
 * @returns {Function} fonction chalk colorisante
 */
function getRepoScoreColor(score) {
  const matchingEntry = REPO_SCORE_COLOR_THRESHOLDS.find(entry => score >= entry.threshold);
  return matchingEntry ? matchingEntry.color() : chalk.red;
}

/**
 * Construit la mini-barre ASCII colorée pour le tableau repo.
 *
 * @param {number} score — dans [0..5]
 * @param {number} [barWidth=16]
 * @returns {string}
 */
function buildRepoScoreBar(score, barWidth = 16) {
  const colorize  = getRepoScoreColor(score);
  const filledLen = Math.round((score / 5) * barWidth);
  return colorize('█'.repeat(filledLen)) + chalk.gray('░'.repeat(barWidth - filledLen));
}

/**
 * Formate et affiche le tableau récapitulatif des scores de fichiers.
 *
 * @param {object[]} fileReports — rapports triés par score
 * @param {number} globalScore
 * @param {object} repoMeta — { branch, sizeKb }
 */
function printRepoTable(fileReports, globalScore, repoMeta) {
  const sortedReports = [...fileReports].sort((a, b) => b.score - a.score);
  const verdictLabels = { 4.5: 'ÉLÉGANT', 4: 'ROBUSTE', 3.5: 'SOLIDE', 2.5: 'CORRECT', 2: 'BROUILLON' };
  const getVerdict = (score) => Object.entries(verdictLabels).find(([threshold]) => score >= threshold)?.[1] || 'CRITIQUE';

  console.log('');
  console.log(chalk.white('  Fichier'.padEnd(36)) + chalk.gray('Score') + '  ' + chalk.gray('Fonctions') + '  ' + chalk.gray('Barre'));
  console.log(chalk.gray('  ' + '─'.repeat(70)));

  for (const fileReport of sortedReports) {
    const fileColor   = getRepoScoreColor(fileReport.score);
    const displayName = fileReport.path.length > 33 ? '...' + fileReport.path.slice(-30) : fileReport.path.padEnd(33);
    const fnLabel     = chalk.gray(String(fileReport.functions).padStart(3) + ' fn');
    const scoreBar    = buildRepoScoreBar(fileReport.score);
    console.log(`  ${chalk.white(displayName)} ${fileColor(fileReport.score.toFixed(2))}  ${fnLabel}   ${scoreBar}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(70)));

  const globalColor   = getRepoScoreColor(globalScore);
  const verdictLabel  = getVerdict(globalScore);
  console.log(`\n  SCORE GLOBAL DU REPO  ${globalColor.bold(globalScore.toFixed(2))} / 5.0  —  ${globalColor.bold(verdictLabel)}`);
  console.log(`  ${fileReports.length} fichiers analysés | ${repoMeta.branch} | ${repoMeta.sizeKb} KB\n`);
}

// ── Pipeline commun pour un bloc de code ─────────────────────────────

/**
 * Pipeline d'analyse complet pour un bloc de code source connu.
 * Choisit l'affichage simple (1 fonction) ou rapport fichier (multi-fonctions).
 *
 * @param {string} sourceCode
 * @param {string} displayName — nom affiché dans l'UI
 * @returns {Promise<number>} score dans [0..5]
 */
async function analyzeCodeFull(sourceCode, displayName) {
  const model   = await getModel();
  const scoreFn = (features) => predict(model, features);

  let fileReport;
  try {
    fileReport = decomposeAndScore(sourceCode, scoreFn);
  } catch (analysisError) {
    displayError('Analyse impossible : ' + analysisError.message);
    process.exit(1);
  }

  // Fichier à fonction unique → affichage détaillé de la fonction
  if (fileReport.totalFunctions <= 1 && fileReport.functions.length === 1) {
    const singleFunction = fileReport.functions[0];
    displayResult(singleFunction.score, singleFunction.details, displayName);
    return singleFunction.score;
  }

  displayFileReport(fileReport, displayName);
  return fileReport.globalScore;
}

// ── Dispatch automatique ──────────────────────────────────────────────

/**
 * Détecte automatiquement le type d'entrée (URL, fichier local, snippet) et analyse.
 *
 * @param {string} input
 * @returns {Promise<number>}
 */
async function analyzeAuto(input) {
  const trimmedInput = input.trim();
  if (/^https?:\/\//i.test(trimmedInput)) return analyzeUrl(trimmedInput);
  if (fs.existsSync(trimmedInput) && trimmedInput.endsWith('.js')) return analyzeFile(trimmedInput);
  return analyzeSnippet(trimmedInput);
}

module.exports = { analyzeFile, analyzeUrl, analyzeSnippet, analyzeAuto, modelExists };
