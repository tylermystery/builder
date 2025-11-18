const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        const { featureName, featureDescription } = JSON.parse(event.body);
        
        if (!featureName || !featureDescription) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: featureName and featureDescription' })
            };
        }

        console.log('[ai-team-prioritizer] Analyzing feature:', featureName);
        
        const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://whatthefunfinder.netlify.app';
        const projectSourceUrl = `${siteUrl}/project_source.json`;
        
        let projectContext = '';
        try {
            const projectResponse = await fetch(projectSourceUrl);
            if (projectResponse.ok) {
                const projectData = await projectResponse.json();
                projectContext = JSON.stringify(projectData);
                console.log('[ai-team-prioritizer] Loaded project context');
            } else {
                console.warn('[ai-team-prioritizer] Could not fetch project_source.json, proceeding without it');
            }
        } catch (fetchError) {
            console.warn('[ai-team-prioritizer] Error fetching project_source.json:', fetchError.message);
        }

        const prompt = `You are an expert technical program manager analyzing a feature request for "What The Fun Finder" - an event planning and community connection platform.

Feature to analyze:
Name: ${featureName}
Description: ${featureDescription}

${projectContext ? `Project Context (current codebase): ${projectContext.substring(0, 5000)}` : 'No project context available.'}

Your task is to analyze this feature and provide:
1. Goal_Alignment: Which business goals does this feature support? Select from: "Polish", "See Products", "Purchase", "Connect (Team)", "Connect (Community)"
2. Effort: Implementation effort estimate based on the current codebase. Select one: "Small", "Medium", "Large"

Considerations:
- "Small" = < 1 day of work, simple changes to existing code
- "Medium" = 1-3 days, moderate complexity or new components
- "Large" = 3+ days, major new features or significant refactoring

Respond ONLY with a valid JSON object containing exactly these two keys:
{
  "Goal_Alignment": ["array", "of", "matching", "goals"],
  "Effort": "Small"
}

Do NOT include markdown code blocks or any text before or after the JSON object.`;

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
            console.error('[ai-team-prioritizer] Gemini API Error:', errorBody);
            throw new Error(`Gemini API call failed with status ${response.status}`);
        }

        const result = await response.json();
        
        let jsonText = '';
        try {
            jsonText = result.candidates[0].content.parts[0].text;
        } catch (e) {
            console.error('[ai-team-prioritizer] Error extracting text from Gemini response:', JSON.stringify(result, null, 2));
            throw new Error('Could not extract text from Gemini response');
        }

        console.log('[ai-team-prioritizer] Raw AI response:', jsonText);

        let analysis;
        try {
            analysis = JSON.parse(jsonText);
        } catch (e) {
            console.error('[ai-team-prioritizer] Failed to parse JSON response:', jsonText);
            throw new Error('Gemini did not return valid JSON');
        }

        if (!analysis.Goal_Alignment || !analysis.Effort) {
            throw new Error('Response missing required fields: Goal_Alignment and Effort');
        }

        console.log('[ai-team-prioritizer] Successfully analyzed feature');

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(analysis)
        };

    } catch (error) {
        console.error('[ai-team-prioritizer] Error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
