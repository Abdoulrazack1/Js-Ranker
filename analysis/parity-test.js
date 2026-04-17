'use strict';

/**
 * Parity test — compare features.cleaned.js à l'original src/features.js
 * sur un échantillon de code représentatif.
 *
 * Prouve que le cleaning (suppression du banner, des JSDoc dupliqués
 * et des descriptions verbeuses) n'a touché à aucune logique.
 *
 * Usage : node analysis/parity-test.js
 */

const original = require('../src/features');
const cleaned  = require('./features.cleaned');

const samples = [
  {
    label: 'trivial add',
    code:  'function add(a, b) { return a + b; }',
  },
  {
    label: 'loop with branch',
    code: `function processItems(items) {
      const result = [];
      for (const item of items) {
        if (item.active) {
          result.push(item.value * 2);
        }
      }
      return result;
    }`,
  },
  {
    label: 'async with try/catch',
    code: `async function fetchData(url) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (err) {
        console.error('fetch failed', err);
        throw err;
      }
    }`,
  },
  {
    label: 'class with methods',
    code: `class Queue {
      constructor() { this.items = []; }
      enqueue(x) { this.items.push(x); return this; }
      dequeue() { return this.items.shift(); }
      get size() { return this.items.length; }
    }`,
  },
  {
    label: 'nested callbacks',
    code: `function deeplyNested(data) {
      if (data) {
        for (const item of data) {
          if (item.valid) {
            for (const sub of item.subs) {
              if (sub.active) { console.log(sub); }
            }
          }
        }
      }
    }`,
  },
];

let passed = 0;
let failed = 0;

for (const sample of samples) {
  const a = original.extractFeatures(sample.code);
  const b = cleaned.extractFeatures(sample.code);

  const sameFeatures = JSON.stringify(a.features) === JSON.stringify(b.features);
  const sameDetails  = JSON.stringify(a.details)  === JSON.stringify(b.details);

  if (sameFeatures && sameDetails) {
    console.log(`  OK   ${sample.label}`);
    passed++;
  } else {
    console.log(`  FAIL ${sample.label}`);
    if (!sameFeatures) {
      console.log(`       original features : ${JSON.stringify(a.features)}`);
      console.log(`       cleaned  features : ${JSON.stringify(b.features)}`);
    }
    failed++;
  }
}

console.log(`\n  ${passed}/${passed + failed} passed — ${failed === 0 ? 'semantics preserved' : 'DIVERGENCE'}`);
process.exit(failed === 0 ? 0 : 1);
