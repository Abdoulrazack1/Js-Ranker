'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Zen Console UI                  ║
 * ║   Affichage de toutes les 16 métriques de qualité JS  ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const chalk = require('chalk');

// ── Couleurs & verdicts ──────────────────────────────────────────────

/**
 * Retourne la fonction de colorisation chalk selon le score.
 *
 * @param {number} score — dans [0..5]
 * @returns {Function} chalk colorizer
 */
function getColorForScore(score) {
  if (score >= 4.0) return chalk.cyan;
  if (score >= 2.5) return chalk.blue;
  if (score >= 1.5) return chalk.hex('#F59E0B');
  return chalk.hex('#FF6B6B');
}

/**
 * Retourne le verdict textuel et son emoji selon le score.
 *
 * @param {number} score
 * @returns {{ word: string, emoji: string }}
 */
function getVerdict(score) {
  if (score >= 4.5) return { word: 'ÉLÉGANT',     emoji: '✨' };
  if (score >= 4.0) return { word: 'ROBUSTE',     emoji: '🔷' };
  if (score >= 3.5) return { word: 'SOLIDE',      emoji: '🟦' };
  if (score >= 3.0) return { word: 'CORRECT',     emoji: '🟨' };
  if (score >= 2.5) return { word: 'FONCTIONNEL', emoji: '🟧' };
  if (score >= 2.0) return { word: 'BROUILLON',   emoji: '⚠️ ' };
  if (score >= 1.5) return { word: 'CHAOTIQUE',   emoji: '🔶' };
  if (score >= 1.0) return { word: 'CRITIQUE',    emoji: '🔴' };
  return              { word: 'SPAGHETTI',    emoji: '💀' };
}

// ── Composants graphiques ────────────────────────────────────────────

/**
 * Construit une barre de progression ASCII colorée.
 *
 * @param {number} score — dans [0..5]
 * @param {number} [width=36]
 * @returns {string}
 */
