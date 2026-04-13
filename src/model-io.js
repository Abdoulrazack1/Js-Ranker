'use strict';

/**
 * JS-RANKER — Sauvegarde / Chargement de modèle (fs natif)
 * Remplace file:// de tfjs-node, compatible @tensorflow/tfjs pur JS.
 *
 * Format sur disque :
 *   models/js-ranker/
 *     model.json          ← topologie JSON (getConfig + poids metadata)
 *     weights.bin         ← poids sérialisés (ArrayBuffer → Buffer)
 *     training-meta.json  ← méta-données d'entraînement
 */

const fs   = require('fs');
const path = require('path');
const tf   = require('./tf-setup');

// ─────────────────────────────────────────────────────────────────
//  SAUVEGARDE
// ─────────────────────────────────────────────────────────────────

/**
 * Sauvegarde un tf.LayersModel sur disque via fs (sans file://).
 * @param {tf.LayersModel} model
 * @param {string} savePath  — dossier de destination (créé si absent)
 */
async function saveModel(model, savePath) {
  fs.mkdirSync(savePath, { recursive: true });

  // Handler personnalisé compatible @tensorflow/tfjs pur JS
  const saveHandler = {
    save: async (modelArtifacts) => {
      // 1. Topologie JSON
      const modelJson = {
        modelTopology: modelArtifacts.modelTopology,
        weightsManifest: [{
          paths: ['weights.bin'],
          weights: modelArtifacts.weightSpecs,
        }],
        format:         modelArtifacts.format,
        generatedBy:    modelArtifacts.generatedBy,
        convertedBy:    modelArtifacts.convertedBy,
      };
      fs.writeFileSync(
        path.join(savePath, 'model.json'),
        JSON.stringify(modelJson, null, 2),
        'utf-8'
      );

      // 2. Poids binaires
      // weightData peut être un ArrayBuffer ou un tableau d'ArrayBuffer
      let weightBuffer;
      if (modelArtifacts.weightData instanceof ArrayBuffer) {
        weightBuffer = Buffer.from(modelArtifacts.weightData);
      } else if (Array.isArray(modelArtifacts.weightData)) {
        // Concatener tous les ArrayBuffer
        const totalLen = modelArtifacts.weightData.reduce((s, ab) => s + ab.byteLength, 0);
        weightBuffer = Buffer.alloc(totalLen);
        let offset = 0;
        for (const ab of modelArtifacts.weightData) {
          Buffer.from(ab).copy(weightBuffer, offset);
          offset += ab.byteLength;
        }
      } else {
        throw new Error('Format de poids inattendu');
      }

      fs.writeFileSync(path.join(savePath, 'weights.bin'), weightBuffer);

      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    }
  };

  await model.save(saveHandler);
}

// ─────────────────────────────────────────────────────────────────
//  CHARGEMENT
// ─────────────────────────────────────────────────────────────────

/**
 * Charge un tf.LayersModel depuis disque via fs (sans file://).
 * @param {string} loadPath  — dossier contenant model.json + weights.bin
 * @returns {Promise<tf.LayersModel>}
 */
async function loadModel(loadPath) {
  const modelJsonPath  = path.join(loadPath, 'model.json');
  const weightsBinPath = path.join(loadPath, 'weights.bin');

  if (!fs.existsSync(modelJsonPath)) {
    throw new Error(`Modèle introuvable : ${modelJsonPath}`);
  }

  const modelJson   = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));
  const weightData  = fs.readFileSync(weightsBinPath);

  // Handler de chargement personnalisé
  const loadHandler = {
    load: async () => {
      return {
        modelTopology:   modelJson.modelTopology,
        weightSpecs:     modelJson.weightsManifest[0].weights,
        weightData:      weightData.buffer.slice(
                           weightData.byteOffset,
                           weightData.byteOffset + weightData.byteLength
                         ),
        format:          modelJson.format,
        generatedBy:     modelJson.generatedBy,
        convertedBy:     modelJson.convertedBy,
      };
    }
  };

  return tf.loadLayersModel(loadHandler);
}

module.exports = { saveModel, loadModel };
