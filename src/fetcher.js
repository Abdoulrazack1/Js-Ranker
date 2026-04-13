'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          JS-RANKER — In-Memory Fetcher v2                    ║
 * ║                                                              ║
 * ║  Supporte :                                                  ║
 * ║  • github.com/user/repo          → liste tous les .js du repo ║
 * ║  • github.com/user/repo.git      → même chose               ║
 * ║  • github.com/user/repo/blob/... → fichier unique           ║
 * ║  • gitlab, unpkg, jsdelivr, raw  → fichier unique           ║
 * ║  • string brute                  → inline, zéro réseau      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const https   = require('https');
const http    = require('http');
const { URL } = require('url');

// ─────────────────────────────────────────────────────────────────
//  Utilitaire HTTP de base — fetch en mémoire
// ─────────────────────────────────────────────────────────────────
function fetchUrl(url, opts = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Trop de redirections'));

    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(new Error(`URL invalide : ${url}`)); }

    const transport = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'JS-Ranker/2.0',
      'Accept': 'application/json, text/plain, */*',
      ...opts.headers,
    };

    const req = transport.get(url, { headers, timeout: 15000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error('Redirect sans Location'));
        res.resume();
        // Location relative → absolue
        const next = loc.startsWith('http') ? loc : `${parsed.origin}${loc}`;
        return resolve(fetchUrl(next, opts, maxRedirects - 1));
      }
      if (res.statusCode === 404) {
        res.resume();
        return reject(new Error(`HTTP 404 — Ressource introuvable : ${url}`));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      }

      const chunks = [];
      let bytes = 0;
      const MAX = 10 * 1024 * 1024; // 10 MB

      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX) { req.destroy(); return reject(new Error('Fichier trop volumineux (>10MB)')); }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout : ${url}`)); });
  });
}

// ─────────────────────────────────────────────────────────────────
//  Détection du type d'URL GitHub
// ─────────────────────────────────────────────────────────────────

// Patterns GitHub
const GH_REPO    = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/;
const GH_BLOB    = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;
const GH_TREE    = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/;
const GITLAB_BLOB = /^https?:\/\/gitlab\.com\/(.+)\/-\/blob\/(.+)$/;
const JSDELIVR   = /^https?:\/\/cdn\.jsdelivr\.net\/.+$/;
const UNPKG      = /^https?:\/\/unpkg\.com\/.+$/;

// ─────────────────────────────────────────────────────────────────
//  API GitHub — Liste récursive des fichiers .js d'un repo
// ─────────────────────────────────────────────────────────────────

/**
 * Récupère la branche par défaut d'un repo GitHub.
 */
async function getDefaultBranch(owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  let raw;
  try {
    raw = await fetchUrl(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
  } catch (err) {
    // Repo privé ou inexistant
    throw new Error(`Repo GitHub introuvable ou privé : ${owner}/${repo}\n  → Vérifiez que le repo est public et que l'URL est correcte`);
  }
  const data = JSON.parse(raw);
  return data.default_branch || 'main';
}

/**
 * Liste tous les fichiers .js d'un repo via l'API Git Trees (récursif).
 * Filtre les node_modules, dist, min.js, etc.
 */
