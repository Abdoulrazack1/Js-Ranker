'use strict';

const path = require('path');
const fs   = require('fs');
const chalk = require('chalk');

const { extractFeatures }   = require('./features');
const { loadModel, predict } = require('./model');
const { fetchCode }         = require('./fetcher');
const { decomposeAndScore } = require('./decomposer');
const {
  displayResult, displayBanner, displayError,
  displayFileReport, displayFetchInfo,
} = require('./ui');

const MODEL_PATH = path.join(__dirname, '../models/js-ranker');

function modelExists() {
  return fs.existsSync(path.join(MODEL_PATH, 'model.json'));
}

async function getModel() {
  if (!modelExists()) throw new Error('Modele non trouve. Lancez : npm run train');
  return loadModel(MODEL_PATH);
}

// ── Snippet inline ────────────────────────────────────────────
async function analyzeSnippet(code) {
  displayBanner();
  let extraction;
  try { extraction = extractFeatures(code); }
  catch (err) { displayError('Parsing impossible : ' + err.message); process.exit(1); }
  const model = await getModel();
  const score = predict(model, extraction.features);
  displayResult(score, extraction.details, 'inline snippet');
  return score;
}

// ── Fichier local ─────────────────────────────────────────────
async function analyzeFile(filePath) {
  displayBanner();
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) { displayError('Fichier introuvable : ' + filePath); process.exit(1); }
  const code = fs.readFileSync(abs, 'utf-8');
  return _analyzeCodeFull(code, path.basename(abs));
}

// ── URL (fichier unique ou repo entier) ───────────────────────
async function analyzeUrl(url) {
  displayBanner();

  let fetchResult;
  try { fetchResult = await fetchCode(url); }
  catch (err) { displayError(err.message); process.exit(1); }

  // ── Repo complet → rapport par fichier
  if (fetchResult.isRepo) {
    return analyzeRepo(fetchResult);
  }

  // ── Fichier unique
  displayFetchInfo(fetchResult);
  const displayName = (fetchResult.resolvedUrl || url).split('/').pop() || 'remote';
  return _analyzeCodeFull(fetchResult.code, displayName);
}

// ── Rapport multi-fichiers pour un repo ───────────────────────
async function analyzeRepo(fetchResult) {
  const model   = await getModel();
  const scoreFn = (features) => predict(model, features);

  const fileReports = [];
  let totalScore  = 0;
  let totalWeight = 0; // poids = nb de fonctions

  console.log('');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold(`   📦  RAPPORT REPO : ${fetchResult.owner}/${fetchResult.repo}`.padEnd(53)) + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════════╝'));

  for (const file of fetchResult.files) {
    let report;
    try {
      report = decomposeAndScore(file.code, scoreFn);
    } catch {
      continue; // skip les fichiers non parsables
    }

    if (report.scoredCount === 0) continue;

    fileReports.push({
      path:      file.path,
      score:     report.globalScore,
      functions: report.scoredCount,
      sizeKb:    file.sizeKb,
    });

    totalScore  += report.globalScore * report.scoredCount;
    totalWeight += report.scoredCount;
  }

  if (fileReports.length === 0) {
    displayError('Aucune fonction JS analysable trouvée dans ce repo');
    process.exit(1);
  }

  const globalScore = totalWeight > 0
    ? Math.min(5, Math.max(0, parseFloat((totalScore / totalWeight).toFixed(2))))
    : 0;

  // Affichage du tableau récapitulatif
  printRepoTable(fileReports, globalScore, fetchResult);

  return globalScore;
}

function printRepoTable(files, globalScore, meta) {
  const sorted = [...files].sort((a, b) => b.score - a.score);

  const getColor = (s) => s >= 4 ? chalk.cyan : s >= 2.5 ? chalk.blue : s >= 1.5 ? chalk.yellow : chalk.red;
  const getBar   = (s, w = 16) => {
    const c = getColor(s);
    const f = Math.round((s / 5) * w);
    return c('█'.repeat(f)) + chalk.gray('░'.repeat(w - f));
  };

  console.log('');
  console.log(chalk.white('  Fichier'.padEnd(36)) + chalk.gray('Score') + '  ' + chalk.gray('Fonctions') + '  ' + chalk.gray('Barre'));
  console.log(chalk.gray('  ' + '─'.repeat(70)));

  for (const f of sorted) {
    const col   = getColor(f.score);
    const name  = f.path.length > 33 ? '...' + f.path.slice(-30) : f.path.padEnd(33);
    const score = col(f.score.toFixed(2));
    const fns   = chalk.gray(String(f.functions).padStart(3) + ' fn');
    const bar   = getBar(f.score);
    console.log(`  ${chalk.white(name)} ${score}  ${fns}   ${bar}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(70)));

  const gc = getColor(globalScore);
  const verdict = globalScore >= 4.5 ? 'ÉLÉGANT' : globalScore >= 4 ? 'ROBUSTE'
               : globalScore >= 3.5 ? 'SOLIDE'  : globalScore >= 2.5 ? 'CORRECT'
               : globalScore >= 2   ? 'BROUILLON' : 'CRITIQUE';

  console.log(`\n  SCORE GLOBAL DU REPO  ${gc.bold(globalScore.toFixed(2))} / 5.0  —  ${gc.bold(verdict)}`);
  console.log(`  ${files.length} fichiers analysés | ${meta.branch} | ${meta.sizeKb} KB\n`);
}

// ── Pipeline commun pour un bloc de code ─────────────────────
async function _analyzeCodeFull(code, displayName) {
  const model   = await getModel();
  const scoreFn = (features) => predict(model, features);
  let report;
  try { report = decomposeAndScore(code, scoreFn); }
  catch (err) { displayError('Analyse impossible : ' + err.message); process.exit(1); }

  if (report.totalFunctions <= 1 && report.functions.length === 1) {
    const fn = report.functions[0];
    displayResult(fn.score, fn.details, displayName);
    return fn.score;
  }

  displayFileReport(report, displayName);
  return report.globalScore;
}

async function analyzeAuto(input) {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return analyzeUrl(t);
  if (fs.existsSync(t) && t.endsWith('.js')) return analyzeFile(t);
  return analyzeSnippet(t);
}

module.exports = { analyzeFile, analyzeUrl, analyzeSnippet, analyzeAuto, modelExists };
