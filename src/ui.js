'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Zen Console UI                  ║
 * ║   Affichage élégant des résultats d'analyse ML        ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const chalk = require('chalk');

// ─────────────────────────────────────────────────────────
//  Palette de couleurs par score
// ─────────────────────────────────────────────────────────
function getColorForScore(score) {
  if (score >= 4.0) return chalk.cyan;           // Émeraude — Code parfait
  if (score >= 2.5) return chalk.blue;           // Bleu calme — Code propre
  if (score >= 1.5) return chalk.hex('#F59E0B'); // Ambre — À refactoriser
  return chalk.hex('#FF6B6B');                   // Corail — Critique
}

function getScoreColor(score) {
  if (score >= 4.0) return 'cyan';
  if (score >= 2.5) return 'blue';
  if (score >= 1.5) return 'amber';
  return 'coral';
}

// ─────────────────────────────────────────────────────────
//  Verdicts
// ─────────────────────────────────────────────────────────
function getVerdict(score) {
  if (score >= 4.5) return { word: 'ÉLÉGANT',   emoji: '✨' };
  if (score >= 4.0) return { word: 'ROBUSTE',   emoji: '🔷' };
  if (score >= 3.5) return { word: 'SOLIDE',    emoji: '🟦' };
  if (score >= 3.0) return { word: 'CORRECT',   emoji: '🟨' };
  if (score >= 2.5) return { word: 'FONCTIONNEL', emoji: '🟧' };
  if (score >= 2.0) return { word: 'BROUILLON', emoji: '⚠️ ' };
  if (score >= 1.5) return { word: 'CHAOTIQUE', emoji: '🔶' };
  if (score >= 1.0) return { word: 'CRITIQUE',  emoji: '🔴' };
  return              { word: 'SPAGHETTI',  emoji: '💀' };
}

// ─────────────────────────────────────────────────────────
//  Progress Bar ASCII élégante
// ─────────────────────────────────────────────────────────
function buildProgressBar(score, width = 36) {
  const filled = Math.round((score / 5.0) * width);
  const empty = width - filled;
  const colorize = getColorForScore(score);

  const filledBar = colorize('█'.repeat(filled));
  const emptyBar = chalk.gray('░'.repeat(empty));

  return `${filledBar}${emptyBar}`;
}

// ─────────────────────────────────────────────────────────
//  Étoiles de notation
// ─────────────────────────────────────────────────────────
function buildStars(score) {
  const fullStars = Math.floor(score);
  const halfStar = score - fullStars >= 0.5 ? 1 : 0;
  const emptyStars = 5 - fullStars - halfStar;
  const colorize = getColorForScore(score);

  return colorize('★'.repeat(fullStars)) +
    (halfStar ? chalk.gray('◐') : '') +
    chalk.gray('☆'.repeat(emptyStars));
}

// ─────────────────────────────────────────────────────────
//  Formatage des features avec label
// ─────────────────────────────────────────────────────────
function formatFeatureRow(label, value, inverted = false) {
  // inverted = true si une valeur élevée est MAUVAISE (cyclomatique, imbrication)
  const displayValue = inverted ? (1 - value) : value;
  const barWidth = 20;
  const filled = Math.round(displayValue * barWidth);
  const empty = barWidth - filled;

  let barColor;
  if (displayValue >= 0.75)     barColor = chalk.green;
  else if (displayValue >= 0.5) barColor = chalk.yellow;
  else                          barColor = chalk.red;

  const bar = barColor('▪'.repeat(filled)) + chalk.gray('·'.repeat(empty));
  const pct = (displayValue * 100).toFixed(0).padStart(3);

  return `  │  ${chalk.gray(label.padEnd(22))} ${bar} ${chalk.white(pct)}%`;
}