async function listJsFiles(owner, repo, branch) {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  let raw;
  try {
    raw = await fetchUrl(treeUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
  } catch (err) {
    throw new Error(`Impossible de lister les fichiers : ${err.message}`);
  }

  const data = JSON.parse(raw);

  if (data.truncated) {
    console.error('  ⚠️  Repo très volumineux, liste tronquée à 100 000 fichiers');
  }

  const EXCLUDE = [
    /node_modules\//,
    /\.min\.js$/,
    /\/dist\//,
    /\/build\//,
    /\/vendor\//,
    /\/coverage\//,
    /\/\.git\//,
    /\/test[s]?\//,
    /\/spec[s]?\//,
    /\/fixture[s]?\//,
    /\/mock[s]?\//,
  ];

  return (data.tree || [])
    .filter(item =>
      item.type === 'blob' &&
      item.path.endsWith('.js') &&
      !EXCLUDE.some(rx => rx.test(item.path))
    )
    .map(item => ({
      path: item.path,
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`,
      size: item.size || 0,
    }))
    // Trier par taille décroissante (les gros fichiers sont souvent plus intéressants)
    .sort((a, b) => b.size - a.size)
    // Limiter à 30 fichiers max pour ne pas surcharger
    .slice(0, 30);
}

/**
 * Fetch + concatène plusieurs fichiers JS en un seul bloc de code.
 * Chaque fichier est séparé par un commentaire de chemin.
 */
async function fetchRepoFiles(owner, repo, branch, files) {
  const chalk = require('chalk');
  const results = [];

  for (const file of files) {
    try {
      const code = await fetchUrl(file.rawUrl);
      if (looksLikeJavaScript(code)) {
        results.push({ path: file.path, code, sizeKb: (code.length / 1024).toFixed(1) });
        process.stdout.write(chalk.gray(`  │  ✓ ${file.path}\n`));
      }
    } catch {
      // Ignore les fichiers qui échouent silencieusement
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────
//  Pipeline principal — détection automatique du type d'input
// ─────────────────────────────────────────────────────────────────

/**
 * Point d'entrée universel.
 * Retourne TOUJOURS { code, source, resolvedUrl, isRepo, files? }
 */
async function fetchCode(input) {
  const trimmed = input.trim();

  // ── Pas une URL → inline string
  if (!/^https?:\/\//i.test(trimmed)) {
    return { code: trimmed, source: 'inline string', resolvedUrl: null, isRepo: false };
  }

  // ── URL de repo GitHub (avec ou sans .git, avec ou sans /)
  const repoMatch = trimmed.match(GH_REPO);
  if (repoMatch) {
    return fetchGitHubRepo(repoMatch[1], repoMatch[2]);
  }

  // ── URL d'un dossier GitHub (tree)
  const treeMatch = trimmed.match(GH_TREE);
  if (treeMatch) {
    const [, owner, repo, rest] = treeMatch;
    const branch = rest.split('/')[0];
    return fetchGitHubRepo(owner, repo, branch);
  }

  // ── URL d'un fichier GitHub (blob)
  const blobMatch = trimmed.match(GH_BLOB);
  if (blobMatch) {
    const rawUrl = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
    return fetchSingleFile(rawUrl, 'GitHub Blob', trimmed);
  }

  // ── GitLab blob
  const gitlabMatch = trimmed.match(GITLAB_BLOB);
  if (gitlabMatch) {
    const rawUrl = `https://gitlab.com/${gitlabMatch[1]}/-/raw/${gitlabMatch[2]}`;
    return fetchSingleFile(rawUrl, 'GitLab Blob', trimmed);
  }

  // ── jsDelivr / unpkg / raw direct
  if (JSDELIVR.test(trimmed) || UNPKG.test(trimmed)) {
    return fetchSingleFile(trimmed, 'CDN', trimmed);
  }

  // ── URL générique
  return fetchSingleFile(trimmed, 'URL directe', trimmed);
}

// ─────────────────────────────────────────────────────────────────
//  Fetch d'un repo GitHub complet
// ─────────────────────────────────────────────────────────────────
async function fetchGitHubRepo(owner, repo, forceBranch) {
  const chalk = require('chalk');

  console.log(chalk.cyan(`\n  ┌─ Repo GitHub détecté ────────────────────────────`));
  console.log(chalk.cyan('  │') + chalk.gray(`  ${owner}/${repo}`));

  // 1. Branche par défaut
  let branch;
  try {
    branch = forceBranch || await getDefaultBranch(owner, repo);
    console.log(chalk.cyan('  │') + chalk.gray(`  Branche : ${branch}`));
  } catch (err) {
    throw err;
  }

  // 2. Liste des fichiers .js
  console.log(chalk.cyan('  │') + chalk.gray('  Listage des fichiers .js...'));
  const files = await listJsFiles(owner, repo, branch);

  if (files.length === 0) {
    throw new Error(`Aucun fichier .js trouvé dans ${owner}/${repo} (branch: ${branch})\n  → Le repo ne contient peut-être pas de JavaScript`);
  }

  console.log(chalk.cyan('  │') + chalk.green(`  ${files.length} fichiers .js trouvés`));
  console.log(chalk.cyan('  │') + chalk.gray('  Téléchargement en mémoire...'));

  // 3. Fetch de tous les fichiers
  const fetched = await fetchRepoFiles(owner, repo, branch, files);

  if (fetched.length === 0) {
    throw new Error('Aucun fichier JS valide récupéré');
  }

  const totalKb = fetched.reduce((s, f) => s + parseFloat(f.sizeKb), 0).toFixed(1);
  console.log(chalk.cyan('  │') + chalk.green(`  ${fetched.length} fichiers chargés — ${totalKb} KB total`));
  console.log(chalk.cyan('  └──────────────────────────────────────────────────'));

  return {
    isRepo: true,
    owner,
    repo,
    branch,
    files: fetched,
    source: 'GitHub Repository',
    resolvedUrl: `https://github.com/${owner}/${repo}`,
    sizeKb: totalKb,
    // code = concaténation pour compatibilité pipeline simple
    code: fetched.map(f => `// === ${f.path} ===\n${f.code}`).join('\n\n'),
  };
}

// ─────────────────────────────────────────────────────────────────
//  Fetch d'un fichier unique
// ─────────────────────────────────────────────────────────────────
async function fetchSingleFile(rawUrl, label, originalUrl) {
  let code;
  try {
    code = await fetchUrl(rawUrl);
  } catch (err) {
    throw new Error(`Impossible de charger ${label} : ${err.message}`);
  }

  if (!looksLikeJavaScript(code)) {
    throw new Error(
      `Le contenu de "${rawUrl}" ne semble pas être du JavaScript.\n` +
      `  → Pour un fichier GitHub, utilisez l'URL du fichier avec /blob/ :\n` +
      `     https://github.com/user/repo/blob/main/index.js`
    );
  }

  return {
    isRepo: false,
    code,
    source: label,
    resolvedUrl: rawUrl,
    sizeKb: (Buffer.byteLength(code, 'utf-8') / 1024).toFixed(1),
  };
}

// ─────────────────────────────────────────────────────────────────
//  Heuristique JS
// ─────────────────────────────────────────────────────────────────
function looksLikeJavaScript(code) {
  if (!code || code.trim().length < 10) return false;
  const t = code.trim();
  if (t.startsWith('<html') || t.startsWith('<!DOCTYPE')) return false;
  const signals = [
    /\bfunction\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
    /\breturn\b/, /\bclass\b/, /=>/, /\bimport\b/, /\bexport\b/,
    /\brequire\b/, /\bmodule\.exports\b/, /\basync\b/,
  ];
  return signals.some(p => p.test(code));
}

// ─────────────────────────────────────────────────────────────────
//  fetchDataset (inchangé)
// ─────────────────────────────────────────────────────────────────
async function fetchDataset(url) {
  if (!/^https?:\/\//i.test(url.trim())) throw new Error('fetchDataset attend une URL HTTP/HTTPS');
  let raw;
  try { raw = await fetchUrl(url.trim()); }
  catch (err) { throw new Error(`Impossible de charger le dataset : ${err.message}`); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Le dataset n\'est pas un JSON valide'); }
  if (!Array.isArray(parsed.samples)) throw new Error('"samples" manquant dans le dataset');
  const valid = parsed.samples.filter(s =>
    typeof s.score === 'number' && s.score >= 0 && s.score <= 5 &&
    (typeof s.code === 'string' || Array.isArray(s.features))
  );
  if (!valid.length) throw new Error('Aucun sample valide dans le dataset');
  return { ...parsed, samples: valid };
}

module.exports = { fetchCode, fetchDataset, resolveUrl: (u) => ({ resolvedUrl: u, sourceLabel: 'URL' }), fetchUrl };
