'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Streaming Trainer                        ║
 * ║   Entraîne sur dataset distant sans écrire sur disque,       ║
 * ║   avec courbe de loss ASCII en temps réel.                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const path = require('path');
const fs   = require('fs');
const chalk = require('chalk');

const { createModel, prepareTrainingData, saveModel, MODEL_CONFIG } = require('./model');
const { fetchDataset }    = require('./fetcher');
const { extractFeatures } = require('./features');

// ── Configuration streaming ──────────────────────────────────────────

const STREAM_CONFIG = {
  epochs:          500,
  batchSize:       32,
  learningRate:    0.01,
  validationSplit: 0.1,
  curveWidth:      58,
  curveHeight:     10,
  renderInterval:  5,   // Rafraîchissement de la courbe toutes les N epochs
};

// ── Courbe de Loss ASCII ─────────────────────────────────────────────

/**
 * Rend la courbe de loss dans la console avec effacement de ligne ANSI.
 * Échantillonne les pertes pour tenir dans `width` colonnes.
 *
 * @param {object} state — { losses, maes, width, height, rendered }
 * @param {number} epoch — epoch courante (1-based)
 * @param {number} totalEpochs
 * @param {number} startTime — Date.now() au début de l'entraînement
 */
function renderLossCurve(state, epoch, totalEpochs, startTime) {
  if (state.losses.length < 2) return;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const grid    = buildLossGrid(state.losses, state.width, state.height);

  if (state.rendered) {
    process.stdout.write(`\x1B[${state.height + 5}A`);
  }
  state.rendered = true;

  printCurveHeader(epoch, totalEpochs, elapsed, state);
  printCurveGrid(grid, state.losses, state.width, state.height, epoch);
}

/**
 * Construit la grille caractère par caractère à partir des valeurs de loss.
 *
 * @param {number[]} losses
 * @param {number} width
 * @param {number} height
 * @returns {string[][]} grille de caractères
 */
function buildLossGrid(losses, width, height) {
  const step    = Math.max(1, Math.floor(losses.length / width));
  const sampled = losses.filter((_, i) => i % step === 0);
  const maxLoss = Math.max(...sampled);
  const minLoss = Math.min(...sampled);
  const range   = maxLoss - minLoss || 1;

  const grid = Array.from({ length: height }, () => new Array(sampled.length).fill(' '));

  for (let col = 0; col < sampled.length; col++) {
    const normalized = (sampled[col] - minLoss) / range;
    const row = height - 1 - Math.round(normalized * (height - 1));
    grid[row][col] = '▄';
    for (let r = row + 1; r < height; r++) grid[r][col] = '█';
  }

  return grid;
}

/**
 * Affiche l'en-tête de la courbe (barre de progression + stats).
 *
 * @param {number} epoch
 * @param {number} totalEpochs
 * @param {string} elapsed
 * @param {object} state
 */
function printCurveHeader(epoch, totalEpochs, elapsed, state) {
  const pct      = ((epoch / totalEpochs) * 100).toFixed(0);
  const fillSize = Math.round(state.width * epoch / totalEpochs);
  const bar      = chalk.cyan('█'.repeat(fillSize)) + chalk.gray('░'.repeat(state.width - fillSize));
  const lastLoss = state.losses[state.losses.length - 1].toFixed(6);
  const lastMae  = state.maes[state.maes.length - 1].toFixed(4);

  process.stdout.write('\n');
  process.stdout.write(`  ${chalk.white.bold('Progression')}  ${bar}  ${chalk.white(pct + '%')}\n`);
  process.stdout.write(`  ${chalk.gray(`Epoch ${epoch}/${totalEpochs}  │  Loss: ${lastLoss}  │  MAE: ${lastMae}  │  ${elapsed}s`)}\n\n`);
}

/**
 * Affiche la grille ASCII de la courbe avec les labels min/max.
 *
 * @param {string[][]} grid
 * @param {number[]} losses
 * @param {number} width
 * @param {number} height
 * @param {number} epoch
 */
