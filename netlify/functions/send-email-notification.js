const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

// Notification type templates
const NOTIFICATION_TEMPLATES = {
  message: {
    subject: (data) => `New Message in your plan: "${data.sessionName}"`,
    html: (data) => `
      <p>Hi ${data.recipientName},</p>
      <p>You have a new message from <strong>${data.senderName}</strong> in your event plan, "${data.sessionName}":</p>
      <p style="padding: 12px; border-left: 4px solid #ccc; background: #f4f4f4;"><em>"${data.content}"</em></p>
      <p><a href="${data.viewPlanUrl}">Click here to view the plan and reply.</a></p>
    `
  },
  idea: {
    subject: (data) => `New Idea for your plan: "${data.sessionName}"`,
    html: (data) => `
      <p>Hi ${data.recipientName},</p>
      <p><strong>${data.senderName}</strong> shared a new idea in "${data.sessionName}":</p>
      <p style="padding: 12px; border-left: 4px solid #f0ad4e; background: #fffbf0;">💡 <em>"${data.content}"</em></p>
      <p><a href="${data.viewPlanUrl}">Check it out and upvote if you like it!</a></p>
    `
  },
  join: {
    subject: (data) => `${data.senderName} joined your plan: "${data.sessionName}"`,
    html: (data) => `
      <p>Hi ${data.recipientName},</p>
      <p><strong>${data.senderName}</strong> just joined your event plan, "${data.sessionName}"! 👋</p>
      <p><a href="${data.viewPlanUrl}">View the plan</a></p>
    `
  },
  rsvp: {
    subject: (data) => `RSVP Update for "${data.sessionName}"`,
    html: (data) => `
      <p>Hi ${data.recipientName},</p>
      <p><strong>${data.senderName}</strong> responded "${data.rsvpType}" to your event, "${data.sessionName}".</p>
      <p><a href="${data.viewPlanUrl}">View RSVPs</a></p>
    `
  },
  task: {
    subject: (data) => `Task Update in "${data.sessionName}"`,
    html: (data) => `
      <p>Hi ${data.recipientName},</p>
      <p><strong>${data.senderName}</strong> ${data.taskAction || 'updated a task'} in "${data.sessionName}":</p>
      <p style="padding: 12px; border-left: 4px solid #17a2b8; background: #f0f8ff;"><em>${data.content}</em></p>
      <p><a href="${data.viewPlanUrl}">View the plan</a></p>
    `
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { recordId, notificationType, sessionId: directSessionId, senderName: directSenderName, senderId: directSenderId, content: directContent, rsvpType, taskAction } = body;

    // Support both the old recordId-based flow and a new direct notification flow
    let Content, SenderName, SenderID, sessionId, sessionName;

    if (recordId) {
      // Legacy flow: fetch message from Airtable
      const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages/${recordId}`;
      const messageResponse = await fetch(messageUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
      if (!messageResponse.ok) throw new Error('Failed to fetch message from Airtable.');
      const message = await messageResponse.json();
      Content = message.fields.Content || '';
      SenderName = message.fields.SenderName;
      SenderID = message.fields.SenderID;
      sessionId = message.fields.SessionID[0];
    } else if (directSessionId) {
      // Direct flow: data provided in request body
      Content = directContent || '';
      SenderName = directSenderName || 'Someone';
      SenderID = directSenderId;
      sessionId = directSessionId;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Either recordId or sessionId is required.' }) };
    }

    // Determine notification type (default to 'message' for backward compat)
    const type = notificationType || (Content.startsWith('[IDEA]') ? 'idea' : 'message');
    const cleanContent = Content.replace(/^\[IDEA\]\s*/, '');

    // Fetch the session to find the collaborators and the session name
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!sessionResponse.ok) throw new Error('Failed to fetch session from Airtable.');
    const session = await sessionResponse.json();
    sessionName = session.fields.Name || 'your event plan';

    const collaboratorIds = session.fields.Collaborators;
    if (!collaboratorIds || collaboratorIds.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No collaborators to notify.' }) };
    }

    // Fetch user records to get their notification preferences and email addresses
    const formula = `OR(${collaboratorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
    const usersResponse = await fetch(usersUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!usersResponse.ok) throw new Error('Failed to fetch users from Airtable.');
    const { records: users } = await usersResponse.json();

    // Filter for users who want real-time notifications and didn't trigger the event
    // Users with 'Digest' preference will receive notifications via the daily digest function instead
    const template = NOTIFICATION_TEMPLATES[type] || NOTIFICATION_TEMPLATES.message;
    const baseUrl = SITE_URL || URL;
    const viewPlanUrl = `${baseUrl}/?session=${sessionId}`;

    const notificationsToSend = users
      .filter(user =>
        user.fields.NotificationFrequency === 'Real-Time' &&
        user.fields.Email &&
        user.id !== SenderID
      )
      .map(user => {
        const templateData = {
          recipientName: user.fields.Name || 'there',
          senderName: SenderName,
          sessionName,
          content: cleanContent,
          viewPlanUrl,
          rsvpType: rsvpType || 'Yes',
          taskAction: taskAction || 'updated a task'
        };

        return sgMail.send({
          to: user.fields.Email,
          from: 'info@tylersmysterytours.com',
          subject: template.subject(templateData),
          html: template.html(templateData)
        });
      });

    await Promise.all(notificationsToSend);

    console.log(`[send-email-notification] Sent ${notificationsToSend.length} ${type} notifications for session ${sessionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Sent ${notificationsToSend.length} email notifications.` }),
    };
  } catch (error) {
    console.error('Send-email-notification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
