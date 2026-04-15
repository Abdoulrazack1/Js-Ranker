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
  // Features originales (F1–F5)
  console.log(colorize('  │') + formatFeatureRow('Complexité Cyclo.', f.cyclomaticComplexity.normalized, true) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Imbrication Max.', f.maxNesting.normalized, true) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Ratio Nommage', f.namingRatio.normalized, false) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Linéarité', f.linearity.normalized, false) + colorize('│'));
  console.log(colorize('  │') + formatFeatureRow('Modularité', f.modularity.normalized, false) + colorize('│'));

  // Nouvelles features (F6–F10) si disponibles
  if (f.commentRatio !== undefined) {
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));
    console.log(colorize('  │') + chalk.white.bold('  Métriques Avancées'.padEnd(width)) + colorize('│'));
    console.log(colorize(`  ├${'─'.repeat(width)}┤`));
    console.log(colorize('  │') + formatFeatureRow('Ratio Commentaires', f.commentRatio.normalized, false) + colorize('│'));
    console.log(colorize('  │') + formatFeatureRow('Complexité Retours', f.returnComplexity.normalized, true) + colorize('│'));
    const asyncLabel = f.asyncAwait.hasAsync && f.asyncAwait.hasAwait
      ? 'Async/Await ✓'
      : f.asyncAwait.hasAsync || f.asyncAwait.hasAwait ? 'Async partiel' : 'Async/Await';
    console.log(colorize('  │') + formatFeatureRow(asyncLabel, f.asyncAwait.normalized, false) + colorize('│'));
    console.log(colorize('  │') + formatFeatureRow('Nombres Magiques', f.magicNumbers.normalized, true) + colorize('│'));
    console.log(colorize('  │') + formatFeatureRow('Longueur Chaînes', f.chainLength.normalized, true) + colorize('│'));
  }

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

  if (f.commentRatio !== undefined) {
    raw.push(`  Lignes commentaires: ${chalk.white(f.commentRatio.comments)} / ${f.commentRatio.lines}`);
    raw.push(`  Return statements  : ${chalk.white(f.returnComplexity.count)}`);
    raw.push(`  Async/Await        : ${f.asyncAwait.hasAsync ? chalk.green('async ✓') : chalk.gray('—')}  ${f.asyncAwait.hasAwait ? chalk.green('await ✓') : chalk.gray('—')}`);
    raw.push(`  Nombres magiques   : ${chalk.white(f.magicNumbers.count)}`);
    raw.push(`  Chaîne méth. max   : ${chalk.white(f.chainLength.max)} niveaux`);
  }

  for (const line of raw) {
    console.log(colorize('  │') + chalk.gray(line.padEnd(width)) + colorize('│'));
  }

  // ── Conseils de refactoring enrichis ────────────────
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));
  console.log(colorize('  │') + chalk.white.bold('  Conseils de Refactoring'.padEnd(width)) + colorize('│'));
  console.log(colorize(`  ├${'─'.repeat(width)}┤`));

  const advices = getDetailedAdvice(score, details);
  const icons   = ['🔧', '💡', '📌'];
  advices.forEach((adv, idx) => {
    const prefix = `  ${icons[idx] || '•'} ${adv.msg}`;
    console.log(colorize('  │') + chalk.gray(prefix.substring(0, width).padEnd(width)) + colorize('│'));
    if (adv.tip) {
      const tipLine = `      ↳ ${adv.tip}`;
      console.log(colorize('  │') + chalk.gray(tipLine.substring(0, width).padEnd(width)) + colorize('│'));
    }
  });

  console.log(colorize('  │') + ''.padEnd(width) + colorize('│'));
  console.log(colorize(`  └${border}┘`));
  console.log('');
}

