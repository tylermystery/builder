/**
 * Multi-Provider AI Module
 * Centralized AI text/image generation with automatic fallback across providers.
 *
 * Supported text providers:  Google Gemini, OpenAI, Anthropic
 * Supported image providers: Google Imagen, OpenAI (DALL-E 3)
 *
 * Environment variables:
 *   GEMINI_API_KEY     - Google AI (Gemini + Imagen)
 *   OPENAI_API_KEY     - OpenAI (GPT-4o-mini + DALL-E 3)
 *   ANTHROPIC_API_KEY  - Anthropic (Claude Haiku)
 *   AI_TEXT_PROVIDER   - Preferred text provider: "auto" | "gemini" | "openai" | "anthropic" (default: "auto")
 *   AI_IMAGE_PROVIDER  - Preferred image provider: "auto" | "gemini" | "openai" (default: "auto")
 */

const {
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    ANTHROPIC_API_KEY,
    AI_TEXT_PROVIDER = 'auto',
    AI_IMAGE_PROVIDER = 'auto'
} = process.env;

// Debug: Log API key availability at module load time (NEVER log actual key values)
console.log('[ai-provider] Module loaded. API key status:', {
    GEMINI_API_KEY: GEMINI_API_KEY ? `configured (${GEMINI_API_KEY.length} chars, starts with ${GEMINI_API_KEY.substring(0, 4)}...)` : 'NOT SET',
    OPENAI_API_KEY: OPENAI_API_KEY ? `configured (${OPENAI_API_KEY.length} chars, starts with ${OPENAI_API_KEY.substring(0, 5)}...)` : 'NOT SET',
    ANTHROPIC_API_KEY: ANTHROPIC_API_KEY ? `configured (${ANTHROPIC_API_KEY.length} chars)` : 'NOT SET',
    AI_TEXT_PROVIDER,
    AI_IMAGE_PROVIDER,
});

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

const TEXT_PROVIDERS = {
    gemini: {
        name: 'Google Gemini',
        model: 'gemini-2.0-flash',
        available: () => !!GEMINI_API_KEY,
    },
    openai: {
        name: 'OpenAI',
        model: 'gpt-4o-mini',
        available: () => !!OPENAI_API_KEY,
    },
    anthropic: {
        name: 'Anthropic Claude',
        model: 'claude-haiku-4-5-20251001',
        available: () => !!ANTHROPIC_API_KEY,
    },
};

const IMAGE_PROVIDERS = {
    gemini: {
        name: 'Google Imagen',
        model: 'imagen-4.0-fast-generate-001',
        available: () => !!GEMINI_API_KEY,
    },
    openai: {
        name: 'OpenAI DALL-E',
        model: 'dall-e-3',
        available: () => !!OPENAI_API_KEY,
    },
};

// Default fallback order when preference is "auto"
const TEXT_FALLBACK_ORDER = ['gemini', 'openai', 'anthropic'];
const IMAGE_FALLBACK_ORDER = ['gemini', 'openai'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect whether a provider error is quota/billing related (do NOT retry).
 */
function isQuotaError(providerKey, status, bodyText) {
    if (status === 429) {
        if (providerKey === 'gemini') {
            return bodyText.includes('RESOURCE_EXHAUSTED') || bodyText.includes('exceeded your current quota');
        }
        // OpenAI uses 429 for both rate limit AND quota — check body
        if (providerKey === 'openai') {
            return bodyText.includes('insufficient_quota') || bodyText.includes('billing');
        }
    }
    if (providerKey === 'anthropic' && status === 429) {
        return bodyText.includes('overloaded') || bodyText.includes('credit');
    }
    return false;
}

/**
 * Determine if the error is transient (worth retrying with the SAME provider).
 */
function isTransientError(status) {
    return status === 429 || status === 500 || status === 502 || status === 503;
}

/**
 * Determine if we should attempt the next provider in the fallback chain.
 */
function shouldFallback(status, bodyText, providerKey) {
    // Quota exhaustion → definitely fallback
    if (isQuotaError(providerKey, status, bodyText)) return true;
    // Server errors → fallback
    if (status >= 500) return true;
    // 429 after retries exhausted → fallback
    if (status === 429) return true;
    // Auth/credential errors → fallback (wrong API key, no access)
    if (status === 401 || status === 403) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Provider-specific API calls — TEXT GENERATION
// ---------------------------------------------------------------------------

async function callGeminiText(prompt, config) {
    const { temperature = 0.7, maxTokens = 1024 } = config;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        return { ok: false, status: 500, errorText: 'No text in Gemini response' };
    }
    return { ok: true, text };
}

async function callOpenAIText(prompt, config) {
    const { temperature = 0.7, maxTokens = 1024 } = config;
    const url = 'https://api.openai.com/v1/chat/completions';

    const body = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const text = result?.choices?.[0]?.message?.content;
    if (!text) {
        return { ok: false, status: 500, errorText: 'No text in OpenAI response' };
    }
    return { ok: true, text };
}

async function callAnthropicText(prompt, config) {
    const { temperature = 0.7, maxTokens = 1024 } = config;
    const url = 'https://api.anthropic.com/v1/messages';

    const body = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
    };

    // Only include temperature if it's not the default (Anthropic handles 0-1 range)
    if (temperature !== undefined) body.temperature = temperature;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const text = result?.content?.[0]?.text;
    if (!text) {
        return { ok: false, status: 500, errorText: 'No text in Anthropic response' };
    }
    return { ok: true, text };
}

