const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL, URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

const SESSIONS_TABLE = 'Sessions';
const STORES_TABLE = 'Stores';

async function getSessionRecord(sessionId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}/${sessionId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) throw new Error(`Failed to fetch session ${sessionId}: ${res.status}`);
  return res.json();
}

async function findSessionByPaymentIntentId(paymentIntentId) {
  const formula = `({StripePaymentIntentId} = '${paymentIntentId}')`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records && data.records.length > 0 ? data.records[0] : null;
}

async function getStoreRecord(storeId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE}/${storeId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) return null;
  return res.json();
}

async function updateSessionPayment(sessionId, paymentHistory, extraFields = {}) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}/${sessionId}`;
  const historyArray = Array.isArray(paymentHistory) ? paymentHistory : [];
  const newTotal = historyArray.reduce((sum, p) => sum + (p.amount || 0), 0);

  const fields = {
    'Amount Received': newTotal,
    'PaymentHistory': JSON.stringify(historyArray, null, 2),
    ...extraFields,
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update session ${sessionId}: ${err}`);
  }
  return res.json();
}

function buildReceiptEmail(session, payment, store, baseUrl) {
  const sessionName = session.fields.Name || 'Your Booking';
  const storeName = store?.fields?.Name || 'WhatTheFun';
  const contactEmail = store?.fields?.ContactEmail || 'info@tylersmysterytours.com';
  const senderName = store?.fields?.SenderName || storeName;
  const planUrl = `${baseUrl}/?session=${session.id}`;

  const amountStr = `$${(payment.amount || 0).toFixed(2)}`;
  const dateStr = new Date(payment.date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const isProcessing = payment.status === 'processing';
  const processingNote = isProcessing
    ? `<div style="padding: 12px 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; margin: 16px 0; font-size: 14px; color: #856404;">Your bank transfer is processing — funds typically clear in 3–5 business days. We'll update your booking when it's confirmed.</div>`
    : '';

  const feeStr = payment.processingFee ? `$${payment.processingFee.toFixed(2)}` : null;
  const baseAmountStr = payment.baseAmount ? `$${payment.baseAmount.toFixed(2)}` : null;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 28px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.8); margin-bottom: 8px;">Payment Receipt</div>
        <div style="font-size: 22px; font-weight: 700; color: white;">${storeName}</div>
      </div>
      <div style="padding: 28px 32px; background: white; border: 1px solid #eee; border-top: none;">
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Thank you for your payment!</p>

        <div style="background: #f8f9fb; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
          <div style="font-size: 14px; color: #888; margin-bottom: 4px;">Booking</div>
          <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 16px;">${sessionName}</div>

          <div style="font-size: 14px; color: #888; margin-bottom: 4px;">Date</div>
          <div style="font-size: 15px; color: #333; margin-bottom: 16px;">${dateStr}</div>

          <div style="font-size: 14px; color: #888; margin-bottom: 4px;">Method</div>
          <div style="font-size: 15px; color: #333; margin-bottom: 16px;">${payment.method || 'Card'}</div>

          ${baseAmountStr && feeStr ? `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #eee; font-size: 14px; color: #555;">
            <span>Subtotal</span><span>${baseAmountStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #555;">
            <span>Processing fee</span><span>${feeStr}</span>
          </div>
          ` : ''}

          <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #ddd; margin-top: 4px; font-size: 18px; font-weight: 700; color: #28a745;">
            <span>Amount Paid</span><span>${amountStr}</span>
          </div>
        </div>

        ${processingNote}

        <div style="text-align: center; margin: 24px 0;">
          <a href="${planUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">View Your Plan</a>
        </div>

        <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 20px 0 0; text-align: center;">
          Need help with your order? Contact us at
          <a href="mailto:${contactEmail}" style="color: #667eea;">${contactEmail}</a>
        </p>
      </div>
      <div style="padding: 16px 32px; background: #f8f9fb; border: 1px solid #eee; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
        <span style="font-size: 12px; color: #aaa;">${storeName} · Powered by WhatTheFun</span>
      </div>
    </div>
  `;

  return {
    subject: `Payment Receipt — ${sessionName}`,
    html,
    from: `${senderName} <${contactEmail}>`,
  };
}

function buildMerchantNotificationEmail(session, payment, store, baseUrl) {
  const sessionName = session.fields.Name || 'A Booking';
  const storeName = store?.fields?.Name || 'WhatTheFun';
  const contactEmail = store?.fields?.ContactEmail || 'info@tylersmysterytours.com';
  const amountStr = `$${(payment.amount || 0).toFixed(2)}`;
  const customerEmail = payment.customerEmail || 'Unknown';
  const dashboardUrl = store?.fields?.OwnerDashboardID
    ? `${baseUrl}/store-dashboard.html?id=${store.fields.OwnerDashboardID}`
    : baseUrl;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #28a745; padding: 20px 28px; border-radius: 10px 10px 0 0; text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: white;">New Payment Received</div>
      </div>
      <div style="padding: 24px 28px; background: white; border: 1px solid #eee; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; color: #333; margin: 0 0 16px;">A payment of <strong>${amountStr}</strong> was received for <strong>${sessionName}</strong>.</p>
        <div style="background: #f8f9fb; padding: 14px; border-radius: 8px; font-size: 14px; color: #555; margin-bottom: 16px;">
          <div><strong>Customer:</strong> ${customerEmail}</div>
          <div><strong>Method:</strong> ${payment.method || 'Card'}</div>
          <div><strong>Status:</strong> ${payment.status === 'processing' ? 'Processing (ACH)' : 'Succeeded'}</div>
        </div>
        <div style="text-align: center;">
          <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Dashboard</a>
        </div>
      </div>
    </div>
  `;

  return {
    subject: `💰 Payment received: ${amountStr} for ${sessionName}`,
    html,
    to: contactEmail,
    from: `${storeName} <${contactEmail}>`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

  let stripeEvent;
  try {
    const sig = event.headers['stripe-signature'];
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook signature verification failed: ${err.message}` };
  }

  const { type, data } = stripeEvent;
  console.log(`[stripe-webhook] Received event: ${type}, id: ${stripeEvent.id}`);

  try {
    switch (type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
        await handlePaymentIntentUpdate(data.object, type === 'payment_intent.processing' ? 'processing' : 'succeeded');
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(data.object);
        break;

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${type}`);
    }
  } catch (err) {
    console.error(`[stripe-webhook] Error processing ${type}:`, err);
    return { statusCode: 500, body: `Error processing event: ${err.message}` };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function resolveSession(paymentIntent) {
  const sessionId = paymentIntent.metadata?.sessionId;
  if (sessionId) {
    try {
      return await getSessionRecord(sessionId);
    } catch (e) {
      console.warn(`[stripe-webhook] Could not fetch session by metadata sessionId=${sessionId}:`, e.message);
    }
  }

  const fallback = await findSessionByPaymentIntentId(paymentIntent.id);
  if (fallback) return fallback;

  console.warn(`[stripe-webhook] Could not resolve session for paymentIntent ${paymentIntent.id}`);
  return null;
}

async function handlePaymentIntentUpdate(paymentIntent, status) {
  const session = await resolveSession(paymentIntent);
  if (!session) {
    console.warn(`[stripe-webhook] No session found for ${paymentIntent.id}, skipping.`);
    return;
  }

  let paymentHistory = [];
  try {
    paymentHistory = JSON.parse(session.fields.PaymentHistory || '[]');
  } catch (e) {
    paymentHistory = [];
  }

  const existingIdx = paymentHistory.findIndex(p => p.paymentIntentId === paymentIntent.id);

  const baseAmountCents = parseInt(paymentIntent.metadata?.baseAmountInCents || '0', 10);
  const feeCents = parseInt(paymentIntent.metadata?.processingFeeInCents || '0', 10);
  const amount = paymentIntent.amount / 100;

  const methodType = paymentIntent.payment_method_types?.[0] || 'card';
  const methodLabel = methodType === 'us_bank_account' ? 'ACH Bank Transfer'
    : methodType === 'cashapp' ? 'Cash App'
    : 'Card';

  const paymentEntry = {
    paymentIntentId: paymentIntent.id,
    amount,
    baseAmount: baseAmountCents > 0 ? baseAmountCents / 100 : null,
    processingFee: feeCents > 0 ? feeCents / 100 : null,
    date: new Date().toISOString(),
    note: `${methodLabel} on ${new Date().toLocaleDateString()}${status === 'processing' ? ' (processing)' : ''}`,
    method: methodLabel,
    status,
    customerEmail: paymentIntent.metadata?.customerEmail || null,
  };

  if (existingIdx >= 0) {
    paymentHistory[existingIdx] = { ...paymentHistory[existingIdx], ...paymentEntry };
  } else {
    paymentHistory.push(paymentEntry);
  }

  await updateSessionPayment(session.id, paymentHistory, {
    'StripePaymentIntentId': paymentIntent.id,
  });

  console.log(`[stripe-webhook] Updated session ${session.id} for intent ${paymentIntent.id}, status=${status}`);

  const baseUrl = SITE_URL || URL || 'https://whatthefun.wtf';
  let store = null;
  const storeId = session.fields.Store?.[0];
  if (storeId) {
    store = await getStoreRecord(storeId);
  }

  if (status === 'succeeded' || status === 'processing') {
    const customerEmail = paymentIntent.metadata?.customerEmail;
    if (customerEmail) {
      try {
        const receipt = buildReceiptEmail(session, paymentEntry, store, baseUrl);
        await sgMail.send({
          to: customerEmail,
          from: receipt.from,
          subject: receipt.subject,
          html: receipt.html,
        });
        console.log(`[stripe-webhook] Sent receipt email to ${customerEmail}`);
      } catch (emailErr) {
        console.error(`[stripe-webhook] Failed to send receipt email:`, emailErr.message);
      }
    }

    const merchantEmail = store?.fields?.ContactEmail;
    if (merchantEmail) {
      try {
        const notification = buildMerchantNotificationEmail(session, paymentEntry, store, baseUrl);
        await sgMail.send({
          to: notification.to,
          from: notification.from,
          subject: notification.subject,
          html: notification.html,
        });
        console.log(`[stripe-webhook] Sent merchant notification to ${merchantEmail}`);
      } catch (emailErr) {
        console.error(`[stripe-webhook] Failed to send merchant notification:`, emailErr.message);
      }
    }
  }
}

async function handlePaymentIntentFailed(paymentIntent) {
  const session = await resolveSession(paymentIntent);
  if (!session) return;

  let paymentHistory = [];
  try {
    paymentHistory = JSON.parse(session.fields.PaymentHistory || '[]');
  } catch (e) {
    paymentHistory = [];
  }

  const existingIdx = paymentHistory.findIndex(p => p.paymentIntentId === paymentIntent.id);
  const failEntry = {
    paymentIntentId: paymentIntent.id,
    amount: 0,
    date: new Date().toISOString(),
    note: `Payment failed on ${new Date().toLocaleDateString()}`,
    method: paymentIntent.payment_method_types?.[0] || 'unknown',
    status: 'failed',
  };

  if (existingIdx >= 0) {
    paymentHistory[existingIdx] = { ...paymentHistory[existingIdx], ...failEntry };
  } else {
    paymentHistory.push(failEntry);
  }

  await updateSessionPayment(session.id, paymentHistory);
  console.log(`[stripe-webhook] Recorded failed payment for session ${session.id}`);
}

async function handleChargeRefunded(charge) {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) {
    console.warn('[stripe-webhook] charge.refunded without payment_intent, skipping');
    return;
  }

  const session = await findSessionByPaymentIntentId(paymentIntentId);
  if (!session) {
    console.warn(`[stripe-webhook] No session found for refunded charge, pi=${paymentIntentId}`);
    return;
  }

  let paymentHistory = [];
  try {
    paymentHistory = JSON.parse(session.fields.PaymentHistory || '[]');
  } catch (e) {
    paymentHistory = [];
  }

  const existingIdx = paymentHistory.findIndex(p => p.paymentIntentId === paymentIntentId);
  const refundedAmount = charge.amount_refunded / 100;

  if (existingIdx >= 0) {
    paymentHistory[existingIdx].status = 'refunded';
    paymentHistory[existingIdx].refundedAmount = refundedAmount;
    paymentHistory[existingIdx].note += ` | Refunded $${refundedAmount.toFixed(2)} on ${new Date().toLocaleDateString()}`;
  } else {
    paymentHistory.push({
      paymentIntentId,
      amount: 0,
      refundedAmount,
      date: new Date().toISOString(),
      note: `Refund of $${refundedAmount.toFixed(2)} on ${new Date().toLocaleDateString()}`,
      method: 'refund',
      status: 'refunded',
    });
  }

  await updateSessionPayment(session.id, paymentHistory);
  console.log(`[stripe-webhook] Recorded refund for session ${session.id}, amount=$${refundedAmount.toFixed(2)}`);
}
