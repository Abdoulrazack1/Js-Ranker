'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Streaming Trainer                        ║
 * ║   Entraîne sur dataset distant sans écrire sur disque,       ║
 * ║   avec courbe de loss en temps réel dans la console.         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Objectif : < 10 secondes sur CPU pour 500+ epochs.
 * Stratégie :
 *   - Dataset chargé en RAM depuis URL (via fetcher)
 *   - Features re-calculées en live si code présent (sinon features brutes)
 *   - Entraînement avec batch maximal pour minimiser les overhead JS
 *   - Courbe ASCII de loss dessinée sur une ligne fixe (ANSI escape codes)
 */

const path = require('path');
const fs   = require('fs');
const chalk = require('chalk');

const { createModel, prepareTrainingData, saveModel, MODEL_CONFIG } = require('./model');
const { fetchDataset }   = require('./fetcher');
const { extractFeatures } = require('./features');

// ─────────────────────────────────────────────────────────────────
//  Config optimisée pour vitesse < 10s sur CPU
// ─────────────────────────────────────────────────────────────────
const STREAM_CONFIG = {
  epochs:       500,    // Plus d'epochs → meilleure convergence
  batchSize:    32,     // Batch large → moins d'overhead par epoch
  learningRate: 0.02,   // LR légèrement plus élevé pour converger vite
  validationSplit: 0.1, // 10% validation
};

// ─────────────────────────────────────────────────────────────────
//  Courbe de Loss ASCII — Dessin en temps réel
// ─────────────────────────────────────────────────────────────────
class LossCurve {
  constructor(width = 60, height = 12) {
    this.width  = width;
    this.height = height;
    this.losses = [];
    this.maes   = [];
    this.rendered = false;
  }

  push(loss, mae) {
    this.losses.push(loss);
    this.maes.push(mae);
  }

  /**
   * Dessine la courbe dans la console en remontant et réécrivant les lignes.
   * Utilise les ANSI escape codes pour éviter le scroll.
   */
  render(epoch, totalEpochs, startTime) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const losses  = this.losses;
    if (losses.length < 2) return;

    // Sous-échantillonnage si trop de points
    const step    = Math.max(1, Math.floor(losses.length / this.width));
    const sampled = losses.filter((_, i) => i % step === 0);

    const maxLoss = Math.max(...sampled);
    const minLoss = Math.min(...sampled);
    const range   = maxLoss - minLoss || 1;

    // Construit la grille caractère par caractère
    const grid = Array.from({ length: this.height }, () => new Array(sampled.length).fill(' '));

    for (let col = 0; col < sampled.length; col++) {
      const normalized = (sampled[col] - minLoss) / range;
      const row = this.height - 1 - Math.round(normalized * (this.height - 1));
      grid[row][col] = '▄';
      // Colonne sous le point = remplie
      for (let r = row + 1; r < this.height; r++) grid[r][col] = '█';
    }

    // Efface les lignes précédentes si déjà affichées
    if (this.rendered) {
      process.stdout.write(`\x1B[${this.height + 5}A`); // Remonte N lignes
    }
    this.rendered = true;

    // Titre
    const pct  = ((epoch / totalEpochs) * 100).toFixed(0);
    const fill = Math.round(this.width * epoch / totalEpochs);
    const bar  = chalk.cyan('█'.repeat(fill)) + chalk.gray('░'.repeat(this.width - fill));

    process.stdout.write(`\n`);
    process.stdout.write(`  ${chalk.white.bold('Progression')}  ${bar}  ${chalk.white(pct + '%')}\n`);
    process.stdout.write(`  ${chalk.gray(`Epoch ${epoch}/${totalEpochs}  │  Loss: ${losses[losses.length-1].toFixed(6)}  │  MAE: ${this.maes[this.maes.length-1].toFixed(4)}  │  ${elapsed}s`)}\n\n`);

    // Grille de la courbe
    const lossRange = `${maxLoss.toFixed(3)} ┐`;
    const lossFloor = `${minLoss.toFixed(3)} ┘`;

    for (let row = 0; row < this.height; row++) {
      const prefix = row === 0
        ? chalk.gray(lossRange.padStart(10))
        : row === this.height - 1
          ? chalk.gray(lossFloor.padStart(10))
          : '          ';

      const line = grid[row].map(ch => {
        if (ch === '█') return chalk.cyan('█');
        if (ch === '▄') return chalk.white('▄');
        return chalk.gray('·');
      }).join('');

      process.stdout.write(`  ${prefix} ${line}\n`);
    }

