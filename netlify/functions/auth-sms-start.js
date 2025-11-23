// SMS-based authentication starter
// Sends a 6-digit OTP code via SMS using Twilio

const fetch = require('node-fetch');
const twilio = require('twilio');
const crypto = require('crypto');

const {
  AIRTABLE_PAT,
  BASE_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER
} = process.env;

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

exports.handler = async (event) => {
    console.log('[SMS-START-DEBUG] ========== Function invoked ==========');
    console.log('[SMS-START-DEBUG] HTTP Method:', event.httpMethod);
    console.log('[SMS-START-DEBUG] Request headers:', JSON.stringify(event.headers));
    console.log('[SMS-START-DEBUG] Request body (raw):', event.body);

    if (event.httpMethod !== 'POST') {
        console.log('[SMS-START-DEBUG] Invalid HTTP method - returning 405');
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log('[SMS-START-DEBUG] Parsing request body');
        const { phoneNumber } = JSON.parse(event.body);
        console.log('[SMS-START-DEBUG] Parsed phoneNumber:', phoneNumber);

        if (!phoneNumber) {
            console.log('[SMS-START-DEBUG] Phone number validation failed - returning 400');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Phone number is required.' })
            };
        }

        // Normalize phone number (ensure it starts with +)
        const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
        console.log('[SMS-START-DEBUG] Normalized phone number:', normalizedPhone);

        console.log(`[auth-sms-start] SMS auth requested for: ${normalizedPhone}`);

        // Check environment variables
        console.log('[SMS-START-DEBUG] Environment variable checks:');
        console.log('[SMS-START-DEBUG] - TWILIO_ACCOUNT_SID exists:', !!TWILIO_ACCOUNT_SID);
        console.log('[SMS-START-DEBUG] - TWILIO_AUTH_TOKEN exists:', !!TWILIO_AUTH_TOKEN);
        console.log('[SMS-START-DEBUG] - TWILIO_PHONE_NUMBER exists:', !!TWILIO_PHONE_NUMBER);
        console.log('[SMS-START-DEBUG] - TWILIO_PHONE_NUMBER value:', TWILIO_PHONE_NUMBER);
        console.log('[SMS-START-DEBUG] - AIRTABLE_PAT exists:', !!AIRTABLE_PAT);
        console.log('[SMS-START-DEBUG] - BASE_ID exists:', !!BASE_ID);

        // Check if user has opted out
        console.log('[SMS-START-DEBUG] Checking opt-out status...');
        const optOutCheckUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Opt-Outs?filterByFormula=({PhoneNumber}='${normalizedPhone}')`;

        try {
            const optOutResponse = await fetch(optOutCheckUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            if (optOutResponse.ok) {
                const optOutData = await optOutResponse.json();
                console.log('[SMS-START-DEBUG] Opt-out check response:', JSON.stringify(optOutData));

                if (optOutData.records && optOutData.records.length > 0) {
                    console.log('[SMS-START-DEBUG] User has opted out - blocking SMS');
                    return {
                        statusCode: 403,
                        body: JSON.stringify({
                            error: 'This phone number has opted out of SMS messages. Please reply START to your last message to opt back in, or use a different sign-in method.'
                        })
                    };
                }
                console.log('[SMS-START-DEBUG] No opt-out found - proceeding');
            }
        } catch (optOutError) {
            console.error('[SMS-START-DEBUG] Error checking opt-out status:', optOutError);
            // Continue anyway - don't block on opt-out check failure
        }

        // Generate 6-digit OTP code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const channelId = crypto.randomBytes(12).toString('hex'); // For real-time confirmation
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP expires in 10 minutes

        console.log(`[auth-sms-start] Generated OTP: ${otpCode} (expires: ${expiresAt.toISOString()})`);
        console.log('[SMS-START-DEBUG] Channel ID:', channelId);

        // Store the OTP code in Airtable
        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes`;
        console.log('[SMS-START-DEBUG] Airtable URL:', airtableUrl);
        console.log('[SMS-START-DEBUG] Storing OTP in Airtable...');

        // Build fields object - start with required fields only
        const fields = {
            Code: otpCode,
            PhoneNumber: normalizedPhone,
            ExpiresAt: expiresAt.toISOString(),
            ChannelID: channelId
        };

        // Try to add consent fields, but don't fail if they don't work
        // The first request will try with consent fields
        const airtablePayload = {
            records: [{
                fields: {
                    ...fields,
                    ConsentGranted: true,
                    ConsentTimestamp: new Date().toISOString(),
                    ConsentSource: 'web_form'
                }
            }]
        };
        console.log('[SMS-START-DEBUG] Airtable payload (with consent fields):', JSON.stringify(airtablePayload));

        const airtableResponse = await fetch(airtableUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(airtablePayload)
        });

        console.log('[SMS-START-DEBUG] Airtable response status:', airtableResponse.status);
        console.log('[SMS-START-DEBUG] Airtable response ok:', airtableResponse.ok);

        let airtableData; // Declare outside so it's available for cleanup later

        if (!airtableResponse.ok) {
            const errorText = await airtableResponse.text();
            console.error('[auth-sms-start] Airtable error status:', airtableResponse.status);
            console.error('[SMS-START-DEBUG] Full Airtable error response (text):', errorText);

            let errorData;
            try {
                errorData = JSON.parse(errorText);
                console.error('[SMS-START-DEBUG] Parsed error data:', JSON.stringify(errorData, null, 2));
            } catch (e) {
                console.error('[SMS-START-DEBUG] Could not parse error as JSON');
            }

            // Check if the error is about unknown fields (consent fields might not exist)
            const errorMessage = errorData?.error?.message || errorText || '';

            // Handle different types of Airtable errors
            if (errorMessage.includes('Could not find table')) {
                console.error('[SMS-START-DEBUG] SMS Codes table does not exist in Airtable');
                throw new Error('SMS authentication is not configured. Please create the "SMS Codes" table in Airtable with fields: Code, PhoneNumber, ExpiresAt, ChannelID');
            }

            if (errorMessage.includes('Unknown field name') || errorMessage.includes('field')) {
                console.log('[SMS-START-DEBUG] Field error detected - retrying without consent fields');

                // Retry without consent fields
                const simplePayload = {
                    records: [{
                        fields: fields // Just the basic required fields
                    }]
                };
                console.log('[SMS-START-DEBUG] Retrying with simple payload:', JSON.stringify(simplePayload));

                const retryResponse = await fetch(airtableUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_PAT}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(simplePayload)
                });

                console.log('[SMS-START-DEBUG] Retry response status:', retryResponse.status);

                if (!retryResponse.ok) {
                    const retryErrorText = await retryResponse.text();
                    console.error('[SMS-START-DEBUG] Retry also failed:', retryErrorText);
                    throw new Error(`Airtable error after retry: ${retryErrorText}`);
                }

                // Success on retry!
                airtableData = await retryResponse.json();
                console.log('[auth-sms-start] OTP stored in Airtable successfully (without consent fields).');
                console.log('[SMS-START-DEBUG] Airtable response data:', JSON.stringify(airtableData));
            } else {
                // Different error, not about fields
                const errorMsg = errorData?.error?.message || errorData?.error || 'Could not store SMS code in database.';
                throw new Error(`Airtable error: ${errorMsg}`);
            }
        } else {
            // First attempt succeeded
            airtableData = await airtableResponse.json();
            console.log('[auth-sms-start] OTP stored in Airtable successfully.');
            console.log('[SMS-START-DEBUG] Airtable response data:', JSON.stringify(airtableData));
        }

        // Send SMS via Twilio
        const smsBody = `Your WTFun authentication code is: ${otpCode}

This code expires in 10 minutes. Reply STOP to opt out. Msg&data rates may apply.`;
        console.log('[SMS-START-DEBUG] SMS body to send:', smsBody);
        console.log('[SMS-START-DEBUG] Sending SMS from:', TWILIO_PHONE_NUMBER, 'to:', normalizedPhone);

        try {
            console.log('[SMS-START-DEBUG] Calling Twilio API...');
            const message = await twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: normalizedPhone
            });

            console.log(`[auth-sms-start] SMS sent successfully. SID: ${message.sid}`);
            console.log('[SMS-START-DEBUG] Twilio message status:', message.status);
            console.log('[SMS-START-DEBUG] Twilio message error_code:', message.error_code);
            console.log('[SMS-START-DEBUG] Twilio message error_message:', message.error_message);
            console.log('[SMS-START-DEBUG] Full Twilio response:', JSON.stringify(message));
        } catch (twilioError) {
            console.error('[auth-sms-start] Twilio error:', twilioError);
            console.error('[SMS-START-DEBUG] Twilio error name:', twilioError.name);
            console.error('[SMS-START-DEBUG] Twilio error message:', twilioError.message);
            console.error('[SMS-START-DEBUG] Twilio error code:', twilioError.code);
            console.error('[SMS-START-DEBUG] Twilio error status:', twilioError.status);
            console.error('[SMS-START-DEBUG] Twilio error stack:', twilioError.stack);
            console.error('[SMS-START-DEBUG] Full Twilio error object:', JSON.stringify(twilioError, null, 2));

            // Clean up the stored code if SMS fails
            console.log('[SMS-START-DEBUG] Cleaning up stored OTP code due to Twilio error...');
            if (airtableData.records && airtableData.records[0]) {
                const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes/${airtableData.records[0].id}`;
                console.log('[SMS-START-DEBUG] Delete URL:', deleteUrl);
                try {
                    const deleteResponse = await fetch(deleteUrl, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
                    });
                    console.log('[SMS-START-DEBUG] Cleanup response status:', deleteResponse.status);
                } catch (err) {
                    console.error('[auth-sms-start] Cleanup error:', err);
                    console.error('[SMS-START-DEBUG] Cleanup error details:', JSON.stringify(err));
                }
            }

            throw new Error('Failed to send SMS. Please check the phone number and try again.');
        }

        // Return success with channelId for real-time confirmation
        const successResponse = {
            message: 'SMS code sent successfully.',
            channelId: channelId
        };
        console.log('[SMS-START-DEBUG] Returning success response:', JSON.stringify(successResponse));
        console.log('[SMS-START-DEBUG] ========== Function completed successfully ==========');

        return {
            statusCode: 200,
            body: JSON.stringify(successResponse),
        };
    } catch (error) {
        console.error('[auth-sms-start] Error:', error);
        console.error('[SMS-START-DEBUG] ========== ERROR IN FUNCTION ==========');
        console.error('[SMS-START-DEBUG] Error name:', error.name);
        console.error('[SMS-START-DEBUG] Error message:', error.message);
        console.error('[SMS-START-DEBUG] Error stack:', error.stack);
        console.error('[SMS-START-DEBUG] Full error object:', JSON.stringify(error, null, 2));

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'An internal error occurred.'
            }),
        };
    }
};
