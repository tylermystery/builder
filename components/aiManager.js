// FILE: components/aiManager.js
// AI Strategic Project Manager - Frontend UI Component

const AI_MANAGER_ENDPOINT = '/api/ai-project-manager';

/**
 * Creates the HTML structure for the AI Manager component.
 * @returns {string} HTML string for the component.
 */
function createAiManagerHTML() {
    return `
        <div class="ai-manager-card">
            <div class="ai-manager-header">
                <div class="ai-manager-title-row">
                    <h3>AI Strategic Project Manager</h3>
                    <span class="ai-beta-badge">Strategic Beta</span>
                </div>
                <p class="ai-manager-subtitle">Enter your business status, challenges, or ideas. Our AI will analyze and generate a strategic roadmap.</p>
            </div>

            <div class="ai-manager-input-section">
                <textarea
                    id="ai-manager-input"
                    class="ai-manager-textarea"
                    placeholder="Example: Revenue is down 15% this quarter. Customer complaints about shipping times are increasing. Need to launch a marketing campaign for the holiday season..."
                    rows="4"
                ></textarea>
                <button id="ai-manager-submit" class="ai-manager-submit-btn">
                    <span class="btn-text">Analyze & Generate Roadmap</span>
                    <span class="btn-loading" style="display: none;">
                        <span class="spinner"></span> Analyzing...
                    </span>
                </button>
            </div>

            <div id="ai-manager-error" class="ai-manager-error" style="display: none;"></div>

            <div id="ai-manager-results" class="ai-manager-results" style="display: none;">
                <div class="ai-results-summary">
                    <h4>Strategic Overview</h4>
                    <p id="ai-summary-text"></p>
                </div>

                <div class="ai-results-tasks">
                    <h4>Generated Roadmap</h4>
                    <div id="ai-strategy-grid" class="strategy-grid"></div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Creates HTML for a single strategy card.
 * @param {object} task - Task object from AI analysis.
 * @param {number} index - Task index for display.
 * @returns {string} HTML string for the strategy card.
 */
function createStrategyCard(task, index) {
    const priorityClass = `priority-${(task.Priority || 'Medium').toLowerCase()}`;
    const typeIcon = getTypeIcon(task.Type);

    return `
        <div class="strategy-card ${priorityClass}">
            <div class="strategy-card-header">
                <span class="strategy-type-badge">${typeIcon} ${task.Type || 'Task'}</span>
                <span class="strategy-priority-badge">${task.Priority || 'Medium'}</span>
            </div>
            <h5 class="strategy-card-title">${task.TaskName || 'Untitled Task'}</h5>
            <div class="strategy-card-meta">
                <div class="strategy-meta-item">
                    <span class="meta-label">ROI/Benefit:</span>
                    <span class="meta-value">${task.BusinessHealthBenefit || 'Not specified'}</span>
                </div>
                <div class="strategy-meta-item">
                    <span class="meta-label">Success Criteria:</span>
                    <span class="meta-value">${task.SuccessCriteria || 'Not specified'}</span>
                </div>
                <div class="strategy-meta-item">
                    <span class="meta-label">Estimated Effort:</span>
                    <span class="meta-value">${task.TargetHours || '?'} hours</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Returns an icon based on task type.
 * @param {string} type - Task type.
 * @returns {string} Icon character.
 */
function getTypeIcon(type) {
    switch (type) {
        case 'Short Term Fix':
            return '‚ö°'; // Lightning bolt
        case 'Long Term Strategy':
            return 'Ì†ºÌæØ'; // Target
        case 'Operational Improvement':
            return '‚öôÔ∏è'; // Gear
        default:
            return 'Ì†ΩÌ≥ã'; // Clipboard
    }
}

/**
 * Handles the form submission and API call.
 */
async function handleSubmit() {
    const inputEl = document.getElementById('ai-manager-input');
    const submitBtn = document.getElementById('ai-manager-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    const errorEl = document.getElementById('ai-manager-error');
    const resultsEl = document.getElementById('ai-manager-results');
    const summaryTextEl = document.getElementById('ai-summary-text');
    const gridEl = document.getElementById('ai-strategy-grid');

    const userInput = inputEl.value.trim();

    // Validate input
    if (!userInput) {
        showError('Please enter your business status or challenges before analyzing.');
        return;
    }

    if (userInput.length < 20) {
        showError('Please provide more detail (at least 20 characters) for a meaningful analysis.');
        return;
    }

    // Hide previous results and errors
    errorEl.style.display = 'none';
    resultsEl.style.display = 'none';

    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline-flex';

    try {
        const response = await fetch(AI_MANAGER_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userInput })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Analysis failed. Please try again.');
        }

        // Display the summary
        summaryTextEl.textContent = data.summary || 'Analysis complete.';

        // Display the strategy cards
        if (Array.isArray(data.tasks) && data.tasks.length > 0) {
            gridEl.innerHTML = data.tasks.map((task, index) => createStrategyCard(task, index)).join('');
        } else {
            gridEl.innerHTML = '<p class="no-tasks-message">No strategic tasks were generated. Try providing more specific details.</p>';
        }

        // Show results
        resultsEl.style.display = 'block';

        // Scroll to results
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Clear the input for next use
        inputEl.value = '';

    } catch (error) {
        console.error('[AI Manager] Error:', error);
        showError(error.message || 'An unexpected error occurred. Please try again.');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
}

/**
 * Displays an error message.
 * @param {string} message - Error message to display.
 */
function showError(message) {
    const errorEl = document.getElementById('ai-manager-error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

/**
 * Initializes the AI Manager component.
 * Call this function from store-dashboard.js.
 */
export function initAiManager() {
    const container = document.getElementById('ai-manager-container');

    if (!container) {
        console.warn('[AI Manager] Container #ai-manager-container not found.');
        return;
    }

    // Inject the HTML
    container.innerHTML = createAiManagerHTML();

    // Wire up the submit button
    const submitBtn = document.getElementById('ai-manager-submit');
    if (submitBtn) {
        submitBtn.addEventListener('click', handleSubmit);
    }

    // Allow Ctrl+Enter to submit from textarea
    const inputEl = document.getElementById('ai-manager-input');
    if (inputEl) {
        inputEl.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                handleSubmit();
            }
        });
    }

    console.log('[AI Manager] Component initialized.');
}
