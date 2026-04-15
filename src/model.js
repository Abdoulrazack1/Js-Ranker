'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Modèle TensorFlow.js              ║
 * ║   Réseau de neurones séquentiel : 10 → 16 → 8 → 1    ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Architecture étendue pour supporter 10 features :
 *   Input  : 10 features normalisées
 *   Hidden : Dense(16, relu) + Dropout(0.15)
 *   Hidden : Dense(8, relu)
 *   Output : Dense(1, linear) → clampé [0, 5]
 */

const tf = require('./tf-setup');
const { saveModel, loadModel } = require('./model-io');

const MODEL_CONFIG = {
  inputDim:    10,      // 5 features originales + 5 nouvelles
  hiddenUnits: 16,      // couche principale (élargie pour 10 inputs)
  hiddenUnits2: 8,      // 2e couche cachée
  learningRate: 0.01,
  epochs: 300,
  batchSize: 8,
};

/**
 * Crée et compile le modèle de régression.
 * @param {number} [customLr] — learning rate optionnel
 */
function createModel(customLr) {
  const lr = customLr || MODEL_CONFIG.learningRate;

  const model = tf.sequential({
    name: 'JSRanker-v3',
    layers: [
      tf.layers.dense({
        units: MODEL_CONFIG.hiddenUnits,
        inputShape: [MODEL_CONFIG.inputDim],
        activation: 'relu',
        kernelInitializer: 'heNormal',
        name: 'hidden_layer_1',
      }),
      tf.layers.dropout({ rate: 0.15, name: 'dropout_1' }),
      tf.layers.dense({
        units: MODEL_CONFIG.hiddenUnits2,
        activation: 'relu',
        kernelInitializer: 'heNormal',
        name: 'hidden_layer_2',
      }),
      tf.layers.dense({
        units: 1,
        activation: 'linear',
        name: 'output_layer',
      }),
    ],
  });

  model.compile({
    optimizer: tf.train.adam(lr),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  return model;
}

/**
 * Prépare les tenseurs depuis le dataset.
 * Vérifie que chaque sample a bien 10 features.
 */
function prepareTrainingData(samples) {
  const valid = samples.filter(s => Array.isArray(s.features) && s.features.length === MODEL_CONFIG.inputDim);
  if (valid.length === 0) throw new Error(`Aucun sample avec ${MODEL_CONFIG.inputDim} features valides`);
  if (valid.length < samples.length) {
    console.warn(`  ⚠ ${samples.length - valid.length} samples ignorés (features.length ≠ ${MODEL_CONFIG.inputDim})`);
  }
  const xs = tf.tensor2d(valid.map(s => s.features));
  const ys = tf.tensor2d(valid.map(s => [s.score]));
  return { xs, ys };
}

/**
 * Clampe le score brut entre 0.0 et 5.0.
 */
function clampScore(rawScore) {
  return Math.min(5.0, Math.max(0.0, parseFloat(rawScore.toFixed(2))));
}

/**
 * Prédit le score d'un vecteur de features (doit avoir 10 valeurs).
 */
function predict(model, features) {
  if (features.length !== MODEL_CONFIG.inputDim) {
    throw new Error(`predict() attend ${MODEL_CONFIG.inputDim} features, reçu ${features.length}`);
  }
  return tf.tidy(() => {
    const input  = tf.tensor2d([features]);
    const output = model.predict(input);
    return clampScore(output.dataSync()[0]);
  });
}

module.exports = {
  createModel,
  prepareTrainingData,
  predict,
  clampScore,
  saveModel,
  loadModel,
  MODEL_CONFIG,
};
