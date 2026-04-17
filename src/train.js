'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Script d'Entraînement           ║
 * ║     16 features AST — Architecture 16→48→24→12→1      ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const tf = require('./tf-setup');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const cliProgress = require('cli-progress');

const { createModel, prepareTrainingData, saveModel, MODEL_CONFIG } = require('./model');
const { extractFeatures } = require('./features');

const DATASET_PATH    = path.join(__dirname, '../dataset.json');
const MODEL_SAVE_PATH = path.join(__dirname, '../models/js-ranker');

// ── Bannières ────────────────────────────────────────────────────────

function printBanner() {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('      🧠  JS-RANKER  TRAINING v4.0          ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   16 features AST — 16→48→24→12→1         ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════╝'));
  console.log('');
}

function printSection(title) {
  const pad = Math.max(0, 38 - title.length);
  console.log(chalk.cyan(`\n  ┌─ ${title} ${'─'.repeat(pad)}`));
}

// ── Chargement & validation du dataset ──────────────────────────────

/**
 * Charge le dataset depuis le disque et retourne les samples bruts.
 *
 * @param {string} datasetPath — chemin vers dataset.json
 * @returns {{ samples: object[], version: string }}
 */
function loadDataset(datasetPath) {
  const rawData = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  return { samples: rawData.samples, version: rawData.version || '1.0', stats: rawData.stats };
}

/**
 * Affiche les statistiques de distribution des scores dans la console.
 *
 * @param {object} stats — objet stats issu du dataset
 */
function printScoreDistribution(stats) {
  if (!stats?.scoreDistribution) return;
  const dist = stats.scoreDistribution;
  console.log(chalk.gray(`  ├─ Excellent (4-5) : ${dist.excellent_4_5 || 0} exemples`));
  console.log(chalk.gray(`  ├─ Bon      (3-4)  : ${dist.good_3_4     || 0} exemples`));
  console.log(chalk.gray(`  ├─ Moyen    (2-3)  : ${dist.average_2_3  || 0} exemples`));
  console.log(chalk.gray(`  └─ Mauvais  (0-2)  : ${dist.poor_0_2     || 0} exemples`));
}

// ── Migration des features ───────────────────────────────────────────

/**
 * Tente de re-calculer les features d'un sample depuis son code source.
 * Fallback sur un vecteur paddé si le parsing échoue.
 *
 * @param {object} sample — sample avec .code ou .features
 * @returns {number[] | null} vecteur de features ou null si irrécupérable
 */
function recomputeFeaturesForSample(sample) {
  if (sample.code) {
    try {
      const { features } = extractFeatures(sample.code);
      return features;
    } catch {
      // Pas de code parsable → on pad l'ancien vecteur
    }
  }
  if (Array.isArray(sample.features) && sample.features.length < MODEL_CONFIG.inputDim) {
    const padded = [...sample.features];
    while (padded.length < MODEL_CONFIG.inputDim) padded.push(0.0);
    return padded;
  }
  return null;
}

/**
 * Migre les samples qui n'ont pas encore le bon nombre de features.
 * Modifie le tableau de samples en place.
 *
 * @param {object[]} samples
 * @returns {number} nombre de samples migrés
 */
function migrateOutdatedSamples(samples) {
  const outdated = samples.filter(s => !s.features || s.features.length !== MODEL_CONFIG.inputDim);
  let migratedCount = 0;

  for (const sample of outdated) {
    const newFeatures = recomputeFeaturesForSample(sample);
    if (newFeatures) {
      sample.features = newFeatures;
      migratedCount++;
    }
  }

  return migratedCount;
}

// ── Boucle d'entraînement ────────────────────────────────────────────

/**
 * Lance l'entraînement du modèle avec barre de progression.
 * Retourne les historiques de loss et MAE par epoch.
 *
 * @param {tf.LayersModel} model
 * @param {tf.Tensor2D} xs
 * @param {tf.Tensor2D} ys
 * @param {object} config — { epochs, batchSize }
 * @returns {{ loss: number[], mae: number[] }}
 */
