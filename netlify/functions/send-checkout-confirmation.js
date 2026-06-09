// FILE: netlify/functions/send-checkout-confirmation.js
// Sends the two checkout confirmation emails (purchaser + store owner) WITHOUT
// requiring a payment. Used by:
//   1. the "Save plan for later" button in the checkout modal (unpaid:true), and
//   2. the free ($0) registration checkout completion.
// This is the no-payment equivalent of the emails the Stripe webhook sends after
// a real charge. It is heavily logged so the email path can be diagnosed from the
// function logs.

const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { buildReceiptEmail, buildMerchantNotificationEmail } = require('./utils/checkout-emails');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

const SESSIONS_TABLE = 'Sessions';
const STORES_TABLE = 'Stores';

async function getSessionRecord(sessionId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}/${sessionId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) throw new Error(`Failed to fetch session ${sessionId}: ${res.status}`);
  return res.json();
}

async function getStoreRecord(storeId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE}/${storeId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) return null;
  return res.json();
}

exports.handler = async (event) => {
  console.log('[send-checkout-confirmation] Invoked.', {
    method: event.httpMethod,
    hasSendgridKey: !!SENDGRID_API_KEY,
    hasAirtablePat: !!AIRTABLE_PAT,
  });

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Surface a clear, actionable error if email isn't configured at all.
  if (!SENDGRID_API_KEY) {
    console.error('[send-checkout-confirmation] SENDGRID_API_KEY is not set — cannot send any email.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email is not configured (SENDGRID_API_KEY missing).' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('[send-checkout-confirmation] Invalid JSON body:', e.message);
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { sessionId, customerEmail, customerName, amountDue = 0, unpaid = true } = body;
  console.log('[send-checkout-confirmation] Payload:', { sessionId, customerEmail, customerName, amountDue, unpaid });

  if (!sessionId || !customerEmail) {
    console.warn('[send-checkout-confirmation] Missing sessionId or customerEmail — aborting.');
    return { statusCode: 400, body: JSON.stringify({ error: 'sessionId and customerEmail are required.' }) };
  }

  try {
    const session = await getSessionRecord(sessionId);
    const storeId = session.fields.Store?.[0];
    const store = storeId ? await getStoreRecord(storeId) : null;
    const merchantEmail = store?.fields?.ContactEmail;
    console.log('[send-checkout-confirmation] Resolved:', {
      sessionName: session.fields.Name,
      storeId: storeId || null,
      storeFound: !!store,
      merchantEmail: merchantEmail || null,
    });

    const baseUrl = SITE_URL || URL || 'https://whatthefun.wtf';
    const payment = {
      amount: amountDue,
      method: unpaid ? 'Unpaid — saved plan' : 'Card',
      status: unpaid ? 'unpaid' : 'succeeded',
      customerEmail,
      customerName,
      date: new Date().toISOString(),
    };

    const sentTo = [];
    const errors = [];

    // 1) Purchaser confirmation.
    try {
      const receipt = buildReceiptEmail(session, payment, store, baseUrl, { unpaid, amountDue });
      await sgMail.send({ to: customerEmail, from: receipt.from, subject: receipt.subject, html: receipt.html });
      sentTo.push(customerEmail);
      console.log(`[send-checkout-confirmation] Purchaser email sent to ${customerEmail}.`);
    } catch (emailErr) {
      const detail = emailErr.response?.body ? JSON.stringify(emailErr.response.body) : emailErr.message;
      console.error(`[send-checkout-confirmation] Purchaser email FAILED for ${customerEmail}:`, detail);
      errors.push({ to: customerEmail, error: emailErr.message });
    }

    // 2) Store-owner notification.
    if (merchantEmail) {
      try {
        const notification = buildMerchantNotificationEmail(session, payment, store, baseUrl, { unpaid, amountDue });
        await sgMail.send({ to: notification.to, from: notification.from, subject: notification.subject, html: notification.html });
        sentTo.push(merchantEmail);
        console.log(`[send-checkout-confirmation] Merchant email sent to ${merchantEmail}.`);
      } catch (emailErr) {
        const detail = emailErr.response?.body ? JSON.stringify(emailErr.response.body) : emailErr.message;
        console.error(`[send-checkout-confirmation] Merchant email FAILED for ${merchantEmail}:`, detail);
        errors.push({ to: merchantEmail, error: emailErr.message });
      }
    } else {
      console.warn('[send-checkout-confirmation] No store ContactEmail on file — merchant notification skipped.');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: errors.length === 0, sentTo, errors }),
    };
  } catch (error) {
    console.error('[send-checkout-confirmation] Error:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
