const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { generateICalContent, generateCalendarLinks } = require('./utils/ical-generator');

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.BASE_ID || 'app5yTznb3R5YNUFw';
const ITEMS_TABLE_NAME = 'Items';
const USERS_TABLE_NAME = 'Users';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SITE_URL = process.env.SITE_URL || process.env.URL;

sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Missing or invalid authorization token' })
        };
    }

    const token = authHeader.substring(7);
    let userId;
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload.exp * 1000 < Date.now()) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Token expired' })
            };
        }
        userId = payload.userId;
    } catch (error) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid token' })
        };
    }

    const { eventId, action } = JSON.parse(event.body);

    if (!eventId || !action) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing eventId or action' })
        };
    }

    if (action !== 'add' && action !== 'remove') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid action. Must be "add" or "remove"' })
        };
    }

    try {
        const eventUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE_NAME}/${eventId}`;
        
        const getResponse = await fetch(eventUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        if (!getResponse.ok) {
            throw new Error(`Failed to fetch event: ${getResponse.statusText}`);
        }

        const eventRecord = await getResponse.json();
        
        if (eventRecord.fields['Item Type'] !== 'Event') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Record is not an event' })
            };
        }

        let currentRsvps = eventRecord.fields.RSVPs || [];
        
        let updated = false;
        if (action === 'add' && !currentRsvps.includes(userId)) {
            currentRsvps.push(userId);
            updated = true;
        } else if (action === 'remove' && currentRsvps.includes(userId)) {
            currentRsvps = currentRsvps.filter(id => id !== userId);
            updated = true;
        }

        if (updated) {
            const patchResponse = await fetch(eventUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_PAT}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: {
                        RSVPs: currentRsvps
                    }
                })
            });

            if (!patchResponse.ok) {
                throw new Error(`Failed to update RSVPs: ${patchResponse.statusText}`);
            }

            if (action === 'add') {
                try {
                    const userUrl = `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_NAME}/${userId}`;
                    const userResponse = await fetch(userUrl, {
                        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
                    });

                    if (userResponse.ok) {
                        const userRecord = await userResponse.json();
                        const userEmail = userRecord.fields.Email;
                        const userName = userRecord.fields.Name || 'there';

                        if (userEmail && eventRecord.fields.Date) {
                            const icalContent = generateICalContent(eventRecord);
                            const calendarLinks = generateCalendarLinks(eventRecord, SITE_URL);
                            
                            const icalAttachment = Buffer.from(icalContent).toString('base64');
                            
                            const eventName = eventRecord.fields.Name || 'Event';
                            const eventDate = new Date(eventRecord.fields.Date).toLocaleDateString('en-US', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                            });
                            const eventTime = eventRecord.fields.Time || '';
                            
                            const msg = {
                                to: userEmail,
                                from: 'info@tylersmysterytours.com',
                                subject: `You're going to ${eventName}!`,
                                html: `
                                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                        <h2>Thanks for RSVPing!</h2>
                                        <p>Hi ${userName},</p>
                                        <p>You've successfully RSVP'd to <strong>${eventName}</strong>.</p>
                                        
                                        <div style="background: #f4f4f4; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                            <h3 style="margin-top: 0;">Event Details</h3>
                                            <p><strong>📅 Date:</strong> ${eventDate}</p>
                                            ${eventTime ? `<p><strong>🕒 Time:</strong> ${eventTime}</p>` : ''}
                                            ${eventRecord.fields.Location ? `<p><strong>📍 Location:</strong> ${eventRecord.fields.Location}</p>` : ''}
                                        </div>
                                        
                                        <h3>Add to Your Calendar</h3>
                                        <p>Choose your preferred calendar app:</p>
                                        <div style="margin: 20px 0;">
                                            <a href="${calendarLinks.google}" style="display: inline-block; background: #4285F4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px;">Google Calendar</a>
                                            <a href="${calendarLinks.outlook}" style="display: inline-block; background: #0078D4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px;">Outlook</a>
                                            <a href="${calendarLinks.yahoo}" style="display: inline-block; background: #6001D2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px;">Yahoo</a>
                                        </div>
                                        
                                        <p style="color: #666; font-size: 14px;">An iCalendar (.ics) file is also attached to this email for easy import into any calendar application.</p>
                                        
                                        <p>See you there!</p>
                                        <p>- The WhatTheFunFinder Team</p>
                                    </div>
                                `,
                                attachments: [
                                    {
                                        content: icalAttachment,
                                        filename: `${eventName.replace(/[^a-z0-9]/gi, '_')}.ics`,
                                        type: 'text/calendar',
                                        disposition: 'attachment'
                                    }
                                ]
                            };

                            await sgMail.send(msg);
                            console.log(`RSVP confirmation email sent to ${userEmail}`);
                        }
                    }
                } catch (emailError) {
                    console.error('Failed to send RSVP confirmation email:', emailError);
                }
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                rsvped: action === 'add',
                rsvpCount: currentRsvps.length
            })
        };
    } catch (error) {
        console.error('RSVP error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process RSVP' })
        };
    }
};