async function runTrainingLoop(model, xs, ys, config) {
  const history = { loss: [], mae: [] };
  const { epochs, batchSize } = config;

  const bar = new cliProgress.SingleBar({
    format: `  Epoch {value}/{total} │{bar}│ Loss: {loss} MAE: {mae}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    barsize: 30,
  }, cliProgress.Presets.shades_classic);

  bar.start(epochs, 0, { loss: '?.????', mae: '?.????' });

  await model.fit(xs, ys, {
    epochs,
    batchSize,
    shuffle: true,
    validationSplit: 0.15,
    verbose: 0,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        history.loss.push(logs.loss);
        history.mae.push(logs.mae);
        bar.update(epoch + 1, { loss: logs.loss.toFixed(4), mae: logs.mae.toFixed(4) });
      },
    },
  });

  bar.stop();
  return history;
}

// ── Verdict de qualité ───────────────────────────────────────────────

/**
 * Retourne un message coloré selon la MAE finale obtenue.
 *
 * @param {number} finalMae
 * @returns {string} message chalk
 */
function buildQualityVerdict(finalMae) {
  if (finalMae < 0.25) return chalk.cyan('🌟 EXCELLENT — Erreur moyenne < 0.25 pts');
  if (finalMae < 0.5)  return chalk.green('✅ BON — Erreur moyenne < 0.5 pts');
  if (finalMae < 0.8)  return chalk.yellow('⚠️  ACCEPTABLE — Erreur moyenne < 0.8 pt');
  return chalk.red('❌ À AMÉLIORER — MAE > 0.8 → enrichir le dataset ?');
}

// ── Sauvegarde des artefacts ─────────────────────────────────────────

/**
 * Sauvegarde le modèle entraîné et ses méta-données sur disque.
 *
 * @param {tf.LayersModel} model
 * @param {string} savePath
 * @param {object} trainingMeta — infos d'entraînement à persister
 */
async function saveTrainingArtifacts(model, savePath, trainingMeta) {
  fs.mkdirSync(savePath, { recursive: true });
  await saveModel(model, savePath);
  fs.writeFileSync(
    path.join(savePath, 'training-meta.json'),
    JSON.stringify(trainingMeta, null, 2)
  );
}

// ── Vérification rapide post-entraînement ────────────────────────────

/**
 * Prédit 3 exemples représentatifs et affiche la comparaison attendu/prédit.
 *
 * @param {tf.LayersModel} model
 * @param {object[]} samples
 */
function verifyQuickPredictions(model, samples) {
  const { predict } = require('./model');
  const indices = [0, Math.floor(samples.length / 2), samples.length - 1];
  const testSamples = indices.map(i => samples[i]);

  for (const sample of testSamples) {
    const predicted = predict(model, sample.features);
    const delta     = Math.abs(predicted - sample.score);
    const deltaColor = delta < 0.5 ? chalk.green : delta < 1.0 ? chalk.yellow : chalk.red;

    console.log(
      `  ├─ ${chalk.white((sample.id || 'sample').padEnd(16))} ` +
      `Attendu: ${chalk.cyan(sample.score.toFixed(1))} ` +
      `Prédit: ${chalk.white(predicted.toFixed(2))} ` +
      `Δ: ${deltaColor(delta.toFixed(2))}`
    );
  }
}

// ── Pipeline d'entraînement principal ───────────────────────────────

/**
 * Orchestre le pipeline complet d'entraînement :
 * chargement → migration → tenseurs → modèle → fit → sauvegarde → vérification.
 */
async function train() {
  printBanner();

  // 1. Chargement
  printSection('Chargement du Dataset');
  const { samples: rawSamples, version, stats } = loadDataset(DATASET_PATH);
  const scores = rawSamples.map(s => s.score);
  console.log(chalk.green(`  ✓ ${rawSamples.length} exemples chargés (v${version})`));
  console.log(chalk.gray(`  ├─ Scores min/max : ${Math.min(...scores).toFixed(1)} / ${Math.max(...scores).toFixed(1)}`));
  printScoreDistribution(stats);

  // 2. Migration
  const outdatedCount = rawSamples.filter(s => !s.features || s.features.length !== MODEL_CONFIG.inputDim).length;
  if (outdatedCount > 0) {
    printSection(`Migration Features (${outdatedCount} samples)`);
    const migrated = migrateOutdatedSamples(rawSamples);
    console.log(chalk.yellow(`  ⚠  ${migrated} samples migrés vers ${MODEL_CONFIG.inputDim} features`));
    console.log(chalk.gray(`  │  Conseil : lancez "node migrate-dataset.js" pour pérenniser`));
  }

  const samples = rawSamples.filter(s => Array.isArray(s.features) && s.features.length === MODEL_CONFIG.inputDim);
  console.log(chalk.green(`  ✓ ${samples.length} samples valides (${MODEL_CONFIG.inputDim} features)`));

  // 3. Tenseurs
  printSection('Préparation des Tenseurs');
  const { xs, ys } = prepareTrainingData(samples);
  console.log(chalk.green(`  ✓ xs ${JSON.stringify(xs.shape)} | ys ${JSON.stringify(ys.shape)}`));

  // 4. Modèle
  printSection('Architecture du Modèle');
  const model = createModel();
  const arch  = `${MODEL_CONFIG.inputDim}→Dense(${MODEL_CONFIG.hiddenUnits})→Drop→Dense(${MODEL_CONFIG.hiddenUnits2})→Drop→Dense(${MODEL_CONFIG.hiddenUnits3})→Dense(1,sigmoid)`;
  console.log(chalk.green(`  ✓ ${arch}`));
  console.log(chalk.gray(`  ├─ Optimizer : Adam (lr=${MODEL_CONFIG.learningRate})`));
  console.log(chalk.gray(`  └─ L2 régularisation sur couches denses`));

  // 5. Entraînement
  printSection('Entraînement');
  console.log(chalk.gray(`  ${MODEL_CONFIG.epochs} epochs × batch ${MODEL_CONFIG.batchSize}\n`));
  const history = await runTrainingLoop(model, xs, ys, MODEL_CONFIG);

  // 6. Résultats
  const finalLoss = history.loss[history.loss.length - 1];
  const finalMae  = history.mae[history.mae.length - 1];
  const minLoss   = Math.min(...history.loss);

  printSection('Résultats');
  console.log(chalk.green(`  ✓ Entraînement terminé`));
  console.log(chalk.gray(`  ├─ Loss finale  : ${chalk.white(finalLoss.toFixed(6))}`));
  console.log(chalk.gray(`  ├─ MAE finale   : ${chalk.white(finalMae.toFixed(4))} pts`));
  console.log(chalk.gray(`  └─ Loss minimum : ${chalk.white(minLoss.toFixed(6))}`));
  console.log(`\n  ${buildQualityVerdict(finalMae)}`);

  // 7. Sauvegarde
  printSection('Sauvegarde');
  const trainingMeta = {
    trainedAt:    new Date().toISOString(),
    version:      '4.0',
    epochs:       MODEL_CONFIG.epochs,
    samples:      samples.length,
    inputDim:     MODEL_CONFIG.inputDim,
    finalLoss,
    finalMae,
    architecture: arch,
    features: [
      'cyclomaticComplexity', 'maxNesting',     'namingRatio',       'linearity',
      'modularity',           'commentRatio',   'returnComplexity',  'asyncAwait',
      'magicNumbers',         'chainLength',    'modernSyntax',      'constVsVar',
      'errorHandling',        'functionLength', 'purityScore',       'singleResponsibility',
    ],
  };
  await saveTrainingArtifacts(model, MODEL_SAVE_PATH, trainingMeta);
  console.log(chalk.green(`  ✓ Modèle sauvegardé → ${MODEL_SAVE_PATH}`));

  xs.dispose();
  ys.dispose();

  // 8. Vérification
  printSection('Vérification Rapide (3 exemples)');
  verifyQuickPredictions(model, samples);

  console.log('\n  ' + chalk.cyan('━'.repeat(50)));
  console.log(`  ${chalk.white.bold('✨ Modèle v4.0 prêt — 16 features AST')}`);
  console.log(`  ${chalk.gray('node index.js <fichier.js>  ou  node server.js')}`);
  console.log('  ' + chalk.cyan('━'.repeat(50)) + '\n');
}

train().catch(err => {
  console.error(chalk.red('\n  ❌ Erreur d\'entraînement :'), err.message);
  process.exit(1);
});
