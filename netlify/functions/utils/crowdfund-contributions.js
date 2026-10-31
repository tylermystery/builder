// netlify/functions/utils/crowdfund-contributions.js
//
// Records crowdfund ("chip in") contributions from the Stripe webhook. The
// checkout puts the chip-in onto the PaymentIntent's metadata (see
// create-payment-intent), so the contribution is captured server-side even when
// the payer has no plan session or closes the tab before the browser finishes.
//
// Every write is keyed on the payment intent, so Stripe retrying a webhook can
// never count the same contribution twice. ACH contributions count as soon as
// they are submitted ('processing'); a later failure or full refund removes them
// from the meter.
//
// Uses the native @netlify/database driver (CommonJS-friendly), like
// promotions-redeem.js.

const { getDatabase } = require('@netlify/database');

const FUND_KEY_RE = /^[A-Za-z0-9._:-]{3,200}$/;

// Read the chip-in fields from a PaymentIntent's metadata. Returns null when the
// payment carried no chip-in.
function chipInFromMetadata(paymentIntent) {
  const md = paymentIntent?.metadata || {};
  const fundKey = md.chipInFundKey || '';
  const amountCents = parseInt(md.chipInAmountCents || '0', 10);
  if (!FUND_KEY_RE.test(fundKey) || !(amountCents > 0)) return null;
  return {
    fundKey,
    amountCents,
    itemName: md.chipInItemName || null,
    storeId: md.chipInStoreId || null,
    sessionId: md.sessionId || null,
  };
}

// Upsert the contribution for a submitted/succeeded payment. A refunded row stays
// refunded, and a late 'processing' event never downgrades a 'succeeded' row.
async function recordCrowdfundContribution(paymentIntent, status) {
  const chipIn = chipInFromMetadata(paymentIntent);
  if (!chipIn) return { recorded: false, reason: 'no-chip-in' };

  const db = getDatabase();
  await db.pool.query(
    `INSERT INTO crowdfund_contributions
       (fund_key, item_name, store_id, payment_intent_id, amount_cents, status, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (payment_intent_id) DO UPDATE SET
       status = CASE
         WHEN crowdfund_contributions.status = 'refunded' THEN 'refunded'
         WHEN crowdfund_contributions.status = 'succeeded' AND EXCLUDED.status = 'processing' THEN 'succeeded'
         ELSE EXCLUDED.status
       END,
       amount_cents = EXCLUDED.amount_cents,
       updated_at = now()`,
    [
      chipIn.fundKey,
      chipIn.itemName,
      chipIn.storeId,
      paymentIntent.id,
      chipIn.amountCents,
      status,
      chipIn.sessionId,
    ],
  );
  return { recorded: true, fundKey: chipIn.fundKey, amountCents: chipIn.amountCents };
}

// Drop a contribution from the meter when its payment fails (e.g. an ACH debit
// that bounces after being submitted). A succeeded or refunded row is left alone.
async function markCrowdfundContributionFailed(paymentIntentId) {
  if (!paymentIntentId) return;
  const db = getDatabase();
  await db.pool.query(
    `UPDATE crowdfund_contributions SET status = 'failed', updated_at = now()
     WHERE payment_intent_id = $1 AND status = 'processing'`,
    [paymentIntentId],
  );
}

// Drop a contribution from the meter when its payment is fully refunded.
async function markCrowdfundContributionRefunded(paymentIntentId) {
  if (!paymentIntentId) return;
  const db = getDatabase();
  await db.pool.query(
    `UPDATE crowdfund_contributions SET status = 'refunded', updated_at = now()
     WHERE payment_intent_id = $1`,
    [paymentIntentId],
  );
}

module.exports = {
  recordCrowdfundContribution,
  markCrowdfundContributionFailed,
  markCrowdfundContributionRefunded,
};
