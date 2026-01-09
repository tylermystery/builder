// FILE: netlify/functions/enrich-quick-plan.js
// PURPOSE: AI enrichment for quick plans - suggests Plan_Type and creates initial Tasks
// This function is called asynchronously after a quick plan is created

const fetch = require('node-fetch');

const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

// Table names
const PROJECTS_TABLE = 'Projects';
const TASKS_TABLE = 'Tasks';

/**
 * Cleans and parses JSON from Gemini response (handles markdown code blocks)
 * @param {string} text - Raw text from Gemini
 * @returns {object} Parsed JSON object
 */
function cleanAndParseGeminiJson(text) {
  let cleanedText = text.trim();

  // Remove markdown code blocks if present
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.slice(7);
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.slice(3);
  }

  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.slice(0, -3);
  }

  cleanedText = cleanedText.trim();

  // Find JSON object in text
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No valid JSON object found in AI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Calls Gemini AI to analyze the plan idea and suggest structure
 * @param {string} ideaText - The user's plan idea text
 * @returns {Promise<object>} AI analysis with plan_type and next_steps
 */
async function analyzeWithGemini(ideaText) {
  console.log('[enrich-quick-plan] Calling Gemini for plan analysis...');

  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const systemPrompt = `
You are an expert project planner assistant. Your task is to analyze a user's plan idea and provide two things:
1. Suggest the most appropriate Plan Type
2. Generate 1-2 actionable "Next Steps" tasks

## USER'S PLAN IDEA
"${ideaText}"

## YOUR TASK
Analyze the idea and determine:
1. What type of plan this is (Project, Event, Task List, or Other)
2. What are 1-2 immediate actionable next steps to get started

## OUTPUT FORMAT
Respond ONLY with a valid JSON object. Do not include markdown code blocks or any text before/after the JSON.

{
  "plan_type": "Project|Event|Task List|Other",
  "reasoning": "Brief explanation of why this plan type was chosen",
  "next_steps": [
    {
      "name": "Clear, actionable task name (max 50 chars)",
      "description": "Detailed description of what needs to be done"
    }
  ]
}

## PLAN TYPE GUIDELINES
- "Project": Long-term initiatives with multiple phases (e.g., website redesign, product launch, home renovation)
- "Event": Time-bound gatherings or occasions (e.g., birthday party, conference, wedding, team outing)
- "Task List": Collection of related tasks or to-dos (e.g., weekly errands, shopping list, checklist)
- "Other": Anything that doesn't fit the above categories

## NEXT STEPS GUIDELINES
- Each step should be specific and actionable
- Focus on immediate priorities that move the plan forward
- Keep task names concise (max 50 characters)
- Provide helpful descriptions with context

Generate your analysis now.
`;

  const payload = {
    contents: [
      {
        parts: [{ text: systemPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  const modelId = 'gemini-2.0-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[enrich-quick-plan] Gemini API Error:', errorBody);
    throw new Error(`Gemini API call failed with status ${response.status}`);
  }

  const result = await response.json();
  const jsonText = result.candidates[0].content.parts[0].text;

  return cleanAndParseGeminiJson(jsonText);
}

/**
 * Updates the Project record with the suggested Plan_Type
 * @param {string} projectId - Airtable record ID
 * @param {string} planType - Suggested plan type
 * @returns {Promise<object>} Updated record
 */
async function updateProjectPlanType(projectId, planType) {
  console.log(`[enrich-quick-plan] Updating project ${projectId} with Plan_Type: ${planType}`);

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${projectId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        'Plan_Type': planType
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn('[enrich-quick-plan] Failed to update Plan_Type:', errorText);
    // Don't throw - this is a non-critical update
    return null;
  }

  const record = await response.json();
  console.log('[enrich-quick-plan] Project Plan_Type updated successfully');
  return record;
}

/**
 * Creates task records linked to the project
 * @param {string} projectId - Airtable record ID of the parent project
 * @param {Array} nextSteps - Array of task objects from AI
 * @returns {Promise<Array>} Created task records
 */
async function createLinkedTasks(projectId, nextSteps) {
  if (!nextSteps || nextSteps.length === 0) {
    console.log('[enrich-quick-plan] No next steps to create');
    return [];
  }

  console.log(`[enrich-quick-plan] Creating ${nextSteps.length} linked tasks...`);

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TASKS_TABLE)}`;

  // Prepare records for batch creation
  const records = nextSteps.map((step, index) => ({
    fields: {
      'Name': step.name.substring(0, 50), // Ensure max 50 chars
      'Description': step.description || '',
      'Project': [projectId], // Link to parent project
      'Status': 'Not Started',
      'Priority': index === 0 ? 'High' : 'Medium', // First task is high priority
      'AI_Generated': true
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
    console.warn('[enrich-quick-plan] Failed to create tasks:', errorText);
    // Don't throw - task creation is optional enhancement
    return [];
  }

  const result = await response.json();
  console.log(`[enrich-quick-plan] Successfully created ${result.records?.length || 0} tasks`);
  return result.records || [];
}

/**
 * Main handler for the AI enrichment function
 */
exports.handler = async (event) => {
  console.log(`[enrich-quick-plan] Function invoked. Method: ${event.httpMethod}`);

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Validate environment variables
  if (!AIRTABLE_PAT || !BASE_ID) {
    console.error('[enrich-quick-plan] Missing required Airtable environment variables');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // GEMINI_API_KEY is optional - if missing, we skip AI enrichment
  if (!GEMINI_API_KEY) {
    console.warn('[enrich-quick-plan] GEMINI_API_KEY not configured - skipping AI enrichment');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'AI enrichment skipped - API key not configured',
        enriched: false
      })
    };
  }

  try {
    // Parse incoming request
    const { projectId, ideaText } = JSON.parse(event.body || '{}');

    if (!projectId || !ideaText) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required fields: projectId and ideaText' })
      };
    }

    console.log(`[enrich-quick-plan] Enriching project ${projectId} with idea (${ideaText.length} chars)`);

    // Step 1: Call AI to analyze the idea
    const analysis = await analyzeWithGemini(ideaText);
    console.log('[enrich-quick-plan] AI Analysis:', JSON.stringify(analysis, null, 2));

    // Step 2: Update project with suggested Plan_Type
    if (analysis.plan_type) {
      await updateProjectPlanType(projectId, analysis.plan_type);
    }

    // Step 3: Create linked tasks from next_steps
    let createdTasks = [];
    if (analysis.next_steps && analysis.next_steps.length > 0) {
      createdTasks = await createLinkedTasks(projectId, analysis.next_steps);
    }

    console.log('[enrich-quick-plan] Enrichment complete');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        enriched: true,
        planType: analysis.plan_type,
        reasoning: analysis.reasoning,
        tasksCreated: createdTasks.length
      })
    };

  } catch (error) {
    console.error('[enrich-quick-plan] Function failed:', error.message);
    console.error('[enrich-quick-plan] Stack:', error.stack);

    // Return success even on error - enrichment is optional
    // The plan was already created successfully
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        enriched: false,
        error: error.message
      })
    };
  }
};
