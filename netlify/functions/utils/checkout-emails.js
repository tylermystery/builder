// FILE: netlify/functions/utils/checkout-emails.js
// Shared builders for the two checkout confirmation emails — the purchaser
// "receipt" and the store-owner "merchant notification". These mirror the
// emails the Stripe webhook sends after a real payment, but accept an
// `options.unpaid` flag so they can also be used for a "saved plan / test
// checkout" where NO payment has been taken yet. When `unpaid` is false (the
// default) the output matches the paid-receipt wording.
//
// Kept self-contained (it duplicates the webhook's wording rather than the
// webhook importing from here) so that touching this file can never change the
// live, revenue-critical Stripe receipt path.

const { SENDER_NAME, SENDER_EMAIL, buildFrom } = require('./email-config');

/**
 * Purchaser-facing email.
 * @param {object} session  Airtable Sessions record
 * @param {object} payment  { amount, method, status, customerEmail, date }
 * @param {object} store    Airtable Stores record (may be null)
 * @param {string} baseUrl  Site base URL
 * @param {object} [options] { unpaid:boolean, amountDue:number }
 */
function buildReceiptEmail(session, payment, store, baseUrl, options = {}) {
  const { unpaid = false, amountDue = payment.amount || 0 } = options;
  const sessionName = session.fields.Name || 'Your Booking';
  const storeName = store?.fields?.Name || SENDER_NAME;
  const contactEmail = store?.fields?.ContactEmail || SENDER_EMAIL;
  const senderName = store?.fields?.SenderName || storeName;
  const planUrl = `${baseUrl}/?session=${session.id}`;

  const shownAmount = unpaid ? amountDue : (payment.amount || 0);
  const amountStr = `$${(shownAmount || 0).toFixed(2)}`;
  const dateStr = new Date(payment.date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Wording differs only for the "saved plan / no payment taken yet" case.
  const headerKicker = unpaid ? 'Plan Saved' : 'Payment Receipt';
  const introLine = unpaid
    ? 'Your plan is saved. No payment has been taken yet — open it any time to review and pay.'
    : 'Thank you for your payment!';
  const amountLabel = unpaid ? 'Amount Due' : 'Amount Paid';
  const amountColor = unpaid ? '#b8860b' : '#28a745';
  const ctaLabel = unpaid ? 'Open Plan &amp; Pay' : 'View Your Plan';

  const isProcessing = payment.status === 'processing';
  const processingNote = isProcessing
    ? `<div style="padding: 12px 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; margin: 16px 0; font-size: 14px; color: #856404;">Your bank transfer is processing — funds typically clear in 3–5 business days. We'll update your booking when it's confirmed.</div>`
    : '';

  const feeStr = payment.processingFee ? `$${payment.processingFee.toFixed(2)}` : null;
  const baseAmountStr = payment.baseAmount ? `$${payment.baseAmount.toFixed(2)}` : null;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 28px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.8); margin-bottom: 8px;">${headerKicker}</div>
        <div style="font-size: 22px; font-weight: 700; color: white;">${storeName}</div>
      </div>
      <div style="padding: 28px 32px; background: white; border: 1px solid #eee; border-top: none;">
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">${introLine}</p>

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

          <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #ddd; margin-top: 4px; font-size: 18px; font-weight: 700; color: ${amountColor};">
            <span>${amountLabel}</span><span>${amountStr}</span>
          </div>
        </div>

        ${processingNote}

        <div style="text-align: center; margin: 24px 0;">
          <a href="${planUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">${ctaLabel}</a>
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
    subject: unpaid ? `Your plan is saved — ${sessionName}` : `Payment Receipt — ${sessionName}`,
    html,
    from: buildFrom(senderName, contactEmail),
  };
}

/**
 * Store-owner-facing email.
 * @param {object} session  Airtable Sessions record
 * @param {object} payment  { amount, method, status, customerEmail }
 * @param {object} store    Airtable Stores record (may be null)
 * @param {string} baseUrl  Site base URL
 * @param {object} [options] { unpaid:boolean, amountDue:number }
 */
function buildMerchantNotificationEmail(session, payment, store, baseUrl, options = {}) {
  const { unpaid = false, amountDue = payment.amount || 0 } = options;
  const sessionName = session.fields.Name || 'A Booking';
  const storeName = store?.fields?.Name || SENDER_NAME;
  const contactEmail = store?.fields?.ContactEmail || SENDER_EMAIL;
  const shownAmount = unpaid ? amountDue : (payment.amount || 0);
  const amountStr = `$${(shownAmount || 0).toFixed(2)}`;
  const customerEmail = payment.customerEmail || 'Unknown';
  const customerName = payment.customerName ? `${payment.customerName} (${customerEmail})` : customerEmail;
  const dashboardUrl = store?.fields?.OwnerDashboardID
    ? `${baseUrl}/store-dashboard.html?id=${store.fields.OwnerDashboardID}`
    : baseUrl;

  const bannerColor = unpaid ? '#667eea' : '#28a745';
  const bannerTitle = unpaid ? 'New Saved Plan' : 'New Payment Received';
  const bodyLine = unpaid
    ? `A plan was saved for <strong>${sessionName}</strong>. No payment has been collected yet — the customer received a link to open the plan and pay.`
    : `A payment of <strong>${amountStr}</strong> was received for <strong>${sessionName}</strong>.`;
  const statusLine = unpaid ? 'Saved — awaiting payment' : (payment.status === 'processing' ? 'Processing (ACH)' : 'Succeeded');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: ${bannerColor}; padding: 20px 28px; border-radius: 10px 10px 0 0; text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: white;">${bannerTitle}</div>
      </div>
      <div style="padding: 24px 28px; background: white; border: 1px solid #eee; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; color: #333; margin: 0 0 16px;">${bodyLine}</p>
        <div style="background: #f8f9fb; padding: 14px; border-radius: 8px; font-size: 14px; color: #555; margin-bottom: 16px;">
          <div><strong>Customer:</strong> ${customerName}</div>
          <div><strong>Amount ${unpaid ? 'due' : 'paid'}:</strong> ${amountStr}</div>
          <div><strong>Method:</strong> ${payment.method || 'Card'}</div>
          <div><strong>Status:</strong> ${statusLine}</div>
        </div>
        <div style="text-align: center;">
          <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background: ${bannerColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Dashboard</a>
        </div>
      </div>
    </div>
  `;

  return {
    subject: unpaid
      ? `📝 Plan saved: ${sessionName}`
      : `💰 Payment received: ${amountStr} for ${sessionName}`,
    html,
    to: contactEmail,
    from: buildFrom(storeName, contactEmail),
  };
}

module.exports = { buildReceiptEmail, buildMerchantNotificationEmail };
