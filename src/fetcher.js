'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          JS-RANKER — In-Memory Fetcher                       ║
 * ║                                                              ║
 * ║  Sources supportées :                                        ║
 * ║  • github.com/user/repo      → liste tous les .js du repo    ║
 * ║  • github.com/…/blob/…       → fichier unique                ║
 * ║  • gitlab, unpkg, jsdelivr, raw → fichier unique             ║
 * ║  • chaîne brute              → inline, zéro réseau           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const https   = require('https');
const http    = require('http');
const { URL } = require('url');

// ── Patterns de reconnaissance d'URL ────────────────────────────────

const GH_REPO     = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/;
const GH_BLOB     = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;
const GH_TREE     = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/;
const GITLAB_BLOB = /^https?:\/\/gitlab\.com\/(.+)\/-\/blob\/(.+)$/;
const JSDELIVR    = /^https?:\/\/cdn\.jsdelivr\.net\/.+$/;
const UNPKG       = /^https?:\/\/unpkg\.com\/.+$/;

/** Taille maximale d'une réponse HTTP acceptée (10 MB). */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Timeout HTTP en millisecondes. */
const HTTP_TIMEOUT_MS = 15000;

/** En-têtes communs à toutes les requêtes HTTP. */
const BASE_HEADERS = {
  'User-Agent': 'JS-Ranker/3.0',
  'Accept':     'application/json, text/plain, */*',
};

/** Codes HTTP indiquant une redirection à suivre. */
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// ── Utilitaires HTTP de bas niveau ───────────────────────────────────

/**
 * Valide et parse une URL, retourne l'objet URL et le transport (http/https).
 *
 * @param {string} rawUrl
 * @returns {{ parsed: URL, transport: object }}
 * @throws {Error} si l'URL est invalide
 */
function resolveTransport(rawUrl) {
  const parsed    = new URL(rawUrl); // lève TypeError si invalide
  const transport = parsed.protocol === 'https:' ? https : http;
  return { parsed, transport };
}

/**
 * Construit les en-têtes de requête en fusionnant les headers de base avec les options.
 *
 * @param {object} [extraHeaders={}] — headers additionnels depuis les options
 * @returns {object}
 */
function buildRequestHeaders(extraHeaders = {}) {
  return { ...BASE_HEADERS, ...extraHeaders };
}

/**
 * Calcule l'URL absolue de la prochaine redirection.
 * Une location relative est résolue depuis l'origine de l'URL courante.
 *
 * @param {string} location — header Location de la réponse
 * @param {string} origin — origine (protocole + hôte) de l'URL courante
 * @returns {string}
 */
function computeRedirectTarget(location, origin) {
  return location.startsWith('http') ? location : `${origin}${location}`;
}

/**
 * Traite une réponse de redirection en calculant la prochaine URL et en relançant le fetch.
 * Résout la promesse courante avec le résultat de la prochaine requête.
 *
 * @param {http.IncomingMessage} response — réponse HTTP à consommer
 * @param {object} redirectContext — { requestUrl, options, remainingRedirects, resolve, reject }
 */
function handleRedirect(response, redirectContext) {
  const { requestUrl, options, remainingRedirects, resolve, reject } = redirectContext;
  const location = response.headers.location;

  if (!location) {
    reject(new Error('Redirect sans header Location'));
    return;
  }

  response.resume();
  const nextUrl = computeRedirectTarget(location, new URL(requestUrl).origin);
  resolve(fetchUrl(nextUrl, options, remainingRedirects - 1));
}

/**
 * Vérifie le statut HTTP d'une réponse et dispatch vers le bon gestionnaire.
 * Retourne true si la réponse est 2xx et que le corps doit être collecté.
 *
 * @param {http.IncomingMessage} response — réponse HTTP entrante
 * @param {object} requestContext — { requestUrl, options, remainingRedirects, resolve, reject }
 * @returns {boolean} true si la réponse est succès (2xx) et prête à être lue
 */
function handleResponseStatus(response, requestContext) {
  const { requestUrl, reject } = requestContext;
  const statusCode = response.statusCode;

  if (REDIRECT_CODES.has(statusCode)) {
    handleRedirect(response, requestContext);
    return false;
  }

  if (statusCode === 404) {
    response.resume();
    reject(new Error(`HTTP 404 — Ressource introuvable : ${requestUrl}`));
    return false;
  }

  if (statusCode < 200 || statusCode >= 300) {
    response.resume();
    reject(new Error(`HTTP ${statusCode} pour ${requestUrl}`));
    return false;
  }

  return true; // Réponse 2xx — le corps doit être collecté
}

