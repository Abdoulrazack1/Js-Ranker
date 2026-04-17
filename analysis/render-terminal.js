'use strict';

/**
 * Renderer terminal — affiche l'analyse JS-Ranker avec la même mise en page
 * que le dashboard web (score, criteria breakdown en grille 3x3, strengths/weaknesses).
 */

// ── Couleurs ANSI ────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  fg: {
    gray:    '\x1b[38;5;244m',
    white:   '\x1b[38;5;255m',
    green:   '\x1b[38;5;78m',
    amber:   '\x1b[38;5;214m',
    red:     '\x1b[38;5;203m',
    cyan:    '\x1b[38;5;111m',
    blue:    '\x1b[38;5;75m',
    muted:   '\x1b[38;5;240m',
  },
  bg: {
    green:   '\x1b[48;5;22m',
    amber:   '\x1b[48;5;94m',
    red:     '\x1b[48;5;52m',
    blue:    '\x1b[48;5;24m',
    dark:    '\x1b[48;5;235m',
  },
};

const VERDICT_STYLE = {
  EXCELLENT: { bg: C.bg.green, fg: C.fg.white },
  GOOD:      { bg: C.bg.blue,  fg: C.fg.white },
  AVERAGE:   { bg: C.bg.amber, fg: C.fg.white },
  POOR:      { bg: C.bg.red,   fg: C.fg.white },
  CRITICAL:  { bg: C.bg.red,   fg: C.fg.white },
};

// ── Utilitaires de rendu ─────────────────────────────────────────────

function colorForPct(pct) {
  if (pct >= 85) return C.fg.green;
  if (pct >= 70) return C.fg.amber;
  return C.fg.red;
}

function qualifierForPct(pct) {
  if (pct >= 90) return 'excellent';
  if (pct >= 80) return 'strong';
  if (pct >= 70) return 'good';
  if (pct >= 60) return 'acceptable';
  if (pct >= 50) return 'fair';
  return 'weak';
}

function progressBar(pct, width = 28) {
  const filled = Math.round((pct / 100) * width);
  const empty  = width - filled;
  const color  = colorForPct(pct);
  return `${color}${'█'.repeat(filled)}${C.fg.muted}${'░'.repeat(empty)}${C.reset}`;
}

function padRight(str, n) {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  return str + ' '.repeat(Math.max(0, n - plain.length));
}

function wrap(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current ? current + ' ' : '') + word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Blocs de rendu ──────────────────────────────────────────────────

function renderHeader(score, verdict, fileLabel, metaPills) {
  const v = VERDICT_STYLE[verdict] || VERDICT_STYLE.AVERAGE;
  const scoreStr = `${C.bold}${C.fg.white}${score.toFixed(1)}${C.reset}${C.fg.gray} / 5.0${C.reset}`;
  const badge = ` ${v.bg}${v.fg}${C.bold} ${verdict} ${C.reset}`;

  console.log('');
  console.log(`  ${C.fg.cyan}${C.bold}┃${C.reset} ${C.fg.gray}JS-RANKER V4  ·  CODE QUALITY ANALYSIS${C.reset}`);
  console.log('');
  console.log(`    ${scoreStr}${badge}`);
  console.log('');

  const pills = metaPills.map(p => `${C.bg.dark}${C.fg.white} ${p} ${C.reset}`).join(' ');
  console.log(`    ${pills}`);
  console.log('');
}

function renderCriteriaGrid(criteria) {
  console.log(`  ${C.fg.gray}${C.bold}CRITERIA BREAKDOWN${C.reset}`);
  console.log('');

  const cellWidth = 36;
  const barWidth  = 30;
  const cols      = 3;

  for (let i = 0; i < criteria.length; i += cols) {
    const row = criteria.slice(i, i + cols);

    // ligne 1 : nom du critère
    const names = row.map(c => padRight(`${C.fg.gray}${c.name.toUpperCase()}${C.reset}`, cellWidth));
    console.log('  ' + names.join(''));

    // ligne 2 : barre (largeur explicite pour alignement propre)
    const bars = row.map(c => padRight(progressBar(c.pct, barWidth), cellWidth));
    console.log('  ' + bars.join(''));

    // ligne 3 : pourcentage + qualifier
    const pcts = row.map(c => {
      const qual = qualifierForPct(c.pct);
      const pct  = `${colorForPct(c.pct)}${C.bold}${c.pct}%${C.reset}`;
      return padRight(`${pct} ${C.fg.muted}— ${qual}${C.reset}`, cellWidth);
    });
    console.log('  ' + pcts.join(''));

    // ligne 4 : note
    const notes = row.map(c => padRight(`${C.fg.muted}${C.dim}${c.note || ''}${C.reset}`, cellWidth));
    console.log('  ' + notes.join(''));

    console.log('');
  }
}

