/**
 * Exemple — Code MOYEN (score attendu : ~2.0 - 3.0)
 * Fonctionnel mais : nommage paresseux, imbrications évitables,
 * variables temporaires inutiles.
 */

function process(data1, data2, flag) {
  let result = [];
  let temp = 0;
  if (flag) {
    for (let i = 0; i < data1.length; i++) {
      if (data1[i] > 0) {
        temp = data1[i] * data2;
        result.push(temp);
      } else {
        result.push(0);
      }
    }
  }
  return result;
}

function handleUser(u, t, d, r) {
  if (r > 0) {
    if (t === 'admin') {
      if (d) {
        return u.name;
      } else {
        return u.email;
      }
    }
  }
  return null;
}

function calcScore(items) {
  let temp = 0;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].active) {
      temp += items[i].value;
      count++;
    }
  }
  return count > 0 ? temp / count : 0;
}

module.exports = { process, handleUser, calcScore };
