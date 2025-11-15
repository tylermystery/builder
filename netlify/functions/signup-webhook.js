const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    console.log('[signup-webhook] ========== WEBHOOK TRIGGERED ==========');
    console.log('[signup-webhook] Timestamp:', new Date().toISOString());
    console.log('[signup-webhook] Event type:', event.httpMethod);
    console.log('[signup-webhook] Headers:', JSON.stringify(event.headers));
    console.log('[signup-webhook] Body:', event.body);
    
    if (event.httpMethod !== 'POST') {
        console.log('[signup-webhook] Invalid method:', event.httpMethod);
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        console.log('[signup-webhook] Parsing webhook body...');
        const payload = JSON.parse(event.body);
        console.log('[signup-webhook] Webhook event:', payload.event);
        console.log('[signup-webhook] Full payload:', JSON.stringify(payload, null, 2));
        
        const { user } = payload;
        if (!user) {
            console.error('[signup-webhook] No user object in webhook payload');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No user data provided' })
            };
        }

        const { email, user_metadata } = user;
        console.log('[signup-webhook] User email:', email);
        console.log('[signup-webhook] User metadata:', JSON.stringify(user_metadata));
        
        const name = user_metadata?.full_name || email.split('@')[0];
        console.log('[signup-webhook] Extracted name:', name);

        const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
        const BASE_ID = process.env.BASE_ID;

        if (!AIRTABLE_PAT || !BASE_ID) {
            console.error('[signup-webhook] Missing required environment variables');
            console.error('[signup-webhook] AIRTABLE_PAT exists:', !!AIRTABLE_PAT);
            console.error('[signup-webhook] BASE_ID exists:', !!BASE_ID);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Server configuration error' })
            };
        }

        console.log('[signup-webhook] Checking if user exists in Airtable...');
        const formula = `{Email}='${email}'`;
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
        console.log('[signup-webhook] Query URL:', findUserUrl);
        const findRes = await fetch(findUserUrl, { 
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } 
        });
        
        if (!findRes.ok) {
            console.error('[signup-webhook] Airtable find user failed:', findRes.status, findRes.statusText);
            const errorText = await findRes.text();
            console.error('[signup-webhook] Error response:', errorText);
            throw new Error(`Airtable API error: ${findRes.status}`);
        }

        const existing = await findRes.json();
        console.log('[signup-webhook] Found existing records:', existing.records?.length || 0);

        if (existing.records && existing.records.length > 0) {
            console.log(`[signup-webhook] User ${email} already exists in Airtable (ID: ${existing.records[0].id})`);
            return { 
                statusCode: 200, 
                body: JSON.stringify({ message: 'User already exists' })
            };
        }

        console.log('[signup-webhook] Creating new user in Airtable...');
        const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users`;
        const createRes = await fetch(createUserUrl, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${AIRTABLE_PAT}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                records: [{ 
                    fields: { 
                        Email: email, 
                        Name: name 
                    } 
                }] 
            })
        });

        if (!createRes.ok) {
            console.error('[signup-webhook] Airtable create user failed:', createRes.status, createRes.statusText);
            const errorText = await createRes.text();
            console.error('[signup-webhook] Error response:', errorText);
            throw new Error(`Failed to create user: ${createRes.status}`);
        }

        const createResult = await createRes.json();
        console.log('[signup-webhook] Successfully created user:', createResult.records[0].id);
        console.log('[signup-webhook] ========== WEBHOOK COMPLETE ==========');

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                message: 'User created successfully',
                userId: createResult.records[0].id
            })
        };

    } catch (error) {
        console.error('[signup-webhook] ========== ERROR ==========');
        console.error('[signup-webhook] Error name:', error.name);
        console.error('[signup-webhook] Error message:', error.message);
        console.error('[signup-webhook] Error stack:', error.stack);
        
        return { 
            statusCode: 500, 
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            })
        };
    }
};
