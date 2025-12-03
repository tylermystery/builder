// crm.js
var AIRTABLE_PAT = "patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57";
var BASE_ID = "app5yTznb3R5YNUFw";
var SESSIONS_TABLE = "Sessions";
var MESSAGES_TABLE = "Messages";
var CATALOG_TABLE = "tblUA4uuS8IYlhKpD";
var TEAMMATES_TABLE = "Teammates";
var PUSHER_KEY = "236f480714e5001590b5";
var PUSHER_CLUSTER = "us3";
var ARCHIVE_STORAGE_KEY = "tmt-archived-sessions";
var MODULE_STATE_KEY = "tmt-active-modules";
var currentlySelectedSessionId = null;
var allSessions = [];
var allMessages = [];
var allCatalogItems = [];
var allTeammates = [];
var sessionMap = /* @__PURE__ */ new Map();
var catalogMap = /* @__PURE__ */ new Map();
var archivedSessionIds = /* @__PURE__ */ new Set();
var unreadArchivedSessions = /* @__PURE__ */ new Set();
var pusherChannelMap = /* @__PURE__ */ new Map();
var pendingNewItemData = null;
var activeModules = /* @__PURE__ */ new Set(["sessions", "feed"]);
var loadingIndicator = document.getElementById("loading");
var sessionListContainer = document.getElementById("session-list");
var archiveListContainer = document.getElementById("archive-list");
var activityFeed = document.getElementById("activity-feed");
var planView = document.getElementById("plan-view");
var planViewPlaceholder = document.getElementById("plan-view-placeholder");
var chatPane = document.getElementById("chat-pane");
var chatPlaceholder = document.getElementById("chat-placeholder");
var chatMessagesContainer = document.getElementById("chat-messages");
var chatForm = document.getElementById("chat-form");
var chatInput = document.getElementById("chat-input");
var omniSearchForm = document.getElementById("omni-search-form");
var omniSearchInput = document.getElementById("omni-search-input");
var omniSearchBtn = document.getElementById("omni-search-btn");
var omniSearchResults = document.getElementById("omni-search-results");
var modulesGrid = document.querySelector(".modules-grid");
function loadModuleState() {
  const stored = localStorage.getItem(MODULE_STATE_KEY);
  if (stored) {
    activeModules = new Set(JSON.parse(stored));
  }
}
function saveModuleState() {
  localStorage.setItem(MODULE_STATE_KEY, JSON.stringify(Array.from(activeModules)));
}
function updateModuleVisibility() {
  const moduleToggleButtons = document.querySelectorAll(".module-toggle");
  moduleToggleButtons.forEach((btn) => {
    const moduleName = btn.dataset.module;
    if (activeModules.has(moduleName)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  const allPanels = document.querySelectorAll(".panel");
  allPanels.forEach((panel) => {
    const moduleName = panel.id.replace("module-", "");
    if (activeModules.has(moduleName)) {
      panel.classList.add("visible");
    } else {
      panel.classList.remove("visible");
    }
  });
  const activeCount = activeModules.size;
  modulesGrid.className = "modules-grid";
  if (activeCount === 1) modulesGrid.classList.add("cols-1");
  else if (activeCount === 2) modulesGrid.classList.add("cols-2");
  else if (activeCount === 3) modulesGrid.classList.add("cols-3");
  else if (activeCount === 4) modulesGrid.classList.add("cols-4");
  else modulesGrid.classList.add("cols-5");
}
function toggleModule(moduleName) {
  if (activeModules.has(moduleName)) {
    activeModules.delete(moduleName);
  } else {
    activeModules.add(moduleName);
  }
  saveModuleState();
  updateModuleVisibility();
}
function setupModuleToggles() {
  const moduleToggleButtons = document.querySelectorAll(".module-toggle");
  moduleToggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleModule(btn.dataset.module);
    });
  });
}
function loadArchivedState() {
  const stored = localStorage.getItem(ARCHIVE_STORAGE_KEY);
  if (stored) {
    archivedSessionIds = new Set(JSON.parse(stored));
  }
}
function saveArchivedState() {
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(Array.from(archivedSessionIds)));
}
async function fetchAirtableData(tableName) {
  let allRecords = [];
  let offset = null;
  const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${tableName}`;
  try {
    do {
      let fetchUrl = baseUrl;
      if (offset) {
        if (typeof offset === "string" && offset.startsWith("itr")) {
          fetchUrl = `${baseUrl}?offset=${offset}`;
        } else {
          console.warn(`Invalid Airtable offset detected for ${tableName}: ${offset}`);
          break;
        }
      }
      const response = await fetch(fetchUrl, { headers: { "Authorization": `Bearer ${AIRTABLE_PAT}` } });
      if (!response.ok) {
        console.error(`Airtable API request failed for URL: ${fetchUrl}`);
        throw new Error(`Failed to fetch from ${tableName} (Status: ${response.status})`);
      }
      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);
    return allRecords;
  } catch (error) {
    console.error("Airtable fetch error:", error);
    throw error;
  }
}
async function postChatMessage(sessionId, content) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MESSAGES_TABLE}`;
  const payload = { records: [{ fields: { SessionID: [sessionId], SenderID: "admin-dashboard", SenderName: "TMT Admin", Content: content, Timestamp: (/* @__PURE__ */ new Date()).toISOString() } }] };
  try {
    const response = await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${AIRTABLE_PAT}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) {
      console.error("Airtable response error:", await response.json());
      throw new Error("Failed to post message to Airtable.");
    }
  } catch (error) {
    console.error("Error posting chat message:", error);
  }
}
function analyzeMessageContent(content) {
  if (!content) return "";
  const questionKeywords = ["?", "how", "what", "when", "where", "why", "can we", "is it", "tmt"];
  const followupKeywords = ["follow up", "circle back", "next steps", "send me", "proposal"];
  const lowerCaseContent = content.toLowerCase();
  if (questionKeywords.some((keyword) => lowerCaseContent.includes(keyword))) return "highlight-question";
  if (followupKeywords.some((keyword) => lowerCaseContent.includes(keyword))) return "highlight-followup";
  return "";
}
function renderActivityItem(message, sessionName, prepend = false) {
  const item = document.createElement("div");
  const highlightClass = analyzeMessageContent(message.fields.Content);
  item.className = `feed-item ${highlightClass}`;
  item.dataset.sessionId = message.fields.SessionID[0];
  const time = new Date(message.fields.Timestamp).toLocaleString();
  item.innerHTML = `<p>"${message.fields.Content}"</p><div class="meta"><strong>${message.fields.SenderName}</strong> in <a href="#" class="session-link">${sessionName || message.fields.SessionID[0]}</a><small> - ${time}</small></div>`;
  if (prepend) activityFeed.prepend(item);
  else activityFeed.appendChild(item);
}
function renderSessionLists() {
  sessionListContainer.innerHTML = "";
  archiveListContainer.innerHTML = "";
  allSessions.forEach((session) => {
    const sessionMessages = allMessages.filter((m) => m.fields.SessionID && m.fields.SessionID[0] === session.id);
    const lastMessage = sessionMessages[0];
    session.lastActivity = lastMessage ? lastMessage.fields.Timestamp : session.createdTime;
    session.messageCount = sessionMessages.length;
    let totalValue = 0;
    if (session.fields["Items with Variations"]) {
      try {
        const data = JSON.parse(session.fields["Items with Variations"]);
        const lockedItems = new Map(Object.entries(data.lockedInItems || {}));
        lockedItems.forEach((itemInfo, itemId) => {
          var _a;
          const catalogItem = catalogMap.get(itemId);
          totalValue += (((_a = catalogItem == null ? void 0 : catalogItem.fields) == null ? void 0 : _a.Price) || 0) * (itemInfo.quantity || 1);
        });
      } catch (e) {
      }
    }
    session.totalValue = totalValue;
    session.stage = (session.fields["Amount Received"] || 0) > 0 ? "Reserved" : "Planning";
  });
  const activeSessions = allSessions.filter((s) => !archivedSessionIds.has(s.id));
  const archivedSessions = allSessions.filter((s) => archivedSessionIds.has(s.id));
  activeSessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  archivedSessions.sort((a, b) => {
    const aIsUnread = unreadArchivedSessions.has(a.id);
    const bIsUnread = unreadArchivedSessions.has(b.id);
    if (aIsUnread !== bIsUnread) return aIsUnread ? -1 : 1;
    return new Date(b.lastActivity) - new Date(a.lastActivity);
  });
  const renderList = (sessions, container) => {
    sessions.forEach((session) => {
      const item = document.createElement("div");
      item.className = "session-list-item";
      item.dataset.sessionId = session.id;
      if (session.id === currentlySelectedSessionId) item.classList.add("selected");
      if (unreadArchivedSessions.has(session.id)) item.classList.add("unread");
      item.innerHTML = `<strong>${session.fields.Name || "Unnamed Session"}</strong><div class="session-stats"><span>Value: $${session.totalValue.toFixed(2)}</span><span>Stage: ${session.stage}</span><span>${session.messageCount} messages</span></div><small>Last active: ${new Date(session.lastActivity).toLocaleString()}</small>`;
      container.appendChild(item);
    });
  };
  renderList(activeSessions, sessionListContainer);
  renderList(archivedSessions, archiveListContainer);
}
function renderEventPlan(sessionId) {
  const session = allSessions.find((s) => s.id === sessionId);
  if (!session) return;
  let planHtml = `<div class="pane-header"><h2>Event Plan</h2> <a href="/?session=${sessionId}" target="_blank" class="open-new-tab">Open in New Tab ↗</a></div>`;
  try {
    const data = JSON.parse(session.fields["Items with Variations"] || "{}");
    const sessionDetails = new Map(Object.entries(data.favoritedDetails || {}));
    const lockedItems = new Map(Object.entries(data.lockedInItems || {}));
    const favoritedItems = new Map(Object.entries(data.favoritedItems || {}));
    const eventDate = sessionDetails.get("date");
    planHtml += `<div class="plan-details-grid"><div><strong>Event Name</strong> ${session.fields.Name || "N/A"}</div><div><strong>Date</strong> ${eventDate ? new Date(eventDate).toLocaleDateString() : "Not set"}</div><div style="grid-column: 1 / -1;"><strong>Goals/Notes</strong> ${session.fields.Goals || "N/A"}</div></div>`;
    planHtml += "<h3>Locked-In Items</h3>";
    let totalValue = 0;
    if (lockedItems.size > 0) {
      lockedItems.forEach((info, id) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const item = catalogMap.get(id);
        totalValue += (((_a = item == null ? void 0 : item.fields) == null ? void 0 : _a.Price) || 0) * (info.quantity || 1);
        const imageUrl = ((_f = (_e = (_d = (_c = (_b = item == null ? void 0 : item.fields) == null ? void 0 : _b.Attachments) == null ? void 0 : _c[0]) == null ? void 0 : _d.thumbnails) == null ? void 0 : _e.small) == null ? void 0 : _f.url) || "https://via.placeholder.com/50";
        const optimizedImageUrl = imageUrl.includes("via.placeholder.com") ? "https://via.placeholder.com/50?text=No+Image" : imageUrl;
        planHtml += `<div class="plan-item"><img src="${optimizedImageUrl}" alt="${((_g = item == null ? void 0 : item.fields) == null ? void 0 : _g.Name) || "Item"}" width="50" height="50" loading="lazy"><div class="plan-item-info"><strong>${((_h = item == null ? void 0 : item.fields) == null ? void 0 : _h.Name) || "Unknown Item"}</strong><br><small>Qty: ${info.quantity || 1} - Note: ${info.note || "none"}</small></div></div>`;
      });
    } else {
      planHtml += "<p>No items locked in.</p>";
    }
    planHtml += "<h3>Favorited Ideas</h3>";
    if (favoritedItems.size > 0) {
      favoritedItems.forEach((info, id) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const item = catalogMap.get(id);
        const imageUrl = ((_e = (_d = (_c = (_b = (_a = item == null ? void 0 : item.fields) == null ? void 0 : _a.Attachments) == null ? void 0 : _b[0]) == null ? void 0 : _c.thumbnails) == null ? void 0 : _d.small) == null ? void 0 : _e.url) || "https://via.placeholder.com/50";
        const optimizedImageUrl = imageUrl.includes("via.placeholder.com") ? "https://via.placeholder.com/50?text=No+Image" : imageUrl;
        planHtml += `<div class="plan-item"><img src="${optimizedImageUrl}" alt="${((_f = item == null ? void 0 : item.fields) == null ? void 0 : _f.Name) || "Item"}" width="50" height="50" loading="lazy"><div><strong>${((_g = item == null ? void 0 : item.fields) == null ? void 0 : _g.Name) || "Unknown Item"}</strong></div></div>`;
      });
    } else {
      planHtml += "<p>No favorited items.</p>";
    }
    planHtml += `<div class="plan-total">Total Plan Value: $${totalValue.toFixed(2)}</div>`;
  } catch (e) {
    console.error("Error rendering plan:", e);
    planHtml += "<p>Could not load event plan details.</p>";
  }
  planView.innerHTML = planHtml;
}
function renderChatPane(sessionId) {
  const session = allSessions.find((s) => s.id === sessionId);
  if (!session || !session.fields) {
    chatPane.style.display = "none";
    chatPlaceholder.style.display = "block";
    chatPlaceholder.textContent = "Could not find data for this session.";
    return;
  }
  chatMessagesContainer.innerHTML = "";
  const messagesForSession = allMessages.filter((m) => m.fields.SessionID && m.fields.SessionID[0] === sessionId).sort((a, b) => new Date(a.fields.Timestamp) - new Date(b.fields.Timestamp));
  messagesForSession.forEach((msg) => {
    const messageEl = document.createElement("div");
    const sender = msg.fields.SenderName;
    const isAdmin = sender === "TMT Admin";
    messageEl.className = `chat-message ${isAdmin ? "admin" : "user"}`;
    messageEl.innerHTML = `<strong>${sender}:</strong> ${msg.fields.Content}`;
    chatMessagesContainer.appendChild(messageEl);
  });
  document.getElementById("chat-header-title").textContent = `Chat: ${session.fields.Name || "Session"}`;
  document.getElementById("chat-open-link").href = `/?session=${sessionId}`;
  chatPane.style.display = "flex";
  chatPlaceholder.style.display = "none";
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}
function renderOmniSearchResults(results) {
  console.log("[DEBUG] renderOmniSearchResults called with:", results);
  omniSearchResults.innerHTML = "";
  let html = "";
  const { item, session, user, itemMessages, sessionMessages } = results;
  if (!item && !session && !user) {
    console.log("[DEBUG] No matches found in local data");
    omniSearchResults.innerHTML = `<p style="color: #7f8c8d; text-align: center;">No matches found in local data. Attempting to parse as new item...</p>`;
    return false;
  }
  if (item) {
    console.log("[DEBUG] Found catalog item:", item.fields.Name);
    html += `<h5>✅ Found Catalog Item: ${item.fields.Name}</h5>`;
    html += `<pre>ID: ${item.id}</pre>`;
    html += `<div style="background: #f9f9f9; padding: 10px; border-radius: 4px; margin: 10px 0;">`;
    html += `<p style="margin: 5px 0;"><strong>Description:</strong> ${item.fields.Description || "N/A"}</p>`;
    html += `<p style="margin: 5px 0;"><strong>Price:</strong> $${item.fields.Price || 0}</p>`;
    html += `<p style="margin: 5px 0;"><strong>Service Type:</strong> ${item.fields["Item Type"] || "N/A"}</p>`;
    html += `</div>`;
    html += `<button
            id="global-parse-btn"
            data-item-id="${item.id}"
            data-item-name="${item.fields.Name}"
            style="
                width: 100%;
                padding: 12px;
                background-color: #3498db;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                margin-top: 10px;
            ">
            \u{1F310} Global Parse - Compare with Internet Data
        </button>`;
    html += `<p style="font-size: 0.8em; color: #666; margin-top: 10px;"><i>Click "Global Parse" to fetch current information from the internet and compare with this item's data.</i></p>`;
  }
  if (session) {
    console.log("[DEBUG] Found session:", session.fields.Name);
    html += `<h5>✅ Found Session: ${session.fields.Name}</h5>`;
    html += `<pre>ID: ${session.id} (Click session in list to load)</pre>`;
    if (sessionMessages && sessionMessages.length > 0) {
      html += `<p style="font-size: 0.9em;"><strong>Found ${sessionMessages.length} Session Messages:</strong></p><ul>`;
      html += sessionMessages.map((msg) => `<li><strong>${msg.fields.SenderName}:</strong> "${msg.fields.Content}"</li>`).slice(0, 5).join("");
      if (sessionMessages.length > 5) html += `<li>...and ${sessionMessages.length - 5} more.</li>`;
      html += `</ul>`;
    }
  }
  if (user) {
    console.log("[DEBUG] Found user:", user.fields.Name);
    html += `<h5>✅ Found User: ${user.fields.Name} (${user.fields.Email})</h5>`;
    html += `<pre>ID: ${user.id}</pre>`;
    const userSessions = allSessions.filter((s) => (s.fields.Collaborators || []).includes(user.id));
    if (userSessions.length > 0) {
      html += `<p style="font-size: 0.9em;"><strong>Found ${userSessions.length} Linked Sessions:</strong></p><ul>`;
      html += userSessions.map((s) => `<li>${s.fields.Name || "Unnamed Session"} (ID: ${s.id})</li>`).join("");
      html += `</ul>`;
    }
  }
  omniSearchResults.innerHTML = html;
  console.log("[DEBUG] Rendered search results");
  const globalParseBtn = document.getElementById("global-parse-btn");
  if (globalParseBtn) {
    globalParseBtn.addEventListener("click", async () => {
      const itemId = globalParseBtn.dataset.itemId;
      const itemName = globalParseBtn.dataset.itemName;
      console.log("[DEBUG] Global Parse clicked for item:", itemId, itemName);
      globalParseBtn.disabled = true;
      globalParseBtn.textContent = "Fetching data from internet...";
      try {
        const fullItem = allCatalogItems.find((i) => i.id === itemId);
        if (!fullItem) {
          throw new Error("Item not found in local data");
        }
        let searchTerms = [];
        if (fullItem.fields.AI_Profile) {
          try {
            const profile = JSON.parse(fullItem.fields.AI_Profile);
            searchTerms = profile.SearchTerms || [];
          } catch (e) {
            console.warn("[DEBUG] Could not parse AI_Profile");
          }
        }
        const existingItemData = {
          Name: fullItem.fields.Name,
          Description: fullItem.fields.Description,
          Price: fullItem.fields.Price,
          ServiceType: fullItem.fields["Item Type"],
          SearchTerms: searchTerms
        };
        const parseResponse = await fetch("/api/process-weblink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: itemName,
            existingItem: existingItemData
          })
        });
        if (!parseResponse.ok) {
          const errorText = await parseResponse.text();
          throw new Error(`Parser failed: ${errorText}`);
        }
        const parsedData = await parseResponse.json();
        console.log("[DEBUG] Parsed data from internet:", parsedData);
        openComparisonModalForExisting(fullItem, parsedData);
        globalParseBtn.textContent = "✅ Data Fetched - See Comparison";
      } catch (error) {
        console.error("[DEBUG] Global Parse error:", error);
        globalParseBtn.textContent = "❌ Error - Try Again";
        globalParseBtn.disabled = false;
        alert(`Error fetching data: ${error.message}`);
      }
    });
  }
  return true;
}
function getAllCategories() {
  const categories = /* @__PURE__ */ new Set();
  allCatalogItems.forEach((item) => {
    if (item.fields.Categories) {
      item.fields.Categories.split(",").forEach((cat) => {
        const trimmed = cat.trim();
        if (trimmed) categories.add(trimmed);
      });
    }
  });
  return Array.from(categories).sort();
}
function getParentItemOptions() {
  return allCatalogItems.filter((item) => item.fields.Name).map((item) => ({
    id: item.id,
    name: item.fields.Name,
    isGrouping: item.fields["Item Type"] === "Grouping"
  })).sort((a, b) => {
    if (a.isGrouping && !b.isGrouping) return -1;
    if (!a.isGrouping && b.isGrouping) return 1;
    return a.name.localeCompare(b.name);
  });
}
function createCategoryMultiSelect(selectedCategories = "") {
  const allCategories = getAllCategories();
  const selectedSet = new Set(
    selectedCategories.split(",").map((c) => c.trim()).filter((c) => c)
  );
  let html = '<div class="category-multi-select" id="category-multi-select">';
  allCategories.forEach((category) => {
    const isSelected = selectedSet.has(category);
    html += `
            <label class="category-checkbox-label ${isSelected ? "selected" : ""}">
                <input type="checkbox" value="${category}" ${isSelected ? "checked" : ""} onchange="toggleCategorySelection(this)">
                ${category}
            </label>
        `;
  });
  html += "</div>";
  return html;
}
function createParentItemDropdown(selectedParent = "") {
  const parentOptions = getParentItemOptions();
  let html = '<select class="parent-item-select" id="edit-ParentItem">';
  html += '<option value="">-- No Parent Item --</option>';
  let currentGroup = null;
  parentOptions.forEach((option) => {
    if (option.isGrouping && currentGroup !== "grouping") {
      if (currentGroup !== null) html += "</optgroup>";
      html += '<optgroup label="\u{1F4C1} Groupings">';
      currentGroup = "grouping";
    } else if (!option.isGrouping && currentGroup !== "regular") {
      if (currentGroup !== null) html += "</optgroup>";
      html += '<optgroup label="\u{1F4E6} Items">';
      currentGroup = "regular";
    }
    const isSelected = selectedParent === option.name;
    html += `<option value="${option.name}" ${isSelected ? "selected" : ""}>${option.name}</option>`;
  });
  if (currentGroup !== null) html += "</optgroup>";
  html += "</select>";
  return html;
}
function toggleCategorySelection(checkbox) {
  const label = checkbox.parentElement;
  if (checkbox.checked) {
    label.classList.add("selected");
  } else {
    label.classList.remove("selected");
  }
}
function getSelectedCategories() {
  const checkboxes = document.querySelectorAll('#category-multi-select input[type="checkbox"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value).join(", ");
}
window.toggleCategorySelection = toggleCategorySelection;
function openComparisonModal(itemData) {
  console.log("[DEBUG] Opening comparison modal with data:", itemData);
  pendingNewItemData = itemData;
  const tableBody = document.getElementById("comparison-table-body");
  tableBody.innerHTML = "";
  const fields = ["Name", "Description", "Price", "ServiceType", "Categories", "ParentItem", "SearchTerms", "Rankings", "Profile"];
  fields.forEach((field) => {
    const row = document.createElement("tr");
    const value = itemData[field];
    let displayValue;
    if (field === "Rankings" && value && typeof value === "object") {
      displayValue = JSON.stringify(value, null, 2);
    } else if (field === "Profile" && value && typeof value === "object") {
      displayValue = JSON.stringify(value, null, 2);
    } else {
      displayValue = Array.isArray(value) ? value.join(", ") : value;
    }
    let fieldHtml;
    if (field === "Categories") {
      fieldHtml = createCategoryMultiSelect(displayValue || "");
    } else if (field === "ParentItem") {
      fieldHtml = createParentItemDropdown(displayValue || "");
    } else if (field === "Description") {
      fieldHtml = `<textarea id="edit-${field}" style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">${displayValue || ""}</textarea>`;
    } else if (field === "SearchTerms") {
      fieldHtml = `<textarea id="edit-${field}" style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="Comma-separated terms">${displayValue || ""}</textarea>`;
    } else if (field === "Rankings") {
      fieldHtml = `<textarea id="edit-${field}" style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.9em;" placeholder='{"google": 4.5, "yelp": 4.0, ...}'>${displayValue || ""}</textarea>`;
    } else if (field === "Profile") {
      fieldHtml = `<textarea id="edit-${field}" style="width: 100%; min-height: 120px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.9em;" placeholder='{"activityLevel": 5, "indoorOutdoor": 5, ...}'>${displayValue || ""}</textarea>`;
    } else {
      fieldHtml = `<input type="text" id="edit-${field}" value="${displayValue || ""}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">`;
    }
    const fieldLabel = field === "ParentItem" ? "Parent Item" : field;
    row.innerHTML = `
            <td><strong>${fieldLabel}</strong></td>
            <td>${fieldHtml}</td>
        `;
    tableBody.appendChild(row);
  });
  document.getElementById("comparison-modal").classList.add("active");
  console.log("[DEBUG] Comparison modal opened");
}
function openComparisonModalForExisting(existingItem, parsedData) {
  console.log("[DEBUG] Opening comparison modal for existing item with parsed data");
  pendingNewItemData = {
    mode: "update",
    existingItem,
    parsedData
  };
  const modalHeader = document.querySelector(".comparison-header h2");
  modalHeader.textContent = "Compare Current vs Parsed Data";
  const modeIndicator = document.getElementById("comparison-mode-indicator");
  const modeText = document.getElementById("comparison-mode-text");
  modeIndicator.style.display = "block";
  modeText.textContent = `Updating Existing Item: ${existingItem.fields.Name}`;
  const tableHeader = document.getElementById("comparison-table-header");
  tableHeader.innerHTML = `
        <tr>
            <th>Field</th>
            <th>Current Value</th>
            <th>Parsed Value (from Internet)</th>
        </tr>
    `;
  const tableBody = document.getElementById("comparison-table-body");
  tableBody.innerHTML = "";
  let existingSearchTerms = [];
  if (existingItem.fields.AI_Profile) {
    try {
      const profile = JSON.parse(existingItem.fields.AI_Profile);
      existingSearchTerms = profile.SearchTerms || [];
    } catch (e) {
      console.warn("[DEBUG] Could not parse AI_Profile");
    }
  }
  let existingRankings = null;
  if (existingItem.fields.Rankings) {
    try {
      existingRankings = typeof existingItem.fields.Rankings === "string" ? JSON.parse(existingItem.fields.Rankings) : existingItem.fields.Rankings;
    } catch (e) {
      console.warn("[DEBUG] Could not parse Rankings");
    }
  }
  let existingProfile = null;
  if (existingItem.fields.AI_Profile) {
    try {
      const aiProfile = typeof existingItem.fields.AI_Profile === "string" ? JSON.parse(existingItem.fields.AI_Profile) : existingItem.fields.AI_Profile;
      if (aiProfile && aiProfile.Profile) {
        existingProfile = aiProfile.Profile;
      }
    } catch (e) {
      console.warn("[DEBUG] Could not parse AI_Profile for Profile extraction");
    }
  }
  const fields = [
    { key: "Name", label: "Name", existingKey: "Name" },
    { key: "Description", label: "Description", existingKey: "Description" },
    { key: "Price", label: "Price", existingKey: "Price" },
    { key: "ServiceType", label: "Service Type", existingKey: "Item Type" },
    { key: "Categories", label: "Categories", existingKey: "Categories" },
    { key: "ParentItem", label: "Parent Item", existingKey: "Parent Item" },
    { key: "SearchTerms", label: "Search Terms", existingKey: null, customExisting: existingSearchTerms },
    { key: "Rankings", label: "Rankings", existingKey: null, customExisting: existingRankings },
    { key: "Profile", label: "Profile", existingKey: null, customExisting: existingProfile }
  ];
  fields.forEach((field) => {
    const row = document.createElement("tr");
    let existingValue = field.customExisting !== void 0 ? field.customExisting : existingItem.fields[field.existingKey];
    const parsedValue = parsedData[field.key];
    let existingDisplay, parsedDisplay;
    if (field.key === "Rankings" || field.key === "Profile") {
      existingDisplay = existingValue ? typeof existingValue === "object" ? JSON.stringify(existingValue, null, 2) : existingValue : "N/A";
      parsedDisplay = parsedValue ? typeof parsedValue === "object" ? JSON.stringify(parsedValue, null, 2) : parsedValue : "N/A";
    } else if (field.key === "Price") {
      existingDisplay = existingValue !== null && existingValue !== void 0 ? existingValue : "N/A";
      parsedDisplay = parsedValue !== null && parsedValue !== void 0 ? parsedValue : "N/A";
      console.log("[DEBUG] Price field display values:", { existingDisplay, parsedDisplay, existingValue, parsedValue });
    } else {
      existingDisplay = Array.isArray(existingValue) ? existingValue.join(", ") : existingValue || "N/A";
      parsedDisplay = Array.isArray(parsedValue) ? parsedValue.join(", ") : parsedValue || "N/A";
    }
    const isDifferent = JSON.stringify(existingValue) !== JSON.stringify(parsedValue);
    let editFieldHtml;
    if (field.key === "Categories") {
      editFieldHtml = createCategoryMultiSelect(parsedDisplay !== "N/A" ? parsedDisplay : existingDisplay !== "N/A" ? existingDisplay : "");
    } else if (field.key === "ParentItem") {
      editFieldHtml = createParentItemDropdown(parsedDisplay !== "N/A" ? parsedDisplay : existingDisplay !== "N/A" ? existingDisplay : "");
    } else if (field.key === "Description") {
      editFieldHtml = `<textarea id="edit-${field.key}" style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">${parsedDisplay}</textarea>`;
    } else if (field.key === "SearchTerms") {
      editFieldHtml = `<textarea id="edit-${field.key}" style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="Comma-separated terms">${parsedDisplay}</textarea>`;
    } else if (field.key === "Rankings") {
      editFieldHtml = `<textarea id="edit-${field.key}" style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em;" placeholder='{"google": 4.5, ...}'>${parsedDisplay}</textarea>`;
    } else if (field.key === "Profile") {
      editFieldHtml = `<textarea id="edit-${field.key}" style="width: 100%; min-height: 140px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em;" placeholder='{"activityLevel": 5, ...}'>${parsedDisplay}</textarea>`;
    } else {
      editFieldHtml = `<input type="text" id="edit-${field.key}" value="${parsedDisplay}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">`;
    }
    row.innerHTML = `
            <td><strong>${field.label}</strong></td>
            <td class="${isDifferent ? "existing-value" : "value-unchanged"}">
                ${field.key === "Description" ? `<div style="max-height: 100px; overflow-y: auto;">${existingDisplay}</div>` : field.key === "Rankings" || field.key === "Profile" ? `<pre style="margin: 0; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 0.85em; max-height: 120px; overflow-y: auto;">${existingDisplay}</pre>` : existingDisplay}
            </td>
            <td class="${isDifferent ? "parsed-value" : "value-unchanged"}">
                ${editFieldHtml}
            </td>
        `;
    tableBody.appendChild(row);
  });
  const actionsDiv = document.querySelector(".comparison-actions");
  actionsDiv.innerHTML = `
        <button class="btn-cancel" onclick="closeComparisonModal()">Cancel</button>
        <button class="btn-confirm" onclick="adoptParsedData()">Adopt Parsed Data</button>
    `;
  document.getElementById("comparison-modal").classList.add("active");
  console.log("[DEBUG] Comparison modal opened for existing item");
}
function closeComparisonModal() {
  console.log("[DEBUG] Closing comparison modal");
  document.getElementById("comparison-modal").classList.remove("active");
  document.getElementById("comparison-status").textContent = "";
  const modalHeader = document.querySelector(".comparison-header h2");
  modalHeader.textContent = "Review New Item";
  const modeIndicator = document.getElementById("comparison-mode-indicator");
  modeIndicator.style.display = "none";
  const tableHeader = document.getElementById("comparison-table-header");
  tableHeader.innerHTML = `
        <tr>
            <th>Field</th>
            <th>AI-Suggested Value</th>
        </tr>
    `;
  const actionsDiv = document.querySelector(".comparison-actions");
  actionsDiv.innerHTML = `
        <button class="btn-cancel" onclick="closeComparisonModal()">Cancel</button>
        <button class="btn-confirm" onclick="confirmNewItem()">Confirm & Add to Catalog</button>
    `;
  pendingNewItemData = null;
}
async function adoptParsedData() {
  console.log("[DEBUG] adoptParsedData called");
  if (!pendingNewItemData || pendingNewItemData.mode !== "update") {
    console.error("[DEBUG] Invalid state for adoptParsedData");
    return;
  }
  const statusDiv = document.getElementById("comparison-status");
  statusDiv.textContent = "Updating item in Airtable...";
  statusDiv.style.color = "#3498db";
  const { existingItem } = pendingNewItemData;
  const priceInputRaw = document.getElementById("edit-Price").value;
  const priceInputTrimmed = priceInputRaw.trim();
  const priceInputCleaned = priceInputTrimmed === "N/A" ? "0" : priceInputTrimmed.replace(/[$,]/g, "");
  const priceParsed = parseFloat(priceInputCleaned);
  console.log("[DEBUG] Price field processing:", {
    raw: priceInputRaw,
    trimmed: priceInputTrimmed,
    cleaned: priceInputCleaned,
    parsed: priceParsed,
    isNaN: isNaN(priceParsed),
    finalValue: isNaN(priceParsed) ? 0 : priceParsed
  });
  const updates = {
    Name: document.getElementById("edit-Name").value.trim(),
    Description: document.getElementById("edit-Description").value.trim(),
    Price: isNaN(priceParsed) ? 0 : priceParsed,
    ServiceType: document.getElementById("edit-ServiceType").value.trim(),
    Categories: getSelectedCategories(),
    ParentItem: document.getElementById("edit-ParentItem").value.trim(),
    SearchTerms: document.getElementById("edit-SearchTerms").value.split(",").map((t) => t.trim()).filter((t) => t)
  };
  const rankingsTextarea = document.getElementById("edit-Rankings");
  if (rankingsTextarea) {
    const rankingsValue = rankingsTextarea.value.trim();
    if (rankingsValue && rankingsValue !== "N/A") {
      try {
        updates.Rankings = JSON.parse(rankingsValue);
      } catch (e) {
        console.warn("[DEBUG] Could not parse Rankings JSON, storing as string:", e);
        updates.Rankings = rankingsValue;
      }
    }
  }
  const profileTextarea = document.getElementById("edit-Profile");
  if (profileTextarea) {
    const profileValue = profileTextarea.value.trim();
    if (profileValue && profileValue !== "N/A") {
      try {
        updates.Profile = JSON.parse(profileValue);
      } catch (e) {
        console.warn("[DEBUG] Could not parse Profile JSON, storing as string:", e);
        updates.Profile = profileValue;
      }
    }
  }
  console.log("[DEBUG] Updates to apply:", updates);
  const adoptBtn = document.querySelector(".btn-confirm");
  if (adoptBtn) {
    adoptBtn.disabled = true;
  }
  try {
    const response = await fetch("/api/update-catalog-item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId: existingItem.id,
        updates
      })
    });
    console.log("[DEBUG] Update item response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DEBUG] Update item error:", errorText);
      throw new Error(`Failed to update item: ${errorText}`);
    }
    const result = await response.json();
    console.log("[DEBUG] Update item result:", result);
    statusDiv.textContent = `✅ Item updated successfully!`;
    statusDiv.style.color = "#28a745";
    setTimeout(() => {
      closeComparisonModal();
      fetchAirtableData(CATALOG_TABLE).then((data) => {
        allCatalogItems = data;
        catalogMap = new Map(allCatalogItems.map((item) => [item.id, item]));
        console.log("[DEBUG] Catalog refreshed");
      });
    }, 2e3);
  } catch (error) {
    console.error("[DEBUG] Error updating item:", error);
    statusDiv.textContent = `❌ Error: ${error.message}`;
    statusDiv.style.color = "#dc3545";
    if (adoptBtn) {
      adoptBtn.disabled = false;
    }
  }
}
async function confirmNewItem(event) {
  console.log("[DEBUG] confirmNewItem called");
  const statusDiv = document.getElementById("comparison-status");
  statusDiv.textContent = "Creating item in Airtable...";
  statusDiv.style.color = "#3498db";
  const priceInputRaw = document.getElementById("edit-Price").value;
  const priceInputCleaned = priceInputRaw.trim() === "N/A" ? "0" : priceInputRaw.trim().replace(/[$,]/g, "");
  const priceParsed = parseFloat(priceInputCleaned);
  console.log("[DEBUG] Price field processing (confirmNewItem):", {
    raw: priceInputRaw,
    cleaned: priceInputCleaned,
    parsed: priceParsed,
    finalValue: isNaN(priceParsed) ? 0 : priceParsed
  });
  const editedData = {
    Name: document.getElementById("edit-Name").value.trim(),
    Description: document.getElementById("edit-Description").value.trim(),
    Price: isNaN(priceParsed) ? 0 : priceParsed,
    ServiceType: document.getElementById("edit-ServiceType").value.trim(),
    Categories: getSelectedCategories(),
    ParentItem: document.getElementById("edit-ParentItem").value.trim(),
    SearchTerms: document.getElementById("edit-SearchTerms").value.split(",").map((t) => t.trim()).filter((t) => t)
  };
  const rankingsTextarea = document.getElementById("edit-Rankings");
  if (rankingsTextarea) {
    const rankingsValue = rankingsTextarea.value.trim();
    if (rankingsValue) {
      try {
        editedData.Rankings = JSON.parse(rankingsValue);
      } catch (e) {
        console.warn("[DEBUG] Could not parse Rankings JSON, storing as string:", e);
        editedData.Rankings = rankingsValue;
      }
    }
  }
  const profileTextarea = document.getElementById("edit-Profile");
  if (profileTextarea) {
    const profileValue = profileTextarea.value.trim();
    if (profileValue) {
      try {
        editedData.Profile = JSON.parse(profileValue);
      } catch (e) {
        console.warn("[DEBUG] Could not parse Profile JSON, storing as string:", e);
        editedData.Profile = profileValue;
      }
    }
  }
  console.log("[DEBUG] Edited data:", editedData);
  if (event && event.target) {
    event.target.disabled = true;
  }
  try {
    const response = await fetch("/api/create-catalog-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editedData)
    });
    console.log("[DEBUG] Create item response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DEBUG] Create item error:", errorText);
      throw new Error(`Failed to create item: ${errorText}`);
    }
    const result = await response.json();
    console.log("[DEBUG] Create item result:", result);
    statusDiv.textContent = `✅ Item created successfully! Record ID: ${result.recordId}`;
    statusDiv.style.color = "#28a745";
    if (result.recordId) {
      console.log("[DEBUG] Triggering auto-profile for:", result.recordId);
      statusDiv.textContent += " | Generating AI profile...";
      try {
        const profileResponse = await fetch("/api/profile-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: result.recordId })
        });
        console.log("[DEBUG] Profile response status:", profileResponse.status);
        if (profileResponse.ok) {
          statusDiv.textContent += " ✅ Profile generated!";
          console.log("[DEBUG] Profile generated successfully");
        } else {
          statusDiv.textContent += " ⚠️ Profile generation failed (item still created)";
          console.error("[DEBUG] Profile generation failed");
        }
      } catch (profileError) {
        console.error("[DEBUG] Profile error:", profileError);
        statusDiv.textContent += " ⚠️ Profile generation error";
      }
    }
    setTimeout(() => {
      closeComparisonModal();
      fetchAirtableData(CATALOG_TABLE).then((data) => {
        allCatalogItems = data;
        catalogMap = new Map(allCatalogItems.map((item) => [item.id, item]));
        console.log("[DEBUG] Catalog refreshed");
      });
    }, 3e3);
  } catch (error) {
    console.error("[DEBUG] Error creating item:", error);
    statusDiv.textContent = `❌ Error: ${error.message}`;
    statusDiv.style.color = "#dc3545";
    if (event && event.target) {
      event.target.disabled = false;
    }
  }
}
window.closeComparisonModal = closeComparisonModal;
window.confirmNewItem = confirmNewItem;
window.adoptParsedData = adoptParsedData;
async function handleOmniSearch(query) {
  const lowerQuery = query.toLowerCase();
  let results = {
    item: null,
    session: null,
    user: null,
    sessionMessages: []
  };
  results.item = allCatalogItems.find((item) => (item.fields.Name || "").toLowerCase().includes(lowerQuery));
  results.session = allSessions.find((session) => (session.fields.Name || "").toLowerCase().includes(lowerQuery));
  results.user = allTeammates.find((user) => (user.fields.Email || "").toLowerCase() === lowerQuery || (user.fields.Name || "").toLowerCase().includes(lowerQuery));
  if (results.session) {
    results.sessionMessages = allMessages.filter((m) => m.fields.SessionID && m.fields.SessionID[0] === results.session.id).sort((a, b) => new Date(b.fields.Timestamp) - new Date(a.fields.Timestamp));
  }
  const resultsFound = renderOmniSearchResults(results);
  if (!results.item) {
    console.log("[DEBUG] No item found, calling weblink parser for:", query);
    omniSearchResults.innerHTML += `<p style="color: #3498db; text-align: center;">No item match found. Calling external parser for "${query}"...</p>`;
    try {
      const parseResponse = await fetch("/api/process-weblink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      console.log("[DEBUG] Parser response status:", parseResponse.status);
      if (!parseResponse.ok) {
        const errorText = await parseResponse.text();
        console.error("[DEBUG] Parser error response:", errorText);
        throw new Error(`Weblink Parser API failed: ${errorText}`);
      }
      const newItemData = await parseResponse.json();
      console.log("[DEBUG] Parsed new item data:", newItemData);
      openComparisonModal(newItemData);
      omniSearchResults.innerHTML += `
                <h5>✅ Item Parsed Successfully</h5>
                <p style="font-size: 0.9em; color: #28a745;">Review the parsed data in the modal to confirm or edit before adding to catalog.</p>
            `;
    } catch (error) {
      console.error("[DEBUG] Weblink Parser Error:", error);
      omniSearchResults.innerHTML += `<p style="color: #dc3545; text-align: center;"><strong>Parser Error:</strong> ${error.message}</p>`;
    }
  }
}
function handleSessionSelect(sessionId) {
  if (!sessionMap.has(sessionId)) {
    console.warn(`Attempted to select a non-existent session: ${sessionId}`);
    planView.style.display = "none";
    planViewPlaceholder.style.display = "block";
    planViewPlaceholder.textContent = "This session may have been deleted.";
    chatPane.style.display = "none";
    chatPlaceholder.style.display = "block";
    chatPlaceholder.textContent = "";
    return;
  }
  currentlySelectedSessionId = sessionId;
  if (unreadArchivedSessions.has(sessionId)) {
    unreadArchivedSessions.delete(sessionId);
  }
  planView.style.display = "block";
  planViewPlaceholder.style.display = "none";
  renderSessionLists();
  renderEventPlan(sessionId);
  renderChatPane(sessionId);
}
function setupDragAndDrop() {
  const lists = [sessionListContainer, archiveListContainer];
  lists.forEach((list) => {
    new Sortable(list, {
      group: "sessions",
      animation: 150,
      ghostClass: "sortable-ghost",
      onEnd: (evt) => {
        const sessionId = evt.item.dataset.sessionId;
        if (evt.to === archiveListContainer) {
          archivedSessionIds.add(sessionId);
        } else {
          archivedSessionIds.delete(sessionId);
          unreadArchivedSessions.delete(sessionId);
        }
        saveArchivedState();
        renderSessionLists();
      }
    });
  });
}
async function initializeDashboard() {
  loadArchivedState();
  loadModuleState();
  updateModuleVisibility();
  try {
    const [allSessionsData, allMessagesData, allCatalogItemsData, allTeammatesData] = await Promise.all([
      fetchAirtableData(SESSIONS_TABLE),
      fetchAirtableData(MESSAGES_TABLE),
      fetchAirtableData(CATALOG_TABLE),
      fetchAirtableData(TEAMMATES_TABLE)
    ]);
    allSessions = allSessionsData;
    allMessages = allMessagesData;
    allCatalogItems = allCatalogItemsData;
    allTeammates = allTeammatesData;
    loadingIndicator.style.display = "none";
    sessionMap = new Map(allSessions.map((s) => [s.id, s.fields.Name]));
    catalogMap = new Map(allCatalogItems.map((item) => [item.id, item]));
    allMessages.sort((a, b) => new Date(b.fields.Timestamp) - new Date(a.fields.Timestamp));
    activityFeed.innerHTML = "";
    allMessages.forEach((message) => {
      if (message.fields.SessionID && message.fields.SessionID[0]) {
        const sessionName = sessionMap.get(message.fields.SessionID[0]);
        renderActivityItem(message, sessionName);
      }
    });
    renderSessionLists();
    setupPusher();
    setupDragAndDrop();
    setupModuleToggles();
    const teammateListContainer = document.getElementById("teammates-list");
    allTeammates.forEach((tm) => {
      const link = document.createElement("a");
      link.href = `/teammate.html?id=${tm.id}`;
      link.textContent = tm.fields.Name;
      link.className = "session-list-item";
      teammateListContainer.appendChild(link);
    });
  } catch (e) {
    console.error("Catastrophic error during Dashboard Initialization:", e);
    loadingIndicator.textContent = `CRITICAL ERROR: Failed to load data from Airtable (${e.message}). Please check API keys or table configuration.`;
    loadingIndicator.style.color = "#dc3545";
    return;
  }
  document.body.addEventListener("click", (e) => {
    const sessionItem = e.target.closest(".session-list-item, .feed-item");
    if (sessionItem) {
      e.preventDefault();
      if (sessionItem.href && sessionItem.href.includes("teammate.html")) {
        window.location.href = sessionItem.href;
      } else {
        handleSessionSelect(sessionItem.dataset.sessionId);
      }
    }
  });
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = chatInput.value.trim();
    if (content && currentlySelectedSessionId) {
      const tempMessageEl = document.createElement("div");
      tempMessageEl.className = "chat-message admin";
      tempMessageEl.innerHTML = `<strong>You:</strong> ${content}`;
      chatMessagesContainer.appendChild(tempMessageEl);
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      const messageToSend = chatInput.value;
      chatInput.value = "";
      await postChatMessage(currentlySelectedSessionId, messageToSend);
      const channel = pusherChannelMap.get(currentlySelectedSessionId);
      if (channel) {
        channel.trigger("client-new-message", {
          content: messageToSend,
          senderId: "admin-dashboard",
          senderName: "TMT Admin",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
  });
  const testAIForm = document.getElementById("test-ai-form");
  const publicIdInput = document.getElementById("test-public-id");
  const statusMessage = document.getElementById("single-ai-status");
  if (testAIForm) {
    testAIForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const publicId = publicIdInput.value.trim();
      if (!publicId) {
        statusMessage.textContent = "Status: Please enter a Public ID.";
        statusMessage.style.color = "#dc3545";
        return;
      }
      statusMessage.textContent = `Status: Processing ${publicId}... (Check Netlify logs for progress)`;
      statusMessage.style.color = "#3498db";
      document.getElementById("trigger-single-ai").disabled = true;
      try {
        const response = await fetch("/.netlify/functions/process-image-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicId })
        });
        const data = await response.json();
        if (response.ok) {
          statusMessage.textContent = `✅ SUCCESS: ${data.message}`;
          statusMessage.style.color = "#2ecc71";
          publicIdInput.value = "";
        } else {
          statusMessage.textContent = `❌ FAILURE: ${data.error}`;
          statusMessage.style.color = "#dc3545";
        }
      } catch (error) {
        statusMessage.textContent = `❌ CRITICAL ERROR: Could not connect to API.`;
        statusMessage.style.color = "#dc3545";
        console.error("Manual AI Trigger Error:", error);
      } finally {
        document.getElementById("trigger-single-ai").disabled = false;
      }
    });
  }
  if (omniSearchForm) {
    omniSearchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = omniSearchInput.value.trim();
      if (!query) return;
      omniSearchBtn.disabled = true;
      omniSearchResults.innerHTML = `<p style="color: #3498db; text-align: center;">Searching local data for "${query}"...</p>`;
      try {
        await handleOmniSearch(query);
      } catch (error) {
        omniSearchResults.innerHTML = `<p style="color: #dc3545; text-align: center;"><strong>Error:</strong> ${error.message}</p>`;
        console.error("Omni-Search Handler Error:", error);
      } finally {
        omniSearchBtn.disabled = false;
      }
    });
  }
}
function setupPusher() {
  if (sessionMap.size === 0) return;
  try {
    const pusher = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      authEndpoint: "/api/pusher-auth",
      auth: { params: { user_id: `admin-${Date.now()}`, user_name: "Dashboard Admin" } },
      // Add error handling and connection management
      enabledTransports: ["ws", "wss"],
      disabledTransports: [],
      // Prevent too many reconnection attempts
      activityTimeout: 12e4,
      pongTimeout: 3e4,
      unavailableTimeout: 1e4
    });
    pusher.connection.bind("error", (err) => {
      console.error("[DEBUG] Pusher connection error:", err);
    });
    pusher.connection.bind("failed", () => {
      console.error("[DEBUG] Pusher connection failed - check credentials");
    });
    pusher.connection.bind("connected", () => {
      console.log("[DEBUG] Pusher connected successfully");
    });
    sessionMap.forEach((name, id) => {
      const channel = pusher.subscribe(`presence-session-${id}`);
      pusherChannelMap.set(id, channel);
      channel.bind("pusher:subscription_error", (status) => {
        console.error("[DEBUG] Pusher subscription error for session", id, ":", status);
      });
      channel.bind("client-new-message", (data) => {
        if (data.senderId === "admin-dashboard") return;
        const fakeMessageRecord = { fields: { Content: data.content, SenderName: data.senderName, SessionID: [id], Timestamp: data.timestamp } };
        allMessages.unshift(fakeMessageRecord);
        renderActivityItem(fakeMessageRecord, name, true);
        if (archivedSessionIds.has(id)) {
          unreadArchivedSessions.add(id);
        }
        renderSessionLists();
        if (id === currentlySelectedSessionId) renderChatPane(id);
      });
    });
  } catch (error) {
    console.error("[DEBUG] Failed to initialize Pusher:", error);
  }
}
initializeDashboard();
//# sourceMappingURL=crm.bundle.js.map
