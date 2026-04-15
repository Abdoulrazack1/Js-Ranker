#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║        JS-RANKER — Générateur de Dataset via GitHub API          ║
 * ║                                                                  ║
 * ║   Collecte des milliers de fonctions JS réelles depuis GitHub,   ║
 * ║   calcule leurs features AST et génère un dataset d'entraînement ║
 * ║                                                                  ║
 * ║   Usage :                                                        ║
 * ║     node generate-dataset.js                                     ║
 * ║     node generate-dataset.js --max 2000 --out dataset-large.json ║
 * ║     node generate-dataset.js --token ghp_xxx --max 5000          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const { extractFeatures } = require('./src/features');

// ── CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const MAX_SAMPLES  = parseInt(getArg('--max', '1000'), 10);
const OUTPUT_FILE  = getArg('--out', 'dataset-large.json');
const GITHUB_TOKEN = getArg('--token', process.env.GITHUB_TOKEN || '');
const VERBOSE      = args.includes('--verbose');

// ── Palette de repos JS populaires & variés ────────────────────────
// Organisé par catégorie de qualité attendue pour équilibrer le dataset
const REPO_TARGETS = [
  // Libs utilitaires — haute qualité attendue
  { repo: 'lodash/lodash',         path: 'src',      ext: '.js' },
  { repo: 'ramda/ramda',           path: 'src',      ext: '.js' },
  { repo: 'date-fns/date-fns',     path: 'src',      ext: '.js' },

  // Frameworks / outils — qualité variable
  { repo: 'expressjs/express',     path: 'lib',      ext: '.js' },
  { repo: 'chalk/chalk',           path: 'source',   ext: '.js' },
  { repo: 'sindresorhus/got',      path: 'source',   ext: '.js' },

  // Projets plus anciens / legacy — qualité mixte à basse
  { repo: 'jquery/jquery',         path: 'src',      ext: '.js' },
  { repo: 'jashkenas/underscore',  path: 'modules',  ext: '.js' },

  // Algorithmes pédagogiques — scores très étalés
  { repo: 'TheAlgorithms/JavaScript', path: 'Data-Structures', ext: '.js' },
  { repo: 'trekhleb/javascript-algorithms', path: 'src', ext: '.js' },
];

