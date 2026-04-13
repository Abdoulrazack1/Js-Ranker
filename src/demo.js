'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Script de Démonstration         ║
 * ║   Teste le pipeline complet sans modèle sauvegardé    ║
 * ╚═══════════════════════════════════════════════════════╝
 */

const chalk = require('chalk');
const { extractFeatures } = require('./features');
const { createModel, prepareTrainingData, predict, MODEL_CONFIG } = require('./model');
const { displayResult, displayBanner } = require('./ui');
const dataset = require('../dataset.json');

async function runDemo() {
  displayBanner();

  console.log(chalk.cyan('  ─── MODE DÉMO : entraînement rapide en mémoire ───\n'));

  // 1. Entraînement rapide
  console.log(chalk.gray('  ⏳ Entraînement rapide (100 epochs)...\n'));
  const model = createModel();
  const { xs, ys } = prepareTrainingData(dataset.samples);

  await model.fit(xs, ys, {
    epochs: 100,
    batchSize: 4,
    verbose: 0,
  });
  console.log(chalk.green('  ✓ Modèle entraîné en mémoire\n'));

  // 2. Tests sur différents types de code
  const testCases = [
    {
      name: 'Fonction parfaite',
      code: `function calculateTax(price, rate) {
  return price * (1 + rate);
}`,
    },
    {
      name: 'Fonction moyenne',
      code: `function process(data1, data2, flag) {
  let result = [];
  if (flag) {
    for (let i = 0; i < data1.length; i++) {
      if (data1[i] > 0) {
        result.push(data1[i] * data2);
      }
    }
  }
  return result;
}`,
    },
    {
      name: 'Code spaghetti',
      code: `function f(a,b,c,d,e) {
  let x=0;
  for(let i=0;i<a.length;i++) {
    for(let j=0;j<b.length;j++) {
      if(a[i]>0) {
        if(b[j]>0) {
          if(c) { x+=d?a[i]*b[j]:b[j]; }
        }
      }
    }
  }
  return x*e;
}`,
    },
  ];

  console.log(chalk.cyan('  ─── Résultats d\'analyse ───\n'));

  for (const testCase of testCases) {
    try {
      const { features, details } = extractFeatures(testCase.code);
      const score = predict(model, features);
      displayResult(score, details, testCase.name);
      await new Promise(r => setTimeout(r, 500)); // Pause pour lisibilité
    } catch (err) {
      console.error(chalk.red(`  Erreur sur "${testCase.name}": ${err.message}`));
    }
  }

  xs.dispose();
  ys.dispose();
}

runDemo().catch(err => {
  console.error(chalk.red('Erreur démo:'), err.message);
  process.exit(1);
});