function printCurveGrid(grid, losses, width, height, epoch) {
  const maxLoss = Math.max(...losses).toFixed(3);
  const minLoss = Math.min(...losses).toFixed(3);
  const cols    = grid[0].length;

  for (let row = 0; row < height; row++) {
    const prefix = row === 0
      ? chalk.gray(`${maxLoss} ┐`.padStart(10))
      : row === height - 1
        ? chalk.gray(`${minLoss} ┘`.padStart(10))
        : '          ';

    const line = grid[row].map(ch => {
      if (ch === '█') return chalk.cyan('█');
      if (ch === '▄') return chalk.white('▄');
      return chalk.gray('·');
    }).join('');

    process.stdout.write(`  ${prefix} ${line}\n`);
  }

  process.stdout.write(`  ${' '.repeat(11)} ${'└' + '─'.repeat(cols)}\n`);
  process.stdout.write(`  ${' '.repeat(12)} ${chalk.gray('Epoch 1')}${' '.repeat(Math.max(0, cols - 14))}${chalk.gray(`Epoch ${epoch}`)}\n`);
}

// ── Préparation des samples ──────────────────────────────────────────

/**
 * Prépare les samples en recalculant les features depuis le code source si disponible.
 * Filtre les samples invalides (features manquantes ou mauvaise dimension).
 *
 * @param {object[]} rawSamples
 * @returns {{ prepared: object[], recomputed: number, usedRaw: number }}
 */
function prepareSamplesFromDatapool(rawSamples) {
  const prepared = [];
  let recomputed = 0;
  let usedRaw = 0;

  for (const sample of rawSamples) {
    const features = resolveSampleFeatures(sample);
    if (!features) continue;

    const isRecomputed = sample.code && sample.code.trim().length > 10;
    if (isRecomputed) recomputed++;
    else usedRaw++;

    prepared.push({ features, score: sample.score });
  }

  return { prepared, recomputed, usedRaw };
}

/**
 * Résout le vecteur de features d'un sample.
 * Priorité : recalcul live depuis code > features JSON existantes.
 *
 * @param {object} sample
 * @returns {number[] | null}
 */
function resolveSampleFeatures(sample) {
  if (sample.code && sample.code.trim().length > 10) {
    try {
      const { features } = extractFeatures(sample.code);
      return features;
    } catch {
      // Fallback sur features JSON si code non parsable
    }
  }

  if (Array.isArray(sample.features) && sample.features.length === MODEL_CONFIG.inputDim) {
    return sample.features;
  }

  return null; // Sample invalide → ignoré
}

// ── Chargement du dataset ────────────────────────────────────────────

/**
 * Charge le dataset depuis une URL distante ou un fichier local.
 *
 * @param {string} datasetSource — URL ou chemin de fichier
 * @returns {Promise<object>} dataset brut avec .samples
 */
async function loadDatasetFromSource(datasetSource) {
  if (/^https?:\/\//i.test(datasetSource.trim())) {
    return fetchDataset(datasetSource);
  }

  const rawJson = fs.readFileSync(path.resolve(datasetSource), 'utf-8');
  const parsed  = JSON.parse(rawJson);
  if (!Array.isArray(parsed.samples)) {
    throw new Error('Format invalide : le fichier doit contenir un tableau "samples"');
  }
  return parsed;
}

// ── Pipeline d'entraînement streaming ───────────────────────────────

/**
 * Pipeline complet de streaming-training :
 * chargement → features → tenseurs → modèle → fit → sauvegarde.
 *
 * @param {string} datasetSource — URL ou chemin vers le dataset
 * @param {object} [options] — { savePath?, epochs?, silent? }
 * @returns {Promise<{ finalLoss, finalMae, elapsed, samples }>}
 */
