// components/invitee.js
console.log("[Invitee DEBUG] ========================================");
console.log("[Invitee DEBUG] invitee.bundle.js LOADED SUCCESSFULLY");
console.log("[Invitee DEBUG] Timestamp:", (/* @__PURE__ */ new Date()).toISOString());
console.log("[Invitee DEBUG] Document readyState:", document.readyState);
console.log("[Invitee DEBUG] Window location:", window.location.href);
console.log("[Invitee DEBUG] ========================================");
var PERSONAL_ACCESS_TOKEN = "patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57";
var BASE_ID = "app5yTznb3R5YNUFw";
var SESSIONS_TABLE_NAME = "Sessions";
var ITEMS_TABLE_ID = "tblUA4uuS8IYlhKpD";
var MESSAGES_TABLE_NAME = "Messages";
var inviteeState = {
  sessionId: null,
  sessionData: null,
  lockedItems: /* @__PURE__ */ new Map(),
  itemRecords: [],
  currentUser: null,
  pusher: null,
  chatChannel: null
};
var FUN_ADJECTIVES = ["Happy", "Clever", "Sunny", "Lucky", "Creative", "Brave", "Sparkling", "Cosmic", "Witty", "Zesty"];
var FUN_NOUNS = ["Panda", "Wombat", "Explorer", "Starship", "Juggler", "Wizard", "Dolphin", "Robot", "Pineapple", "Comet"];
function generateFunName() {
  const adj = FUN_ADJECTIVES[Math.floor(Math.random() * FUN_ADJECTIVES.length)];
  const noun = FUN_NOUNS[Math.floor(Math.random() * FUN_NOUNS.length)];
  return `${adj} ${noun}`;
}
function getSimpleUserIdentity() {
  if (inviteeState.currentUser) return inviteeState.currentUser;
  let userId = localStorage.getItem("chatUserId");
  if (!userId) {
    userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("chatUserId", userId);
  }
  let userName = localStorage.getItem("chatUserName");
  if (!userName) {
    userName = generateFunName();
    localStorage.setItem("chatUserName", userName);
  }
  inviteeState.currentUser = { id: userId, name: userName };
  return inviteeState.currentUser;
}
function showLoading() {
  console.log("[Invitee DEBUG] showLoading() called");
  const loadingEl = document.getElementById("loading-state");
  const errorEl = document.getElementById("error-state");
  const mainEl = document.getElementById("main-content");
  console.log("[Invitee DEBUG] Elements found - loading:", !!loadingEl, "error:", !!errorEl, "main:", !!mainEl);
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  mainEl.classList.remove("loaded");
}
function showError(message) {
  console.log("[Invitee DEBUG] showError() called with message:", message);
  const loadingEl = document.getElementById("loading-state");
  const errorEl = document.getElementById("error-state");
  const errorMsgEl = document.getElementById("error-message");
  const mainEl = document.getElementById("main-content");
  console.log("[Invitee DEBUG] Elements found - loading:", !!loadingEl, "error:", !!errorEl, "errorMsg:", !!errorMsgEl, "main:", !!mainEl);
  loadingEl.style.display = "none";
  errorEl.style.display = "flex";
  errorMsgEl.textContent = message;
  mainEl.classList.remove("loaded");
}
function showContent() {
  console.log("[Invitee DEBUG] showContent() called - transitioning from loading to content");
  const loadingEl = document.getElementById("loading-state");
  const errorEl = document.getElementById("error-state");
  const mainEl = document.getElementById("main-content");
  console.log("[Invitee DEBUG] Elements found - loading:", !!loadingEl, "error:", !!errorEl, "main:", !!mainEl);
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  mainEl.classList.add("loaded");
  console.log("[Invitee DEBUG] Content should now be visible");
}
async function fetchSessionById(sessionId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  console.log("[Invitee DEBUG] fetchSessionById URL:", url);
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
  });
  console.log("[Invitee DEBUG] fetchSessionById response status:", response.status, response.statusText);
  if (!response.ok) {
    console.error("[Invitee DEBUG] fetchSessionById failed:", response.status);
    throw new Error("Failed to load session");
  }
  const data = await response.json();
  console.log("[Invitee DEBUG] fetchSessionById data:", data);
  return data;
}
async function fetchItemsByIds(itemIds) {
  console.log("[Invitee DEBUG] fetchItemsByIds called with:", itemIds);
  if (!itemIds || itemIds.length === 0) {
    console.log("[Invitee DEBUG] fetchItemsByIds: No item IDs provided");
    return [];
  }
  const conditions = itemIds.map((id) => `RECORD_ID() = '${id}'`).join(", ");
  const formula = encodeURIComponent(`OR(${conditions})`);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE_ID}?filterByFormula=${formula}`;
  console.log("[Invitee DEBUG] fetchItemsByIds URL:", url);
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
  });
  console.log("[Invitee DEBUG] fetchItemsByIds response status:", response.status, response.statusText);
  if (!response.ok) {
    console.error("[Invitee DEBUG] fetchItemsByIds failed:", response.status);
    return [];
  }
  const data = await response.json();
  console.log("[Invitee DEBUG] fetchItemsByIds data:", data);
  console.log("[Invitee DEBUG] fetchItemsByIds records count:", (data.records || []).length);
  return data.records || [];
}
async function fetchChatMessages(sessionId) {
  console.log("[Invitee DEBUG] fetchChatMessages called with sessionId:", sessionId);
  const formula = encodeURIComponent(`FIND('${sessionId}', {SessionID_Rollup})`);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MESSAGES_TABLE_NAME}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;
  console.log("[Invitee DEBUG] fetchChatMessages URL:", url);
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    console.log("[Invitee DEBUG] fetchChatMessages response status:", response.status, response.statusText);
    if (!response.ok) {
      console.error("[Invitee DEBUG] fetchChatMessages failed:", response.status);
      return [];
    }
    const data = await response.json();
    console.log("[Invitee DEBUG] fetchChatMessages data:", data);
    console.log("[Invitee DEBUG] fetchChatMessages records count:", (data.records || []).length);
    return data.records || [];
  } catch (error) {
    console.error("[Invitee DEBUG] Error fetching chat messages:", error);
    return [];
  }
}
async function postChatMessage(sessionId, senderId, senderName, content) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MESSAGES_TABLE_NAME}`;
  if (!sessionId || !sessionId.startsWith("rec")) {
    console.error("[Invitee] postChatMessage Error: Invalid sessionId:", sessionId);
    return false;
  }
  if (!content || !content.trim()) {
    console.log("[Invitee] postChatMessage: Attempted to send empty message.");
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        records: [{
          fields: {
            // SessionID must be an array (linked record field)
            SessionID: [sessionId],
            SenderID: senderId,
            SenderName: senderName,
            Content: content.trim()
          }
        }]
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error("[Invitee] postChatMessage failed:", response.status, errorData);
    }
    return response.ok;
  } catch (error) {
    console.error("[Invitee] Error posting message:", error);
    return false;
  }
}
function renderEventDetails(sessionData) {
  const fields = sessionData.fields;
  const eventName = fields.Name || "Untitled Event";
  document.getElementById("event-name").textContent = eventName;
  document.title = `${eventName} - WTFun`;
  const dateValue = fields.Date;
  if (dateValue) {
    const date = new Date(dateValue);
    const formattedDate = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
    document.getElementById("event-date").textContent = formattedDate;
  } else {
    document.getElementById("event-date").textContent = "Date TBD";
  }
  const guestCount = fields["Guest Count"];
  document.getElementById("event-guest-count").textContent = guestCount ? `${guestCount} guests` : "--";
  const goals = fields.Goals;
  if (goals) {
    document.getElementById("event-goals").textContent = goals;
    document.getElementById("event-goals-container").style.display = "block";
  }
}
function getOptimizedImageUrl(url, width = 400, height = 300) {
  if (!url) return null;
  if (url.includes("cloudinary")) {
    return url.replace("/upload/", `/upload/c_fill,w_${width},h_${height},f_auto,q_auto/`);
  }
  return url;
}
function renderComponentCard(record, itemInfo) {
  const fields = record.fields;
  const card = document.createElement("div");
  card.className = "component-card";
  let imageUrl = "";
  if (fields["Curated Images"] && fields["Curated Images"].length > 0) {
    imageUrl = fields["Curated Images"][0].url;
  } else if (fields["Media Tags"] && fields["Media Tags"].length > 0) {
    imageUrl = fields["Media Tags"][0].url;
  }
  const optimizedImageUrl = getOptimizedImageUrl(imageUrl, 400, 240);
  const imageStyle = optimizedImageUrl ? `background-image: url('${optimizedImageUrl}')` : "";
  const price = fields.Price || 0;
  const quantity = (itemInfo == null ? void 0 : itemInfo.quantity) || 1;
  card.innerHTML = `
        <div class="card-image" style="${imageStyle}">
            ${quantity > 1 ? `<span class="quantity-badge">Qty: ${quantity}</span>` : ""}
        </div>
        <div class="card-content">
            <div class="card-name">${fields.Name || "Untitled"}</div>
            <div class="card-price">$${price.toFixed(2)}${quantity > 1 ? ` \xD7 ${quantity}` : ""}</div>
            ${(itemInfo == null ? void 0 : itemInfo.note) ? `<div class="card-note">\u{1F4DD} ${itemInfo.note}</div>` : ""}
        </div>
    `;
  return card;
}
function renderComponentsCarousel() {
  console.log("[Invitee DEBUG] ===== renderComponentsCarousel START =====");
  const carousel = document.getElementById("components-carousel");
  console.log("[Invitee DEBUG] Carousel element found:", !!carousel);
  carousel.innerHTML = "";
  console.log("[Invitee DEBUG] Locked items size:", inviteeState.lockedItems.size);
  console.log("[Invitee DEBUG] Item records count:", inviteeState.itemRecords.length);
  if (inviteeState.lockedItems.size === 0) {
    console.log("[Invitee DEBUG] No locked items - showing empty carousel");
    carousel.innerHTML = `
            <div class="empty-carousel">
                <div class="icon">\u{1F4E6}</div>
                <p>No event components yet</p>
            </div>
        `;
    return;
  }
  let renderedCount = 0;
  for (const [recordId, itemInfo] of inviteeState.lockedItems.entries()) {
    console.log("[Invitee DEBUG] Processing locked item:", recordId, itemInfo);
    const record = inviteeState.itemRecords.find((r) => r.id === recordId);
    console.log("[Invitee DEBUG] Found matching record:", !!record, record);
    if (record) {
      const card = renderComponentCard(record, itemInfo);
      carousel.appendChild(card);
      renderedCount++;
      console.log("[Invitee DEBUG] Rendered card for:", recordId);
    } else {
      console.log("[Invitee DEBUG] WARNING: No matching record found for locked item:", recordId);
    }
  }
  console.log("[Invitee DEBUG] Total cards rendered:", renderedCount);
  console.log("[Invitee DEBUG] Carousel children count:", carousel.children.length);
  setupCarouselNavigation();
  console.log("[Invitee DEBUG] ===== renderComponentsCarousel COMPLETE =====");
}
function setupCarouselNavigation() {
  const carousel = document.getElementById("components-carousel");
  const prevBtn = document.getElementById("carousel-prev");
  const nextBtn = document.getElementById("carousel-next");
  const scrollAmount = 300;
  const updateNavButtons = () => {
    prevBtn.disabled = carousel.scrollLeft <= 0;
    nextBtn.disabled = carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth - 10;
  };
  prevBtn.addEventListener("click", () => {
    carousel.scrollBy({ left: -scrollAmount, behavior: "smooth" });
  });
  nextBtn.addEventListener("click", () => {
    carousel.scrollBy({ left: scrollAmount, behavior: "smooth" });
  });
  carousel.addEventListener("scroll", updateNavButtons);
  updateNavButtons();
}
function addMessageToUI(sender, content, isSent, timestamp, senderId) {
  console.log("[Invitee DEBUG] addMessageToUI called:", { sender, content, isSent, timestamp, senderId });
  const messagesContainer = document.getElementById("chat-messages");
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${isSent ? "sent" : ""}`;
  const time = timestamp ? new Date(timestamp) : /* @__PURE__ */ new Date();
  const timeStr = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  wrapper.innerHTML = `
        <div class="sender">${isSent ? "You" : sender}</div>
        <div class="content">${escapeHtml(content)}</div>
        <div class="timestamp">${timeStr}</div>
    `;
  messagesContainer.appendChild(wrapper);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  console.log("[Invitee DEBUG] Message added to UI, container children:", messagesContainer.children.length);
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function updatePresenceUI(count) {
  document.getElementById("presence-count").textContent = count;
}
async function initializeChat() {
  console.log("[Invitee DEBUG] ===== initializeChat START =====");
  const currentUser = getSimpleUserIdentity();
  const sessionId = inviteeState.sessionId;
  console.log("[Invitee DEBUG] Current user:", currentUser);
  console.log("[Invitee DEBUG] Session ID for chat:", sessionId);
  const userNameInput = document.getElementById("chat-user-name");
  userNameInput.value = currentUser.name;
  userNameInput.addEventListener("change", (e) => {
    const newName = e.target.value.trim();
    if (newName && newName !== currentUser.name) {
      currentUser.name = newName;
      localStorage.setItem("chatUserName", newName);
    } else {
      e.target.value = currentUser.name;
    }
  });
  const messagesContainer = document.getElementById("chat-messages");
  console.log("[Invitee DEBUG] Messages container found:", !!messagesContainer);
  messagesContainer.innerHTML = "";
  console.log("[Invitee DEBUG] Fetching chat messages...");
  const messages = await fetchChatMessages(sessionId);
  console.log("[Invitee DEBUG] Chat messages received:", messages);
  console.log("[Invitee DEBUG] Number of messages:", messages.length);
  messages.forEach((record, index) => {
    const { SenderID, SenderName, Content, Timestamp } = record.fields;
    console.log(`[Invitee DEBUG] Message ${index}:`, { SenderID, SenderName, Content, Timestamp });
    const isSent = SenderID === currentUser.id;
    addMessageToUI(SenderName, Content, isSent, Timestamp, SenderID);
  });
  console.log("[Invitee DEBUG] Messages container children after render:", messagesContainer.children.length);
  console.log("[Invitee DEBUG] Checking for waitForPusher function:", typeof window.waitForPusher);
  if (typeof window.waitForPusher === "function") {
    try {
      console.log("[Invitee DEBUG] Waiting for Pusher...");
      await window.waitForPusher();
      console.log("[Invitee DEBUG] Pusher ready, initializing chat...");
      initializePusherChat(sessionId, currentUser);
    } catch (err) {
      console.error("[Invitee DEBUG] Failed to load Pusher:", err);
      enableChatInput();
    }
  } else {
    console.log("[Invitee DEBUG] waitForPusher not available, enabling chat input directly");
    enableChatInput();
  }
  console.log("[Invitee DEBUG] ===== initializeChat COMPLETE =====");
}
function initializePusherChat(sessionId, currentUser) {
  console.log("[Invitee DEBUG] ===== initializePusherChat START =====");
  console.log("[Invitee DEBUG] Session ID:", sessionId);
  console.log("[Invitee DEBUG] Current user:", currentUser);
  if (inviteeState.pusher) {
    console.log("[Invitee DEBUG] Disconnecting existing Pusher instance");
    inviteeState.pusher.disconnect();
  }
  console.log("[Invitee DEBUG] Creating new Pusher instance...");
  inviteeState.pusher = new Pusher("236f480714e5001590b5", {
    cluster: "us3",
    authEndpoint: "/api/pusher-auth",
    auth: {
      params: {
        user_id: currentUser.id,
        user_name: currentUser.name
      }
    }
  });
  inviteeState.pusher.connection.bind("state_change", (states) => {
    console.log("[Invitee DEBUG] Pusher connection state change:", states.previous, "->", states.current);
  });
  inviteeState.pusher.connection.bind("error", (err) => {
    console.error("[Invitee DEBUG] Pusher connection error:", err);
  });
  const channelName = `presence-session-${sessionId}`;
  console.log("[Invitee DEBUG] Subscribing to channel:", channelName);
  inviteeState.chatChannel = inviteeState.pusher.subscribe(channelName);
  inviteeState.chatChannel.bind("pusher:subscription_succeeded", (members) => {
    console.log("[Invitee DEBUG] Pusher subscription succeeded, members count:", members.count);
    updatePresenceUI(members.count);
    enableChatInput();
  });
  inviteeState.chatChannel.bind("pusher:subscription_error", (error) => {
    console.error("[Invitee DEBUG] Pusher subscription error:", error);
    enableChatInput();
  });
  inviteeState.chatChannel.bind("pusher:member_added", (member) => {
    console.log("[Invitee DEBUG] Pusher member added:", member);
    updatePresenceUI(inviteeState.chatChannel.members.count);
  });
  inviteeState.chatChannel.bind("pusher:member_removed", (member) => {
    console.log("[Invitee DEBUG] Pusher member removed:", member);
    updatePresenceUI(inviteeState.chatChannel.members.count);
  });
  inviteeState.chatChannel.bind("client-new-message", (data) => {
    console.log("[Invitee DEBUG] Received client-new-message:", data);
    if (data.senderId !== currentUser.id) {
      addMessageToUI(data.senderName, data.content, false, data.timestamp, data.senderId);
    }
  });
  console.log("[Invitee DEBUG] ===== initializePusherChat COMPLETE =====");
}
function enableChatInput() {
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.placeholder = "Type a message...";
}
function setupChatForm() {
  const form = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;
    const currentUser = getSimpleUserIdentity();
    const sessionId = inviteeState.sessionId;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    addMessageToUI(currentUser.name, message, true, timestamp, currentUser.id);
    chatInput.value = "";
    await postChatMessage(sessionId, currentUser.id, currentUser.name, message);
    if (inviteeState.chatChannel) {
      try {
        inviteeState.chatChannel.trigger("client-new-message", {
          content: message,
          senderId: currentUser.id,
          senderName: currentUser.name,
          timestamp
        });
      } catch (err) {
        console.log("Pusher broadcast failed:", err);
      }
    }
  });
}
async function initializeInviteeView() {
  console.log("[Invitee DEBUG] ===== initializeInviteeView START =====");
  showLoading();
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session") || urlParams.get("slug");
  console.log("[Invitee DEBUG] Session ID from URL:", sessionId);
  console.log("[Invitee DEBUG] Full URL:", window.location.href);
  console.log("[Invitee DEBUG] URL search params:", window.location.search);
  if (!sessionId) {
    console.log("[Invitee DEBUG] ERROR: No session ID found in URL");
    showError("No event specified. Please check the link you were given.");
    return;
  }
  inviteeState.sessionId = sessionId;
  try {
    console.log("[Invitee DEBUG] Fetching session data for ID:", sessionId);
    const sessionData = await fetchSessionById(sessionId);
    console.log("[Invitee DEBUG] Session data received:", sessionData);
    console.log("[Invitee DEBUG] Session fields:", sessionData == null ? void 0 : sessionData.fields);
    inviteeState.sessionData = sessionData;
    const itemsJson = sessionData.fields["Items with Variations"];
    console.log("[Invitee DEBUG] Raw Items with Variations field:", itemsJson);
    console.log("[Invitee DEBUG] Type of Items with Variations:", typeof itemsJson);
    if (itemsJson) {
      try {
        const parsedData = JSON.parse(itemsJson);
        console.log("[Invitee DEBUG] Parsed items data:", parsedData);
        console.log("[Invitee DEBUG] lockedInItems from parsed data:", parsedData.lockedInItems);
        console.log("[Invitee DEBUG] Type of lockedInItems:", typeof parsedData.lockedInItems);
        if (parsedData.lockedInItems) {
          inviteeState.lockedItems = new Map(Object.entries(parsedData.lockedInItems));
          console.log("[Invitee DEBUG] Locked items Map size:", inviteeState.lockedItems.size);
          console.log("[Invitee DEBUG] Locked items entries:", Array.from(inviteeState.lockedItems.entries()));
        } else {
          console.log("[Invitee DEBUG] WARNING: No lockedInItems property in parsed data");
          console.log("[Invitee DEBUG] Available keys in parsedData:", Object.keys(parsedData));
        }
      } catch (err) {
        console.error("[Invitee DEBUG] ERROR parsing items JSON:", err);
        console.log("[Invitee DEBUG] Items JSON that failed to parse:", itemsJson);
      }
    } else {
      console.log("[Invitee DEBUG] WARNING: Items with Variations field is empty/undefined");
      console.log("[Invitee DEBUG] All session fields:", Object.keys(sessionData.fields || {}));
    }
    const itemIds = Array.from(inviteeState.lockedItems.keys()).filter((id) => !id.startsWith("custom-"));
    console.log("[Invitee DEBUG] Item IDs to fetch (excluding custom):", itemIds);
    if (itemIds.length > 0) {
      console.log("[Invitee DEBUG] Fetching item records for", itemIds.length, "items");
      inviteeState.itemRecords = await fetchItemsByIds(itemIds);
      console.log("[Invitee DEBUG] Item records received:", inviteeState.itemRecords);
      console.log("[Invitee DEBUG] Number of item records:", inviteeState.itemRecords.length);
    } else {
      console.log("[Invitee DEBUG] No item IDs to fetch");
    }
    console.log("[Invitee DEBUG] Rendering event details...");
    renderEventDetails(sessionData);
    console.log("[Invitee DEBUG] Rendering components carousel...");
    renderComponentsCarousel();
    console.log("[Invitee DEBUG] Setting up chat form...");
    setupChatForm();
    console.log("[Invitee DEBUG] Initializing chat...");
    await initializeChat();
    console.log("[Invitee DEBUG] Showing content...");
    showContent();
    console.log("[Invitee DEBUG] ===== initializeInviteeView COMPLETE =====");
  } catch (error) {
    console.error("[Invitee DEBUG] CRITICAL ERROR in initializeInviteeView:", error);
    console.error("[Invitee DEBUG] Error stack:", error.stack);
    showError("Could not load event details. The event may no longer exist or the link may be invalid.");
  }
}
console.log("[Invitee DEBUG] Setting up initialization listener...");
console.log("[Invitee DEBUG] Current document.readyState:", document.readyState);
if (document.readyState === "loading") {
  console.log("[Invitee DEBUG] Document still loading, adding DOMContentLoaded listener");
  document.addEventListener("DOMContentLoaded", () => {
    console.log("[Invitee DEBUG] DOMContentLoaded event fired");
    initializeInviteeView();
  });
} else {
  console.log("[Invitee DEBUG] Document already loaded, calling initializeInviteeView immediately");
  initializeInviteeView();
}
//# sourceMappingURL=invitee.bundle.js.map