// ─────────────────────────────────────────────────────────
//  Conseil automatique basé sur la feature la plus faible
// ─────────────────────────────────────────────────────────
function getAdvice(score, details) {
  if (score >= 4.5) return 'Code exemplaire. Excellent travail ! 🎉';

  const issues = [];

  // ── Features originales ──────────────────────────────
  if (details.cyclomaticComplexity.normalized > 0.5)
    issues.push({
      priority: details.cyclomaticComplexity.normalized,
      msg:      'Réduire les conditions imbriquées → Guard clauses & early return',
      tip:      `${details.cyclomaticComplexity.raw} branches logiques détectées`,
    });
  if (details.maxNesting.normalized > 0.5)
    issues.push({
      priority: details.maxNesting.normalized,
      msg:      'Aplatir les blocs imbriqués → Extraire en sous-fonctions',
      tip:      `Profondeur max : ${details.maxNesting.raw} niveaux`,
    });
  if (details.namingRatio.normalized < 0.5)
    issues.push({
      priority: 1 - details.namingRatio.normalized,
      msg:      'Renommer les variables : a, b, x → noms explicites et sémantiques',
      tip:      `Seulement ${details.namingRatio.named}/${details.namingRatio.total} variables bien nommées`,
    });
  if (details.modularity.normalized < 0.4)
    issues.push({
      priority: 1 - details.modularity.normalized,
      msg:      'Trop d\'arguments → Regrouper en un objet options/config',
      tip:      `${details.modularity.params} paramètres (idéal : ≤ 3)`,
    });
  if (details.linearity.normalized < 0.4)
    issues.push({
      priority: 1 - details.linearity.normalized,
      msg:      'Déséquilibre code/structure → Restructurer en blocs lisibles',
      tip:      `Ratio lignes/nœuds = ${details.linearity.ratio} (idéal ≈ 1.5)`,
    });

  // ── Nouvelles features ───────────────────────────────
  if (details.commentRatio && details.commentRatio.normalized < 0.1 && score < 3.5)
    issues.push({
      priority: 0.4,
      msg:      'Ajouter des commentaires JSDoc → documenter les paramètres & retours',
      tip:      `Aucun commentaire détecté pour ${details.commentRatio.lines} lignes de code`,
    });
  if (details.returnComplexity && details.returnComplexity.normalized > 0.6)
    issues.push({
      priority: details.returnComplexity.normalized * 0.9,
      msg:      'Trop de points de sortie → Unifier les return en fin de fonction',
      tip:      `${details.returnComplexity.count} return statements (idéal : 1–3)`,
    });
  if (details.magicNumbers && details.magicNumbers.normalized > 0.3)
    issues.push({
      priority: details.magicNumbers.normalized * 0.85,
      msg:      'Nommer les constantes magiques → const MAX_RETRY = 3 au lieu de 3',
      tip:      `${details.magicNumbers.count} nombres magiques détectés`,
    });
  if (details.chainLength && details.chainLength.normalized > 0.5)
    issues.push({
      priority: details.chainLength.normalized * 0.8,
      msg:      'Chaîne de méthodes trop longue → Décomposer en variables intermédiaires',
      tip:      `Chaîne de ${details.chainLength.max} appels enchaînés`,
    });

  if (issues.length === 0) return 'Bon code. Quelques ajustements mineurs suffiraient.';

  issues.sort((a, b) => b.priority - a.priority);

  // Retourne le conseil principal + le tip contextuel
  const top = issues[0];
  return `${top.msg}  (${top.tip})`;
}

/**
 * Retourne jusqu'à 3 conseils détaillés, triés par priorité.
 * Utilisé pour l'affichage enrichi multi-conseils.
 */
function getDetailedAdvice(score, details) {
  if (score >= 4.5) return [{ msg: 'Code exemplaire. Excellent travail ! 🎉', tip: '' }];

  const issues = [];

  if (details.cyclomaticComplexity.normalized > 0.4)
    issues.push({ priority: details.cyclomaticComplexity.normalized,
      msg: 'Guard clauses → réduire la complexité cyclomatique',
      tip: `${details.cyclomaticComplexity.raw} branches logiques` });
  if (details.maxNesting.normalized > 0.4)
    issues.push({ priority: details.maxNesting.normalized,
      msg: 'Extract function → aplatir l\'imbrication',
      tip: `profondeur ${details.maxNesting.raw}` });
  if (details.namingRatio.normalized < 0.6)
    issues.push({ priority: 1 - details.namingRatio.normalized,
      msg: 'Nommage explicite → renommer les variables courtes',
      tip: `${details.namingRatio.named}/${details.namingRatio.total} bien nommées` });
  if (details.modularity.normalized < 0.5)
    issues.push({ priority: 1 - details.modularity.normalized,
      msg: 'Objet options → réduire le nombre d\'arguments',
      tip: `${details.modularity.params} paramètres` });
  if (details.commentRatio && details.commentRatio.normalized < 0.1 && score < 3.5)
    issues.push({ priority: 0.4,
      msg: 'JSDoc → documenter les paramètres et valeurs de retour',
      tip: `0 commentaires / ${details.commentRatio.lines} lignes` });
  if (details.magicNumbers && details.magicNumbers.normalized > 0.3)
    issues.push({ priority: details.magicNumbers.normalized * 0.85,
      msg: 'Constantes nommées → remplacer les nombres magiques',
      tip: `${details.magicNumbers.count} littéraux numériques` });
  if (details.returnComplexity && details.returnComplexity.normalized > 0.6)
    issues.push({ priority: details.returnComplexity.normalized * 0.9,
      msg: 'Unifier les return → réduire les points de sortie',
      tip: `${details.returnComplexity.count} return statements` });
  if (details.chainLength && details.chainLength.normalized > 0.5)
    issues.push({ priority: details.chainLength.normalized * 0.8,
      msg: 'Variables intermédiaires → décomposer les chaînes de méthodes',
      tip: `chaîne de ${details.chainLength.max} appels` });

  issues.sort((a, b) => b.priority - a.priority);
  return issues.slice(0, 3).length > 0 ? issues.slice(0, 3) : [{ msg: 'Code propre. Quelques ajustements mineurs suffiraient.', tip: '' }];
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

module.exports = { displayResult, displayBanner, displayError, displayFileReport, displayFetchInfo, getVerdict, getAdvice, getDetailedAdvice };
