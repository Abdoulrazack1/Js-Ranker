#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║       JS-RANKER — Migration Dataset v2.0 → v2.1             ║
 * ║                                                              ║
 * ║   Recalcule les features AST de chaque sample pour passer   ║
 * ║   de 5 features (v2.0) à 10 features (v2.1).                ║
 * ║                                                              ║
 * ║   Usage : node migrate-dataset.js [--in dataset.json]       ║
 * ║            [--out dataset.json] [--dry-run]                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs');
const path = require('path');

const args      = process.argv.slice(2);
const getArg    = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i+1] ? args[i+1] : def; };
const DRY_RUN   = args.includes('--dry-run');
const IN_FILE   = getArg('--in',  'dataset.json');
const OUT_FILE  = getArg('--out', IN_FILE);

const chalk = require('chalk');
const { extractFeatures } = require('./src/features');

const FALLBACK_EXTRA = [0.0, 0.125, 0.0, 0.0, 0.0]; // commentRatio, returnComplexity, asyncAwait, magicNumbers, chainLength

console.log('');
console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
console.log(chalk.cyan('  ║') + chalk.white.bold('   📦  JS-RANKER — Migration Dataset v2.1         ') + chalk.cyan('║'));
console.log(chalk.cyan('  ║') + chalk.gray('   5 features → 10 features (recalcul AST live)   ') + chalk.cyan('║'));
console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
console.log('');
console.log(chalk.gray(`  Entrée  : ${path.resolve(IN_FILE)}`));
console.log(chalk.gray(`  Sortie  : ${path.resolve(OUT_FILE)}`));
if (DRY_RUN) console.log(chalk.yellow('  ⚠  Mode dry-run — aucune écriture'));
console.log('');

// ── Chargement ─────────────────────────────────────────────────────
if (!fs.existsSync(IN_FILE)) {
  console.error(chalk.red(`  ❌ Fichier introuvable : ${IN_FILE}`));
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
const samples = raw.samples;
console.log(chalk.cyan(`  ┌─ Traitement de ${samples.length} samples ──────────────────`));

let upgraded = 0, fallback = 0, skipped = 0;

for (const sample of samples) {
  // Déjà à 10 features ?
  if (Array.isArray(sample.features) && sample.features.length === 10) {
    skipped++;
    continue;
  }

  if (!sample.code || sample.code.trim().length < 5) {
    // Pas de code source → padding manuel
    if (Array.isArray(sample.features) && sample.features.length === 5) {
      sample.features = [...sample.features, ...FALLBACK_EXTRA];
    }
    fallback++;
    continue;
  }

  try {
    const { features } = extractFeatures(sample.code);
    sample.features = features;
    upgraded++;
  } catch {
    // Fallback si le parsing AST échoue
    if (Array.isArray(sample.features) && sample.features.length === 5) {
      sample.features = [...sample.features, ...FALLBACK_EXTRA];
    }
    fallback++;
  }
}

// ── Mise à jour des métadonnées ────────────────────────────────────
const prevVersion = raw.version || '2.0';
raw.version       = '2.1';
raw.description   = raw.description.replace('v1.0', 'v2.1').replace('2.0', '2.1')
  + (raw.description.includes('10 features') ? '' : ' — 10 features AST');
raw.migratedAt    = new Date().toISOString();
raw.schema.features = [
  'cyclomaticComplexity', 'maxNesting', 'namingRatio', 'linearity', 'modularity',
  'commentRatio', 'returnComplexity', 'asyncAwait', 'magicNumbers', 'chainLength',
];

// ── Rapport ────────────────────────────────────────────────────────
console.log(chalk.green(`  │  ✓ Recalculés (AST live) : ${upgraded}`));
if (fallback > 0) console.log(chalk.yellow(`  │  ⚠ Fallback (padding)    : ${fallback}`));
if (skipped > 0)  console.log(chalk.gray(`  │  — Déjà à 10 features   : ${skipped}`));
console.log(chalk.gray(`  │  Version : ${prevVersion} → ${raw.version}`));

// Vérifie l'intégrité
const invalid = samples.filter(s => !Array.isArray(s.features) || s.features.length !== 10);
if (invalid.length > 0) {
  console.log(chalk.red(`  │  ❌ ${invalid.length} samples encore invalides !`));
  invalid.forEach(s => console.log(chalk.red(`  │     → ${s.id}`)));
} else {
  console.log(chalk.green(`  │  ✓ Tous les samples ont 10 features`));
}

console.log(chalk.cyan('  └─────────────────────────────────────────────────'));
console.log('');

if (DRY_RUN) {
  console.log(chalk.yellow('  Dry-run : aucune écriture effectuée.'));
  console.log('');
  process.exit(0);
}

// ── Sauvegarde ─────────────────────────────────────────────────────
// Backup de sécurité si on écrase le même fichier
if (OUT_FILE === IN_FILE) {
  const backupPath = IN_FILE.replace('.json', '.bak.json');
  fs.copyFileSync(IN_FILE, backupPath);
  console.log(chalk.gray(`  Backup créé : ${backupPath}`));
}

fs.writeFileSync(OUT_FILE, JSON.stringify(raw, null, 2));
const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(chalk.green(`  ✓ Dataset sauvegardé → ${path.resolve(OUT_FILE)}  (${sizeKb} KB)`));
console.log('');
console.log('  ' + chalk.cyan('━'.repeat(50)));
console.log(`  ${chalk.white.bold('Prochaine étape :')} ${chalk.gray('npm run train')}`);
console.log('  ' + chalk.cyan('━'.repeat(50)));
console.log('');
