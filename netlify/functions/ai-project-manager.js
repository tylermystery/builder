// FILE: netlify/functions/ai-project-manager.js
// AI Strategic Project Manager - Analyzes business status and generates actionable roadmaps

const fetch = require('node-fetch');

const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

// Airtable table names - these must match exactly what was created in Airtable
const BUSINESS_CONTEXT_TABLE = 'Business_Context';
const STRATEGIC_TASKS_TABLE = 'Strategic_Tasks';

/**
 * Extracts a JSON object from a string, even if it's wrapped in markdown.
 * @param {string} text - The raw text response from the AI.
 * @returns {object} The parsed JSON object.
 */
function cleanAndParseGeminiJson(text) {
    console.log('[Debug] Raw Gemini Text:', text);
    const jsonMatch = text.match(/{[\s\S]*}/);
    if (!jsonMatch) {
        throw new Error('Gemini response did not contain a valid JSON object.');
    }
    const jsonString = jsonMatch[0];
    try {
        return JSON.parse(jsonString);
    } catch (parseError) {
        console.error('[Debug] Failed to parse extracted JSON:', parseError);
        throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
    }
}

/**
 * Fetches the last 5 business context records from Airtable for historical context.
 * @returns {Promise<Array>} Array of recent context records.
 */
async function fetchBusinessHistory() {
    console.log('[Debug] Fetching business history from Airtable...');

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(BUSINESS_CONTEXT_TABLE)}?maxRecords=5&sort[0][field]=Timestamp&sort[0][direction]=desc`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.warn('[Debug] Could not fetch business history:', errorText);
            return []; // Return empty array if table doesn't exist or has no records
        }

        const data = await response.json();
        console.log(`[Debug] Retrieved ${data.records?.length || 0} historical context records.`);
        return data.records || [];
    } catch (error) {
        console.warn('[Debug] Error fetching business history:', error.message);
        return [];
    }
}

/**
 * Formats historical context records into a text block for the AI prompt.
 * @param {Array} records - Array of Airtable records.
 * @returns {string} Formatted history text.
 */
function formatHistoryForPrompt(records) {
    if (!records || records.length === 0) {
        return 'No previous business context available. This is the first strategic analysis.';
    }

    const historyLines = records.map((record, index) => {
        const fields = record.fields;
        const timestamp = fields.Timestamp || 'Unknown date';
        const update = fields.UpdateText || 'No update text';
        const summary = fields.AnalysisSummary || 'No summary';
        return `[${index + 1}] ${timestamp}:\nInput: ${update}\nAnalysis: ${summary}`;
    });

    return historyLines.join('\n\n');
}

/**
 * Calls Google Gemini to analyze business input and generate strategic tasks.
 * @param {string} userInput - The business status/brain dump from the user.
 * @param {string} historyContext - Formatted historical context.
 * @returns {Promise<object>} Parsed strategic analysis JSON.
 */
async function analyzeWithGemini(userInput, historyContext) {
    console.log('[Debug] Calling Gemini for strategic analysis...');

    if (!GEMINI_API_KEY) {
        throw new Error('Server configuration error: Missing GEMINI_API_KEY.');
    }

    const systemPrompt = `
You are an expert AI Strategic Project Manager for small business owners. Your role is to analyze unstructured business updates and generate a focused, actionable roadmap.

## HISTORICAL CONTEXT
Here are the last few business updates and analyses for continuity:
${historyContext}

## CURRENT USER INPUT
The business owner has provided this status update:
"${userInput}"

## YOUR TASK
Analyze the current input in the context of the business history. Generate 3-5 HIGH-IMPACT strategic tasks that address the core issues.

