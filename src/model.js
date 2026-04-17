'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Modèle TensorFlow.js              ║
 * ║   Réseau de neurones : 16 → 48 → 24 → 12 → 1          ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Architecture pour 16 features de qualité JS :
 *   Input  : 16 features normalisées [0..1]
 *   H1     : Dense(48, relu) — largeur suffisante pour capturer interactions
 *   Drop1  : Dropout(0.20) — régularisation pour éviter overfitting
 *   H2     : Dense(24, relu) — couche intermédiaire de compression
 *   Drop2  : Dropout(0.10) — régularisation légère
 *   H3     : Dense(12, relu) — extraction de patterns de haut niveau
 *   Output : Dense(1, sigmoid) × 5.0 → score [0..5] borné nativement
 */

const tf = require('./tf-setup');
const { saveModel, loadModel } = require('./model-io');

// ── Configuration du modèle ──────────────────────────────────────────

/** Nombre total de features extraites par features.js (v3). */
const INPUT_DIM = 16;

const MODEL_CONFIG = {
  inputDim:     INPUT_DIM,
  hiddenUnits:  48,   // Couche principale — largeur pour 16 inputs
  hiddenUnits2: 24,   // Couche intermédiaire
  hiddenUnits3: 12,   // Couche de synthèse
  learningRate: 0.005,
  epochs:       500,
  batchSize:    4,    // Petit batch pour bien apprendre sur dataset réduit
};

// ── Architecture du modèle ───────────────────────────────────────────

/**
 * Crée et compile le modèle de régression séquentiel.
 * Output sigmoid × 5 garantit des prédictions dans [0.0, 5.0].
 *
 * @param {number} [customLr] — taux d'apprentissage optionnel
 * @returns {tf.Sequential}
 */
function createModel(customLr) {
  const learningRate = customLr || MODEL_CONFIG.learningRate;

  const model = tf.sequential({ name: 'JSRanker-v4' });

  model.add(tf.layers.dense({
    units: MODEL_CONFIG.hiddenUnits,
    inputShape: [MODEL_CONFIG.inputDim],
    activation: 'relu',
    kernelInitializer: 'heNormal',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
    name: 'hidden_1',
  }));

  model.add(tf.layers.dropout({ rate: 0.20, name: 'dropout_1' }));

  model.add(tf.layers.dense({
    units: MODEL_CONFIG.hiddenUnits2,
    activation: 'relu',
    kernelInitializer: 'heNormal',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
    name: 'hidden_2',
  }));

  model.add(tf.layers.dropout({ rate: 0.10, name: 'dropout_2' }));

  model.add(tf.layers.dense({
    units: MODEL_CONFIG.hiddenUnits3,
    activation: 'relu',
    kernelInitializer: 'heNormal',
    name: 'hidden_3',
  }));

  model.add(tf.layers.dense({
    units: 1,
    activation: 'sigmoid',
    name: 'output',
  }));

  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  return model;
}

// ── Préparation des données ──────────────────────────────────────────

/**
 * Valide qu'un sample possède le bon nombre de features.
 *
 * @param {object} sample
 * @returns {boolean}
 */
function isValidSample(sample) {
  return Array.isArray(sample.features) && sample.features.length === MODEL_CONFIG.inputDim;
}

/**
 * Prépare les tenseurs d'entraînement depuis les samples du dataset.
 * Les scores [0..5] sont normalisés en [0..1] pour correspondre au sigmoid.
 *
 * @param {object[]} samples — liste de { features: number[], score: number }
 * @returns {{ xs: tf.Tensor2D, ys: tf.Tensor2D }}
 * @throws {Error} si aucun sample valide
 */
function prepareTrainingData(samples) {
  const validSamples = samples.filter(isValidSample);

  if (validSamples.length === 0) {
    throw new Error(`Aucun sample avec ${MODEL_CONFIG.inputDim} features valides`);
  }

  if (validSamples.length < samples.length) {
    const skipped = samples.length - validSamples.length;
    console.warn(`  ⚠ ${skipped} samples ignorés (features.length ≠ ${MODEL_CONFIG.inputDim})`);
  }

  const xs = tf.tensor2d(validSamples.map(s => s.features));
  const ys = tf.tensor2d(validSamples.map(s => [s.score / 5.0])); // Normalise [0..5] → [0..1]
  return { xs, ys };
}

// ── Prédiction ──────────────────────────────────────────────────────

/**
 * Clampe un score brut dans [0.0, 5.0] avec 2 décimales.
 *
 * @param {number} rawScore
 * @returns {number}
 */
function clampScore(rawScore) {
  return Math.min(5.0, Math.max(0.0, parseFloat(rawScore.toFixed(2))));
}

/**
 * Prédit le score d'un vecteur de 16 features.
 * La sortie sigmoid est dé-normalisée × 5 pour revenir à l'échelle [0..5].
 *
 * @param {tf.LayersModel} model
 * @param {number[]} features — vecteur de longueur 16
 * @returns {number} score dans [0.0, 5.0]
 * @throws {Error} si features.length ≠ 16
 */
function predict(model, features) {
  if (features.length !== MODEL_CONFIG.inputDim) {
    throw new Error(`predict() attend ${MODEL_CONFIG.inputDim} features, reçu ${features.length}`);
  }

  return tf.tidy(() => {
    const inputTensor  = tf.tensor2d([features]);
    const outputTensor = model.predict(inputTensor);
    const rawValue     = outputTensor.dataSync()[0];
    return clampScore(rawValue * 5.0); // Dé-normalise sigmoid → [0..5]
  });
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = {
  createModel,
  prepareTrainingData,
  predict,
  clampScore,
  isValidSample,
  saveModel,
  loadModel,
  MODEL_CONFIG,
};
