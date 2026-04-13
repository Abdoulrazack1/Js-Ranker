'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Modèle TensorFlow.js              ║
 * ║   Réseau de neurones séquentiel : 5 → 12 → 1          ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const tf = require('./tf-setup');
const { saveModel, loadModel } = require('./model-io');

const MODEL_CONFIG = {
  inputDim:    5,
  hiddenUnits: 12,
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
    name: 'JSRanker-v2',
    layers: [
      tf.layers.dense({
        units: MODEL_CONFIG.hiddenUnits,
        inputShape: [MODEL_CONFIG.inputDim],
        activation: 'relu',
        kernelInitializer: 'heNormal',
        name: 'hidden_layer',
      }),
      tf.layers.dropout({ rate: 0.1, name: 'dropout' }),
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
 */
function prepareTrainingData(samples) {
  const xs = tf.tensor2d(samples.map(s => s.features));
  const ys = tf.tensor2d(samples.map(s => [s.score]));
  return { xs, ys };
}

/**
 * Clampe le score brut entre 0.0 et 5.0.
 */
function clampScore(rawScore) {
  return Math.min(5.0, Math.max(0.0, parseFloat(rawScore.toFixed(2))));
}

/**
 * Prédit le score d'un vecteur de features.
 * tf.tidy() libère automatiquement les tenseurs intermédiaires.
 */
function predict(model, features) {
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
