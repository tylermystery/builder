// Twilio SMS Webhook Handler
// Handles incoming SMS messages (e.g., STOP, START, HELP commands)

const fetch = require('node-fetch');

const {
  AIRTABLE_PAT,
  BASE_ID
} = process.env;

exports.handler = async (event) => {
    console.log('[SMS-WEBHOOK] ========== Function invoked ==========');
    console.log('[SMS-WEBHOOK] HTTP Method:', event.httpMethod);
    console.log('[SMS-WEBHOOK] Request headers:', JSON.stringify(event.headers));
    console.log('[SMS-WEBHOOK] Request body (raw):', event.body);

    if (event.httpMethod !== 'POST') {
        console.log('[SMS-WEBHOOK] Invalid HTTP method - returning 405');
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    try {
        // Parse Twilio's webhook data (application/x-www-form-urlencoded)
        const params = new URLSearchParams(event.body);
        const from = params.get('From');
        const body = params.get('Body');
        const messageSid = params.get('MessageSid');

        console.log('[SMS-WEBHOOK] From:', from);
        console.log('[SMS-WEBHOOK] Body:', body);
        console.log('[SMS-WEBHOOK] MessageSid:', messageSid);

        if (!from || !body) {
            console.log('[SMS-WEBHOOK] Missing required parameters');
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'text/xml' },
                body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
            };
        }

        // Normalize phone number
        const normalizedPhone = from.startsWith('+') ? from : `+${from}`;
        const messageText = body.trim().toUpperCase();

        console.log('[SMS-WEBHOOK] Normalized phone:', normalizedPhone);
        console.log('[SMS-WEBHOOK] Message text (uppercase):', messageText);

        // Handle STOP command (opt-out)
        if (messageText === 'STOP' || messageText === 'UNSUBSCRIBE' || messageText === 'CANCEL' || messageText === 'END' || messageText === 'QUIT') {
            console.log('[SMS-WEBHOOK] STOP command detected - processing opt-out');

            // Record opt-out in Airtable
            const optOutUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Opt-Outs`;
            const optOutPayload = {
                records: [{
                    fields: {
                        PhoneNumber: normalizedPhone,
                        OptOutTimestamp: new Date().toISOString(),
                        OptOutMethod: 'SMS_STOP_COMMAND'
                    }
                }]
            };

            console.log('[SMS-WEBHOOK] Recording opt-out in Airtable...');
            const optOutResponse = await fetch(optOutUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_PAT}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(optOutPayload)
            });

            console.log('[SMS-WEBHOOK] Opt-out response status:', optOutResponse.status);

            if (optOutResponse.ok) {
                console.log('[SMS-WEBHOOK] Opt-out recorded successfully');
            } else {
                const errorData = await optOutResponse.json();
                console.error('[SMS-WEBHOOK] Error recording opt-out:', errorData);
            }

            // Twilio automatically handles STOP commands, so we just acknowledge
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/xml' },
                body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
            };
        }

        // Handle START command (opt-in again)
        if (messageText === 'START' || messageText === 'UNSTOP') {
            console.log('[SMS-WEBHOOK] START command detected - processing opt-in');

            // Check if user has an opt-out record and delete it
            const findOptOutUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Opt-Outs?filterByFormula=({PhoneNumber}='${normalizedPhone}')`;

            console.log('[SMS-WEBHOOK] Checking for existing opt-out records...');
            const findResponse = await fetch(findOptOutUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            if (findResponse.ok) {
                const findData = await findResponse.json();
                console.log('[SMS-WEBHOOK] Found', findData.records?.length || 0, 'opt-out records');

                // Delete all opt-out records for this number
                if (findData.records && findData.records.length > 0) {
                    for (const record of findData.records) {
                        const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Opt-Outs/${record.id}`;
                        await fetch(deleteUrl, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
                        });
                        console.log('[SMS-WEBHOOK] Deleted opt-out record:', record.id);
                    }
                }
            }

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/xml' },
                body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
            };
        }

        // Handle HELP command
        if (messageText === 'HELP' || messageText === 'INFO') {
            console.log('[SMS-WEBHOOK] HELP command detected');

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/xml' },
                body: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>WTFun SMS Authentication. Reply STOP to opt out.</Message>
</Response>`
            };
        }

        // For any other message, just acknowledge
        console.log('[SMS-WEBHOOK] Unknown command - acknowledging');
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/xml' },
            body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        };

    } catch (error) {
        console.error('[SMS-WEBHOOK] ========== ERROR IN FUNCTION ==========');
        console.error('[SMS-WEBHOOK] Error name:', error.name);
        console.error('[SMS-WEBHOOK] Error message:', error.message);
        console.error('[SMS-WEBHOOK] Error stack:', error.stack);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/xml' },
            body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        };
    }
};
