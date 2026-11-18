'use strict';

// Build an automatic all-time leaderboard from confirmed payments only.
// Amounts use baseAmount, excluding the QRIS unique code.
function topDonors(transactions, limit = 3) {
  if (!Array.isArray(transactions)) throw new TypeError('Daftar transaksi harus berupa array');
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new RangeError('Batas leaderboard harus antara 1 dan 25');
  }

  const usedReferences = new Set();
  const users = new Map();

  for (const record of transactions) {
    if (!record || record.status !== 'paid') continue;

    const userId = String(record.userId || '');
    if (!/^\d{15,22}$/.test(userId)) continue;

    const referenceId = typeof record.referenceId === 'string' ? record.referenceId : '';
    if (!referenceId || usedReferences.has(referenceId)) continue;

    const amount = Number(record.baseAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;

    usedReferences.add(referenceId);
    let entry = users.get(userId);
    if (!entry) {
      entry = { userId, total: 0, count: 0, lastPaidAt: 0 };
      users.set(userId, entry);
    }
    entry.total += amount;
    entry.count += 1;
    entry.lastPaidAt = Math.max(entry.lastPaidAt, Number(record.paidAt) || 0);
  }

  return [...users.values()]
    .sort((a, b) => b.total - a.total || b.count - a.count || a.userId.localeCompare(b.userId))
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

module.exports = { topDonors };
