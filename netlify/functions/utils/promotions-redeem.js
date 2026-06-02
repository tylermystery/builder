// netlify/functions/utils/promotions-redeem.js
//
// Records one promotion redemption when a payment actually succeeds. This is the
// integrity-critical half of the "three then gone" guarantee: it runs inside a
// transaction that locks the promotion row (SELECT ... FOR UPDATE), so two
// checkouts completing at the same instant can never both claim the last slot.
//
// It is also idempotent on (promotion, payment intent): Stripe can deliver the
// same webhook more than once, and a retry must not burn a second slot.
//
// Uses the native @netlify/database driver (CommonJS-friendly) rather than the
// Drizzle ESM client, because the payment-confirmation functions are CommonJS.

const { getDatabase } = require('@netlify/database');

/**
 * @param {Object} p
 * @param {number|string} p.promotionId
 * @param {string|null} [p.sessionId]
 * @param {string|null} [p.userId]
 * @param {string|null} [p.paymentIntentId]
 * @param {number|null} [p.amountCents]
 * @returns {Promise<{recorded:boolean, reason?:string, idempotent?:boolean}>}
 */
async function recordPromotionRedemption(p) {
  const promotionId = p && p.promotionId != null ? Number(p.promotionId) : null;
  if (!promotionId || Number.isNaN(promotionId)) {
    return { recorded: false, reason: 'no-promotion' };
  }

  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the promotion row so the count-and-insert below is serialized
    // against any other checkout redeeming the same deal.
    const promo = await client.query(
      'SELECT id, max_redemptions FROM promotions WHERE id = $1 FOR UPDATE',
      [promotionId],
    );
    if (promo.rows.length === 0) {
      await client.query('ROLLBACK');
      return { recorded: false, reason: 'promotion-not-found' };
    }

    // Idempotency: this payment intent may already have a redemption recorded.
    if (p.paymentIntentId) {
      const dup = await client.query(
        'SELECT id FROM promotion_redemptions WHERE promotion_id = $1 AND payment_intent_id = $2',
        [promotionId, p.paymentIntentId],
      );
      if (dup.rows.length > 0) {
        await client.query('COMMIT');
        return { recorded: true, idempotent: true };
      }
    }

    const max = promo.rows[0].max_redemptions;
    if (max !== null && max !== undefined) {
      const cnt = await client.query(
        'SELECT COUNT(*)::int AS c FROM promotion_redemptions WHERE promotion_id = $1',
        [promotionId],
      );
      if (cnt.rows[0].c >= max) {
        await client.query('ROLLBACK');
        return { recorded: false, reason: 'sold-out' };
      }
    }

    await client.query(
      `INSERT INTO promotion_redemptions
         (promotion_id, user_id, session_id, payment_intent_id, amount_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        promotionId,
        p.userId || null,
        p.sessionId || null,
        p.paymentIntentId || null,
        p.amountCents != null ? Math.round(Number(p.amountCents)) : null,
      ],
    );

    await client.query('COMMIT');
    return { recorded: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { recordPromotionRedemption };
