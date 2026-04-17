'use strict';

/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           JS-RANKER — Bridge d'injection externe      ║
 * ║   Permet l'injection de signaux depuis SecurityLens   ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Ce module expose un point d'entrée pour recevoir des alertes de sécurité
 * provenant d'outils externes (ex: SecurityLens) et forcer le score à 0/5
 * en cas de détection de vulnérabilités critiques.
 */

// ── État interne ──────────────────────────────────────────────────────

/**
 * Registre des alertes de sécurité actives.
 * Chaque entrée décrit une vulnérabilité détectée.
 *
 * @type {Array<{ type: string, severity: string, detail: string, source: string }>}
 */
let activeSecurityAlerts = [];

// ── API publique ──────────────────────────────────────────────────────

/**
 * Reçoit un signal d'alerte de sécurité depuis un outil externe.
 * Une alerte de type 'SQLi' ou 'XSS' force le score final à 0/5
 * quelle que soit la prédiction du modèle.
 *
 * @param {{ type: string, severity: string, detail: string, source?: string }} alert
 *   - type     : identifiant de vulnérabilité ('SQLi', 'XSS', 'RCE', ...)
 *   - severity : niveau de criticité ('critical', 'high', 'medium', 'low')
 *   - detail   : description textuelle de la vulnérabilité
 *   - source   : outil ou module émetteur (défaut: 'external')
 */
function receiveSecurityAlert(alert) {
  if (!alert || typeof alert !== 'object') {
    throw new TypeError('receiveSecurityAlert: l\'argument doit être un objet alert valide.');
  }
  if (!alert.type || !alert.severity || !alert.detail) {
    throw new TypeError('receiveSecurityAlert: les champs type, severity et detail sont requis.');
  }

  activeSecurityAlerts.push({
    type:     String(alert.type).toUpperCase(),
    severity: String(alert.severity).toLowerCase(),
    detail:   String(alert.detail),
    source:   alert.source ? String(alert.source) : 'external',
  });
}

/**
 * Retourne le premier signal de sécurité critique s'il en existe un.
 * Les types bloquants sont SQLi et XSS — ils imposent un score de 0/5.
 *
 * @returns {{ type: string, detail: string, source: string } | null}
 */
function getActiveSecurityVeto() {
  const BLOCKING_TYPES = new Set(['SQLI', 'XSS']);
  const blocking = activeSecurityAlerts.find(a => BLOCKING_TYPES.has(a.type));
  if (!blocking) return null;

  return {
    type:   blocking.type,
    detail: blocking.detail,
    source: blocking.source,
  };
}

/**
 * Indique si un veto de sécurité est actuellement actif.
 * Utilisé par le moteur d'analyse pour court-circuiter la prédiction.
 *
 * @returns {boolean}
 */
function hasSecurityVeto() {
  return getActiveSecurityVeto() !== null;
}

/**
 * Efface toutes les alertes de sécurité enregistrées.
 * À appeler entre deux analyses indépendantes pour éviter les contaminations.
 */
function clearSecurityAlerts() {
  activeSecurityAlerts = [];
}

/**
 * Retourne une copie de toutes les alertes actives (lecture seule).
 *
 * @returns {Array<{ type: string, severity: string, detail: string, source: string }>}
 */
function listSecurityAlerts() {
  return activeSecurityAlerts.map(a => ({ ...a }));
}

module.exports = {
  receiveSecurityAlert,
  getActiveSecurityVeto,
  hasSecurityVeto,
  clearSecurityAlerts,
  listSecurityAlerts,
};
