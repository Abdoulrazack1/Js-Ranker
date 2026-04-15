#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         JS-RANKER — Serveur API REST                         ║
 * ║                                                              ║
 * ║   POST /analyze      — Analyser un snippet de code           ║
 * ║   POST /analyze/url  — Analyser une URL (GitHub, CDN…)       ║
 * ║   GET  /status       — État du modèle ML                     ║
 * ║   GET  /health       — Health check                          ║
 * ║                                                              ║
 * ║   Usage : node server.js [--port 3000]                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');

// ── Config ────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i+1] ? args[i+1] : def; };
const PORT   = parseInt(getArg('--port', process.env.PORT || '3000'), 10);
const HOST   = getArg('--host', '127.0.0.1');

// ── Chargement lazy du modèle ─────────────────────────────────────
let model   = null;
let modelMeta = null;

async function getModel() {
  if (model) return model;
  const { loadModel, MODEL_CONFIG } = require('./src/model');
  const modelPath = path.join(__dirname, 'models/js-ranker');
  model = await loadModel(modelPath);
  const metaPath = path.join(modelPath, 'training-meta.json');
  if (fs.existsSync(metaPath)) modelMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  return model;
}

// ── Helpers HTTP ──────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 512_000) req.destroy(); });
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type':  'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sendError(res, status, message, details = null) {
  send(res, status, { error: message, ...(details ? { details } : {}) });
}

// ── Formatage de la réponse analyse ──────────────────────────────
function formatAnalysisResponse(score, details, source = 'snippet') {
  const { getVerdict, getDetailedAdvice } = require('./src/ui');
  const verdict  = getVerdict(score);
  const advices  = getDetailedAdvice ? getDetailedAdvice(score, details) : [];

  return {
    score:    score,
    verdict:  verdict.word,
    emoji:    verdict.emoji,
    source,
    features: {
      cyclomaticComplexity: details.cyclomaticComplexity,
      maxNesting:           details.maxNesting,
      namingRatio:          details.namingRatio,
      linearity:            details.linearity,
      modularity:           details.modularity,
      ...(details.commentRatio     ? { commentRatio:     details.commentRatio }     : {}),
      ...(details.returnComplexity ? { returnComplexity: details.returnComplexity } : {}),
      ...(details.asyncAwait       ? { asyncAwait:       details.asyncAwait }       : {}),
      ...(details.magicNumbers     ? { magicNumbers:     details.magicNumbers }     : {}),
      ...(details.chainLength      ? { chainLength:      details.chainLength }      : {}),
    },
    advice: advices.map(a => ({ message: a.msg, context: a.tip || null })),
    analyzedAt: new Date().toISOString(),
  };
}

// ── Routes ────────────────────────────────────────────────────────

// POST /analyze  —  { "code": "function f() {...}" }
async function handleAnalyzeSnippet(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return sendError(res, 400, 'JSON invalide dans le corps de la requête'); }

  if (!body.code || typeof body.code !== 'string' || body.code.trim().length < 3) {
    return sendError(res, 400, 'Champ "code" requis (string, min 3 caractères)');
  }

  const { extractFeatures } = require('./src/features');
  const { predict }         = require('./src/model');

  let features, details;
  try {
    ({ features, details } = extractFeatures(body.code));
  } catch (err) {
    return sendError(res, 422, 'Parsing AST échoué', err.message);
  }

  let m;
  try { m = await getModel(); }
  catch { return sendError(res, 503, 'Modèle ML non disponible — lancez npm run train'); }

  const score    = predict(m, features);
  const response = formatAnalysisResponse(score, details, 'snippet');

  send(res, 200, response);
}