function buildProgressBar(score, width = 36) {
  const filled   = Math.round((score / 5.0) * width);
  const colorize = getColorForScore(score);
  return colorize('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
}

/**
 * Construit la notation en étoiles ★.
 *
 * @param {number} score — dans [0..5]
 * @returns {string}
 */
function buildStars(score) {
  const full  = Math.floor(score);
  const half  = score - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const c     = getColorForScore(score);
  return c('★'.repeat(full)) + (half ? chalk.gray('◐') : '') + chalk.gray('☆'.repeat(empty));
}

/**
 * Formate une ligne de métrique avec barre ASCII proportionnelle.
 * Gère l'inversion (valeur élevée = mauvais) via `inverted`.
 *
 * @param {string} label — libellé (max 22 chars)
 * @param {number} value — valeur normalisée dans [0..1]
 * @param {boolean} [inverted=false] — si true, valeur élevée est défavorable
 * @returns {string}
 */
function formatFeatureRow(label, value, inverted = false) {
  const displayValue = inverted ? (1 - value) : value;
  const barWidth     = 20;
  const filled       = Math.round(displayValue * barWidth);
  const pct          = (displayValue * 100).toFixed(0).padStart(3);

  let barColor;
  if (displayValue >= 0.75)     barColor = chalk.green;
  else if (displayValue >= 0.5) barColor = chalk.yellow;
  else                          barColor = chalk.red;

  const bar = barColor('▪'.repeat(filled)) + chalk.gray('·'.repeat(barWidth - filled));
  return `  │  ${chalk.gray(label.padEnd(22))} ${bar} ${chalk.white(pct)}%`;
}

// ── Section de métriques ─────────────────────────────────────────────

/**
 * Affiche une section de métriques avec titre et liste de lignes.
 *
 * @param {string} title
 * @param {string[]} rows
 * @param {number} width
 * @param {Function} colorize
 */
function printMetricsSection(title, rows, width, colorize) {
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold(`  ${title}`.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  for (const row of rows) console.log(colorize('  │') + row + colorize('│'));
}

/**
 * Construit les lignes de métriques F1–F5 (fondamentales).
 *
 * @param {object} details — objet details issu de extractFeatures
 * @returns {string[]}
 */
function buildFundamentalMetricRows(details) {
  return [
    formatFeatureRow('Complexité Cyclo.', details.cyclomaticComplexity.normalized, true),
    formatFeatureRow('Imbrication Max.',  details.maxNesting.normalized,           true),
    formatFeatureRow('Ratio Nommage',     details.namingRatio.normalized,          false),
    formatFeatureRow('Linéarité',         details.linearity.normalized,            false),
    formatFeatureRow('Modularité',        details.modularity.normalized,           false),
  ];
}

/**
 * Construit les lignes de métriques F6–F10 (analyse avancée).
 *
 * @param {object} details
 * @returns {string[]}
 */
function buildAdvancedMetricRows(details) {
  const asyncLabel = details.asyncAwait.hasAsync && details.asyncAwait.hasAwait
    ? 'Async/Await ✓'
    : details.asyncAwait.hasAsync || details.asyncAwait.hasAwait ? 'Async partiel' : 'Async/Await';

  return [
    formatFeatureRow('Ratio Commentaires', details.commentRatio.normalized,    false),
    formatFeatureRow('Complexité Retours', details.returnComplexity.normalized, true),
    formatFeatureRow(asyncLabel,            details.asyncAwait.normalized,      false),
    formatFeatureRow('Nombres Magiques',   details.magicNumbers.normalized,     true),
    formatFeatureRow('Longueur Chaînes',   details.chainLength.normalized,      true),
  ];
}

/**
 * Construit les lignes de métriques F11–F16 (qualité structurelle).
 *
 * @param {object} details
 * @returns {string[]}
 */
function buildStructuralMetricRows(details) {
  if (!details.modernSyntax) return [];
  return [
    formatFeatureRow('Syntaxe Moderne ES6+', details.modernSyntax.normalized,         false),
    formatFeatureRow('const vs var',          details.constVsVar.normalized,           false),
    formatFeatureRow('Gestion d\'erreurs',    details.errorHandling.normalized,        false),
    formatFeatureRow('Longueur idéale fn',    details.functionLength.normalized,       false),
    formatFeatureRow('Pureté (pas mutation)', details.purityScore.normalized,          false),
    formatFeatureRow('Responsab. Unique SRP', details.singleResponsibility.normalized, false),
  ];
}

// ── Valeurs brutes ───────────────────────────────────────────────────

/**
 * Construit la liste des valeurs brutes à afficher dans le panneau.
 *
 * @param {object} details
 * @returns {string[]}
 */
function buildRawValueLines(details) {
  const lines = [
    `  Branches logiques : ${chalk.white(details.cyclomaticComplexity.raw)}`,
    `  Profondeur max    : ${chalk.white(details.maxNesting.raw)} niveaux`,
    `  Variables nommées : ${chalk.white(details.namingRatio.named)}/${details.namingRatio.total}`,
    `  Lignes / Nœuds    : ${chalk.white(details.linearity.lines)} / ${details.linearity.nodes} (ratio ${details.linearity.ratio})`,
    `  Nb. paramètres    : ${chalk.white(details.modularity.params)}`,
    `  Commentaires       : ${chalk.white(details.commentRatio.comments)} / ${details.commentRatio.lines} lignes`,
    `  Return statements  : ${chalk.white(details.returnComplexity.count)}`,
    `  Async/Await        : ${details.asyncAwait.hasAsync ? chalk.green('async ✓') : chalk.gray('—')}  ${details.asyncAwait.hasAwait ? chalk.green('await ✓') : chalk.gray('—')}`,
    `  Nombres magiques   : ${chalk.white(details.magicNumbers.count)}`,
    `  Chaîne méth. max   : ${chalk.white(details.chainLength.max)} niveaux`,
  ];

  if (details.modernSyntax) {
    lines.push(`  Patterns ES6+      : ${chalk.white(details.modernSyntax.patterns)} (destructuring, spread…)`);
    lines.push(`  const/let/var      : ${chalk.white(details.constVsVar.const)}c / ${chalk.white(details.constVsVar.let)}l / ${chalk.white(details.constVsVar.var)}v`);
    lines.push(`  Densité cyclom.    : ${chalk.white(details.singleResponsibility.cyclomaticPerLine)} branches/ligne`);
  }

  return lines;
}

// ── Conseils de refactoring ──────────────────────────────────────────
// ── Conseils de refactoring ──────────────────────────────────────────

/**
 * Génère un plan d'action hiérarchisé en 3 niveaux de priorité.
 *
 * Priorité 1 — Actions correctives sur les points ayant déclenché un Veto.
 * Priorité 2 — Optimisations structurelles (longueur, complexité, pureté).
 * Priorité 3 — Qualité de forme (naming, commentaires, syntaxe moderne).
 *
 * @param {number} score
 * @param {object} details
 * @param {string|null} [cappedBy] — raison du plafonnement si applicable
 * @returns {object[]} liste de { msg, tip, priority, level }
 */
function getDetailedAdvice(score, details, cappedBy = null) {
  if (score >= 4.5 && !cappedBy) {
    return [{ msg: 'Code exemplaire. Excellent travail.', tip: '', level: 0, priority: 0 }];
  }

  const vetoIssues       = collectVetoIssues(details, cappedBy);
  const structuralIssues = collectStructuralIssues(details, score);
  const formalIssues     = collectFormalIssues(details, score);

  vetoIssues.sort((a, b) => b.priority - a.priority);
  structuralIssues.sort((a, b) => b.priority - a.priority);
  formalIssues.sort((a, b) => b.priority - a.priority);

  const plan = [...vetoIssues, ...structuralIssues, ...formalIssues].slice(0, 4);
  return plan.length > 0
    ? plan
    : [{ msg: 'Code propre. Quelques ajustements mineurs suffiraient.', tip: '', level: 3, priority: 0 }];
}

/**
 * Priorité 1 — Issues liées à un Veto actif (bloquantes pour le score).
 * Inclut la pollution globale (F11) et la densité de gestion d'erreurs (F12).
 *
 * @param {object} details
 * @param {string|null} cappedBy
 * @returns {object[]}
 */
function collectVetoIssues(details, cappedBy) {
  const issues = [];

  if (cappedBy) {
    issues.push({ level: 1, priority: 10,
      msg: 'Note limitée par règle métier : ' + cappedBy,
      tip: 'Corriger ce point en priorité absolue pour débloquer le score.' });
  }
  if (details.maxNesting && details.maxNesting.raw > 8) {
    issues.push({ level: 1, priority: 9,
      msg: "Extract function — aplatir l'imbrication (veto > 8 niveaux)",
      tip: `profondeur actuelle : ${details.maxNesting.raw} (seuil bloquant : 8)` });
  }
  if (details.cyclomaticComplexity && details.cyclomaticComplexity.raw > 25) {
    issues.push({ level: 1, priority: 8.5,
      msg: 'Guard clauses — réduire la complexité cyclomatique (veto > 25)',
      tip: `${details.cyclomaticComplexity.raw} branches logiques (seuil bloquant : 25)` });
  }
  if (details.globalPollution && details.globalPollution.ratio > 0.5) {
    issues.push({ level: 1, priority: 7,
      msg: 'Encapsuler les déclarations globales dans des modules ou fonctions',
      tip: `${details.globalPollution.globalDeclarations}/${details.globalPollution.totalDeclarations} variables en portée globale` });
  }
  if (details.errorHandlingDensity && details.errorHandlingDensity.asyncFunctions > 0
      && details.errorHandlingDensity.density !== null && details.errorHandlingDensity.density < 0.5) {
    issues.push({ level: 1, priority: 6.5,
      msg: 'Ajouter try/catch dans les fonctions async',
      tip: `${details.errorHandlingDensity.asyncWithTryCatch}/${details.errorHandlingDensity.asyncFunctions} fonctions async protégées` });
  }
  return issues;
}

/**
 * Priorité 2 — Optimisations structurelles.
 * Complexité sous-critique, modularité, pureté, SRP, points de sortie.
 *
 * @param {object} details
 * @param {number} score
 * @returns {object[]}
 */
function collectStructuralIssues(details, score) {
  const issues = [];

  if (details.cyclomaticComplexity && details.cyclomaticComplexity.normalized > 0.4
      && details.cyclomaticComplexity.raw <= 25) {
    issues.push({ level: 2, priority: details.cyclomaticComplexity.normalized,
      msg: 'Guard clauses — réduire la complexité cyclomatique',
      tip: `${details.cyclomaticComplexity.raw} branches logiques` });
  }
  if (details.maxNesting && details.maxNesting.normalized > 0.4 && details.maxNesting.raw <= 8) {
    issues.push({ level: 2, priority: details.maxNesting.normalized,
      msg: "Extract function — aplatir l'imbrication",
      tip: `profondeur ${details.maxNesting.raw}` });
  }
  if (details.modularity && details.modularity.normalized < 0.5) {
    issues.push({ level: 2, priority: 1 - details.modularity.normalized,
      msg: "Objet options — réduire le nombre d'arguments",
      tip: `${details.modularity.params} paramètres (idéal <= 3)` });
  }
  if (details.purityScore && details.purityScore.normalized < 0.6) {
    issues.push({ level: 2, priority: 0.7,
      msg: 'Fonctions pures — éviter les mutations de paramètres',
      tip: `${details.purityScore.globalMutations} mutations globales` });
  }
  if (details.singleResponsibility && details.singleResponsibility.normalized < 0.4) {
    issues.push({ level: 2, priority: 0.65,
      msg: 'Single Responsibility — décomposer cette fonction',
      tip: `${details.singleResponsibility.cyclomaticPerLine} branches/ligne (trop dense)` });
  }
  if (details.returnComplexity && details.returnComplexity.normalized > 0.6) {
    issues.push({ level: 2, priority: details.returnComplexity.normalized * 0.9,
      msg: 'Unifier les return — réduire les points de sortie',
      tip: `${details.returnComplexity.count} return statements` });
  }
  return issues;
}

/**
 * Priorité 3 — Qualité de forme.
 * Nommage, commentaires, syntaxe moderne, const/var, nombres magiques.
 *
 * @param {object} details
 * @param {number} score
 * @returns {object[]}
 */
function collectFormalIssues(details, score) {
  const issues = [];

  if (details.namingRatio && details.namingRatio.normalized < 0.6) {
    issues.push({ level: 3, priority: 1 - details.namingRatio.normalized,
      msg: 'Nommage explicite — renommer les variables courtes',
      tip: `${details.namingRatio.named}/${details.namingRatio.total} bien nommées` });
  }
  if (details.commentRatio && details.commentRatio.normalized < 0.1 && score < 3.5) {
    issues.push({ level: 3, priority: 0.5,
      msg: 'JSDoc — documenter paramètres et valeurs de retour',
      tip: `0 commentaires / ${details.commentRatio.lines} lignes` });
  }
  if (details.magicNumbers && details.magicNumbers.normalized > 0.3) {
    issues.push({ level: 3, priority: details.magicNumbers.normalized * 0.85,
      msg: 'Constantes nommées — remplacer les nombres magiques',
      tip: `${details.magicNumbers.count} littéraux numériques` });
  }
  if (details.modernSyntax && details.modernSyntax.normalized < 0.2 && score < 3.0) {
    issues.push({ level: 3, priority: 0.45,
      msg: 'Moderniser — destructuring, template literals, spread',
      tip: `Seulement ${details.modernSyntax.patterns} patterns ES6+ détectés` });
  }
  if (details.constVsVar && details.constVsVar.normalized < 0.4) {
    issues.push({ level: 3, priority: 0.55,
      msg: 'Preferer const/let — eliminer les var',
      tip: `${details.constVsVar.var} var détectés` });
  }
  return issues;
}

/**
 * Collecte toutes les issues (compatibilité ascendante).
 * @deprecated Utiliser getDetailedAdvice() directement.
 */
function collectQualityIssues(details, score) {
  return [...collectVetoIssues(details, null), ...collectStructuralIssues(details, score), ...collectFormalIssues(details, score)];
}

function getAdvice(score, details) {
  const advices = getDetailedAdvice(score, details);
  const top     = advices[0];
  return top.tip ? `${top.msg}  (${top.tip})` : top.msg;
}

// ── Affichage principal ──────────────────────────────────────────────

/**
 * Affiche le panneau de résultat complet pour un snippet ou une fonction.
 *
 * @param {number} score — dans [0..5]
 * @param {object} details — objet details de extractFeatures
 * @param {string} [filename='fonction']
 */
function displayResult(score, details, filename = 'fonction', cappedBy = null) {
  const colorize = getColorForScore(score);
  const verdict  = getVerdict(score);
  const width    = 52;

  console.log('');
  console.log(colorize(`  ┌${'─'.repeat(width)}┐`));
  console.log(colorize('  │') + chalk.white.bold('    JS-RANKER — Analyse Complète'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.gray(`  Fichier : ${filename}`.padEnd(width)) + colorize('│'));
  if (cappedBy) {
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));
    const capMsg = `  Note limitée par règle métier : ${cappedBy}`;
    console.log(colorize('  │') + chalk.hex('#FF6B6B').bold(capMsg.substring(0, width).padEnd(width)) + colorize('│'));
  }
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  // Score & barre
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `       ${buildStars(score)}    ${colorize(score.toFixed(2))} / 5.0` + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `  ${buildProgressBar(score)}  ` + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  const verdictLine = `       ${verdict.emoji}  ${colorize.bold(verdict.word.padEnd(14))} `;
  console.log(colorize('  │') + verdictLine + ''.padEnd(width - verdictLine.length + 2) + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));

  // Métriques F1–F5
  printMetricsSection('Métriques Fondamentales', buildFundamentalMetricRows(details), width, colorize);

  // Métriques F6–F10
  if (details.commentRatio !== undefined) {
    printMetricsSection('Métriques Avancées', buildAdvancedMetricRows(details), width, colorize);
  }

  // Métriques F11–F16
  const structuralRows = buildStructuralMetricRows(details);
  if (structuralRows.length > 0) {
    printMetricsSection('Qualité Structurelle', structuralRows, width, colorize);
  }

  // Valeurs brutes
  const rawLines = buildRawValueLines(details);
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold('  Valeurs Brutes'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  for (const line of rawLines) {
    console.log(colorize('  │') + chalk.gray(line.padEnd(width)) + colorize('│'));
  }

  // Conseils
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold('  Conseils de Refactoring'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  const advices = getDetailedAdvice(score, details, cappedBy);
  const icons   = ['🔧', '💡', '📌'];
  const levelLabels = { 1: '[P1]', 2: '[P2]', 3: '[P3]' };
  for (const [idx, adv] of advices.entries()) {
    const prefix = `  ${icons[idx] || '•'} ${adv.msg}`;
    console.log(colorize('  │') + chalk.gray(prefix.substring(0, width).padEnd(width)) + colorize('│'));
    if (adv.tip) {
      console.log(colorize('  │') + chalk.gray(`      ↳ ${adv.tip}`.substring(0, width).padEnd(width)) + colorize('│'));
    }
  }

  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize(`  └${'─'.repeat(width)}┘`));
  console.log('');
}

// ── Bannière & utilitaires ───────────────────────────────────────────

/**
 * Affiche la bannière de démarrage de JS-RANKER.
 */
function displayBanner() {
  console.log('');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('       JS-RANKER  v2.0  — Zen Console       ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   16 métriques AST — Notation ML de JS       ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════╝'));
  console.log('');
}

