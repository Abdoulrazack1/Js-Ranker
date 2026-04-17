'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║   JS-RANKER — Sauvegarde / Chargement de modèle       ║
 * ║   Remplace file:// de tfjs-node — fs natif pur JS     ║
 * ║                                                       ║
 * ║   Format sur disque :                                 ║
 * ║     models/js-ranker/                                 ║
 * ║       model.json     ← topologie + poids metadata     ║
 * ║       weights.bin    ← poids sérialisés               ║
 * ║       training-meta.json ← méta-données               ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const fs   = require('fs');
const path = require('path');
const tf   = require('./tf-setup');

// ── Sauvegarde ───────────────────────────────────────────────────────

/**
 * Sérialise le buffer de poids d'un modèle (ArrayBuffer ou tableau).
 * Gère les deux formats retournés selon la version de tfjs.
 *
 * @param {ArrayBuffer | ArrayBuffer[]} weightData
 * @returns {Buffer}
 * @throws {Error} si le format de weightData est inconnu
 */
function serializeWeightBuffer(weightData) {
  if (weightData instanceof ArrayBuffer) {
    return Buffer.from(weightData);
  }

  if (Array.isArray(weightData)) {
    const totalBytes = weightData.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const outputBuffer = Buffer.alloc(totalBytes);
    let writeOffset = 0;

    for (const chunk of weightData) {
      Buffer.from(chunk).copy(outputBuffer, writeOffset);
      writeOffset += chunk.byteLength;
    }

    return outputBuffer;
  }

  throw new Error('Format de poids inattendu — attendu ArrayBuffer ou ArrayBuffer[]');
}

/**
 * Construit l'objet JSON de topologie à écrire dans model.json.
 *
 * @param {object} modelArtifacts — artefacts fournis par tfjs lors de la sauvegarde
 * @returns {object}
 */
function buildModelJson(modelArtifacts) {
  return {
    modelTopology:   modelArtifacts.modelTopology,
    weightsManifest: [{ paths: ['weights.bin'], weights: modelArtifacts.weightSpecs }],
    format:          modelArtifacts.format,
    generatedBy:     modelArtifacts.generatedBy,
    convertedBy:     modelArtifacts.convertedBy,
  };
}

/**
 * Crée un handler de sauvegarde personnalisé compatible @tensorflow/tfjs pur JS.
 * Écrit model.json et weights.bin dans `savePath`.
 *
 * @param {string} savePath — dossier de destination
 * @returns {{ save: Function }} handler tfjs
 */
function createSaveHandler(savePath) {
  return {
    save: async (modelArtifacts) => {
      const modelJson    = buildModelJson(modelArtifacts);
      const weightBuffer = serializeWeightBuffer(modelArtifacts.weightData);

      fs.writeFileSync(path.join(savePath, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf-8');
      fs.writeFileSync(path.join(savePath, 'weights.bin'), weightBuffer);

      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    },
  };
}

/**
 * Sauvegarde un tf.LayersModel sur disque via fs (sans file://).
 *
 * @param {tf.LayersModel} model
 * @param {string} savePath — dossier de destination (créé si absent)
 */
async function saveModel(model, savePath) {
  fs.mkdirSync(savePath, { recursive: true });
  await model.save(createSaveHandler(savePath));
}

// ── Chargement ───────────────────────────────────────────────────────

/**
 * Construit les artefacts de chargement depuis les fichiers disque.
 *
 * @param {string} loadPath — dossier contenant model.json et weights.bin
 * @returns {object} artefacts compatibles tf.loadLayersModel
 * @throws {Error} si model.json est absent
 */
function readModelArtifacts(loadPath) {
  const jsonPath    = path.join(loadPath, 'model.json');
  const weightsPath = path.join(loadPath, 'weights.bin');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Modèle introuvable : ${jsonPath}`);
  }

  const modelJson  = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const weightData = fs.readFileSync(weightsPath);

  return {
    modelTopology: modelJson.modelTopology,
    weightSpecs:   modelJson.weightsManifest[0].weights,
    weightData:    weightData.buffer.slice(weightData.byteOffset, weightData.byteOffset + weightData.byteLength),
    format:        modelJson.format,
    generatedBy:   modelJson.generatedBy,
    convertedBy:   modelJson.convertedBy,
  };
}

/**
 * Charge un tf.LayersModel depuis disque via fs (sans file://).
 *
 * @param {string} loadPath — dossier contenant model.json + weights.bin
 * @returns {Promise<tf.LayersModel>}
 */
async function loadModel(loadPath) {
  const artifacts = readModelArtifacts(loadPath);
  const loadHandler = { load: async () => artifacts };
  return tf.loadLayersModel(loadHandler);
}

module.exports = { saveModel, loadModel };
