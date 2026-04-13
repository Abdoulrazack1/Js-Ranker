'use strict';
/**
 * JS-RANKER — Initialisation TensorFlow.js (CPU pur JS)
 * Compatible Node.js v18, v20, v22, v24 — Windows / Mac / Linux
 * Aucune compilation, aucune dépendance native.
 */

// Supprime le message "install tfjs-node" de TensorFlow (non pertinent ici)
const _origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  if (typeof chunk === 'string' && chunk.includes('tfjs-node for more details')) return true;
  return _origStderr(chunk, ...args);
};

require('@tensorflow/tfjs-backend-cpu');
const tf = require('@tensorflow/tfjs');

// Pré-initialise le backend CPU
let _ready = false;
tf.setBackend('cpu').then(() => tf.ready()).then(() => { _ready = true; });

module.exports = tf;