// ─────────────────────────────────────────────────────────
//  Fonction principale d'affichage
// ─────────────────────────────────────────────────────────
function displayResult(score, details, filename = 'fonction') {
  const colorize = getColorForScore(score);
  const verdict = getVerdict(score);
  const bar = buildProgressBar(score);
  const stars = buildStars(score);

  const width = 52;
  const border = '─'.repeat(width);

  console.log('');
  console.log(colorize(`  ┌${border}┐`));
  console.log(colorize('  │') + chalk.white.bold(`  🧠  JS-RANKER — Analyse Complète`.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${border}┤`));

  // Fichier analysé
  const fileDisplay = `  Fichier : ${filename}`;
  console.log(colorize('  │') + chalk.gray(fileDisplay.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${border}┤`));

  // Score principal
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  const scoreStr = score.toFixed(2);
  const scoreLine = `       ${stars}    ${colorize(scoreStr)} / 5.0`;
  console.log(colorize('  │') + scoreLine + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));

  // Progress bar
  const barLine = `  ${bar}  `;
  console.log(colorize('  │') + barLine + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));

  // Verdict
  const verdictLine = `       ${verdict.emoji}  ${colorize.bold(verdict.word.padEnd(14))} `;
  console.log(colorize('  │') + verdictLine + ''.padEnd(width - verdictLine.length + 2) + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));

  // ── Détail des features ──────────────────────────────
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold('  Métriques AST'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  const f = details;
  console.log(colorize('  │') + formatFeatureRow('Complexité Cyclo.', f.cyclomaticComplexity.normalized, true) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Imbrication Max.', f.maxNesting.normalized, true) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Ratio Nommage', f.namingRatio.normalized, false) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Linéarité', f.linearity.normalized, false) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Modularité', f.modularity.normalized, false) + colorize('│'));

  // ── Valeurs brutes ───────────────────────────────────
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold('  Valeurs Brutes'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  const raw = [
    `  Branches logiques : ${chalk.white(f.cyclomaticComplexity.raw)}`,
    `  Profondeur max    : ${chalk.white(f.maxNesting.raw)} niveaux`,
    `  Variables nommées : ${chalk.white(f.namingRatio.named)}/${f.namingRatio.total}`,
    `  Lignes / Nœuds    : ${chalk.white(f.linearity.lines)} / ${f.linearity.nodes} (ratio ${f.linearity.ratio})`,
    `  Nb. paramètres    : ${chalk.white(f.modularity.params)}`,
  ];

  for (const line of raw) {
    console.log(colorize('  │') + chalk.gray(line.padEnd(width)) + colorize('│'));
  }

  // ── Conseil ─────────────────────────────────────────
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  const advice = getAdvice(score, details);
  console.log(colorize('  │') + chalk.white.bold('  Conseil'.padEnd(width)) + colorize('│'));
  console.log(colorize('  │') + chalk.gray(`  ${advice}`.padEnd(width)) + colorize('│'));

  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize(`  └${border}┘`));
  console.log('');
}

// ─────────────────────────────────────────────────────────
//  Conseil automatique basé sur la feature la plus faible
// ─────────────────────────────────────────────────────────
function getAdvice(score, details) {
  if (score >= 4.5) return 'Code exemplaire. Excellent travail ! 🎉';

  // Trouver la feature la plus problématique
  const issues = [];

  if (details.cyclomaticComplexity.normalized > 0.5)
    issues.push({ priority: details.cyclomaticComplexity.normalized, msg: 'Réduire les conditions imbriquées → Guard clauses' });
  if (details.maxNesting.normalized > 0.5)
    issues.push({ priority: details.maxNesting.normalized, msg: 'Aplatir les blocs imbriqués → Extract function' });
  if (details.namingRatio.normalized < 0.5)
    issues.push({ priority: 1 - details.namingRatio.normalized, msg: 'Renommer les variables : a, b, x → noms explicites' });
  if (details.modularity.normalized < 0.4)
    issues.push({ priority: 1 - details.modularity.normalized, msg: 'Trop d\'arguments → Utiliser un objet paramètre' });
  if (details.linearity.normalized < 0.4)
    issues.push({ priority: 1 - details.linearity.normalized, msg: 'Déséquilibre code/structure → Restructurer les blocs' });

  if (issues.length === 0) return 'Bon code. Quelques ajustements mineurs suffiraient.';

  issues.sort((a, b) => b.priority - a.priority);
  return issues[0].msg;
}

// ─────────────────────────────────────────────────────────
//  Bannière de démarrage
// ─────────────────────────────────────────────────────────
function displayBanner() {
  console.log('');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('     ⚡  JS-RANKER  v1.0  — Zen Console       ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   Notation ML de fonctions JavaScript        ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════╝'));
  console.log('');
}

// ─────────────────────────────────────────────────────────
//  Erreur formatée
// ─────────────────────────────────────────────────────────
function displayError(message) {
  console.log('');
  console.log(chalk.red('  ┌──────────────────────────────────────┐'));
  console.log(chalk.red('  │') + chalk.white.bold('  ❌  ERREUR                          ') + chalk.red('│'));
  console.log(chalk.red('  ├──────────────────────────────────────┤'));
  console.log(chalk.red('  │') + chalk.gray(`  ${message.substring(0, 36).padEnd(36)}`) + chalk.red('│'));
  console.log(chalk.red('  └──────────────────────────────────────┘'));
  console.log('');
}

// ─────────────────────────────────────────────────────────
//  Info de fetch URL
// ─────────────────────────────────────────────────────────
function displayFetchInfo({ source, resolvedUrl, sizeKb }) {
  console.log(chalk.cyan(`\n  ┌─ Source distante ──────────────────────────────`));
  console.log(chalk.cyan('  │') + chalk.gray(`  Type     : ${chalk.white(source)}`));
  if (resolvedUrl) {
    const shortUrl = resolvedUrl.length > 50
      ? resolvedUrl.substring(0, 47) + '...'
      : resolvedUrl;
    console.log(chalk.cyan('  │') + chalk.gray(`  URL Raw  : ${chalk.white(shortUrl)}`));
  }
  if (sizeKb) {
    console.log(chalk.cyan('  │') + chalk.gray(`  Taille   : ${chalk.white(sizeKb + ' KB')}`));
  }
}