async function streamTrain(datasetSource, options = {}) {
  const {
    savePath = path.join(__dirname, '../models/js-ranker'),
    epochs   = STREAM_CONFIG.epochs,
    silent   = false,
  } = options;

  const log = (...args) => { if (!silent) console.log(...args); };
  const isUrl = /^https?:\/\//i.test(datasetSource.trim());

  log('');
  log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  log(chalk.cyan('  ║') + chalk.white.bold('      🚀  JS-RANKER — STREAMING TRAINER v2        ') + chalk.cyan('║'));
  log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  log('');

  // 1. Chargement
  log(chalk.cyan('  ┌─ Chargement du dataset ──────────────────────────'));
  log(chalk.gray(`  │  Source : ${chalk.white(isUrl ? 'URL distante' : 'Fichier local')}`));
  const rawDataset = await loadDatasetFromSource(datasetSource);
  log(chalk.green(`  │  ✓ ${rawDataset.samples.length} samples bruts chargés`));

  // 2. Features
  log(chalk.cyan('  ├─ Préparation des features ───────────────────────'));
  const { prepared, recomputed, usedRaw } = prepareSamplesFromDatapool(rawDataset.samples);
  if (prepared.length === 0) throw new Error('Aucun sample valide après préparation');
  log(chalk.green(`  │  ✓ ${prepared.length} samples valides (${MODEL_CONFIG.inputDim} features chacun)`));
  log(chalk.gray(`  │    Recalculées AST live : ${chalk.white(recomputed)} — JSON brutes : ${chalk.white(usedRaw)}`));

  // 3. Tenseurs
  const { xs, ys } = prepareTrainingData(prepared);
  log(chalk.green(`  │  ✓ Tenseurs TF : xs${JSON.stringify(xs.shape)} ys${JSON.stringify(ys.shape)}`));

  // 4. Architecture
  log(chalk.cyan('  ├─ Architecture ───────────────────────────────────'));
  const model = createModel(STREAM_CONFIG.learningRate);
  const archSummary = `${MODEL_CONFIG.inputDim}→Dense(${MODEL_CONFIG.hiddenUnits})→Dropout→Dense(${MODEL_CONFIG.hiddenUnits2})→Dropout→Dense(${MODEL_CONFIG.hiddenUnits3})→Dense(1,sigmoid)`;
  log(chalk.gray(`  │  ${archSummary}`));

  // 5. Entraînement avec courbe ASCII
  log(chalk.cyan('  ├─ Entraînement ────────────────────────────────────'));
  log('');

  const curveState = { losses: [], maes: [], width: STREAM_CONFIG.curveWidth, height: STREAM_CONFIG.curveHeight, rendered: false };
  const startTime  = Date.now();

  await model.fit(xs, ys, {
    epochs,
    batchSize:       STREAM_CONFIG.batchSize,
    shuffle:         true,
    validationSplit: STREAM_CONFIG.validationSplit,
    verbose:         0,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        curveState.losses.push(logs.loss);
        curveState.maes.push(logs.mae);
        if (epoch % STREAM_CONFIG.renderInterval === 0 || epoch === epochs - 1) {
          renderLossCurve(curveState, epoch + 1, epochs, startTime);
        }
      },
    },
  });

  const elapsed  = ((Date.now() - startTime) / 1000).toFixed(2);
  const finalLoss = curveState.losses[curveState.losses.length - 1];
  const finalMae  = curveState.maes[curveState.maes.length - 1];

  // 6. Résultats & sauvegarde
  log('');
  log(chalk.cyan('  ├─ Résultats ───────────────────────────────────────'));
  log(chalk.green(`  │  ✓ Terminé en ${chalk.white.bold(elapsed + 's')}`));
  log(chalk.gray(`  │  Loss : ${chalk.white(finalLoss.toFixed(6))} — MAE : ${chalk.white(finalMae.toFixed(4))} pts`));

  fs.mkdirSync(savePath, { recursive: true });
  await saveModel(model, savePath);

  const trainingMeta = {
    trainedAt:     new Date().toISOString(),
    mode:          'streaming',
    datasetSource: isUrl ? datasetSource : path.basename(datasetSource),
    epochs,
    samples:       prepared.length,
    samplesRecomputed: recomputed,
    inputDim:      MODEL_CONFIG.inputDim,
    elapsedSeconds: parseFloat(elapsed),
    finalLoss,
    finalMae,
    architecture:  archSummary,
  };
  fs.writeFileSync(path.join(savePath, 'training-meta.json'), JSON.stringify(trainingMeta, null, 2));
  log(chalk.green(`  │  ✓ Modèle sauvegardé → ${savePath}`));

  xs.dispose();
  ys.dispose();

  log('');
  log('  ' + chalk.cyan('━'.repeat(50)));
  log(`  ${chalk.white.bold('✨ Modèle streaming v2 prêt — 16 features AST')}`);
  log('  ' + chalk.cyan('━'.repeat(50)) + '\n');

  return { finalLoss, finalMae, elapsed, samples: prepared.length };
}

module.exports = { streamTrain, STREAM_CONFIG };
