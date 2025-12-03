// components/aiManager.js
var AI_MANAGER_ENDPOINT = "/api/ai-project-manager";
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
function createStrategyCard(task, index) {
  const priorityClass = `priority-${(task.Priority || "Medium").toLowerCase()}`;
  const typeIcon = getTypeIcon(task.Type);
  return `
        <div class="strategy-card ${priorityClass}">
            <div class="strategy-card-header">
                <span class="strategy-type-badge">${typeIcon} ${task.Type || "Task"}</span>
                <span class="strategy-priority-badge">${task.Priority || "Medium"}</span>
            </div>
            <h5 class="strategy-card-title">${task.TaskName || "Untitled Task"}</h5>
            <div class="strategy-card-meta">
                <div class="strategy-meta-item">
                    <span class="meta-label">ROI/Benefit:</span>
                    <span class="meta-value">${task.BusinessHealthBenefit || "Not specified"}</span>
                </div>
                <div class="strategy-meta-item">
                    <span class="meta-label">Success Criteria:</span>
                    <span class="meta-value">${task.SuccessCriteria || "Not specified"}</span>
                </div>
                <div class="strategy-meta-item">
                    <span class="meta-label">Estimated Effort:</span>
                    <span class="meta-value">${task.TargetHours || "?"} hours</span>
                </div>
            </div>
        </div>
    `;
}
function getTypeIcon(type) {
  switch (type) {
    case "Short Term Fix":
      return "⚡";
    // Lightning bolt
    case "Long Term Strategy":
      return "������";
    // Target
    case "Operational Improvement":
      return "⚙️";
    // Gear
    default:
      return "������";
  }
}
async function handleSubmit() {
  const inputEl = document.getElementById("ai-manager-input");
  const submitBtn = document.getElementById("ai-manager-submit");
  const btnText = submitBtn.querySelector(".btn-text");
  const btnLoading = submitBtn.querySelector(".btn-loading");
  const errorEl = document.getElementById("ai-manager-error");
  const resultsEl = document.getElementById("ai-manager-results");
  const summaryTextEl = document.getElementById("ai-summary-text");
  const gridEl = document.getElementById("ai-strategy-grid");
  const userInput = inputEl.value.trim();
  if (!userInput) {
    showError("Please enter your business status or challenges before analyzing.");
    return;
  }
  if (userInput.length < 20) {
    showError("Please provide more detail (at least 20 characters) for a meaningful analysis.");
    return;
  }
  errorEl.style.display = "none";
  resultsEl.style.display = "none";
  submitBtn.disabled = true;
  btnText.style.display = "none";
  btnLoading.style.display = "inline-flex";
  try {
    const response = await fetch(AI_MANAGER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "Analysis failed. Please try again.");
    }
    summaryTextEl.textContent = data.summary || "Analysis complete.";
    if (Array.isArray(data.tasks) && data.tasks.length > 0) {
      gridEl.innerHTML = data.tasks.map((task, index) => createStrategyCard(task, index)).join("");
    } else {
      gridEl.innerHTML = '<p class="no-tasks-message">No strategic tasks were generated. Try providing more specific details.</p>';
    }
    resultsEl.style.display = "block";
    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    inputEl.value = "";
  } catch (error) {
    console.error("[AI Manager] Error:", error);
    showError(error.message || "An unexpected error occurred. Please try again.");
  } finally {
    submitBtn.disabled = false;
    btnText.style.display = "inline";
    btnLoading.style.display = "none";
  }
}
function showError(message) {
  const errorEl = document.getElementById("ai-manager-error");
  errorEl.textContent = message;
  errorEl.style.display = "block";
}
function initAiManager() {
  const container = document.getElementById("ai-manager-container");
  if (!container) {
    console.warn("[AI Manager] Container #ai-manager-container not found.");
    return;
  }
  container.innerHTML = createAiManagerHTML();
  const submitBtn = document.getElementById("ai-manager-submit");
  if (submitBtn) {
    submitBtn.addEventListener("click", handleSubmit);
  }
  const inputEl = document.getElementById("ai-manager-input");
  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        handleSubmit();
      }
    });
  }
  console.log("[AI Manager] Component initialized.");
}

