/**
 * Exemple — Code PARFAIT (score attendu : ~4.5 - 5.0)
 * Fonctions pures, nommage excellent, aucune imbrication profonde.
 */

// Calcul de prix avec taxe — Pure function
function calculateTotalWithTax(basePrice, taxRate, discountPercent = 0) {
  const discount = basePrice * (discountPercent / 100);
  const discountedPrice = basePrice - discount;
  return discountedPrice * (1 + taxRate);
}

// Filtre d'utilisateurs actifs — Fonctionnel & lisible
const filterVerifiedUsers = (users) =>
  users.filter(user => user.isActive && user.emailVerified);

// Formatage de devises — Moderne, concis
const formatEuros = (amount) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);

// Guard clauses propres
function getUserDisplayName(user) {
  if (!user) return 'Anonyme';
  if (!user.firstName) return user.email || 'Inconnu';
  return `${user.firstName} ${user.lastName}`.trim();
}

module.exports = { calculateTotalWithTax, filterVerifiedUsers, formatEuros, getUserDisplayName };