/**
 * Affiche un message d'erreur formaté.
 *
 * @param {string} message
 */
function displayError(message) {
  console.log('');
  console.log(chalk.red('  ┌──────────────────────────────────────┐'));
  console.log(chalk.red('  │') + chalk.white.bold('    ERREUR                          ') + chalk.red('│'));
  console.log(chalk.red('  ├──────────────────────────────────────┤'));
  console.log(chalk.red('  │') + chalk.gray(`  ${message.substring(0, 36).padEnd(36)}`) + chalk.red('│'));
  console.log(chalk.red('  └──────────────────────────────────────┘'));
  console.log('');
}

/**
 * Affiche les informations de fetch d'une source distante.
 *
 * @param {{ source, resolvedUrl, sizeKb }} fetchInfo
 */
function displayFetchInfo({ source, resolvedUrl, sizeKb }) {
  console.log(chalk.cyan('\n  ┌─ Source distante ──────────────────────────────'));
  console.log(chalk.cyan('  │') + chalk.gray(`  Type     : ${chalk.white(source)}`));
  if (resolvedUrl) {
    const shortUrl = resolvedUrl.length > 50 ? resolvedUrl.substring(0, 47) + '...' : resolvedUrl;
    console.log(chalk.cyan('  │') + chalk.gray(`  URL Raw  : ${chalk.white(shortUrl)}`));
  }
  if (sizeKb) {
    console.log(chalk.cyan('  │') + chalk.gray(`  Taille   : ${chalk.white(sizeKb + ' KB')}`));
  }
}

