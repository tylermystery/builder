const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        console.log('[ai-team-ideator] Fetching project context...');
        
        const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://whatthefunfinder.netlify.app';
        const projectSourceUrl = `${siteUrl}/project_source.json`;
        
        let projectContext = '';
        try {
            const projectResponse = await fetch(projectSourceUrl);
            if (projectResponse.ok) {
                const projectData = await projectResponse.json();
                projectContext = JSON.stringify(projectData);
                console.log('[ai-team-ideator] Loaded project context');
            } else {
                console.warn('[ai-team-ideator] Could not fetch project_source.json, proceeding without it');
            }
        } catch (fetchError) {
            console.warn('[ai-team-ideator] Error fetching project_source.json:', fetchError.message);
        }

        console.log('[ai-team-ideator] Requesting feature ideas from Gemini...');

        const prompt = `You are an expert product manager analyzing a project for "What The Fun Finder" - an event planning and community connection platform.

Based on the project files provided and the user's primary goals:
- Connect (Community): Help users discover and connect with their community
- Purchase: Enable smooth e-commerce transactions for event bookings

Suggest 3 new, actionable feature ideas that would enhance these goals.

${projectContext ? `Project Context: ${projectContext.substring(0, 5000)}` : 'No project context available.'}

Respond ONLY with a valid JSON array of objects. Each object must have exactly these two keys:
- "feature": A short, catchy feature name (3-6 words)
- "description": A detailed description of the feature and its benefits (2-3 sentences)

Example format:
[
  {"feature": "Community Activity Feed", "description": "A real-time feed showing recent bookings and popular activities in the user's area. This helps users discover trending events and feel connected to their local community."},
  {"feature": "Group Booking Discounts", "description": "Automatic discount codes when multiple users book the same activity together. Encourages community connections while increasing conversion rates."}
]

Do NOT include markdown code blocks or any text before or after the JSON array.`;

        const payload = {
            contents: [{
                role: "user",
                parts: [{ text: prompt }]
            }]
        };

        const modelId = "gemini-1.5-flash";
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('[ai-team-ideator] Gemini API Error:', errorBody);
            throw new Error(`Gemini API call failed with status ${response.status}`);
        }

        const result = await response.json();
        
        let jsonText = '';
        try {
            jsonText = result.candidates[0].content.parts[0].text;
        } catch (e) {
            console.error('[ai-team-ideator] Error extracting text from Gemini response:', JSON.stringify(result, null, 2));
            throw new Error('Could not extract text from Gemini response');
        }

        console.log('[ai-team-ideator] Raw AI response:', jsonText);

        let ideas;
        try {
            ideas = JSON.parse(jsonText);
        } catch (e) {
            console.error('[ai-team-ideator] Failed to parse JSON response:', jsonText);
            throw new Error('Gemini did not return valid JSON');
        }

        if (!Array.isArray(ideas)) {
            throw new Error('Expected an array of ideas from Gemini');
        }

        console.log(`[ai-team-ideator] Successfully generated ${ideas.length} feature ideas`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ideas)
        };

    } catch (error) {
        console.error('[ai-team-ideator] Error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