const TEXT_CALLERS = {
    gemini: callGeminiText,
    openai: callOpenAIText,
    anthropic: callAnthropicText,
};

// ---------------------------------------------------------------------------
// Provider-specific API calls — VISION (image analysis)
// ---------------------------------------------------------------------------

async function callGeminiVision(prompt, base64ImageData, config) {
    const { temperature, maxTokens = 1024 } = config;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const body = {
        contents: [{
            role: 'user',
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: base64ImageData } }
            ]
        }],
    };
    if (temperature !== undefined || maxTokens) {
        body.generationConfig = {};
        if (temperature !== undefined) body.generationConfig.temperature = temperature;
        if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, status: 500, errorText: 'No text in Gemini vision response' };
    return { ok: true, text };
}

async function callOpenAIVision(prompt, base64ImageData, config) {
    const { temperature = 0.5, maxTokens = 1024 } = config;
    const url = 'https://api.openai.com/v1/chat/completions';

    const body = {
        model: 'gpt-4o-mini',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64ImageData}` } }
            ]
        }],
        temperature,
        max_tokens: maxTokens,
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const text = result?.choices?.[0]?.message?.content;
    if (!text) return { ok: false, status: 500, errorText: 'No text in OpenAI vision response' };
    return { ok: true, text };
}

async function callAnthropicVision(prompt, base64ImageData, config) {
    const { temperature = 0.5, maxTokens = 1024 } = config;
    const url = 'https://api.anthropic.com/v1/messages';

    const body = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{
            role: 'user',
            content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64ImageData } },
                { type: 'text', text: prompt }
            ]
        }],
    };
    if (temperature !== undefined) body.temperature = temperature;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const text = result?.content?.[0]?.text;
    if (!text) return { ok: false, status: 500, errorText: 'No text in Anthropic vision response' };
    return { ok: true, text };
}

const VISION_CALLERS = {
    gemini: callGeminiVision,
    openai: callOpenAIVision,
    anthropic: callAnthropicVision,
};

// ---------------------------------------------------------------------------
// Provider-specific API calls — IMAGE GENERATION
// ---------------------------------------------------------------------------

async function callGeminiImage(prompt, config) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict`;

    console.log('[ai-provider] [callGeminiImage] Making request to Imagen API');
    console.log('[ai-provider] [callGeminiImage] Prompt length:', prompt.length);
    console.log('[ai-provider] [callGeminiImage] Config:', { aspectRatio: config.aspectRatio || '1:1' });
    console.log('[ai-provider] [callGeminiImage] API key present:', !!GEMINI_API_KEY);

    const requestBody = {
        instances: [{ prompt }],
        parameters: {
            sampleCount: 1,
            aspectRatio: config.aspectRatio || '1:1',
            personGeneration: 'allow_adult',
        },
    };
    console.log('[ai-provider] [callGeminiImage] Request body (without prompt):', JSON.stringify({
        instances: [{ prompt: prompt.substring(0, 100) + '...' }],
        parameters: requestBody.parameters,
    }));

    const _start = Date.now();
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-goog-api-key': GEMINI_API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });
    const _elapsed = Date.now() - _start;

    console.log('[ai-provider] [callGeminiImage] Response status:', response.status, 'in', _elapsed, 'ms');
    console.log('[ai-provider] [callGeminiImage] Response headers content-type:', response.headers.get('content-type'));

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[ai-provider] [callGeminiImage] ERROR response body:', errorText.substring(0, 500));
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const b64 = result?.predictions?.[0]?.bytesBase64Encoded;
    console.log('[ai-provider] [callGeminiImage] Response parsed. Has predictions:', !!result?.predictions, 'predictions count:', result?.predictions?.length || 0);
    console.log('[ai-provider] [callGeminiImage] Base64 data present:', !!b64, 'length:', b64?.length || 0);

    if (!b64) {
        console.error('[ai-provider] [callGeminiImage] No image data in response. Full response keys:', Object.keys(result || {}));
        return { ok: false, status: 500, errorText: 'No image data in Imagen response' };
    }
    return { ok: true, base64: b64, format: 'png' };
}

