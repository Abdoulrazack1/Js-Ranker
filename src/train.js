'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Script d'Entraînement v2.1      ║
 * ║     Supporte 10 features AST — architecture étendue   ║
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

function printBanner() {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('        🧠  JS-RANKER  TRAINING v2.1        ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   10 features AST — Régression ML          ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════╝'));
  console.log('');
}

function printSection(title) {
  console.log(chalk.cyan(`\n  ┌─ ${title} ${'─'.repeat(Math.max(0, 38 - title.length))}`));
}

async function train() {
  printBanner();

  // ── 1. Chargement du dataset ─────────────────────────
  printSection('Chargement du Dataset');
  const rawData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  let samples = rawData.samples;

  console.log(chalk.green(`  ✓ ${samples.length} exemples chargés (v${rawData.version || '2.0'})`));
  console.log(chalk.gray(`  ├─ Scores min/max : ${Math.min(...samples.map(s => s.score)).toFixed(1)} / ${Math.max(...samples.map(s => s.score)).toFixed(1)}`));

  // ── 2. Migration automatique si samples à 5 features ──
  const needMigration = samples.filter(s => !s.features || s.features.length !== MODEL_CONFIG.inputDim);
  if (needMigration.length > 0) {
    printSection(`Migration Features (${needMigration.length} samples)`);
    let migrated = 0;
    for (const sample of needMigration) {
      try {
        const { features } = extractFeatures(sample.code);
        sample.features = features;
        migrated++;
      } catch {
        if (Array.isArray(sample.features) && sample.features.length === 5) {
          sample.features = [...sample.features, 0.0, 0.125, 0.0, 0.0, 0.0];
          migrated++;
        }
      }
    }
    console.log(chalk.yellow(`  ⚠  ${needMigration.length} samples migrés à la volée vers 10 features`));
    console.log(chalk.gray(`  │  Conseil : lancez "node migrate-dataset.js" pour pérenniser la migration`));
  }

  // Filtre les samples valides (10 features exactement)
  samples = samples.filter(s => Array.isArray(s.features) && s.features.length === MODEL_CONFIG.inputDim);
  console.log(chalk.green(`  ✓ ${samples.length} samples valides (${MODEL_CONFIG.inputDim} features)`));

  if (rawData.stats && rawData.stats.scoreDistribution) {
    const dist = rawData.stats.scoreDistribution;
    console.log(chalk.gray(`  ├─ Excellent (4-5) : ${dist.excellent_4_5 || 0} exemples`));
    console.log(chalk.gray(`  ├─ Bon      (3-4)  : ${dist.good_3_4     || 0} exemples`));
    console.log(chalk.gray(`  ├─ Moyen    (2-3)  : ${dist.average_2_3  || 0} exemples`));
    console.log(chalk.gray(`  └─ Mauvais  (0-2)  : ${dist.poor_0_2     || 0} exemples`));
  }

  // ── 3. Préparation des tenseurs ────────────────────────
  printSection('Préparation des Tenseurs');
  const { xs, ys } = prepareTrainingData(samples);
  console.log(chalk.green(`  ✓ Tenseurs créés : xs ${JSON.stringify(xs.shape)} | ys ${JSON.stringify(ys.shape)}`));
  console.log(chalk.gray(`  └─ Features : [cyclomatique, imbrication, nommage, linéarité, modularité,`));
  console.log(chalk.gray(`                  commentRatio, returnComplexity, asyncAwait, magicNumbers, chainLength]`));

  // ── 4. Création du modèle ─────────────────────────────
  printSection('Architecture du Modèle');
  const model = createModel();
  console.log(chalk.green(`  ✓ Modèle : Dense(${MODEL_CONFIG.inputDim}→${MODEL_CONFIG.hiddenUnits}, relu) → Dropout(0.15) → Dense(${MODEL_CONFIG.hiddenUnits2}, relu) → Dense(1, linear)`));
  console.log(chalk.gray(`  ├─ Optimizer : Adam (lr=${MODEL_CONFIG.learningRate})`));
  console.log(chalk.gray(`  ├─ Loss      : Mean Squared Error`));
  console.log(chalk.gray(`  └─ Metrics   : Mean Absolute Error`));

  // ── 5. Entraînement ───────────────────────────────────
  printSection('Entraînement');
  console.log(chalk.gray(`  ${MODEL_CONFIG.epochs} epochs × batch size ${MODEL_CONFIG.batchSize}\n`));

  const progressBar = new cliProgress.SingleBar({
    format: `  Epoch {value}/{total} │{bar}│ Loss: {loss} MAE: {mae}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    barsize: 30,
  }, cliProgress.Presets.shades_classic);

  progressBar.start(MODEL_CONFIG.epochs, 0, { loss: '?.????', mae: '?.????' });

  const history = { loss: [], mae: [] };

  await model.fit(xs, ys, {
    epochs: MODEL_CONFIG.epochs,
    batchSize: MODEL_CONFIG.batchSize,
    shuffle: true,
    validationSplit: 0.15,
    verbose: 0,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        history.loss.push(logs.loss);
        history.mae.push(logs.mae);
        progressBar.update(epoch + 1, { loss: logs.loss.toFixed(4), mae: logs.mae.toFixed(4) });
      },
    },
  });

  progressBar.stop();

  // ── 6. Résultats ──────────────────────────────────────
  const finalLoss = history.loss[history.loss.length - 1];
  const finalMae  = history.mae[history.mae.length - 1];
  const minLoss   = Math.min(...history.loss);

  printSection('Résultats');
  console.log(chalk.green(`  ✓ Entraînement terminé`));
  console.log(chalk.gray(`  ├─ Loss finale  : ${chalk.white(finalLoss.toFixed(6))}`));
  console.log(chalk.gray(`  ├─ MAE finale   : ${chalk.white(finalMae.toFixed(4))} pts`));
  console.log(chalk.gray(`  └─ Loss minimum : ${chalk.white(minLoss.toFixed(6))}`));

  let qualityMsg;
  if      (finalMae < 0.3) qualityMsg = chalk.cyan('🌟 EXCELLENT — Erreur moyenne < 0.3 pts');
  else if (finalMae < 0.6) qualityMsg = chalk.green('✅ BON — Erreur moyenne < 0.6 pts');
  else if (finalMae < 1.0) qualityMsg = chalk.yellow('⚠️  ACCEPTABLE — Erreur moyenne < 1.0 pt');
  else                     qualityMsg = chalk.red('❌ À AMÉLIORER — Erreur > 1.0 pt → dataset plus grand ?');
  console.log(`\n  ${qualityMsg}`);

  // ── 7. Sauvegarde ─────────────────────────────────────
  printSection('Sauvegarde');
  fs.mkdirSync(MODEL_SAVE_PATH, { recursive: true });
  await saveModel(model, MODEL_SAVE_PATH);

  const trainingMeta = {
    trainedAt:    new Date().toISOString(),
    version:      '2.1',
    epochs:       MODEL_CONFIG.epochs,
    samples:      samples.length,
    inputDim:     MODEL_CONFIG.inputDim,
    finalLoss,
    finalMae,
    architecture: `${MODEL_CONFIG.inputDim} → Dense(${MODEL_CONFIG.hiddenUnits}, relu) → Dropout(0.15) → Dense(${MODEL_CONFIG.hiddenUnits2}, relu) → Dense(1, linear)`,
    features:     ['cyclomaticComplexity','maxNesting','namingRatio','linearity','modularity',
                   'commentRatio','returnComplexity','asyncAwait','magicNumbers','chainLength'],
  };
  fs.writeFileSync(path.join(MODEL_SAVE_PATH, 'training-meta.json'), JSON.stringify(trainingMeta, null, 2));

  console.log(chalk.green(`  ✓ Modèle sauvegardé → ${MODEL_SAVE_PATH}`));
  console.log(chalk.green(`  ✓ Méta-données sauvegardées (version 2.1)`));

  xs.dispose();
  ys.dispose();

  // ── 8. Vérification rapide ────────────────────────────
  printSection('Vérification Rapide (3 exemples)');
  const { predict } = require('./model');
  const testSamples = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]];

  for (const sample of testSamples) {
    const predicted = predict(model, sample.features);
    const diff      = Math.abs(predicted - sample.score);
    const diffColor = diff < 0.5 ? chalk.green : diff < 1.0 ? chalk.yellow : chalk.red;
    console.log(
      `  ├─ ${chalk.white((sample.id || 'sample').padEnd(16))} ` +
      `Attendu: ${chalk.cyan(sample.score.toFixed(1))} ` +
      `Prédit: ${chalk.white(predicted.toFixed(2))} ` +
      `Δ: ${diffColor(diff.toFixed(2))}`,
    );
  }

  console.log('\n  ' + chalk.cyan('━'.repeat(50)));
  console.log(`  ${chalk.white.bold('✨ Modèle v2.1 prêt')}`);
  console.log(`  ${chalk.gray('node index.js <fichier.js>  ou  node server.js')}`);
  console.log('  ' + chalk.cyan('━'.repeat(50)) + '\n');
}

train().catch(err => {
  console.error(chalk.red('\n  ❌ Erreur d\'entraînement :'), err.message);
  process.exit(1);
});
