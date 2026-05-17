// FILE: netlify/functions/send-rsvp-confirmation.js
// Sends a polished "official invite" confirmation email to the user who RSVPed
// Includes inline calendar links (Google, Outlook, iCal) that work without login

const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { DEFAULT_FROM } = require('./utils/email-config');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

/**
 * Format a date string for iCal (YYYYMMDDTHHMMSSZ)
 */
function formatICalDate(dateStr, timeStr = null) {
  const dateObj = new Date(dateStr + 'T00:00:00');

  if (timeStr) {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const meridiem = match[3] ? match[3].toUpperCase() : null;
      if (meridiem === 'PM' && hours !== 12) hours += 12;
      else if (meridiem === 'AM' && hours === 12) hours = 0;
      dateObj.setHours(hours, minutes, 0, 0);
    }
  } else {
    dateObj.setHours(11, 0, 0, 0);
  }

  return dateObj;
}

/**
 * Build Google Calendar URL
 */
function buildGoogleCalendarUrl(event) {
  const title = encodeURIComponent(event.name || 'Event');
  const description = encodeURIComponent(event.description || '');
  const location = encodeURIComponent(event.location || '');

  const startDate = formatICalDate(event.date, event.time);
  const duration = event.time ? (event.duration || 2) : 8;
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + duration);

  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${y}${m}${day}T${h}${min}${s}`;
  };

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(startDate)}/${fmt(endDate)}&details=${description}&location=${location}`;
}

/**
 * Build Outlook Calendar URL
 */
function buildOutlookCalendarUrl(event) {
  const title = encodeURIComponent(event.name || 'Event');
  const description = encodeURIComponent(event.description || '');
  const location = encodeURIComponent(event.location || '');

  const startDate = formatICalDate(event.date, event.time);
  const duration = event.time ? (event.duration || 2) : 8;
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + duration);

  return `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&body=${description}&location=${location}&startdt=${startDate.toISOString()}&enddt=${endDate.toISOString()}&path=/calendar/action/compose&rru=addevent`;
}

/**
 * Build iCal (.ics) file content
 */