async function callOpenAIImage(prompt, config) {
    const url = 'https://api.openai.com/v1/images/generations';

    console.log('[ai-provider] [callOpenAIImage] Making request to DALL-E 3 API');
    console.log('[ai-provider] [callOpenAIImage] Prompt length:', prompt.length);
    console.log('[ai-provider] [callOpenAIImage] Config size:', config.size || '1024x1024');
    console.log('[ai-provider] [callOpenAIImage] API key present:', !!OPENAI_API_KEY);

    const body = {
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: config.size || '1024x1024',
        response_format: 'b64_json',
        quality: 'standard',
    };

    const _start = Date.now();
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
    });
    const _elapsed = Date.now() - _start;

    console.log('[ai-provider] [callOpenAIImage] Response status:', response.status, 'in', _elapsed, 'ms');
    console.log('[ai-provider] [callOpenAIImage] Response headers content-type:', response.headers.get('content-type'));

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[ai-provider] [callOpenAIImage] ERROR response body:', errorText.substring(0, 500));
        return { ok: false, status: response.status, errorText };
    }

    const result = await response.json();
    const b64 = result?.data?.[0]?.b64_json;
    console.log('[ai-provider] [callOpenAIImage] Response parsed. Has data:', !!result?.data, 'data count:', result?.data?.length || 0);
    console.log('[ai-provider] [callOpenAIImage] Base64 data present:', !!b64, 'length:', b64?.length || 0);

    if (!b64) {
        console.error('[ai-provider] [callOpenAIImage] No image data in response. Full response keys:', Object.keys(result || {}));
        return { ok: false, status: 500, errorText: 'No image data in DALL-E response' };
    }
    return { ok: true, base64: b64, format: 'png' };
}

const IMAGE_CALLERS = {
    gemini: callGeminiImage,
    openai: callOpenAIImage,
};

// ---------------------------------------------------------------------------
// Core: build provider chain
// ---------------------------------------------------------------------------

function buildProviderChain(preference, providerMap, fallbackOrder) {
    console.log('[ai-provider] [buildProviderChain] preference:', preference, 'fallbackOrder:', fallbackOrder);
    const availability = {};
    for (const key of fallbackOrder) {
        availability[key] = providerMap[key]?.available() || false;
    }
    console.log('[ai-provider] [buildProviderChain] Provider availability:', availability);

    if (preference !== 'auto' && providerMap[preference]?.available()) {
        // Preferred provider first, then others as fallback
        const chain = [preference, ...fallbackOrder.filter(k => k !== preference)];
        const result = chain.filter(k => providerMap[k]?.available());
        console.log('[ai-provider] [buildProviderChain] Using preferred chain:', result);
        return result;
    }
    // Auto: use fallback order, filter to available
    const result = fallbackOrder.filter(k => providerMap[k]?.available());
    console.log('[ai-provider] [buildProviderChain] Using auto chain:', result);
    return result;
}

// ---------------------------------------------------------------------------
// Core: generateText — with retry + fallback
// ---------------------------------------------------------------------------

/**
 * Generate text using AI with automatic provider fallback.
 * @param {string} prompt - The prompt to send
 * @param {object} config - { temperature, maxTokens, maxRetries, caller }
 * @returns {Promise<{ok: boolean, text?: string, provider: string, error?: string, quotaExhausted?: boolean}>}
 */
