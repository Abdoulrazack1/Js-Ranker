#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           JS-RANKER v2 — CLI Principal                       ║
 * ║                                                              ║
 * ║   node index.js analyze <file.js>                           ║
 * ║   node index.js url <github-url>                            ║
 * ║   node index.js snippet "const f = x => x"                  ║
 * ║   node index.js stream-train <url|path>                      ║
 * ║   node index.js train                                        ║
 * ║   node index.js status                                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

const { analyzeFile, analyzeUrl, analyzeSnippet, analyzeAuto, modelExists } = require('./src/analyze');
const { streamTrain } = require('./src/stream-trainer');

const program = new Command();

program
  .name('js-ranker')
  .description('🧠 Moteur de notation ML pour fonctions JavaScript — v2.0')
  .version('2.0.0');

// ── Analyser un fichier local ──────────────────────────────────
program
  .command('analyze <file>')
  .alias('a')
  .description('Analyser un fichier JS local (décomposition par fonctions)')
  .action(async (file) => {
    await analyzeFile(file);
  });

// ── Analyser une URL (GitHub, GitLab, CDN...) ─────────────────
program
  .command('url <url>')
  .alias('u')
  .description('Analyser une URL JavaScript en mémoire (GitHub Raw, CDN, etc.)')
  .action(async (url) => {
    await analyzeUrl(url);
  });

// ── Analyser un snippet inline ─────────────────────────────────
program
  .command('snippet <code>')
  .alias('s')
  .description('Analyser un snippet de code inline')
  .action(async (code) => {
    await analyzeSnippet(code);
  });

// ── Entraînement streaming (dataset distant ou local) ──────────
program
  .command('stream-train <source>')
  .alias('st')
  .description('Entraîner le modèle depuis un dataset URL ou fichier JSON local')
  .option('-e, --epochs <n>', 'Nombre d\'epochs', parseInt, 500)
  .action(async (source, opts) => {
    try {
      await streamTrain(source, { epochs: opts.epochs });
    } catch (err) {
      console.error(chalk.red('\n  ❌ Erreur streaming :', err.message));
      process.exit(1);
    }
  });

// ── Entraînement classique (dataset.json local) ────────────────
program
  .command('train')
  .alias('t')
  .description('Entraîner le modèle sur le dataset.json local')
  .action(async () => {
    require('./src/train');
  });

// ── Auto-détection (fichier, URL, snippet) ─────────────────────
program
  .command('auto <input>')
  .description('Détecte automatiquement si c\'est une URL, un fichier ou un snippet')
  .action(async (input) => {
    await analyzeAuto(input);
  });

// ── Statut du modèle ───────────────────────────────────────────
program
  .command('status')
  .description('Vérifier l\'état du modèle entraîné')
  .action(() => {
    console.log('');
    if (modelExists()) {
      const metaPath = path.join(__dirname, 'models/js-ranker/training-meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        console.log(chalk.cyan('  ┌─ Statut du Modèle ──────────────────────────────'));
        console.log(chalk.cyan('  │') + chalk.green('  ✓ Modèle entraîné et prêt'));
        console.log(chalk.cyan('  │') + chalk.gray(`  Mode       : ${meta.mode || 'classique'}`));
        console.log(chalk.cyan('  │') + chalk.gray(`  Entraîné   : ${new Date(meta.trainedAt).toLocaleString('fr-FR')}`));
        console.log(chalk.cyan('  │') + chalk.gray(`  Samples    : ${meta.samples}`));
        console.log(chalk.cyan('  │') + chalk.gray(`  Epochs     : ${meta.epochs}`));
        console.log(chalk.cyan('  │') + chalk.gray(`  MAE finale : ${meta.finalMae ? meta.finalMae.toFixed(4) + ' pts' : 'N/A'}`));
        if (meta.elapsedSeconds) {
          console.log(chalk.cyan('  │') + chalk.gray(`  Durée      : ${meta.elapsedSeconds}s`));
        }
        if (meta.datasetSource) {
          const src = meta.datasetSource.length > 40
            ? meta.datasetSource.substring(0, 37) + '...'
            : meta.datasetSource;
          console.log(chalk.cyan('  │') + chalk.gray(`  Dataset    : ${src}`));
        }
        console.log(chalk.cyan('  └─────────────────────────────────────────────────'));
      } else {
        console.log(chalk.green('  ✓ Modèle trouvé'));
      }
    } else {
      console.log(chalk.red('  ✗ Modèle non entraîné'));
      console.log(chalk.gray('  Lancez : node index.js train'));
      console.log(chalk.gray('  Ou     : node index.js stream-train <url-dataset>'));
    }
    console.log('');
  });

// ── Raccourcis directs ─────────────────────────────────────────
// node index.js file.js  →  analyze
// node index.js https://... →  url
if (process.argv.length === 3 && !process.argv[2].startsWith('-')) {
  const arg = process.argv[2];
  if (/^https?:\/\//i.test(arg)) {
    analyzeUrl(arg).catch(err => { console.error(chalk.red('❌', err.message)); process.exit(1); });
  } else if (arg.endsWith('.js') || fs.existsSync(arg)) {
    analyzeFile(arg).catch(err => { console.error(chalk.red('❌', err.message)); process.exit(1); });
  } else {
    program.parse(process.argv);
  }
} else {
  program.parse(process.argv);
}