function buildICalContent(event) {
  const startDate = formatICalDate(event.date, event.time);
  const duration = event.time ? (event.duration || 2) : 8;
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + duration);

  const esc = (t) => (t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const fmtUtc = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${day}T${h}${min}${s}Z`;
  };

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WTFun//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@whatthefun.com`,
    `DTSTAMP:${fmtUtc(new Date())}`,
    `DTSTART:${fmtUtc(startDate)}`,
    `DTEND:${fmtUtc(endDate)}`,
    `SUMMARY:${esc(event.name)}`,
    `DESCRIPTION:${esc(event.description)}`,
    `LOCATION:${esc(event.location)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

/**
 * Format date for display in the email
 */
function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { eventRecordId, userId, rsvpType } = JSON.parse(event.body);

    if (!eventRecordId || !userId || !rsvpType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'eventRecordId, userId, and rsvpType are required.' }) };
    }

    // Only send confirmation for Yes or Maybe
    if (rsvpType !== 'yes' && rsvpType !== 'maybe') {
      return { statusCode: 200, body: JSON.stringify({ message: 'No confirmation sent for "No" RSVPs.' }) };
    }

    // Fetch the user's email and name
    const userUrl = `https://api.airtable.com/v0/${BASE_ID}/Users/${userId}`;
    const userResponse = await fetch(userUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });
    if (!userResponse.ok) throw new Error('Failed to fetch user.');
    const user = await userResponse.json();
    const userEmail = user.fields.Email;
    const userName = user.fields.Name || 'there';

    if (!userEmail) {
      return { statusCode: 200, body: JSON.stringify({ message: 'User has no email on file.' }) };
    }

    // Fetch the event record
    const itemsTableId = 'tblUA4uuS8IYlhKpD';
    const eventUrl = `https://api.airtable.com/v0/${BASE_ID}/${itemsTableId}/${eventRecordId}`;
    const eventResponse = await fetch(eventUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });
    if (!eventResponse.ok) throw new Error('Failed to fetch event record.');
    const eventRecord = await eventResponse.json();

    const eventData = {
      name: eventRecord.fields.Name || 'Event',
      description: eventRecord.fields.Description || '',
      location: eventRecord.fields['Location Details'] || eventRecord.fields.Location || '',
      date: eventRecord.fields.Date,
      time: eventRecord.fields.Time || '',
      duration: eventRecord.fields['Duration (hours)'] || 2
    };

    const baseUrl = SITE_URL || URL;
    const eventLink = `${baseUrl}/?openItem=${encodeURIComponent(eventData.name)}`;
    const rsvpLabel = rsvpType === 'yes' ? "You're Going!" : "You're a Maybe!";
    const rsvpSubLabel = rsvpType === 'yes'
      ? "We're excited to have you join us."
      : "We hope you can make it — we'd love to see you there.";

    // Build calendar links (only if event has a date)
    let calendarSection = '';
    if (eventData.date) {
      const googleUrl = buildGoogleCalendarUrl(eventData);
      const outlookUrl = buildOutlookCalendarUrl(eventData);
      // iCal content is attached as data URI
      const icalContent = buildICalContent(eventData);
      const icalBase64 = Buffer.from(icalContent).toString('base64');

      calendarSection = `
        <div style="margin: 28px 0 0 0; padding: 24px; background: #f8f9fb; border-radius: 12px; text-align: center;">
          <div style="font-weight: 600; color: #333; font-size: 15px; margin-bottom: 14px;">Add to Your Calendar</div>
          <div style="display: inline-block;">
            <!--[if mso]>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding: 0 6px;">
            <![endif]-->
            <a href="${googleUrl}" target="_blank" style="display: inline-block; padding: 10px 20px; background: #4285f4; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 4px;">
              Google Calendar
            </a>
            <!--[if mso]>
            </td><td style="padding: 0 6px;">
            <![endif]-->
            <a href="${outlookUrl}" target="_blank" style="display: inline-block; padding: 10px 20px; background: #0078d4; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 4px;">
              Outlook
            </a>
            <!--[if mso]>
            </td></tr></table>
            <![endif]-->
          </div>
          <div style="margin-top: 10px; font-size: 12px; color: #999;">No login required — just click to save the event.</div>
        </div>
      `;
    }

    // Build event details section
    const dateDisplay = eventData.date ? formatDisplayDate(eventData.date) : 'Date TBD';
    const timeDisplay = eventData.time || '';
    const locationDisplay = eventData.location || '';

    const eventDetailsRows = [];
    eventDetailsRows.push(`
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
          <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 4px;">When</div>
          <div style="font-size: 16px; color: #333; font-weight: 500;">${dateDisplay}${timeDisplay ? ` at ${timeDisplay}` : ''}</div>
        </td>
      </tr>
    `);

    if (locationDisplay) {
      eventDetailsRows.push(`
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 4px;">Where</div>
            <div style="font-size: 16px; color: #333; font-weight: 500;">${locationDisplay}</div>
          </td>
        </tr>
      `);
    }

    if (eventData.description) {
      const shortDesc = eventData.description.length > 200
        ? eventData.description.substring(0, 200) + '...'
        : eventData.description;
      eventDetailsRows.push(`
        <tr>
          <td style="padding: 10px 0;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 4px;">About</div>
            <div style="font-size: 14px; color: #555; line-height: 1.5;">${shortDesc}</div>
          </td>
        </tr>
      `);
    }

    // Build the official invite email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">

                <!-- Header Banner -->
                <tr>
                  <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 32px; text-align: center;">
                    <div style="font-size: 14px; text-transform: uppercase; letter-spacing: 3px; color: rgba(255,255,255,0.85); margin-bottom: 12px;">You're Invited</div>
                    <div style="font-size: 26px; font-weight: 700; color: white; line-height: 1.3;">${eventData.name}</div>
                  </td>
                </tr>

                <!-- RSVP Status Badge -->
                <tr>
                  <td style="padding: 0; text-align: center;">
                    <div style="display: inline-block; margin-top: -18px; padding: 10px 28px; background: ${rsvpType === 'yes' ? '#28a745' : '#ffc107'}; color: ${rsvpType === 'yes' ? 'white' : '#333'}; border-radius: 24px; font-weight: 700; font-size: 15px; letter-spacing: 0.5px;">
                      ${rsvpLabel}
                    </div>
                  </td>
                </tr>

                <!-- Body Content -->
                <tr>
                  <td style="padding: 28px 32px 8px;">
                    <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">
                      Hi ${userName},
                    </p>
                    <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0;">
                      ${rsvpSubLabel}
                    </p>
                  </td>
                </tr>

                <!-- Event Details Card -->
                <tr>
                  <td style="padding: 16px 32px;">
                    <div style="background: #fafbfc; border: 1px solid #eee; border-radius: 12px; padding: 20px 24px;">
                      <div style="font-weight: 700; color: #333; font-size: 16px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 2px solid #667eea;">Event Details</div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        ${eventDetailsRows.join('')}
                      </table>
                    </div>
                  </td>
                </tr>

                <!-- Calendar Buttons -->
                <tr>
                  <td style="padding: 0 32px;">
                    ${calendarSection}
                  </td>
                </tr>

                <!-- View Event Button -->
                <tr>
                  <td style="padding: 24px 32px; text-align: center;">
                    <a href="${eventLink}" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      View Event Details
                    </a>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 32px 28px; text-align: center; border-top: 1px solid #f0f0f0;">
                    <p style="color: #aaa; font-size: 12px; margin: 0; line-height: 1.5;">
                      This is a confirmation of your RSVP. You can update your response at any time.
                    </p>
                    <p style="color: #bbb; font-size: 11px; margin: 8px 0 0;">
                      Powered by WTFun
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Send the email
    const msg = {
      to: userEmail,
      from: DEFAULT_FROM,
      subject: `You're Invited: ${eventData.name}`,
      html: emailHtml
    };

    // Attach .ics file if event has a date
    if (eventData.date) {
      const icalContent = buildICalContent(eventData);
      msg.attachments = [{
        content: Buffer.from(icalContent).toString('base64'),
        filename: `${(eventData.name || 'event').replace(/[^a-z0-9]/gi, '_')}.ics`,
        type: 'text/calendar',
        disposition: 'attachment'
      }];
    }

    await sgMail.send(msg);
    console.log(`[send-rsvp-confirmation] Sent confirmation to ${userEmail} for event ${eventData.name} (${rsvpType})`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: `RSVP confirmation sent to ${userEmail}` })
    };

  } catch (error) {
    console.error('[send-rsvp-confirmation] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