async function generateText(prompt, config = {}) {
    const { maxRetries = 1, caller = 'unknown' } = config;
    const chain = buildProviderChain(AI_TEXT_PROVIDER, TEXT_PROVIDERS, TEXT_FALLBACK_ORDER);

    if (chain.length === 0) {
        return { ok: false, error: 'No AI text providers configured. Set at least one of: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY', quotaExhausted: false, provider: 'none' };
    }

    console.log(`[ai-provider] [${caller}] Provider chain: [${chain.join(' → ')}] (preference: ${AI_TEXT_PROVIDER})`);

    let lastError = null;

    for (const providerKey of chain) {
        const callFn = TEXT_CALLERS[providerKey];
        const providerName = TEXT_PROVIDERS[providerKey].name;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[ai-provider] [${caller}] Trying ${providerName} (attempt ${attempt + 1}/${maxRetries + 1})`);
                const result = await callFn(prompt, config);

                if (result.ok) {
                    console.log(`[ai-provider] [${caller}] Success with ${providerName}`);
                    return { ok: true, text: result.text, provider: providerKey, providerName };
                }

                // Non-OK result
                const { status, errorText } = result;
                console.error(`[ai-provider] [${caller}] ${providerName} returned ${status}: ${errorText?.substring(0, 200)}`);

                if (isQuotaError(providerKey, status, errorText || '')) {
                    console.warn(`[ai-provider] [${caller}] ${providerName} quota exhausted. Falling back.`);
                    lastError = { status, errorText, provider: providerKey, quotaExhausted: true };
                    break; // Skip retries, go to next provider
                }

                if (isTransientError(status) && attempt < maxRetries) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 6000);
                    console.log(`[ai-provider] [${caller}] Transient ${status}. Retry after ${Math.round(backoffMs)}ms`);
                    await sleep(backoffMs);
                    continue;
                }

                // Non-transient or retries exhausted
                lastError = { status, errorText, provider: providerKey, quotaExhausted: false };
                if (shouldFallback(status, errorText || '', providerKey)) {
                    console.log(`[ai-provider] [${caller}] ${providerName} failed (${status}). Falling back to next provider.`);
                    break; // try next provider
                }
                // Only stop the chain entirely for 400 Bad Request (prompt/content issue)
                if (status === 400) {
                    return { ok: false, error: `${providerName}: ${errorText}`, provider: providerKey, quotaExhausted: false };
                }
                break;
            } catch (networkError) {
                console.error(`[ai-provider] [${caller}] ${providerName} network error:`, networkError.message);
                lastError = { status: 0, errorText: networkError.message, provider: providerKey, quotaExhausted: false };
                break; // try next provider
            }
        }
    }

    // All providers failed
    const allQuotaExhausted = lastError?.quotaExhausted || false;
    return {
        ok: false,
        error: lastError?.errorText || 'All AI providers failed',
        provider: lastError?.provider || 'none',
        quotaExhausted: allQuotaExhausted,
        statusCode: lastError?.status || 500,
    };
}

// ---------------------------------------------------------------------------
// Core: analyzeImage (vision) — with retry + fallback
// ---------------------------------------------------------------------------

/**
 * Analyze an image using AI vision with automatic provider fallback.
 * @param {string} prompt - The analysis prompt
 * @param {string} base64ImageData - Base64-encoded image data
 * @param {object} config - { temperature, maxTokens, maxRetries, caller }
 * @returns {Promise<{ok: boolean, text?: string, provider: string, error?: string}>}
 */
async function analyzeImage(prompt, base64ImageData, config = {}) {
    const { maxRetries = 1, caller = 'unknown' } = config;
    const chain = buildProviderChain(AI_TEXT_PROVIDER, TEXT_PROVIDERS, TEXT_FALLBACK_ORDER);

    if (chain.length === 0) {
        return { ok: false, error: 'No AI vision providers configured.', provider: 'none' };
    }

    console.log(`[ai-provider] [${caller}] Vision provider chain: [${chain.join(' → ')}]`);

    let lastError = null;

    for (const providerKey of chain) {
        const callFn = VISION_CALLERS[providerKey];
        if (!callFn) continue;
        const providerName = TEXT_PROVIDERS[providerKey].name;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[ai-provider] [${caller}] Vision: trying ${providerName} (attempt ${attempt + 1})`);
                const result = await callFn(prompt, base64ImageData, config);

                if (result.ok) {
                    console.log(`[ai-provider] [${caller}] Vision success with ${providerName}`);
                    return { ok: true, text: result.text, provider: providerKey, providerName };
                }

                const { status, errorText } = result;
                console.error(`[ai-provider] [${caller}] Vision ${providerName} returned ${status}: ${errorText?.substring(0, 200)}`);

                if (isQuotaError(providerKey, status, errorText || '')) {
                    lastError = { status, errorText, provider: providerKey, quotaExhausted: true };
                    break;
                }
                if (isTransientError(status) && attempt < maxRetries) {
                    await sleep(Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 6000));
                    continue;
                }
                lastError = { status, errorText, provider: providerKey };
                if (shouldFallback(status, errorText || '', providerKey)) {
                    console.log(`[ai-provider] [${caller}] Vision ${providerName} failed (${status}). Falling back.`);
                    break;
                }
                // Only stop chain on 400 Bad Request (content/prompt issue)
                if (status === 400) {
                    return { ok: false, error: `${providerName}: ${errorText}`, provider: providerKey };
                }
                break;
            } catch (networkError) {
                console.error(`[ai-provider] [${caller}] Vision ${providerName} network error:`, networkError.message);
                lastError = { status: 0, errorText: networkError.message, provider: providerKey };
                break;
            }
        }
    }

    return {
        ok: false,
        error: lastError?.errorText || 'All AI vision providers failed',
        provider: lastError?.provider || 'none',
        quotaExhausted: lastError?.quotaExhausted || false,
    };
}

