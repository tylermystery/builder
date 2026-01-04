const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;

sgMail.setApiKey(SENDGRID_API_KEY);

// Phase 4: Permission roles
const PERMISSION_ROLES = {
    OWNER: 'owner',
    EDITOR: 'editor',
    VIEWER: 'viewer'
};

// Phase 4: Collaborator_Permissions table name
const COLLABORATOR_PERMISSIONS_TABLE = 'Collaborator_Permissions';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { eventId, collaboratorName, collaboratorEmail, inviterName, planSummaryHtml, role } = JSON.parse(event.body);

    if (!eventId || !collaboratorEmail || !inviterName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    // Validate role (default to editor)
    const selectedRole = role && Object.values(PERMISSION_ROLES).includes(role.toLowerCase())
      ? role.toLowerCase()
      : PERMISSION_ROLES.EDITOR;

    // 1. Fetch Session to get Name
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${eventId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

    let sessionName = 'Event Plan';
    if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        sessionName = session.fields.Name || 'Event Plan';
    }

    // 2. Fetch Recent Chat Messages
    // Formula: FIND('rec...', {SessionID_Rollup})
    const chatFormula = `FIND('${eventId}', {SessionID_Rollup})`;
    const chatUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages?filterByFormula=${encodeURIComponent(chatFormula)}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=5`;

    let chatHtml = '<p><em>No recent chat messages.</em></p>';

    try {
        const chatResponse = await fetch(chatUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (chatResponse.ok) {
            const chatData = await chatResponse.json();
            if (chatData.records && chatData.records.length > 0) {
                chatHtml = '<ul style="list-style: none; padding: 0;">';
                chatData.records.forEach(record => {
                    const { SenderName, Content, Timestamp } = record.fields;
                    chatHtml += `
                        <li style="margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                            <strong>${SenderName || 'Unknown'}</strong>: ${Content}
                        </li>`;
                });
                chatHtml += '</ul>';
            }
        }
    } catch (e) {
        console.error('Error fetching chat for invite:', e);
    }

    // 3. Phase 4: Try to find or create user by email in Users table
    // This is needed to create a permission record
    let invitedUserId = null;
    try {
        // First check if user already exists
        const userFormula = `{Email} = '${collaboratorEmail}'`;
        const userSearchUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(userFormula)}&maxRecords=1`;
        const userSearchResponse = await fetch(userSearchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (userSearchResponse.ok) {
            const userData = await userSearchResponse.json();
            if (userData.records && userData.records.length > 0) {
                invitedUserId = userData.records[0].id;
                console.log(`Found existing user: ${invitedUserId}`);
            }
        }

        // If user exists, create permission record
        if (invitedUserId) {
            // Check if permission record already exists
            const permFormula = `AND(FIND('${eventId}', ARRAYJOIN({ProjectId})), FIND('${invitedUserId}', ARRAYJOIN({UserId})))`;
            const permSearchUrl = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE}?filterByFormula=${encodeURIComponent(permFormula)}&maxRecords=1`;
            const permSearchResponse = await fetch(permSearchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

            let existingPermission = false;
            if (permSearchResponse.ok) {
                const permData = await permSearchResponse.json();
                existingPermission = permData.records && permData.records.length > 0;
            }

            if (!existingPermission) {
                // Create new permission record
                const createPermUrl = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE}`;
                const permissionResponse = await fetch(createPermUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_PAT}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fields: {
                            ProjectId: [eventId],
                            UserId: [invitedUserId],
                            Role: selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1) // Capitalize
                        }
                    })
                });

                if (permissionResponse.ok) {
                    console.log(`Created permission record for user ${invitedUserId} with role ${selectedRole}`);
                } else {
                    console.error('Failed to create permission record:', await permissionResponse.text());
                }
            } else {
                console.log(`Permission record already exists for user ${invitedUserId}`);
            }

            // Also add to legacy Collaborators field for backwards compatibility
            const currentSessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (currentSessionResponse.ok) {
                const sessionData = await currentSessionResponse.json();
                const currentCollaborators = sessionData.fields.Collaborators || [];

                if (!currentCollaborators.includes(invitedUserId)) {
                    const updatedCollaborators = [...currentCollaborators, invitedUserId];
                    await fetch(sessionUrl, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${AIRTABLE_PAT}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            fields: { Collaborators: updatedCollaborators }
                        })
                    });
                    console.log(`Added user ${invitedUserId} to session ${eventId} collaborators`);
                }
            }
        }
    } catch (permError) {
        console.error('Error creating permission record:', permError);
        // Continue with email - permission will be created when user accepts invite
    }

    // 4. Construct Email
    const baseUrl = SITE_URL || URL || 'https://whatthefunfinder.com';
    const link = `${baseUrl}/?session=${eventId}&view=plan`;

    // Phase 4: Include role information in email
    const roleDescription = selectedRole === PERMISSION_ROLES.VIEWER
        ? 'view-only access'
        : selectedRole === PERMISSION_ROLES.OWNER
            ? 'full owner access'
            : 'edit access';

    const emailContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You're invited to collaborate!</h2>
            <p><strong>${inviterName}</strong> has invited you to collaborate on the event plan: <strong>${sessionName}</strong>.</p>
            <p style="color: #666; font-size: 0.9em;">You have been granted <strong>${roleDescription}</strong> to this plan.</p>

            <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                <h3 style="margin-top: 0;">Plan Summary</h3>
                ${planSummaryHtml || '<p>No items in plan yet.</p>'}
            </div>

            <div style="margin: 20px 0;">
                <h3>Recent Chat Activity</h3>
                ${chatHtml}
            </div>

            <div style="text-align: center; margin-top: 30px;">
                <a href="${link}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">View & ${selectedRole === PERMISSION_ROLES.VIEWER ? 'View' : 'Edit'} Plan</a>
            </div>

            <p style="text-align: center; margin-top: 20px; font-size: 0.9em; color: #666;">
                <a href="${link}">${link}</a>
            </p>
        </div>
    `;

    const msg = {
      to: collaboratorEmail,
      from: 'info@tylersmysterytours.com', // Verified sender
      subject: `Invitation to ${selectedRole === PERMISSION_ROLES.VIEWER ? 'view' : 'edit'}: ${sessionName}`,
      html: emailContent,
    };

    await sgMail.send(msg);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Invitation sent successfully.' }),
    };

  } catch (error) {
    console.error('invite-collaborator error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
