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
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { phoneNumber } = JSON.parse(event.body);

        if (!phoneNumber) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Phone number is required.' })
            };
        }

        // Normalize phone number (ensure it starts with +)
        const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

        console.log(`[auth-sms-start] SMS auth requested for: ${normalizedPhone}`);

        // Generate 6-digit OTP code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const channelId = crypto.randomBytes(12).toString('hex'); // For real-time confirmation
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP expires in 10 minutes

        console.log(`[auth-sms-start] Generated OTP: ${otpCode} (expires: ${expiresAt.toISOString()})`);

        // Store the OTP code in Airtable
        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes`;
        const airtableResponse = await fetch(airtableUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                records: [{
                    fields: {
                        Code: otpCode,
                        PhoneNumber: normalizedPhone,
                        ExpiresAt: expiresAt.toISOString(),
                        ChannelID: channelId
                    }
                }]
            })
        });

        if (!airtableResponse.ok) {
            const errorData = await airtableResponse.json();
            console.error('[auth-sms-start] Airtable error:', errorData);
            throw new Error('Could not store SMS code in database.');
        }

        console.log('[auth-sms-start] OTP stored in Airtable successfully.');

        // Send SMS via Twilio
        const smsBody = `Your TMT authentication code is: ${otpCode}\n\nThis code expires in 10 minutes. Do not share this code with anyone.`;

        try {
            const message = await twilioClient.messages.create({
                body: smsBody,
                from: TWILIO_PHONE_NUMBER,
                to: normalizedPhone
            });

            console.log(`[auth-sms-start] SMS sent successfully. SID: ${message.sid}`);
        } catch (twilioError) {
            console.error('[auth-sms-start] Twilio error:', twilioError);

            // Clean up the stored code if SMS fails
            await airtableResponse.json().then(data => {
                if (data.records && data.records[0]) {
                    fetch(`https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes/${data.records[0].id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
                    }).catch(err => console.error('[auth-sms-start] Cleanup error:', err));
                }
            });

            throw new Error('Failed to send SMS. Please check the phone number and try again.');
        }

        // Return success with channelId for real-time confirmation
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'SMS code sent successfully.',
                channelId: channelId
            }),
        };
    } catch (error) {
        console.error('[auth-sms-start] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'An internal error occurred.'
            }),
        };
    }
};