// ---------------------------------------------------------------------------
// Core: generateImage — with retry + fallback
// ---------------------------------------------------------------------------

/**
 * Generate an image using AI with automatic provider fallback.
 * @param {string} prompt - The image generation prompt
 * @param {object} config - { aspectRatio, size, maxRetries, caller }
 * @returns {Promise<{ok: boolean, base64?: string, format?: string, provider: string, error?: string}>}
 */
async function generateImage(prompt, config = {}) {
    const { maxRetries = 1, caller = 'unknown' } = config;
    console.log(`[ai-provider] [${caller}] ====== generateImage called ======`);
    console.log(`[ai-provider] [${caller}] Prompt (first 200 chars):`, prompt.substring(0, 200));
    console.log(`[ai-provider] [${caller}] Config:`, { ...config, maxRetries, caller });

    const chain = buildProviderChain(AI_IMAGE_PROVIDER, IMAGE_PROVIDERS, IMAGE_FALLBACK_ORDER);

    if (chain.length === 0) {
        console.error(`[ai-provider] [${caller}] NO PROVIDERS AVAILABLE! AI_IMAGE_PROVIDER=${AI_IMAGE_PROVIDER}`);
        console.error(`[ai-provider] [${caller}] GEMINI_API_KEY set: ${!!GEMINI_API_KEY}, OPENAI_API_KEY set: ${!!OPENAI_API_KEY}`);
        return { ok: false, error: 'No AI image providers configured. Set GEMINI_API_KEY or OPENAI_API_KEY.', provider: 'none' };
    }

    console.log(`[ai-provider] [${caller}] Image provider chain: [${chain.join(' → ')}] (preference: ${AI_IMAGE_PROVIDER})`);

    let lastError = null;

    for (const providerKey of chain) {
        const callFn = IMAGE_CALLERS[providerKey];
        const providerName = IMAGE_PROVIDERS[providerKey].name;
        console.log(`[ai-provider] [${caller}] ---- Starting provider: ${providerName} (${providerKey}) ----`);

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[ai-provider] [${caller}] Image gen: trying ${providerName} (attempt ${attempt + 1}/${maxRetries + 1})`);
                const _attemptStart = Date.now();
                const result = await callFn(prompt, config);
                const _attemptElapsed = Date.now() - _attemptStart;

                if (result.ok) {
                    console.log(`[ai-provider] [${caller}] Image gen SUCCESS with ${providerName} in ${_attemptElapsed}ms`);
                    console.log(`[ai-provider] [${caller}] Result: base64 length=${result.base64?.length || 0}, format=${result.format}`);
                    return { ok: true, base64: result.base64, format: result.format, provider: providerKey, providerName };
                }

                const { status, errorText } = result;
                console.error(`[ai-provider] [${caller}] Image gen ${providerName} FAILED in ${_attemptElapsed}ms - status ${status}`);
                console.error(`[ai-provider] [${caller}] Image gen ${providerName} error: ${errorText?.substring(0, 300)}`);

                if (isQuotaError(providerKey, status, errorText || '')) {
                    console.warn(`[ai-provider] [${caller}] QUOTA EXHAUSTED for ${providerName}. Skipping retries, falling back.`);
                    lastError = { status, errorText, provider: providerKey, quotaExhausted: true };
                    break;
                }
                if (isTransientError(status) && attempt < maxRetries) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 6000);
                    console.log(`[ai-provider] [${caller}] Transient error (${status}). Retrying in ${Math.round(backoffMs)}ms...`);
                    await sleep(backoffMs);
                    continue;
                }
                lastError = { status, errorText, provider: providerKey };
                if (shouldFallback(status, errorText || '', providerKey)) {
                    console.log(`[ai-provider] [${caller}] Image gen ${providerName} failed (${status}). Falling back to next provider.`);
                    break;
                }
                // Only stop chain on 400 Bad Request (content/prompt issue)
                if (status === 400) {
                    console.error(`[ai-provider] [${caller}] 400 Bad Request from ${providerName} — stopping chain (likely prompt issue)`);
                    return { ok: false, error: `${providerName}: ${errorText}`, provider: providerKey };
                }
                console.warn(`[ai-provider] [${caller}] Non-retryable, non-fallback error from ${providerName}: ${status}`);
                break;
            } catch (networkError) {
                console.error(`[ai-provider] [${caller}] Image gen ${providerName} NETWORK ERROR:`, networkError.message);
                console.error(`[ai-provider] [${caller}] Network error stack:`, networkError.stack);
                lastError = { status: 0, errorText: networkError.message, provider: providerKey };
                break;
            }
        }
    }

    console.error(`[ai-provider] [${caller}] ====== ALL PROVIDERS FAILED ======`);
    console.error(`[ai-provider] [${caller}] Last error:`, JSON.stringify(lastError));

    return {
        ok: false,
        error: lastError?.errorText || 'All AI image providers failed',
        provider: lastError?.provider || 'none',
        quotaExhausted: lastError?.quotaExhausted || false,
    };
}

// ---------------------------------------------------------------------------
// Status: get current provider availability
// ---------------------------------------------------------------------------

function getProviderStatus() {
    const textProviders = {};
    for (const [key, info] of Object.entries(TEXT_PROVIDERS)) {
        textProviders[key] = {
            name: info.name,
            model: info.model,
            configured: info.available(),
        };
    }

    const imageProviders = {};
    for (const [key, info] of Object.entries(IMAGE_PROVIDERS)) {
        imageProviders[key] = {
            name: info.name,
            model: info.model,
            configured: info.available(),
        };
    }

    const textChain = buildProviderChain(AI_TEXT_PROVIDER, TEXT_PROVIDERS, TEXT_FALLBACK_ORDER);
    const imageChain = buildProviderChain(AI_IMAGE_PROVIDER, IMAGE_PROVIDERS, IMAGE_FALLBACK_ORDER);

    return {
        textPreference: AI_TEXT_PROVIDER,
        imagePreference: AI_IMAGE_PROVIDER,
        textProviders,
        imageProviders,
        textFallbackChain: textChain,
        imageFallbackChain: imageChain,
        primaryTextProvider: textChain[0] || null,
        primaryImageProvider: imageChain[0] || null,
    };
}

// ---------------------------------------------------------------------------
// JSON parsing helper (shared across all functions)
// ---------------------------------------------------------------------------

/**
 * Extract and parse JSON from an AI response text, handling markdown code blocks.
 * @param {string} text - Raw AI response text
 * @returns {object} Parsed JSON object
 */
function parseJsonResponse(text) {
    // Strip markdown code blocks
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Try direct parse first
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Try to extract JSON object from the text
        const objMatch = cleaned.match(/\{[\s\S]*\}/);
        if (objMatch) {
            try { return JSON.parse(objMatch[0]); } catch (e2) { /* fall through */ }
        }
        // Try to extract JSON array from the text
        const arrMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrMatch) {
            try { return JSON.parse(arrMatch[0]); } catch (e2) { /* fall through */ }
        }
        throw new Error(`Failed to parse AI response as JSON: ${text.substring(0, 200)}`);
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    generateText,
    analyzeImage,
    generateImage,
    getProviderStatus,
    parseJsonResponse,
    TEXT_PROVIDERS,
    IMAGE_PROVIDERS,
};