/**
 * Collecte les chunks du corps de réponse et résout avec le texte UTF-8.
 * Rejette si la taille dépasse MAX_RESPONSE_BYTES.
 *
 * @param {http.IncomingMessage} response
 * @param {http.ClientRequest} request — pour destruction en cas d'overflow
 * @param {Function} resolve
 * @param {Function} reject
 */
function collectResponseBody(response, request, resolve, reject) {
  const chunks = [];
  let totalBytes = 0;

  response.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      request.destroy();
      reject(new Error('Fichier trop volumineux (> 10 MB)'));
      return;
    }
    chunks.push(chunk);
  });

  response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  response.on('error', reject);
}

/**
 * Effectue une requête HTTP GET avec gestion des redirections et du timeout.
 * Retourne le corps de la réponse sous forme de chaîne UTF-8.
 *
 * @param {string} url — URL cible
 * @param {object} [opts={}] — options HTTP (headers additionnels…)
 * @param {number} [maxRedirects=5] — profondeur max de suivi de redirections
 * @returns {Promise<string>}
 */
function fetchUrl(url, opts = {}, maxRedirects = 5) {
  if (maxRedirects <= 0) return Promise.reject(new Error('Trop de redirections'));

  return new Promise((resolve, reject) => {
    let resolvedTransport;
    try {
      resolvedTransport = resolveTransport(url);
    } catch {
      reject(new Error(`URL invalide : ${url}`));
      return;
    }

    const { transport } = resolvedTransport;
    const headers = buildRequestHeaders(opts.headers);

    const requestContext = { requestUrl: url, options: opts, remainingRedirects: maxRedirects, resolve, reject };

    const request = transport.get(url, { headers, timeout: HTTP_TIMEOUT_MS }, (response) => {
      const shouldCollect = handleResponseStatus(response, requestContext);
      if (shouldCollect) collectResponseBody(response, request, resolve, reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Timeout (${HTTP_TIMEOUT_MS}ms) : ${url}`));
    });
  });
}

// ── API GitHub — liste des fichiers JS ───────────────────────────────

/** En-tête Accept pour l'API GitHub v3. */
const GITHUB_API_ACCEPT = { Accept: 'application/vnd.github.v3+json' };

/**
 * Récupère la branche par défaut d'un repo GitHub via l'API REST.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string>} nom de la branche (ex: 'main')
 * @throws {Error} si le repo est privé ou inexistant
 */
async function getDefaultBranch(owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const rawResponse = await fetchUrl(apiUrl, { headers: GITHUB_API_ACCEPT });
    return JSON.parse(rawResponse).default_branch || 'main';
  } catch {
    throw new Error(`Repo GitHub introuvable ou privé : ${owner}/${repo}`);
  }
}

/** Patterns de dossiers à exclure de l'analyse JS. */
const JS_EXCLUDE_PATTERNS = [
  /node_modules\//, /\.min\.js$/, /\/dist\//, /\/build\//,
  /\/vendor\//, /\/coverage\//, /\/\.git\//, /\/tests?\//,
  /\/specs?\//, /\/fixtures?\//, /\/mocks?\//,
];

/**
 * Détermine si un chemin de fichier doit être exclu de l'analyse.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isExcludedPath(filePath) {
  return JS_EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Liste tous les fichiers .js analysables d'un repo via l'API Git Trees récursive.
 * Exclut node_modules, dist, fichiers minifiés… Limite à 30 fichiers les plus gros.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @returns {Promise<Array<{ path, rawUrl, size }>>}
 */
async function listJsFiles(owner, repo, branch) {
  const treeUrl   = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const rawResponse = await fetchUrl(treeUrl, { headers: GITHUB_API_ACCEPT }).catch(err => {
    throw new Error(`Impossible de lister les fichiers : ${err.message}`);
  });

  const treeData = JSON.parse(rawResponse);

  if (treeData.truncated) {
    console.error('  ⚠️  Repo très volumineux — liste tronquée à 100 000 fichiers');
  }

  return (treeData.tree || [])
    .filter(item => item.type === 'blob' && item.path.endsWith('.js') && !isExcludedPath(item.path))
    .map(item => ({
      path:   item.path,
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`,
      size:   item.size || 0,
    }))
    .sort((itemA, itemB) => itemB.size - itemA.size)  // Plus gros en premier
    .slice(0, 30);                                      // 30 fichiers max
}

// ── Fetch de fichiers ────────────────────────────────────────────────

/**
 * Tente de télécharger un fichier JS et retourne son contenu si valide.
 * Retourne null si le fetch échoue ou si le contenu n'est pas du JavaScript.
 *
 * @param {{ path: string, rawUrl: string }} fileEntry
 * @returns {Promise<{ path, code, sizeKb } | null>}
 */
async function fetchSingleRepoFile(fileEntry) {
  try {
    const code = await fetchUrl(fileEntry.rawUrl);
    if (!looksLikeJavaScript(code)) return null;
    return { path: fileEntry.path, code, sizeKb: (code.length / 1024).toFixed(1) };
  } catch {
    return null; // Échec silencieux — fichier ignoré
  }
}

/**
 * Télécharge tous les fichiers JS d'un repo en parallèle séquentiel.
 * Affiche une ligne de progression par fichier réussi.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {Array<{ path, rawUrl }>} fileList — liste issue de listJsFiles
 * @returns {Promise<Array<{ path, code, sizeKb }>>}
 */
async function fetchRepoFiles(owner, repo, branch, fileList) {
  const chalk   = require('chalk');
  const results = [];

  for (const fileEntry of fileList) {
    const fetchedFile = await fetchSingleRepoFile(fileEntry);
    if (!fetchedFile) continue;
    results.push(fetchedFile);
    process.stdout.write(chalk.gray(`  │  ✓ ${fetchedFile.path}\n`));
  }

  return results;
}

// ── Pipeline de fetch complet ─────────────────────────────────────────

/**
 * Télécharge l'intégralité d'un repo GitHub : branche → liste .js → contenu.
 * Retourne un objet enrichi { isRepo, files, owner, repo, branch, sizeKb, code }.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} [forceBranch] — branche explicite (sinon auto-détectée)
 * @returns {Promise<object>}
 */
async function fetchGitHubRepo(owner, repo, forceBranch) {
  const chalk  = require('chalk');
  const repoId = `${owner}/${repo}`;

  console.log(chalk.cyan('\n  ┌─ Repo GitHub détecté ────────────────────────────'));
  console.log(chalk.cyan('  │') + chalk.gray(`  ${repoId}`));

  const branch   = forceBranch || await getDefaultBranch(owner, repo);
  console.log(chalk.cyan('  │') + chalk.gray(`  Branche : ${branch}`));

  console.log(chalk.cyan('  │') + chalk.gray('  Listage des fichiers .js...'));
  const fileList = await listJsFiles(owner, repo, branch);

  if (fileList.length === 0) {
    throw new Error(`Aucun fichier .js trouvé dans ${repoId} (branch: ${branch})`);
  }

  console.log(chalk.cyan('  │') + chalk.green(`  ${fileList.length} fichiers .js trouvés`));
  console.log(chalk.cyan('  │') + chalk.gray('  Téléchargement en mémoire...'));

  const fetchedFiles = await fetchRepoFiles(owner, repo, branch, fileList);

  if (fetchedFiles.length === 0) throw new Error('Aucun fichier JS valide récupéré');

  const totalKb = fetchedFiles.reduce((total, fileData) => total + parseFloat(fileData.sizeKb), 0).toFixed(1);
  console.log(chalk.cyan('  │') + chalk.green(`  ${fetchedFiles.length} fichiers chargés — ${totalKb} KB total`));
  console.log(chalk.cyan('  └──────────────────────────────────────────────────'));

  return {
    isRepo: true, owner, repo, branch,
    files:  fetchedFiles,
    source: 'GitHub Repository',
    resolvedUrl: `https://github.com/${repoId}`,
    sizeKb: totalKb,
    code:   fetchedFiles.map(fileData => `// === ${fileData.path} ===\n${fileData.code}`).join('\n\n'),
  };
}

/**
 * Télécharge un fichier JS unique depuis une URL brute.
 * Vérifie que le contenu ressemble à du JavaScript avant de retourner.
 *
 * @param {string} rawUrl — URL directe vers le contenu brut
 * @param {string} label — libellé de la source (pour les messages d'erreur)
 * @param {string} originalUrl — URL d'origine (pour l'affichage)
 * @returns {Promise<{ isRepo, code, source, resolvedUrl, sizeKb }>}
 */
async function fetchSingleFile(rawUrl, label, originalUrl) {
  const code = await fetchUrl(rawUrl).catch(err => {
    throw new Error(`Impossible de charger ${label} : ${err.message}`);
  });

  if (!looksLikeJavaScript(code)) {
    throw new Error(`Le contenu de "${rawUrl}" ne semble pas être du JavaScript.`);
  }

  return {
    isRepo: false, code, source: label,
    resolvedUrl: rawUrl,
    sizeKb: (Buffer.byteLength(code, 'utf-8') / 1024).toFixed(1),
  };
}

// ── Heuristique de détection JS ──────────────────────────────────────

/** Patterns syntaxiques caractéristiques d'un fichier JavaScript. */
const JS_SYNTAX_SIGNALS = [
  /\bfunction\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
  /\breturn\b/,   /\bclass\b/, /=>/,      /\bimport\b/,
  /\bexport\b/,   /\brequire\b/, /\bmodule\.exports\b/, /\basync\b/,
];

/**
 * Détermine si une chaîne de code ressemble à du JavaScript valide.
 * Rejette le HTML et vérifie la présence de signaux syntaxiques JS.
 *
 * @param {string} code
 * @returns {boolean}
 */
function looksLikeJavaScript(code) {
  if (!code || code.trim().length < 10) return false;
  const trimmedCode = code.trim();
  if (trimmedCode.startsWith('<html') || trimmedCode.startsWith('<!DOCTYPE')) return false;
  return JS_SYNTAX_SIGNALS.some(pattern => pattern.test(code));
}

// ── Point d'entrée universel ─────────────────────────────────────────

/**
 * Dispatche automatiquement vers le bon pipeline selon le type d'entrée :
 * repo GitHub, fichier blob/tree, CDN, URL générique, ou chaîne inline.
 *
 * @param {string} input
 * @returns {Promise<object>} résultat normalisé { code, source, resolvedUrl, isRepo, files? }
 */
async function fetchCode(input) {
  const trimmedInput = input.trim();

  if (!/^https?:\/\//i.test(trimmedInput)) {
    return { code: trimmedInput, source: 'inline string', resolvedUrl: null, isRepo: false };
  }

  const repoMatch = trimmedInput.match(GH_REPO);
  if (repoMatch) return fetchGitHubRepo(repoMatch[1], repoMatch[2]);

  const treeMatch = trimmedInput.match(GH_TREE);
  if (treeMatch) {
    const [, owner, repo, branchAndPath] = treeMatch;
    return fetchGitHubRepo(owner, repo, branchAndPath.split('/')[0]);
  }

  const blobMatch = trimmedInput.match(GH_BLOB);
  if (blobMatch) {
    const rawUrl = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
    return fetchSingleFile(rawUrl, 'GitHub Blob', trimmedInput);
  }

  const gitlabMatch = trimmedInput.match(GITLAB_BLOB);
  if (gitlabMatch) {
    const rawUrl = `https://gitlab.com/${gitlabMatch[1]}/-/raw/${gitlabMatch[2]}`;
    return fetchSingleFile(rawUrl, 'GitLab Blob', trimmedInput);
  }

  if (JSDELIVR.test(trimmedInput) || UNPKG.test(trimmedInput)) {
    return fetchSingleFile(trimmedInput, 'CDN', trimmedInput);
  }

  return fetchSingleFile(trimmedInput, 'URL directe', trimmedInput);
}

// ── Chargement de dataset distant ────────────────────────────────────

/**
 * Valide les propriétés minimales requises d'un sample de dataset.
 *
 * @param {object} sample
 * @returns {boolean}
 */
function isValidDatasetSample(sample) {
  const hasScore    = typeof sample.score === 'number' && sample.score >= 0 && sample.score <= 5;
  const hasContent  = typeof sample.code === 'string' || Array.isArray(sample.features);
  return hasScore && hasContent;
}

/**
 * Télécharge et valide un dataset JSON depuis une URL HTTP/HTTPS.
 * Filtre les samples invalides avant de retourner.
 *
 * @param {string} url — URL du dataset JSON
 * @returns {Promise<object>} dataset avec samples filtrés
 * @throws {Error} si l'URL, le JSON ou le format est invalide
 */
async function fetchDataset(url) {
  if (!/^https?:\/\//i.test(url.trim())) {
    throw new Error('fetchDataset attend une URL HTTP/HTTPS');
  }

  const rawBody = await fetchUrl(url.trim()).catch(err => {
    throw new Error(`Impossible de charger le dataset : ${err.message}`);
  });

  let parsedDataset;
  try {
    parsedDataset = JSON.parse(rawBody);
  } catch {
    throw new Error('Le dataset distant n\'est pas un JSON valide');
  }

  if (!Array.isArray(parsedDataset.samples)) {
    throw new Error('"samples" manquant ou invalide dans le dataset');
  }

  const validSamples = parsedDataset.samples.filter(isValidDatasetSample);
  if (validSamples.length === 0) throw new Error('Aucun sample valide dans le dataset');

  return { ...parsedDataset, samples: validSamples };
}

module.exports = {
  fetchCode,
  fetchDataset,
  fetchUrl,
  resolveUrl: (url) => ({ resolvedUrl: url, sourceLabel: 'URL' }),
};