// ── Helpers HTTP ───────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'js-ranker-dataset-generator',
      'Accept':     'application/vnd.github+json',
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error on ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'js-ranker-dataset-generator' };
    if (GITHUB_TOKEN && url.includes('api.github.com'))
      headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

    https.get(url, { headers }, (res) => {
      // Suit les redirects (raw.githubusercontent.com)
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Extraction des fonctions depuis un fichier JS source ──────────
const acorn     = require('acorn');
const acornWalk = require('acorn-walk');

function extractFunctionsFromSource(source, fileId) {
  let ast;
  try {
    try {
      ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module' });
    } catch {
      ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script' });
    }
  } catch {
    return [];
  }

  const functions = [];
  const lines = source.split('\n');

  const visitor = {
    FunctionDeclaration(node) { push(node, 'declaration'); },
    FunctionExpression(node)  { push(node, 'expression'); },
    ArrowFunctionExpression(node) {
      // Garde seulement les arrow functions avec body en bloc (pas les one-liners triviaux)
      if (node.body.type === 'BlockStatement' || node.body.type !== 'BlockStatement') {
        push(node, 'arrow');
      }
    },
  };

  function push(node, kind) {
    const start = node.start;
    const end   = node.end;
    const code  = source.slice(start, end);

    // Filtre : min 2 lignes, max 80 lignes, pas de code minifié
    const codeLines = code.split('\n').length;
    if (codeLines < 2 || codeLines > 80) return;

    // Détecte le code minifié (lignes très longues)
    const avgLineLen = code.length / codeLines;
    if (avgLineLen > 120) return;

    // Récupère le nom si dispo
    let name = '(anonymous)';
    if (node.id && node.id.name)            name = node.id.name;
    else if (node.type === 'FunctionExpression') name = '(expr)';

    functions.push({ code, name, kind, lines: codeLines, fileId });
  }

  try { acornWalk.simple(ast, visitor); } catch { /* ignore */ }

  return functions;
}

// ── Scoring automatique basé sur les features ─────────────────────
// Reproduit la logique de qualité du projet
function autoScore(features, code) {
  const [cyclo, nesting, naming, linearity, modularity] = features;

  // Score de base pondéré
  let score =
    (1 - cyclo)     * 1.5 +   // complexité basse = bien
    (1 - nesting)   * 1.2 +   // imbrication basse = bien
    naming          * 1.0 +   // bon nommage = bien
    linearity       * 0.8 +   // code lisible (ni trop dense ni trop dilué)
    modularity      * 0.5;    // peu d'arguments = bien

  // Normalise sur 0–5
  const maxPossible = 1.5 + 1.2 + 1.0 + 0.8 + 0.5;
  score = (score / maxPossible) * 5.0;

  // Malus si le code contient des patterns mauvais
  if (/\bvar\b/.test(code))             score -= 0.15;
  if (/[a-z]{1,2}\s*=\s*function/i.test(code)) score -= 0.1;
  if (code.match(/\beval\b/))           score -= 0.5;

  // Bonus si code contient des patterns modernes
  if (code.includes('=>'))              score += 0.1;
  if (code.includes('const ') || code.includes('let ')) score += 0.05;
  if (/\bawait\b/.test(code))           score += 0.1;

  return Math.max(0.0, Math.min(5.0, parseFloat(score.toFixed(2))));
}

function scoreToVerdict(score) {
  if (score >= 4.5) return 'ELEGANT';
  if (score >= 3.5) return 'ROBUST';
  if (score >= 2.0) return 'MESSY';
  return 'CRITICAL';
}

// ── Listage des fichiers JS dans un repo via GitHub API ───────────
async function listJsFiles(repo, dirPath) {
  const url = `https://api.github.com/repos/${repo}/contents/${dirPath}`;
  try {
    const items = await fetchJson(url);
    if (!Array.isArray(items)) return [];

    const files = [];
    for (const item of items) {
      if (item.type === 'file' && item.name.endsWith('.js') && !item.name.includes('.min.')) {
        files.push({ name: item.name, download_url: item.download_url, path: item.path });
      }
      // Explore 1 niveau de sous-dossier seulement
      if (item.type === 'dir' && files.length < 30) {
        try {
          const sub = await fetchJson(`https://api.github.com/repos/${repo}/contents/${item.path}`);
          if (Array.isArray(sub)) {
            for (const subItem of sub) {
              if (subItem.type === 'file' && subItem.name.endsWith('.js') && !subItem.name.includes('.min.')) {
                files.push({ name: subItem.name, download_url: subItem.download_url, path: subItem.path });
              }
            }
          }
        } catch { /* ignore sous-dossiers inaccessibles */ }
      }
    }
    return files;
  } catch { return []; }
}

// ── GitHub Search API pour trouver des repos JS ───────────────────
async function searchGithubRepos(query, page = 1) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10&page=${page}`;
  try {
    const res = await fetchJson(url);
    return (res.items || []).map(r => ({
      repo: r.full_name,
      path: '',
      ext:  '.js',
    }));
  } catch { return []; }
}

// ── Barre de progression console ──────────────────────────────────
function progressBar(current, total, label = '') {
  const width = 40;
  const filled = Math.round((current / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pct = ((current / total) * 100).toFixed(0).padStart(3);
  process.stdout.write(`\r  [${bar}] ${pct}%  ${label.padEnd(50)}`);
}

// ── Pipeline principal ─────────────────────────────────────────────
async function generateDataset() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║    🔬  JS-RANKER — Générateur de Dataset Massif      ║');
  console.log('  ║    Source : GitHub API  (repos JS populaires)        ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Cible         : ${MAX_SAMPLES} samples`);
  console.log(`  Fichier sortie: ${OUTPUT_FILE}`);
  console.log(`  Token GitHub  : ${GITHUB_TOKEN ? '✓ fourni (rate limit élevé)' : '✗ absent (60 req/h max)'}`);
  console.log('');

  // ── 1. Collecte de repos supplémentaires via Search API ──────────
  console.log('  ┌─ Recherche de repos JS sur GitHub ─────────────────');
  const searchQueries = [
    'language:javascript utility functions stars:>500',
    'language:javascript algorithm stars:>200',
    'language:javascript helper library stars:>300',
  ];

  const allRepos = [...REPO_TARGETS];
  for (const q of searchQueries) {
    const found = await searchGithubRepos(q);
    allRepos.push(...found.slice(0, 3));
    await sleep(300);
  }

  console.log(`  │  ${allRepos.length} repos en file`);
  console.log('  └─────────────────────────────────────────────────────');
  console.log('');

  const samples     = [];
  const seen        = new Set();
  let   totalFiles  = 0;
  let   skipped     = 0;
  let   repoIndex   = 0;

  console.log('  ┌─ Collecte des fonctions ────────────────────────────');

  for (const target of allRepos) {
    if (samples.length >= MAX_SAMPLES) break;

    repoIndex++;
    const label = `${target.repo} (${samples.length}/${MAX_SAMPLES})`;
    progressBar(samples.length, MAX_SAMPLES, label);

    // Liste les fichiers JS du repo
    const files = await listJsFiles(target.repo, target.path);
    if (VERBOSE) console.log(`\n  │  ${target.repo}: ${files.length} fichiers JS`);

    for (const file of files) {
      if (samples.length >= MAX_SAMPLES) break;
      if (!file.download_url) continue;

      try {
        await sleep(GITHUB_TOKEN ? 50 : 200); // Rate limit

        const source = await fetchText(file.download_url);
        totalFiles++;

        const fileId = `${target.repo}/${file.path}`;
        const fns    = extractFunctionsFromSource(source, fileId);

        for (const fn of fns) {
          if (samples.length >= MAX_SAMPLES) break;

          // Déduplique (hash simplifié = premiers 100 chars normalisés)
          const key = fn.code.slice(0, 100).replace(/\s+/g, '');
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);

          // Calcule les features AST
          let features;
          try {
            const result = extractFeatures(fn.code);
            features = result.features;
          } catch { skipped++; continue; }

          // Auto-scoring
          const score   = autoScore(features, fn.code);
          const verdict = scoreToVerdict(score);

          const id = `gen_${String(samples.length + 1).padStart(5, '0')}`;
          samples.push({
            id,
            label:   `${fn.kind} ${fn.name} — ${fn.lines} lignes`,
            score,
            code:    fn.code,
            features,
            verdict,
            meta: {
              source:  fileId,
              name:    fn.name,
              kind:    fn.kind,
              lines:   fn.lines,
            }
          });
        }
      } catch (err) {
        if (VERBOSE) console.log(`\n  │  ⚠ Erreur ${file.name}: ${err.message}`);
        skipped++;
      }
    }

    await sleep(100);
  }

  progressBar(samples.length, MAX_SAMPLES, `Terminé (${samples.length} samples)`);
  console.log('');
  console.log('  └─────────────────────────────────────────────────────');
  console.log('');

  // ── 2. Statistiques du dataset ───────────────────────────────────
  const byVerdict = { ELEGANT: 0, ROBUST: 0, MESSY: 0, CRITICAL: 0 };
  let   totalScore = 0;
  for (const s of samples) {
    byVerdict[s.verdict] = (byVerdict[s.verdict] || 0) + 1;
    totalScore += s.score;
  }

  console.log('  ┌─ Statistiques du dataset ──────────────────────────');
  console.log(`  │  Total samples     : ${samples.length}`);
  console.log(`  │  Fichiers traités  : ${totalFiles}`);
  console.log(`  │  Samples ignorés   : ${skipped}`);
  console.log(`  │  Score moyen       : ${(totalScore / samples.length).toFixed(2)} / 5`);
  console.log(`  │`);
  console.log(`  │  Distribution :`);
  console.log(`  │    ELEGANT  (≥4.5) : ${byVerdict.ELEGANT}  (${((byVerdict.ELEGANT / samples.length) * 100).toFixed(1)}%)`);
  console.log(`  │    ROBUST   (≥3.5) : ${byVerdict.ROBUST}   (${((byVerdict.ROBUST  / samples.length) * 100).toFixed(1)}%)`);
  console.log(`  │    MESSY    (≥2.0) : ${byVerdict.MESSY}    (${((byVerdict.MESSY   / samples.length) * 100).toFixed(1)}%)`);
  console.log(`  │    CRITICAL (<2.0) : ${byVerdict.CRITICAL} (${((byVerdict.CRITICAL/ samples.length) * 100).toFixed(1)}%)`);
  console.log('  └─────────────────────────────────────────────────────');
  console.log('');

  // ── 3. Sauvegarde ─────────────────────────────────────────────────
  const dataset = {
    version:     '2.0',
    description: `JS-Ranker Large Dataset — ${samples.length} fonctions JS réelles depuis GitHub`,
    generatedAt: new Date().toISOString(),
    schema: {
      features: ['cyclomaticComplexity', 'maxNesting', 'namingRatio', 'linearity', 'modularity'],
      label:    'score (0.0 à 5.0)',
    },
    stats: {
      total: samples.length,
      byVerdict,
      meanScore: parseFloat((totalScore / samples.length).toFixed(3)),
      sources: [...new Set(samples.map(s => s.meta.source.split('/').slice(0,2).join('/')))],
    },
    samples,
  };

  const outPath = path.resolve(OUTPUT_FILE);
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2));

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);

  console.log('  ┌─ Fichier généré ───────────────────────────────────');
  console.log(`  │  📁  ${outPath}`);
  console.log(`  │  📦  ${sizeKb} KB   —   ${samples.length} samples`);
  console.log('  └─────────────────────────────────────────────────────');
  console.log('');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✨  Entraîne maintenant le modèle avec :`);
  console.log(`      node index.js stream-train ${OUTPUT_FILE}`);
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

// ── Point d'entrée ─────────────────────────────────────────────────
generateDataset().catch(err => {
  console.error('\n  ❌ Erreur fatale :', err.message);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
