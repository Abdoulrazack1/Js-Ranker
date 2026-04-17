#!/usr/bin/env node
'use strict';

/**
 * Dashboard CLI — analyse un fichier JS et affiche le résultat en live.
 *
 * Usage :
 *   node analysis/dashboard.js                       -> src/features.js par défaut
 *   node analysis/dashboard.js src/train.js          -> autre fichier
 *   node analysis/dashboard.js examples/perfect.js   -> les examples marchent aussi
 *   node analysis/dashboard.js --json                -> JSON brut au lieu du dashboard
 *   node analysis/dashboard.js fichier.js --save     -> écrit analysis-output.json
 */

const fs   = require('fs');
const path = require('path');

const { analyzeFile } = require('./generate');
const { render }      = require('./render-terminal');

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { json: false, save: false };
  const positional = [];
  for (const arg of args) {
    if (arg === '--json')      flags.json = true;
    else if (arg === '--save') flags.save = true;
    else positional.push(arg);
  }
  return { flags, positional };
}

function main() {
  const { flags, positional } = parseArgs(process.argv);

  const defaultTarget = path.join(__dirname, '..', 'src', 'features.js');
  const filePath      = positional[0]
    ? path.resolve(process.cwd(), positional[0])
    : defaultTarget;

  if (!fs.existsSync(filePath)) {
    console.error(`\n  Fichier introuvable : ${filePath}\n`);
    process.exit(1);
  }

  let analysis;
  try {
    analysis = analyzeFile(filePath);
  } catch (err) {
    console.error(`\n  Analyse échouée pour ${filePath} :\n  ${err.message}\n`);
    process.exit(1);
  }

  const { _raw, ...publicAnalysis } = analysis;

  if (flags.save) {
    const outPath = path.join(__dirname, 'analysis-output.json');
    fs.writeFileSync(outPath, JSON.stringify(publicAnalysis, null, 2));
    console.error(`\n  -> analyse sauvegardée dans ${path.relative(process.cwd(), outPath)}\n`);
  }

  if (flags.json) {
    console.log(JSON.stringify(publicAnalysis, null, 2));
    return;
  }

  render(publicAnalysis);
}

main();