// POST /analyze/url  —  { "url": "https://..." }
async function handleAnalyzeUrl(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return sendError(res, 400, 'JSON invalide'); }

  if (!body.url || !/^https?:\/\//i.test(body.url)) {
    return sendError(res, 400, 'Champ "url" requis (doit commencer par http:// ou https://)');
  }

  const { analyzeUrl } = require('./src/analyze');
  try {
    // On capture stdout pour ne pas polluer la réponse HTTP
    // Et on utilise l'API programmatique bas-niveau à la place
    const { fetchDataset } = require('./src/fetcher');
    const { extractFeatures } = require('./src/features');
    const { predict }         = require('./src/model');

    const source = await fetchDataset(body.url);
    // fetchDataset renvoie le code brut (string) ou un objet dataset
    const code = typeof source === 'string' ? source : JSON.stringify(source);

    let features, details;
    try {
      ({ features, details } = extractFeatures(code.substring(0, 50000)));
    } catch (err) {
      return sendError(res, 422, 'Parsing AST échoué sur l\'URL cible', err.message);
    }

    let m;
    try { m = await getModel(); }
    catch { return sendError(res, 503, 'Modèle ML non disponible'); }

    const score    = predict(m, features);
    const response = formatAnalysisResponse(score, details, body.url);
    send(res, 200, response);

  } catch (err) {
    return sendError(res, 502, 'Impossible de récupérer l\'URL', err.message);
  }
}

// GET /status
async function handleStatus(req, res) {
  const { modelExists } = require('./src/analyze');
  const isReady = modelExists();

  send(res, 200, {
    status:   isReady ? 'ready' : 'untrained',
    model:    isReady ? 'js-ranker' : null,
    meta:     modelMeta || (isReady ? 'chargement au premier appel' : null),
    version:  '2.1',
    features: 10,
    endpoints: [
      { method: 'POST', path: '/analyze',     body: '{ "code": "string" }' },
      { method: 'POST', path: '/analyze/url', body: '{ "url": "string" }' },
      { method: 'GET',  path: '/status' },
      { method: 'GET',  path: '/health' },
    ],
  });
}

// GET /health
function handleHealth(req, res) {
  send(res, 200, { ok: true, uptime: process.uptime().toFixed(1) + 's', ts: new Date().toISOString() });
}

// ── Routeur principal ─────────────────────────────────────────────
async function router(req, res) {
  const { method, url } = req;

  // CORS preflight
  if (method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  if (method === 'POST' && url === '/analyze')      return handleAnalyzeSnippet(req, res);
  if (method === 'POST' && url === '/analyze/url')  return handleAnalyzeUrl(req, res);
  if (method === 'GET'  && url === '/status')       return handleStatus(req, res);
  if (method === 'GET'  && (url === '/health' || url === '/')) return handleHealth(req, res);

  sendError(res, 404, `Route inconnue : ${method} ${url}`);
}

// ── Démarrage ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try { await router(req, res); }
  catch (err) { sendError(res, 500, 'Erreur interne', err.message); }
});

server.listen(PORT, HOST, () => {
  const chalk = require('chalk');
  console.log('');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('   🌐  JS-RANKER API — Serveur REST               ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray(`  Écoute sur : `) + chalk.white(`http://${HOST}:${PORT}`));
  console.log('');
  console.log(chalk.cyan('  Endpoints :'));
  console.log(chalk.gray('  POST ') + chalk.white('/analyze      ') + chalk.gray('{ "code": "..." }'));
  console.log(chalk.gray('  POST ') + chalk.white('/analyze/url  ') + chalk.gray('{ "url": "..." }'));
  console.log(chalk.gray('  GET  ') + chalk.white('/status'));
  console.log(chalk.gray('  GET  ') + chalk.white('/health'));
  console.log('');
  console.log(chalk.gray('  Exemple :'));
  console.log(chalk.gray(`  curl -X POST http://${HOST}:${PORT}/analyze \\`));
  console.log(chalk.gray(`       -H "Content-Type: application/json" \\`));
  console.log(chalk.gray(`       -d '{"code":"const add = (a,b) => a+b;"}'`));
  console.log('');
});

server.on('error', err => {
  console.error(`\n  ❌ Erreur serveur : ${err.message}`);
  if (err.code === 'EADDRINUSE') console.error(`  Port ${PORT} déjà utilisé — essayez --port 3001`);
  process.exit(1);
});