    process.stdout.write(`  ${' '.repeat(11)} ${'└' + '─'.repeat(sampled.length)}\n`);
    process.stdout.write(`  ${' '.repeat(12)} ${chalk.gray('Epoch 1')}${' '.repeat(Math.max(0, sampled.length - 14))}${chalk.gray(`Epoch ${epoch}`)}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────
//  Préparation du dataset avec recalcul des features si code présent
// ─────────────────────────────────────────────────────────────────
function prepareSamplesFromDatapool(samples) {
  const prepared = [];
  let recomputed = 0;
  let usedRaw = 0;

  for (const sample of samples) {
    let features = sample.features;

    // Si le sample contient du code source → recalcul des features en live
    if (sample.code && sample.code.trim().length > 10) {
      try {
        const { features: liveFeatures } = extractFeatures(sample.code);
        features = liveFeatures;
        recomputed++;
      } catch {
        // Fallback sur les features JSON si le parsing échoue
        if (!Array.isArray(features) || features.length !== 5) continue;
        usedRaw++;
      }
    } else if (!Array.isArray(features) || features.length !== 5) {
      continue; // Sample invalide → skip
    } else {
      usedRaw++;
    }

    prepared.push({ features, score: sample.score });
  }

  return { prepared, recomputed, usedRaw };
}

// ─────────────────────────────────────────────────────────────────
//  Pipeline d'entraînement en streaming
// ─────────────────────────────────────────────────────────────────
async function streamTrain(datasetSource, options = {}) {
  const {
    savePath = path.join(__dirname, '../models/js-ranker'),
    epochs   = STREAM_CONFIG.epochs,
    silent   = false,
  } = options;

  const log = (...args) => { if (!silent) console.log(...args); };

  log('');
  log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  log(chalk.cyan('  ║') + chalk.white.bold('      🚀  JS-RANKER — STREAMING TRAINER           ') + chalk.cyan('║'));
  log(chalk.cyan('  ║') + chalk.gray('   Entraînement in-memory, dataset distant/local  ') + chalk.cyan('║'));
  log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  log('');

  const tf = require('./tf-setup');

  // ── 1. Chargement du dataset (URL ou chemin local)
  log(chalk.cyan('  ┌─ Chargement du dataset ──────────────────────────'));

  let rawDataset;
  const isUrl = /^https?:\/\//i.test(datasetSource.trim());

  if (isUrl) {
    log(chalk.gray(`  │  Source : ${chalk.white('URL distante')}`));
    log(chalk.gray(`  │  URL    : ${datasetSource.substring(0, 60)}...`));
    rawDataset = await fetchDataset(datasetSource);
  } else {
    log(chalk.gray(`  │  Source : ${chalk.white('Fichier local')}`));
    const rawJson = fs.readFileSync(path.resolve(datasetSource), 'utf-8');
    rawDataset = JSON.parse(rawJson);
    if (!Array.isArray(rawDataset.samples)) {
      throw new Error('Format invalide : fichier doit contenir un tableau "samples"');
    }
  }

  const totalRaw = rawDataset.samples.length;
  log(chalk.green(`  │  ✓ ${totalRaw} samples bruts chargés en mémoire`));

  // ── 2. Préparation des features (recalcul live si code présent)
  log(chalk.cyan('  ├─ Préparation des features ───────────────────────'));

  const { prepared, recomputed, usedRaw } = prepareSamplesFromDatapool(rawDataset.samples);

  if (prepared.length === 0) {
    throw new Error('Aucun sample valide après préparation');
  }

  log(chalk.green(`  │  ✓ ${prepared.length} samples valides`));
  log(chalk.gray(`  │    Features recalculées (AST live) : ${chalk.white(recomputed)}`));
  log(chalk.gray(`  │    Features JSON utilisées (brutes) : ${chalk.white(usedRaw)}`));

  // ── 3. Création des tenseurs TF en RAM
  const { xs, ys } = prepareTrainingData(prepared);
  log(chalk.green(`  │  ✓ Tenseurs TF : xs${JSON.stringify(xs.shape)} ys${JSON.stringify(ys.shape)}`));

  // ── 4. Architecture du modèle (config optimisée vitesse)
  log(chalk.cyan('  ├─ Architecture & Optimiseur ──────────────────────'));

  const model = createModel(STREAM_CONFIG.learningRate);
  log(chalk.gray(`  │  Modèle    : 5 → Dense(12, relu) → Dropout(0.1) → Dense(1, linear)`));
  log(chalk.gray(`  │  Optimizer : Adam lr=${STREAM_CONFIG.learningRate}`));
  log(chalk.gray(`  │  Epochs    : ${epochs}   BatchSize : ${STREAM_CONFIG.batchSize}`));

  // ── 5. Entraînement avec courbe en temps réel
  log(chalk.cyan('  ├─ Entraînement ────────────────────────────────────'));
  log('');

  const curve    = new LossCurve(58, 10);
  const startTime = Date.now();

  await model.fit(xs, ys, {
    epochs,
    batchSize: STREAM_CONFIG.batchSize,
    shuffle: true,
    validationSplit: STREAM_CONFIG.validationSplit,
    verbose: 0,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        curve.push(logs.loss, logs.mae);
        // Mise à jour toutes les 5 epochs pour ne pas ralentir l'entraînement
        if (epoch % 5 === 0 || epoch === epochs - 1) {
          curve.render(epoch + 1, epochs, startTime);
        }
      },
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // ── 6. Résultats finaux
  const finalLoss = curve.losses[curve.losses.length - 1];
  const finalMae  = curve.maes[curve.maes.length - 1];
  const minLoss   = Math.min(...curve.losses);

  log('');
  log(chalk.cyan('  ├─ Résultats ───────────────────────────────────────'));
  log(chalk.green(`  │  ✓ Entraînement terminé en ${chalk.white.bold(elapsed + 's')}`));
  log(chalk.gray(`  │  Loss finale  : ${chalk.white(finalLoss.toFixed(6))}`));
  log(chalk.gray(`  │  MAE finale   : ${chalk.white(finalMae.toFixed(4))} pts`));
  log(chalk.gray(`  │  Loss min.    : ${chalk.white(minLoss.toFixed(6))}`));

  // Verdict de qualité
  let verdict;
  if (finalMae < 0.25)      verdict = chalk.cyan(`  🌟 EXCELLENT  — MAE ${finalMae.toFixed(3)} pts`);
  else if (finalMae < 0.5)  verdict = chalk.green(`  ✅ BON         — MAE ${finalMae.toFixed(3)} pts`);
  else if (finalMae < 0.8)  verdict = chalk.yellow(`  ⚠️  ACCEPTABLE — MAE ${finalMae.toFixed(3)} pts`);
  else                      verdict = chalk.red(`  ❌ À AMÉLIORER — MAE ${finalMae.toFixed(3)} pts`);

  log(`\n  ${verdict}`);

  // ── 7. Sauvegarde
  log('');
  log(chalk.cyan('  ├─ Sauvegarde ──────────────────────────────────────'));
  fs.mkdirSync(savePath, { recursive: true });
  await saveModel(model, savePath);

  const meta = {
    trainedAt:    new Date().toISOString(),
    mode:         'streaming',
    datasetSource: isUrl ? datasetSource : path.basename(datasetSource),
    epochs,
    samples:      prepared.length,
    samplesRecomputed: recomputed,
    elapsedSeconds: parseFloat(elapsed),
    finalLoss,
    finalMae,
    architecture: '5 → Dense(12, relu) → Dropout(0.1) → Dense(1, linear)',
  };
  fs.writeFileSync(path.join(savePath, 'training-meta.json'), JSON.stringify(meta, null, 2));

  log(chalk.green(`  │  ✓ Modèle sauvegardé → ${savePath}`));

  // Nettoyage tenseurs
  xs.dispose();
  ys.dispose();

  log('');
  log('  ' + chalk.cyan('━'.repeat(50)));
  log(`  ${chalk.white.bold('✨ Modèle streaming prêt — Analyse URL maintenant possible')}`);
  log('  ' + chalk.cyan('━'.repeat(50)));
  log('');

  return { finalLoss, finalMae, elapsed, samples: prepared.length };
}

module.exports = { streamTrain, STREAM_CONFIG };