// ─────────────────────────────────────────────────────────
//  Rapport fichier complet (multi-fonctions)
// ─────────────────────────────────────────────────────────
function displayFileReport(report, filename = 'fichier') {
  const { globalScore, weightedScores, scopeAnalysis, breakdown, baseScore, scopeAdjustment } = report;

  const colorize = getColorForScore(globalScore);
  const verdict  = getVerdict(globalScore);
  const bar      = buildProgressBar(globalScore, 34);
  const stars    = buildStars(globalScore);
  const width    = 52;

  console.log('');
  console.log(colorize(`  ┌${'─'.repeat(width)}┐`));
  console.log(colorize('  │') + chalk.white.bold(`  📊  RAPPORT FICHIER COMPLET`.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.gray(`  ${filename}`.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  // Score global
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `       ${stars}    ${colorize(globalScore.toFixed(2))} / 5.0` + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `  ${bar}  ` + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `       ${verdict.emoji}  ${colorize.bold(verdict.word)}`.padEnd(width + 10) + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));

  // Détail des scores par fonction
  if (weightedScores && weightedScores.length > 0) {
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));
    console.log(colorize('  │') + chalk.white.bold(`  Scores par Fonction (${weightedScores.length})`.padEnd(width)) + colorize('│'));
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));

    // Tri par score décroissant
    const sorted = [...weightedScores].sort((a, b) => b.score - a.score);

    for (const fn of sorted) {
      const fnColor  = getColorForScore(fn.score);
      const fnVerdict = getVerdict(fn.score).word;
      const fnBar    = fn.score / 5;
      const barW     = 14;
      const filled   = Math.round(fnBar * barW);
      const miniBar  = fnColor('█'.repeat(filled)) + chalk.gray('░'.repeat(barW - filled));

      const nameTrunc = fn.name.substring(0, 18).padEnd(18);
      const scorePart = fnColor(fn.score.toFixed(2));
      const line = `  ├ ${chalk.white(nameTrunc)} ${miniBar} ${scorePart}  ${chalk.gray(fn.weight + '%')}`;

      console.log(colorize('  │') + chalk.gray(line.padEnd(width + 15)) + colorize('│'));
    }

    // Top/Bottom performers
    if (sorted.length > 1) {
      console.log(colorize(`  ├${'─'.repeat(width)}┤`));
      const best  = sorted[0];
      const worst = sorted[sorted.length - 1];
      console.log(colorize('  │') + chalk.gray(`  ⬆ Meilleure : ${chalk.green(best.name)} (${best.score.toFixed(2)})`.padEnd(width)) + colorize('│'));
      console.log(colorize('  │') + chalk.gray(`  ⬇ À revoir  : ${chalk.red(worst.name)} (${worst.score.toFixed(2)})`.padEnd(width)) + colorize('│'));
    }
  }

  // Analyse du scope global
  if (scopeAnalysis) {
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));
    console.log(colorize('  │') + chalk.white.bold('  Scope Global'.padEnd(width)) + colorize('│'));
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));

    const adj = scopeAdjustment >= 0
      ? chalk.green(`+${scopeAdjustment.toFixed(2)} pts`)
      : chalk.red(`${scopeAdjustment.toFixed(2)} pts`);

    const scopeRows = [
      `  Lignes hors-fonctions  : ${chalk.white(scopeAnalysis.globalLines)} / ${scopeAnalysis.totalLines}`,
      `  Variables var globales : ${chalk.white(scopeAnalysis.globalVarCount)}`,
      `  Mutations globales     : ${chalk.white(scopeAnalysis.globalMutations)}`,
      `  En-tête de fichier     : ${scopeAnalysis.hasFileHeader ? chalk.green('✓ présent') : chalk.gray('absent')}`,
      `  Exports propres        : ${scopeAnalysis.hasCleanExports ? chalk.green('✓ propres') : chalk.gray('absents')}`,
      `  Ajustement scope       : ${adj}`,
    ];

    for (const row of scopeRows) {
      console.log(colorize('  │') + chalk.gray(row.padEnd(width + 5)) + colorize('│'));
    }
  }

  // Méthodologie
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.gray(`  Méthode : ${breakdown}`.substring(0, width).padEnd(width)) + colorize('│'));
  if (baseScore !== undefined) {
    console.log(colorize('  │') + chalk.gray(`  Base : ${baseScore.toFixed(2)}  +  Scope : ${scopeAdjustment >= 0 ? '+' : ''}${scopeAdjustment.toFixed(2)}  =  ${chalk.white(globalScore.toFixed(2))}`.padEnd(width + 5)) + colorize('│'));
  }

  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize(`  └${'─'.repeat(width)}┘`));
  console.log('');
}

module.exports = { displayResult, displayBanner, displayError, displayFileReport, displayFetchInfo, getVerdict };