/**
 * Affiche le rapport complet d'un fichier multi-fonctions.
 *
 * @param {object} report — résultat de decomposeAndScore
 * @param {string} [filename='fichier']
 */
function displayFileReport(report, filename = 'fichier') {
  const { globalScore, weightedScores, scopeAnalysis, breakdown, baseScore, scopeAdjustment } = report;
  const colorize = getColorForScore(globalScore);
  const verdict  = getVerdict(globalScore);
  const width    = 52;

  console.log('');
  console.log(colorize(`  ┌${'─'.repeat(width)}┐`));
  console.log(colorize('  │') + chalk.white.bold('    RAPPORT FICHIER COMPLET'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.gray(`  ${filename}`.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  // Score global
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `       ${buildStars(globalScore)}    ${colorize(globalScore.toFixed(2))} / 5.0` + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `  ${buildProgressBar(globalScore, 34)}  ` + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize('  │') + `       ${verdict.emoji}  ${colorize.bold(verdict.word)}`.padEnd(width + 10) + colorize('│'));
  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));

  // Scores par fonction
  if (weightedScores?.length > 0) {
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));
    console.log(colorize('  │') + chalk.white.bold(`  Scores par Fonction (${weightedScores.length})`.padEnd(width)) + colorize('│'));
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));

    const sorted = [...weightedScores].sort((a, b) => b.score - a.score);
    for (const fn of sorted) {
      console.log(colorize('  │') + formatFunctionScoreLine(fn) + colorize('│'));
    }

    if (sorted.length > 1) {
      console.log(colorize(`  ├${'─'.repeat(width)}┤`));
      console.log(colorize('  │') + chalk.gray(`  ⬆ Meilleure : ${chalk.green(sorted[0].name)} (${sorted[0].score.toFixed(2)})`.padEnd(width)) + colorize('│'));
      console.log(colorize('  │') + chalk.gray(`  ⬇ À revoir  : ${chalk.red(sorted[sorted.length - 1].name)} (${sorted[sorted.length - 1].score.toFixed(2)})`.padEnd(width)) + colorize('│'));
    }
  }

  // Scope global
  if (scopeAnalysis) {
    printScopeSection(scopeAnalysis, scopeAdjustment, colorize, width);
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

/**
 * Formate la ligne de score d'une fonction individuelle.
 *
 * @param {object} fn — { name, score, weight }
 * @returns {string}
 */
function formatFunctionScoreLine(fn) {
  const fnColor  = getColorForScore(fn.score);
  const barW     = 14;
  const filled   = Math.round((fn.score / 5) * barW);
  const miniBar  = fnColor('█'.repeat(filled)) + chalk.gray('░'.repeat(barW - filled));
  const name     = fn.name.substring(0, 18).padEnd(18);
  const line     = `  ├ ${chalk.white(name)} ${miniBar} ${fnColor(fn.score.toFixed(2))}  ${chalk.gray(fn.weight + '%')}`;
  return chalk.gray(line.padEnd(67));
}

/**
 * Affiche la section d'analyse du scope global.
 *
 * @param {object} scopeAnalysis
 * @param {number} scopeAdjustment
 * @param {Function} colorize
 * @param {number} width
 */
function printScopeSection(scopeAnalysis, scopeAdjustment, colorize, width) {
  const adj = scopeAdjustment >= 0
    ? chalk.green(`+${scopeAdjustment.toFixed(2)} pts`)
    : chalk.red(`${scopeAdjustment.toFixed(2)} pts`);

  const scopeRows = [
    `  Lignes hors-fonctions  : ${chalk.white(scopeAnalysis.globalLines)} / ${scopeAnalysis.totalLines}`,
    `  Variables var globales : ${chalk.white(scopeAnalysis.globalVarCount)}`,
    `  Mutations globales     : ${chalk.white(scopeAnalysis.globalMutations)}`,
    `  En-tête de fichier     : ${scopeAnalysis.hasFileHeader  ? chalk.green('✓ présent') : chalk.gray('absent')}`,
    `  Exports propres        : ${scopeAnalysis.hasCleanExports ? chalk.green('✓ propres') : chalk.gray('absents')}`,
    `  Ajustement scope       : ${adj}`,
  ];

  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold('  Scope Global'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  for (const row of scopeRows) {
    console.log(colorize('  │') + chalk.gray(row.padEnd(width + 5)) + colorize('│'));
  }
}

module.exports = {
  displayResult,
  displayBanner,
  displayError,
  displayFileReport,
  displayFetchInfo,
  getVerdict,
  getAdvice,
  getDetailedAdvice,
};
