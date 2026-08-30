const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { SENDER_EMAIL, SENDER_NAME, buildFrom } = require('./utils/email-config');
const { buildReceiptEmail, buildMerchantNotificationEmail, loadCheckoutEmailDetails } = require('./utils/checkout-emails');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

const SESSIONS_TABLE = 'Sessions';
const STORES_TABLE = 'Stores';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { sessionId, amount, method, note, storeOwnerId, sendReceipt, customerName, customerEmail } = body;

    if (!sessionId || !amount || !storeOwnerId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sessionId, amount, and storeOwnerId are required.' }) };
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Amount must be a positive number.' }) };
    }

    const validMethods = ['direct-cash', 'direct-check', 'direct-etransfer', 'direct-other'];
    const paymentMethod = validMethods.includes(method) ? method : 'direct-other';

    // Escape single quotes so IDs containing them don't break the formula.
    const safeStoreOwnerId = String(storeOwnerId).replace(/'/g, "\\'");
    const storeFormula = `({OwnerDashboardID} = '${safeStoreOwnerId}')`;
    const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE}?filterByFormula=${encodeURIComponent(storeFormula)}&maxRecords=1`;
    const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    const storeData = await storeRes.json();

    if (!storeData.records || storeData.records.length === 0) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Store not found for this owner.' }) };
    }

    const store = storeData.records[0];

    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}/${sessionId}`;
    const sessionRes = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!sessionRes.ok) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Session not found.' }) };
    }
    const session = await sessionRes.json();

    let paymentHistory = [];
    try {
      paymentHistory = JSON.parse(session.fields.PaymentHistory || '[]');
    } catch (e) {
      paymentHistory = [];
    }

    const methodLabels = {
      'direct-cash': 'Cash',
      'direct-check': 'Check',
      'direct-etransfer': 'E-Transfer',
      'direct-other': 'Direct Payment',
    };

    const newEntry = {
      paymentIntentId: null,
      amount,
      date: new Date().toISOString(),
      note: note || `${methodLabels[paymentMethod]} recorded by ${store.fields.Name}`,
      method: methodLabels[paymentMethod],
      status: 'succeeded',
      recordedBy: storeOwnerId,
      recordedAt: new Date().toISOString(),
    };

    paymentHistory.push(newEntry);
    const newTotal = paymentHistory.reduce((sum, p) => sum + (p.amount || 0), 0);

    const updateRes = await fetch(sessionUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Amount Received': newTotal,
          'PaymentHistory': JSON.stringify(paymentHistory, null, 2),
        },
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new Error(`Failed to update session: ${errText}`);
    }

    const baseUrl = SITE_URL || URL || 'https://whatthefun.wtf';
    const receiptPayment = {
      amount,
      method: methodLabels[paymentMethod],
      status: 'succeeded',
      date: newEntry.date,
      customerEmail: customerEmail || null,
      customerName: customerName || null,
    };
    let emailDetails = {};
    try {
      emailDetails = await loadCheckoutEmailDetails(session);
    } catch (emailErr) {
      console.error('[record-direct-payment] Failed to load receipt details:', emailErr.message);
    }

    if (sendReceipt) {
      // The full payment record drives the shared receipt template (the same one
      // online card payments use), so a manually-recorded payment produces an
      // identical, branded receipt.

      // Collect every address that should receive the receipt: the customer's
      // email entered at the dashboard (if any), plus any collaborator accounts
      // already linked to the session — de-duplicated so nobody is emailed twice.
      const recipients = new Map(); // lower-cased email -> display name
      if (customerEmail) recipients.set(customerEmail.toLowerCase(), customerName || '');

      const collaboratorIds = session.fields.Collaborators || [];
      if (collaboratorIds.length > 0) {
        try {
          const formula = `OR(${collaboratorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
          const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
          const usersRes = await fetch(usersUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
          if (usersRes.ok) {
            const { records: users } = await usersRes.json();
            for (const user of users) {
              const email = user.fields.Email;
              if (email && !recipients.has(email.toLowerCase())) {
                recipients.set(email.toLowerCase(), user.fields.Name || '');
              }
            }
          }
        } catch (lookupErr) {
          console.error('[record-direct-payment] Failed to look up collaborators:', lookupErr.message);
        }
      }

      if (recipients.size === 0) {
        console.warn('[record-direct-payment] Receipt requested but no recipient email available.');
      }

      const emailFrom = buildFrom(store.fields.Name || SENDER_NAME, store.fields.ContactEmail || SENDER_EMAIL);
      for (const [email, name] of recipients) {
        try {
          const receipt = buildReceiptEmail(
            session,
            { ...receiptPayment, customerEmail: email, customerName: name || customerName || null },
            store,
            baseUrl,
            { unpaid: false, amountDue: amount, ...emailDetails }
          );
          await sgMail.send({ to: email, from: receipt.from || emailFrom, subject: receipt.subject, html: receipt.html });
          console.log(`[record-direct-payment] Receipt sent to ${email}`);
        } catch (emailErr) {
          console.error(`[record-direct-payment] Failed to email ${email}:`, emailErr.message);
        }
      }
    }

    const merchantEmail = store.fields.ContactEmail || SENDER_EMAIL;
    if (merchantEmail) {
      try {
        const notification = buildMerchantNotificationEmail(
          session,
          receiptPayment,
          store,
          baseUrl,
          { unpaid: false, amountDue: amount, ...emailDetails }
        );
        await sgMail.send({
          to: merchantEmail,
          from: notification.from,
          subject: notification.subject,
          html: notification.html,
        });
        console.log(`[record-direct-payment] Merchant receipt sent to ${merchantEmail}`);
      } catch (emailErr) {
        console.error(`[record-direct-payment] Failed to email merchant receipt:`, emailErr.message);
      }
    }

    console.log(`[record-direct-payment] Recorded ${paymentMethod} payment of $${amount.toFixed(2)} for session ${sessionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Direct payment recorded successfully.',
        newTotal,
        paymentCount: paymentHistory.length,
      }),
    };
  } catch (error) {
    console.error('[record-direct-payment] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
