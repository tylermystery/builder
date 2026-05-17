const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { SENDER_EMAIL, SENDER_NAME } = require('./utils/email-config');

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
    const { sessionId, amount, method, note, storeOwnerId, sendReceipt } = body;

    if (!sessionId || !amount || !storeOwnerId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sessionId, amount, and storeOwnerId are required.' }) };
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Amount must be a positive number.' }) };
    }

    const validMethods = ['direct-cash', 'direct-check', 'direct-etransfer', 'direct-other'];
    const paymentMethod = validMethods.includes(method) ? method : 'direct-other';

    const storeFormula = `({OwnerDashboardID} = '${storeOwnerId}')`;
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

    if (sendReceipt) {
      const baseUrl = SITE_URL || URL || 'https://whatthefun.wtf';
      const collaboratorIds = session.fields.Collaborators || [];
      if (collaboratorIds.length > 0) {
        try {
          const formula = `OR(${collaboratorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
          const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
          const usersRes = await fetch(usersUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
          if (usersRes.ok) {
            const { records: users } = await usersRes.json();
            const sessionName = session.fields.Name || 'Your Booking';
            const storeName = store.fields.Name || SENDER_NAME;
            const contactEmail = store.fields.ContactEmail || SENDER_EMAIL;
            const planUrl = `${baseUrl}/?session=${sessionId}`;

            for (const user of users) {
              if (!user.fields.Email) continue;
              try {
                await sgMail.send({
                  to: user.fields.Email,
                  from: `${storeName} <${contactEmail}>`,
                  subject: `Payment Recorded — ${sessionName}`,
                  html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
                      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px 28px; border-radius: 12px 12px 0 0; text-align: center;">
                        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.8); margin-bottom: 6px;">Payment Recorded</div>
                        <div style="font-size: 20px; font-weight: 700; color: white;">${storeName}</div>
                      </div>
                      <div style="padding: 24px 28px; background: white; border: 1px solid #eee; border-top: none; border-radius: 0 0 12px 12px;">
                        <p style="color: #555; font-size: 15px;">Hi ${user.fields.Name || 'there'},</p>
                        <p style="color: #555; font-size: 15px;">${storeName} has recorded a <strong>${methodLabels[paymentMethod]}</strong> payment of <strong>$${amount.toFixed(2)}</strong> for your booking <strong>${sessionName}</strong>.</p>
                        ${note ? `<p style="color: #888; font-size: 14px; font-style: italic;">Note: ${note}</p>` : ''}
                        <div style="text-align: center; margin: 20px 0;">
                          <a href="${planUrl}" style="display: inline-block; padding: 10px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">View Your Plan</a>
                        </div>
                        <p style="color: #888; font-size: 13px; text-align: center;">Questions? Contact <a href="mailto:${contactEmail}" style="color: #667eea;">${contactEmail}</a></p>
                      </div>
                    </div>
                  `,
                });
              } catch (emailErr) {
                console.error(`[record-direct-payment] Failed to email ${user.fields.Email}:`, emailErr.message);
              }
            }
          }
        } catch (emailErr) {
          console.error('[record-direct-payment] Failed to send receipt emails:', emailErr.message);
        }
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
