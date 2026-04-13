'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Script d'Entraînement           ║
 * ║     Lance l'apprentissage & sauvegarde le modèle      ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const tf = require('./tf-setup');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const cliProgress = require('cli-progress');

const { createModel, prepareTrainingData, saveModel, MODEL_CONFIG } = require('./model');

// ─────────────────────────────────────────────────────────
//  Chemins
// ─────────────────────────────────────────────────────────
const DATASET_PATH = path.join(__dirname, '../dataset.json');
const MODEL_SAVE_PATH = path.join(__dirname, '../models/js-ranker');

// ─────────────────────────────────────────────────────────
//  Utilitaires d'affichage
// ─────────────────────────────────────────────────────────
function printBanner() {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('        🧠  JS-RANKER  TRAINING MODE        ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   Régression ML sur métriques AST JS      ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════╝'));
  console.log('');
}

function printSection(title) {
  console.log(chalk.cyan(`\n  ┌─ ${title} ${'─'.repeat(Math.max(0, 38 - title.length))}`));
}

// ─────────────────────────────────────────────────────────
//  Pipeline d'entraînement principal
// ─────────────────────────────────────────────────────────
async function train() {
  printBanner();

  // 1. Chargement du dataset
  printSection('Chargement du Dataset');
  const rawData = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  const samples = rawData.samples;

  console.log(chalk.green(`  ✓ ${samples.length} exemples chargés`));
  console.log(chalk.gray(`  ├─ Scores min/max : ${Math.min(...samples.map(s => s.score))} / ${Math.max(...samples.map(s => s.score))}`));

  // Distribution des scores
  const dist = rawData.stats.scoreDistribution;
  console.log(chalk.gray(`  ├─ Excellent (4-5) : ${dist.excellent_4_5} exemples`));
  console.log(chalk.gray(`  ├─ Bon      (3-4)  : ${dist.good_3_4} exemples`));
  console.log(chalk.gray(`  ├─ Moyen    (2-3)  : ${dist.average_2_3} exemples`));
  console.log(chalk.gray(`  └─ Mauvais  (0-2)  : ${dist.poor_0_2} exemples`));

  // 2. Préparation des tenseurs
  printSection('Préparation des Tenseurs');
  const { xs, ys } = prepareTrainingData(samples);
  console.log(chalk.green(`  ✓ Tenseurs créés : xs ${xs.shape} | ys ${ys.shape}`));
  console.log(chalk.gray(`  └─ Features : [cyclomatique, imbrication, nommage, linéarité, modularité]`));

  // 3. Création du modèle
  printSection('Architecture du Modèle');
  const model = createModel();
  console.log(chalk.green(`  ✓ Modèle créé : Dense(5→${MODEL_CONFIG.hiddenUnits}, relu) → Dropout(0.1) → Dense(1, linear)`));
  console.log(chalk.gray(`  ├─ Optimizer : Adam (lr=${MODEL_CONFIG.learningRate})`));
  console.log(chalk.gray(`  ├─ Loss      : Mean Squared Error`));
  console.log(chalk.gray(`  └─ Metrics   : Mean Absolute Error`));

  // 4. Entraînement avec barre de progression
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
        progressBar.update(epoch + 1, {
          loss: logs.loss.toFixed(4),
          mae: logs.mae.toFixed(4),
        });
      }
    }
  });

  progressBar.stop();

  // 5. Résultats de l'entraînement
  const finalLoss = history.loss[history.loss.length - 1];
  const finalMae  = history.mae[history.mae.length - 1];
  const minLoss   = Math.min(...history.loss);

  printSection('Résultats');
  console.log(chalk.green(`  ✓ Entraînement terminé`));
  console.log(chalk.gray(`  ├─ Loss finale  : ${chalk.white(finalLoss.toFixed(6))}`));
  console.log(chalk.gray(`  ├─ MAE finale   : ${chalk.white(finalMae.toFixed(4))} pts`));
  console.log(chalk.gray(`  └─ Loss minimum : ${chalk.white(minLoss.toFixed(6))}`));

  // Évaluation qualitative de la MAE
  let qualityMsg;
  if (finalMae < 0.3)      qualityMsg = chalk.cyan('🌟 EXCELLENT — Erreur moyenne < 0.3 pts');
  else if (finalMae < 0.6) qualityMsg = chalk.green('✅ BON — Erreur moyenne < 0.6 pts');
  else if (finalMae < 1.0) qualityMsg = chalk.yellow('⚠️  ACCEPTABLE — Erreur moyenne < 1.0 pt');
  else                     qualityMsg = chalk.red('❌ À AMÉLIORER — Erreur moyenne > 1.0 pt');

  console.log(`\n  ${qualityMsg}`);

  // 6. Sauvegarde du modèle
  printSection('Sauvegarde');
  fs.mkdirSync(MODEL_SAVE_PATH, { recursive: true });
  await saveModel(model, MODEL_SAVE_PATH);

  // Sauvegarde des méta-données d'entraînement
  const trainingMeta = {
    trainedAt: new Date().toISOString(),
    epochs: MODEL_CONFIG.epochs,
    samples: samples.length,
    finalLoss,
    finalMae,
    architecture: '5 → Dense(12, relu) → Dropout(0.1) → Dense(1, linear)',
  };
  fs.writeFileSync(
    path.join(MODEL_SAVE_PATH, 'training-meta.json'),
    JSON.stringify(trainingMeta, null, 2)
  );

  console.log(chalk.green(`  ✓ Modèle sauvegardé → ${MODEL_SAVE_PATH}`));
  console.log(chalk.green(`  ✓ Méta-données d'entraînement sauvegardées`));

  // Nettoyage des tenseurs
  xs.dispose();
  ys.dispose();

  // 7. Test rapide sur les données d'entraînement
  printSection('Vérification Rapide (3 exemples)');
  const { predict } = require('./model');
  const testSamples = [samples[0], samples[8], samples[13]]; // perfect, average, bad

  for (const sample of testSamples) {
    const predicted = predict(model, sample.features);
    const diff = Math.abs(predicted - sample.score);
    const diffColor = diff < 0.5 ? chalk.green : diff < 1.0 ? chalk.yellow : chalk.red;
    console.log(
      `  ├─ ${chalk.white(sample.id.padEnd(16))} ` +
      `Attendu: ${chalk.cyan(sample.score.toFixed(1))} ` +
      `Prédit: ${chalk.white(predicted.toFixed(2))} ` +
      `Δ: ${diffColor(diff.toFixed(2))}`
    );
  }

  console.log('\n  ' + chalk.cyan('━'.repeat(44)));
  console.log(`  ${chalk.white.bold('✨ Modèle prêt — Lancez : node index.js <fichier.js>')}`);
  console.log('  ' + chalk.cyan('━'.repeat(44)) + '\n');
}

// ─────────────────────────────────────────────────────────
//  Lancement
// ─────────────────────────────────────────────────────────
train().catch(err => {
  console.error(chalk.red('\n  ❌ Erreur d\'entraînement :'), err.message);
  process.exit(1);
});