// store-dashboard.js
var PROFILE_ENDPOINT = "/api/profile-item";
var GET_ITEMS_ENDPOINT = "/api/get-items-for-profiling";
async function fetchItemsForProfiling() {
  console.log(`Fetching all items for profiling via ${GET_ITEMS_ENDPOINT}...`);
  try {
    const response = await fetch(GET_ITEMS_ENDPOINT);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching items from proxy:`, errorText);
      throw new Error(`Failed to fetch items. Status: ${response.status}`);
    }
    const allRecords = await response.json();
    console.log(`Total item records fetched via proxy: ${allRecords.length}`);
    return allRecords;
  } catch (error) {
    console.error("Error in fetchItemsForProfiling:", error);
    throw error;
  }
}
function setupAdminTools() {
  const bulkProfileBtn = document.getElementById("admin-bulk-profile-btn");
  const statusMessage = document.getElementById("admin-status-message");
  if (!bulkProfileBtn || !statusMessage) return;
  bulkProfileBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to run the bulk profiler? This will call the AI API for all un-profiled items.")) {
      return;
    }
    bulkProfileBtn.disabled = true;
    statusMessage.style.color = "#333";
    statusMessage.textContent = "Fetching item list...";
    try {
      const allItems = await fetchItemsForProfiling();
      const itemsToProfile = allItems.filter((item) => {
        if (!item.fields.AI_Profile) return true;
        try {
          const profile = JSON.parse(item.fields.AI_Profile);
          return !profile.profileSource;
        } catch (e) {
          return true;
        }
      });
      if (itemsToProfile.length === 0) {
        statusMessage.style.color = "#28a745";
        statusMessage.textContent = "Success! All items are already profiled.";
        bulkProfileBtn.disabled = false;
        return;
      }
      statusMessage.textContent = `Profiling ${itemsToProfile.length} items. Please keep this tab open...`;
      let successCount = 0;
      let failCount = 0;
      for (const item of itemsToProfile) {
        try {
          const response = await fetch(PROFILE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recordId: item.id })
          });
          if (!response.ok) {
            const errText = await response.text();
            console.error(`Failed to profile ${item.fields.Name}:`, errText);
            throw new Error(`API Error ${response.status}`);
          }
          successCount++;
          statusMessage.textContent = `Profiling... (${successCount}/${itemsToProfile.length})`;
        } catch (err) {
          failCount++;
          console.error(`Failed to profile ${item.fields.Name}:`, err.message);
        }
      }
      statusMessage.style.color = "#28a745";
      statusMessage.textContent = `Complete! Success: ${successCount}, Failed: ${failCount}.`;
      bulkProfileBtn.disabled = false;
    } catch (err) {
      statusMessage.style.color = "#dc3545";
      statusMessage.textContent = `Error: ${err.message}`;
      bulkProfileBtn.disabled = false;
    }
  });
}
async function initializeDashboard() {
  const urlParams = new URLSearchParams(window.location.search);
  const ownerId = urlParams.get("id");
  if (!ownerId) {
    document.body.innerHTML = "<h1>Error: No dashboard ID provided.</h1>";
    return;
  }
  try {
    const response = await fetch(`/api/get-store-data-by-owner-id?id=${ownerId}`);
    if (!response.ok) {
      const errorData = await response.text();
      console.error("Failed to load store data:", errorData);
      throw new Error("Could not load store data. Check function logs.");
    }
    const { store, items } = await response.json();
    document.getElementById("store-name-header").textContent = `${store.fields.Name} Dashboard`;
    let itemsHtml = items.map((item) => `<div>${item.fields.Name}</div>`).join("");
    document.getElementById("item-list-container").innerHTML = `<ul>${itemsHtml}</ul>`;
    setupAdminTools();
    initAiManager();
  } catch (error) {
    document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
  }
}
initializeDashboard();
//# sourceMappingURL=store-dashboard.bundle.js.map