## OUTPUT FORMAT
Respond ONLY with a valid JSON object. Do not include markdown \`\`\`json or any text before or after the JSON.

The JSON MUST have this exact structure:
{
  "summary": "A 1-sentence strategic overview of the current situation and recommended focus.",
  "tasks": [
    {
      "TaskName": "Clear, actionable task name",
      "Type": "Short Term Fix|Long Term Strategy|Operational Improvement",
      "BusinessHealthBenefit": "Explicit ROI or business health impact (e.g., 'Increase revenue by 15%', 'Reduce churn by 20%')",
      "SuccessCriteria": "Measurable KPI or outcome that defines success",
      "TargetHours": 8,
      "Priority": "High|Medium|Low"
    }
  ]
}

## GUIDELINES
1. **Focus on Impact**: Each task should directly address a pain point or opportunity mentioned in the input.
2. **Be Specific**: Avoid vague tasks. "Improve marketing" is bad. "Launch email campaign targeting lapsed customers" is good.
3. **Include Mix**: Provide a balance of quick wins (Short Term Fix) and foundational improvements (Long Term Strategy).
4. **Realistic Estimates**: TargetHours should reflect actual effort for a small team.
5. **ROI Focus**: BusinessHealthBenefit should explicitly state expected outcomes.

Generate the strategic roadmap now.
`;

    const payload = {
        contents: [
            {
                parts: [{ text: systemPrompt }]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
        }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error('[Debug] Gemini API Error:', errorBody);
        throw new Error(`Gemini API call failed with status ${response.status}`);
    }

    const result = await response.json();
    console.log('[Debug] Gemini response received.');

    let jsonText = '';
    try {
        jsonText = result.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response.');
    }

    return cleanAndParseGeminiJson(jsonText);
}

/**
 * Saves the business context to Airtable.
 * @param {string} updateText - The user's original input.
 * @param {string} analysisSummary - The AI-generated summary.
 * @returns {Promise<object>} The created record.
 */
async function saveBusinessContext(updateText, analysisSummary) {
    console.log('[Debug] Saving business context to Airtable...');

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(BUSINESS_CONTEXT_TABLE)}`;

    const payload = {
        fields: {
            UpdateText: updateText,
            AnalysisSummary: analysisSummary,
            Timestamp: new Date().toISOString()
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_PAT}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[Debug] Failed to save business context:', errorText);
        throw new Error(`Failed to save business context: ${response.status}`);
    }

    const record = await response.json();
    console.log('[Debug] Business context saved. Record ID:', record.id);
    return record;
}

/**
 * Saves strategic tasks to Airtable.
 * @param {Array} tasks - Array of task objects from AI analysis.
 * @returns {Promise<Array>} Array of created records.
 */
async function saveStrategicTasks(tasks) {
    console.log(`[Debug] Saving ${tasks.length} strategic tasks to Airtable...`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STRATEGIC_TASKS_TABLE)}`;

    // Airtable allows up to 10 records per batch request
    const records = tasks.map(task => ({
        fields: {
            TaskName: task.TaskName,
            Type: task.Type,
            BusinessHealthBenefit: task.BusinessHealthBenefit,
            SuccessCriteria: task.SuccessCriteria,
            TargetHours: task.TargetHours,
            Priority: task.Priority,
            Status: 'Proposed',
            CreatedAt: new Date().toISOString()
        }
    }));

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_PAT}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[Debug] Failed to save strategic tasks:', errorText);
        throw new Error(`Failed to save strategic tasks: ${response.status}`);
    }

    const result = await response.json();
    console.log(`[Debug] Successfully saved ${result.records?.length || 0} tasks.`);
    return result.records;
}

/**
 * Main handler for the AI Project Manager function.
 */
exports.handler = async (event) => {
    console.log(`[Debug] /api/ai-project-manager handler invoked. Method: ${event.httpMethod}`);

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
        };
    }

    try {
        // 1. Parse the incoming request
        const { userInput } = JSON.parse(event.body || '{}');

        if (!userInput || typeof userInput !== 'string' || userInput.trim().length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing or empty userInput field.' })
            };
        }

        console.log(`[Debug] Received user input (${userInput.length} chars).`);

        // 2. Fetch historical business context
        const historyRecords = await fetchBusinessHistory();
        const historyContext = formatHistoryForPrompt(historyRecords);

        // 3. Call Gemini for strategic analysis
        const analysis = await analyzeWithGemini(userInput.trim(), historyContext);

        if (!analysis.summary || !Array.isArray(analysis.tasks)) {
            throw new Error('Invalid AI response structure. Missing summary or tasks.');
        }

        console.log(`[Debug] AI generated ${analysis.tasks.length} strategic tasks.`);

        // 4. Save the business context
        await saveBusinessContext(userInput.trim(), analysis.summary);

        // 5. Save the strategic tasks
        if (analysis.tasks.length > 0) {
            await saveStrategicTasks(analysis.tasks);
        }

        // 6. Return the analysis to the frontend
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                summary: analysis.summary,
                tasks: analysis.tasks
            })
        };

    } catch (error) {
        console.error('[ERROR] /api/ai-project-manager handler failed:', error.message, error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: `Analysis failed: ${error.message}`
            })
        };
    }
};