function renderSideBySideBoxes(strengths, weaknesses) {
  const boxWidth = 52;
  const innerW   = boxWidth - 4;

  const strengthLines  = strengths.flatMap(s => {
    const wrapped = wrap('• ' + s, innerW);
    return wrapped.map((line, idx) => idx === 0 ? line : '  ' + line);
  });
  const weaknessLines  = weaknesses.flatMap(w => {
    const wrapped = wrap('• ' + w, innerW);
    return wrapped.map((line, idx) => idx === 0 ? line : '  ' + line);
  });

  const maxLines = Math.max(strengthLines.length, weaknessLines.length);

  const sTop = `${C.fg.green}┏${'━'.repeat(boxWidth - 2)}┓${C.reset}`;
  const sBot = `${C.fg.green}┗${'━'.repeat(boxWidth - 2)}┛${C.reset}`;
  const wTop = `${C.fg.red}┏${'━'.repeat(boxWidth - 2)}┓${C.reset}`;
  const wBot = `${C.fg.red}┗${'━'.repeat(boxWidth - 2)}┛${C.reset}`;

  // entêtes — on pad le contenu interne à innerW puis on l'entoure de bords
  const sHeaderInner = padRight(`${C.bold}${C.fg.green}STRENGTHS${C.reset}`, innerW);
  const wHeaderInner = padRight(`${C.bold}${C.fg.red}WEAKNESSES${C.reset}`, innerW);
  const sHeader = `${C.fg.green}┃${C.reset} ${sHeaderInner} ${C.fg.green}┃${C.reset}`;
  const wHeader = `${C.fg.red}┃${C.reset} ${wHeaderInner} ${C.fg.red}┃${C.reset}`;

  console.log('  ' + sTop + '   ' + wTop);
  console.log('  ' + sHeader + '   ' + wHeader);

  const emptyS = `${C.fg.green}┃${C.reset}${' '.repeat(boxWidth - 2)}${C.fg.green}┃${C.reset}`;
  const emptyW = `${C.fg.red}┃${C.reset}${' '.repeat(boxWidth - 2)}${C.fg.red}┃${C.reset}`;

  console.log('  ' + emptyS + '   ' + emptyW);

  for (let i = 0; i < maxLines; i++) {
    const sContent = strengthLines[i] || '';
    const wContent = weaknessLines[i] || '';

    const sPadded = padRight(sContent, innerW);
    const wPadded = padRight(wContent, innerW);

    const sLine = `${C.fg.green}┃${C.reset} ${C.fg.white}${sPadded}${C.reset} ${C.fg.green}┃${C.reset}`;
    const wLine = `${C.fg.red}┃${C.reset} ${C.fg.white}${wPadded}${C.reset} ${C.fg.red}┃${C.reset}`;

    console.log('  ' + sLine + '   ' + wLine);
  }

  console.log('  ' + emptyS + '   ' + emptyW);
  console.log('  ' + sBot + '   ' + wBot);
}

function renderFooter(reasoning, datasetSample) {
  console.log('');
  console.log(`  ${C.fg.gray}${C.bold}REASONING${C.reset}`);
  wrap(reasoning, 100).forEach(line => console.log(`  ${C.fg.white}${line}${C.reset}`));
  console.log('');
  console.log(`  ${C.fg.gray}${C.bold}DATASET SAMPLE${C.reset}  ${C.fg.muted}→ ML-ready${C.reset}`);
  console.log(`  ${C.fg.muted}score:${C.reset} ${C.fg.white}${datasetSample.score}${C.reset}  ${C.fg.muted}bucket:${C.reset} ${C.fg.white}${datasetSample.quality_bucket}${C.reset}`);
  console.log('');
}

// ── Entrée principale ───────────────────────────────────────────────

function render(analysis) {
  renderHeader(
    analysis.score,
    analysis.verdict,
    analysis.meta.primaryFile,
    [
      `${analysis.meta.primaryFile} — primary`,
      `${analysis.meta.filesReviewed} files reviewed`,
      `~${analysis.meta.cleanedLines} lines cleaned`,
      analysis.meta.stack,
    ]
  );
  renderCriteriaGrid(analysis.criteria);
  renderSideBySideBoxes(analysis.strengths, analysis.weaknesses);
  renderFooter(analysis.reasoning, analysis.dataset_sample);
}

module.exports = { render };

// ── Exécution directe ───────────────────────────────────────────────

if (require.main === module) {
  const analysis = require('./analysis-output.json');
  render(analysis);
}
