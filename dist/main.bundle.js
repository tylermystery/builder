var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// state.js
var state = {
  stores: {
    all: []
  },
  records: {
    all: [],
    filtered: [],
    archive: []
    // Ghost items (archived/deleted items referenced in session history)
  },
  cart: {
    items: /* @__PURE__ */ new Map(),
    // \"Ideas\" (formerly Favorites), populated by \"Save for Later\"
    lockedItems: /* @__PURE__ */ new Map(),
    // \"Event Plan\"
    customItems: /* @__PURE__ */ new Map()
    // ADD THIS LINE: Holds AI-parsed item data
  },
  eventDetails: {
    combined: /* @__PURE__ */ new Map()
  },
  session: {
    id: null,
    isOwned: false,
    storeId: null,
    user: {
      isAuthenticated: false,
      id: null,
      name: "",
      email: "",
      amountReceived: 0,
      paymentHistory: [],
      rsvps: /* @__PURE__ */ new Set(),
      isOwner: false,
      ownerDashboardId: null,
      ownedStoreId: null,
      likedItemIds: /* @__PURE__ */ new Set()
      // ADDED: Stores persistent liked item IDs
    },
    userProfiles: /* @__PURE__ */ new Map(),
    reactions: /* @__PURE__ */ new Map(),
    flaggedUsers: /* @__PURE__ */ new Set(),
    bannedUsers: /* @__PURE__ */ new Set(),
    // --- THIS IS THE NEW LINE ---
    itemPositions: /* @__PURE__ */ new Map(),
    // Stores { x: 120, y: 50, z: 1 } for each recordId
    // --- END NEW LINE ---
    // Recent chats list for expandable chat history
    recentChats: []
    // Array of { id, type: 'session'|'item', name, lastMessage, lastMessageTime, unreadCount }
  },
  calendar: {
    busyTimes: /* @__PURE__ */ new Map()
  },
  ui: {
    recordsCurrentlyDisplayed: 0,
    isLoadingMore: false,
    saveState: "SAVED",
    isInitializing: true,
    activeShopId: null,
    currentProgress: 0.3
    // NEW: Background color progress (0.0 to 1.0) - Start at cyan/blue range
  }
};
function setState2(newState) {
  let updatedState = { ...state, ...newState };
  if (newState.ui) {
    updatedState.ui = {
      ...state.ui,
      ...newState.ui
    };
    if (newState.ui.currentProgress === void 0 && state.ui.currentProgress !== void 0) {
      updatedState.ui.currentProgress = state.ui.currentProgress;
    }
  }
  if (newState.records) {
    updatedState.records = {
      ...state.records,
      ...newState.records
    };
  }
  if (newState.session && newState.session.user) {
    updatedState.session = {
      ...state.session,
      ...newState.session,
      user: {
        ...state.session.user,
        ...newState.session.user
      }
    };
  } else if (newState.session) {
    updatedState.session = {
      ...state.session,
      ...newState.session
    };
  }
  state = updatedState;
}

// config.js
var STRIPE_PUBLISHABLE_KEY = "pk_live_opXi3umu9588LiitWvYhdk9H";
var CLOUDINARY_CLOUD_NAME = "daedqizre";
var RECORDS_PER_LOAD = 10;
var EMOJI_REACTIONS = ["\u{1F680}", "\u{1F525}", "\u{1F929}", "❤️", "\u{1F44D}", "\u{1F914}", "\u{1F44E}", "\u{1F922}"];
var CONSTANTS = {
  FIELD_NAMES: {
    NAME: "Name",
    PRICE: "Price",
    DESCRIPTION: "Description",
    OPTIONS: "Options",
    PARENT_ITEM: "Parent Item",
    STATUS: "Status",
    DURATION: "Duration (hours)",
    PRICING_TYPE: "Pricing Type",
    HEADCOUNT_MIN: "Headcount min",
    MEDIA_TAGS: "Media Tags",
    // <-- ORIGINAL FIELD (LIVE SITE USES THIS)
    CURATED_IMAGES_LINK: "Curated Images",
    // <-- NEW FIELD FOR AI LINKS (SETUP IN AIRTABLE)
    CATEGORIES: "Categories",
    SUBCATEGORIES: "Subcategories",
    ICAL_URL: "iCal URL",
    LEAD_TIME: "Lead Time (days)",
    COLLABORATOR_IDS_FIELD: "CollaboratorIDs",
    SESSION_ID_FIELD: "SessionID",
    TIMESTAMP_FIELD: "Timestamp"
  },
  PRICING_TYPES: {
    PER_GUEST: "per guest"
  },
  // This part is crucial for session loading
  DETAIL_TYPES: {
    EVENT_NAME: "eventName",
    DATE: "date",
    GUEST_COUNT: "guestCount",
    GOALS: "goals",
    SPECIAL_REQUESTS: "specialRequests"
  }
};

// utils/debug.js
var isDebugMode = false;
function setDebugMode(enabled) {
  isDebugMode = enabled;
}
function log(prefix, ...args) {
  if (isDebugMode) {
    console.log(`[${prefix}]`, ...args);
  }
}

// utils.js
var loadedLibraries = /* @__PURE__ */ new Set();
var loadingPromises = /* @__PURE__ */ new Map();
var tempLikesCache = null;
var tempLikesCacheTime = 0;
var TEMP_LIKES_CACHE_TTL = 5e3;
function getTempLikes() {
  const now = Date.now();
  if (tempLikesCache && now - tempLikesCacheTime < TEMP_LIKES_CACHE_TTL) {
    return tempLikesCache;
  }
  try {
    const tempLikes = new Set(JSON.parse(localStorage.getItem("tempLikes") || "[]"));
    tempLikesCache = tempLikes;
    tempLikesCacheTime = now;
    return tempLikes;
  } catch (e) {
    console.error("[Utils] Error reading tempLikes:", e);
    return /* @__PURE__ */ new Set();
  }
}
function setTempLikes(likes) {
  try {
    localStorage.setItem("tempLikes", JSON.stringify(Array.from(likes)));
    tempLikesCache = likes;
    tempLikesCacheTime = Date.now();
  } catch (e) {
    console.error("[Utils] Error setting tempLikes:", e);
  }
}
function invalidateTempLikesCache() {
  tempLikesCache = null;
  tempLikesCacheTime = 0;
}
function loadScript(src, name) {
  if (loadedLibraries.has(name)) {
    return Promise.resolve();
  }
  if (loadingPromises.has(name)) {
    return loadingPromises.get(name);
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      loadedLibraries.add(name);
      loadingPromises.delete(name);
      log("LazyLoad", `${name} loaded successfully`);
      resolve();
    };
    script.onerror = () => {
      loadingPromises.delete(name);
      log("LazyLoad", `Failed to load ${name}`);
      reject(new Error(`Failed to load ${name}`));
    };
    document.head.appendChild(script);
  });
  loadingPromises.set(name, promise);
  return promise;
}
async function loadStripe() {
  await loadScript("https://js.stripe.com/v3/", "stripe");
}
async function loadFlatpickr() {
  if (window.flatpickr) {
    return Promise.resolve();
  }
  if (!document.querySelector('link[href*="flatpickr.min.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css";
    document.head.appendChild(link);
    log("LazyLoad", "Flatpickr CSS loaded");
  }
  await loadScript("https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js", "flatpickr");
  let attempts = 0;
  while (!window.flatpickr && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }
  if (!window.flatpickr) {
    throw new Error("Flatpickr failed to load after 5 seconds");
  }
  log("LazyLoad", "Flatpickr is now available on window object");
}
async function loadSortable() {
  if (window.Sortable) {
    return Promise.resolve();
  }
  await loadScript("https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js", "sortable");
  let attempts = 0;
  while (!window.Sortable && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }
  if (!window.Sortable) {
    throw new Error("Sortable failed to load after 5 seconds");
  }
  log("LazyLoad", "SortableJS is now available on window object");
}
function parseOptions(rawOptionsString) {
  if (!rawOptionsString || typeof rawOptionsString !== "string") {
    return [];
  }
  const lines = rawOptionsString.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasGroupHeaders = lines.some((line) => /^\[.+\]\s*(\(.+\))?$/.test(line));
  if (hasGroupHeaders) {
    return parseOptionsWithGroups(lines);
  } else {
    return parseLegacyOptions(lines);
  }
}
function parseOptionsWithGroups(lines) {
  const groups = [];
  let currentGroup = null;
  for (const line of lines) {
    const groupMatch = line.match(/^\[(.+?)\]\s*(?:\((.+?)\))?$/);
    if (groupMatch) {
      currentGroup = {
        name: groupMatch[1].trim(),
        modifier: groupMatch[2] ? groupMatch[2].trim() : null,
        options: []
      };
      groups.push(currentGroup);
    } else if (currentGroup) {
      const option = parseOptionLine(line);
      currentGroup.options.push(option);
    } else {
      currentGroup = {
        name: "Options",
        modifier: null,
        options: []
      };
      groups.push(currentGroup);
      const option = parseOptionLine(line);
      currentGroup.options.push(option);
    }
  }
  return groups;
}
function parseOptionLine(line) {
  let name = line;
  let priceModifier = null;
  let priceOverride = null;
  let imageTag = null;
  let descriptionAppend = null;
  let durationChange = null;
  const modifierPattern = /\[(\w+):\s*([^\]]+)\]/gi;
  let match;
  while ((match = modifierPattern.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    switch (key) {
      case "price":
        if (value.startsWith("+") || value.startsWith("-")) {
          priceModifier = parseFloat(value);
        } else {
          priceOverride = parseFloat(value);
        }
        break;
      case "img":
      case "image":
        imageTag = value;
        break;
      case "desc":
      case "description":
        descriptionAppend = value;
        break;
      case "time":
      case "duration":
        durationChange = parseFloat(value);
        break;
    }
  }
  name = line.replace(/\[(\w+):\s*([^\]]+)\]/gi, "").trim();
  const namePriceMatch = name.match(/\$(\d+(\.\d{1,2})?)/);
  if (namePriceMatch && priceOverride === null && priceModifier === null) {
    priceOverride = parseFloat(namePriceMatch[1]);
    name = name.replace(namePriceMatch[0], "").trim();
  }
  return {
    name: name || "Unnamed Option",
    priceModifier: isNaN(priceModifier) ? null : priceModifier,
    priceOverride: isNaN(priceOverride) ? null : priceOverride,
    imageTag,
    descriptionAppend,
    durationChange: isNaN(durationChange) ? null : durationChange,
    // Legacy compatibility fields
    price: priceOverride,
    priceChange: priceModifier,
    description: descriptionAppend
  };
}
function parseLegacyOptions(lines) {
  const options = lines.map((option) => {
    let name = option;
    let price = null;
    let priceChange = null;
    let durationChange = null;
    let description = null;
    const parts = option.split(",").map((part) => part.trim());
    name = parts.shift() || "";
    parts.forEach((part) => {
      let match;
      if (match = part.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i)) {
        price = parseFloat(match[1]);
      } else if (match = part.match(/price change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
        priceChange = parseFloat(match[1]);
      } else if (match = part.match(/duration change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
        durationChange = parseFloat(match[1]);
      } else if (match = part.match(/description:\s*['"]?([^"']+)['"]?/i)) {
        description = match[1];
      }
    });
    let namePriceMatch = name.match(/\$(\d+(\.\d{1,2})?)/);
    if (namePriceMatch) {
      price = parseFloat(namePriceMatch[1]);
      name = name.replace(namePriceMatch[0], "").trim();
    }
    return {
      name: name || "Unnamed Option",
      priceModifier: priceChange,
      priceOverride: price,
      imageTag: null,
      descriptionAppend: description,
      durationChange,
      // Legacy compatibility fields
      price,
      priceChange,
      description
    };
  });
  if (options.length === 0) {
    return [];
  }
  return [{
    name: "Options",
    modifier: null,
    options
  }];
}
function flattenOptionGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.reduce((acc, group) => {
    if (group.options && Array.isArray(group.options)) {
      return acc.concat(group.options);
    }
    return acc;
  }, []);
}
function debounce(func, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}
function updateUrl2(paramsToUpdate) {
  const url = new URL(window.location);
  const searchParams = url.searchParams;
  for (const key in paramsToUpdate) {
    const value = paramsToUpdate[key];
    if (value === null || value === void 0 || value === "") {
      searchParams.delete(key);
    } else {
      searchParams.set(key, value);
    }
  }
  const newUrl = url.pathname + "?" + searchParams.toString();
  const currentUrl = window.location.pathname + window.location.search;
  if (newUrl !== currentUrl) {
    history.pushState({}, "", newUrl);
  }
}
function getDescendantBookableItems(record, allRecords) {
  let bookableItems = [];
  const children = allRecords.filter((r) => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);
  for (const child of children) {
    const rawOptions = parseOptions(child.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map((r) => r.fields.Name));
    const isGrouping = rawOptions.some((opt) => childRecordNames.has(opt.name));
    if (isGrouping) {
      bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecords));
    } else {
      bookableItems.push(child);
    }
  }
  return bookableItems;
}
function getGroupPriceRange(record) {
  const descendants = getDescendantBookableItems(record, state.records.all);
  if (descendants.length === 0) return null;
  let minPrice = Infinity, maxPrice = -Infinity;
  descendants.forEach((item) => {
    const options = parseOptions(item.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    if (options.length > 0) {
      options.forEach((opt, index) => {
        const price = getRecordPrice(item, index);
        if (price > 0) {
          if (price < minPrice) minPrice = price;
          if (price > maxPrice) maxPrice = price;
        }
      });
    } else {
      const price = getRecordPrice(item);
      if (price > 0) {
        if (price < minPrice) minPrice = price;
        if (price > maxPrice) maxPrice = price;
      }
    }
  });
  return minPrice === Infinity ? null : { min: minPrice, max: maxPrice };
}
function getRecordPrice(record, selectionsOrIndex = null) {
  var _a;
  let price = parseFloat(String(((_a = record == null ? void 0 : record.fields) == null ? void 0 : _a[CONSTANTS.FIELD_NAMES.PRICE]) || "0").replace(/[^0-9.-]+/g, ""));
  if (selectionsOrIndex === null) {
    return isNaN(price) ? 0 : price;
  }
  const groups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
  if (typeof selectionsOrIndex === "number") {
    const flatOptions = flattenOptionGroups(groups);
    const variation = flatOptions[selectionsOrIndex];
    if (variation) {
      if (variation.priceOverride !== null) return variation.priceOverride;
      if (variation.priceModifier !== null) price += variation.priceModifier;
    }
    return isNaN(price) ? 0 : price;
  }
  if (typeof selectionsOrIndex === "object") {
    for (const [groupKey, optionIndex] of Object.entries(selectionsOrIndex)) {
      const groupIndexMatch = groupKey.match(/^group(\d+)$/);
      if (!groupIndexMatch) continue;
      const groupIndex = parseInt(groupIndexMatch[1], 10);
      const group = groups[groupIndex];
      if (!group || !group.options) continue;
      const option = group.options[optionIndex];
      if (!option) continue;
      if (option.priceOverride !== null) {
        price = option.priceOverride;
      } else if (option.priceModifier !== null) {
        price += option.priceModifier;
      }
    }
  }
  return isNaN(price) ? 0 : price;
}
function getActiveImageTag(record, selectionsOrIndex = null) {
  if (selectionsOrIndex === null) {
    return null;
  }
  const groups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
  let imageTag = null;
  if (typeof selectionsOrIndex === "number") {
    const flatOptions = flattenOptionGroups(groups);
    const option = flatOptions[selectionsOrIndex];
    if (option && option.imageTag) {
      return option.imageTag;
    }
    return null;
  }
  if (typeof selectionsOrIndex === "object") {
    const sortedKeys = Object.keys(selectionsOrIndex).sort((a, b) => {
      const indexA = parseInt(a.replace("group", ""), 10) || 0;
      const indexB = parseInt(b.replace("group", ""), 10) || 0;
      return indexA - indexB;
    });
    for (const groupKey of sortedKeys) {
      const optionIndex = selectionsOrIndex[groupKey];
      const groupIndexMatch = groupKey.match(/^group(\d+)$/);
      if (!groupIndexMatch) continue;
      const groupIndex = parseInt(groupIndexMatch[1], 10);
      const group = groups[groupIndex];
      if (!group || !group.options) continue;
      const option = group.options[optionIndex];
      if (option && option.imageTag) {
        imageTag = option.imageTag;
      }
    }
  }
  return imageTag;
}
function getRecordDescription(record, selectionsOrIndex = null) {
  var _a;
  const baseDescription = ((_a = record == null ? void 0 : record.fields) == null ? void 0 : _a.Description) || "";
  if (selectionsOrIndex === null) {
    return baseDescription;
  }
  const groups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
  const appendedParts = [];
  if (typeof selectionsOrIndex === "number") {
    const flatOptions = flattenOptionGroups(groups);
    const option = flatOptions[selectionsOrIndex];
    if (option && option.descriptionAppend) {
      appendedParts.push(option.descriptionAppend);
    }
  }
  if (typeof selectionsOrIndex === "object") {
    const sortedKeys = Object.keys(selectionsOrIndex).sort((a, b) => {
      const indexA = parseInt(a.replace("group", ""), 10) || 0;
      const indexB = parseInt(b.replace("group", ""), 10) || 0;
      return indexA - indexB;
    });
    for (const groupKey of sortedKeys) {
      const optionIndex = selectionsOrIndex[groupKey];
      const groupIndexMatch = groupKey.match(/^group(\d+)$/);
      if (!groupIndexMatch) continue;
      const groupIndex = parseInt(groupIndexMatch[1], 10);
      const group = groups[groupIndex];
      if (!group || !group.options) continue;
      const option = group.options[optionIndex];
      if (option && option.descriptionAppend) {
        appendedParts.push(option.descriptionAppend);
      }
    }
  }
  if (appendedParts.length === 0) {
    return baseDescription;
  }
  const separator = baseDescription ? "\n\n" : "";
  return baseDescription + separator + appendedParts.join("\n");
}
function getEffectiveMinQuantity(record) {
  let isUmwInPlan = false;
  for (const [id] of state.cart.lockedItems) {
    const lockedRecord = state.records.all.find((r) => r.id === id);
    if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
      isUmwInPlan = true;
      break;
    }
  }
  const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
  return isUmwInPlan ? 1 : airtableMin;
}

// api.js
var PERSONAL_ACCESS_TOKEN = "patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57";
var BASE_ID = "app5yTznb3R5YNUFw";
var TABLE_ID = "tblUA4uuS8IYlhKpD";
var SESSIONS_TABLE_NAME = "Sessions";
var STORES_TABLE_NAME = "Stores";
var ITEM_MESSAGES_TABLE_NAME = "Messages";
var IMAGE_GALLERY_TABLE_NAME = "Image_Gallery";
async function fetchPlansForUser(userId, includeFullDetails = false) {
  if (!userId) {
    return [];
  }
  const isStoreOwner = state.session.user.isOwner;
  const ownedStoreId = state.session.user.ownedStoreId;
  let formula;
  if (isStoreOwner && ownedStoreId) {
    formula = `OR(FIND('${userId}', ARRAYJOIN({Collaborators})), FIND('${ownedStoreId}', ARRAYJOIN({Stores})))`;
    log("API", `Fetching plans for store owner: collaborator plans + store plans (Store ID: ${ownedStoreId})`);
  } else {
    formula = `FIND('${userId}', ARRAYJOIN({Collaborators}))`;
    log("API", `Fetching plans for regular user: collaborator plans only`);
  }
  const encodedFormula = encodeURIComponent(formula);
  let url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;
  if (!includeFullDetails) {
    url += "&fields%5B%5D=Name";
  }
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Airtable Error fetching plans:", errorText);
      throw new Error("Failed to fetch user plans from Airtable.");
    }
    const data = await response.json();
    data.records.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    log("API", `Fetched ${data.records.length} plans for user ${userId}`);
    return data.records;
  } catch (error) {
    console.error("Error fetching user plans:", error);
    return [];
  }
}
async function fetchSessionsWithDatesForStore(storeId) {
  var _a, _b;
  console.log("[FETCH SESSIONS] ========== fetchSessionsWithDatesForStore START ==========");
  console.log("[FETCH SESSIONS] Requested storeId:", storeId);
  if (!storeId) {
    console.log("[FETCH SESSIONS] ⚠️ No storeId provided, returning empty array");
    return [];
  }
  console.log("[FETCH SESSIONS] Building Airtable query...");
  const formula = `AND(OR(FIND('${storeId}', ARRAYJOIN({Stores})), FIND('${storeId}', {Stores}&'')), {Date} != '')`;
  const encodedFormula = encodeURIComponent(formula);
  console.log("[FETCH SESSIONS] Airtable formula:", formula);
  console.log("[FETCH SESSIONS] Encoded formula:", encodedFormula);
  const fieldsQuery = [
    "Name",
    "Date",
    "Guest Count",
    "Goals",
    "Stores",
    "Collaborators"
  ].map((field) => `fields%5B%5D=${encodeURIComponent(field)}`).join("&");
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;
  console.log("[FETCH SESSIONS] Full API URL:", url);
  try {
    console.log("[FETCH SESSIONS] Making fetch request...");
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    console.log("[FETCH SESSIONS] Response status:", response.status, response.statusText);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[FETCH SESSIONS] ⚠️ Airtable Error response:", errorText);
      throw new Error("Failed to fetch sessions with dates from Airtable.");
    }
    const data = await response.json();
    console.log("[FETCH SESSIONS] ========== QUERY RESULTS ==========");
    console.log("[FETCH SESSIONS] Number of records returned:", ((_a = data.records) == null ? void 0 : _a.length) || 0);
    if (data.records && data.records.length > 0) {
      console.log("[FETCH SESSIONS] ✅ Found", data.records.length, "matching session(s)!");
      data.records.forEach((record, index) => {
        console.log(`[FETCH SESSIONS] --- Session ${index + 1} ---`);
        console.log(`[FETCH SESSIONS]   ID: ${record.id}`);
        console.log(`[FETCH SESSIONS]   Name: ${record.fields.Name}`);
        console.log(`[FETCH SESSIONS]   Date: ${record.fields.Date}`);
        console.log(`[FETCH SESSIONS]   Stores: ${JSON.stringify(record.fields.Stores)}`);
        console.log(`[FETCH SESSIONS]   Stores type: ${typeof record.fields.Stores}`);
        console.log(`[FETCH SESSIONS]   Stores is array? ${Array.isArray(record.fields.Stores)}`);
      });
      console.log("[FETCH SESSIONS] ==================================================");
      console.log("[FETCH SESSIONS] Returning", data.records.length, "session(s) to calendar");
      return data.records;
    } else {
      console.log("[FETCH SESSIONS] ⚠️ No sessions matched the query");
      console.log("[FETCH SESSIONS] This means either:");
      console.log("[FETCH SESSIONS]   1. No sessions have dates set");
      console.log("[FETCH SESSIONS]   2. No sessions have the Stores field set to:", storeId);
      console.log("[FETCH SESSIONS]   3. Sessions exist but the formula didnt match");
      console.log("[FETCH SESSIONS] ========== FALLBACK QUERY ==========");
      console.log("[FETCH SESSIONS] Attempting to fetch ALL sessions with dates...");
      const fallbackFormula = `{Date} != ''`;
      const fallbackEncodedFormula = encodeURIComponent(fallbackFormula);
      const fallbackUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${fallbackEncodedFormula}&${fieldsQuery}`;
      try {
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          console.log("[FETCH SESSIONS] Fallback query found", ((_b = fallbackData.records) == null ? void 0 : _b.length) || 0, "sessions with dates");
          if (fallbackData.records && fallbackData.records.length > 0) {
            console.log("[FETCH SESSIONS] --- All Sessions with Dates ---");
            fallbackData.records.forEach((record, index) => {
              const stores = record.fields.Stores;
              const matchesStore = stores ? Array.isArray(stores) ? stores.includes(storeId) : stores === storeId : false;
              console.log(`[FETCH SESSIONS] Session ${index + 1}:`);
              console.log(`[FETCH SESSIONS]   ID: ${record.id}`);
              console.log(`[FETCH SESSIONS]   Name: ${record.fields.Name}`);
              console.log(`[FETCH SESSIONS]   Date: ${record.fields.Date}`);
              console.log(`[FETCH SESSIONS]   Stores: ${JSON.stringify(stores)}`);
              console.log(`[FETCH SESSIONS]   Stores type: ${typeof stores}`);
              console.log(`[FETCH SESSIONS]   Stores is array? ${Array.isArray(stores)}`);
              console.log(`[FETCH SESSIONS]   Matches storeId '${storeId}'? ${matchesStore ? "✅ YES" : "❌ NO"}`);
              console.log("[FETCH SESSIONS]   ---");
            });
            const matchingSessions = fallbackData.records.filter((record) => {
              const stores = record.fields.Stores;
              if (!stores) {
                console.log(`[FETCH SESSIONS] Excluding ${record.id}: No Stores field`);
                return false;
              }
              if (Array.isArray(stores)) {
                const matches2 = stores.includes(storeId);
                console.log(`[FETCH SESSIONS] ${record.id}: Stores array ${matches2 ? "includes" : "does NOT include"} storeId`);
                return matches2;
              }
              const matches = stores === storeId;
              console.log(`[FETCH SESSIONS] ${record.id}: Stores string ${matches ? "matches" : "does NOT match"} storeId`);
              return matches;
            });
            console.log("[FETCH SESSIONS] ==================================================");
            console.log("[FETCH SESSIONS] Manual filtering found", matchingSessions.length, "matching session(s)");
            console.log("[FETCH SESSIONS] Returning manually filtered results");
            return matchingSessions;
          } else {
            console.log("[FETCH SESSIONS] ⚠️ Fallback query found NO sessions with dates at all!");
            console.log("[FETCH SESSIONS] This means no sessions in Airtable have the Date field set.");
          }
        }
      } catch (fallbackError) {
        console.error("[FETCH SESSIONS] Fallback query also failed:", fallbackError);
      }
    }
    console.log("[FETCH SESSIONS] ==================================================");
    console.log("[FETCH SESSIONS] Returning empty array");
    return [];
  } catch (error) {
    console.error("[Calendar API Debug] Error fetching sessions with dates:", error);
    return [];
  }
}
window.debugFetchSession = async function(sessionId) {
  var _a, _b, _c, _d, _e, _f;
  console.log("[DEBUG] Manually fetching session:", sessionId);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      console.error("[DEBUG] Failed to fetch session:", response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    console.log("[DEBUG] Session data from Airtable:", data);
    console.log("[DEBUG] Session Name:", (_a = data.fields) == null ? void 0 : _a.Name);
    console.log("[DEBUG] Session Date:", (_b = data.fields) == null ? void 0 : _b.Date);
    console.log("[DEBUG] Session Stores:", (_c = data.fields) == null ? void 0 : _c.Stores);
    console.log("[DEBUG] Stores type:", typeof ((_d = data.fields) == null ? void 0 : _d.Stores));
    console.log("[DEBUG] Stores is array?", Array.isArray((_e = data.fields) == null ? void 0 : _e.Stores));
    console.log("[DEBUG] Stores value:", JSON.stringify((_f = data.fields) == null ? void 0 : _f.Stores));
    return data;
  } catch (error) {
    console.error("[DEBUG] Error fetching session:", error);
    return null;
  }
};
async function associateSessionWithUser(sessionId, userId) {
  if (!sessionId || !userId) return;
  log("API", `Associating session ${sessionId} with user ${userId}`);
  const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  const userUrl = `https://api.airtable.com/v0/${BASE_ID}/Users/${userId}`;
  try {
    const [sessionRes, userRes] = await Promise.all([
      fetch(sessionUrl, { headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` } }),
      fetch(userUrl, { headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` } })
    ]);
    if (!sessionRes.ok) throw new Error(`Could not fetch session ${sessionId}. Status: ${sessionRes.status}`);
    if (!userRes.ok) throw new Error(`Could not fetch user ${userId}. Status: ${userRes.status}`);
    const sessionRecord = await sessionRes.json();
    const userRecord = await userRes.json();
    const currentCollaborators = sessionRecord.fields.Collaborators || [];
    if (!currentCollaborators.includes(userId)) {
      const updatedCollaborators = [...currentCollaborators, userId];
      const sessionPayload = { fields: { "Collaborators": updatedCollaborators } };
      const patchSessionRes = await fetch(sessionUrl, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(sessionPayload)
      });
      if (!patchSessionRes.ok) throw new Error(`Airtable API Error updating session collaborators: ${await patchSessionRes.text()}`);
      log("API", `Successfully added user ${userId} to session ${sessionId} collaborators.`);
    } else {
      log("API", `User ${userId} already a collaborator on session ${sessionId}.`);
    }
    const currentSessions = userRecord.fields["Sessions 2"] || [];
    if (!currentSessions.includes(sessionId)) {
      const updatedSessions = [...currentSessions, sessionId];
      const userPayload = { fields: { "Sessions 2": updatedSessions } };
      const patchUserRes = await fetch(userUrl, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(userPayload)
      });
      if (!patchUserRes.ok) console.error(`Airtable API Error updating user associated sessions: ${await patchUserRes.text()}`);
      else log("API", `Successfully added session ${sessionId} to user ${userId}'s associated sessions.`);
    } else {
      log("API", `Session ${sessionId} already associated with user ${userId}.`);
    }
  } catch (error) {
    console.error("Failed to associate session with user:", error);
    log("API", `Failed to associate session: ${error.message}`);
  }
}
async function loadSessionFromAirtable(sessionId) {
  var _a;
  console.log("[DEBUG LOAD SESSION] ========== loadSessionFromAirtable START ==========");
  console.log("[DEBUG LOAD SESSION] sessionId parameter:", sessionId);
  console.log("[DEBUG LOAD SESSION] Current state.session.id:", state.session.id);
  if (!sessionId) {
    console.log("[DEBUG LOAD SESSION] ❌ No sessionId provided, returning early");
    log("API", "loadSessionFromAirtable called with no sessionId.");
    return;
  }
  if (state.session.id === sessionId) {
    console.log("[DEBUG LOAD SESSION] ⚠️ Session already loaded (same ID), checking if we should fire sessionReady");
    log("API", `Session ${sessionId} is already loaded.`);
    console.log("[DEBUG LOAD SESSION] state.cart.lockedItems.size:", state.cart.lockedItems.size);
    console.log("[DEBUG LOAD SESSION] state.eventDetails.combined.size:", state.eventDetails.combined.size);
    if (state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0) {
      console.log("[DEBUG LOAD SESSION] Firing sessionReady event (has locked items or event details)");
      document.dispatchEvent(new CustomEvent("sessionReady"));
    } else {
      console.log("[DEBUG LOAD SESSION] ⚠️ NOT firing sessionReady event (no locked items or event details)");
    }
    console.log("[DEBUG LOAD SESSION] ========== loadSessionFromAirtable END (early return - already loaded) ==========");
    return;
  }
  console.log("[DEBUG LOAD SESSION] Setting state.session.id to:", sessionId);
  state.session.id = sessionId;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  console.log("[DEBUG LOAD SESSION] Airtable fetch URL:", url);
  log("API", `Loading session from URL: ${url}`);
  try {
    console.log("[DEBUG LOAD SESSION] Making Airtable API fetch request...");
    const response = await fetch(url, { headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
    console.log("[DEBUG LOAD SESSION] Airtable response status:", response.status, response.statusText);
    if (!response.ok) {
      const errorData = await response.json();
      console.error("[DEBUG LOAD SESSION] ❌ Airtable error response:", errorData);
      console.error(`Airtable error fetching session ${sessionId}:`, errorData);
      throw new Error(`Could not fetch session data. Status: ${response.status}`);
    }
    const record = await response.json();
    console.log("[DEBUG LOAD SESSION] ✅ Airtable fetch successful");
    console.log("[DEBUG LOAD SESSION] Record ID:", record.id);
    console.log("[DEBUG LOAD SESSION] Record fields.Name:", (_a = record.fields) == null ? void 0 : _a.Name);
    console.log("[DEBUG] loadSessionFromAirtable - Fetched record from Airtable:", record.id);
    console.log("[DEBUG] loadSessionFromAirtable - Record Date field:", record.fields.Date);
    console.log("[DEBUG] loadSessionFromAirtable - Record Guest Count:", record.fields["Guest Count"]);
    console.log("[DEBUG] loadSessionFromAirtable - Record Goals:", record.fields.Goals);
    log("API", `Session loaded: ${record.fields.Name || "Unnamed Session"} (ID: ${sessionId})`);
    state.cart.items = /* @__PURE__ */ new Map();
    state.cart.lockedItems = /* @__PURE__ */ new Map();
    state.session.reactions = /* @__PURE__ */ new Map();
    state.session.userProfiles = /* @__PURE__ */ new Map();
    state.eventDetails.combined = /* @__PURE__ */ new Map();
    state.session.storeId = null;
    state.session.user.amountReceived = 0;
    state.session.user.paymentHistory = [];
    if (record.fields["Stores"] && record.fields["Stores"].length > 0) {
      state.session.storeId = record.fields["Stores"][0];
      log("API", `Session belongs to Store ID: ${state.session.storeId}`);
    } else {
      log("API", "Session not linked to a specific store (Shop Link field is empty).");
    }
    if (state.session.user.isAuthenticated && state.session.user.id) {
      const isCollaborator = (record.fields.Collaborators || []).includes(state.session.user.id);
      const isStoreOwner = state.session.user.isOwner;
      const ownedStoreId = state.session.user.ownedStoreId;
      const planStoreId = state.session.storeId;
      const isOwnerOfPlanStore = isStoreOwner && ownedStoreId && planStoreId === ownedStoreId;
      state.session.isOwned = isCollaborator || isOwnerOfPlanStore;
      log("API", `Authenticated user. Access level (isOwned): ${state.session.isOwned}`);
    } else {
      state.session.isOwned = false;
      log("API", `Unauthenticated user. Access level (isOwned): false`);
    }
    state.session.user.amountReceived = record.fields["Amount Received"] || 0;
    try {
      state.session.user.paymentHistory = JSON.parse(record.fields.PaymentHistory || "[]");
    } catch (e) {
      state.session.user.paymentHistory = [];
      console.warn(`Could not parse PaymentHistory for session ${sessionId}:`, record.fields.PaymentHistory);
    }
    log("API", `Loaded Amount Received: ${state.session.user.amountReceived}`);
    const sessionDataString = record.fields["Items with Variations"];
    console.log("[DEBUG] loadSessionFromAirtable - Items with Variations field exists:", !!sessionDataString);
    if (sessionDataString && sessionDataString.trim() !== "") {
      try {
        const savedState = JSON.parse(sessionDataString);
        console.log("[DEBUG] loadSessionFromAirtable - ========== EVENT DETAILS MAPPING DEBUG ==========");
        console.log("[DEBUG] loadSessionFromAirtable - Raw savedState.eventDetails (BEFORE normalization):", savedState.eventDetails);
        console.log("[DEBUG] loadSessionFromAirtable - Expected normalized keys: eventName, goals, date");
        console.log("[DEBUG] loadSessionFromAirtable - Actual keys received (may need normalization):", Object.keys(savedState.eventDetails || {}));
        console.log("[DEBUG] loadSessionFromAirtable - ===============================================");
        state.cart.items = new Map(Object.entries(savedState.ideasItems || savedState.favoritedItems || {}));
        state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems || {}));
        const reactionsObject = savedState.itemReactions || {};
        state.session.reactions = /* @__PURE__ */ new Map();
        for (const recordId in reactionsObject) {
          state.session.reactions.set(recordId, new Map(Object.entries(reactionsObject[recordId])));
        }
        state.session.userProfiles = new Map(Object.entries(savedState.userProfiles || {}));
        const rawEventDetails = savedState.eventDetails || savedState.favoritedDetails || {};
        const normalizedEventDetails = {};
        const keyMapping = {
          "Event Name": CONSTANTS.DETAIL_TYPES.EVENT_NAME,
          // 'eventName'
          "Goals": CONSTANTS.DETAIL_TYPES.GOALS,
          // 'goals'
          "Date": CONSTANTS.DETAIL_TYPES.DATE,
          // 'date'
          // Also handle already-correct camelCase keys
          "eventName": CONSTANTS.DETAIL_TYPES.EVENT_NAME,
          "goals": CONSTANTS.DETAIL_TYPES.GOALS,
          "date": CONSTANTS.DETAIL_TYPES.DATE,
          "guestCount": CONSTANTS.DETAIL_TYPES.GUEST_COUNT,
          "specialRequests": CONSTANTS.DETAIL_TYPES.SPECIAL_REQUESTS
        };
        console.log("[DEBUG] loadSessionFromAirtable - Normalizing eventDetails keys...");
        console.log("[DEBUG] loadSessionFromAirtable - Raw keys before normalization:", Object.keys(rawEventDetails));
        for (const [key, value] of Object.entries(rawEventDetails)) {
          const normalizedKey = keyMapping[key] || key;
          normalizedEventDetails[normalizedKey] = value;
          if (key !== normalizedKey) {
            console.log(`[DEBUG] loadSessionFromAirtable - Normalized key '${key}' -> '${normalizedKey}'`);
          }
        }
        console.log("[DEBUG] loadSessionFromAirtable - Normalized keys:", Object.keys(normalizedEventDetails));
        state.eventDetails.combined = new Map(Object.entries(normalizedEventDetails));
        console.log("[DEBUG] loadSessionFromAirtable - state.eventDetails.combined after normalization:", Object.fromEntries(state.eventDetails.combined));
        console.log("[DEBUG] loadSessionFromAirtable - CONSTANTS.DETAIL_TYPES.EVENT_NAME:", CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        console.log("[DEBUG] loadSessionFromAirtable - CONSTANTS.DETAIL_TYPES.GOALS:", CONSTANTS.DETAIL_TYPES.GOALS);
        console.log("[DEBUG] loadSessionFromAirtable - CONSTANTS.DETAIL_TYPES.DATE:", CONSTANTS.DETAIL_TYPES.DATE);
        console.log("[DEBUG] loadSessionFromAirtable - Event Name from state:", state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME));
        console.log("[DEBUG] loadSessionFromAirtable - Goals from state:", state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS));
        console.log("[DEBUG] loadSessionFromAirtable - Date from state:", state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE));
        state.session.itemPositions = new Map(Object.entries(savedState.itemPositions || {}));
        log("API", `Parsed session data: ${state.cart.items.size} ideas, ${state.cart.lockedItems.size} locked items, ${state.eventDetails.combined.size} details.`);
        const allItemIds = [
          ...Array.from(state.cart.lockedItems.keys()),
          ...Array.from(state.cart.items.keys())
        ];
        const missingItemIds = allItemIds.filter(
          (id) => !state.records.all.some((r) => r.id === id) && id.startsWith("rec")
          // Only fetch real Airtable IDs, not custom items
        );
        if (missingItemIds.length > 0) {
          log("API", `Found ${missingItemIds.length} ghost items in session, fetching...`);
          const ghostItems = await fetchGhostItems(missingItemIds);
          setState({ records: { ...state.records, archive: ghostItems } });
          log("API", `Stored ${ghostItems.length} ghost items in state.records.archive`);
        }
      } catch (jsonError) {
        log("API", `Failed to parse session JSON for ${sessionId}: ${jsonError.message}`);
        console.error("Session Data String:", sessionDataString);
        state.cart.items = /* @__PURE__ */ new Map();
        state.cart.lockedItems = /* @__PURE__ */ new Map();
        state.session.reactions = /* @__PURE__ */ new Map();
        state.session.userProfiles = /* @__PURE__ */ new Map();
        state.eventDetails.combined = /* @__PURE__ */ new Map();
        state.session.itemPositions = /* @__PURE__ */ new Map();
      }
    } else {
      log("API", `Session ${sessionId} has no 'Items with Variations' data.`);
    }
    if (state.session.user.isAuthenticated && state.session.user.id && !state.session.userProfiles.has(state.session.user.id)) {
      state.session.userProfiles.set(state.session.user.id, state.session.user.name || "User");
      log("API", "Added current authenticated user to session profiles.");
    }
    console.log("[DEBUG LOAD SESSION] ========== ABOUT TO FIRE sessionReady EVENT ==========");
    console.log("[DEBUG LOAD SESSION] Final state summary:");
    console.log("[DEBUG LOAD SESSION]   - state.session.id:", state.session.id);
    console.log("[DEBUG LOAD SESSION]   - state.cart.lockedItems.size:", state.cart.lockedItems.size);
    console.log("[DEBUG LOAD SESSION]   - state.cart.items.size:", state.cart.items.size);
    console.log("[DEBUG LOAD SESSION]   - state.eventDetails.combined:", Object.fromEntries(state.eventDetails.combined));
    console.log("[DEBUG LOAD SESSION]   - state.session.storeId:", state.session.storeId);
    console.log("[DEBUG LOAD SESSION]   - state.session.isOwned:", state.session.isOwned);
    console.log("[DEBUG LOAD SESSION] Dispatching sessionReady CustomEvent...");
    document.dispatchEvent(new CustomEvent("sessionReady"));
    console.log("[DEBUG LOAD SESSION] ✅ sessionReady event dispatched");
    log("API", `Finished loading session ${sessionId}. Fired sessionReady event.`);
    console.log("[DEBUG LOAD SESSION] ========== loadSessionFromAirtable END (success) ==========");
  } catch (error) {
    console.error("[DEBUG LOAD SESSION] ❌ CATCH BLOCK - Error loading session");
    console.error("[DEBUG LOAD SESSION] Error message:", error.message);
    console.error("[DEBUG LOAD SESSION] Full error:", error);
    console.error(`Failed to load session ${sessionId}:`, error);
    log("API", `Failed to load session: ${error.message}`);
    state.session.id = null;
    alert("Could not load the shared session. It might have been deleted or there was a network issue.");
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search.replace(/&?session=[^&]+/, ""));
    console.log("[DEBUG LOAD SESSION] ========== loadSessionFromAirtable END (error) ==========");
  }
}
async function updatePaymentHistory(sessionId, paymentHistory) {
  var _a;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  log("API", `Updating payment history for session ${sessionId}`);
  const historyArray = Array.isArray(paymentHistory) ? paymentHistory : [];
  const newTotal = historyArray.reduce((sum, p) => sum + (p.amount || 0), 0);
  const payload = {
    fields: {
      "Amount Received": newTotal,
      "PaymentHistory": JSON.stringify(historyArray, null, 2)
    }
  };
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Airtable API Error updating payment history: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    log("API", `Successfully updated payment history for session ${sessionId}. New total: ${newTotal}`);
    return await response.json();
  } catch (error) {
    console.error("Failed to update payment history:", error);
    log("API", `Failed to update payment history: ${error.message}`);
    return null;
  }
}
async function saveSessionToAirtable() {
  var _a;
  console.log("[SAVE DEBUG] ========== saveSessionToAirtable START ==========");
  console.log("[SAVE DEBUG] state.ui.activeShopId:", state.ui.activeShopId);
  console.log("[SAVE DEBUG] state.session.id:", state.session.id);
  const hasPlanData = state.cart.items.size > 0 || state.cart.lockedItems.size > 0;
  const hasDetails = state.eventDetails.combined.size > 0;
  const hasReactions = state.session.reactions.size > 0;
  const needsInitialSave = !state.session.id;
  console.log("[SAVE DEBUG] hasPlanData:", hasPlanData);
  console.log("[SAVE DEBUG] hasDetails:", hasDetails);
  console.log("[SAVE DEBUG] hasReactions:", hasReactions);
  console.log("[SAVE DEBUG] needsInitialSave:", needsInitialSave);
  if (!hasPlanData && !hasDetails && !hasReactions && !needsInitialSave) {
    log("API", "saveSessionToAirtable: No changes or data to save, skipping.");
    console.log("[SAVE DEBUG] Skipping save - no data");
    state.ui.saveState = "SAVED";
    if (typeof ui !== "undefined" && ui.updateSaveShareButton) {
      ui.updateSaveShareButton();
    }
    return false;
  }
  const sessionStatus = state.session.id ? `UPDATE (id: ${state.session.id})` : "CREATE (new session)";
  log("API", `saveSessionToAirtable: Triggered for ${sessionStatus}`);
  console.log("[SAVE DEBUG] Proceeding with save:", sessionStatus);
  state.ui.saveState = "SAVING";
  if (typeof ui !== "undefined" && ui.updateSaveShareButton) ui.updateSaveShareButton();
  const reactionsForSaving = {};
  for (const [recordId, userReactionsMap] of state.session.reactions.entries()) {
    reactionsForSaving[recordId] = Object.fromEntries(userReactionsMap);
  }
  const sessionData = {
    ideasItems: Object.fromEntries(state.cart.items),
    lockedInItems: Object.fromEntries(state.cart.lockedItems),
    itemReactions: reactionsForSaving,
    userProfiles: Object.fromEntries(state.session.userProfiles),
    eventDetails: Object.fromEntries(state.eventDetails.combined),
    itemPositions: Object.fromEntries(state.session.itemPositions)
  };
  const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `New Plan - ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`;
  const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
  console.log("[DEBUG] saveSessionToAirtable - Raw dateValue from state:", dateValue);
  console.log("[DEBUG] saveSessionToAirtable - Is dateValue an array?", Array.isArray(dateValue));
  let formattedDate = null;
  if (dateValue) {
    const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;
    console.log("[DEBUG] saveSessionToAirtable - dateToFormat:", dateToFormat);
    const dateObj = new Date(dateToFormat);
    console.log("[DEBUG] saveSessionToAirtable - dateObj:", dateObj);
    console.log("[DEBUG] saveSessionToAirtable - Is valid date?", !isNaN(dateObj.getTime()));
    if (!isNaN(dateObj.getTime())) {
      formattedDate = dateObj.toISOString().split("T")[0];
      console.log("[DEBUG] saveSessionToAirtable - formattedDate for Airtable:", formattedDate);
    }
  } else {
    console.log("[DEBUG] saveSessionToAirtable - No date value found in state");
  }
  const allUserIds = Array.from(state.session.userProfiles.keys());
  const validCollaboratorIds = allUserIds.filter((id) => id && typeof id === "string" && id.startsWith("rec"));
  if (state.session.user.isAuthenticated && state.session.user.id && !validCollaboratorIds.includes(state.session.user.id)) {
    validCollaboratorIds.push(state.session.user.id);
  }
  const storesValue = state.ui.activeShopId ? [state.ui.activeShopId] : null;
  console.log("[SAVE DEBUG] ========== STORES FIELD CONFIGURATION ==========");
  console.log("[SAVE DEBUG] state.ui.activeShopId:", state.ui.activeShopId);
  console.log("[SAVE DEBUG] storesValue being sent to Airtable:", storesValue);
  console.log("[SAVE DEBUG] storesValue type:", typeof storesValue);
  console.log("[SAVE DEBUG] storesValue is array?", Array.isArray(storesValue));
  console.log("[SAVE DEBUG] storesValue is null?", storesValue === null);
  if (storesValue && Array.isArray(storesValue)) {
    console.log("[SAVE DEBUG] storesValue array length:", storesValue.length);
    console.log("[SAVE DEBUG] storesValue array contents:", JSON.stringify(storesValue));
  }
  console.log("[SAVE DEBUG] ====================================================");
  console.log("[SAVE DEBUG] Locked items count:", state.cart.lockedItems.size);
  const fields = {
    "Name": sessionName,
    "Items with Variations": JSON.stringify(sessionData, null, 2),
    "Collaborators": validCollaboratorIds,
    "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null,
    "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null,
    // --- THIS IS THE FIX for "Shop Link" ---
    // Change "Shop Link" to the exact name from your Airtable Sessions table
    "Stores": storesValue
  };
  if (formattedDate) {
    fields["Date"] = formattedDate;
    console.log("[DEBUG] saveSessionToAirtable - Adding Date field to payload:", formattedDate);
  } else {
    console.log("[DEBUG] saveSessionToAirtable - NOT adding Date field to payload (no formatted date)");
  }
  console.log("[DEBUG] saveSessionToAirtable - Complete fields object being sent:", JSON.stringify(fields, null, 2));
  console.log("[DEBUG] saveSessionToAirtable - sessionData.eventDetails:", sessionData.eventDetails);
  const payload = { fields };
  const isUpdate = state.session.id !== null;
  console.log("[DEBUG] saveSessionToAirtable - isUpdate:", isUpdate, "session.id:", state.session.id);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : "");
  const method = isUpdate ? "PATCH" : "POST";
  try {
    const response = await fetch(url, {
      method,
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(isUpdate ? payload : { records: [payload] })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Airtable API Error saving session: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const result = await response.json();
    console.log("[SAVE DEBUG] ========== AIRTABLE RESPONSE ==========");
    console.log("[SAVE DEBUG] Full response:", isUpdate ? result : result.records[0]);
    if (!isUpdate && result.records && result.records.length > 0) {
      const newSessionId = result.records[0].id;
      const savedFields = result.records[0].fields;
      console.log("[SAVE DEBUG] ***** NEW SESSION CREATED *****");
      console.log("[SAVE DEBUG] Session ID:", newSessionId);
      console.log("[SAVE DEBUG] Saved Name:", savedFields == null ? void 0 : savedFields.Name);
      console.log("[SAVE DEBUG] Saved Date:", savedFields == null ? void 0 : savedFields.Date);
      console.log("[SAVE DEBUG] Saved Stores:", savedFields == null ? void 0 : savedFields.Stores);
      console.log("[SAVE DEBUG] Stores type:", typeof (savedFields == null ? void 0 : savedFields.Stores));
      console.log("[SAVE DEBUG] Stores is array?", Array.isArray(savedFields == null ? void 0 : savedFields.Stores));
      console.log("[SAVE DEBUG] Stores is null?", (savedFields == null ? void 0 : savedFields.Stores) === null);
      console.log("[SAVE DEBUG] Stores is undefined?", (savedFields == null ? void 0 : savedFields.Stores) === void 0);
      if (savedFields == null ? void 0 : savedFields.Stores) {
        console.log("[SAVE DEBUG] Stores value:", JSON.stringify(savedFields.Stores));
      } else {
        console.log("[SAVE DEBUG] ⚠️ WARNING: Stores field is NOT set in Airtable response!");
      }
      console.log("[SAVE DEBUG] ==========================================");
      state.session.id = newSessionId;
      state.session.isOwned = true;
      window.history.replaceState({}, document.title, `?session=${newSessionId}${window.location.search.includes("shopId") ? `&shopId=${state.ui.activeShopId}` : ""}`);
      log("API", `New session created with ID: ${newSessionId}`);
      if (state.session.user.isAuthenticated && state.session.user.id) {
        await associateSessionWithUser(newSessionId, state.session.user.id);
      }
      document.dispatchEvent(new CustomEvent("sessionReady"));
      document.dispatchEvent(new CustomEvent("planCreated"));
    } else if (isUpdate) {
      const savedFields = result.fields;
      console.log("[SAVE DEBUG] ***** SESSION UPDATED *****");
      console.log("[SAVE DEBUG] Session ID:", state.session.id);
      console.log("[SAVE DEBUG] Saved Name:", savedFields == null ? void 0 : savedFields.Name);
      console.log("[SAVE DEBUG] Saved Date:", savedFields == null ? void 0 : savedFields.Date);
      console.log("[SAVE DEBUG] Saved Stores:", savedFields == null ? void 0 : savedFields.Stores);
      console.log("[SAVE DEBUG] Stores type:", typeof (savedFields == null ? void 0 : savedFields.Stores));
      console.log("[SAVE DEBUG] Stores is array?", Array.isArray(savedFields == null ? void 0 : savedFields.Stores));
      console.log("[SAVE DEBUG] Stores is null?", (savedFields == null ? void 0 : savedFields.Stores) === null);
      console.log("[SAVE DEBUG] Stores is undefined?", (savedFields == null ? void 0 : savedFields.Stores) === void 0);
      if (savedFields == null ? void 0 : savedFields.Stores) {
        console.log("[SAVE DEBUG] Stores value:", JSON.stringify(savedFields.Stores));
      } else {
        console.log("[SAVE DEBUG] ⚠️ WARNING: Stores field is NOT set in Airtable response!");
      }
      console.log("[SAVE DEBUG] ==========================================");
      log("API", `Successfully updated session ${state.session.id}`);
    }
    state.ui.saveState = "SAVED";
    if (typeof ui !== "undefined" && ui.updateSaveShareButton) ui.updateSaveShareButton();
    return true;
  } catch (error) {
    console.error("Failed to save session:", error);
    log("API", `Failed to save session: ${error.message}`);
    state.ui.saveState = "ERROR";
    if (typeof ui !== "undefined" && ui.updateSaveShareButton) ui.updateSaveShareButton();
    alert(`Error saving your plan: ${error.message}. Please try refreshing the page and trying again.`);
    return false;
  }
}
async function fetchAllRecords() {
  let allRecords = [];
  let offset = null;
  const fieldsToFetch = [
    "Name",
    "Price",
    "Description",
    "Options",
    "Parent Item",
    "Status",
    "Pricing Type",
    "Headcount min",
    "Media Tags",
    "Curated Images",
    "Categories",
    "Subcategories",
    "iCal URL",
    "Lead Time (days)",
    "Item Type",
    "Stores",
    "RSVPs",
    "RSVPMaybe",
    "RSVPNo",
    "Date",
    "Time",
    "Chat Enabled",
    "Duration",
    "Capacity",
    "Location Details",
    "Additional Information",
    "Rankings",
    "AI_Profile",
    "LinkedSession"
  ];
  const fieldsQuery = fieldsToFetch.map((field) => `fields%5B%5D=${encodeURIComponent(field)}`).join("&");
  const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${fieldsQuery}`;
  log("API", `Fetching items URL (with fields): ${baseUrl}`);
  try {
    do {
      let url = baseUrl;
      if (offset) {
        url += `&offset=${offset}`;
      }
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Airtable Error fetching items (URL: ${url}): Status ${response.status}`, errorText);
        throw new Error(`Failed to fetch items from Airtable. Status: ${response.status}`);
      }
      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);
    log("API", `Total item records fetched: ${allRecords.length}`);
    if (allRecords.length > 0) {
      console.log("[API Debug] Fields received for first record:", Object.keys(allRecords[0].fields));
    } else {
      console.log("[API Debug] No records received from Airtable.");
    }
    return allRecords.filter((record) => record.fields && record.fields.Name);
  } catch (error) {
    console.error("Error fetching all item records:", error);
    throw error;
  }
}
async function fetchAllStores() {
  let records = [];
  let offset = null;
  const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE_NAME}?`;
  log("API", `Fetching stores from base URL: ${baseUrl}`);
  try {
    do {
      const url = offset ? `${baseUrl}&offset=${offset}` : baseUrl;
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
      });
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Airtable Error fetching stores:", errorData);
        throw new Error(`Failed to fetch stores from Airtable. Status: ${response.status}`);
      }
      const data = await response.json();
      records = records.concat(data.records);
      offset = data.offset;
    } while (offset);
    log("API", `Total stores fetched: ${records.length}`);
    return records.filter((record) => record.fields && record.fields.Name);
  } catch (error) {
    console.error("Error fetching all stores:", error);
    throw error;
  }
}
async function fetchCalendarForRecord(record) {
  if (!record || !record.fields) return [];
  const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
  if (!icalUrl) {
    log("API", `No iCal URL for record ${record.id}`);
    return [];
  }
  if (state.calendar.busyTimes.has(icalUrl)) {
    log("API", `Cache hit for iCal URL: ${icalUrl}`);
    return state.calendar.busyTimes.get(icalUrl);
  }
  log("API", `Fetching calendar for ${record.fields.Name} from URL: ${icalUrl}`);
  try {
    const proxyUrl = `/api/calendar?url=${encodeURIComponent(icalUrl)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Calendar proxy function error: ${response.status} ${response.statusText}`);
    }
    const busyTimes = await response.json();
    state.calendar.busyTimes.set(icalUrl, busyTimes);
    log("API", `Successfully fetched and cached ${busyTimes.length} busy times for ${icalUrl}`);
    return busyTimes;
  } catch (error) {
    console.error(`Failed to fetch/parse calendar for ${record.fields.Name} (${icalUrl}):`, error);
    state.calendar.busyTimes.set(icalUrl, []);
    return [];
  }
}
async function fetchImagesByTags(tags, retries = 2) {
  if (!tags || Array.isArray(tags) && tags.length === 0 || typeof tags === "string" && !tags.trim()) {
    log("API", "fetchImagesByTags: No valid tags provided.");
    return [];
  }
  try {
    let payload;
    if (Array.isArray(tags)) {
      const validTags = tags.map((t) => String(t).trim()).filter(Boolean);
      if (validTags.length === 0) return [];
      payload = { expression: validTags.map((tag) => `tags:\\"${tag}\\"`).join(" AND ") };
      log("API", `Fetching images by expression: ${payload.expression}`);
    } else {
      const tagName = String(tags).trim();
      if (!tagName) return [];
      payload = { tag: tagName };
      log("API", `Fetching images by single tag: ${tagName}`);
    }
    const response = await fetch("/.netlify/functions/cloudinary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (response.status === 429 && retries > 0) {
      log("API", `Cloudinary rate limit hit, retrying in 500ms... (${retries} retries left)`);
      await new Promise((res) => setTimeout(res, 500));
      return fetchImagesByTags(tags, retries - 1);
    }
    if (!response.ok) {
      console.warn(`Cloudinary proxy function error: ${response.status} ${response.statusText}`);
      try {
        console.warn("Cloudinary error body:", await response.text());
      } catch (e) {
      }
      return [];
    }
    const data = await response.json();
    if (!data.resources || data.resources.length === 0) {
      log("API", "No Cloudinary resources found for the given tags/expression.");
      return [];
    }
    const imageUrls = data.resources.map((image) => {
      let transformations = "c_fill,g_auto,w_600,h_520,f_jpg";
      if (image.format === "gif") {
        transformations = "c_fit,w_600,h_520";
      }
      const urlParts = image.secure_url.split("/upload/");
      if (urlParts.length === 2) {
        return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
      }
      return image.secure_url;
    });
    log("API", `Found ${imageUrls.length} images from Cloudinary.`);
    return imageUrls;
  } catch (error) {
    console.error("Failed to fetch from Cloudinary via proxy:", error);
    return [];
  }
}
async function fetchCuratedImagesByRecord(record) {
  var _a;
  const curatedLinks = record.fields[CONSTANTS.FIELD_NAMES.CURATED_IMAGES_LINK];
  if (!curatedLinks || !Array.isArray(curatedLinks) || curatedLinks.length === 0) {
    log("API", `Safety Exit: No curated image links found for item ${record.id}.`);
    return [];
  }
  log("API", `Fetching ${curatedLinks.length} curated images for item ${record.id}`);
  const formula = `OR(${curatedLinks.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  const sortParams = `&sort%5B0%5D%5Bfield%5D=isBestOf&sort%5B0%5D%5Bdirection%5D=desc`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${IMAGE_GALLERY_TABLE_NAME}?filterByFormula=${encodedFormula}${sortParams}&fields[]=ImageURL`;
  try {
    const response = await fetch(url, { headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Airtable fetch error for curated images: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const data = await response.json();
    if (!data.records || data.records.length === 0) {
      log("API", "No matching records found in Image_Gallery for curated links.");
      return [];
    }
    const imageUrls = data.records.map((r) => r.fields.ImageURL).filter(Boolean).map((url2) => {
      if (url2.includes("res.cloudinary.com") && url2.includes("/upload/")) {
        const parts = url2.split("/upload/");
        if (parts.length === 2 && !parts[1].startsWith("f_auto/")) {
          const transformations = "c_fill,g_auto,w_600,h_520,f_jpg";
          return `${parts[0]}/upload/${transformations}/${parts[1]}`;
        }
      }
      return url2;
    });
    log("API", `Successfully fetched and processed ${imageUrls.length} curated image URLs.`);
    return imageUrls;
  } catch (error) {
    console.error(`Error fetching curated images for item ${record.id}:`, error.message);
    return [];
  }
}
async function fetchImagesForRecord(record, allRecords, imageCache2) {
  if (!record || !record.id) return { imageUrls: [] };
  const cacheKey = record.id;
  if (imageCache2.has(cacheKey)) {
    return { imageUrls: imageCache2.get(cacheKey) };
  }
  const getDynamicFallbackUrl = (record2) => {
    const mediaTag = record2.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || "NO_TAG_DEFINED";
    const encodedTag = encodeURIComponent(`Failed Media Tag:
${mediaTag}`);
    const placeholderPublicID = "ww71meppejsewxsxr4x7";
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/w_600,h_520,c_fill,g_auto,co_rgb:808080/l_text:Arial_32_bold:${encodedTag},co_rgb:FFFFFF,b_rgb:00000080,g_center/${placeholderPublicID}.jpg`;
  };
  let imageUrls = [];
  imageUrls = await fetchCuratedImagesByRecord(record);
  if (!imageUrls || imageUrls.length === 0) {
    log("API", `No curated images found for ${record.id}, falling back to Media Tags.`);
    imageUrls = await fetchImagesByTags(record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]);
  }
  if (!imageUrls || imageUrls.length === 0) {
    log("API", `No images found for ${record.id} after all checks, using DYNAMIC fallback.`);
    imageUrls = [getDynamicFallbackUrl(record)];
  }
  imageCache2.set(cacheKey, imageUrls);
  return { imageUrls };
}
async function fetchChatMessages(sessionId) {
  var _a;
  if (!sessionId || !sessionId.startsWith("rec")) {
    log("API", "fetchChatMessages: Invalid or missing sessionId.");
    return [];
  }
  const formula = `FIND('${sessionId}', {SessionID_Rollup})`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch chat messages for session ${sessionId}: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const data = await response.json();
    log("API", `Fetched ${data.records.length} chat messages for session ${sessionId}.`);
    return data.records;
  } catch (error) {
    console.error(`Error fetching chat history for session ${sessionId}:`, error);
    return [];
  }
}
async function postChatMessage(sessionId, senderId, senderName, content) {
  var _a;
  if (!sessionId || !sessionId.startsWith("rec")) {
    console.error(`[API] postChatMessage Error: Invalid sessionId provided: "${sessionId}". Cannot save message.`);
    return;
  }
  if (!content || !content.trim()) {
    log("API", "postChatMessage: Attempted to send empty message.");
    return;
  }
  const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
  const payload = {
    records: [{
      fields: {
        SessionID: [sessionId],
        SenderID: senderId,
        SenderName: senderName,
        Content: content.trim()
      }
    }]
  };
  try {
    log("API", `Posting chat message to session ${sessionId} from ${senderName}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Airtable API Error posting message: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const result = await response.json();
    const newMessageRecordId = result.records[0].id;
    log("API", `Chat message saved with record ID: ${newMessageRecordId}`);
    if (newMessageRecordId) {
      const notificationPromises = [
        fetch("/api/send-notification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: newMessageRecordId })
        }).catch((err) => console.error("SMS notification trigger failed:", err)),
        fetch("/api/send-email-notification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: newMessageRecordId })
        }).catch((err) => console.error("Email notification trigger failed:", err)),
        fetch("/api/send-chat-to-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: newMessageRecordId })
        }).catch((err) => console.error("Admin chat notification trigger failed:", err))
      ];
      await Promise.allSettled(notificationPromises);
      log("API", `Triggered all notifications for message ${newMessageRecordId}.`);
    }
  } catch (error) {
    console.error("CRITICAL: Failed to save chat message to database.", error);
    if (typeof ui !== "undefined" && ui.showToast) {
      ui.showToast(`Error: Could not send message. ${error.message}`);
    } else {
      alert(`Could not save message: ${error.message}`);
    }
  }
}
async function fetchItemChatMessages(itemId) {
  var _a;
  if (!itemId || !itemId.startsWith("rec")) {
    log("API", "fetchItemChatMessages: Invalid or missing itemId.");
    return [];
  }
  const formula = `FIND('${itemId}', ARRAYJOIN({Item Link}))`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch item chat messages for ${itemId}: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const data = await response.json();
    log("API", `Fetched ${data.records.length} item chat messages for ${itemId}.`);
    return data.records;
  } catch (error) {
    console.error(`Error fetching item chat history for ${itemId}:`, error);
    return [];
  }
}
async function postItemChatMessage(itemId, senderId, senderName, content) {
  var _a;
  if (!itemId || !itemId.startsWith("rec")) {
    console.error(`[API] postItemChatMessage Error: Invalid itemId provided: "${itemId}".`);
    return;
  }
  if (!content || !content.trim()) {
    log("API", "postItemChatMessage: Attempted to send empty message.");
    return;
  }
  const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
  const payload = {
    records: [{
      fields: {
        "Item Link": [itemId],
        // Corrected field name 'Item Link'
        SenderID: senderId,
        SenderName: senderName,
        Content: content.trim()
      }
    }]
  };
  try {
    log("API", `Posting item chat message to item ${itemId} from ${senderName}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to post item chat message to Airtable: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const result = await response.json();
    const newMessageRecordId = result.records[0].id;
    log("API", `Successfully posted item chat message for ${itemId}. Message ID: ${newMessageRecordId}`);
    fetch("/api/notify-rsvp-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId: newMessageRecordId })
    }).catch((err) => console.error("RSVP user notification trigger failed:", err));
  } catch (error) {
    console.error(`Error posting item chat message for ${itemId}:`, error);
    if (typeof ui !== "undefined" && ui.showToast) {
      ui.showToast(`Error: Could not send message. ${error.message}`);
    }
  }
}
async function banUser(userId) {
  log("API", `[MODERATION] Simulating API call to ban user: ${userId}`);
  state.session.bannedUsers.add(userId);
}
async function updateUserFlagStatus(userId, isFlagged) {
  log("API", `[MODERATION] Simulating API call to update flag for user: ${userId} to ${isFlagged}`);
  if (isFlagged) {
    state.session.flaggedUsers.add(userId);
  } else {
    state.session.flaggedUsers.delete(userId);
  }
}
async function fetchRecentChats(userId, limit = 10) {
  var _a, _b, _c;
  if (!userId) {
    log("API", "fetchRecentChats: No userId provided.");
    return [];
  }
  const formula = `{SenderID} = '${userId}'`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=100`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch recent chats: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || response.statusText}`);
    }
    const data = await response.json();
    log("API", `Fetched ${data.records.length} messages for recent chats.`);
    const conversationsMap = /* @__PURE__ */ new Map();
    for (const record of data.records) {
      const fields = record.fields;
      const sessionIds = fields.SessionID || [];
      const itemLinks = fields["Item Link"] || [];
      let conversationId = null;
      let conversationType = null;
      if (sessionIds.length > 0) {
        conversationId = sessionIds[0];
        conversationType = "session";
      } else if (itemLinks.length > 0) {
        conversationId = itemLinks[0];
        conversationType = "item";
      }
      if (conversationId && !conversationsMap.has(conversationId)) {
        conversationsMap.set(conversationId, {
          id: conversationId,
          type: conversationType,
          lastMessage: fields.Content || "",
          lastMessageTime: fields.Timestamp || (/* @__PURE__ */ new Date()).toISOString(),
          senderName: fields.SenderName || "Unknown"
        });
      }
    }
    const recentChats = Array.from(conversationsMap.values()).slice(0, limit);
    for (const chat of recentChats) {
      if (chat.type === "session") {
        try {
          const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${chat.id}`;
          const sessionResponse = await fetch(sessionUrl, {
            headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
          });
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            chat.name = ((_b = sessionData.fields) == null ? void 0 : _b.Name) || "Session Chat";
          } else {
            chat.name = "Session Chat";
          }
        } catch (e) {
          chat.name = "Session Chat";
        }
      } else if (chat.type === "item") {
        try {
          const itemUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${chat.id}`;
          const itemResponse = await fetch(itemUrl, {
            headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
          });
          if (itemResponse.ok) {
            const itemData = await itemResponse.json();
            chat.name = ((_c = itemData.fields) == null ? void 0 : _c.Name) || "Item Chat";
          } else {
            chat.name = "Item Chat";
          }
        } catch (e) {
          chat.name = "Item Chat";
        }
      }
    }
    return recentChats;
  } catch (error) {
    console.error("Error fetching recent chats:", error);
    return [];
  }
}
async function updateRsvpForEvent(eventId, userId, rsvpType) {
  var _a;
  if (!eventId || !userId) {
    log("API", "updateRsvpForEvent: Missing eventId or userId.");
    return null;
  }
  log("API", `Updating RSVP for user ${userId} to event ${eventId} with type: ${rsvpType}`);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;
  try {
    const getResponse = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!getResponse.ok) {
      if (getResponse.status === 404) throw new Error(`Event ${eventId} not found.`);
      throw new Error(`Could not fetch the event to update RSVPs. Status: ${getResponse.status}`);
    }
    const existingRecord = await getResponse.json();
    const rsvpYes = new Set(existingRecord.fields.RSVPs || []);
    const rsvpMaybe = new Set(existingRecord.fields.RSVPMaybe || []);
    const rsvpNo = new Set(existingRecord.fields.RSVPNo || []);
    rsvpYes.delete(userId);
    rsvpMaybe.delete(userId);
    rsvpNo.delete(userId);
    if (rsvpType === "yes") {
      rsvpYes.add(userId);
    } else if (rsvpType === "maybe") {
      rsvpMaybe.add(userId);
    } else if (rsvpType === "no") {
      rsvpNo.add(userId);
    }
    const rsvpPayload = {
      fields: {
        "RSVPs": Array.from(rsvpYes),
        "RSVPMaybe": Array.from(rsvpMaybe),
        "RSVPNo": Array.from(rsvpNo)
      }
    };
    const patchResponse = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(rsvpPayload)
    });
    if (!patchResponse.ok) {
      const errorData = await patchResponse.json();
      throw new Error(`Airtable API Error updating RSVPs: ${((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a.message) || patchResponse.statusText}`);
    }
    log("API", `Successfully updated RSVP for user ${userId} to event ${eventId}`);
    return await patchResponse.json();
  } catch (error) {
    console.error(`Failed to update RSVP for event ${eventId}:`, error);
    log("API", `Failed to update RSVP: ${error.message}`);
    if (typeof ui !== "undefined" && ui.showToast) {
      ui.showToast(`RSVP Error: ${error.message}`);
    }
    return null;
  }
}
async function toggleUserLike(itemId) {
  if (!state.session.user.isAuthenticated || !state.session.user.id) {
    log("API", "User not authenticated. Cannot toggle like.");
    throw new Error("You must be logged in to like items.");
  }
  const token = localStorage.getItem("jwt");
  if (!token) {
    log("API", "JWT token not found. Cannot toggle like.");
    throw new Error("Authentication token missing.");
  }
  log("API", `Toggling like for item ${itemId} via update-user-prefs`);
  try {
    const response = await fetch("/api/update-user-prefs", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      // Send the 'action' and 'itemId'
      body: JSON.stringify({
        action: "toggle-like",
        itemId
      })
    });
    if (!response.ok) {
      let errorText = response.statusText;
      try {
        const errorData = await response.json();
        errorText = errorData.error || errorText;
      } catch (e) {
        log("API", "Could not parse error response as JSON.");
      }
      throw new Error(errorText || `Failed to toggle like (Status: ${response.status})`);
    }
    const result = await response.json();
    log("API", `Successfully toggled like for item ${itemId}. New status: ${result.liked ? "Liked" : "Unliked"}`);
    return result;
  } catch (error) {
    console.error("Error toggling like:", error);
    log("API", `Failed to toggle like: ${error.message}`);
    throw error;
  }
}
async function fetchGhostItems(recordIds) {
  if (!recordIds || recordIds.length === 0) {
    return [];
  }
  const validIds = recordIds.filter((id) => id && id.startsWith("rec"));
  if (validIds.length === 0) {
    return [];
  }
  const formula = `OR(${validIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodedFormula}`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Airtable Error fetching ghost items:", errorText);
      return [];
    }
    const data = await response.json();
    log("API", `Fetched ${data.records.length} ghost items`);
    return data.records;
  } catch (error) {
    console.error("Error fetching ghost items:", error);
    return [];
  }
}
async function publishSessionAsEvent(sessionId, eventData) {
  if (!sessionId) {
    throw new Error("Session ID is required to publish as event");
  }
  const session = await fetchSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  const linkedItemId = session.fields.LinkedItem ? session.fields.LinkedItem[0] : null;
  let formattedDateOnly = null;
  let formattedDateTime = null;
  const dateValue = eventData.Date || session.fields.Date;
  if (dateValue) {
    const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;
    if (typeof dateToFormat === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateToFormat)) {
      formattedDateOnly = dateToFormat;
      formattedDateTime = `${dateToFormat}T12:00:00.000Z`;
    } else if (typeof dateToFormat === "string" && dateToFormat.includes("T")) {
      formattedDateTime = dateToFormat;
      formattedDateOnly = dateToFormat.split("T")[0];
    } else {
      const dateObj = new Date(dateToFormat);
      if (!isNaN(dateObj.getTime())) {
        formattedDateTime = dateObj.toISOString();
        formattedDateOnly = formattedDateTime.split("T")[0];
      }
    }
  }
  const itemFields = {
    "Name": eventData.Name || session.fields.Name || "Untitled Event",
    "Description": eventData.Description || session.fields.Goals || "",
    "Item Type": "Event",
    "Status": "Available",
    "LinkedSession": [sessionId]
    // Link back to the session
    // Note: Goals and Guest Count exist in Sessions table, not Items table
    // They are stored in the linked Session record
  };
  if (formattedDateOnly) {
    itemFields["Date"] = formattedDateOnly;
  }
  let itemRecord;
  if (linkedItemId) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${linkedItemId}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: itemFields })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to update event:", errorText);
      throw new Error(`Failed to update event: ${errorText}`);
    }
    itemRecord = await response.json();
    log("API", `Updated event ${linkedItemId} from session ${sessionId}`);
  } else {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: itemFields })
    });
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 422 && errorText.toLowerCase().includes("date")) {
        const itemFieldsWithoutDate = { ...itemFields };
        delete itemFieldsWithoutDate["Date"];
        const retryResponse = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fields: itemFieldsWithoutDate })
        });
        if (!retryResponse.ok) {
          const retryErrorText = await retryResponse.text();
          throw new Error(`Failed to create event even without Date field: ${retryErrorText}`);
        }
        itemRecord = await retryResponse.json();
        log("API", `Created event ${itemRecord.id} from session ${sessionId} (without date)`);
      } else {
        throw new Error(`Failed to create event: ${errorText}`);
      }
    } else {
      itemRecord = await response.json();
      log("API", `Created event ${itemRecord.id} from session ${sessionId}`);
    }
    const updateSessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    await fetch(updateSessionUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: { "LinkedItem": [itemRecord.id] } })
    });
  }
  return itemRecord;
}
async function fetchSessionById(sessionId) {
  if (!sessionId) {
    return null;
  }
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Airtable Error fetching session:", errorText);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching session:", error);
    return null;
  }
}
async function createSessionFromEvent(eventId, eventRecord, storeId, userId) {
  console.log("[DEBUG createSessionFromEvent] ========== START ==========");
  console.log("[DEBUG createSessionFromEvent] eventId:", eventId);
  console.log("[DEBUG createSessionFromEvent] eventRecord:", eventRecord);
  console.log("[DEBUG createSessionFromEvent] eventRecord.fields:", eventRecord == null ? void 0 : eventRecord.fields);
  console.log("[DEBUG createSessionFromEvent] storeId:", storeId);
  console.log("[DEBUG createSessionFromEvent] userId:", userId);
  if (!eventId || !eventRecord) {
    throw new Error("Event ID and record are required");
  }
  const fields = eventRecord.fields || {};
  console.log("[DEBUG createSessionFromEvent] Event fields.Name:", fields.Name);
  console.log("[DEBUG createSessionFromEvent] Event fields.Description:", fields.Description);
  console.log("[DEBUG createSessionFromEvent] Event fields.Date:", fields.Date);
  let formattedDate = null;
  let isoDate = null;
  if (fields.Date) {
    const dateValue = Array.isArray(fields.Date) ? fields.Date[0] : fields.Date;
    console.log("[DEBUG createSessionFromEvent] Raw date value:", dateValue);
    const dateObj = new Date(dateValue);
    console.log("[DEBUG createSessionFromEvent] Parsed dateObj:", dateObj);
    console.log("[DEBUG createSessionFromEvent] Is valid date?", !isNaN(dateObj.getTime()));
    if (!isNaN(dateObj.getTime())) {
      formattedDate = dateObj.toISOString().split("T")[0];
      isoDate = dateObj.toISOString();
      console.log("[DEBUG createSessionFromEvent] formattedDate for Airtable Date field:", formattedDate);
      console.log("[DEBUG createSessionFromEvent] isoDate for eventDetails:", isoDate);
    }
  } else {
    console.log("[DEBUG createSessionFromEvent] No Date field in event record");
  }
  const sessionData = {
    ideasItems: {},
    lockedInItems: {},
    itemReactions: {},
    userProfiles: userId ? { [userId]: "Event Manager" } : {},
    eventDetails: {
      "eventName": fields.Name || "Untitled Event",
      "goals": fields.Description || ""
    },
    itemPositions: {}
  };
  if (isoDate) {
    sessionData.eventDetails["date"] = isoDate;
    console.log("[DEBUG createSessionFromEvent] Added date to eventDetails:", isoDate);
  }
  console.log("[DEBUG createSessionFromEvent] sessionData.eventDetails:", sessionData.eventDetails);
  console.log("[DEBUG createSessionFromEvent] Full sessionData:", JSON.stringify(sessionData, null, 2));
  const sessionFields = {
    "Name": fields.Name || "Untitled Event",
    "Items with Variations": JSON.stringify(sessionData, null, 2),
    "Collaborators": userId ? [userId] : [],
    "Goals": fields.Description || null,
    "Stores": storeId ? [storeId] : null,
    "LinkedItem": [eventId]
    // Link this session to the event
  };
  if (formattedDate) {
    sessionFields["Date"] = formattedDate;
  }
  console.log("[DEBUG createSessionFromEvent] sessionFields being sent to Airtable:", JSON.stringify(sessionFields, null, 2));
  console.log("[DEBUG createSessionFromEvent] Items with Variations JSON contains eventDetails:", sessionFields["Items with Variations"]);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}`;
  try {
    console.log("[DEBUG createSessionFromEvent] Sending POST request to create session...");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ records: [{ fields: sessionFields }] })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DEBUG createSessionFromEvent] Failed to create session:", errorText);
      throw new Error(`Failed to create session: ${errorText}`);
    }
    const result = await response.json();
    const newSession = result.records[0];
    console.log("[DEBUG createSessionFromEvent] Session created successfully!");
    console.log("[DEBUG createSessionFromEvent] New session ID:", newSession.id);
    console.log("[DEBUG createSessionFromEvent] New session fields:", newSession.fields);
    log("API", `Created session ${newSession.id} from event ${eventId}`);
    const updateEventUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;
    console.log("[DEBUG createSessionFromEvent] Updating event with LinkedSession reference...");
    await fetch(updateEventUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: { "LinkedSession": [newSession.id] } })
    });
    log("API", `Updated event ${eventId} with LinkedSession ${newSession.id}`);
    console.log("[DEBUG createSessionFromEvent] ========== END (SUCCESS) ==========");
    return newSession;
  } catch (error) {
    console.error("[DEBUG createSessionFromEvent] Error creating session from event:", error);
    console.log("[DEBUG createSessionFromEvent] ========== END (ERROR) ==========");
    throw error;
  }
}
function userHasPublishPermission() {
  const activeStore = state.stores.all.find((s) => s.id === state.ui.activeShopId);
  const currentUser2 = state.session.user;
  if (!activeStore || !currentUser2 || !currentUser2.id) {
    return false;
  }
  const allowedUsers = activeStore.fields.PublishPermission || [];
  return allowedUsers.includes(currentUser2.id);
}
async function fetchSessionByLinkedItem(eventId) {
  if (!eventId) {
    return null;
  }
  const formula = `FIND('${eventId}', ARRAYJOIN({LinkedItem}))`;
  const encodedFormula = encodeURIComponent(formula);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Airtable Error searching sessions by LinkedItem:", errorText);
      return null;
    }
    const data = await response.json();
    if (data.records && data.records.length > 0) {
      return data.records[0];
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching session by LinkedItem:", error);
    return null;
  }
}
async function fetchSessionContainingItem(itemId, storeId = null) {
  if (!itemId) {
    return null;
  }
  log("API", `Searching for sessions containing item ${itemId}...`);
  let formula;
  if (storeId) {
    formula = `FIND('${storeId}', ARRAYJOIN({Stores}))`;
  } else {
    formula = `TRUE()`;
  }
  const encodedFormula = encodeURIComponent(formula);
  const fieldsQuery = [
    "Name",
    "Items with Variations",
    "Stores",
    "Collaborators",
    "LinkedItem"
  ].map((field) => `fields%5B%5D=${encodeURIComponent(field)}`).join("&");
  const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${PERSONAL_ACCESS_TOKEN}` }
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Airtable Error searching sessions for item:", errorText);
      return null;
    }
    const data = await response.json();
    if (data.records && data.records.length > 0) {
      for (const session of data.records) {
        const itemsWithVariations = session.fields["Items with Variations"];
        if (itemsWithVariations) {
          try {
            const sessionData = JSON.parse(itemsWithVariations);
            const lockedInItems = sessionData.lockedInItems || {};
            const ideasItems = sessionData.ideasItems || {};
            if (lockedInItems[itemId] || ideasItems[itemId]) {
              log("API", `Found item ${itemId} in session ${session.id} (${session.fields.Name})`);
              return session;
            }
          } catch (e) {
            console.warn("Could not parse Items with Variations for session:", session.id, e);
          }
        }
      }
      log("API", `Item ${itemId} not found in any session's plan items`);
      return null;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching sessions containing item:", error);
    return null;
  }
}

// ui.js
var ui_exports = {};
__export(ui_exports, {
  applyCartLabels: () => applyCartLabels,
  batchUpdateCardIcons: () => batchUpdateCardIcons,
  checkAvailability: () => checkAvailability,
  createInteractiveCard: () => createInteractiveCard,
  debounce: () => debounce,
  displayReservedStatus: () => displayReservedStatus,
  flattenOptionGroups: () => flattenOptionGroups,
  generateSrcSet: () => generateSrcSet,
  getActiveImageTag: () => getActiveImageTag,
  getEffectiveMinQuantity: () => getEffectiveMinQuantity,
  getGroupPriceRange: () => getGroupPriceRange,
  getItemState: () => getItemState,
  getMainGetItemState: () => getMainGetItemState,
  getOptimizedImageUrl: () => getOptimizedImageUrl,
  getPlaceholderImage: () => getPlaceholderImage,
  getRecordDescription: () => getRecordDescription,
  getRecordPrice: () => getRecordPrice,
  getStripeContext: () => getStripeContext,
  getTempLikes: () => getTempLikes,
  handleFilterChipClear: () => handleFilterChipClear,
  hideCheckoutModal: () => hideCheckoutModal,
  hideDetailModal: () => hideDetailModal,
  hideItineraryModal: () => hideItineraryModal,
  hidePresentationView: () => hidePresentationView,
  initStateHelpers: () => initStateHelpers,
  initializeFooter: () => initializeFooter,
  initializeItemChat: () => initializeItemChat,
  initializeShareMenu: () => initializeShareMenu,
  invalidateTempLikesCache: () => invalidateTempLikesCache,
  loadFlatpickr: () => loadFlatpickr,
  loadScript: () => loadScript,
  loadSortable: () => loadSortable,
  loadStripe: () => loadStripe,
  observeLazyImages: () => observeLazyImages,
  parseOptions: () => parseOptions,
  populateMyPlansDropdown: () => populateMyPlansDropdown,
  renderRecords: () => renderRecords,
  renderSessionDropdown: () => renderSessionDropdown,
  setTempLikes: () => setTempLikes,
  setupItineraryEventListeners: () => setupItineraryEventListeners,
  setupPresentationEventListeners: () => setupPresentationEventListeners,
  showCheckoutModal: () => showCheckoutModal,
  showDetailModal: () => showDetailModal,
  showEventPlanNotification: () => showEventPlanNotification,
  showItineraryModal: () => showItineraryModal,
  showLoginPromptForLikes: () => showLoginPromptForLikes,
  showPresentationView: () => showPresentationView,
  showShopSwitcher: () => showShopSwitcher,
  showToast: () => showToast,
  toggleLoading: () => toggleLoading,
  updateCardButtonText: () => updateCardButtonText,
  updateCardIcon: () => updateCardIcon,
  updateCatalogHeader: () => updateCatalogHeader,
  updateEventPlanDateDisplay: () => updateEventPlanDateDisplay,
  updateEventPlanSection: () => updateEventPlanSection,
  updateFooter: () => updateFooter,
  updateHeader: () => updateHeader3,
  updateIdeasCarousel: () => updateIdeasCarousel,
  updateItemState: () => updateItemState,
  updateLockedItemState: () => updateLockedItemState,
  updateLockedItemStatusIcons: () => updateLockedItemStatusIcons,
  updateMobileBarAvailability: () => updateMobileBarAvailability,
  updateSidebarHeader: () => updateHeader2,
  updateTotalCost: () => updateTotalCost,
  updateUrl: () => updateUrl2,
  verifyNoDuplicateItems: () => verifyNoDuplicateItems
});

// availability.js
var AVAILABILITY_STATUS = {
  FULL: "full",
  PARTIAL: "partial",
  NONE: "none"
};
function getDayStatus(day, busyTimes, record) {
  const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const leadTimeDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1e3);
  if (day < leadTimeDate) {
    return { status: AVAILABILITY_STATUS.NONE, reason: `Unavailable due to ${leadTime} day lead time.` };
  }
  if (!busyTimes || busyTimes.length === 0) {
    return { status: AVAILABILITY_STATUS.FULL, reason: "Fully Available" };
  }
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  const busyPeriods = busyTimes.filter((busy) => {
    const busyStart = new Date(busy.start);
    const busyEnd = new Date(busy.end);
    return busyStart <= dayEnd && busyEnd >= dayStart;
  });
  if (busyPeriods.length === 0) {
    return { status: AVAILABILITY_STATUS.FULL, reason: "Fully Available" };
  }
  const totalMinutes = 24 * 60;
  let busyMinutes = 0;
  busyPeriods.forEach((busy) => {
    const start = new Date(Math.max(busy.start, dayStart));
    const end = new Date(Math.min(busy.end, dayEnd));
    const minutes = (end - start) / (1e3 * 60);
    busyMinutes += minutes;
  });
  const availablePercentage = (totalMinutes - busyMinutes) / totalMinutes * 100;
  if (availablePercentage > 50) {
    return { status: AVAILABILITY_STATUS.PARTIAL, reason: "Partially Available (some times are booked)." };
  } else {
    return { status: AVAILABILITY_STATUS.NONE, reason: "No availability today (all time slots are booked)." };
  }
}
function getRangeStatus(start, end, record, busyTimes) {
  const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const leadTimeCutoffDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1e3);
  if (end < leadTimeCutoffDate) {
    return { status: AVAILABILITY_STATUS.NONE, reason: `Unavailable due to ${leadTime} day lead time.` };
  }
  if (start < leadTimeCutoffDate) {
    const availableDate = leadTimeCutoffDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { status: AVAILABILITY_STATUS.PARTIAL, reason: `Partially available due to lead time. Becomes available on ${availableDate}.` };
  }
  if (checkAvailability(start, end, busyTimes) === false) {
    return { status: AVAILABILITY_STATUS.PARTIAL, reason: "Partially available. Some days or times within this period are booked." };
  }
  return { status: AVAILABILITY_STATUS.FULL, reason: "Fully available during this period." };
}
function checkAvailability(start, end, busyTimes) {
  if (!Array.isArray(busyTimes)) return true;
  for (const event of busyTimes) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    if (start < eventEnd && end > eventStart) {
      return false;
    }
  }
  return true;
}
function getAvailableSlotsForDay(day, busyTimes) {
  if (!busyTimes || busyTimes.length === 0) {
    return "8:00 AM - 5:00 PM";
  }
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  const availableSlots = [];
  let lastEnd = dayStart;
  busyTimes.sort((a, b) => new Date(a.start) - new Date(b.start));
  busyTimes.forEach((busy) => {
    const start = new Date(Math.max(busy.start, dayStart));
    const end = new Date(Math.min(busy.end, dayEnd));
    if (start > lastEnd) {
      availableSlots.push({
        start: lastEnd,
        end: start
      });
    }
    lastEnd = end > lastEnd ? end : lastEnd;
  });
  if (lastEnd < dayEnd) {
    availableSlots.push({
      start: lastEnd,
      end: dayEnd
    });
  }
  return availableSlots.map((slot) => {
    const startTime2 = new Date(slot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const endTime = new Date(slot.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${startTime2} - ${endTime}`;
  }).join("\n") || "No available slots";
}
async function getCombinedPlanStatus(date, lockedItems) {
  let overallStatus = AVAILABILITY_STATUS.FULL;
  for (const record of lockedItems) {
    if (record && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
      const busyTimes = await fetchCalendarForRecord(record);
      const status = getDayStatus(date, busyTimes, record).status;
      if (status === AVAILABILITY_STATUS.NONE) {
        return AVAILABILITY_STATUS.NONE;
      }
      if (status === AVAILABILITY_STATUS.PARTIAL) {
        overallStatus = AVAILABILITY_STATUS.PARTIAL;
      }
    }
  }
  return overallStatus;
}
function calculateMissingCategories() {
  const requiredCategories = {
    "Activities": false,
    "Food & Drink": false,
    // Key matches desired display
    "Venues": false,
    // Key matches desired display
    "Extras": false
  };
  for (const recordId of state.cart.lockedItems.keys()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    const itemCategories = (record.fields.Categories || "").toLowerCase();
    if (itemCategories.includes("activities")) {
      requiredCategories["Activities"] = true;
    }
    if (itemCategories.includes("food & drink") || // "Food & Drink"
    itemCategories.includes("food/drink") || // "Food/Drink" (from original data)
    itemCategories.includes("food") || // "Food"
    itemCategories.includes("drink")) {
      requiredCategories["Food & Drink"] = true;
    }
    if (itemCategories.includes("venues") || itemCategories.includes("venue")) {
      requiredCategories["Venues"] = true;
    }
    if (itemCategories.includes("extras")) {
      requiredCategories["Extras"] = true;
    }
  }
  let suggestions = [];
  for (const category in requiredCategories) {
    if (!requiredCategories[category]) {
      suggestions.push(category);
    }
  }
  return suggestions;
}
var ATTRIBUTE_TO_KEYWORDS_MAP = {
  // Vibe Attributes
  "Vibe.Energy": [
    "fun",
    "exciting",
    "social",
    "joy",
    "lively",
    "party",
    "active",
    "energetic",
    "fast",
    "upbeat",
    "loud",
    "dance",
    "dancing",
    "high-energy",
    "vibrant",
    "festive",
    "dynamic"
  ],
  "Vibe.Relaxation": [
    "calm",
    "quiet",
    "relaxing",
    "chill",
    "bonding",
    "mellow",
    "peaceful",
    "serene",
    "tranquil",
    "low-key",
    "casual",
    "unwind",
    "restful",
    "cozy",
    "spa",
    "mindfulness",
    "meditation"
  ],
  "Vibe.Novelty": [
    "unique",
    "silly",
    "goofy",
    "weird",
    "new",
    "different",
    "surprising",
    "unusual",
    "novel",
    "quirky",
    "unexpected",
    "strange",
    "bizarre",
    "zany",
    "wacky"
  ],
  "Vibe.Formality": [
    "celebration",
    "celebrate",
    "formal",
    "fancy",
    "executive",
    "luxury",
    "elegant",
    "sophisticated",
    "classy",
    "upscale",
    "premium",
    "corporate",
    "professional",
    "gala",
    "banquet"
  ],
  // Intellect Attributes
  "Intellect.Creative": [
    "creative",
    "art",
    "artistic",
    "design",
    "painting",
    "crafty",
    "crafts",
    "drawing",
    "diy",
    "hands-on",
    "build",
    "expressive",
    "music",
    "writing"
  ],
  "Intellect.Analytical": [
    "team-build",
    "team building",
    "challenging",
    "problem-solving",
    "smart",
    "puzzle",
    "puzzles",
    "logic",
    "strategy",
    "strategic",
    "escape room",
    "brainy",
    "intellectual",
    "trivia",
    "collaboration",
    "collaborative"
  ],
  // Physicality Attributes
  "Physicality.Intensity": [
    "competitive",
    "physical",
    "active",
    "intense",
    "sporty",
    "sports",
    "fitness",
    "hiking",
    "running",
    "outdoor",
    "outdoors",
    "adventure",
    "competition",
    "vs",
    "versus"
  ],
  // Pillar Attributes (for implicit goals & core needs)
  "Pillars.Activity": [
    "activities",
    "activity",
    "do",
    "something",
    "team"
  ],
  "Pillars.Food & Drink": [
    "food & drink",
    "food/drink",
    "food",
    "drink",
    "eat",
    "wine",
    "bar",
    "drinks",
    "cocktails",
    "beer",
    "catering",
    "restaurant",
    "lunch",
    "dinner",
    "snacks",
    "appetizers",
    "tacos",
    "pizza",
    "cuisine"
  ],
  "Pillars.Venues": [
    "venues",
    "venue",
    "place",
    "location",
    "space",
    "rent",
    "room"
  ],
  "Pillars.Extras": [
    "extras",
    "swag",
    "gifts",
    "photography",
    "transportation",
    "music",
    "dj",
    "entertainment",
    "decor"
  ]
};
function buildGoalBucket(sortBy) {
  var _a, _b, _c, _d;
  const goals = /* @__PURE__ */ new Set();
  const isRecommendedSort = sortBy === "recommended";
  const rawGoalText = ((_b = (_a = document.getElementById("header-goals")) == null ? void 0 : _a.value) == null ? void 0 : _b.toLowerCase()) || "";
  const STOP_WORDS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "the",
    "for",
    "with",
    "and",
    "is",
    "of",
    "to",
    "in",
    "on",
    "at",
    "my",
    "it",
    "big",
    "small",
    "all",
    "new",
    "old",
    "about",
    "want"
  ]);
  if (isRecommendedSort) {
    const missingCategories = calculateMissingCategories();
    missingCategories.forEach((cat) => goals.add(cat));
    if (rawGoalText.length > 2) {
      const words = rawGoalText.split(/[\s,]+/);
      words.forEach((word) => {
        if (word.length > 2 && !STOP_WORDS.has(word)) {
          goals.add(word);
        }
      });
    }
    const searchText = ((_d = (_c = document.getElementById("name-filter")) == null ? void 0 : _c.value) == null ? void 0 : _d.trim().toLowerCase()) || "";
    if (searchText.length > 2) {
      goals.add(searchText);
    }
  }
  return Array.from(goals);
}
function getProfileScore(profile, key) {
  var _a;
  if (!profile || !key) return 0;
  const keys = key.split(".");
  if (keys.length === 2) {
    return ((_a = profile[keys[0]]) == null ? void 0 : _a[keys[1]]) || 0;
  }
  return 0;
}
function calculateBasicSearchScore(record, searchTerm) {
  if (!searchTerm) return 0;
  const name = (record.fields.Name || "").toLowerCase();
  const description = (record.fields.Description || "").toLowerCase();
  const tags = (record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || "").toLowerCase();
  if (name.includes(searchTerm)) return 10;
  if (description.includes(searchTerm)) return 5;
  if (tags.includes(searchTerm)) return 3;
  return 0;
}
function calculateRecommendationScore(record, goalBucket) {
  var _a, _b;
  let finalScore = 0;
  if (goalBucket.length === 0) return 0;
  let profile;
  try {
    profile = JSON.parse(record.fields.AI_Profile || "{}");
    if (!profile.profileSource) throw new Error("Not a v2.1 profile.");
  } catch (e) {
    const currentSearchTerm = ((_b = (_a = document.getElementById("name-filter")) == null ? void 0 : _a.value) == null ? void 0 : _b.trim().toLowerCase()) || "";
    return calculateBasicSearchScore(record, currentSearchTerm);
  }
  const { Tags = [], ...attributes } = profile;
  const itemTags = new Set(Tags.map((t) => t.toLowerCase()));
  goalBucket.forEach((goal) => {
    const goalLower = goal.toLowerCase();
    let goalScored = false;
    for (const attributeKey in ATTRIBUTE_TO_KEYWORDS_MAP) {
      if (ATTRIBUTE_TO_KEYWORDS_MAP[attributeKey].includes(goalLower)) {
        const itemScoreForAttribute = getProfileScore(attributes, attributeKey);
        finalScore += itemScoreForAttribute;
        goalScored = true;
      }
    }
    if (!goalScored && itemTags.has(goalLower)) {
      const TAG_BONUS = 15;
      finalScore += TAG_BONUS;
    }
  });
  return finalScore;
}

// utils/tileSizingDebug.js
var TILE_DEBUG_PREFIX = "[TileSizing]";
var tileSizingDebugEnabled = false;
var EXPECTED_SIZES = {
  desktop: {
    gridCard: { minWidth: 320, maxWidth: "1fr" },
    carouselCard: { width: 320, minWidth: 320, maxWidth: 320 },
    imageContainer: { height: 200, aspectRatio: "3 / 2.6" },
    gap: 25,
    carouselGap: 20
  },
  tablet: {
    carouselCard: { width: 280, minWidth: 280, maxWidth: 280 }
  },
  mobile: {
    carouselCard: { width: "calc(100vw - 70px)", minWidth: 280 }
  }
};
function enableTileSizingDebug() {
  tileSizingDebugEnabled = true;
  console.log(`${TILE_DEBUG_PREFIX} Debug mode ENABLED`);
  console.log(`${TILE_DEBUG_PREFIX} Available commands:`);
  console.log(`  - window.auditTileSizing() - Run full sizing audit`);
  console.log(`  - window.getTileSizingReport() - Get detailed report`);
  console.log(`  - window.debugTile(recordId) - Debug specific tile`);
  console.log(`  - window.disableTileSizingDebug() - Disable debug mode`);
  return true;
}
function disableTileSizingDebug() {
  tileSizingDebugEnabled = false;
  console.log(`${TILE_DEBUG_PREFIX} Debug mode DISABLED`);
  return false;
}
function logTileSizing(category, message, data = null) {
  if (!tileSizingDebugEnabled) return;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().split("T")[1].slice(0, 12);
  const prefix = `${TILE_DEBUG_PREFIX}[${category}][${timestamp}]`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}
function getViewportInfo() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    breakpoint: window.innerWidth <= 768 ? "mobile" : window.innerWidth <= 1024 ? "tablet" : "desktop",
    orientation: window.innerWidth > window.innerHeight ? "landscape" : "portrait"
  };
}
function getElementSizing(element) {
  if (!element) return null;
  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    // Computed dimensions
    width: computed.width,
    height: computed.height,
    minWidth: computed.minWidth,
    maxWidth: computed.maxWidth,
    minHeight: computed.minHeight,
    maxHeight: computed.maxHeight,
    // Bounding rect (actual rendered size)
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    // Flex properties
    flex: computed.flex,
    flexBasis: computed.flexBasis,
    flexGrow: computed.flexGrow,
    flexShrink: computed.flexShrink,
    // Grid properties
    gridColumn: computed.gridColumn,
    gridRow: computed.gridRow,
    // Box model
    padding: computed.padding,
    margin: computed.margin,
    boxSizing: computed.boxSizing,
    // Position
    position: computed.position,
    display: computed.display,
    // Aspect ratio
    aspectRatio: computed.aspectRatio
  };
}
function debugTile(recordId) {
  const tile = document.querySelector(`.event-card[data-record-id="${recordId}"]`);
  if (!tile) {
    console.warn(`${TILE_DEBUG_PREFIX} Tile not found for record ID: ${recordId}`);
    return null;
  }
  const sizing = getElementSizing(tile);
  const imageContainer = tile.querySelector(".event-card-image-container");
  const content = tile.querySelector(".event-card-content");
  const footer = tile.querySelector(".card-footer");
  const report = {
    recordId,
    tileType: getTileType(tile),
    inCarousel: isInCarousel(tile),
    viewport: getViewportInfo(),
    tile: sizing,
    imageContainer: imageContainer ? getElementSizing(imageContainer) : null,
    content: content ? getElementSizing(content) : null,
    footer: footer ? getElementSizing(footer) : null,
    issues: detectSizingIssues(tile, sizing)
  };
  console.log(`${TILE_DEBUG_PREFIX} Tile Debug Report:`, report);
  return report;
}
function getTileType(element) {
  if (element.classList.contains("grouping-card")) return "Grouping";
  if (element.classList.contains("event-type-card")) return "Event";
  if (element.classList.contains("skeleton-card")) return "Skeleton";
  return "BookableItem";
}
function isInCarousel(element) {
  return !!element.closest(".grouping-carousel-container");
}
function detectSizingIssues(tile, sizing) {
  const issues = [];
  const viewport = getViewportInfo();
  const inCarousel = isInCarousel(tile);
  if (sizing.renderedWidth <= 0) {
    issues.push({ severity: "error", message: "Tile has zero or negative width" });
  }
  if (sizing.renderedHeight <= 0) {
    issues.push({ severity: "error", message: "Tile has zero or negative height" });
  }
  if (inCarousel) {
    const expectedWidth = viewport.breakpoint === "mobile" ? 280 : viewport.breakpoint === "tablet" ? 280 : 320;
    if (Math.abs(sizing.renderedWidth - expectedWidth) > 5) {
      issues.push({
        severity: "warning",
        message: `Carousel card width (${sizing.renderedWidth}px) differs from expected (${expectedWidth}px)`,
        expected: expectedWidth,
        actual: sizing.renderedWidth
      });
    }
  }
  const imageContainer = tile.querySelector(".event-card-image-container");
  if (imageContainer) {
    const imgSizing = getElementSizing(imageContainer);
    if (imgSizing.renderedHeight < 180 || imgSizing.renderedHeight > 220) {
      issues.push({
        severity: "warning",
        message: `Image container height (${imgSizing.renderedHeight}px) outside expected range (180-220px)`,
        actual: imgSizing.renderedHeight
      });
    }
  }
  if (tile.scrollWidth > tile.clientWidth) {
    issues.push({
      severity: "warning",
      message: "Tile has horizontal overflow",
      scrollWidth: tile.scrollWidth,
      clientWidth: tile.clientWidth
    });
  }
  return issues;
}
function auditTileSizing() {
  console.log(`${TILE_DEBUG_PREFIX} ========== TILE SIZING AUDIT ==========`);
  const viewport = getViewportInfo();
  console.log(`${TILE_DEBUG_PREFIX} Viewport:`, viewport);
  const catalogContainer = document.getElementById("catalog-container");
  if (catalogContainer) {
    console.log(`${TILE_DEBUG_PREFIX} Catalog Container:`, getElementSizing(catalogContainer));
    console.log(
      `${TILE_DEBUG_PREFIX} Catalog Container has carousel sections:`,
      catalogContainer.querySelector(".grouping-carousel-section") !== null
    );
  }
  const allTiles = document.querySelectorAll(".event-card");
  const tileAudit = {
    total: allTiles.length,
    byType: {
      BookableItem: 0,
      Event: 0,
      Grouping: 0,
      Skeleton: 0
    },
    inCarousel: 0,
    inGrid: 0,
    withIssues: 0,
    issues: []
  };
  allTiles.forEach((tile, index) => {
    const tileType = getTileType(tile);
    tileAudit.byType[tileType]++;
    if (isInCarousel(tile)) {
      tileAudit.inCarousel++;
    } else {
      tileAudit.inGrid++;
    }
    const sizing = getElementSizing(tile);
    const issues = detectSizingIssues(tile, sizing);
    if (issues.length > 0) {
      tileAudit.withIssues++;
      tileAudit.issues.push({
        index,
        recordId: tile.dataset.recordId,
        tileType,
        inCarousel: isInCarousel(tile),
        sizing: {
          width: sizing.renderedWidth,
          height: sizing.renderedHeight
        },
        issues
      });
    }
  });
  console.log(`${TILE_DEBUG_PREFIX} Tile Audit Summary:`, tileAudit);
  const carouselSections = document.querySelectorAll(".grouping-carousel-section");
  console.log(`${TILE_DEBUG_PREFIX} Carousel Sections: ${carouselSections.length}`);
  carouselSections.forEach((section, index) => {
    const container = section.querySelector(".grouping-carousel-container");
    const cards = section.querySelectorAll(".event-card");
    console.log(`${TILE_DEBUG_PREFIX} Carousel ${index}:`, {
      groupingId: section.dataset.groupingId,
      categoryName: section.dataset.categoryName,
      cardCount: cards.length,
      containerSizing: container ? getElementSizing(container) : null,
      hasOverflow: container ? container.scrollWidth > container.clientWidth : false
    });
  });
  const ungroupedSection = document.querySelector(".ungrouped-items-section");
  if (ungroupedSection) {
    const cards = ungroupedSection.querySelectorAll(".event-card");
    console.log(`${TILE_DEBUG_PREFIX} Ungrouped Items Section:`, {
      cardCount: cards.length,
      sizing: getElementSizing(ungroupedSection)
    });
  }
  console.log(`${TILE_DEBUG_PREFIX} ========== END AUDIT ==========`);
  return tileAudit;
}
function getTileSizingReport() {
  const report = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    viewport: getViewportInfo(),
    expectedSizes: EXPECTED_SIZES,
    catalogContainer: null,
    tiles: [],
    carousels: [],
    issues: []
  };
  const catalogContainer = document.getElementById("catalog-container");
  if (catalogContainer) {
    report.catalogContainer = {
      sizing: getElementSizing(catalogContainer),
      hasCarouselLayout: catalogContainer.querySelector(".grouping-carousel-section") !== null,
      childCount: catalogContainer.children.length
    };
  }
  const allTiles = document.querySelectorAll(".event-card");
  allTiles.forEach((tile) => {
    const sizing = getElementSizing(tile);
    const issues = detectSizingIssues(tile, sizing);
    report.tiles.push({
      recordId: tile.dataset.recordId,
      tileType: getTileType(tile),
      inCarousel: isInCarousel(tile),
      sizing: {
        width: sizing.renderedWidth,
        height: sizing.renderedHeight,
        flex: sizing.flex,
        minWidth: sizing.minWidth,
        maxWidth: sizing.maxWidth
      },
      hasIssues: issues.length > 0
    });
    if (issues.length > 0) {
      report.issues.push({
        recordId: tile.dataset.recordId,
        issues
      });
    }
  });
  const carouselSections = document.querySelectorAll(".grouping-carousel-section");
  carouselSections.forEach((section) => {
    const container = section.querySelector(".grouping-carousel-container");
    report.carousels.push({
      groupingId: section.dataset.groupingId,
      categoryName: section.dataset.categoryName,
      sizing: getElementSizing(section),
      containerSizing: container ? getElementSizing(container) : null,
      cardCount: section.querySelectorAll(".event-card").length
    });
  });
  console.log(`${TILE_DEBUG_PREFIX} Full Report:`, report);
  return report;
}
function logCardCreation(recordId, itemType, context = {}) {
  logTileSizing("CardCreate", `Creating ${itemType} card`, {
    recordId,
    itemType,
    ...context,
    viewport: getViewportInfo()
  });
}
function logRenderStart(recordCount, options = {}) {
  logTileSizing("Render", `Starting render of ${recordCount} records`, {
    recordCount,
    append: options.append || false,
    viewport: getViewportInfo(),
    catalogContainer: document.getElementById("catalog-container") ? getElementSizing(document.getElementById("catalog-container")) : null
  });
}
function logRenderComplete(recordCount, timeTaken = null) {
  logTileSizing("Render", `Completed rendering ${recordCount} records`, {
    recordCount,
    timeTaken: timeTaken ? `${timeTaken}ms` : "unknown",
    viewport: getViewportInfo()
  });
  if (tileSizingDebugEnabled) {
    setTimeout(() => {
      console.log(`${TILE_DEBUG_PREFIX} Post-render audit:`);
      auditTileSizing();
    }, 100);
  }
}
function logCarouselCreation(groupingName, childCount, context = {}) {
  logTileSizing("Carousel", `Creating carousel for "${groupingName}"`, {
    groupingName,
    childCount,
    ...context,
    viewport: getViewportInfo()
  });
}
function logLayoutMode(mode, reason = "") {
  logTileSizing("Layout", `Layout mode: ${mode}`, {
    mode,
    reason,
    viewport: getViewportInfo()
  });
}
var resizeDebounceTimer = null;
function setupResizeMonitoring() {
  window.addEventListener("resize", () => {
    if (!tileSizingDebugEnabled) return;
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      logTileSizing("Resize", "Window resized", getViewportInfo());
      const viewport = getViewportInfo();
      logTileSizing("Resize", `Current breakpoint: ${viewport.breakpoint}`);
    }, 250);
  });
}
if (typeof window !== "undefined") {
  window.enableTileSizingDebug = enableTileSizingDebug;
  window.disableTileSizingDebug = disableTileSizingDebug;
  window.auditTileSizing = auditTileSizing;
  window.getTileSizingReport = getTileSizingReport;
  window.debugTile = debugTile;
  window.getViewportInfo = getViewportInfo;
  setupResizeMonitoring();
}

// components/card.js
function getOptimizedImageUrl(url, width = 600, quality = "auto") {
  if (!url || !url.includes("cloudinary")) return url;
  const uploadIndex = url.indexOf("/upload/");
  if (uploadIndex === -1) return url;
  const transformations = `c_fill,w_${width},q_${quality},f_auto,fl_progressive`;
  return url.slice(0, uploadIndex + 8) + transformations + "/" + url.slice(uploadIndex + 8);
}
function generateSrcSet(url, baseWidth = 600) {
  if (!url || !url.includes("cloudinary")) return "";
  const sizes = [
    { width: Math.floor(baseWidth * 0.5), descriptor: "400w" },
    { width: baseWidth, descriptor: "600w" },
    { width: Math.floor(baseWidth * 1.5), descriptor: "900w" },
    { width: baseWidth * 2, descriptor: "1200w" }
  ];
  return sizes.map(({ width, descriptor }) => {
    const optimized = getOptimizedImageUrl(url, width);
    return `${optimized} ${descriptor}`;
  }).join(", ");
}
function getLowQualityPlaceholder(url) {
  if (!url || !url.includes("cloudinary")) return url;
  const uploadIndex = url.indexOf("/upload/");
  if (uploadIndex === -1) return url;
  const transformations = "c_fill,w_50,q_30,f_auto,e_blur:300";
  return url.slice(0, uploadIndex + 8) + transformations + "/" + url.slice(uploadIndex + 8);
}
function getPlaceholderImage(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) {
    return `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520,f_auto,q_auto/ww71meppejsewxsxr4x7.jpg`;
  }
  const randomIndex = Math.floor(Math.random() * imageUrls.length);
  return getOptimizedImageUrl(imageUrls[randomIndex], 600);
}
function updateCardIcon(recordId) {
  let isLiked = false;
  if (state.session.user.isAuthenticated) {
    isLiked = state.session.user.likedItemIds.has(recordId);
  } else {
    isLiked = getTempLikes().has(recordId);
  }
  const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
  const elements2 = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`);
  elements2.forEach((icon) => {
    if (!icon) return;
    if (isLiked) {
      icon.className = "heart-icon hearted";
      icon.title = "Unlike this item";
      icon.setAttribute("aria-label", "Unlike this item");
      icon.innerHTML = heartSVG;
      icon.style.display = "block";
      icon.style.pointerEvents = "auto";
    } else {
      icon.className = "heart-icon";
      icon.title = "Like this item";
      icon.setAttribute("aria-label", "Like this item");
      icon.innerHTML = heartSVG;
      icon.style.display = "block";
      icon.style.pointerEvents = "auto";
    }
  });
}
function batchUpdateCardIcons(recordIds) {
  const likedItems = state.session.user.isAuthenticated ? state.session.user.likedItemIds : getTempLikes();
  const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
  recordIds.forEach((recordId) => {
    const isLiked = likedItems.has(recordId);
    const elements2 = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`);
    elements2.forEach((icon) => {
      if (!icon) return;
      icon.className = isLiked ? "heart-icon hearted" : "heart-icon";
      icon.title = isLiked ? "Unlike this item" : "Like this item";
      icon.setAttribute("aria-label", isLiked ? "Unlike this item" : "Like this item");
      icon.innerHTML = heartSVG;
      icon.style.display = "block";
      icon.style.pointerEvents = "auto";
    });
  });
}
function updateCardButtonText(recordId, isLocked) {
  const cardButtons = document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .add-to-plan-btn`);
  const modalButton = document.getElementById("modal-add-to-plan-btn");
  cardButtons.forEach((btn) => {
    if (btn) {
      btn.textContent = isLocked ? "Update Plan" : "Add to Plan";
      btn.disabled = isLocked;
      btn.dataset.tooltip = isLocked ? "Update plan with changes" : "Add to plan";
    }
  });
  const modalOverlay2 = document.getElementById("detail-modal-overlay");
  if (modalButton && (modalOverlay2 == null ? void 0 : modalOverlay2.dataset.recordId) === recordId) {
    modalButton.textContent = isLocked ? "Update Plan" : "Add to Plan";
    modalButton.dataset.tooltip = isLocked ? "Update plan with changes" : "Add to plan";
  }
}
async function createInteractiveCard(record, allRecords, imageCache2) {
  log("Card", `Creating card for "${record.fields.Name}"`);
  const cardCreationStart = performance.now();
  const itemType = record.fields["Item Type"] || "Unknown";
  console.log("[TileSizing][Card] === CARD CREATION START ===");
  console.log("[TileSizing][Card] Creating card:", {
    recordId: record.id,
    name: record.fields.Name,
    itemType,
    viewport: getViewportInfo()
  });
  logCardCreation(record.id, itemType, { name: record.fields.Name });
  console.log("[createInteractiveCard] Creating card for record:", record.id, record.fields.Name);
  const eventCard = document.createElement("div");
  eventCard.dataset.recordId = record.id;
  const fields = record.fields;
  let partnerBadge = "";
  if (fields.ServiceType === "Partner Activity") {
    partnerBadge = '<span class="partner-badge">Partner</span>';
  }
  const scoreBanner = "";
  let imageUrlToLoad;
  if (record.id.startsWith("custom-") || record.id.startsWith("ai-search-")) {
    imageUrlToLoad = getPlaceholderImage([]);
  } else {
    const { imageUrls } = await fetchImagesForRecord(record, allRecords, imageCache2);
    imageUrlToLoad = getPlaceholderImage(imageUrls);
  }
  if (fields["Item Type"] === "Grouping") {
    console.log("[TileSizing][Card] Creating GROUPING card:", {
      recordId: record.id,
      name: fields.Name,
      expectedClasses: "event-card grouping-card"
    });
    const groupingCard = eventCard;
    groupingCard.className = "event-card grouping-card";
    groupingCard.dataset.categoryName = fields.Name;
    const groupingNameForFilter = fields.Name.toLowerCase().replace(/\s+/g, " ");
    const childItems = allRecords.filter((r) => {
      if (r.fields["Item Type"] !== "Bookable Item" && r.fields["Item Type"] !== "Event") return false;
      const itemCategories = (r.fields.Categories || "").split(",").map((cat) => cat.trim().toLowerCase().replace(/\s+/g, " "));
      return itemCategories.includes(groupingNameForFilter);
    });
    const imagePromises = childItems.slice(0, 4).map((item) => fetchImagesForRecord(item, allRecords, /* @__PURE__ */ new Map()));
    const imageResults = await Promise.all(imagePromises);
    const collageImages = imageResults.flatMap((res) => res.imageUrls);
    let imageContainerHTML = `<div class="event-card-image-container collage-container">`;
    if (collageImages.length > 0) {
      const optimizedImages = collageImages.slice(0, 4).map((url) => getOptimizedImageUrl(url, 300));
      imageContainerHTML += optimizedImages.map((url) => {
        const placeholder2 = getLowQualityPlaceholder(url);
        return `<div class="collage-image lazy-load" style="background-image: url('${placeholder2}')" data-bg-image="${url}"></div>`;
      }).join("");
    } else {
      const placeholder2 = getLowQualityPlaceholder(imageUrlToLoad);
      imageContainerHTML += `<div class="collage-image lazy-load" style="background-image: url('${placeholder2}')" data-bg-image="${imageUrlToLoad}"></div>`;
    }
    imageContainerHTML += `<div class="heart-icon" data-record-id="${record.id}"></div>`;
    imageContainerHTML += `<button class="availability-btn" title="Select a date range to check availability">\u{1F4C5}</button>`;
    imageContainerHTML += `</div>`;
    console.log("[createInteractiveCard] Grouping card HTML includes availability-btn:", imageContainerHTML.includes("availability-btn"));
    groupingCard.innerHTML = `
            ${imageContainerHTML}
            <div class="event-card-content">
                <h3>${fields.Name || "Untitled Category"}</h3>
                <p class="description">${fields.Description || ""}</p>
            </div>
            <div class="card-footer">
                <button class="card-action-btn view-options-btn">View Collection (${childItems.length})</button>
            </div>
        `;
    console.log("[createInteractiveCard] Grouping card created, checking for availability-btn");
    const availBtn = groupingCard.querySelector(".availability-btn");
    console.log("[createInteractiveCard] Grouping card availability-btn found:", !!availBtn, availBtn);
    const cardCreationEnd2 = performance.now();
    console.log("[TileSizing][Card] GROUPING card created:", {
      recordId: record.id,
      name: fields.Name,
      className: groupingCard.className,
      childItemCount: childItems.length,
      collageImageCount: collageImages.length,
      creationTime: (cardCreationEnd2 - cardCreationStart).toFixed(2) + "ms"
    });
    return groupingCard;
  }
  if (fields["Item Type"] === "Event") {
    console.log("[TileSizing][Card] Creating EVENT card:", {
      recordId: record.id,
      name: fields.Name,
      date: fields.Date,
      expectedClasses: "event-card event-type-card"
    });
    eventCard.className = "event-card event-type-card";
    const eventDate = fields.Date ? /* @__PURE__ */ new Date(fields.Date + "T00:00:00") : null;
    const month = eventDate ? eventDate.toLocaleString("default", { month: "short" }).toUpperCase() : "TBD";
    const day = eventDate ? eventDate.getDate() : "??";
    const hasRsvpd = (record.fields.RSVPs || []).includes(state.session.user.id);
    const hasLinkedSession = !!(fields.LinkedSession && fields.LinkedSession.length > 0);
    const userHasPublishAccess = userHasPublishPermission();
    let footerButtonsHTML = "";
    const buttonText = hasRsvpd ? "You're Going! ✅" : "RSVP";
    footerButtonsHTML = `<button class="card-action-btn rsvp-btn" ${hasRsvpd ? "disabled" : ""}>${buttonText}</button>`;
    if (userHasPublishAccess) {
      if (hasLinkedSession) {
        footerButtonsHTML += `
                    <button class="card-action-btn edit-event-btn" data-event-id="${record.id}" data-session-id="${fields.LinkedSession[0]}">Edit Event</button>
                `;
      } else {
        footerButtonsHTML += `
                    <button class="card-action-btn open-to-edit-btn" data-event-id="${record.id}">Open to Edit</button>
                `;
      }
    }
    const placeholder2 = getLowQualityPlaceholder(imageUrlToLoad);
    eventCard.innerHTML = `
            <div class="event-card-image-container lazy-load" style="background-image: url('${placeholder2}')" data-bg-image="${imageUrlToLoad}">
                <div class="heart-icon" data-record-id="${record.id}"></div>
                <button class="availability-btn" title="Select a date range to check availability">\u{1F4C5}</button>
                ${partnerBadge}
                ${scoreBanner}
            </div>
            <div class="event-card-content">
                <div class="event-date-display">
                    <span class="month">${month}</span>
                    <span class="day">${day}</span>
                </div>
                <div class="event-details">
                    <h3>${fields.Name || "Untitled Event"}</h3>
                    <p class="description">${fields.Description || ""}</p>
                </div>
            </div>
            <div class="card-footer">
                ${footerButtonsHTML}
            </div>
        `;
    console.log("[createInteractiveCard] Event card created, checking for availability-btn");
    const eventAvailBtn = eventCard.querySelector(".availability-btn");
    console.log("[createInteractiveCard] Event card availability-btn found:", !!eventAvailBtn, eventAvailBtn);
    const cardCreationEnd2 = performance.now();
    console.log("[TileSizing][Card] EVENT card created:", {
      recordId: record.id,
      name: fields.Name,
      className: eventCard.className,
      hasRsvpd,
      hasLinkedSession,
      userHasPublishAccess,
      eventDate: fields.Date,
      creationTime: (cardCreationEnd2 - cardCreationStart).toFixed(2) + "ms"
    });
    return eventCard;
  }
  console.log("[TileSizing][Card] Creating BOOKABLE ITEM card:", {
    recordId: record.id,
    name: fields.Name,
    expectedClasses: "event-card"
  });
  eventCard.className = "event-card";
  const itemState = getItemState(record.id);
  const effectiveMin = getEffectiveMinQuantity(record);
  const isLocked = state.cart.lockedItems.has(record.id);
  const quantitySelectorHTML = `<div class="quantity-selector"><button type="button" class="quantity-btn minus">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${effectiveMin}" step="1"><button type="button" class="quantity-btn plus">+</button></div>`;
  const displayPrice = getRecordPrice(record, itemState.selectedOptionIndex);
  const pricingType = fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
  const pricingTypeHTML = pricingType ? `<span class="pricing-type">/ ${pricingType.toLowerCase()}</span>` : "";
  const priceHTML = `$${displayPrice.toFixed(2)} ${pricingTypeHTML}`;
  const addToPlanBtnHTML = `<button class="card-action-btn add-to-plan-btn" ${isLocked ? "disabled" : ""}>${isLocked ? "Update Plan" : "Add to Plan"}</button>`;
  const placeholder = getLowQualityPlaceholder(imageUrlToLoad);
  eventCard.innerHTML = `
        <div class="event-card-image-container lazy-load" style="background-image: url('${placeholder}')" data-bg-image="${imageUrlToLoad}">
            <div class="heart-icon" data-record-id="${record.id}"></div>
            <button class="availability-btn" title="Select a date range to check availability">\u{1F4C5}</button>
            ${partnerBadge} 
            ${scoreBanner} 
            </div>
        <div class="event-card-content">
            <h3>${fields.Name || "Untitled Event"}</h3>
            <p class="description">${fields.Description || ""}</p>
        </div>
        <div class="card-footer">
            <div class="price-wrapper"><div class="price">${priceHTML}</div></div>
            <div class="actions-wrapper">${quantitySelectorHTML}${addToPlanBtnHTML}</div>
        </div>
    `;
  console.log("[createInteractiveCard] Standard card created, checking for availability-btn");
  const stdAvailBtn = eventCard.querySelector(".availability-btn");
  console.log("[createInteractiveCard] Standard card availability-btn found:", !!stdAvailBtn, stdAvailBtn);
  const plusBtn = eventCard.querySelector(".quantity-btn.plus");
  const minusBtn = eventCard.querySelector(".quantity-btn.minus");
  const quantityInput = eventCard.querySelector(".quantity-input");
  if (plusBtn && minusBtn && quantityInput) {
    const handlePlus = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const currentValue = parseInt(quantityInput.value, 10) || 1;
      quantityInput.value = currentValue + 1;
      quantityInput.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const handleMinus = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const currentValue = parseInt(quantityInput.value, 10) || 1;
      const minValue = parseInt(quantityInput.min, 10) || 1;
      if (currentValue > minValue) {
        quantityInput.value = currentValue - 1;
        quantityInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    const handleTouchEnd = (e) => {
      e.preventDefault();
      const handler = e.currentTarget === plusBtn ? handlePlus : handleMinus;
      handler(e);
    };
    plusBtn.addEventListener("click", handlePlus);
    plusBtn.addEventListener("touchend", handleTouchEnd, { passive: false });
    minusBtn.addEventListener("click", handleMinus);
    minusBtn.addEventListener("touchend", handleTouchEnd, { passive: false });
  }
  const cardCreationEnd = performance.now();
  console.log("[TileSizing][Card] BOOKABLE ITEM card created:", {
    recordId: record.id,
    name: fields.Name,
    className: eventCard.className,
    price: displayPrice,
    isLocked,
    creationTime: (cardCreationEnd - cardCreationStart).toFixed(2) + "ms"
  });
  console.log("[TileSizing][Card] === CARD CREATION COMPLETE ===");
  return eventCard;
}

// filtering.js
function parseCapacity(capacityStr) {
  if (!capacityStr || typeof capacityStr !== "string") return { min: 0, max: Infinity };
  if (capacityStr.includes("+")) {
    return { min: parseInt(capacityStr, 10) || 0, max: Infinity };
  }
  const parts = capacityStr.split("-").map((p) => parseInt(p, 10));
  return { min: parts[0] || 0, max: parts[1] || Infinity };
}
function filterByCategoryAndSubcategory(records, selectedCategory, activeSubcategories) {
  console.log("[FilterDebug] === filterByCategoryAndSubcategory START ===");
  console.log("[FilterDebug] selectedCategory:", selectedCategory);
  console.log("[FilterDebug] activeSubcategories:", activeSubcategories);
  console.log("[FilterDebug] Total records to filter:", records.length);
  if (selectedCategory === "all" || !selectedCategory) {
    console.log('[FilterDebug] Category is "all" or empty, returning all records');
    return records;
  }
  const selectedCategoryLower = selectedCategory.toLowerCase().replace(/\s+/g, " ");
  console.log("[FilterDebug] selectedCategoryLower:", selectedCategoryLower);
  let categoryFilteredRecords = [];
  categoryFilteredRecords = records.filter((record) => {
    const fields = record.fields;
    const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || "").trim().toLowerCase().replace(/\s+/g, " ");
    const itemCategories = (fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || "").split(",").map((cat) => cat.trim().toLowerCase().replace(/\s+/g, " "));
    const itemSubcategoriesForCategoryCheck = (fields.Subcategories || "").split(",").map((sc) => sc.trim().toLowerCase().replace(/\s+/g, " "));
    const matches = itemCategories.includes(selectedCategoryLower) || parentNameLower === selectedCategoryLower || itemSubcategoriesForCategoryCheck.includes(selectedCategoryLower);
    if (matches) {
      console.log("[FilterDebug] MATCH found for:", fields.Name);
      console.log("  - itemCategories:", itemCategories);
      console.log("  - parentNameLower:", parentNameLower);
      console.log("  - itemSubcategoriesForCategoryCheck:", itemSubcategoriesForCategoryCheck);
    }
    return matches;
  });
  console.log("[FilterDebug] Category filtered records count:", categoryFilteredRecords.length);
  if (activeSubcategories.length > 0) {
    console.log("[FilterDebug] Applying subcategory filter...");
    const subcategoryFilteredRecords = categoryFilteredRecords.filter((record) => {
      const fields = record.fields;
      const parentNameLower = (fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || "").trim().toLowerCase().replace(/\s+/g, " ");
      const itemSubcategories = (fields.Subcategories || "").split(",").map((sc) => sc.trim().toLowerCase().replace(/\s+/g, " "));
      return activeSubcategories.some(
        (activeSubcat) => itemSubcategories.includes(activeSubcat) || parentNameLower === activeSubcat
      );
    });
    console.log("[FilterDebug] Subcategory filtered records count:", subcategoryFilteredRecords.length);
    console.log("[FilterDebug] === filterByCategoryAndSubcategory END ===");
    return subcategoryFilteredRecords;
  } else {
    console.log("[FilterDebug] No subcategory filter applied");
    console.log("[FilterDebug] === filterByCategoryAndSubcategory END ===");
    return categoryFilteredRecords;
  }
}
function filterByStatus(records, statusFilter) {
  if (statusFilter === "all") {
    return records;
  } else if (statusFilter === "Available") {
    return records.filter((record) => {
      const status = record.fields[CONSTANTS.FIELD_NAMES.STATUS];
      return status && (status === "Available" || status === "Featured");
    });
  } else {
    return records.filter(
      (record) => record.fields[CONSTANTS.FIELD_NAMES.STATUS] && record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusFilter
    );
  }
}
function filterByHeadcount(records, headcountFilter, customHeadcount) {
  if (headcountFilter === "any" && !customHeadcount) {
    return records;
  }
  let filterMin = 0, filterMax = Infinity;
  if (headcountFilter === "custom") {
    filterMin = parseInt(customHeadcount, 10) || 0;
    filterMax = filterMin;
  } else {
    const [minStr, maxStr] = headcountFilter.split("-");
    filterMin = parseInt(minStr, 10);
    filterMax = maxStr === "plus" ? Infinity : parseInt(maxStr, 10);
  }
  return records.filter((record) => {
    const capacity = parseCapacity(record.fields["Capacity"]);
    return filterMin <= capacity.max && filterMax >= capacity.min;
  });
}
function filterByLocation(records, locationFilter) {
  if (locationFilter === "any") {
    return records;
  }
  const filterValueToRegion = {
    "sf": "San Francisco",
    "oakland": "Oakland",
    "peninsula": "Peninsula",
    "south-bay": "South Bay",
    "north-bay": "North Bay",
    "east-bay": "East Bay",
    "other": "Other"
  };
  const targetRegion = filterValueToRegion[locationFilter];
  if (!targetRegion) {
    return records;
  }
  return records.filter((record) => {
    const recordRegions = record.fields["Region"] || [];
    const isTargeted = recordRegions.includes(targetRegion);
    const isAvailableEverywhere = recordRegions.includes("All");
    const isRegionBlank = recordRegions.length === 0;
    return isTargeted || isAvailableEverywhere || isRegionBlank;
  });
}
function filterByBudget(records, budgetFilter) {
  if (budgetFilter === "any") {
    return records;
  }
  const BUDGET_RANGES = {
    "budget-friendly": { min: 0, max: 50 },
    "moderate": { min: 51, max: 100 },
    "executive": { min: 101, max: 250 },
    "luxury": { min: 251, max: Infinity }
  };
  const range = BUDGET_RANGES[budgetFilter];
  return records.filter((record) => {
    var _a;
    const price = ((_a = getGroupPriceRange(record)) == null ? void 0 : _a.min) ?? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || "0").replace(/[^0-9.-]+/g, ""));
    return price >= range.min && price <= range.max;
  });
}
function filterBySearchTerm(records, searchTerm) {
  if (!searchTerm) {
    return records;
  }
  const lowerSearchTerm = searchTerm.toLowerCase();
  const scoredRecords = [];
  records.forEach((record) => {
    let score = 0;
    const fields = record.fields;
    const name = (fields[CONSTANTS.FIELD_NAMES.NAME] || "").toLowerCase();
    const description = (fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || "").toLowerCase();
    const optionNames = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]).map((opt) => opt.name).join(" ").toLowerCase();
    const allOtherText = [
      fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || "",
      fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || "",
      fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || "",
      fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] || "",
      fields["Location"] || "",
      optionNames
    ].join(" ").toLowerCase();
    if (name.includes(lowerSearchTerm)) {
      score = 3;
    } else if (description.includes(lowerSearchTerm)) {
      score = 2;
    } else if (allOtherText.includes(lowerSearchTerm)) {
      score = 1;
    }
    if (score > 0) {
      scoredRecords.push({ record, score });
    }
  });
  scoredRecords.sort((a, b) => b.score - a.score);
  return scoredRecords.map((item) => item.record);
}
function sortRecords(records, sortBy, goalBucket) {
  if (sortBy === "recommended") {
    const log3 = typeof ui_exports !== "undefined" && void 0 ? void 0 : console.log;
    log3("Filtering", `Sorting by v3.0 "Recommended". Goals Included. Bucket: [${goalBucket.join(", ")}]`);
    const scoredRecords = records.map((record) => ({
      record,
      score: calculateRecommendationScore(record, goalBucket)
    }));
    scoredRecords.sort((a, b) => b.score - a.score);
    return scoredRecords.map((item) => item.record);
  }
  return records.sort((a, b) => {
    var _a, _b;
    const aIsFeatured = a.fields[CONSTANTS.FIELD_NAMES.STATUS] === "Featured";
    const bIsFeatured = b.fields[CONSTANTS.FIELD_NAMES.STATUS] === "Featured";
    if (aIsFeatured && !bIsFeatured) {
      return -1;
    }
    if (!aIsFeatured && bIsFeatured) {
      return 1;
    }
    const aPrice = ((_a = getGroupPriceRange(a)) == null ? void 0 : _a.min) ?? parseFloat(String(a.fields[CONSTANTS.FIELD_NAMES.PRICE] || "0").replace(/[^0-9.-]+/g, ""));
    const bPrice = ((_b = getGroupPriceRange(b)) == null ? void 0 : _b.min) ?? parseFloat(String(b.fields[CONSTANTS.FIELD_NAMES.PRICE] || "0").replace(/[^0-9.-]+/g, ""));
    const aName = a.fields[CONSTANTS.FIELD_NAMES.NAME] || "";
    const bName = b.fields[CONSTANTS.FIELD_NAMES.NAME] || "";
    switch (sortBy) {
      case "price-asc":
        return aPrice - bPrice;
      case "price-desc":
        return bPrice - aPrice;
      case "name-asc":
        return aName.localeCompare(bName);
      default:
        return aName.localeCompare(bName);
    }
  });
}
async function applyFiltersAndSort(imageCache2) {
  var _a, _b, _c;
  console.log("[FilterDebug] ========================================");
  console.log("[FilterDebug] applyFiltersAndSort called");
  console.log("[FilterDebug] URL:", window.location.href);
  console.log("[TileSizing][Filter] === FILTER/SORT START ===");
  console.log("[TileSizing][Filter] Viewport:", getViewportInfo());
  const catalogContainer = document.getElementById("catalog-container");
  if (catalogContainer) {
    console.log("[TileSizing][Filter] Catalog container PRE-filter state:", {
      childCount: catalogContainer.children.length,
      hasCarouselSections: !!catalogContainer.querySelector(".grouping-carousel-section"),
      sizing: getElementSizing(catalogContainer)
    });
  }
  const params = new URLSearchParams(window.location.search);
  const rawCategory = params.get("category");
  const selectedCategory = rawCategory ? rawCategory.toLowerCase().replace(/\s+/g, " ") : "all";
  const rawSubcategories = ((_a = params.get("subcategory")) == null ? void 0 : _a.split(",").filter(Boolean)) || [];
  const activeSubcategories = rawSubcategories.map((sc) => sc.toLowerCase().replace(/\s+/g, " "));
  const view = params.get("view");
  console.log("[FilterDebug] selectedCategory from URL:", selectedCategory);
  console.log("[FilterDebug] activeSubcategories from URL:", activeSubcategories);
  console.log("[FilterDebug] view from URL:", view);
  const searchTerm = document.getElementById("name-filter").value.toLowerCase();
  const statusFilter = document.getElementById("status-filter").value;
  const headcountFilter = document.getElementById("headcount-filter").value;
  const customHeadcount = document.getElementById("headcount-custom").value;
  const locationFilter = document.getElementById("location-filter").value;
  const budgetFilter = document.getElementById("budget-filter").value;
  const sortBy = document.getElementById("sort-by").value;
  const goalBucket = buildGoalBucket(sortBy);
  let baseRecordsToFilter = state.records.all.filter(
    (record) => record.fields.Stores && record.fields.Stores.includes(state.ui.activeShopId)
  );
  let recordsToDisplay;
  if (view === "plan") {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "Your";
    const lockedItemIds = Array.from(state.cart.lockedItems.keys());
    const ideaItemIds = Array.from(state.cart.items.keys());
    const allPlanRecordIds = [...lockedItemIds, ...ideaItemIds];
    recordsToDisplay = allPlanRecordIds.map((id) => state.records.all.find((record) => record.id === id)).filter(Boolean);
  } else if (view === "likes") {
    let likedIds = /* @__PURE__ */ new Set();
    if (state.session.user.isAuthenticated) {
      likedIds = state.session.user.likedItemIds;
    } else {
      likedIds = getTempLikes();
    }
    recordsToDisplay = baseRecordsToFilter.filter((record) => likedIds.has(record.id));
  } else if (view === "my-sessions") {
    console.log("[DEBUG MY-SESSIONS VIEW] ========== MY SESSIONS VIEW ACTIVE ==========");
    console.log("[DEBUG MY-SESSIONS VIEW] state.session.user.isAuthenticated:", state.session.user.isAuthenticated);
    console.log("[DEBUG MY-SESSIONS VIEW] state.session.user.id:", state.session.user.id);
    if (state.session.user.isAuthenticated && state.session.user.id) {
      console.log("[DEBUG MY-SESSIONS VIEW] User is authenticated, fetching plans...");
      const userSessions = await fetchPlansForUser(state.session.user.id, true);
      console.log("[DEBUG MY-SESSIONS VIEW] api.fetchPlansForUser returned:", userSessions == null ? void 0 : userSessions.length, "sessions");
      console.log("[DEBUG MY-SESSIONS VIEW] Raw userSessions:", userSessions);
      recordsToDisplay = userSessions.map((session, index) => {
        console.log(`[DEBUG MY-SESSIONS VIEW] Processing session ${index + 1}:`, session.id);
        console.log(`[DEBUG MY-SESSIONS VIEW]   - session.fields:`, session.fields);
        const sessionFields = session.fields || {};
        const itemCount = (sessionFields.Items || []).length;
        const totalCost = sessionFields.TotalCost || 0;
        const dateStr = sessionFields.Date ? (/* @__PURE__ */ new Date(sessionFields.Date + "T00:00:00")).toLocaleDateString() : "No date set";
        const eventName = sessionFields.Name || "Untitled Session";
        const transformedRecord = {
          id: session.id,
          fields: {
            Name: eventName,
            Description: `${itemCount} items • ${dateStr} • $${totalCost.toFixed(2)}`,
            "Item Type": "Session",
            Status: "Available",
            Price: totalCost,
            ServiceType: "Session",
            Categories: "My Sessions"
          },
          isSession: true,
          sessionData: session
        };
        console.log(`[DEBUG MY-SESSIONS VIEW]   - Transformed record:`, transformedRecord);
        console.log(`[DEBUG MY-SESSIONS VIEW]   - isSession: ${transformedRecord.isSession}`);
        console.log(`[DEBUG MY-SESSIONS VIEW]   - sessionData present: ${!!transformedRecord.sessionData}`);
        return transformedRecord;
      });
      console.log("[DEBUG MY-SESSIONS VIEW] Total transformed records:", recordsToDisplay.length);
      console.log("[DEBUG MY-SESSIONS VIEW] First record isSession:", (_b = recordsToDisplay[0]) == null ? void 0 : _b.isSession);
      console.log("[DEBUG MY-SESSIONS VIEW] First record sessionData:", (_c = recordsToDisplay[0]) == null ? void 0 : _c.sessionData);
      if (searchTerm) {
        console.log("[DEBUG MY-SESSIONS VIEW] Applying search filter:", searchTerm);
        recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
        console.log("[DEBUG MY-SESSIONS VIEW] After search filter:", recordsToDisplay.length, "records");
      }
      console.log("[DEBUG MY-SESSIONS VIEW] ========== MY SESSIONS VIEW COMPLETE ==========");
    } else {
      console.log("[DEBUG MY-SESSIONS VIEW] ⚠️ User not authenticated, returning empty array");
      recordsToDisplay = [];
    }
  } else if (view === "rsvp-events") {
    if (!state.session.user.isAuthenticated || !state.session.user.id) {
      console.warn("[Filtering] RSVP events view requires authentication, but user is not authenticated or has no ID");
      recordsToDisplay = [];
    } else {
      const userId = state.session.user.id;
      console.log(`[Filtering] Filtering RSVP events for user: ${userId}`);
      recordsToDisplay = baseRecordsToFilter.filter((record) => {
        const isEvent = record.fields["Item Type"] === "Event";
        if (!isEvent) return false;
        const userRsvpedYes = (record.fields.RSVPs || []).includes(userId);
        const userRsvpedMaybe = (record.fields.RSVPMaybe || []).includes(userId);
        const userRsvpedNo = (record.fields.RSVPNo || []).includes(userId);
        const hasRsvp = userRsvpedYes || userRsvpedMaybe || userRsvpedNo;
        if (hasRsvp) {
          console.log(`[Filtering] User RSVP found for event: ${record.fields.Name} (Yes: ${userRsvpedYes}, Maybe: ${userRsvpedMaybe}, No: ${userRsvpedNo})`);
        }
        return hasRsvp;
      });
      console.log(`[Filtering] Found ${recordsToDisplay.length} RSVP events for user`);
    }
  } else if (view === "categories") {
    const activeShop = state.stores.all.find((s) => s.id === state.ui.activeShopId);
    let categoryRecords = [];
    if (activeShop && activeShop.fields && activeShop.fields.Items) {
      const itemRecordIds = Array.isArray(activeShop.fields.Items) ? activeShop.fields.Items : activeShop.fields.Items.split(",").map((id) => id.trim());
      categoryRecords = itemRecordIds.map((recordId) => state.records.all.find((r) => r.id === recordId)).filter(Boolean);
    } else {
      const categoryNames = [...new Set(
        baseRecordsToFilter.map((r) => r.fields[CONSTANTS.FIELD_NAMES.CATEGORIES]).filter(Boolean).flatMap((cat) => cat.split(",").map((c) => c.trim()))
      )].sort();
      categoryRecords = categoryNames.map((categoryName) => {
        return {
          id: `category-${categoryName.toLowerCase().replace(/\s+/g, "-")}`,
          fields: {
            Name: categoryName,
            Description: `View all items in ${categoryName}`,
            "Item Type": "Grouping",
            Categories: categoryName
          }
        };
      });
    }
    recordsToDisplay = categoryRecords;
  } else {
    console.log("[FilterDebug] Standard filtering path (not plan/likes/etc)");
    console.log("[FilterDebug] baseRecordsToFilter count:", baseRecordsToFilter.length);
    console.log("[FilterDebug] Sample records (first 3):");
    baseRecordsToFilter.slice(0, 3).forEach((rec, i) => {
      console.log(`  Record ${i}: ${rec.fields.Name}`);
      console.log(`    - Categories: "${rec.fields[CONSTANTS.FIELD_NAMES.CATEGORIES]}"`);
      console.log(`    - Parent Item: "${rec.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]}"`);
      console.log(`    - Subcategories: "${rec.fields.Subcategories}"`);
    });
    recordsToDisplay = filterByCategoryAndSubcategory(baseRecordsToFilter, selectedCategory, activeSubcategories);
    console.log("[FilterDebug] After category filter, recordsToDisplay count:", recordsToDisplay.length);
    recordsToDisplay = filterByStatus(recordsToDisplay, statusFilter);
    console.log("[FilterDebug] After status filter:", recordsToDisplay.length);
    recordsToDisplay = filterByHeadcount(recordsToDisplay, headcountFilter, customHeadcount);
    console.log("[FilterDebug] After headcount filter:", recordsToDisplay.length);
    recordsToDisplay = filterByLocation(recordsToDisplay, locationFilter);
    console.log("[FilterDebug] After location filter:", recordsToDisplay.length);
    recordsToDisplay = filterByBudget(recordsToDisplay, budgetFilter);
    console.log("[FilterDebug] After budget filter:", recordsToDisplay.length);
    if (searchTerm) {
      recordsToDisplay = filterBySearchTerm(recordsToDisplay, searchTerm);
      console.log("[FilterDebug] After search term filter:", recordsToDisplay.length);
    }
  }
  recordsToDisplay = sortRecords(recordsToDisplay, sortBy, goalBucket);
  state.records.filtered = recordsToDisplay;
  state.ui.recordsCurrentlyDisplayed = 0;
  console.log("[FilterDebug] FINAL recordsToDisplay count:", recordsToDisplay.length);
  if (recordsToDisplay.length > 0) {
    console.log("[FilterDebug] First result:", recordsToDisplay[0].fields.Name);
  }
  console.log("[FilterDebug] ========================================");
  const typeBreakdown = {
    groupings: recordsToDisplay.filter((r) => r.fields["Item Type"] === "Grouping").length,
    events: recordsToDisplay.filter((r) => r.fields["Item Type"] === "Event").length,
    bookableItems: recordsToDisplay.filter((r) => r.fields["Item Type"] === "Bookable Item").length,
    sessions: recordsToDisplay.filter((r) => r.fields["Item Type"] === "Session" || r.isSession).length,
    other: recordsToDisplay.filter((r) => !["Grouping", "Event", "Bookable Item", "Session"].includes(r.fields["Item Type"]) && !r.isSession).length
  };
  console.log("[TileSizing][Filter] Records to display breakdown:", typeBreakdown);
  console.log("[TileSizing][Filter] View type:", view || "catalog");
  console.log("[TileSizing][Filter] Expected layout:", {
    isFilteredView: !!view || !!params.get("subcategory") || !!searchTerm,
    hasGroupings: typeBreakdown.groupings > 0,
    willUseCarousels: !view && !params.get("subcategory") && !searchTerm && typeBreakdown.groupings > 0
  });
  if (catalogContainer) catalogContainer.innerHTML = "";
  const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
  console.log("[TileSizing][Filter] About to call renderRecords with:", {
    recordCount: initialRecords.length,
    totalFiltered: state.records.filtered.length,
    loadSize: RECORDS_PER_LOAD
  });
  renderRecords(initialRecords, imageCache2, false).then(() => {
    state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    console.log("[TileSizing][Filter] Post-render state:", {
      recordsDisplayed: state.ui.recordsCurrentlyDisplayed,
      catalogContainerChildren: catalogContainer ? catalogContainer.children.length : 0
    });
  });
  updateCatalogHeader();
  console.log("[TileSizing][Filter] === FILTER/SORT COMPLETE ===");
}

// chat.js
var currentUser = null;
var pusher = null;
var sessionChatChannel = null;
var itemChatChannels = /* @__PURE__ */ new Map();
var FUN_ADJECTIVES = ["Happy", "Clever", "Sunny", "Lucky", "Creative", "Brave", "Sparkling", "Cosmic", "Witty", "Zesty"];
var FUN_NOUNS = ["Panda", "Wombat", "Explorer", "Starship", "Juggler", "Wizard", "Dolphin", "Robot", "Pineapple", "Comet"];
var originalTitle = document.title;
var isTabActive = true;
window.addEventListener("focus", () => {
  isTabActive = true;
  document.title = originalTitle;
});
window.addEventListener("blur", () => {
  isTabActive = false;
});
function updateChatHeaderTitle() {
  var _a, _b;
  const chatTitleEl = document.getElementById("chat-session-title");
  if (chatTitleEl) {
    const planName = (_b = (_a = state.eventDetails) == null ? void 0 : _a.combined) == null ? void 0 : _b.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
    chatTitleEl.textContent = planName || "Session Chat";
    log("Chat", `Updated chat header title to: ${planName || "Session Chat"}`);
  }
}
function requestNotificationPermissionIfNeeded() {
  if ("Notification" in window) {
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          log("Chat", "Notification permission granted.");
        }
      });
    }
  }
}
function generateFunName() {
  const adj = FUN_ADJECTIVES[Math.floor(Math.random() * FUN_ADJECTIVES.length)];
  const noun = FUN_NOUNS[Math.floor(Math.random() * FUN_NOUNS.length)];
  return `${adj} ${noun}`;
}
function getSimpleUserIdentity() {
  if (currentUser) return currentUser;
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
  const authenticatedUser = state.session.user;
  if (authenticatedUser && authenticatedUser.isAuthenticated) {
    currentUser = { id: authenticatedUser.id, name: authenticatedUser.name };
  } else {
    currentUser = { id: userId, name: userName };
  }
  return currentUser;
}
function updatePresenceUI(members) {
  const presenceCounter = document.getElementById("presence-counter");
  const whosHereCount = document.getElementById("whos-here-count");
  const whosHereList = document.getElementById("whos-here-list");
  const count = members.count;
  if (presenceCounter) presenceCounter.innerText = count;
  if (whosHereCount) whosHereCount.innerText = count;
  if (whosHereList) {
    whosHereList.innerHTML = "";
    members.each((member) => {
      const profileId = state.session.user.isAuthenticated ? state.session.user.id : member.id;
      const profileName = state.session.user.isAuthenticated ? state.session.user.name : member.info.name;
      if (!state.session.userProfiles.has(profileId)) {
        state.session.userProfiles.set(profileId, profileName);
        triggerSave();
      }
      const userElement = document.createElement("div");
      const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
      userElement.innerText = `\u{1F7E2} ${displayName} ${member.id === currentUser.id ? "(You)" : ""}`;
      whosHereList.appendChild(userElement);
    });
  }
}
function addMessageToUI(messagesList, sender, message, isSent, timestamp, isAdmin, messageId, senderId) {
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${isSent ? "sent" : "received"}`;
  const messageElement = document.createElement("div");
  const isFlagged = state.session.flaggedUsers.has(senderId);
  const isBanned = state.session.bannedUsers.has(senderId);
  const displayMessage = isFlagged || isBanned ? "[CENSORED BY MODERATOR]" : message;
  messageElement.className = "chat-message";
  if (isBanned) messageElement.classList.add("banned");
  if (isFlagged) messageElement.classList.add("flagged");
  const senderElement = document.createElement("div");
  senderElement.className = "sender";
  senderElement.innerText = isSent ? "You" : sender;
  if (state.session.user.isOwner && !isSent) {
    const moderationActions = document.createElement("div");
    moderationActions.className = "moderation-actions";
    const flagBtn = document.createElement("button");
    flagBtn.textContent = isFlagged ? "✅ Un-Flag" : "⚠️ Flag";
    flagBtn.className = "flag-btn";
    flagBtn.addEventListener("click", async () => {
      var _a;
      if (isFlagged) {
        state.session.flaggedUsers.delete(senderId);
      } else {
        state.session.flaggedUsers.add(senderId);
      }
      await updateUserFlagStatus(senderId, !isFlagged);
      const currentModalRecordId = (_a = document.getElementById("detail-modal-overlay")) == null ? void 0 : _a.dataset.recordId;
      if (currentModalRecordId) {
        initializeItemChat(currentModalRecordId);
      }
    });
    const banBtn = document.createElement("button");
    banBtn.textContent = "⛔ Ban";
    banBtn.className = "ban-btn";
    banBtn.addEventListener("click", async () => {
      await banUser(senderId);
    });
    moderationActions.appendChild(flagBtn);
    moderationActions.appendChild(banBtn);
    messageElement.appendChild(moderationActions);
  }
  messageElement.appendChild(senderElement);
  messageElement.append(document.createTextNode(displayMessage));
  const timestampElement = document.createElement("div");
  timestampElement.className = "timestamp";
  const date = timestamp ? new Date(timestamp) : /* @__PURE__ */ new Date();
  timestampElement.innerText = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  wrapper.appendChild(messageElement);
  wrapper.appendChild(timestampElement);
  messagesList.appendChild(wrapper);
  wrapper.scrollIntoView({ behavior: "smooth" });
}
function bindPresenceEvents() {
  sessionChatChannel.bind("pusher:subscription_succeeded", (members) => {
    const messageInput = document.getElementById("message-input");
    const messageForm = document.getElementById("message-form");
    if (messageInput && messageForm) {
      messageInput.disabled = false;
      messageForm.querySelector("button").disabled = false;
      messageInput.placeholder = "Type a message...";
    }
    updatePresenceUI(members);
    if (members.count > 1) {
      openChatWidget(true);
    }
  });
  sessionChatChannel.bind("pusher:member_added", (member) => {
    updatePresenceUI(sessionChatChannel.members);
  });
  sessionChatChannel.bind("pusher:member_removed", (member) => {
    updatePresenceUI(sessionChatChannel.members);
  });
}
function getCurrentUser() {
  return currentUser || getSimpleUserIdentity();
}
function showNewMessageNotification(sender, message) {
  if (Notification.permission === "granted" && !document.hasFocus()) {
    const notification = new Notification(`New message from ${sender}`, {
      body: message
    });
    setTimeout(notification.close.bind(notification), 4e3);
  }
}
function displayDebugMessage(message) {
  if (console.log) {
    const messagesList = document.getElementById("messages-list");
    if (messagesList) {
      const debugEl = document.createElement("div");
      debugEl.className = "chat-message received";
      debugEl.style.color = "#dc3545";
      debugEl.style.fontSize = "0.7em";
      debugEl.innerHTML = `<strong>[DEBUG]</strong> ${message}`;
      messagesList.appendChild(debugEl);
      debugEl.scrollIntoView({ behavior: "smooth" });
    }
  }
}
async function initializeSessionChat() {
  log("Chat", "initializeSessionChat called, waiting for Pusher library...");
  const messageInput = document.getElementById("message-input");
  const messageForm = document.getElementById("message-form");
  if (messageInput && messageForm) {
    messageInput.disabled = true;
    messageForm.querySelector("button").disabled = true;
    messageInput.placeholder = "Connecting to chat...";
  }
  if (typeof window.waitForPusher === "function") {
    try {
      await window.waitForPusher();
      log("Chat", "Pusher library is now available");
    } catch (err) {
      console.error("[Chat] Failed to wait for Pusher:", err);
      if (messageInput) {
        messageInput.placeholder = "Chat unavailable - please refresh";
      }
      displayDebugMessage("Error: Could not load real-time chat library. Please refresh the page.");
      return;
    }
  } else if (typeof Pusher === "undefined") {
    console.error("[Chat] Pusher is not defined and waitForPusher is not available");
    if (messageInput) {
      messageInput.placeholder = "Chat unavailable - please refresh";
    }
    displayDebugMessage("Error: Real-time chat library not loaded. Please refresh the page.");
    return;
  }
  if (pusher) {
    pusher.disconnect();
    log("Chat", "Disconnected from previous Pusher instance.");
  }
  updateChatHeaderTitle();
  currentUser = getSimpleUserIdentity();
  if (!state.session.userProfiles.has(currentUser.id)) {
    state.session.userProfiles.set(currentUser.id, currentUser.name);
  }
  const sessionId = state.session.id || "default-session";
  const chatUserNameInput = document.getElementById("chat-user-name");
  if (chatUserNameInput) {
    chatUserNameInput.value = currentUser.name;
    chatUserNameInput.addEventListener("change", (e) => {
      const newName = e.target.value.trim();
      if (newName && newName !== currentUser.name) {
        currentUser.name = newName;
        localStorage.setItem("chatUserName", newName);
        state.session.userProfiles.set(currentUser.id, newName);
        log("Chat", `User name changed to: ${newName}`);
        updatePresenceUI(sessionChatChannel.members);
        triggerSave();
      } else {
        e.target.value = currentUser.name;
      }
    });
  }
  const messagesList = document.getElementById("messages-list");
  if (messagesList) {
    messagesList.innerHTML = "";
    const records = await fetchChatMessages(sessionId);
    if (records.length > 0) {
      records.forEach((record) => {
        const { SenderID, SenderName, Content, Timestamp } = record.fields;
        const isSent = SenderID === currentUser.id;
        addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
      });
    } else {
    }
  }
  pusher = new Pusher("236f480714e5001590b5", {
    cluster: "us3",
    authEndpoint: "/api/pusher-auth",
    auth: {
      params: {
        user_id: currentUser.id,
        user_name: currentUser.name
      }
    }
  });
  const channelName = `presence-session-${sessionId}`;
  log("Chat", `Subscribing to Pusher channel: ${channelName}`);
  sessionChatChannel = pusher.subscribe(channelName);
  bindPresenceEvents();
  sessionChatChannel.bind("client-new-message", (data) => {
    if (data.senderId !== currentUser.id) {
      requestNotificationPermissionIfNeeded();
      addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
      showNewMessageNotification(data.senderName, data.content);
      if (!isTabActive) {
        document.title = "New Message! - " + originalTitle;
      }
    }
  });
}
async function sendMessage(message, recordId = null) {
  if (recordId) {
    const channel = itemChatChannels.get(recordId);
    if (!channel || !currentUser) return;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const messagesList = document.getElementById("messages-list-item");
    addMessageToUI(messagesList, currentUser.name, message, true, timestamp, false, null, currentUser.id);
    await postItemChatMessage(recordId, currentUser.id, currentUser.name, message);
    channel.trigger("client-new-message-item", {
      content: message,
      senderId: currentUser.id,
      senderName: currentUser.name,
      timestamp
    });
  } else {
    if (!sessionChatChannel || !currentUser) return;
    requestNotificationPermissionIfNeeded();
    const sessionId = state.session.id || "default-session";
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const messagesList = document.getElementById("messages-list");
    addMessageToUI(messagesList, currentUser.name, message, true, timestamp, false, null, currentUser.id);
    await postChatMessage(sessionId, currentUser.id, currentUser.name, message);
    sessionChatChannel.trigger("client-new-message", {
      content: message,
      senderId: currentUser.id,
      senderName: currentUser.name,
      timestamp
    });
  }
}
async function initializeItemChat(recordId) {
  log("Chat", `Initializing item chat for recordId: ${recordId}`);
  if (typeof window.waitForPusher === "function") {
    try {
      await window.waitForPusher();
      log("Chat", "Pusher library is now available for item chat");
    } catch (err) {
      console.error("[Chat] Failed to wait for Pusher for item chat:", err);
      return;
    }
  } else if (typeof Pusher === "undefined") {
    console.error("[Chat] Pusher is not defined for item chat");
    return;
  }
  const chatContainer = document.getElementById("modal-chat-container");
  if (chatContainer) chatContainer.style.display = "block";
  currentUser = getCurrentUser();
  const messagesList = document.getElementById("messages-list-item");
  const messageForm = document.getElementById("message-form-item");
  const messageInput = document.getElementById("message-input-item");
  if (!messagesList) {
    console.warn("Chat: messages-list-item element not found");
    return;
  }
  if (!messageForm || !messageForm.parentNode) {
    console.warn("Chat: message-form-item element not found or not in DOM");
    return;
  }
  messagesList.innerHTML = "";
  itemChatChannels.forEach((channel2) => channel2.unsubscribe());
  itemChatChannels.clear();
  const records = await fetchItemChatMessages(recordId);
  records.forEach((record) => {
    const { SenderID, SenderName, Content, Timestamp } = record.fields;
    const isSent = SenderID === currentUser.id;
    addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
  });
  const pusher2 = new Pusher("236f480714e5001590b5", {
    cluster: "us3",
    authEndpoint: "/api/pusher-auth",
    auth: {
      params: {
        user_id: currentUser.id,
        user_name: currentUser.name
      }
    }
  });
  const channelName = `presence-item-${recordId}`;
  const channel = pusher2.subscribe(channelName);
  itemChatChannels.set(recordId, channel);
  channel.bind("client-new-message-item", (data) => {
    if (data.senderId !== currentUser.id) {
      addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
    }
  });
  const newForm = messageForm.cloneNode(true);
  messageForm.parentNode.replaceChild(newForm, messageForm);
  const newMessageInput = document.getElementById("message-input-item");
  newForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const message = newMessageInput.value;
    if (message.trim() === "") return;
    sendMessage(message, recordId);
    newMessageInput.value = "";
  });
}
var recentChatsExpanded = false;
async function loadRecentChats() {
  const currentUserData = getCurrentUser();
  if (!currentUserData || !currentUserData.id) {
    log("Chat", "loadRecentChats: No current user available.");
    return;
  }
  const recentChatsList = document.getElementById("recent-chats-list");
  const loadingEl = document.getElementById("recent-chats-loading");
  if (loadingEl) {
    loadingEl.style.display = "block";
    loadingEl.textContent = "Loading recent chats...";
  }
  try {
    const chats = await fetchRecentChats(currentUserData.id, 10);
    state.session.recentChats = chats;
    renderRecentChatsList(chats);
  } catch (error) {
    console.error("Error loading recent chats:", error);
    if (loadingEl) {
      loadingEl.textContent = "Failed to load recent chats";
    }
  }
}
function renderRecentChatsList(chats) {
  const recentChatsList = document.getElementById("recent-chats-list");
  const loadingEl = document.getElementById("recent-chats-loading");
  if (!recentChatsList) return;
  recentChatsList.innerHTML = "";
  if (!chats || chats.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "recent-chat-empty";
    emptyEl.textContent = "No recent chats";
    recentChatsList.appendChild(emptyEl);
    return;
  }
  chats.forEach((chat) => {
    const chatItem = document.createElement("div");
    chatItem.className = "recent-chat-item";
    chatItem.dataset.chatId = chat.id;
    chatItem.dataset.chatType = chat.type;
    const icon = chat.type === "session" ? "\u{1F4AC}" : "\u{1F4E6}";
    const timeAgo = formatTimeAgo(chat.lastMessageTime);
    const truncatedMessage = chat.lastMessage.length > 30 ? chat.lastMessage.substring(0, 30) + "..." : chat.lastMessage;
    chatItem.innerHTML = `
            <div class="recent-chat-icon">${icon}</div>
            <div class="recent-chat-content">
                <div class="recent-chat-name">${escapeHtml(chat.name)}</div>
                <div class="recent-chat-preview">${escapeHtml(truncatedMessage)}</div>
            </div>
            <div class="recent-chat-time">${timeAgo}</div>
        `;
    chatItem.addEventListener("click", () => handleRecentChatClick(chat));
    recentChatsList.appendChild(chatItem);
  });
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const now = /* @__PURE__ */ new Date();
  const time = new Date(timestamp);
  const diffMs = now - time;
  const diffMins = Math.floor(diffMs / 6e4);
  const diffHours = Math.floor(diffMs / 36e5);
  const diffDays = Math.floor(diffMs / 864e5);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return time.toLocaleDateString([], { month: "short", day: "numeric" });
}
async function handleRecentChatClick(chat) {
  log("Chat", `Clicked recent chat: ${chat.type} - ${chat.id}`);
  if (chat.type === "item") {
    const record = state.records.all.find((r) => r.id === chat.id);
    if (record && typeof window.openDetailModal === "function") {
      window.openDetailModal(record);
    } else {
      log("Chat", `Could not open detail modal for item ${chat.id}`);
      alert(`Item chat: ${chat.name}`);
    }
  } else if (chat.type === "session") {
    log("Chat", `Opening session ${chat.id} from recent chats`);
    updateUrl2({ session: chat.id, view: null, category: null, subcategory: null });
    try {
      await loadSessionFromAirtable(chat.id);
      log("Chat", `Session ${chat.id} loaded successfully`);
      if (typeof window.applyFiltersAndSort === "function" && window.imageCache) {
        window.applyFiltersAndSort(window.imageCache);
      }
      const messagesContainer = document.getElementById("messages-container");
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    } catch (err) {
      console.error("Failed to load session from recent chat:", err);
      log("Chat", `Failed to load session ${chat.id}: ${err.message}`);
    }
  }
  toggleRecentChats(false);
}
function toggleRecentChats(forceState = null) {
  const recentChatsList = document.getElementById("recent-chats-list");
  const toggleIcon = document.querySelector("#recent-chats-toggle .toggle-icon");
  if (!recentChatsList || !toggleIcon) return;
  if (forceState !== null) {
    recentChatsExpanded = forceState;
  } else {
    recentChatsExpanded = !recentChatsExpanded;
  }
  if (recentChatsExpanded) {
    recentChatsList.classList.remove("collapsed");
    toggleIcon.textContent = "▼";
    loadRecentChats();
  } else {
    recentChatsList.classList.add("collapsed");
    toggleIcon.textContent = "▶";
  }
}
function initializeRecentChatsListeners() {
  const toggleBtn = document.getElementById("recent-chats-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleRecentChats();
    });
  }
}
function updateCurrentSessionName(newName) {
  const currentSessionId = state.session.id;
  if (!currentSessionId) {
    log("Chat", "updateCurrentSessionName: No current session ID.");
    return;
  }
  const chatTitleEl = document.getElementById("chat-session-title");
  if (chatTitleEl) {
    chatTitleEl.textContent = newName || "Session Chat";
    log("Chat", `Updated chat header title to: ${newName || "Session Chat"}`);
  }
  const chatIndex = state.session.recentChats.findIndex(
    (chat) => chat.id === currentSessionId && chat.type === "session"
  );
  if (chatIndex !== -1) {
    state.session.recentChats[chatIndex].name = newName || "Session Chat";
    log("Chat", `Updated session name in recentChats to: ${newName}`);
    if (recentChatsExpanded) {
      renderRecentChatsList(state.session.recentChats);
    }
  }
}

// components/backgroundEngine.js
var canvas;
var gl;
var ctx_2d;
var animationFrameId = null;
var currentEffect = null;
var debugPanel = null;
var startTime = 0;
var currentEnergy = 0;
var progressMultiplier = 1;
var energyDecayRate = 0.985;
var lastTimestamp_2d = 0;
var currentColors = [];
var settings = {};
var loopIterations = 0;
var lastProgressLog = 0;
var isPageVisible = true;
function animationLoop(timestamp) {
  if (!currentEffect) {
    animationFrameId = requestAnimationFrame(animationLoop);
    return;
  }
  if (!isPageVisible) {
    animationFrameId = requestAnimationFrame(animationLoop);
    return;
  }
  const currentProgress = state.ui.currentProgress;
  loopIterations++;
  updateDebugPanel(currentProgress, currentEnergy, timestamp / 1e3, loopIterations);
  if (currentEffect.type === "webgl") {
    if (!gl) {
      animationFrameId = requestAnimationFrame(animationLoop);
      return;
    }
    const elapsedTime = (timestamp - startTime) / 1e3;
    currentEnergy *= energyDecayRate;
    if (currentEnergy < 0.01) currentEnergy = 0;
    if (currentProgress !== lastProgressLog) {
      lastProgressLog = currentProgress;
    }
    currentEffect.draw(gl, canvas.width, canvas.height, elapsedTime, currentEnergy, currentProgress);
  } else if (currentEffect.type === "canvas") {
    if (!ctx_2d) {
      animationFrameId = requestAnimationFrame(animationLoop);
      return;
    }
    const deltaTime = timestamp - lastTimestamp_2d;
    lastTimestamp_2d = timestamp;
    currentEffect.draw(ctx_2d, canvas.width, canvas.height, deltaTime, currentColors, settings);
  }
  animationFrameId = requestAnimationFrame(animationLoop);
}
function addEnergy() {
  log("BG-Engine", "Adding energy boost!");
  currentEnergy = 1;
}
function updateProgress(weight) {
  const adjustedWeight = weight * progressMultiplier;
  let newProgress = state.ui.currentProgress + adjustedWeight;
  newProgress = Math.min(1, Math.max(0, newProgress));
  if (newProgress !== state.ui.currentProgress) {
    setState2({
      ui: {
        ...state.ui,
        currentProgress: newProgress
      }
    });
    if (weight > 0) {
      currentEnergy = Math.min(1, currentEnergy + adjustedWeight * 5);
    }
  }
}
function updateColors() {
  log("BG-Engine", "Updating 2D colors...");
  let colors = [];
  const VIBRANT_COLOR_PAIRS = [
    ["#ff9a8b", "#ff6a88"],
    ["#00c9a7", "#84fab0"],
    ["#fbc2eb", "#a6c1ee"],
    ["#ff7e5f", "#feb47b"],
    ["#a18cd1", "#fbc2eb"],
    ["#89f7fe", "#66a6ff"]
  ];
  const defaultColors = VIBRANT_COLOR_PAIRS[5];
  if (!state.records || !state.records.all || state.cart.lockedItems.size === 0) {
    colors.push(...defaultColors);
  } else {
    const categoriesInPlan = /* @__PURE__ */ new Set();
    for (const [recordId] of state.cart.lockedItems.entries()) {
      const record = state.records.all.find((r) => r.id === recordId);
      const categoryString = (record == null ? void 0 : record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES]) || "";
      categoryString.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean).forEach((c) => categoriesInPlan.add(c));
    }
    if (categoriesInPlan.size === 0) {
      colors.push(...defaultColors);
    } else {
      categoriesInPlan.forEach((catName) => {
        let hash = 0, i, chr;
        for (i = 0; i < catName.length; i++) {
          chr = catName.charCodeAt(i);
          hash = (hash << 5) - hash + chr;
          hash |= 0;
        }
        const colorIndex = Math.abs(hash) % VIBRANT_COLOR_PAIRS.length;
        colors.push(...VIBRANT_COLOR_PAIRS[colorIndex]);
      });
    }
  }
  currentColors = [...new Set(colors)];
}
function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  if (currentEffect && typeof currentEffect.updateSettings === "function") {
    currentEffect.updateSettings(settings);
  }
  log("BG-Engine", "2D Settings updated:", settings);
}
function loadEffect(effect, controlsContainer) {
  log("BG-Engine", `Loading effect: ${effect.name}`);
  currentEffect = effect;
  settings = {};
  if (!canvas) {
    console.error("[BG-Engine] FATAL: Canvas not initialized before loadEffect!");
    return;
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (currentEffect.type === "webgl") {
    gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    ctx_2d = null;
    if (!gl) {
      console.error("[BG-Engine] FATAL: Could not get WebGL context!");
      return;
    }
    if (typeof currentEffect.init === "function") {
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      currentEffect.init(gl);
      currentEffect.initialized = true;
    } else {
      console.error("[BG-Engine] Effect has no init function!");
    }
  } else if (currentEffect.type === "canvas") {
    ctx_2d = canvas.getContext("2d");
    gl = null;
    if (ctx_2d && typeof currentEffect.init === "function") {
      ctx_2d.globalAlpha = 0.4;
      currentEffect.init(ctx_2d, canvas.width, canvas.height);
      currentEffect.initialized = true;
    } else if (!ctx_2d) {
      console.error("[BG-Engine] FATAL: Could not get 2D context!");
    }
  }
  if (controlsContainer) {
    controlsContainer.innerHTML = "";
  }
  if (typeof currentEffect.getControls === "function") {
    const controls = currentEffect.getControls();
    controls.forEach((control) => {
      settings[control.id] = control.defaultValue;
      if (controlsContainer) {
        const controlGroup = document.createElement("div");
        controlGroup.className = "form-row-slider";
        const label = document.createElement("label");
        label.htmlFor = control.id;
        label.textContent = `${control.label}: `;
        const valueSpan = document.createElement("span");
        valueSpan.id = `${control.id}-value`;
        valueSpan.textContent = control.defaultValue;
        label.appendChild(valueSpan);
        const slider = document.createElement("input");
        slider.type = "range";
        slider.id = control.id;
        slider.min = control.min;
        slider.max = control.max;
        slider.step = control.step;
        slider.value = control.defaultValue;
        slider.addEventListener("input", (e) => {
          const newValue = parseFloat(e.target.value);
          valueSpan.textContent = newValue.toFixed(control.step < 1 ? 2 : 0);
          updateSettings({ [control.id]: newValue });
        });
        controlGroup.appendChild(label);
        controlGroup.appendChild(slider);
        controlsContainer.appendChild(controlGroup);
      }
    });
  }
  if (currentEffect.type === "canvas") {
    updateColors();
  }
}
function initBackgroundEngine() {
  canvas = document.getElementById("kaleidoscope-bg");
  if (!canvas) {
    console.error("[BG-Engine] FATAL: Background canvas not found in DOM!");
    return;
  }
  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (currentEffect && typeof currentEffect.resize === "function") {
      if (currentEffect.type === "webgl" && gl) {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      } else if (currentEffect.type === "canvas" && ctx_2d) {
        currentEffect.resize(canvas.width, canvas.height);
      }
    }
  };
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
      lastTimestamp_2d = performance.now();
      log("BG-Engine", "Page visible - resuming animations");
    } else {
      log("BG-Engine", "Page hidden - pausing animations to save resources");
    }
  });
  startTime = performance.now();
  lastTimestamp_2d = startTime;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(animationLoop);
  initDebugPanel();
  log("BG-Engine", "Hybrid WebGL/2D Engine Initialized with Page Visibility optimization.");
}
function updateDebugPanel(progress, energy, time, drawCalls) {
  if (!debugPanel || debugPanel.style.display === "none") return;
  const progressElem = document.getElementById("bg-progress-value");
  const energyElem = document.getElementById("bg-energy-value");
  const timeElem = document.getElementById("bg-time-value");
  const drawCallsElem = document.getElementById("bg-draw-calls");
  const statusText2 = document.getElementById("bg-status-text");
  const statusIndicator = document.getElementById("bg-status-indicator");
  if (progressElem) progressElem.textContent = progress.toFixed(3);
  if (energyElem) energyElem.textContent = energy.toFixed(3);
  if (timeElem) timeElem.textContent = time.toFixed(1) + "s";
  if (drawCallsElem) drawCallsElem.textContent = drawCalls;
  if (statusText2 && statusIndicator) {
    if (currentEffect && gl) {
      statusText2.textContent = "Running (" + currentEffect.name + ")";
      statusIndicator.style.color = "#28a745";
    } else if (currentEffect && ctx_2d) {
      statusText2.textContent = "Running 2D (" + currentEffect.name + ")";
      statusIndicator.style.color = "#28a745";
    } else {
      statusText2.textContent = "Error: No effect loaded";
      statusIndicator.style.color = "#dc3545";
    }
  }
}
function initDebugPanel() {
  debugPanel = document.getElementById("bg-settings-panel");
  if (!debugPanel) {
    console.error("[BG-Engine] Debug panel not found in DOM");
    return;
  }
  const trigger = document.getElementById("bg-settings-trigger");
  if (trigger) {
    trigger.addEventListener("click", () => {
      debugPanel.style.display = debugPanel.style.display === "none" ? "block" : "none";
    });
  }
  const closeBtn3 = document.getElementById("bg-settings-close");
  if (closeBtn3) {
    closeBtn3.addEventListener("click", () => {
      debugPanel.style.display = "none";
    });
  }
  const progressSlider = document.getElementById("bg-progress-slider");
  if (progressSlider) {
    progressSlider.value = state.ui.currentProgress;
    progressSlider.addEventListener("input", (e) => {
      const newProgress = parseFloat(e.target.value);
      setState2({
        ui: {
          ...state.ui,
          currentProgress: newProgress
        }
      });
    });
  }
  const energySlider = document.getElementById("bg-energy-slider");
  if (energySlider) {
    energySlider.addEventListener("input", (e) => {
      currentEnergy = parseFloat(e.target.value);
    });
  }
  const energyDecaySlider = document.getElementById("bg-energy-decay");
  if (energyDecaySlider) {
    energyDecaySlider.value = 0.985;
    energyDecaySlider.addEventListener("input", (e) => {
      energyDecayRate = parseFloat(e.target.value);
      const valueDisplay = document.getElementById("bg-energy-decay-value");
      if (valueDisplay) {
        valueDisplay.textContent = energyDecayRate.toFixed(2);
      }
    });
  }
  const progressMultiplierSlider = document.getElementById("bg-progress-multiplier");
  if (progressMultiplierSlider) {
    progressMultiplierSlider.addEventListener("input", (e) => {
      progressMultiplier = parseFloat(e.target.value);
      const valueDisplay = document.getElementById("bg-progress-multiplier-value");
      if (valueDisplay) {
        valueDisplay.textContent = progressMultiplier.toFixed(1);
      }
    });
  }
  const testEnergyBtn = document.getElementById("bg-test-energy");
  if (testEnergyBtn) {
    testEnergyBtn.addEventListener("click", () => {
      addEnergy();
    });
  }
  const testProgressBtn = document.getElementById("bg-test-progress");
  if (testProgressBtn) {
    testProgressBtn.addEventListener("click", () => {
      updateProgress(0.1);
    });
  }
}

// components/effects/fractal.js
console.log("[fractal.js] File execution started.");
var settings2 = {};
var angle = 0;
var fractalEffect = {
  name: "Fractal (Simple)",
  type: "canvas",
  // <-- ADD THIS LINE
  init: (ctx, width, height) => {
    log("FX:Fractal", "Initializing...");
  },
  draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
    settings2 = currentSettings;
    ctx.fillStyle = `rgba(255, 255, 255, 0.05)`;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    angle += settings2.spin * 1e-3 * deltaTime;
    ctx.rotate(angle);
    const maxLevels = Math.floor(settings2.complexity);
    const branchLength = settings2.zoom;
    function drawBranch(level) {
      if (level > maxLevels) return;
      ctx.strokeStyle = colors[level % colors.length] || "#000000";
      ctx.lineWidth = maxLevels - level + 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -branchLength);
      ctx.stroke();
      ctx.translate(0, -branchLength);
      ctx.save();
      ctx.rotate(-0.5);
      drawBranch(level + 1);
      ctx.restore();
      ctx.save();
      ctx.rotate(0.5);
      drawBranch(level + 1);
      ctx.restore();
    }
    drawBranch(0);
    ctx.restore();
  },
  getControls: () => {
    return [
      { id: "complexity", label: "Complexity", min: 1, max: 8, step: 1, defaultValue: 5 },
      { id: "zoom", label: "Zoom", min: 20, max: 150, step: 5, defaultValue: 80 },
      { id: "spin", label: "Spin", min: 0, max: 1, step: 0.05, defaultValue: 0.1 }
    ];
  }
};
var fractal_default = fractalEffect;

// utils/shader.js
console.log("[shader.js] File execution started.");
function compileShader(gl3, type, source) {
  const shader2 = gl3.createShader(type);
  gl3.shaderSource(shader2, source);
  gl3.compileShader(shader2);
  if (!gl3.getShaderParameter(shader2, gl3.COMPILE_STATUS)) {
    console.error("An error occurred compiling the shaders: " + gl3.getShaderInfoLog(shader2));
    gl3.deleteShader(shader2);
    return null;
  }
  return shader2;
}
var Shader = class {
  /**
   * @param {WebGLRenderingContext} gl
   * @param {string} vsSource Vertex shader source.
   * @param {string} fsSource Fragment shader source.
   */
  constructor(gl3, vsSource2, fsSource2) {
    this.gl = gl3;
    const vertexShader = compileShader(gl3, gl3.VERTEX_SHADER, vsSource2);
    const fragmentShader = compileShader(gl3, gl3.FRAGMENT_SHADER, fsSource2);
    const program = gl3.createProgram();
    gl3.attachShader(program, vertexShader);
    gl3.attachShader(program, fragmentShader);
    gl3.linkProgram(program);
    if (!gl3.getProgramParameter(program, gl3.LINK_STATUS)) {
      console.error("Unable to initialize the shader program: " + gl3.getProgramInfoLog(program));
      return;
    }
    this.program = program;
    this.uniforms = {};
    const positionBuffer = gl3.createBuffer();
    gl3.bindBuffer(gl3.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl3.bufferData(gl3.ARRAY_BUFFER, new Float32Array(positions), gl3.STATIC_DRAW);
    this.positionAttributeLocation = gl3.getAttribLocation(program, "a_position");
    gl3.enableVertexAttribArray(this.positionAttributeLocation);
    gl3.bindBuffer(gl3.ARRAY_BUFFER, positionBuffer);
    gl3.vertexAttribPointer(this.positionAttributeLocation, 2, gl3.FLOAT, false, 0, 0);
  }
  /** Tell the browser to use this shader program */
  use() {
    this.gl.useProgram(this.program);
  }
  /**
   * Gets and caches the location of a uniform variable in the shader.
   * @param {string} name
   */
  getUniformLocation(name) {
    if (!this.uniforms[name]) {
      this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
    }
    return this.uniforms[name];
  }
};

// components/effects/fluid.js
var vsSource = `
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;
var fsSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_energy; 
    uniform float u_progress; // NEW: Controls the base color of the spectrum (0.0 to 1.0)

    // This is a function that creates organic-looking "noise"
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // This is a "noise" function that creates smooth, fluid patterns
    float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
    }

    void main() {
        // 1. Normalize coordinates (from 0.0 to 1.0)
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y; // Fix aspect ratio

        // 2. Center the coordinates (now -0.5 to 0.5)
        vec2 centered_st = st - vec2(0.5, 0.5);

        // 3. Convert to polar coordinates (angle and distance)
        float angle = atan(centered_st.y, centered_st.x);
        float radius = length(centered_st);

        // 4. Create the "vortex"
        // The vortex movement still depends on time and the energy boost.
        float vortex_speed = u_time * (0.2 + u_energy * 2.0);
        float vortex_twist = u_energy * 5.0;
        float n = noise(vec2(angle * (3.0 + vortex_twist) + vortex_speed, radius * 2.0));

        // 5. Calculate Color from Progress
        // We use the progress variable to define the base hue.
        // The noise still creates the fluid bands, but they shift based on u_progress.
        // Multiplier of 50.0 creates a full spectrum cycle across the 0.0-1.0 progress range
        // Adding the slow vortex_speed creates continuous animation independent of progress
        float base_wave = n * 1.5 + (u_progress * 50.0) + (vortex_speed * 0.3); // Combine progress and animation
        
        // DEBUG: Add a subtle visual indicator when progress is exactly 0.3 (starting value)
        // If progress hasn't changed from 0.3, we'll see a specific color pattern
        
        // Define the standard 120-degree phase shift for full spectrum HSL cycling
        const float PI_2_OVER_3 = 2.0943951; 
        
        // Maintain brightness boost and exponent
        float r = pow(sin(base_wave + 0.0) * 0.5 + 0.5, 1.1) + 0.1; 
        float g = pow(sin(base_wave + PI_2_OVER_3) * 0.5 + 0.5, 1.1) + 0.1;
        float b = pow(sin(base_wave + PI_2_OVER_3 * 2.0) * 0.5 + 0.5, 1.1) + 0.1;
        
        // 6. Final color with a vignette (darker edges)
        float vignette = 1.0 - (radius * 0.2);
        gl_FragColor = vec4(r * vignette, g * vignette, b * vignette, 1.0);
    }
`;
var gl2 = null;
var shader = null;
var drawCallCount = 0;
var lastLoggedProgress = null;
var fluidEffect = {
  name: "Fluid Energy",
  type: "webgl",
  // This is our new type
  init: (context) => {
    gl2 = context;
    shader = new Shader(gl2, vsSource, fsSource);
  },
  // MODIFIED: Added 'progress' to the draw function
  draw: (gl3, width, height, time, energy, progress) => {
    if (!shader) return;
    drawCallCount++;
    lastLoggedProgress = progress;
    shader.use();
    gl3.uniform2f(shader.getUniformLocation("u_resolution"), width, height);
    gl3.uniform1f(shader.getUniformLocation("u_time"), time);
    gl3.uniform1f(shader.getUniformLocation("u_energy"), energy);
    gl3.uniform1f(shader.getUniformLocation("u_progress"), progress);
    gl3.drawArrays(gl3.TRIANGLES, 0, 6);
  },
  // We don't need controls, so we return an empty array
  getControls: () => {
    return [];
  }
};
var fluid_default = fluidEffect;

// auth.js
console.log("[auth.js] 0. File execution started.");
console.log("[auth.js] 1. Importing effect plugins...");
console.log("[auth.js] 1a. Importing fractalEffect.js...");
console.log("[auth.js] 1b. Importing fluidEffect.js...");
console.log("[auth.js] 2. All effect plugins imported.");
var userModalOverlay = document.getElementById("user-modal-overlay");
var userModalCloseBtn = document.getElementById("user-modal-close-btn");
var signinView = document.getElementById("signin-view");
var profileView = document.getElementById("profile-view");
var signinForm = document.getElementById("signin-form");
var signinEmailInput = document.getElementById("signin-email");
var signinMessage = document.getElementById("signin-message");
var signoutBtn = document.getElementById("signout-btn");
var profileNameEl = document.getElementById("profile-name");
var profileEmailEl = document.getElementById("profile-email");
var userProfileButton = document.getElementById("user-profile-button");
var userPrefsForm = document.getElementById("user-prefs-form");
var profilePhoneInput = document.getElementById("profile-phone");
var profileNotificationsSelect = document.getElementById("profile-notifications");
var prefsMessage = document.getElementById("prefs-message");
var effects = [
  { name: "Fluid Energy", plugin: fluid_default },
  { name: "Fractal (Simple)", plugin: fractal_default }
];
console.log(`[auth.js] 3. 'effects' array created. Length: ${effects.length}`);
async function _handleSuccessfulLogin2(payload) {
  console.log(`[Auth] ========== _handleSuccessfulLogin CALLED ==========`);
  console.log(`[Auth] Timestamp:`, (/* @__PURE__ */ new Date()).toISOString());
  console.log(`[Auth] Full payload:`, JSON.stringify(payload, null, 2));
  console.log(`[Auth] Payload received:`, payload);
  console.log(`[Auth] User from payload:`, payload.user);
  console.log(`[Auth] Liked items from payload:`, payload.user.likedItemIds);
  console.log(`[Auth] Token from payload:`, payload.token ? "Present" : "Missing");
  if (state.session.id) {
    await associateSessionWithUser(state.session.id, payload.user.id);
  }
  console.log("[Auth] Storing JWT in localStorage...");
  localStorage.setItem("jwt", payload.token);
  console.log("[Auth] JWT stored. Verifying storage...");
  const storedJwt = localStorage.getItem("jwt");
  console.log("[Auth] JWT successfully stored:", !!storedJwt);
  console.log("[Auth] Stored JWT (first 20 chars):", storedJwt ? storedJwt.substring(0, 20) + "..." : "null");
  const initialLikedItemIdsFromPayload = payload.user.likedItemIds || [];
  console.log(`[Auth] Setting user state. Liked items from payload: ${initialLikedItemIdsFromPayload.length}`);
  console.log(`[Auth] Full liked items array:`, initialLikedItemIdsFromPayload);
  setState2({
    session: {
      ...state.session,
      user: {
        ...state.session.user,
        ...payload.user,
        isAuthenticated: true,
        isOwner: payload.ownerData.isOwner,
        ownerDashboardId: payload.ownerData.ownerDashboardId,
        ownedStoreId: payload.ownerData.ownedStoreId,
        likedItemIds: new Set(initialLikedItemIdsFromPayload)
      }
    }
  });
  console.log("[Auth] User state set immediately after login. Liked items count:", state.session.user.likedItemIds.size);
  console.log("[Auth] Full user state:", state.session.user);
  console.log("[Auth] Full likedItemIds Set:", Array.from(state.session.user.likedItemIds));
  const currentLikedItemIds = state.session.user.likedItemIds;
  let syncPromises = [];
  const tempLikesString = localStorage.getItem("tempLikes");
  console.log(`[Auth] ========== TEMP LIKES MERGE DEBUG START ==========`);
  console.log(`[Auth] TempLikes from localStorage:`, tempLikesString);
  if (tempLikesString) {
    try {
      const tempLikes = JSON.parse(tempLikesString);
      console.log(`[Auth] Parsed temp likes:`, tempLikes);
      if (Array.isArray(tempLikes) && tempLikes.length > 0) {
        console.log(`[Auth] Found ${tempLikes.length} temporary likes to sync.`);
        console.log(`[Auth] Current authenticated liked items:`, Array.from(currentLikedItemIds));
        tempLikes.forEach((itemId) => {
          if (!currentLikedItemIds.has(itemId)) {
            console.log(`[Auth] Syncing temporary like for item: ${itemId}`);
            syncPromises.push(
              toggleUserLike(itemId).then((result) => {
                console.log(`[Auth] Sync result for ${itemId}:`, result);
                if (result.success && result.liked) {
                  state.session.user.likedItemIds.add(itemId);
                  console.log(`[Auth] Added ${itemId} to user liked items`);
                }
              }).catch((err) => console.error(`[Auth] Error syncing like for item ${itemId}:`, err.message))
            );
          } else {
            console.log(`[Auth] Item ${itemId} already in user's liked items, skipping`);
          }
        });
      }
    } catch (e) {
      console.error("[Auth] Error parsing/processing temporary likes from localStorage:", e);
    } finally {
      localStorage.removeItem("tempLikes");
      console.log("[Auth] Cleared temporary likes from localStorage.");
    }
  } else {
    console.log("[Auth] No temporary likes found in localStorage");
  }
  console.log(`[Auth] ========== TEMP LIKES MERGE DEBUG END ==========`);
  await Promise.allSettled(syncPromises);
  console.log("[Auth] Like sync process finished.");
  console.log("[Auth] Final liked items count:", state.session.user.likedItemIds.size);
  console.log("[Auth] Final liked items:", Array.from(state.session.user.likedItemIds));
  console.log("[Auth] Final user state after sync:", state.session.user);
  console.log(`[Auth] ========== LOGIN DEBUG END ==========`);
  console.log("[Auth] Dispatching userLoggedIn event...");
  document.dispatchEvent(new CustomEvent("userLoggedIn"));
  console.log("[Auth] userLoggedIn event dispatched");
  console.log("[Auth] Updating user profile icon...");
  updateUserProfileIcon();
  console.log("[Auth] Hiding user modal...");
  hideUserModal();
  console.log("[Auth] ========== _handleSuccessfulLogin COMPLETE ==========");
}
function showUserModal() {
  console.log("[auth.js] showUserModal() called.");
  const user = state.session.user;
  const ownerDashboardLink = document.getElementById("owner-dashboard-link");
  const effectSelect = document.getElementById("effect-select");
  const effectControlsContainer = document.getElementById("effect-controls-container");
  if (user.isAuthenticated) {
    profileNameEl.textContent = user.name;
    profileEmailEl.textContent = user.email;
    profilePhoneInput.value = user.phoneNumber || "";
    profileNotificationsSelect.value = user.notificationFrequency || "None";
    prefsMessage.textContent = "";
    signinView.style.display = "none";
    profileView.style.display = "block";
    const adminProfileBtn = document.getElementById("admin-bulk-profile-btn");
    if (user.isOwner && user.ownerDashboardId) {
      ownerDashboardLink.href = `/store-dashboard.html?id=${user.ownerDashboardId}`;
      ownerDashboardLink.style.display = "block";
    } else {
      ownerDashboardLink.style.display = "none";
    }
  } else {
    signinEmailInput.value = localStorage.getItem("lastSignInEmail") || "";
    signinView.style.display = "block";
    profileView.style.display = "none";
    ownerDashboardLink.style.display = "none";
  }
  console.log(`[auth.js] Populating effects dropdown. Found ${effects.length} effects.`);
  console.log(`[auth.js] Checking IF condition...`);
  console.log(`[auth.js]   - effectSelect exists: ${!!effectSelect}`);
  console.log(`[auth.js]   - effectControlsContainer exists: ${!!effectControlsContainer}`);
  if (effectSelect) {
    console.log(`[auth.js]   - effectSelect.childElementCount: ${effectSelect.childElementCount}`);
  }
  if (effectSelect && effectControlsContainer && effectSelect.childElementCount === 0) {
    console.log("[auth.js] IF condition PASSED. Populating dropdown.");
    log("Auth", "Populating background effect tweaks for the first time.");
    effects.forEach((effect, index) => {
      console.log(`[auth.js] Adding effect to dropdown: ${effect.name}`);
      const option = document.createElement("option");
      option.value = index;
      option.textContent = effect.name;
      effectSelect.appendChild(option);
    });
    effectSelect.addEventListener("change", (e) => {
      const selectedEffect = effects[e.target.value];
      if (selectedEffect) {
        log("Auth", `User selected effect: ${selectedEffect.name}`);
        loadEffect(selectedEffect.plugin, effectControlsContainer);
      }
    });
    if (effects.length > 0 && effects[0].plugin) {
      console.log(`[auth.js] Loading default effect: ${effects[0].name}`);
      loadEffect(effects[0].plugin, effectControlsContainer);
    } else {
      console.log("[auth.js] No effects found in array to load as default.");
    }
  } else {
    console.log("[auth.js] IF condition FAILED. Dropdown will not be populated.");
  }
  userModalOverlay.classList.add("active");
  userModalOverlay.style.display = "flex";
  document.body.classList.add("modal-open");
}
function hideUserModal() {
  userModalOverlay.classList.remove("active");
  setTimeout(() => {
    userModalOverlay.style.display = "none";
  }, 300);
  document.body.classList.add("modal-open");
}
async function handleSignIn(e) {
  e.preventDefault();
  const email = signinEmailInput.value;
  log("Auth", `Sign-in initiated for: ${email}`);
  localStorage.setItem("lastSignInEmail", email);
  signinMessage.style.color = "#333";
  signinMessage.textContent = `Sending confirmation email...`;
  try {
    const response = await fetch("/api/auth-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, siteUrl: window.location.origin })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to send confirmation email.");
    }
    signinMessage.style.color = "#28a745";
    signinMessage.textContent = `A confirmation link has been sent to ${email}. Please check your inbox. Waiting for confirmation...`;
    signinEmailInput.value = "";
    const pusher2 = new Pusher("236f480714e5001590b5", {
      cluster: "us3",
      authEndpoint: "/api/pusher-auth"
    });
    const channelName = `private-auth-${data.channelId}`;
    const channel = pusher2.subscribe(channelName);
    const loginTimeout = setTimeout(() => {
      channel.unbind("auth-success");
      pusher2.unsubscribe(channelName);
      signinMessage.style.color = "#dc3545";
      signinMessage.textContent = "Login attempt timed out. Please try again.";
    }, 5 * 60 * 1e3);
    channel.bind("pusher:subscription_succeeded", () => {
      log("Auth", `Successfully subscribed to Pusher channel: ${channelName}`);
      channel.bind("auth-success", async (payload) => {
        clearTimeout(loginTimeout);
        pusher2.unsubscribe(channelName);
        await _handleSuccessfulLogin2(payload);
      });
    });
  } catch (error) {
    signinMessage.style.color = "#dc3545";
    signinMessage.textContent = error.message;
  }
}
var currentSmsPhoneNumber = null;
async function handleSmsSignIn(e) {
  console.log("[SMS-DEBUG] ========== handleSmsSignIn CALLED ==========");
  console.log("[SMS-DEBUG] Event object:", e);
  console.log("[SMS-DEBUG] Event type:", e == null ? void 0 : e.type);
  e.preventDefault();
  console.log("[SMS-DEBUG] preventDefault() called successfully");
  const phoneInput = document.getElementById("signin-phone");
  const smsMessage = document.getElementById("sms-message");
  const consentCheckbox = document.getElementById("sms-consent-checkbox");
  console.log("[SMS-DEBUG] Phone input element:", phoneInput);
  console.log("[SMS-DEBUG] SMS message element:", smsMessage);
  console.log("[SMS-DEBUG] Consent checkbox element:", consentCheckbox);
  const phoneNumber = phoneInput.value.trim();
  console.log("[SMS-DEBUG] Phone number value:", phoneNumber);
  console.log("[SMS-DEBUG] Consent checkbox checked:", consentCheckbox == null ? void 0 : consentCheckbox.checked);
  if (!phoneNumber) {
    console.log("[SMS-DEBUG] Phone number validation failed - empty");
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = "Please enter a phone number.";
    return;
  }
  if (!consentCheckbox || !consentCheckbox.checked) {
    console.log("[SMS-DEBUG] Consent validation failed - not checked");
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = "Please agree to receive SMS messages by checking the consent box.";
    return;
  }
  log("Auth", `SMS sign-in initiated for: ${phoneNumber}`);
  console.log("[SMS-DEBUG] Storing phone number to currentSmsPhoneNumber");
  currentSmsPhoneNumber = phoneNumber;
  smsMessage.style.color = "#333";
  smsMessage.textContent = "Sending SMS code...";
  console.log('[SMS-DEBUG] UI updated - showing "Sending SMS code..." message');
  try {
    console.log("[SMS-DEBUG] Starting fetch request to /api/auth-sms-start");
    console.log("[SMS-DEBUG] Request payload:", { phoneNumber });
    const response = await fetch("/api/auth-sms-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber })
    });
    console.log("[SMS-DEBUG] Fetch completed");
    console.log("[SMS-DEBUG] Response status:", response.status);
    console.log("[SMS-DEBUG] Response ok:", response.ok);
    console.log("[SMS-DEBUG] Response headers:", Object.fromEntries(response.headers.entries()));
    const data = await response.json();
    console.log("[SMS-DEBUG] Response data:", data);
    if (!response.ok) {
      console.log("[SMS-DEBUG] Response not OK, throwing error");
      const errorMessage = data.error || "Failed to send SMS code.";
      console.log("[SMS-DEBUG] Error message from server:", errorMessage);
      throw new Error(errorMessage);
    }
    console.log("[SMS-DEBUG] Success! Updating UI to show verification section");
    smsMessage.style.color = "#28a745";
    smsMessage.textContent = `A 6-digit code has been sent to ${phoneNumber}. Check your messages!`;
    const smsForm = document.getElementById("sms-signin-form");
    const verifySection = document.getElementById("sms-verify-section");
    console.log("[SMS-DEBUG] SMS form element:", smsForm);
    console.log("[SMS-DEBUG] Verify section element:", verifySection);
    smsForm.style.display = "none";
    verifySection.style.display = "block";
    console.log("[SMS-DEBUG] UI visibility updated - form hidden, verify section shown");
    const otpInput = document.getElementById("signin-otp");
    console.log("[SMS-DEBUG] OTP input element:", otpInput);
    otpInput.focus();
    console.log("[SMS-DEBUG] Focus set on OTP input");
    log("Auth", "SMS code sent successfully");
    console.log("[SMS-DEBUG] ========== handleSmsSignIn COMPLETED SUCCESSFULLY ==========");
  } catch (error) {
    console.error("[SMS-DEBUG] ========== ERROR IN handleSmsSignIn ==========");
    console.error("[SMS-DEBUG] Error object:", error);
    console.error("[SMS-DEBUG] Error message:", error.message);
    console.error("[SMS-DEBUG] Error stack:", error.stack);
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = error.message;
    log("Auth", `SMS error: ${error.message}`);
    console.log("[SMS-DEBUG] ========== handleSmsSignIn FAILED ==========");
  }
}
async function handleSmsVerify() {
  console.log("[SMS-DEBUG] ========== handleSmsVerify CALLED ==========");
  const otpInput = document.getElementById("signin-otp");
  const smsMessage = document.getElementById("sms-message");
  console.log("[SMS-DEBUG] OTP input element:", otpInput);
  console.log("[SMS-DEBUG] SMS message element:", smsMessage);
  const otpCode = otpInput.value.trim();
  console.log("[SMS-DEBUG] OTP code value:", otpCode);
  console.log("[SMS-DEBUG] OTP code length:", otpCode.length);
  if (!otpCode || otpCode.length !== 6) {
    console.log("[SMS-DEBUG] OTP validation failed - invalid length or empty");
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = "Please enter a valid 6-digit code.";
    return;
  }
  if (!currentSmsPhoneNumber) {
    console.log("[SMS-DEBUG] ERROR: currentSmsPhoneNumber is null or undefined");
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = "Phone number not found. Please start over.";
    return;
  }
  console.log("[SMS-DEBUG] Current phone number:", currentSmsPhoneNumber);
  log("Auth", `Verifying SMS code for: ${currentSmsPhoneNumber}`);
  smsMessage.style.color = "#333";
  smsMessage.textContent = "Verifying code...";
  console.log('[SMS-DEBUG] UI updated - showing "Verifying code..." message');
  try {
    console.log("[SMS-DEBUG] Starting fetch request to /api/auth-sms-verify");
    console.log("[SMS-DEBUG] Request payload:", { code: otpCode, phoneNumber: currentSmsPhoneNumber });
    const response = await fetch("/api/auth-sms-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: otpCode,
        phoneNumber: currentSmsPhoneNumber
      })
    });
    console.log("[SMS-DEBUG] Fetch completed");
    console.log("[SMS-DEBUG] Response status:", response.status);
    console.log("[SMS-DEBUG] Response ok:", response.ok);
    const data = await response.json();
    console.log("[SMS-DEBUG] Response data:", data);
    if (!response.ok) {
      console.log("[SMS-DEBUG] Response not OK, throwing error");
      throw new Error(data.error || "Invalid code. Please try again.");
    }
    console.log("[SMS-DEBUG] Verification successful!");
    smsMessage.style.color = "#28a745";
    smsMessage.textContent = "Success! Signing you in...";
    console.log("[SMS-DEBUG] Calling _handleSuccessfulLogin with data");
    await _handleSuccessfulLogin2(data);
    console.log("[SMS-DEBUG] _handleSuccessfulLogin completed");
    console.log("[SMS-DEBUG] Resetting SMS form UI");
    otpInput.value = "";
    currentSmsPhoneNumber = null;
    document.getElementById("sms-signin-form").style.display = "block";
    document.getElementById("sms-verify-section").style.display = "none";
    document.getElementById("signin-phone").value = "";
    log("Auth", "SMS authentication successful");
    console.log("[SMS-DEBUG] ========== handleSmsVerify COMPLETED SUCCESSFULLY ==========");
  } catch (error) {
    console.error("[SMS-DEBUG] ========== ERROR IN handleSmsVerify ==========");
    console.error("[SMS-DEBUG] Error object:", error);
    console.error("[SMS-DEBUG] Error message:", error.message);
    console.error("[SMS-DEBUG] Error stack:", error.stack);
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = error.message;
    log("Auth", `SMS verification error: ${error.message}`);
    console.log("[SMS-DEBUG] ========== handleSmsVerify FAILED ==========");
  }
}
async function handleResendSms() {
  console.log("[SMS-DEBUG] ========== handleResendSms CALLED ==========");
  const smsMessage = document.getElementById("sms-message");
  console.log("[SMS-DEBUG] SMS message element:", smsMessage);
  if (!currentSmsPhoneNumber) {
    console.log("[SMS-DEBUG] ERROR: currentSmsPhoneNumber is null or undefined");
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = "Phone number not found. Please start over.";
    return;
  }
  console.log("[SMS-DEBUG] Current phone number:", currentSmsPhoneNumber);
  log("Auth", `Resending SMS code to: ${currentSmsPhoneNumber}`);
  smsMessage.style.color = "#333";
  smsMessage.textContent = "Resending code...";
  console.log('[SMS-DEBUG] UI updated - showing "Resending code..." message');
  try {
    console.log("[SMS-DEBUG] Starting fetch request to /api/auth-sms-start");
    console.log("[SMS-DEBUG] Request payload:", { phoneNumber: currentSmsPhoneNumber });
    const response = await fetch("/api/auth-sms-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: currentSmsPhoneNumber })
    });
    console.log("[SMS-DEBUG] Fetch completed");
    console.log("[SMS-DEBUG] Response status:", response.status);
    console.log("[SMS-DEBUG] Response ok:", response.ok);
    const data = await response.json();
    console.log("[SMS-DEBUG] Response data:", data);
    if (!response.ok) {
      console.log("[SMS-DEBUG] Response not OK, throwing error");
      throw new Error(data.error || "Failed to resend SMS code.");
    }
    smsMessage.style.color = "#28a745";
    smsMessage.textContent = `New code sent to ${currentSmsPhoneNumber}!`;
    log("Auth", "SMS code resent successfully");
    console.log("[SMS-DEBUG] ========== handleResendSms COMPLETED SUCCESSFULLY ==========");
  } catch (error) {
    console.error("[SMS-DEBUG] ========== ERROR IN handleResendSms ==========");
    console.error("[SMS-DEBUG] Error object:", error);
    console.error("[SMS-DEBUG] Error message:", error.message);
    console.error("[SMS-DEBUG] Error stack:", error.stack);
    smsMessage.style.color = "#dc3545";
    smsMessage.textContent = error.message;
    log("Auth", `Resend SMS error: ${error.message}`);
    console.log("[SMS-DEBUG] ========== handleResendSms FAILED ==========");
  }
}
async function handleUpdateUserPrefs(e) {
  e.preventDefault();
  prefsMessage.textContent = "Saving...";
  prefsMessage.style.color = "#333";
  const token = localStorage.getItem("jwt");
  if (!token) {
    prefsMessage.textContent = "Authentication error. Please sign out and in again.";
    prefsMessage.style.color = "#dc3545";
    return;
  }
  const frequency = profileNotificationsSelect.value;
  const phone = profilePhoneInput.value;
  try {
    const response = await fetch("/api/update-user-prefs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
        // Send JWT token
      },
      // Send 'action' and prefs data
      body: JSON.stringify({
        action: "update-prefs",
        // Specify the action
        phone,
        frequency
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to save preferences.");
    }
    setState2({
      session: {
        ...state.session,
        user: { ...state.session.user, ...data.user }
      }
    });
    prefsMessage.textContent = data.message;
    prefsMessage.style.color = "#28a745";
  } catch (error) {
    prefsMessage.textContent = error.message;
    prefsMessage.style.color = "#dc3545";
  }
}
function handleSignOut2() {
  log("Auth", "User signed out.");
  localStorage.removeItem("jwt");
  localStorage.removeItem("tempLikes");
  setState2({
    session: {
      ...state.session,
      user: {
        isAuthenticated: false,
        id: null,
        name: "",
        email: "",
        amountReceived: 0,
        paymentHistory: [],
        rsvps: /* @__PURE__ */ new Set(),
        isOwner: false,
        ownerDashboardId: null,
        likedItemIds: /* @__PURE__ */ new Set()
        // Clear liked items
      }
    }
  });
  updateUserProfileIcon();
  hideUserModal();
  document.dispatchEvent(new CustomEvent("userLoggedOut"));
}
function updateUserProfileIcon() {
  if (state.session.user.isAuthenticated && state.session.user.name) {
    userProfileButton.classList.add("signed-in");
    userProfileButton.textContent = state.session.user.name.charAt(0).toUpperCase();
    userProfileButton.title = `Logged in as ${state.session.user.name}`;
  } else {
    userProfileButton.classList.remove("signed-in");
    userProfileButton.innerHTML = "&#128100;";
    userProfileButton.title = "Sign In / My Account";
  }
  const mySessionsHeaderBtn = document.getElementById("my-sessions-header-btn");
  if (mySessionsHeaderBtn) {
    mySessionsHeaderBtn.style.display = state.session.user.isAuthenticated ? "block" : "none";
  }
}
function setupAuthEventListeners() {
  userProfileButton.addEventListener("click", showUserModal);
  userModalCloseBtn.addEventListener("click", hideUserModal);
  signinForm.addEventListener("submit", handleSignIn);
  signoutBtn.addEventListener("click", handleSignOut2);
  userPrefsForm.addEventListener("submit", handleUpdateUserPrefs);
  userModalOverlay.addEventListener("click", (e) => {
    if (e.target === userModalOverlay) {
      hideUserModal();
    }
  });
  console.log("[SMS-DEBUG] ========== Setting up SMS event listeners ==========");
  const smsSigninForm = document.getElementById("sms-signin-form");
  const verifyOtpBtn = document.getElementById("verify-otp-btn");
  const resendSmsBtn = document.getElementById("resend-sms-btn");
  console.log("[SMS-DEBUG] sms-signin-form element:", smsSigninForm);
  console.log("[SMS-DEBUG] verify-otp-btn element:", verifyOtpBtn);
  console.log("[SMS-DEBUG] resend-sms-btn element:", resendSmsBtn);
  if (smsSigninForm) {
    console.log("[SMS-DEBUG] Attaching submit listener to sms-signin-form");
    smsSigninForm.addEventListener("submit", handleSmsSignIn);
    console.log("[SMS-DEBUG] Submit listener attached successfully");
  } else {
    console.warn("[SMS-DEBUG] WARNING: sms-signin-form element not found!");
  }
  if (verifyOtpBtn) {
    console.log("[SMS-DEBUG] Attaching click listener to verify-otp-btn");
    verifyOtpBtn.addEventListener("click", handleSmsVerify);
    console.log("[SMS-DEBUG] Click listener attached successfully");
  } else {
    console.warn("[SMS-DEBUG] WARNING: verify-otp-btn element not found!");
  }
  if (resendSmsBtn) {
    console.log("[SMS-DEBUG] Attaching click listener to resend-sms-btn");
    resendSmsBtn.addEventListener("click", handleResendSms);
    console.log("[SMS-DEBUG] Click listener attached successfully");
  } else {
    console.warn("[SMS-DEBUG] WARNING: resend-sms-btn element not found!");
  }
  const otpInput = document.getElementById("signin-otp");
  console.log("[SMS-DEBUG] signin-otp element:", otpInput);
  if (otpInput) {
    console.log("[SMS-DEBUG] Attaching keypress listener to signin-otp");
    otpInput.addEventListener("keypress", (e) => {
      console.log("[SMS-DEBUG] Keypress event in OTP input:", e.key);
      if (e.key === "Enter") {
        console.log("[SMS-DEBUG] Enter key detected - calling handleSmsVerify");
        e.preventDefault();
        handleSmsVerify();
      }
    });
    console.log("[SMS-DEBUG] Keypress listener attached successfully");
  } else {
    console.warn("[SMS-DEBUG] WARNING: signin-otp element not found!");
  }
  console.log("[SMS-DEBUG] ========== SMS event listeners setup complete ==========");
  if (typeof netlifyIdentity !== "undefined") {
    initializeNetlifyIdentity();
  } else {
    window.addEventListener("load", () => {
      if (typeof netlifyIdentity !== "undefined") {
        initializeNetlifyIdentity();
      } else {
        console.error("Netlify Identity widget failed to load");
      }
    });
  }
}
function initializeNetlifyIdentity() {
  console.log("[Auth] ========== NETLIFY IDENTITY INITIALIZATION START ==========");
  console.log("[Auth] Window.netlifyIdentity exists:", typeof netlifyIdentity !== "undefined");
  console.log("[Auth] Initializing Netlify Identity");
  console.log("[Auth] Calling netlifyIdentity.init()");
  netlifyIdentity.init({
    locale: "en"
  });
  console.log("[Auth] netlifyIdentity.init() completed");
  const googleSsoBtn = document.getElementById("google-sso-btn");
  console.log("[Auth] Google SSO button element found:", !!googleSsoBtn);
  if (googleSsoBtn) {
    googleSsoBtn.addEventListener("click", () => {
      console.log("[Auth] ========== GOOGLE SSO BUTTON CLICKED ==========");
      console.log("[Auth] Timestamp:", (/* @__PURE__ */ new Date()).toISOString());
      try {
        console.log("[Auth] Opening Netlify Identity modal...");
        netlifyIdentity.open("login");
        console.log("[Auth] Netlify Identity modal opened");
        netlifyIdentity.on("open", () => {
          const googleBtn = document.querySelector('.btnProvider[data-provider="google"]');
          if (googleBtn) {
            googleBtn.click();
          }
        });
      } catch (error) {
        console.error("[Auth] Error opening Google SSO:", error);
        signinMessage.textContent = "Error opening Google sign-in. Please try again.";
        signinMessage.style.color = "#dc3545";
      }
    });
  }
  netlifyIdentity.on("login", async (user) => {
    var _a, _b, _c;
    console.log("[Auth] ========== NETLIFY IDENTITY LOGIN EVENT ==========");
    console.log("[Auth] Timestamp:", (/* @__PURE__ */ new Date()).toISOString());
    console.log("[Auth] User object:", user);
    console.log("[Auth] User email:", user == null ? void 0 : user.email);
    console.log("[Auth] User token:", ((_a = user == null ? void 0 : user.token) == null ? void 0 : _a.access_token) ? "Present" : "Missing");
    try {
      const netlifyJwt = user.token.access_token;
      console.log("[Auth] Calling /api/auth-social with Netlify JWT...");
      console.log("[Auth] JWT (first 20 chars):", netlifyJwt.substring(0, 20) + "...");
      const response = await fetch("/api/auth-social", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${netlifyJwt}`
        }
      });
      console.log("[Auth] /api/auth-social response status:", response.status);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to sync social login.");
      }
      const appPayload = await response.json();
      console.log("[Auth] Received app payload from /api/auth-social:", appPayload);
      console.log("[Auth] App token present:", !!appPayload.token);
      console.log("[Auth] User data present:", !!appPayload.user);
      console.log("[Auth] Liked items count:", ((_c = (_b = appPayload.user) == null ? void 0 : _b.likedItemIds) == null ? void 0 : _c.length) || 0);
      console.log("[Auth] Calling _handleSuccessfulLogin...");
      await _handleSuccessfulLogin2(appPayload);
      console.log("[Auth] _handleSuccessfulLogin completed");
      console.log("[Auth] Closing Netlify Identity modal...");
      netlifyIdentity.close();
      console.log("[Auth] Modal closed");
      console.log("[Auth] ========== GOOGLE SSO LOGIN COMPLETE ==========");
    } catch (error) {
      console.error("[Auth] ========== SSO LOGIN ERROR ==========");
      console.error("[Auth] Error details:", error);
      console.error("[Auth] Error message:", error.message);
      console.error("[Auth] Error stack:", error.stack);
      signinMessage.textContent = "Error logging in with Google. Please try again.";
      signinMessage.style.color = "#dc3545";
      console.error("[Auth] ========== SSO LOGIN ERROR END ==========");
    }
  });
  netlifyIdentity.on("error", (error) => {
    console.error("[Auth] ========== NETLIFY IDENTITY ERROR ==========");
    console.error("[Auth] Error:", error);
    signinMessage.textContent = "Authentication error. Please try again.";
    signinMessage.style.color = "#dc3545";
    console.error("[Auth] ========== NETLIFY IDENTITY ERROR END ==========");
  });
  console.log("[Auth] ========== NETLIFY IDENTITY INITIALIZATION COMPLETE ==========");
}
console.log("[auth.js] 4. File execution finished. Exports are ready.");

// components/receipt.js
function showReceiptModal(paymentIndex) {
  log("Receipt", `Opening receipt in new window for payment index ${paymentIndex}`);
  const paymentHistory = state.session.user.paymentHistory || [];
  if (paymentIndex < 0 || paymentIndex >= paymentHistory.length) {
    console.error("Invalid payment index:", paymentIndex);
    return;
  }
  const payment = paymentHistory[paymentIndex];
  const sortedPayments = paymentHistory.map((p, originalIndex) => ({ ...p, originalIndex })).sort((a, b) => new Date(a.date) - new Date(b.date));
  const displayIndex = sortedPayments.findIndex((p) => p.originalIndex === paymentIndex);
  const receiptNumber = `${state.session.id.substring(0, 8).toUpperCase()}-${displayIndex + 1}`;
  const paymentDate = new Date(payment.date);
  const formattedDate = paymentDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "Untitled Event";
  let isUmwInPlan = false;
  for (const [id] of state.cart.lockedItems) {
    const lockedRecord = state.records.all.find((r) => r.id === id);
    if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
      isUmwInPlan = true;
      break;
    }
  }
  let itemsHtml = "";
  let itemsSubtotal = 0;
  for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    const quantity = itemInfo.quantity || 1;
    const itemTotal = unitPrice * quantity;
    itemsSubtotal += itemTotal;
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const effectiveMin = getEffectiveMinQuantity(record);
    let edgeCaseNote = "";
    if (airtableMin > 1) {
      if (!isUmwInPlan && quantity === effectiveMin) {
        edgeCaseNote = '<br><small style="color: #fd7e14; font-style: italic;">* At minimum headcount for off-site event</small>';
      } else if (isUmwInPlan && quantity < airtableMin) {
        edgeCaseNote = '<br><small style="color: #28a745; font-style: italic;">✓ Below standard minimum (Union Machine Works venue)</small>';
      }
    }
    itemsHtml += `
            <tr>
                <td>${record.fields.Name}${edgeCaseNote}</td>
                <td style="text-align: center;">${quantity}</td>
                <td style="text-align: right;">$${unitPrice.toFixed(2)}</td>
                <td style="text-align: right;">$${itemTotal.toFixed(2)}</td>
            </tr>
        `;
  }
  let previousPaymentsTotal = 0;
  const previousPayments = [];
  for (let i = 0; i < displayIndex; i++) {
    previousPaymentsTotal += sortedPayments[i].amount;
    previousPayments.push(sortedPayments[i]);
  }
  const isFullPayment = payment.amount >= itemsSubtotal;
  const paymentTypeLabel = isFullPayment ? "Full Payment" : displayIndex === 0 ? "Deposit (35%)" : "Partial Payment";
  const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Receipt #${receiptNumber}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            padding: 40px 20px;
            background-color: #f5f5f5;
            color: #333;
        }
        .receipt-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .receipt-header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .receipt-header h1 {
            font-size: 32px;
            margin-bottom: 10px;
        }
        .receipt-number {
            font-size: 14px;
            color: #666;
            font-weight: 600;
        }
        .receipt-info {
            margin-bottom: 30px;
        }
        .receipt-info-row {
            display: flex;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .receipt-info-row .label {
            font-weight: 600;
            width: 150px;
        }
        .receipt-info-row .value {
            flex: 1;
        }
        .receipt-items {
            margin-bottom: 30px;
        }
        .receipt-items h2 {
            font-size: 20px;
            margin-bottom: 15px;
        }
        .receipt-table {
            width: 100%;
            border-collapse: collapse;
        }
        .receipt-table th,
        .receipt-table td {
            padding: 12px;
            border-bottom: 1px solid #eee;
        }
        .receipt-table th {
            background-color: #f8f9fa;
            font-weight: 600;
            text-align: left;
        }
        .receipt-totals {
            border-top: 2px solid #333;
            padding-top: 20px;
            margin-bottom: 30px;
        }
        .receipt-total-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 16px;
        }
        .receipt-total-row.payment-amount {
            font-size: 20px;
            font-weight: bold;
            color: #28a745;
            border-top: 2px solid #ddd;
            padding-top: 15px;
            margin-top: 10px;
        }
        .receipt-note {
            margin-top: 15px;
            padding: 15px;
            background-color: #f8f9fa;
            border-left: 3px solid #007bff;
            font-style: italic;
        }
        .receipt-footer {
            text-align: center;
            padding-top: 30px;
            border-top: 2px solid #333;
        }
        .receipt-footer p {
            font-size: 18px;
            margin-bottom: 20px;
        }
        .print-button {
            background-color: #007bff;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            margin-right: 10px;
        }
        .print-button:hover {
            background-color: #0056b3;
        }
        .close-button {
            background-color: #6c757d;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
        }
        .close-button:hover {
            background-color: #545b62;
        }
        .previous-payments-section {
            margin-top: 15px;
            padding: 15px;
            background-color: #e7f3ff;
            border-left: 3px solid #007bff;
        }
        .previous-payments-section h3 {
            font-size: 16px;
            margin-bottom: 10px;
            color: #0056b3;
        }
        .previous-payment-item {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            font-size: 14px;
        }
        .view-receipt-link {
            color: #007bff;
            text-decoration: underline;
            cursor: pointer;
            font-size: 14px;
            background: none;
            border: none;
            padding: 0;
            margin-left: 10px;
        }
        .view-receipt-link:hover {
            color: #0056b3;
        }
        @media print {
            body {
                background-color: white;
                padding: 0;
            }
            .receipt-container {
                box-shadow: none;
                padding: 20px;
            }
            .print-button,
            .close-button,
            .view-receipt-link {
                display: none;
            }
        }
    </style>
    <script>
        function openEarlierReceipt(originalIndex) {
            // Call the parent window's showReceiptModal function
            if (window.opener && window.opener.showReceiptModal) {
                window.opener.showReceiptModal(originalIndex);
            }
        }
    <\/script>
</head>
<body>
    <div class="receipt-container">
        <div class="receipt-header">
            <h1>Payment Receipt</h1>
            <div class="receipt-number">Receipt #${receiptNumber}</div>
        </div>
        
        <div class="receipt-info">
            <div class="receipt-info-row">
                <span class="label">Event:</span>
                <span class="value">${eventName}</span>
            </div>
            <div class="receipt-info-row">
                <span class="label">Payment Date:</span>
                <span class="value">${formattedDate}</span>
            </div>
            <div class="receipt-info-row">
                <span class="label">Payment Type:</span>
                <span class="value">${paymentTypeLabel}</span>
            </div>
        </div>
        
        <div class="receipt-items">
            <h2>Plan Items</h2>
            <table class="receipt-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th style="text-align: center;">Qty</th>
                        <th style="text-align: right;">Unit Price</th>
                        <th style="text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
        </div>
        
        <div class="receipt-totals">
            <div class="receipt-total-row">
                <span class="label">Plan Subtotal:</span>
                <span class="value">$${itemsSubtotal.toFixed(2)}</span>
            </div>
            ${previousPaymentsTotal > 0 ? `
            <div class="receipt-total-row">
                <span class="label">Previous Payments:</span>
                <span class="value">-$${previousPaymentsTotal.toFixed(2)}</span>
            </div>
            <div class="receipt-total-row">
                <span class="label">Subtotal After Previous Payments:</span>
                <span class="value">$${(itemsSubtotal - previousPaymentsTotal).toFixed(2)}</span>
            </div>
            ` : ""}
            <div class="receipt-total-row payment-amount">
                <span class="label">Payment Amount:</span>
                <span class="value">$${payment.amount.toFixed(2)}</span>
            </div>
            ${payment.note ? `<div class="receipt-note">${payment.note}</div>` : ""}
            ${previousPayments.length > 0 ? `
            <div class="previous-payments-section">
                <h3>Previous Payments:</h3>
                ${previousPayments.map((prevPayment, idx) => {
    const prevPaymentDate = new Date(prevPayment.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    return `
                    <div class="previous-payment-item">
                        <span>Payment ${idx + 1} - ${prevPaymentDate}: $${prevPayment.amount.toFixed(2)}</span>
                        <button class="view-receipt-link" onclick="openEarlierReceipt(${prevPayment.originalIndex})">View Receipt</button>
                    </div>`;
  }).join("")}
            </div>
            ` : ""}
        </div>
        
        <div class="receipt-footer">
            <p>Thank you for your payment!</p>
            <button onclick="window.print()" class="print-button">Print Receipt</button>
            <button onclick="window.close()" class="close-button">Close Window</button>
        </div>
    </div>
</body>
</html>
    `;
  const receiptWindow = window.open("", "_blank", "width=900,height=800,menubar=no,toolbar=no,location=no,status=no");
  if (receiptWindow) {
    receiptWindow.document.write(receiptHtml);
    receiptWindow.document.close();
    receiptWindow.focus();
  } else {
    console.error("Failed to open receipt window. Pop-up may have been blocked.");
    alert("Please allow pop-ups for this site to view receipts.");
  }
}

// events.js
var mainDatePicker = null;
var saveTimeout = null;
var saveShareBtn = null;
var aiSearchController = null;
function handleUmwAddition() {
  let adjustedItems = [];
  for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    if (record.fields.Name && record.fields.Name.includes("Union Machine Works")) continue;
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const lastAttempted = itemInfo.lastAttemptedQuantity || itemInfo.quantity;
    if (airtableMin > 1 && itemInfo.quantity === airtableMin && lastAttempted < airtableMin) {
      itemInfo.quantity = lastAttempted;
      state.cart.lockedItems.set(recordId, itemInfo);
      adjustedItems.push(record.fields.Name);
    }
  }
  if (adjustedItems.length > 0) {
    showEventPlanNotification(`Headcounts reduced to quantity requested per Union Machine Works inclusion in plan.`);
    updateEventPlanSection();
    updateTotalCost();
  }
}
function handleUmwRemoval() {
  let adjustedItems = [];
  for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    if (airtableMin > 1 && itemInfo.quantity < airtableMin) {
      itemInfo.lastAttemptedQuantity = itemInfo.quantity;
      itemInfo.quantity = airtableMin;
      state.cart.lockedItems.set(recordId, itemInfo);
      adjustedItems.push(record.fields.Name);
    }
  }
  if (adjustedItems.length > 0) {
    showEventPlanNotification(`Headcount adjusted to min per Union Machine Works removal.`);
    updateEventPlanSection();
    updateTotalCost();
  }
}
function loadMoreRecords(imageCache2) {
  if (state.ui.isLoadingMore) return;
  const start = state.ui.recordsCurrentlyDisplayed;
  const end = start + RECORDS_PER_LOAD;
  const recordsToLoad = state.records.filtered.slice(start, end);
  if (recordsToLoad.length > 0) {
    state.ui.isLoadingMore = true;
    renderRecords(recordsToLoad, imageCache2, true).then(() => {
      state.ui.recordsCurrentlyDisplayed += recordsToLoad.length;
      state.ui.isLoadingMore = false;
    });
  }
}
function updateSaveShareButton() {
  if (!saveShareBtn) return;
  switch (state.ui.saveState) {
    case "MODIFIED":
      saveShareBtn.textContent = "Changes pending...";
      saveShareBtn.disabled = true;
      saveShareBtn.dataset.tooltip = "Saving your changes automatically...";
      break;
    case "SAVING":
      saveShareBtn.textContent = "⚙️ Saving...";
      saveShareBtn.disabled = true;
      saveShareBtn.dataset.tooltip = "Saving your changes...";
      break;
    case "SAVED":
      saveShareBtn.textContent = "\u{1F517} Copy Link";
      const hasContent = state.cart.items.size > 0 || state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0;
      saveShareBtn.disabled = !hasContent;
      saveShareBtn.dataset.tooltip = !hasContent ? "Add items or details to enable sharing" : "Copy a shareable link to this plan";
      break;
  }
}
function triggerSave() {
  if (state.ui.isInitializing) return;
  clearTimeout(saveTimeout);
  state.ui.saveState = "MODIFIED";
  updateSaveShareButton();
  saveTimeout = setTimeout(async () => {
    state.ui.saveState = "SAVING";
    updateSaveShareButton();
    const success = await saveSessionToAirtable();
    if (success) {
      state.ui.saveState = "SAVED";
      updateSaveShareButton();
    }
  }, 1500);
}
async function updateAllCardAvailabilityIcons() {
  console.log("[updateAllCardAvailabilityIcons] Called");
  console.log("[updateAllCardAvailabilityIcons] mainDatePicker:", mainDatePicker);
  console.log("[updateAllCardAvailabilityIcons] mainDatePicker?.selectedDates:", mainDatePicker == null ? void 0 : mainDatePicker.selectedDates);
  const allAvailabilityBtns = document.querySelectorAll(".availability-btn");
  console.log("[updateAllCardAvailabilityIcons] Found .availability-btn elements:", allAvailabilityBtns.length);
  if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
    console.log("[updateAllCardAvailabilityIcons] No date range selected, setting all icons to calendar emoji");
    document.querySelectorAll(".availability-btn").forEach((icon) => {
      if (icon._tippy) icon._tippy.destroy();
      icon.title = "Select a date range to check availability";
      icon.textContent = "\u{1F4C5}";
      console.log("[updateAllCardAvailabilityIcons] Set icon to \u{1F4C5}:", icon);
    });
    return;
  }
  const startDate = mainDatePicker.selectedDates[0];
  const requestedEnd = mainDatePicker.selectedDates[1];
  console.log("[updateAllCardAvailabilityIcons] Date range selected:", startDate, "to", requestedEnd);
  const cards = document.querySelectorAll(".event-card");
  console.log("[updateAllCardAvailabilityIcons] Found event cards:", cards.length);
  for (const card of cards) {
    const recordId = card.dataset.recordId;
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    const busyTimes = await fetchCalendarForRecord(record);
    const rangeStatus = getRangeStatus(startDate, requestedEnd, record, busyTimes);
    const icon = card.querySelector(".availability-btn");
    console.log("[updateAllCardAvailabilityIcons] Card recordId:", recordId, "icon found:", !!icon, "status:", rangeStatus.status);
    if (icon) {
      if (icon._tippy) icon._tippy.destroy();
      let statusIcon;
      switch (rangeStatus.status) {
        case AVAILABILITY_STATUS.FULL:
          statusIcon = "✅";
          break;
        case AVAILABILITY_STATUS.PARTIAL:
          statusIcon = "\u{1F7E0}";
          break;
        case AVAILABILITY_STATUS.NONE:
          statusIcon = "❌";
          break;
        default:
          statusIcon = "\u{1F4C5}";
      }
      const dateRangeString = `${startDate.toLocaleDateString()} - ${requestedEnd.toLocaleDateString()}`;
      const tooltipContent = `<div style="text-align: left;"><strong>${dateRangeString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${rangeStatus.reason}</span></div>`;
      tippy(icon, { content: tooltipContent, allowHTML: true, placement: "top", arrow: true });
      icon.title = rangeStatus.reason;
      icon.textContent = statusIcon;
    }
  }
}
async function handlePaymentFormSubmit(event) {
  event.preventDefault();
  log("Events", "Payment form submitted.");
  const submitBtn = document.getElementById("payment-submit-btn");
  const buttonText = submitBtn.querySelector(".button-text");
  const spinner = submitBtn.querySelector(".spinner");
  const cardErrors = document.getElementById("card-errors");
  cardErrors.textContent = "";
  submitBtn.disabled = true;
  buttonText.style.display = "none";
  spinner.style.display = "inline";
  const { stripe: stripe2, elements: elements2 } = getStripeContext();
  if (!stripe2 || !elements2) {
    cardErrors.textContent = "Payment system is not initialized. Please close and reopen the checkout window.";
    submitBtn.disabled = false;
    buttonText.style.display = "inline";
    spinner.style.display = "none";
    return;
  }
  try {
    const customerName = document.getElementById("customer-name").value;
    const customerEmail = document.getElementById("customer-email").value;
    const { error, paymentIntent } = await stripe2.confirmPayment({
      elements: elements2,
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}?payment_success=true`,
        payment_method_data: {
          billing_details: {
            name: customerName,
            email: customerEmail
          }
        }
      },
      redirect: "if_required"
    });
    if (error) {
      if (error.type === "card_error" || error.type === "validation_error") {
        let userMessage = error.message;
        if (error.code === "card_declined") {
          userMessage = "Your card was declined. Please try another payment method.";
        } else if (error.code === "insufficient_funds") {
          userMessage = "Insufficient funds. Please use a different card.";
        } else if (error.code === "expired_card") {
          userMessage = "Your card has expired. Please use a different card.";
        } else if (error.code === "incorrect_cvc") {
          userMessage = "The security code (CVC) is incorrect. Please check and try again.";
        } else if (error.code === "processing_error") {
          userMessage = "An error occurred while processing your card. Please try again.";
        }
        throw new Error(userMessage);
      } else {
        console.error("Stripe confirmPayment error:", error);
        throw new Error("An unexpected error occurred during payment. Please try again or contact support.");
      }
    }
    if (paymentIntent.status === "succeeded") {
      log("Events", "Payment succeeded.");
      const amountPaid = paymentIntent.amount / 100;
      const newPayment = {
        amount: amountPaid,
        date: (/* @__PURE__ */ new Date()).toISOString(),
        note: `Stripe Payment on ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`
      };
      const updatedPaymentHistory = [...state.session.user.paymentHistory, newPayment];
      await updatePaymentHistory(state.session.id, updatedPaymentHistory);
      state.session.user.paymentHistory = updatedPaymentHistory;
      state.session.user.amountReceived = updatedPaymentHistory.reduce((sum, p) => sum + p.amount, 0);
      updateTotalCost();
      document.getElementById("payment-form").style.display = "none";
      document.getElementById("checkout-summary-details").style.display = "none";
      document.querySelector(".checkout-total-deposit-section").style.display = "none";
      const feeRow = document.querySelector(".processing-fee-row");
      const totalRow = document.querySelector(".final-total-row");
      const divider = document.querySelector(".total-divider");
      if (feeRow) feeRow.style.display = "none";
      if (totalRow) totalRow.style.display = "none";
      if (divider) divider.style.display = "none";
      document.querySelector(".terms-and-conditions").style.display = "none";
      document.getElementById("payment-success-message").style.display = "block";
      setTimeout(() => {
        hideCheckoutModal();
      }, 4e3);
    }
  } catch (err) {
    log("Events", `Stripe payment error: ${err.message}`);
    cardErrors.textContent = err.message;
    submitBtn.disabled = false;
    buttonText.style.display = "inline";
    spinner.style.display = "none";
  }
}
async function handleProactiveAISearch(searchTerm, imageCache2) {
  if (aiSearchController) {
    aiSearchController.abort();
  }
  aiSearchController = new AbortController();
  const signal = aiSearchController.signal;
  const catalogContainer = document.getElementById("catalog-container");
  if (!catalogContainer) return;
  const ghostRecord = {
    id: `ai-search-${Date.now()}`,
    fields: {
      Name: `Searching for "${searchTerm}"...`,
      Description: "Our AI is looking for this item in the Bay Area...",
      Price: 0,
      "Item Type": "Bookable Item",
      ServiceType: "Partner Activity",
      Status: "Available"
    }
  };
  const ghostCard = await createInteractiveCard(ghostRecord, [], imageCache2);
  ghostCard.id = "ai-ghost-card";
  ghostCard.style.opacity = "0.5";
  ghostCard.style.pointerEvents = "none";
  catalogContainer.innerHTML = "";
  catalogContainer.appendChild(ghostCard);
  try {
    log("Events", "WORKAROUND: Simulating Proactive AI search for:", searchTerm);
    await new Promise((res) => setTimeout(res, 1500));
    if (signal.aborted) return;
    const webData = {
      Name: `[DUMMY] ${searchTerm}`,
      Description: "This is a dummy item. The real AI-parsed description will go here.",
      Price: Math.floor(Math.random() * 100) + 10,
      ServiceType: "Partner Activity"
    };
    log("Events", "Proactive AI Parse Success:", webData);
    const customId = `custom-${Date.now()}`;
    const liveRecord = {
      id: customId,
      fields: {
        Name: webData.Name,
        Description: webData.Description,
        Price: webData.Price,
        ServiceType: webData.ServiceType,
        "Item Type": "Bookable Item",
        Status: "Available",
        Rankings: JSON.stringify({
          "profileSource": "ai_v1_dummy_profile",
          "Pillars": { "Activities": 10, "Food/Drink": 0, "Venue": 0, "Extras": 0 },
          "Vibe": { "Energy": 8, "Relaxation": 2, "Formality": 3, "Novelty": 9 },
          "Intellect": { "Creative": 5, "Analytical": 5 },
          "Physicality": { "Intensity": 5, "Accessibility": 5 },
          "Tags": [searchTerm.toLowerCase(), "dummy", "partner activity"]
        }),
        Options: null,
        "Parent Item": null,
        "Pricing Type": "per person",
        "Headcount min": null,
        "Media Tags": null,
        "Curated Images": null,
        Subcategories: null,
        "iCal URL": null,
        "Lead Time (days)": null,
        RSVPs: null,
        Date: null,
        "Chat Enabled": false,
        Duration: null,
        Capacity: null,
        "Location Details": null,
        "Additional Information": null
      }
    };
    state.records.all.push(liveRecord);
    const finalCard = await createInteractiveCard(liveRecord, [], imageCache2);
    const addToPlanBtn = finalCard.querySelector(".add-to-plan-btn");
    if (addToPlanBtn) {
      addToPlanBtn.textContent = "Add to Plan";
      addToPlanBtn.disabled = false;
      const newBtn = addToPlanBtn.cloneNode(true);
      addToPlanBtn.parentNode.replaceChild(newBtn, addToPlanBtn);
      newBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        log("Events", `Adding AI-parsed item: ${customId}`);
        state.cart.lockedItems.set(customId, {
          quantity: 1,
          selectedOptionIndex: 0,
          note: `Added via AI search for: "${searchTerm}"`
        });
        updateProgress(2e-4);
        updateEventPlanSection();
        updateTotalCost();
        triggerSave();
        newBtn.textContent = "Update Plan";
        newBtn.disabled = true;
      });
    }
    catalogContainer.innerHTML = "";
    catalogContainer.appendChild(finalCard);
  } catch (err) {
    if (err.name === "AbortError") {
      log("Events", "AI search aborted by new search.");
      return;
    }
    log("Events", `Proactive AI parse error: ${err.message}`);
    catalogContainer.innerHTML = `<p style='text-align: center;'>Could not find "${searchTerm}". Please try a different name or URL.</p>`;
  } finally {
    aiSearchController = null;
  }
}
function initializeEventListeners(imageCache2, flatpickr, shopSettings) {
  var _a;
  console.group("[DEBUG] Initial Layout State - Page Load");
  console.log("Window width:", window.innerWidth);
  console.log("Window height:", window.innerHeight);
  const mainContent = document.querySelector(".main-content");
  const searchBarContainer = document.getElementById("search-bar-container");
  const leftSidebar = document.getElementById("left-sidebar");
  const rightSidebar = document.getElementById("right-sidebar");
  const catalogArea = document.getElementById("catalog-area");
  const filterControls = document.getElementById("filter-controls");
  console.log("\n=== DOM Element Order (in .main-content) ===");
  if (mainContent) {
    Array.from(mainContent.children).forEach((child, index) => {
      console.log(`  ${index}: #${child.id || "no-id"} (tag: ${child.tagName})`);
    });
  }
  console.log("\n=== CSS Grid Layout ===");
  if (mainContent) {
    const mainStyles = getComputedStyle(mainContent);
    console.log("Main Content computed styles:", {
      display: mainStyles.display,
      gridTemplateColumns: mainStyles.gridTemplateColumns,
      gridTemplateRows: mainStyles.gridTemplateRows,
      gap: mainStyles.gap
    });
  }
  console.log("\n=== Search Bar Container ===");
  if (searchBarContainer) {
    const searchStyles = getComputedStyle(searchBarContainer);
    console.log("Search Bar Container:", {
      display: searchStyles.display,
      position: searchStyles.position,
      gridColumn: searchStyles.gridColumn,
      gridRow: searchStyles.gridRow,
      order: searchStyles.order,
      top: searchStyles.top,
      zIndex: searchStyles.zIndex
    });
  } else {
    console.warn("#search-bar-container NOT FOUND in DOM");
  }
  console.log("\n=== Left Sidebar (#left-sidebar) ===");
  if (leftSidebar) {
    const leftStyles = getComputedStyle(leftSidebar);
    console.log("Left Sidebar:", {
      display: leftStyles.display,
      position: leftStyles.position,
      gridColumn: leftStyles.gridColumn,
      gridRow: leftStyles.gridRow,
      order: leftStyles.order,
      maxHeight: leftStyles.maxHeight,
      opacity: leftStyles.opacity,
      classes: leftSidebar.className
    });
  }
  console.log("\n=== Right Sidebar (#right-sidebar) ===");
  if (rightSidebar) {
    const rightStyles = getComputedStyle(rightSidebar);
    console.log("Right Sidebar:", {
      display: rightStyles.display,
      position: rightStyles.position,
      gridColumn: rightStyles.gridColumn,
      gridRow: rightStyles.gridRow,
      order: rightStyles.order
    });
  }
  console.log("\n=== Catalog Area (#catalog-area) ===");
  if (catalogArea) {
    const catalogStyles = getComputedStyle(catalogArea);
    console.log("Catalog Area:", {
      display: catalogStyles.display,
      position: catalogStyles.position,
      gridColumn: catalogStyles.gridColumn,
      gridRow: catalogStyles.gridRow,
      order: catalogStyles.order
    });
  }
  console.log("\n=== Filter Controls (#filter-controls) ===");
  if (filterControls) {
    const filterStyles = getComputedStyle(filterControls);
    console.log("Filter Controls:", {
      display: filterStyles.display,
      position: filterStyles.position,
      width: filterStyles.width,
      height: filterStyles.height,
      parentElement: ((_a = filterControls.parentElement) == null ? void 0 : _a.id) || "no-parent-id"
    });
  }
  console.groupEnd();
  const safeAddEventListener = (selector, event, handler) => {
    const element = document.getElementById(selector);
    if (element) element.addEventListener(event, handler);
    else console.warn(`Element with ID "${selector}" not found.`);
  };
  if (window.innerWidth < 1e3) {
    leftSidebar == null ? void 0 : leftSidebar.classList.add("collapsed");
    rightSidebar == null ? void 0 : rightSidebar.classList.add("collapsed");
  }
  const filterToggleBtn = document.getElementById("filter-toggle-btn");
  if (filterToggleBtn) {
    filterToggleBtn.addEventListener("click", () => {
      const isExpanded = filterToggleBtn.getAttribute("aria-expanded") === "true";
      filterToggleBtn.setAttribute("aria-expanded", !isExpanded);
      leftSidebar == null ? void 0 : leftSidebar.classList.toggle("collapsed");
      console.group("[DEBUG] Filter Toggle Layout Info");
      console.log("Window width:", window.innerWidth);
      console.log("Filter toggle aria-expanded:", !isExpanded);
      console.log("Left sidebar collapsed:", leftSidebar == null ? void 0 : leftSidebar.classList.contains("collapsed"));
      const mainContent2 = document.querySelector(".main-content");
      const searchBarContainer2 = document.getElementById("search-bar-container");
      const filterControls2 = document.getElementById("filter-controls");
      const catalogArea2 = document.getElementById("catalog-area");
      if (mainContent2) {
        const mainStyles = getComputedStyle(mainContent2);
        console.log("Main Content:", {
          display: mainStyles.display,
          gridTemplateColumns: mainStyles.gridTemplateColumns,
          gridTemplateRows: mainStyles.gridTemplateRows,
          gap: mainStyles.gap
        });
      }
      if (searchBarContainer2) {
        const searchStyles = getComputedStyle(searchBarContainer2);
        console.log("Search Bar Container:", {
          position: searchStyles.position,
          top: searchStyles.top,
          gridColumn: searchStyles.gridColumn,
          order: searchStyles.order,
          display: searchStyles.display
        });
      }
      if (leftSidebar) {
        const leftStyles = getComputedStyle(leftSidebar);
        console.log("Left Sidebar:", {
          display: leftStyles.display,
          maxHeight: leftStyles.maxHeight,
          opacity: leftStyles.opacity,
          order: leftStyles.order,
          gridColumn: leftStyles.gridColumn
        });
      }
      if (filterControls2) {
        const filterStyles = getComputedStyle(filterControls2);
        console.log("Filter Controls:", {
          display: filterStyles.display,
          position: filterStyles.position,
          width: filterStyles.width,
          height: filterStyles.height
        });
      }
      if (catalogArea2) {
        const catalogStyles = getComputedStyle(catalogArea2);
        console.log("Catalog Area:", {
          order: catalogStyles.order,
          gridColumn: catalogStyles.gridColumn,
          width: catalogStyles.width
        });
      }
      console.log("DOM Order of children in .main-content:");
      mainContent2 == null ? void 0 : mainContent2.childNodes.forEach((child, index) => {
        if (child.nodeType === 1) {
          console.log(`  ${index}: #${child.id || "no-id"} (${child.className})`);
        }
      });
      console.groupEnd();
    });
  }
  const nameFilterInput = document.getElementById("name-filter");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  if (nameFilterInput && clearSearchBtn) {
    nameFilterInput.addEventListener("input", () => {
      clearSearchBtn.style.display = nameFilterInput.value.trim() ? "block" : "none";
    });
    clearSearchBtn.style.display = nameFilterInput.value.trim() ? "block" : "none";
  }
  safeAddEventListener("mobile-filter-trigger", "click", () => {
    if (window.innerWidth < 1e3) {
      leftSidebar == null ? void 0 : leftSidebar.classList.toggle("collapsed");
    }
  });
  safeAddEventListener("mobile-view-plan-btn", "click", () => {
    var _a2;
    const isCurrentlyCollapsed = rightSidebar == null ? void 0 : rightSidebar.classList.contains("collapsed");
    rightSidebar == null ? void 0 : rightSidebar.classList.toggle("collapsed");
    if (isCurrentlyCollapsed) {
      setTimeout(() => {
        rightSidebar == null ? void 0 : rightSidebar.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    } else {
      (_a2 = document.getElementById("catalog-area")) == null ? void 0 : _a2.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  saveShareBtn = document.getElementById("save-share-btn");
  let debugEnabled = false;
  const betaTrigger = document.getElementById("beta-trigger");
  if (betaTrigger) {
    betaTrigger.addEventListener("click", () => {
      debugEnabled = !debugEnabled;
      setDebugMode(debugEnabled);
      log("Debug", `Debug mode is now ${debugEnabled ? "ON" : "OFF"}.`);
    });
  }
  let scrollTimeout;
  window.addEventListener("scroll", () => {
    if (scrollTimeout) return;
    scrollTimeout = setTimeout(() => {
      const buffer = 300;
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - buffer && !state.ui.isLoadingMore) {
        loadMoreRecords(imageCache2);
      }
      scrollTimeout = null;
    }, 100);
  }, { passive: true });
  const categoryFiltersRoot = document.getElementById("category-filters");
  if (categoryFiltersRoot) {
    const activeShop = state.stores.all.find((s) => s.id === state.ui.activeShopId);
    const hasStoreCategories = activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0;
    if (hasStoreCategories) {
      const itemRecordIds = Array.isArray(activeShop.fields.Items) ? activeShop.fields.Items : activeShop.fields.Items.split(",").map((id) => id.trim());
      let firstCategoryButton = true;
      itemRecordIds.forEach((recordId) => {
        if (!recordId.startsWith("rec")) return;
        const categoryRecord = state.records.all.find((r) => r.id === recordId);
        if (categoryRecord && categoryRecord.fields && categoryRecord.fields.Name) {
          const categoryName = categoryRecord.fields.Name;
          const categoryBtn = document.createElement("button");
          categoryBtn.className = "filter-btn category-filter-btn";
          const normalizedCategoryName = categoryName.toLowerCase().replace(/\s+/g, " ");
          categoryBtn.dataset.filter = normalizedCategoryName;
          categoryBtn.textContent = categoryName;
          if (firstCategoryButton) {
            categoryBtn.classList.add("active");
            firstCategoryButton = false;
          }
          categoryBtn.addEventListener("click", () => {
            document.querySelectorAll("#category-filters .filter-btn").forEach((btn) => btn.classList.remove("active"));
            categoryBtn.classList.add("active");
            updateUrl2({ category: normalizedCategoryName, subcategory: null, view: null });
            applyFiltersAndSort(imageCache2);
          });
          categoryFiltersRoot.appendChild(categoryBtn);
        }
      });
    } else {
      const allButton = document.createElement("button");
      allButton.className = "filter-btn category-filter-btn active";
      allButton.dataset.filter = "all";
      allButton.textContent = "All";
      allButton.addEventListener("click", () => {
        document.querySelectorAll("#category-filters .filter-btn").forEach((btn) => btn.classList.remove("active"));
        allButton.classList.add("active");
        updateUrl2({ category: null, subcategory: null, view: null });
        applyFiltersAndSort(imageCache2);
      });
      categoryFiltersRoot.appendChild(allButton);
    }
  } else {
    console.warn("Could not find #category-filters container to add category buttons.");
  }
  const catalogHeaderBtn = document.getElementById("catalog-header-btn");
  const myPlanHeaderBtn = document.getElementById("my-plan-header-btn");
  const likedItemsHeaderBtn = document.getElementById("liked-items-header-btn");
  const mySessionsHeaderBtn = document.getElementById("my-sessions-header-btn");
  if (catalogHeaderBtn) {
    catalogHeaderBtn.style.display = "block";
    catalogHeaderBtn.addEventListener("click", () => {
      updateUrl2({ category: null, subcategory: null, view: null });
      applyFiltersAndSort(imageCache2);
    });
  }
  if (myPlanHeaderBtn) {
    myPlanHeaderBtn.style.display = "block";
    myPlanHeaderBtn.addEventListener("click", () => {
      updateUrl2({ category: null, subcategory: null, view: "plan" });
      applyFiltersAndSort(imageCache2);
    });
  }
  if (likedItemsHeaderBtn) {
    likedItemsHeaderBtn.style.display = "block";
    likedItemsHeaderBtn.addEventListener("click", () => {
      updateUrl2({ category: null, subcategory: null, view: "likes" });
      applyFiltersAndSort(imageCache2);
    });
  }
  if (mySessionsHeaderBtn) {
    mySessionsHeaderBtn.style.display = state.session.user.isAuthenticated ? "block" : "none";
    mySessionsHeaderBtn.addEventListener("click", () => {
      if (!state.session.user.isAuthenticated) {
        showUserModal();
        return;
      }
      updateUrl2({ category: null, subcategory: null, view: "my-sessions" });
      applyFiltersAndSort(imageCache2);
    });
  }
  const toggleFilter = (elementId, settingName) => {
    var _a2;
    const container = (_a2 = document.getElementById(elementId)) == null ? void 0 : _a2.parentElement;
    if (container) {
      if (elementId === "subcategory-filters") {
        container.style.display = "none";
      } else {
        container.style.display = shopSettings.enabledFilters.includes(settingName) ? "flex" : "none";
      }
    }
  };
  toggleFilter("subcategory-filters", "Subcategories");
  toggleFilter("date-filter-group", "Date & Time");
  toggleFilter("headcount-filter", "Headcount");
  toggleFilter("location-filter", "Location");
  toggleFilter("budget-filter", "Budget");
  safeAddEventListener("status-filter", "change", () => applyFiltersAndSort(imageCache2));
  safeAddEventListener("name-filter", "input", debounce((e) => {
    const searchTerm = e.target.value.trim();
    if (aiSearchController) {
      aiSearchController.abort();
    }
    applyFiltersAndSort(imageCache2);
    if (state.records.filtered.length === 0 && searchTerm.length > 2) {
      log("Events", "No local results, triggering proactive AI search.");
      const hasOtherFilters = document.getElementById("status-filter").value !== "Available" || document.getElementById("headcount-filter").value !== "any" || document.getElementById("location-filter").value !== "any" || document.getElementById("budget-filter").value !== "any" || new URLSearchParams(window.location.search).get("category") !== null;
      if (!hasOtherFilters) {
        handleProactiveAISearch(searchTerm, imageCache2);
      }
    }
  }, 300));
  safeAddEventListener("clear-search-btn", "click", () => {
    handleFilterChipClear2({
      target: document.querySelector('#filter-chip-container .filter-chip[data-filter-type="name-filter"] button')
    });
    document.getElementById("name-filter").blur();
  });
  safeAddEventListener("headcount-custom", "input", debounce(() => applyFiltersAndSort(imageCache2), 300));
  safeAddEventListener("headcount-filter", "change", (e) => {
    document.getElementById("headcount-custom").style.display = e.target.value === "custom" ? "block" : "none";
    applyFiltersAndSort(imageCache2);
  });
  safeAddEventListener("location-filter", "change", () => applyFiltersAndSort(imageCache2));
  safeAddEventListener("budget-filter", "change", () => applyFiltersAndSort(imageCache2));
  safeAddEventListener("sort-by", "change", () => applyFiltersAndSort(imageCache2));
  safeAddEventListener("reset-filters-btn", "click", () => {
    updateUrl2({ category: null, subcategory: null, view: null });
    const allButton = document.querySelector('#category-filters .filter-btn[data-filter="all"]');
    if (allButton) {
      document.querySelectorAll("#category-filters .filter-btn").forEach((btn) => btn.classList.remove("active"));
      allButton.classList.add("active");
    }
    document.getElementById("name-filter").value = "";
    document.getElementById("status-filter").value = "Available";
    document.getElementById("headcount-filter").selectedIndex = 0;
    document.getElementById("headcount-custom").value = "";
    document.getElementById("headcount-custom").style.display = "none";
    document.getElementById("location-filter").selectedIndex = 0;
    document.getElementById("budget-filter").selectedIndex = 0;
    document.getElementById("sort-by").selectedIndex = 0;
    if (mainDatePicker) mainDatePicker.clear();
    applyFiltersAndSort(imageCache2);
  });
  const dateFilterInput = document.getElementById("date-filter");
  if (dateFilterInput) {
    const initializeDatePicker = async () => {
      if (!mainDatePicker) {
        try {
          log("Events", "Loading Flatpickr dynamically...");
          await loadFlatpickr();
          if (!window.flatpickr) {
            throw new Error("Flatpickr not available after loading");
          }
          if (typeof window.flatpickr !== "function") {
            throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
          }
          mainDatePicker = window.flatpickr(dateFilterInput, {
            mode: "range",
            dateFormat: "M j, Y",
            onChange: async (selectedDates) => {
              if (state.ui.isInitializing) return;
              if (selectedDates.length > 0) {
                if (selectedDates.length === 2) {
                  selectedDates[1].setHours(23, 59, 59, 999);
                }
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map((d) => d.toISOString()));
                triggerSave();
                await updateAllCardAvailabilityIcons();
              } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                triggerSave();
                await updateAllCardAvailabilityIcons();
                await updateMobileBarAvailability();
              }
            }
          });
          dateFilterInput._flatpickr = mainDatePicker;
          mainDatePicker.open();
          log("Events", "Date filter picker initialized successfully");
        } catch (error) {
          log("Events", `Error initializing date picker: ${error.message}`);
          console.error("Flatpickr initialization error:", error);
        }
      } else {
        mainDatePicker.open();
      }
    };
    dateFilterInput.addEventListener("focus", initializeDatePicker);
  }
  safeAddEventListener("date-filter-group", "click", async (e) => {
    const quickButton = e.target.closest("[data-date-quick]");
    if (!quickButton) return;
    const dateFilterInput2 = document.getElementById("date-filter");
    if (!dateFilterInput2) return;
    if (!mainDatePicker) {
      try {
        log("Events", "Loading Flatpickr for quick select button...");
        await loadFlatpickr();
        if (!window.flatpickr) {
          throw new Error("Flatpickr not available after loading");
        }
        if (typeof window.flatpickr !== "function") {
          throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
        }
        mainDatePicker = window.flatpickr(dateFilterInput2, {
          mode: "range",
          dateFormat: "M j, Y",
          onChange: async (selectedDates) => {
            if (selectedDates.length === 2) {
              selectedDates[1].setHours(23, 59, 59, 999);
              state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map((d) => d.toISOString()));
              triggerSave();
              await updateAllCardAvailabilityIcons();
            } else {
              state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
              triggerSave();
              await updateAllCardAvailabilityIcons();
              await updateMobileBarAvailability();
            }
          }
        });
        dateFilterInput2._flatpickr = mainDatePicker;
        log("Events", "Date filter picker initialized from quick select");
      } catch (error) {
        log("Events", `Error initializing date picker: ${error.message}`);
        console.error("Flatpickr initialization error:", error);
        return;
      }
    }
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    let startDate = new Date(today);
    let endDate = new Date(today);
    const quickFilterType = quickButton.dataset.dateQuick;
    switch (quickFilterType) {
      case "tomorrow":
        startDate.setDate(today.getDate() + 1);
        endDate.setDate(today.getDate() + 1);
        break;
      case "this-week":
        endDate.setDate(today.getDate() + (6 - today.getDay()));
        break;
      case "next-2-weeks":
        endDate.setDate(today.getDate() + 14);
        break;
    }
    mainDatePicker.setDate([startDate, endDate], true);
  });
  safeAddEventListener("header-event-name", "change", (e) => {
    console.log("[Events] ========== EVENT NAME CHANGE ==========");
    console.log("[Events] isInitializing:", state.ui.isInitializing);
    if (state.ui.isInitializing) return;
    const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
    const newValue = e.target.value.trim();
    console.log("[Events] hadValue:", hadValue, "newValue:", newValue);
    if (newValue && !hadValue) {
      console.log("[Events] Adding event name, calling updateProgress(0.0001)");
      updateProgress(1e-4);
    } else if (!newValue && hadValue) {
      console.log("[Events] Removing event name, calling updateProgress(-0.0001)");
      updateProgress(-1e-4);
    }
    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
    updateCurrentSessionName(e.target.value);
    triggerSave();
    console.log("[Events] ========== EVENT NAME CHANGE COMPLETE ==========");
  });
  safeAddEventListener("header-goals", "change", (e) => {
    if (state.ui.isInitializing) return;
    const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.GOALS);
    const newValue = e.target.value.trim();
    if (newValue && !hadValue) {
      updateProgress(1e-4);
    } else if (!newValue && hadValue) {
      updateProgress(-1e-4);
    }
    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
    triggerSave();
    if (document.getElementById("sort-by").value === "recommended") {
      applyFiltersAndSort(imageCache2);
    }
  });
  document.body.addEventListener("click", async (e) => {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    if (state.ui.isInitializing) return;
    const card = e.target.closest(".event-card");
    const heartIcon = e.target.closest(".heart-icon");
    const rsvpBtn = e.target.closest(".rsvp-btn");
    const ideaItem = e.target.closest(".favorite-item");
    const removeIdeaBtn = ideaItem == null ? void 0 : ideaItem.querySelector(".remove-btn");
    const checkoutBtn = e.target.closest("#checkout-btn");
    const lockedItemCard = e.target.closest(".locked-item-card");
    const demoteBtn = e.target.closest(".demote-locked-item-btn");
    const parentLink = e.target.closest(".parent-link");
    const presentBtn = e.target.closest(".present-btn");
    const carouselNav = e.target.closest(".carousel-nav");
    const saveShareBtn2 = e.target.closest("#save-share-btn");
    const breadcrumbLink = e.target.closest(".breadcrumb-link");
    const addToPlanBtn = e.target.closest(".add-to-plan-btn, #modal-add-to-plan-btn");
    const receiptLink = e.target.closest(".receipt-link, .receipt-btn");
    const openToEditBtn = e.target.closest(".open-to-edit-btn");
    const editEventBtn = e.target.closest(".edit-event-btn");
    const healthSuggestionBtn = e.target.closest(".health-suggestion-btn");
    if (editEventBtn) {
      e.stopPropagation();
      const sessionId = editEventBtn.dataset.sessionId;
      if (!sessionId) {
        showToast("Session not found");
        return;
      }
      log("Events", `Navigating to edit existing session ${sessionId}`);
      const currentShopId = state.ui.activeShopId;
      window.location.href = `${window.location.pathname}?session=${sessionId}&shopId=${currentShopId}`;
      return;
    }
    if (openToEditBtn) {
      e.stopPropagation();
      const eventId = openToEditBtn.dataset.eventId;
      if (!eventId) return;
      const eventRecord = state.records.all.find((r) => r.id === eventId);
      if (!eventRecord) {
        showToast("Event not found");
        return;
      }
      openToEditBtn.disabled = true;
      const originalText = openToEditBtn.textContent;
      openToEditBtn.textContent = "Creating Plan...";
      try {
        const newSession = await createSessionFromEvent(
          eventId,
          eventRecord,
          state.ui.activeShopId,
          state.session.user.id
        );
        if (newSession && newSession.id) {
          log("Events", `Created session ${newSession.id} from event ${eventId}, redirecting...`);
          eventRecord.fields.LinkedSession = [newSession.id];
          const currentShopId = state.ui.activeShopId;
          window.location.href = `${window.location.pathname}?session=${newSession.id}&shopId=${currentShopId}`;
        } else {
          throw new Error("Failed to create session");
        }
      } catch (error) {
        console.error("Error creating session from event:", error);
        showToast(`Error: ${error.message}`);
        openToEditBtn.disabled = false;
        openToEditBtn.textContent = originalText;
      }
      return;
    }
    if (receiptLink) {
      e.preventDefault();
      e.stopPropagation();
      const paymentIndex = parseInt(receiptLink.dataset.paymentIndex, 10);
      if (!isNaN(paymentIndex)) {
        showReceiptModal(paymentIndex);
      }
    } else if (healthSuggestionBtn) {
      e.stopPropagation();
      const categoryToFilter = healthSuggestionBtn.dataset.categoryFilter;
      const normalizedCategory = categoryToFilter.toLowerCase().replace(/\s+/g, " ");
      log("Events", `Health suggestion clicked. Filtering for: ${categoryToFilter}`);
      updateUrl2({ category: normalizedCategory, subcategory: null, view: null });
      applyFiltersAndSort(imageCache2);
      (_a2 = document.getElementById("catalog-area")) == null ? void 0 : _a2.scrollIntoView({ behavior: "smooth" });
    } else if (saveShareBtn2) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const originalText = saveShareBtn2.textContent;
        saveShareBtn2.textContent = "Copied!";
        setTimeout(() => {
          saveShareBtn2.textContent = originalText;
        }, 1500);
      }).catch((err) => {
        console.error("Failed to copy link:", err);
        showToast("Failed to copy link.");
      });
    } else if (breadcrumbLink) {
      e.preventDefault();
      const filterValue = breadcrumbLink.dataset.filter;
      if (filterValue === "all") {
        updateUrl2({ category: null, subcategory: null, view: null });
      } else {
        const normalizedFilter = filterValue.toLowerCase().replace(/\s+/g, " ");
        updateUrl2({ category: normalizedFilter, subcategory: null, view: null });
      }
      applyFiltersAndSort(imageCache2);
    } else if (checkoutBtn) {
      showCheckoutModal(shopSettings);
    } else if (rsvpBtn) {
      e.stopPropagation();
      if (!state.session.user.isAuthenticated) {
        showUserModal();
        return;
      }
      const cardEl = rsvpBtn.closest(".event-card") || rsvpBtn.closest("[data-record-id]");
      const recordId = cardEl == null ? void 0 : cardEl.dataset.recordId;
      if (!recordId) return;
      const rsvpType = rsvpBtn.dataset.rsvpType || "yes";
      const wasActive = rsvpBtn.classList.contains("active");
      rsvpBtn.disabled = true;
      const originalText = rsvpBtn.innerHTML;
      rsvpBtn.textContent = "Saving...";
      try {
        let updatedRecord;
        if (wasActive) {
          updatedRecord = await updateRsvpForEvent(recordId, state.session.user.id, null);
        } else {
          updatedRecord = await updateRsvpForEvent(recordId, state.session.user.id, rsvpType);
        }
        if (updatedRecord) {
          const recordIndex = state.records.all.findIndex((r) => r.id === recordId);
          if (recordIndex > -1) state.records.all[recordIndex] = updatedRecord;
          if ((_b = document.getElementById("detail-modal-overlay")) == null ? void 0 : _b.classList.contains("active")) {
            showDetailModal(updatedRecord);
          }
        } else {
          throw new Error("RSVP update failed.");
        }
      } catch (error) {
        console.error("RSVP Error:", error);
        showToast(`RSVP Error: ${error.message}`);
        rsvpBtn.innerHTML = originalText;
        rsvpBtn.disabled = false;
      }
    } else if (presentBtn) {
      const listType = presentBtn.dataset.listType;
      updateUrl2({ view: "present" });
      showPresentationView(listType);
    } else if (carouselNav) {
      const carousel = document.getElementById("ideas-carousel");
      if (carousel) {
        const scrollAmount = 300;
        const direction = carouselNav.classList.contains("right") ? 1 : -1;
        carousel.scrollBy({ left: scrollAmount * direction, behavior: "smooth" });
      }
    } else if (parentLink) {
      e.stopPropagation();
      const parentName = parentLink.dataset.parentName;
      if (parentName) {
        const parentRecord = state.records.all.find((r) => r.fields.Name === parentName);
        if (parentRecord) {
          const parentFilterName = parentName.toLowerCase().replace(/\s+/g, " ");
          updateUrl2({ category: parentFilterName, subcategory: null, view: null });
          applyFiltersAndSort(imageCache2);
          if ((_c = document.getElementById("detail-modal-overlay")) == null ? void 0 : _c.classList.contains("active")) {
            updateUrl2({ openItem: null });
            hideDetailModal();
          }
        }
      }
    } else if (heartIcon) {
      e.stopPropagation();
      addEnergy();
      const recordId = (_d = heartIcon.closest("[data-record-id]")) == null ? void 0 : _d.dataset.recordId;
      if (!recordId) return;
      console.log(`[Events] Heart icon clicked for record: ${recordId}`);
      if (state.session.user.isAuthenticated) {
        console.log(`[Events] User is authenticated (ID: ${state.session.user.id}). Current liked IDs:`, new Set(state.session.user.likedItemIds));
        try {
          heartIcon.style.pointerEvents = "none";
          heartIcon.style.opacity = "0.6";
          heartIcon.style.transform = "scale(0.9)";
          console.log(`[Events] Calling api.toggleUserLike for ${recordId}...`);
          const result = await toggleUserLike(recordId);
          console.log(`[Events] api.toggleUserLike response for ${recordId}:`, result);
          if (result.success) {
            let actionTaken = "";
            if (result.liked) {
              state.session.user.likedItemIds.add(recordId);
              actionTaken = "liked";
              log("Events", `User liked item ${recordId}.`);
            } else {
              state.session.user.likedItemIds.delete(recordId);
              actionTaken = "unliked";
              log("Events", `User unliked item ${recordId}.`);
            }
            console.log(`[Events] State updated. Action: ${actionTaken}. New liked IDs:`, new Set(state.session.user.likedItemIds));
            console.log(`[Events] Calling ui.updateCardIcon for ${recordId}...`);
            updateCardIcon(recordId);
            console.log(`[Events] ui.updateCardIcon finished for ${recordId}.`);
            if ((_e = document.getElementById("liked-items-filter-btn")) == null ? void 0 : _e.classList.contains("active")) {
              console.log('[Events] "My Likes" filter active, reapplying filters...');
              applyFiltersAndSort(imageCache2);
            }
          } else {
            console.error(`[Events] API toggle failed but returned success=false for ${recordId}. Response:`, result);
            showToast("Could not update like status. Please try again.");
          }
        } catch (error) {
          console.error(`[Events] Error during api.toggleUserLike for ${recordId}:`, error);
          log("Events", `Error toggling like: ${error.message}`);
          showToast(`Error: ${error.message}`);
        } finally {
          heartIcon.style.pointerEvents = "auto";
          heartIcon.style.opacity = "";
          heartIcon.style.transform = "";
          console.log(`[Events] Re-enabled pointer events for heart icon ${recordId}.`);
        }
      } else {
        console.log("[Events] User is logged out. Handling temporary like.");
        log("Events", `Guest toggling temporary like for item ${recordId}.`);
        const tempLikesSet = getTempLikes();
        let currentlyLiked = false;
        if (tempLikesSet.has(recordId)) {
          tempLikesSet.delete(recordId);
          currentlyLiked = false;
          console.log(`[Events] Removed ${recordId} from temporary likes.`);
        } else {
          tempLikesSet.add(recordId);
          currentlyLiked = true;
          console.log(`[Events] Added ${recordId} to temporary likes.`);
        }
        setTempLikes(tempLikesSet);
        log("Events", `Temporary likes updated: ${Array.from(tempLikesSet).join(", ")}`);
        console.log(`[Events] Calling ui.updateCardIcon for ${recordId} (logged out)...`);
        updateCardIcon(recordId);
        console.log(`[Events] ui.updateCardIcon finished for ${recordId} (logged out).`);
        if (currentlyLiked) {
          console.log(`[Events] Showing login prompt because item ${recordId} was liked.`);
          showLoginPromptForLikes();
        }
        if ((_f = document.getElementById("liked-items-filter-btn")) == null ? void 0 : _f.classList.contains("active")) {
          console.log('[Events] "My Likes" filter active, reapplying filters (logged out)...');
          applyFiltersAndSort(imageCache2);
        }
      }
    } else if (addToPlanBtn) {
      console.log("[Events] ========== ADD TO PLAN CLICKED ==========");
      e.stopPropagation();
      const recordId = (_g = addToPlanBtn.closest("[data-record-id]")) == null ? void 0 : _g.dataset.recordId;
      console.log("[Events] recordId:", recordId);
      if (!recordId) return;
      addEnergy();
      const record = state.records.all.find((r) => r.id === recordId);
      if (!record) return;
      const isUmwBeingAdded = record.fields.Name && record.fields.Name.includes("Union Machine Works");
      const wasUmwInPlan = Array.from(state.cart.lockedItems.keys()).some((id) => {
        const lockedRecord = state.records.all.find((r) => r.id === id);
        return lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works");
      });
      if (state.cart.lockedItems.has(recordId)) {
        console.log("[Events] Item already in plan, skipping");
        if ((_h = document.getElementById("detail-modal-overlay")) == null ? void 0 : _h.classList.contains("active")) {
          updateUrl2({ openItem: null });
          hideDetailModal();
        }
        return;
      }
      let itemInfo;
      const modalOverlay2 = document.getElementById("detail-modal-overlay");
      if ((modalOverlay2 == null ? void 0 : modalOverlay2.classList.contains("active")) && modalOverlay2.dataset.recordId === recordId) {
        const quantity = parseInt((_i = document.querySelector("#modal-quantity-selector .quantity-input")) == null ? void 0 : _i.value, 10) || 1;
        const note = ((_j = document.getElementById("modal-item-note")) == null ? void 0 : _j.value) || "";
        const selections = {};
        const optionGroups = document.querySelectorAll("#modal-options-container .option-group");
        if (optionGroups.length > 0) {
          optionGroups.forEach((group) => {
            const groupIndex = group.dataset.groupIndex;
            const selectedBtn = group.querySelector(".option-btn.selected");
            if (selectedBtn && groupIndex !== void 0) {
              selections[`group${groupIndex}`] = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
            }
          });
        } else {
          const selectedBtn = document.querySelector("#modal-options-container .option-btn.selected");
          if (selectedBtn) {
            const selectedOptionIndex2 = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
            selections["group0"] = selectedOptionIndex2;
          }
        }
        let selectedOptionIndex = 0;
        if (Object.keys(selections).length > 0) {
          selectedOptionIndex = selections["group0"] || 0;
        }
        itemInfo = { quantity, selectedOptionIndex, selections, note };
        updateUrl2({ openItem: null });
        hideDetailModal();
      } else {
        itemInfo = getItemState(recordId);
      }
      const lastAttemptedQuantity = itemInfo.quantity || 1;
      itemInfo.lastAttemptedQuantity = lastAttemptedQuantity;
      const effectiveMin = getEffectiveMinQuantity(record);
      const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
      let quantityToSave = itemInfo.quantity || 1;
      let isUmwInPlanNow = wasUmwInPlan || isUmwBeingAdded;
      if (quantityToSave < effectiveMin) {
        quantityToSave = effectiveMin;
        if (!isUmwInPlanNow && airtableMin > 1) {
          showEventPlanNotification(`Quantity adjusted to minimum (${effectiveMin}) for off-site event.`);
        } else if (isUmwInPlanNow && airtableMin > 1) {
          showEventPlanNotification(`Headcount permitted below minimum as on-site at Union Machine Works.`);
        }
      }
      itemInfo.quantity = quantityToSave;
      console.log("[Events] itemInfo:", itemInfo);
      state.cart.lockedItems.set(recordId, itemInfo);
      state.cart.items.delete(recordId);
      const progressDelta = 2e-4 * (itemInfo.quantity || 1);
      console.log("[Events] Calling updateProgress with delta:", progressDelta);
      updateProgress(progressDelta);
      console.log("[Events] updateProgress called");
      updateCardIcon(recordId);
      updateCardButtonText(recordId, true);
      await updateIdeasCarousel();
      await updateEventPlanSection();
      updateTotalCost();
      await updateAllCardAvailabilityIcons();
      await updateLockedItemStatusIcons();
      updateMobileBarAvailability();
      if (isUmwBeingAdded && !wasUmwInPlan) {
        handleUmwAddition();
      }
      triggerSave();
    } else if (demoteBtn) {
      console.log("[Events] ========== DEMOTE CLICKED ==========");
      e.stopPropagation();
      const recordId = (_k = demoteBtn.closest("[data-record-id]")) == null ? void 0 : _k.dataset.recordId;
      console.log("[Events] recordId:", recordId);
      if (!recordId || !state.cart.lockedItems.has(recordId)) return;
      const record = state.records.all.find((r) => r.id === recordId);
      const isUmwBeingRemoved = record && record.fields.Name && record.fields.Name.includes("Union Machine Works");
      const itemInfo = state.cart.lockedItems.get(recordId);
      console.log("[Events] itemInfo:", itemInfo);
      state.cart.lockedItems.delete(recordId);
      state.cart.items.set(recordId, itemInfo);
      const progressDelta = -2e-4 * (itemInfo.quantity || 1);
      console.log("[Events] Calling updateProgress with delta:", progressDelta);
      updateProgress(progressDelta);
      console.log("[Events] updateProgress called");
      updateCardIcon(recordId);
      updateCardButtonText(recordId, false);
      await updateEventPlanSection();
      await updateIdeasCarousel();
      updateTotalCost();
      await updateAllCardAvailabilityIcons();
      await updateLockedItemStatusIcons();
      updateMobileBarAvailability();
      if (isUmwBeingRemoved) {
        handleUmwRemoval();
      }
      triggerSave();
    } else if (removeIdeaBtn && e.target === removeIdeaBtn) {
      e.stopPropagation();
      const recordId = ideaItem.dataset.recordId;
      if (!recordId || !state.cart.items.has(recordId)) return;
      const itemInfo = state.cart.items.get(recordId);
      state.cart.items.delete(recordId);
      updateProgress(-1e-4 * ((itemInfo == null ? void 0 : itemInfo.quantity) || 1));
      await updateIdeasCarousel();
      triggerSave();
    } else if (e.target.closest(".availability-btn")) {
      e.stopPropagation();
      const calendarBtn = e.target.closest(".availability-btn");
      const card2 = calendarBtn.closest(".event-card");
      if (!card2) return;
      const recordId = card2.dataset.recordId;
      const record = state.records.all.find((r) => r.id === recordId);
      if (!record) return;
      showDetailModal(record);
      setTimeout(() => {
        const modalCalendar = document.getElementById("modal-calendar-container");
        if (modalCalendar && modalCalendar.style.display !== "none") {
          modalCalendar.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 300);
    } else if (card && !e.target.closest(".quantity-selector, .heart-icon, .add-to-plan-btn, .availability-btn")) {
      console.log("[DEBUG CARD CLICK] ========== CARD CLICKED ==========");
      console.log("[DEBUG CARD CLICK] Card element:", card);
      console.log("[DEBUG CARD CLICK] Card dataset:", card.dataset);
      const recordId = card.dataset.recordId;
      console.log("[DEBUG CARD CLICK] recordId from card.dataset:", recordId);
      let record = state.records.all.find((r) => r.id === recordId);
      console.log("[DEBUG CARD CLICK] record found in state.records.all:", !!record);
      if (!record) {
        console.log("[DEBUG CARD CLICK] ⚠️ Record not found in state.records.all, checking state.records.filtered...");
        record = state.records.filtered.find((r) => r.id === recordId);
        console.log("[DEBUG CARD CLICK] record found in state.records.filtered:", !!record);
        if (record) {
          console.log("[DEBUG CARD CLICK] ✅ Found record in state.records.filtered");
          console.log("[DEBUG CARD CLICK] record.isSession:", record.isSession);
          console.log("[DEBUG CARD CLICK] record.sessionData:", record.sessionData);
        }
      }
      console.log("[DEBUG CARD CLICK] Final record:", record);
      if (!record) {
        console.log("[DEBUG CARD CLICK] ❌ Record not found in any state, returning early");
        return;
      }
      if (record.id.startsWith("ai-search-")) {
        return;
      }
      console.log("[DEBUG SESSION CLICK] ========== SESSION TILE CLICKED ==========");
      console.log("[DEBUG SESSION CLICK] record:", record);
      console.log("[DEBUG SESSION CLICK] record.id:", record.id);
      console.log("[DEBUG SESSION CLICK] record.isSession:", record.isSession);
      console.log("[DEBUG SESSION CLICK] record.sessionData:", record.sessionData);
      console.log("[DEBUG SESSION CLICK] record.fields:", record.fields);
      if (record.isSession && record.sessionData) {
        console.log("[DEBUG SESSION CLICK] ✅ Condition passed: record.isSession && record.sessionData");
        log("Events", `Loading session from My Sessions view: ${record.id}`);
        console.log("[DEBUG SESSION CLICK] Step 1: Updating URL with session parameter...");
        console.log("[DEBUG SESSION CLICK] URL before:", window.location.href);
        updateUrl2({ session: record.id, view: null, category: null, subcategory: null });
        console.log("[DEBUG SESSION CLICK] URL after:", window.location.href);
        console.log("[DEBUG SESSION CLICK] Step 2: Calling api.loadSessionFromAirtable...");
        console.log("[DEBUG SESSION CLICK] Session ID being loaded:", record.id);
        console.log("[DEBUG SESSION CLICK] Current state.session.id BEFORE load:", state.session.id);
        loadSessionFromAirtable(record.id).then(() => {
          console.log("[DEBUG SESSION CLICK] ✅ api.loadSessionFromAirtable completed (promise resolved)");
          console.log("[DEBUG SESSION CLICK] state.session.id AFTER load:", state.session.id);
          console.log("[DEBUG SESSION CLICK] state.cart.lockedItems.size:", state.cart.lockedItems.size);
          console.log("[DEBUG SESSION CLICK] state.eventDetails.combined:", Object.fromEntries(state.eventDetails.combined));
        }).catch((err) => {
          console.error("[DEBUG SESSION CLICK] ❌ api.loadSessionFromAirtable FAILED:", err);
        });
        console.log("[DEBUG SESSION CLICK] Step 3: Calling applyFiltersAndSort to refresh catalog view...");
        applyFiltersAndSort(imageCache2);
        console.log("[DEBUG SESSION CLICK] Step 4: Returning from handler");
        console.log("[DEBUG SESSION CLICK] ========== SESSION TILE CLICK COMPLETE ==========");
        return;
      } else {
        console.log("[DEBUG SESSION CLICK] ❌ Condition NOT passed");
        console.log("[DEBUG SESSION CLICK] record.isSession:", record.isSession, "(expected: true)");
        console.log("[DEBUG SESSION CLICK] record.sessionData:", record.sessionData, "(expected: truthy object)");
      }
      if (record.fields["Item Type"] === "Grouping") {
        const groupName = record.fields.Name;
        const groupNameLower = groupName.toLowerCase().replace(/\s+/g, " ");
        const parentName = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        updateProgress(2e-5);
        if (!parentName) {
          updateUrl2({ category: groupNameLower, subcategory: null, view: null });
        } else {
          const parentNameLower = parentName.toLowerCase().replace(/\s+/g, " ");
          updateUrl2({ category: parentNameLower, subcategory: groupNameLower, view: null });
        }
        applyFiltersAndSort(imageCache2);
      } else {
        updateProgress(1e-5);
        showDetailModal(record);
      }
    } else if (lockedItemCard && !e.target.closest(".demote-locked-item-btn, .edit-btn")) {
      const recordId = lockedItemCard.dataset.recordId;
      const record = state.records.all.find((r) => r.id === recordId);
      if (record) showDetailModal(record);
    } else if (ideaItem && !e.target.closest(".add-to-plan-btn, .remove-btn")) {
      const recordId = ideaItem.dataset.recordId;
      const record = state.records.all.find((r) => r.id === recordId);
      if (record) showDetailModal(record);
    }
  });
  document.body.addEventListener("change", (e) => {
    var _a2, _b;
    if (state.ui.isInitializing) return;
    const target = e.target;
    const container = target.closest("[data-record-id]");
    if (!container) return;
    const recordId = container.dataset.recordId;
    const isLocked = state.cart.lockedItems.has(recordId);
    const isInIdeas = state.cart.items.has(recordId);
    let updates = {};
    let oldQuantity = 0;
    if (target.matches(".quantity-input")) {
      const currentState = isLocked ? state.cart.lockedItems.get(recordId) : state.cart.items.get(recordId);
      oldQuantity = (currentState == null ? void 0 : currentState.quantity) || 1;
      updates.quantity = parseInt(target.value, 10);
    } else if (target.matches("#modal-item-note")) {
      updates.note = target.value;
    } else if (((_a2 = e.detail) == null ? void 0 : _a2.selections) !== void 0) {
      updates.selections = e.detail.selections;
      if (Object.keys(e.detail.selections).length > 0) {
        updates.selectedOptionIndex = e.detail.selections["group0"] || 0;
      }
    } else if (((_b = e.detail) == null ? void 0 : _b.selectedOptionIndex) !== void 0) {
      updates.selectedOptionIndex = e.detail.selectedOptionIndex;
      updates.selections = { group0: e.detail.selectedOptionIndex };
    }
    if (Object.keys(updates).length > 0) {
      if (updates.quantity !== void 0 && updates.quantity !== oldQuantity) {
        const quantityDelta = updates.quantity - oldQuantity;
        updateProgress(1e-4 * quantityDelta);
      }
      if (isLocked) {
        updateLockedItemState(recordId, updates);
        updateEventPlanSection();
        updateTotalCost();
      } else {
        updateItemState(recordId, updates);
        if (!isInIdeas && target.matches(".quantity-input")) {
          updateIdeasCarousel();
        }
      }
      triggerSave();
    }
  });
  let eventPlanDatePicker = null;
  const eventDateInput = document.getElementById("event-date-picker");
  if (eventDateInput) {
    const initializeEventDatePicker = async () => {
      if (!eventPlanDatePicker) {
        try {
          log("Events", "Loading Flatpickr dynamically for event date picker...");
          await loadFlatpickr();
          if (!window.flatpickr) {
            throw new Error("Flatpickr not available after loading");
          }
          if (typeof window.flatpickr !== "function") {
            throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
          }
          if (eventDateInput.value === "Select a date") {
            eventDateInput.value = "";
          }
          eventPlanDatePicker = window.flatpickr(eventDateInput, {
            dateFormat: "M j, Y",
            onChange: async (selectedDates) => {
              console.log("[DEBUG] Date picker onChange triggered");
              console.log("[DEBUG] selectedDates:", selectedDates);
              console.log("[DEBUG] state.ui.isInitializing:", state.ui.isInitializing);
              if (state.ui.isInitializing) return;
              if (selectedDates.length > 0) {
                const isoDate = selectedDates[0].toISOString();
                console.log("[DEBUG] Setting date in state to:", isoDate);
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, isoDate);
                console.log("[DEBUG] Date now in state:", state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE));
                updateProgress(15e-5);
              } else {
                console.log("[DEBUG] No date selected, deleting from state");
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                updateProgress(-15e-5);
              }
              await updateEventPlanDateDisplay();
              await updateLockedItemStatusIcons();
              await updateMobileBarAvailability();
              console.log("[DEBUG] About to trigger save...");
              triggerSave();
            }
          });
          eventDateInput._flatpickr = eventPlanDatePicker;
          eventPlanDatePicker.open();
          log("Events", "Event date picker initialized successfully");
        } catch (error) {
          log("Events", `Error initializing event date picker: ${error.message}`);
          console.error("Flatpickr initialization error:", error);
        }
      } else {
        eventPlanDatePicker.open();
      }
    };
    eventDateInput.addEventListener("focus", initializeEventDatePicker);
  }
  safeAddEventListener("itinerary-btn", "click", () => {
    log("Events", "Itinerary button clicked, showing modal.");
    showItineraryModal();
  });
  setupPresentationEventListeners();
  safeAddEventListener("payment-form", "submit", handlePaymentFormSubmit);
  setupItineraryEventListeners();
  return { mainDatePicker, eventPlanDatePicker };
}
function initializeChatEventListeners() {
  const messageForm = document.getElementById("message-form");
  const messageInput = document.getElementById("message-input");
  if (messageForm) {
    messageForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const message = messageInput.value;
      if (message.trim() === "") return;
      sendMessage(message);
      messageInput.value = "";
    });
  }
  const chatToggleButton = document.getElementById("chat-toggle-button");
  const chatWidgetContainer = document.getElementById("chat-widget-container");
  function toggleChatWindow(forceClose = false) {
    if (chatWidgetContainer) {
      if (forceClose) {
        chatWidgetContainer.classList.remove("chat-open");
      } else {
        chatWidgetContainer.classList.toggle("chat-open");
      }
    }
  }
  if (chatToggleButton) {
    chatToggleButton.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleChatWindow();
    });
  }
  document.addEventListener("click", (event) => {
    const remainOpenCheckbox = document.getElementById("chat-remain-open-checkbox");
    if (chatWidgetContainer && !chatWidgetContainer.contains(event.target) && chatWidgetContainer.classList.contains("chat-open")) {
      if (!remainOpenCheckbox || !remainOpenCheckbox.checked) {
        toggleChatWindow(true);
      }
    }
  });
  initializeRecentChatsListeners();
}
function openChatWidget(andKeepOpen = false) {
  const chatWidgetContainer = document.getElementById("chat-widget-container");
  if (chatWidgetContainer) {
    chatWidgetContainer.classList.add("chat-open");
    if (andKeepOpen) {
      const remainOpenCheckbox = document.getElementById("chat-remain-open-checkbox");
      if (remainOpenCheckbox) {
        remainOpenCheckbox.checked = true;
      }
    }
  }
}
function handleFilterChipClear2(e) {
  if (typeof handleFilterChipClear === "function") {
    handleFilterChipClear(e);
  } else {
    document.getElementById("name-filter").value = "";
    window.applyFiltersAndSort(window.imageCache);
  }
}

// components/itinerary.js
var itineraryModal = document.getElementById("itinerary-modal-overlay");
var closeBtn = document.getElementById("itinerary-close-btn");
var sceneCanvas = document.getElementById("scene-builder-canvas");
var bgThumbContainer = document.querySelector(".background-thumbnails");
var itemPaletteContainer = document.querySelector(".palette-items");
var statusText = document.getElementById("scene-status-text");
var cutoutPicker = document.getElementById("cutout-picker-popover");
var cutoutPickerTitle = document.getElementById("cutout-picker-title");
var cutoutPickerThumbnails = document.getElementById("cutout-picker-thumbnails");
var cutoutPickerCloseBtn = document.getElementById("cutout-picker-close-btn");
var cutoutPromptContainer = document.getElementById("cutout-prompt-container");
var cutoutAiPrompt = document.getElementById("cutout-ai-prompt");
var cutoutPickerSubmitBtn = document.getElementById("cutout-picker-submit-btn");
var cutoutContextThumb = document.getElementById("cutout-context-thumb");
var zCounter = 10;
var currentDragItem = null;
var dragOffsetX = 0;
var dragOffsetY = 0;
var pendingCutout = null;
var currentTransformAction = null;
var startX = 0;
var startY = 0;
var startScale = 1;
var startRotation = 0;
var startAngle = 0;
var startDistance = 1;
var transformOrigin = { x: 0, y: 0 };
var startFlipped = false;
function replaceCloudinaryTransform(originalUrl, newTransform) {
  try {
    const url = new URL(originalUrl);
    const parts = url.pathname.split("/upload/");
    if (parts.length !== 2) return originalUrl;
    const pathSegments = parts[1].split("/");
    if (pathSegments.length > 1 && (!pathSegments[0].startsWith("v") || !/v\d+/.test(pathSegments[0]))) {
      pathSegments.shift();
    }
    const publicIdPath = pathSegments.join("/");
    url.pathname = `${parts[0]}/upload/${newTransform}/${publicIdPath}`;
    return url.toString();
  } catch (e) {
    console.error("Error parsing/replacing Cloudinary URL:", e);
    return originalUrl;
  }
}
function updateSceneStatus(text, isLoading = false) {
  if (statusText) {
    statusText.innerHTML = `${isLoading ? "⚙️ " : ""}${text}`;
    statusText.style.opacity = 1;
    if (!isLoading) {
      setTimeout(() => {
        if (statusText.innerHTML === text) {
          statusText.style.opacity = 0;
        }
      }, 3e3);
    }
  }
}
function renderSingleCutout(uniqueId, pos) {
  if (!sceneCanvas) return;
  const { imageUrl, prompt } = pos;
  if (!imageUrl) return;
  let cutoutUrl;
  let newTransform;
  if (prompt && prompt.trim() !== "") {
    const encodedPrompt = encodeURIComponent(prompt.trim());
    newTransform = `e_gen_remove:prompt_${encodedPrompt},w_250,a_ignore,f_png`;
    log("Itinerary", `Using Generative Remove, prompt: ${prompt}`);
  } else {
    newTransform = "e_background_removal,w_250,f_png";
    log("Itinerary", "No prompt, using simple background removal.");
  }
  cutoutUrl = replaceCloudinaryTransform(imageUrl, newTransform);
  const wrapper = document.createElement("div");
  wrapper.className = "scene-item-wrapper";
  wrapper.dataset.uniqueId = uniqueId;
  wrapper.style.left = `${pos.x}px`;
  wrapper.style.top = `${pos.y}px`;
  wrapper.style.zIndex = pos.z;
  const flipTransform = pos.flipped ? "scaleX(-1)" : "";
  wrapper.style.transform = `scale(${pos.scale || 1}) rotate(${pos.rotation || 0}deg) ${flipTransform}`;
  const img = document.createElement("img");
  img.src = cutoutUrl;
  img.className = "scene-cutout";
  img.setAttribute("draggable", false);
  img.loading = "lazy";
  img.onload = () => updateSceneStatus("Item added! Drag to move.");
  img.onerror = () => updateSceneStatus("❌ Error creating cutout. Try a different prompt.");
  const controls = document.createElement("div");
  controls.className = "scene-item-controls";
  controls.innerHTML = `
        <div class="scene-flip-handle" data-action="flip" title="Flip">⇋</div>
        <div class="scene-rotate-handle" data-action="rotate" title="Rotate">↻</div>
        <div class="scene-resize-handle" data-action="resize" title="Resize">⤭</div>
    `;
  wrapper.appendChild(img);
  wrapper.appendChild(controls);
  wrapper.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const action = e.target.dataset.action;
    if (action === "rotate" || action === "resize") {
      handleTransformStart(e, wrapper, action);
    } else if (action === "flip") {
      handleFlipToggle(wrapper);
    } else {
      updateSceneStatus("Dragging item...");
      currentDragItem = wrapper;
      currentDragItem.classList.add("is-dragging");
      const rect = wrapper.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      zCounter++;
      wrapper.style.zIndex = zCounter;
      wrapper.style.cursor = "grabbing";
    }
  });
  sceneCanvas.appendChild(wrapper);
}
function renderCutouts() {
  if (!sceneCanvas) return;
  sceneCanvas.innerHTML = "";
  sceneCanvas.appendChild(statusText);
  zCounter = 10;
  for (const [uniqueId, pos] of state.session.itemPositions.entries()) {
    renderSingleCutout(uniqueId, pos);
    if (pos.z > zCounter) zCounter = pos.z;
  }
  if (state.session.itemPositions.size === 0) {
    updateSceneStatus("Drag items from the palette onto the canvas.");
  }
}
function handleTransformStart(e, wrapper, action) {
  currentTransformAction = action;
  currentDragItem = wrapper;
  currentDragItem.classList.add("is-dragging");
  zCounter++;
  currentDragItem.style.zIndex = zCounter;
  const rect = wrapper.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  transformOrigin = { x: centerX, y: centerY };
  startX = e.clientX;
  startY = e.clientY;
  const uniqueId = wrapper.dataset.uniqueId;
  const pos = state.session.itemPositions.get(uniqueId);
  startScale = pos.scale || 1;
  startRotation = pos.rotation || 0;
  startFlipped = pos.flipped || false;
  if (action === "rotate") {
    updateSceneStatus("Rotating item...");
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    startAngle = Math.atan2(dy, dx) * (180 / Math.PI) - startRotation;
  } else if (action === "resize") {
    updateSceneStatus("Resizing item...");
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    startDistance = Math.hypot(dx, dy);
  }
}
function handleFlipToggle(wrapper) {
  if (!wrapper) return;
  const uniqueId = wrapper.dataset.uniqueId;
  const pos = state.session.itemPositions.get(uniqueId);
  if (!pos) return;
  pos.flipped = !pos.flipped;
  const flipTransform = pos.flipped ? "scaleX(-1)" : "";
  const scale = pos.scale || 1;
  const rotation = pos.rotation || 0;
  wrapper.style.transform = `scale(${scale}) rotate(${rotation}deg) ${flipTransform}`;
  state.session.itemPositions.set(uniqueId, pos);
  triggerSave();
  updateSceneStatus(pos.flipped ? "Item flipped" : "Item un-flipped");
}
async function renderScene() {
  if (!sceneCanvas || !bgThumbContainer || !itemPaletteContainer) {
    log("Itinerary", "Scene Builder DOM elements not found.");
    return;
  }
  bgThumbContainer.innerHTML = "";
  const venueRecords = state.records.all.filter(
    (r) => {
      var _a;
      return state.cart.lockedItems.has(r.id) && ((_a = r.fields.Categories) == null ? void 0 : _a.toLowerCase().includes("venue"));
    }
  );
  const bgDescription = bgThumbContainer.parentElement.querySelector("p.description");
  if (venueRecords.length > 0) {
    if (bgDescription) bgDescription.style.display = "none";
    let hasSetDefaultBackground = false;
    for (const venueRecord of venueRecords) {
      const { imageUrls } = await fetchImagesForRecord(venueRecord, state.records.all, /* @__PURE__ */ new Map());
      imageUrls.forEach((url) => {
        const thumb = document.createElement("div");
        thumb.className = "background-thumb";
        const thumbUrl = url.replace("/upload/", "/upload/c_fill,g_auto,w_50,h_50/");
        thumb.innerHTML = `<img src="${thumbUrl}" alt="Venue option"> <span>${venueRecord.fields.Name}</span>`;
        thumb.addEventListener("click", () => {
          sceneCanvas.style.backgroundImage = `url('${url}')`;
          updateSceneStatus("Background set!");
        });
        bgThumbContainer.appendChild(thumb);
      });
      if (imageUrls.length > 0 && !hasSetDefaultBackground && !sceneCanvas.style.backgroundImage) {
        sceneCanvas.style.backgroundImage = `url('${imageUrls[0]}')`;
        hasSetDefaultBackground = true;
      }
    }
  } else {
    if (bgDescription) bgDescription.style.display = "block";
  }
  itemPaletteContainer.innerHTML = "";
  const paletteDescription = itemPaletteContainer.parentElement.querySelector("p.description");
  const allItems = new Map([
    ...Array.from(state.cart.lockedItems.entries()).map(([id, info]) => [id, { info, type: "locked" }]),
    ...Array.from(state.cart.items.entries()).map(([id, info]) => [id, { info, type: "idea" }])
  ]);
  if (allItems.size === 0) {
    if (paletteDescription) paletteDescription.style.display = "block";
  } else {
    if (paletteDescription) paletteDescription.style.display = "none";
    for (const [recordId, { info, type }] of allItems.entries()) {
      const record = state.records.all.find((r) => r.id === recordId);
      if (!record) continue;
      const { imageUrls } = await fetchImagesForRecord(record, state.records.all, /* @__PURE__ */ new Map());
      const itemEl = document.createElement("div");
      itemEl.className = `palette-item ${type}`;
      itemEl.setAttribute("draggable", true);
      const thumbUrl = (imageUrls[0] || getPlaceholderImage([])).replace("/upload/", "/upload/c_fill,g_auto,w_50,h_50/");
      itemEl.innerHTML = `<img src="${thumbUrl}" alt="${record.fields.Name}"> <span>${record.fields.Name}</span>`;
      itemEl.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", recordId);
        e.dataTransfer.effectAllowed = "copy";
        updateSceneStatus("Release to choose cutout...");
      });
      itemPaletteContainer.appendChild(itemEl);
    }
  }
  renderCutouts();
}
async function showCutoutPicker(record, x, y) {
  if (!cutoutPicker) return;
  updateSceneStatus("Fetching image options...", true);
  pendingCutout = { record, x, y, selectedUrl: null };
  cutoutPickerTitle.textContent = `Select image for: ${record.fields.Name}`;
  cutoutPickerThumbnails.innerHTML = "";
  cutoutAiPrompt.value = "";
  cutoutPromptContainer.style.display = "none";
  const { imageUrls } = await fetchImagesForRecord(record, state.records.all, /* @__PURE__ */ new Map());
  const contextThumbUrl = (imageUrls[0] || getPlaceholderImage([])).replace("/upload/", "/upload/c_fill,g_auto,w_50,h_50/");
  if (cutoutContextThumb) cutoutContextThumb.style.backgroundImage = `url('${contextThumbUrl}')`;
  if (imageUrls.length === 0) {
    updateSceneStatus("Item has no images, adding placeholder.");
    addCutoutToScene(getPlaceholderImage([]), "");
    return;
  }
  imageUrls.forEach((url) => {
    const thumb = document.createElement("div");
    thumb.className = "thumbnail-img";
    thumb.style.backgroundImage = `url('${url.replace("/upload/", "/upload/c_fill,g_auto,w_100,h_80/")}')`;
    thumb.addEventListener("click", () => {
      cutoutPickerThumbnails.querySelectorAll(".thumbnail-img").forEach((t) => t.classList.remove("selected"));
      thumb.classList.add("selected");
      pendingCutout.selectedUrl = url;
      cutoutPromptContainer.style.display = "block";
      cutoutAiPrompt.focus();
      updateSceneStatus("Now, tell the AI what to cut out.");
    });
    cutoutPickerThumbnails.appendChild(thumb);
  });
  updateSceneStatus("Select an image to use as the cutout source.");
  cutoutPicker.style.display = "flex";
  requestAnimationFrame(() => {
    cutoutPicker.classList.add("active");
  });
}
function hideCutoutPicker() {
  if (cutoutPicker) {
    cutoutPicker.classList.remove("active");
    setTimeout(() => {
      cutoutPicker.style.display = "none";
    }, 300);
  }
  pendingCutout = null;
}
function addCutoutToScene(imageUrl, promptText) {
  if (!pendingCutout) return;
  updateSceneStatus("⚙️ AI is generating cutout...", true);
  const { record, x, y } = pendingCutout;
  zCounter++;
  const uniqueId = `cutout-${Date.now()}`;
  const newPosition = {
    recordId: record.id,
    imageUrl,
    // Save the *chosen* image URL
    prompt: promptText,
    // Save the AI prompt
    x: x - 75,
    y: y - 75,
    z: zCounter,
    scale: 1,
    // <-- ADD THIS
    rotation: 0,
    // <-- ADD THIS
    flipped: false
    // <-- ADD THIS
  };
  state.session.itemPositions.set(uniqueId, newPosition);
  triggerSave();
  renderSingleCutout(uniqueId, newPosition);
  hideCutoutPicker();
}
function setupItineraryEventListeners() {
  log("Itinerary", "Initializing Scene Builder listeners.");
  closeBtn.addEventListener("click", () => {
    updateUrl2({ view: null });
    hideItineraryModal();
  });
  itineraryModal.addEventListener("click", (e) => {
    if (e.target === itineraryModal) {
      updateUrl2({ view: null });
      hideItineraryModal();
    }
  });
  cutoutPickerCloseBtn.addEventListener("click", hideCutoutPicker);
  cutoutPicker.addEventListener("click", (e) => {
    if (e.target === cutoutPicker) hideCutoutPicker();
  });
  cutoutPickerSubmitBtn.addEventListener("click", () => {
    if (pendingCutout && pendingCutout.selectedUrl) {
      addCutoutToScene(pendingCutout.selectedUrl, cutoutAiPrompt.value);
    } else {
      log("Itinerary", "Cutout submit clicked, but no image was selected.");
      updateSceneStatus("Please select an image first.");
    }
  });
  if (sceneCanvas) {
    sceneCanvas.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    sceneCanvas.addEventListener("dragleave", (e) => {
      if (state.session.itemPositions.size === 0) {
        updateSceneStatus("Drag items from the palette onto the canvas.");
      } else {
        statusText.style.opacity = 0;
      }
    });
    sceneCanvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const recordId = e.dataTransfer.getData("text/plain");
      const record = state.records.all.find((r) => r.id === recordId);
      if (!record) return;
      const rect = sceneCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      showCutoutPicker(record, x, y);
    });
  }
  document.addEventListener("mousemove", (e) => {
    if (!currentDragItem) return;
    e.preventDefault();
    const flipTransform = startFlipped ? "scaleX(-1)" : "";
    if (currentTransformAction === "rotate") {
      const dx = e.clientX - transformOrigin.x;
      const dy = e.clientY - transformOrigin.y;
      const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      const rotation = Math.round(currentAngle - startAngle);
      currentDragItem.style.transform = `scale(${startScale}) rotate(${rotation}deg) ${flipTransform}`;
      currentDragItem.dataset.currentRotation = rotation;
    } else if (currentTransformAction === "resize") {
      const dx = e.clientX - transformOrigin.x;
      const dy = e.clientY - transformOrigin.y;
      const currentDistance = Math.hypot(dx, dy);
      let scale = currentDistance / startDistance * startScale;
      scale = Math.max(0.1, Math.min(scale, 5));
      currentDragItem.style.transform = `scale(${scale}) rotate(${startRotation}deg) ${flipTransform}`;
      currentDragItem.dataset.currentScale = scale;
    } else {
      const rect = sceneCanvas.getBoundingClientRect();
      let x = e.clientX - rect.left - dragOffsetX;
      let y = e.clientY - rect.top - dragOffsetY;
      const itemRect = currentDragItem.getBoundingClientRect();
      x = Math.max(-itemRect.width / 2, Math.min(x, rect.width - itemRect.width / 2));
      y = Math.max(-itemRect.height / 2, Math.min(y, rect.height - itemRect.height / 2));
      currentDragItem.style.left = `${x}px`;
      currentDragItem.style.top = `${y}px`;
    }
  });
  document.addEventListener("mouseup", () => {
    if (!currentDragItem) return;
    currentDragItem.classList.remove("is-dragging");
    currentDragItem.style.cursor = "move";
    updateSceneStatus("Position saved!");
    const uniqueId = currentDragItem.dataset.uniqueId;
    const posObject = state.session.itemPositions.get(uniqueId);
    if (posObject) {
      if (currentTransformAction === "resize") {
        posObject.scale = parseFloat(currentDragItem.dataset.currentScale) || startScale;
        posObject.rotation = startRotation;
        posObject.flipped = startFlipped;
      } else if (currentTransformAction === "rotate") {
        posObject.scale = startScale;
        posObject.rotation = parseFloat(currentDragItem.dataset.currentRotation) || startRotation;
        posObject.flipped = startFlipped;
      } else {
        posObject.x = parseFloat(currentDragItem.style.left);
        posObject.y = parseFloat(currentDragItem.style.top);
      }
      posObject.z = parseInt(currentDragItem.style.zIndex);
      state.session.itemPositions.set(uniqueId, posObject);
      triggerSave();
    }
    currentDragItem = null;
    currentTransformAction = null;
    startX = 0;
    startY = 0;
    startScale = 1;
    startRotation = 0;
    startAngle = 0;
    startDistance = 1;
  });
}
function showItineraryModal() {
  updateUrl2({ view: "itinerary" });
  log("Itinerary", "Showing itinerary modal (Scene Builder).");
  renderScene();
  itineraryModal.classList.add("active");
  itineraryModal.style.display = "flex";
  document.body.classList.add("modal-open");
}
function hideItineraryModal() {
  log("Itinerary", "Hiding itinerary modal.");
  hideCutoutPicker();
  itineraryModal.classList.remove("active");
  setTimeout(() => {
    itineraryModal.style.display = "none";
  }, 300);
  document.body.classList.remove("modal-open");
}

// components/presentation.js
var modal = document.getElementById("presentation-modal-overlay");
var closeBtn2 = document.getElementById("presentation-close-btn");
var titleEl = document.getElementById("presentation-title");
var counterEl = document.getElementById("presentation-counter");
var mainImageEl = document.getElementById("presentation-main-image");
var thumbStripEl = document.getElementById("presentation-thumbnail-strip");
var itemNameEl = document.getElementById("presentation-item-name");
var itemPriceEl = document.getElementById("presentation-item-price");
var itemDescEl = document.getElementById("presentation-item-description");
var itemNoteContainerEl = document.getElementById("presentation-item-note-container");
var itemNoteEl = document.getElementById("presentation-item-note");
var prevItemBtn = document.getElementById("presentation-prev-item-btn");
var nextItemBtn = document.getElementById("presentation-next-item-btn");
var reactionButtonsEl = document.getElementById("reaction-buttons");
var reactionSummaryEl = document.getElementById("reaction-summary");
var summaryEventNameEl = document.getElementById("summary-event-name");
var summaryEventNotesEl = document.getElementById("summary-event-notes");
var summaryEventDateEl = document.getElementById("summary-event-date");
var summaryIdeasLink = document.getElementById("summary-ideas-link");
var summaryLockedLink = document.getElementById("summary-locked-link");
var shareBtn = document.getElementById("presentation-share-btn");
var combinedList = [];
var globalCurrentIndex = 0;
var currentImages = [];
var currentImageIndex = 0;
function updateHeader(currentItem) {
  const listType = currentItem.type;
  titleEl.textContent = listType === "favorites" ? "Presenting Ideas" : "Presenting Event Plan";
  counterEl.textContent = `Item ${globalCurrentIndex + 1} of ${combinedList.length}`;
  summaryIdeasLink.classList.toggle("active", listType === "favorites");
  summaryLockedLink.classList.toggle("active", listType === "locked");
  summaryIdeasLink.disabled = listType === "favorites";
  summaryLockedLink.disabled = listType === "locked";
}
function renderSummaryHeader() {
  summaryEventNameEl.textContent = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "N/A";
  summaryEventNotesEl.textContent = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || "N/A";
  const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
  if (dateValue) {
    const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
    summaryEventDateEl.textContent = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } else {
    summaryEventDateEl.textContent = "N/A";
  }
  summaryIdeasLink.textContent = `${state.cart.items.size} Ideas`;
  summaryLockedLink.textContent = `${state.cart.lockedItems.size} Locked In`;
}
function renderReactions(recordId) {
  const currentUser2 = getCurrentUser();
  let allReactions = state.session.reactions.get(recordId);
  if (!(allReactions instanceof Map)) {
    allReactions = /* @__PURE__ */ new Map();
  }
  const currentUserReaction = allReactions.get(currentUser2.id);
  reactionButtonsEl.innerHTML = EMOJI_REACTIONS.map(
    (emoji) => `<button class="reaction-btn ${currentUserReaction === emoji ? "selected" : ""}" data-emoji="${emoji}">${emoji}</button>`
  ).join("");
  let summaryHTML = "Reactions: ";
  if (allReactions.size > 0) {
    summaryHTML += Array.from(allReactions.entries()).map(([userId, reaction]) => {
      const name = state.session.userProfiles.get(userId) || "A User";
      return `<span>${name}: ${reaction}</span>`;
    }).join(" | ");
  } else {
    summaryHTML += "None yet.";
  }
  reactionSummaryEl.innerHTML = summaryHTML;
}
async function renderCurrentSlide() {
  if (combinedList.length === 0) {
    hidePresentationView();
    return;
  }
  mainImageEl.style.backgroundImage = "";
  thumbStripEl.innerHTML = "<p>Loading images...</p>";
  const currentItem = combinedList[globalCurrentIndex];
  const { recordId, type } = currentItem;
  const record = state.records.all.find((r) => r.id === recordId);
  if (!record) {
    log("Presentation", `Record not found for ID: ${recordId}`);
    return;
  }
  updateHeader(currentItem);
  renderReactions(recordId);
  const itemInfo = type === "favorites" ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
  itemNameEl.textContent = record.fields.Name || "Untitled";
  const price = getRecordPrice(record, itemInfo == null ? void 0 : itemInfo.selectedOptionIndex);
  itemPriceEl.textContent = `$${price.toFixed(2)}`;
  itemDescEl.textContent = record.fields.Description || "";
  if (itemInfo == null ? void 0 : itemInfo.note) {
    itemNoteContainerEl.style.display = "block";
    itemNoteEl.textContent = itemInfo.note;
  } else {
    itemNoteContainerEl.style.display = "none";
  }
  const { imageUrls } = await fetchImagesForRecord(record, state.records.all, /* @__PURE__ */ new Map());
  currentImages = imageUrls || [];
  currentImageIndex = 0;
  renderCurrentImage();
}
function renderCurrentImage() {
  if (currentImages.length === 0) {
    mainImageEl.style.backgroundImage = "";
    thumbStripEl.innerHTML = "<p>No images available.</p>";
    return;
  }
  mainImageEl.style.backgroundImage = `url('${currentImages[currentImageIndex]}')`;
  thumbStripEl.innerHTML = "";
  currentImages.forEach((url, index) => {
    const thumb = document.createElement("div");
    thumb.className = "thumbnail-img";
    thumb.style.backgroundImage = `url('${url}')`;
    if (index === currentImageIndex) {
      thumb.classList.add("active");
    }
    thumb.addEventListener("click", () => {
      currentImageIndex = index;
      renderCurrentImage();
    });
    thumbStripEl.appendChild(thumb);
  });
}
function navigateToSlide(direction) {
  if (combinedList.length === 0) return;
  globalCurrentIndex = (globalCurrentIndex + direction + combinedList.length) % combinedList.length;
  renderCurrentSlide();
}
function cycleImage(direction) {
  const newIndex = (currentImageIndex + direction + currentImages.length) % currentImages.length;
  if (currentImages.length > 0) {
    currentImageIndex = newIndex;
    renderCurrentImage();
  }
}
function handleKeyDown(e) {
  switch (e.key) {
    case "ArrowDown":
      navigateToSlide(1);
      break;
    case "ArrowUp":
      navigateToSlide(-1);
      break;
    case "ArrowRight":
      cycleImage(1);
      break;
    case "ArrowLeft":
      cycleImage(-1);
      break;
    case "Escape":
      updateUrl2({ view: null });
      hidePresentationView();
      break;
  }
}
function handleReactionClick(e) {
  const button = e.target.closest(".reaction-btn");
  if (!button) return;
  const emoji = button.dataset.emoji;
  const currentUser2 = getCurrentUser();
  const recordId = combinedList[globalCurrentIndex].recordId;
  if (!state.session.reactions.has(recordId)) {
    state.session.reactions.set(recordId, /* @__PURE__ */ new Map());
  }
  const itemReactions = state.session.reactions.get(recordId);
  if (itemReactions.get(currentUser2.id) === emoji) {
    itemReactions.delete(currentUser2.id);
  } else {
    itemReactions.set(currentUser2.id, emoji);
  }
  renderReactions(recordId);
  triggerSave();
}
function showPresentationView(listType, startRecordId = null) {
  log("Presentation", `Showing presentation for: ${listType}`);
  const favorites = Array.from(state.cart.items.keys()).map((id) => ({ recordId: id, type: "favorites" }));
  const locked = Array.from(state.cart.lockedItems.keys()).map((id) => ({ recordId: id, type: "locked" }));
  combinedList = [...favorites, ...locked];
  if (combinedList.length === 0) {
    alert(`There are no items in your lists to present.`);
    return;
  }
  if (startRecordId) {
    globalCurrentIndex = combinedList.findIndex((item) => item.recordId === startRecordId);
  } else {
    const firstItemOfList = combinedList.find((item) => item.type === listType);
    globalCurrentIndex = firstItemOfList ? combinedList.indexOf(firstItemOfList) : 0;
  }
  renderSummaryHeader();
  modal.classList.add("active");
  modal.style.display = "flex";
  document.body.classList.add("modal-open");
  document.addEventListener("keydown", handleKeyDown);
  renderCurrentSlide();
}
function hidePresentationView() {
  modal.classList.remove("active");
  setTimeout(() => {
    modal.style.display = "none";
  }, 300);
  document.body.classList.remove("modal-open");
  document.removeEventListener("keydown", handleKeyDown);
}
function setupPresentationEventListeners() {
  closeBtn2.addEventListener("click", () => {
    updateUrl2({ view: null });
    hidePresentationView();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      updateUrl2({ view: null });
      hidePresentationView();
    }
  });
  prevItemBtn.addEventListener("click", () => navigateToSlide(-1));
  nextItemBtn.addEventListener("click", () => navigateToSlide(1));
  reactionButtonsEl.addEventListener("click", handleReactionClick);
  summaryIdeasLink.addEventListener("click", () => {
    if (state.cart.items.size > 0) {
      showPresentationView("favorites");
    }
  });
  summaryLockedLink.addEventListener("click", () => {
    if (state.cart.lockedItems.size > 0) {
      showPresentationView("locked");
    }
  });
  shareBtn.addEventListener("click", (e) => {
    const baseURL = window.location.origin + window.location.pathname;
    const sessionID = state.session.id;
    const shareURL = `${baseURL}?session=${sessionID}&view=present`;
    navigator.clipboard.writeText(shareURL).then(() => {
      const originalText = e.target.textContent;
      e.target.textContent = "Copied!";
      setTimeout(() => {
        e.target.textContent = originalText;
      }, 1500);
    });
  });
}

// utils/imageOptimizer.js
function optimizeImageUrl(imageUrl, options = {}) {
  if (!imageUrl) return imageUrl;
  if (imageUrl.includes("/.netlify/images")) {
    return imageUrl;
  }
  const params = new URLSearchParams();
  params.set("url", imageUrl);
  if (options.width) params.set("w", options.width);
  if (options.height) params.set("h", options.height);
  if (options.fit) params.set("fit", options.fit);
  if (options.format) params.set("fm", options.format);
  if (options.quality) params.set("q", options.quality);
  return `/.netlify/images?${params.toString()}`;
}
function shouldUseNetlifyImageCDN(imageUrl) {
  if (!imageUrl) return false;
  if (imageUrl.includes("res.cloudinary.com")) return true;
  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) return true;
  return false;
}

// components/modal.js
function generateRecommendationBlurb(record) {
  var _a;
  const sortBy = ((_a = document.getElementById("sort-by")) == null ? void 0 : _a.value) || "recommended";
  const goalBucket = buildGoalBucket(sortBy);
  if (goalBucket.length === 0) {
    return "<span class='beta-tag-subtle' style='float: right; margin-left: 5px;'>Beta</span><strong style='color: #5a6268;'>Tip:</strong> Add goals to your 'Goals/Notes' or search to get personalized recommendations.";
  }
  const score = calculateRecommendationScore(record, goalBucket);
  if (score > 0) {
    let goalString = "goals";
    const displayGoals = goalBucket.filter(
      (g) => !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Activity"].includes(g.toLowerCase()) && !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Food & Drink"].includes(g.toLowerCase()) && !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Venues"].includes(g.toLowerCase()) && !ATTRIBUTE_TO_KEYWORDS_MAP["Pillars.Extras"].includes(g.toLowerCase())
    );
    if (displayGoals.length > 2) {
      goalString = `'${displayGoals.slice(0, -1).join("', '")}', and '${displayGoals.slice(-1)}'`;
    } else if (displayGoals.length > 0) {
      goalString = `'${displayGoals.join("' and '")}'`;
    }
    return `<span class='beta-tag-subtle' style='float: right; margin-left: 5px;'>Beta</span><strong style='color: #0056b3;'>Recommended for you (Score: ${score.toFixed(0)})</strong> This item is a good match for your ${goalString} goals.`;
  }
  return null;
}
var stripe;
var elements;
var paymentElement;
var currentClientSecret = null;
var currentBaseAmount = 0;
var currentPaymentType = "card";
var currentProcessingFee = 0;
var currentShopSettings = {};
var modalOverlay = document.getElementById("detail-modal-overlay");
var currentItemChatRecordId = null;
function closeDetailModal() {
  updateUrl2({ openItem: null });
  hideDetailModal();
}
function handleEscapeKey(event) {
  if (event.key === "Escape") {
    closeDetailModal();
  }
}
function handleOverlayClick(event) {
  if (event.target === modalOverlay) {
    closeDetailModal();
  }
}
async function updateCheckoutDisplay() {
  var _a;
  const finalTotal = parseFloat(document.getElementById("full-total-price").dataset.total || 0);
  const amountReceived = state.session.user.amountReceived || 0;
  const totalDue = finalTotal - amountReceived;
  const isFullyPaid = totalDue <= 9e-3;
  const choice = ((_a = document.querySelector('input[name="paymentChoice"]:checked')) == null ? void 0 : _a.value) || "deposit";
  let baseAmountToCharge = totalDue;
  const isInitialDeposit = amountReceived === 0 && (currentShopSettings.paymentOptions !== "DepositOrFull" || choice === "deposit");
  const tipRow = document.querySelector(".tip-row");
  if (tipRow) {
    if (isInitialDeposit && totalDue > baseAmountToCharge * 1.05) {
      tipRow.style.display = "none";
    } else {
      tipRow.style.display = "flex";
    }
  }
  if (amountReceived === 0) {
    if (currentShopSettings.paymentOptions === "DepositOrFull" && choice === "full") {
      baseAmountToCharge = finalTotal;
      document.getElementById("deposit-label").textContent = "Full Amount Due:";
    } else {
      baseAmountToCharge = finalTotal * 0.35;
      document.getElementById("deposit-label").textContent = "35% Deposit Due:";
    }
  } else {
    document.getElementById("deposit-label").textContent = "Remaining Balance Due:";
  }
  const tipAmount = parseFloat(document.getElementById("tip-amount").value) || 0;
  let finalBaseAmount = baseAmountToCharge + tipAmount;
  document.getElementById("deposit-price").textContent = `$${finalBaseAmount.toFixed(2)}`;
  const processingFeeEl = document.getElementById("processing-fee-price");
  const finalChargeEl = document.getElementById("final-charge-price");
  const paymentForm = document.getElementById("payment-form");
  if (isFullyPaid && finalBaseAmount <= 0) {
    log("Modal", "Receipt mode: Plan is fully paid.");
    if (paymentForm) paymentForm.style.display = "none";
    if (tipRow) tipRow.style.display = "none";
    return;
  }
  if (paymentForm) paymentForm.style.display = "block";
  if (finalBaseAmount > 0 && finalBaseAmount < 0.5) {
    finalBaseAmount = 0.5;
    log("Modal", "Amount less than $0.50, rounding up to Stripe minimum $0.50");
  }
  if (finalBaseAmount !== currentBaseAmount) {
    log("Modal", `Price changed from ${currentBaseAmount} to ${finalBaseAmount}. Rebuilding PaymentElement.`);
    currentBaseAmount = finalBaseAmount;
    if (processingFeeEl) processingFeeEl.textContent = "Calculating...";
    if (finalChargeEl) finalChargeEl.textContent = "Calculating...";
    try {
      const intentResponse = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Math.round(currentBaseAmount * 100),
          paymentMethodType: currentPaymentType
          // Use the stored payment type
        })
      });
      if (!intentResponse.ok) throw new Error("Could not update payment intent.");
      const intentData = await intentResponse.json();
      const newClientSecret = intentData.clientSecret;
      const newProcessingFee = intentData.processingFeeInCents / 100;
      currentProcessingFee = newProcessingFee;
      if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
      if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + newProcessingFee).toFixed(2)}`;
      if (paymentElement) {
        paymentElement.unmount();
      }
      currentClientSecret = newClientSecret;
      elements = stripe.elements({ clientSecret: currentClientSecret });
      paymentElement = elements.create("payment");
      paymentElement.mount("#payment-element");
      paymentElement.on("change", debounce(handlePaymentTypeChange, 300));
    } catch (error) {
      console.error("Failed to update payment intent/element:", error);
      if (processingFeeEl) processingFeeEl.textContent = "Error";
      if (finalChargeEl) finalChargeEl.textContent = "Error";
    }
  } else {
    log("Modal", "Price did not change, just updating fee display.");
    if (processingFeeEl) processingFeeEl.textContent = `$${currentProcessingFee.toFixed(2)}`;
    if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + currentProcessingFee).toFixed(2)}`;
  }
}
async function handlePaymentTypeChange(event) {
  if (!event.value.type || event.value.type === currentPaymentType) {
    return;
  }
  currentPaymentType = event.value.type;
  log("Modal", `Payment type changed to: ${currentPaymentType}. Fetching new fee.`);
  const processingFeeEl = document.getElementById("processing-fee-price");
  const finalChargeEl = document.getElementById("final-charge-price");
  if (processingFeeEl) processingFeeEl.textContent = "Calculating...";
  if (finalChargeEl) finalChargeEl.textContent = "Calculating...";
  try {
    const intentResponse = await fetch("/api/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(currentBaseAmount * 100),
        paymentMethodType: currentPaymentType
      })
    });
    if (!intentResponse.ok) throw new Error("Could not fetch new processing fee.");
    const intentData = await intentResponse.json();
    const newProcessingFee = intentData.processingFeeInCents / 100;
    currentProcessingFee = newProcessingFee;
    if (processingFeeEl) processingFeeEl.textContent = `$${newProcessingFee.toFixed(2)}`;
    if (finalChargeEl) finalChargeEl.textContent = `$${(currentBaseAmount + newProcessingFee).toFixed(2)}`;
    log("Modal", `New fee is ${newProcessingFee.toFixed(2)}`);
  } catch (error) {
    console.error("Failed to update fee on type change:", error);
    if (processingFeeEl) processingFeeEl.textContent = "Error";
    if (finalChargeEl) finalChargeEl.textContent = "Error";
  }
}
function getBreadcrumbs(record) {
  const breadcrumbs = [];
  let current = record;
  while (current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
    const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
    breadcrumbs.unshift(parentName);
    current = state.records.all.find((r) => r.fields.Name === parentName);
    if (!current) break;
  }
  return breadcrumbs;
}
function resetModalState() {
  const elements2 = {
    modalHeaderActions: document.getElementById("modal-header-actions"),
    modalItemName: document.getElementById("modal-item-name"),
    modalItemPrice: document.getElementById("modal-item-price"),
    modalItemDescription: document.getElementById("modal-item-description"),
    modalMainImage: document.getElementById("modal-main-image"),
    modalThumbnailStrip: document.getElementById("modal-thumbnail-strip"),
    modalOptionsContainer: document.getElementById("modal-options-container"),
    modalQuantitySelector: document.getElementById("modal-quantity-selector"),
    modalItemNote: document.getElementById("modal-item-note"),
    modalCalendarContainer: document.getElementById("modal-calendar-container"),
    modalBreadcrumbs: document.getElementById("modal-breadcrumbs"),
    modalAdditionalDetails: document.getElementById("modal-additional-details"),
    modalRecommendationBlurb: document.getElementById("modal-recommendation-blurb")
  };
  for (const key in elements2) {
    if (elements2[key]) {
      if (key === "modalItemNote") elements2[key].value = "";
      else if (key === "modalMainImage") elements2[key].style.backgroundImage = "";
      else if (key === "modalRecommendationBlurb") {
        elements2[key].innerHTML = "";
        elements2[key].style.display = "none";
      } else elements2[key].innerHTML = "";
    }
  }
  const dynamicSections = document.querySelectorAll(".event-info-section, .rsvp-list-section, .calendar-export-section, .session-components-section");
  dynamicSections.forEach((section) => section.remove());
  log("Modal", "Reset modal state.");
}
async function initializePlanCarousel(componentRecords) {
  if (componentRecords.length === 0) return;
  let currentIndex = 0;
  const carouselImage = document.getElementById("plan-carousel-image");
  const carouselItemName = document.getElementById("carousel-item-name");
  const carouselItemDetails = document.getElementById("carousel-item-details");
  const dotsContainer = document.getElementById("carousel-dots-container");
  const prevButton = document.querySelector(".carousel-prev");
  const nextButton = document.querySelector(".carousel-next");
  if (!carouselImage || !carouselItemName || !carouselItemDetails || !dotsContainer) {
    console.warn("Carousel elements not found in DOM");
    return;
  }
  const componentImages = [];
  for (const componentData of componentRecords) {
    const record = componentData.record;
    let imageUrl = getPlaceholderImage([]);
    if (!record.id.startsWith("custom-") && !record.id.startsWith("ai-search-")) {
      try {
        const { imageUrls: fetchedUrls } = await fetchImagesForRecord(record, state.records.all, /* @__PURE__ */ new Map());
        if (fetchedUrls && fetchedUrls.length > 0) {
          imageUrl = fetchedUrls[0];
        }
      } catch (e) {
        console.warn("Failed to fetch image for component:", record.id, e);
      }
    }
    componentImages.push({
      ...componentData,
      imageUrl
    });
  }
  function updateCarousel() {
    const current = componentImages[currentIndex];
    const record = current.record;
    const history2 = current.history;
    const type = current.type;
    const optimizedImage = current.imageUrl.includes("cloudinary") ? current.imageUrl.replace("/upload/", "/upload/w_800,h_600,c_fill,f_auto,q_auto/") : current.imageUrl;
    carouselImage.src = optimizedImage;
    const statusBadge = type === "locked" ? '<span style="background: #28a745; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; margin-left: 8px;">✅ Locked In</span>' : '<span style="background: #ffc107; color: #000; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; margin-left: 8px;">\u{1F4A1} Idea</span>';
    carouselItemName.innerHTML = `${record.fields.Name || "Untitled"} ${statusBadge}`;
    const quantity = (history2 == null ? void 0 : history2.quantity) || 1;
    const note = (history2 == null ? void 0 : history2.note) || "";
    const isGhost = !state.records.all.find((r) => r.id === record.id);
    let detailsHTML = "";
    if (quantity > 1) {
      detailsHTML += `Quantity: ${quantity}`;
    }
    if (isGhost) {
      detailsHTML += (detailsHTML ? " • " : "") + "Archived Item";
    }
    if (note) {
      detailsHTML += (detailsHTML ? " • " : "") + `Note: ${note}`;
    }
    carouselItemDetails.innerHTML = detailsHTML || "No additional details";
    dotsContainer.innerHTML = "";
    componentImages.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.style.cssText = `
                width: 10px;
                height: 10px;
                border-radius: 50%;
                border: none;
                cursor: pointer;
                transition: background-color 0.3s;
                ${index === currentIndex ? "background-color: #007bff;" : "background-color: #ccc;"}
            `;
      dot.addEventListener("click", () => {
        currentIndex = index;
        updateCarousel();
      });
      dotsContainer.appendChild(dot);
    });
    if (prevButton && nextButton) {
      prevButton.style.display = componentImages.length > 1 ? "block" : "none";
      nextButton.style.display = componentImages.length > 1 ? "block" : "none";
    }
  }
  if (prevButton) {
    prevButton.addEventListener("click", () => {
      currentIndex = (currentIndex - 1 + componentImages.length) % componentImages.length;
      updateCarousel();
    });
  }
  if (nextButton) {
    nextButton.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % componentImages.length;
      updateCarousel();
    });
  }
  const handleKeydown = (e) => {
    if (e.key === "ArrowLeft" && componentImages.length > 1) {
      currentIndex = (currentIndex - 1 + componentImages.length) % componentImages.length;
      updateCarousel();
    } else if (e.key === "ArrowRight" && componentImages.length > 1) {
      currentIndex = (currentIndex + 1) % componentImages.length;
      updateCarousel();
    }
  };
  document.addEventListener("keydown", handleKeydown);
  const cleanup = () => {
    document.removeEventListener("keydown", handleKeydown);
  };
  modalOverlay.addEventListener("transitionend", cleanup, { once: true });
  updateCarousel();
}
async function showDetailModal(record, startPhotoIndex = 0) {
  const detailSpecs = [
    { fieldName: "Duration", label: "Duration" },
    { fieldName: "Capacity", label: "Capacity" },
    { fieldName: "Location Details", label: "Location Info" },
    { fieldName: "Additional Information", label: "Good to Know" }
  ];
  log("Modal", `Showing detail modal for "${record.fields.Name}"`);
  updateUrl2({ openItem: record.id });
  const modalHeaderActions = document.getElementById("modal-header-actions");
  const modalItemName = document.getElementById("modal-item-name");
  const modalItemPrice = document.getElementById("modal-item-price");
  const modalItemDescription = document.getElementById("modal-item-description");
  const modalMainImage = document.getElementById("modal-main-image");
  const modalThumbnailStrip = document.getElementById("modal-thumbnail-strip");
  const modalOptionsContainer = document.getElementById("modal-options-container");
  const modalQuantitySelector = document.getElementById("modal-quantity-selector");
  const modalNotesContainer = document.getElementById("modal-notes-container");
  const modalItemNote = document.getElementById("modal-item-note");
  const modalCalendarContainer = document.getElementById("modal-calendar-container");
  const modalActionsContainer = document.getElementById("modal-actions-container");
  const modalBreadcrumbs = document.getElementById("modal-breadcrumbs");
  const modalAdditionalDetails = document.getElementById("modal-additional-details");
  const addToPlanBtn = document.getElementById("modal-add-to-plan-btn");
  const modalRecBlurb = document.getElementById("modal-recommendation-blurb");
  const closeBtn3 = document.getElementById("modal-close-btn");
  closeBtn3.onclick = closeDetailModal;
  modalOverlay.addEventListener("click", handleOverlayClick);
  document.addEventListener("keydown", handleEscapeKey);
  resetModalState();
  modalOverlay.dataset.recordId = record.id;
  let linkedSession = null;
  let linkedSessionId = null;
  let itemIsContainedInSession = false;
  if (record.fields.LinkedSession && record.fields.LinkedSession.length > 0) {
    linkedSessionId = record.fields.LinkedSession[0];
    linkedSession = await fetchSessionById(linkedSessionId);
    log("Modal", `Item linked to session ${linkedSessionId}, using session chat context`);
    currentItemChatRecordId = linkedSessionId;
  } else {
    if (record.fields["Item Type"] === "Event") {
      linkedSession = await fetchSessionByLinkedItem(record.id);
      if (linkedSession) {
        linkedSessionId = linkedSession.id;
        currentItemChatRecordId = linkedSessionId;
      } else {
        linkedSession = await fetchSessionContainingItem(record.id, state.ui.activeShopId);
        if (linkedSession) {
          linkedSessionId = linkedSession.id;
          currentItemChatRecordId = linkedSessionId;
          itemIsContainedInSession = true;
          log("Modal", `Event item found as component in session ${linkedSessionId}`);
        } else {
          currentItemChatRecordId = record.id;
        }
      }
    } else {
      currentItemChatRecordId = record.id;
    }
  }
  const isLocked = state.cart.lockedItems.has(record.id);
  modalOverlay.dataset.mode = isLocked ? "edit-locked" : "edit-favorite";
  const itemState = isLocked ? state.cart.lockedItems.get(record.id) : getItemState(record.id);
  if (addToPlanBtn) {
    addToPlanBtn.textContent = isLocked ? "Update Plan" : "Add to Plan";
    addToPlanBtn.dataset.tooltip = isLocked ? "Update plan with changes" : "Add to plan";
  }
  let imageUrls = [];
  if (!record.id.startsWith("custom-") && !record.id.startsWith("ai-search-")) {
    const { imageUrls: fetchedUrls } = await fetchImagesForRecord(record, state.records.all, /* @__PURE__ */ new Map());
    imageUrls = fetchedUrls;
  }
  if (imageUrls.length === 0) {
    imageUrls = [getPlaceholderImage([])];
  }
  modalItemName.textContent = record.fields.Name || "Untitled";
  modalItemDescription.textContent = record.fields.Description || "";
  const parsedOptionGroups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
  const flatOptions = flattenOptionGroups(parsedOptionGroups);
  const allRecordNames = new Set(state.records.all.map((r) => r.fields.Name));
  if (record.fields["Item Type"] === "Event") {
    const hasChildEventOptions = flatOptions.some((opt) => allRecordNames.has(opt.name));
    const rsvpYes = record.fields.RSVPs || [];
    const rsvpMaybe = record.fields.RSVPMaybe || [];
    const rsvpNo = record.fields.RSVPNo || [];
    const userId = state.session.user.id;
    const isUserRegistered = rsvpYes.includes(userId) || rsvpMaybe.includes(userId) || rsvpNo.includes(userId);
    if (!hasChildEventOptions && !isUserRegistered) {
      const eventDateStr = record.fields.Date;
      const eventTime = record.fields.Time || "";
      const eventLocation = record.fields.Location || "";
      if (eventDateStr) {
        const eventDate = /* @__PURE__ */ new Date(eventDateStr + "T00:00:00");
        const dateStr = eventDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        });
        const eventInfoSection = document.createElement("div");
        eventInfoSection.className = "event-info-section";
        eventInfoSection.innerHTML = `
                <div class="event-date-time">
                    <strong>\u{1F4C5} ${dateStr}</strong>${eventTime ? ` at ${eventTime}` : ""}
                </div>
                ${eventLocation ? `<div class="event-location">\u{1F4CD} ${eventLocation}</div>` : ""}
            `;
        modalItemDescription.parentElement.insertBefore(eventInfoSection, modalItemDescription);
      }
      if (rsvpYes.length > 0 || rsvpMaybe.length > 0 || rsvpNo.length > 0) {
        const rsvpListSection = document.createElement("div");
        rsvpListSection.className = "rsvp-list-section";
        let rsvpHTML = '<div class="rsvp-list-header"><strong>RSVPs</strong></div>';
        if (rsvpYes.length > 0) {
          rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Going (${rsvpYes.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
        }
        if (rsvpMaybe.length > 0) {
          rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Maybe (${rsvpMaybe.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
        }
        if (rsvpNo.length > 0) {
          rsvpHTML += `<div class="rsvp-list-group">
                    <div class="rsvp-list-label">Can't Go (${rsvpNo.length})</div>
                    <div class="rsvp-list-items">Anonymous users</div>
                </div>`;
        }
        rsvpListSection.innerHTML = rsvpHTML;
        modalItemDescription.parentElement.insertBefore(rsvpListSection, modalItemDescription);
      }
    }
  }
  const isEventType = record.fields["Item Type"] === "Event";
  const eventRsvpYes = record.fields.RSVPs || [];
  const eventRsvpMaybe = record.fields.RSVPMaybe || [];
  const eventRsvpNo = record.fields.RSVPNo || [];
  const currentUserId = state.session.user.id;
  const isCurrentUserRegistered = eventRsvpYes.includes(currentUserId) || eventRsvpMaybe.includes(currentUserId) || eventRsvpNo.includes(currentUserId);
  if (linkedSession && linkedSession.fields && !(isEventType && isCurrentUserRegistered)) {
    log("Modal", `Displaying session components for linked session ${linkedSessionId}`);
    let lockedInHistory = [];
    let ideasHistory = [];
    if (linkedSession.fields["Items with Variations"]) {
      try {
        const sessionData = JSON.parse(linkedSession.fields["Items with Variations"]);
        const lockedInItems = sessionData.lockedInItems || {};
        const ideasItems = sessionData.ideasItems || {};
        lockedInHistory = Object.entries(lockedInItems).map(([id, itemInfo]) => ({
          id,
          quantity: itemInfo.quantity || 1,
          selectedOptionIndex: itemInfo.selectedOptionIndex,
          note: itemInfo.note,
          overridePrice: itemInfo.overridePrice
        }));
        ideasHistory = Object.entries(ideasItems).map(([id, itemInfo]) => ({
          id,
          quantity: itemInfo.quantity || 1,
          selectedOptionIndex: itemInfo.selectedOptionIndex,
          note: itemInfo.note,
          overridePrice: itemInfo.overridePrice
        }));
      } catch (e) {
        console.warn("Could not parse Items with Variations for session:", linkedSessionId, e);
        lockedInHistory = [];
        ideasHistory = [];
      }
    }
    const lockedComponentIds = lockedInHistory.map((item) => item.id).filter((id) => id);
    const ideaComponentIds = ideasHistory.map((item) => item.id).filter((id) => id);
    const allComponentIds = [...lockedComponentIds, ...ideaComponentIds];
    const missingItemIds = allComponentIds.filter(
      (id) => !state.records.all.some((r) => r.id === id) && (!state.records.archive || !state.records.archive.some((r) => r.id === id)) && id.startsWith("rec")
      // Only fetch real Airtable IDs, not custom items
    );
    if (missingItemIds.length > 0) {
      log("Modal", `Found ${missingItemIds.length} missing component items, fetching...`);
      try {
        const ghostItems = await fetchGhostItems(missingItemIds);
        if (ghostItems.length > 0) {
          const existingArchive = state.records.archive || [];
          state.records.archive = [...existingArchive, ...ghostItems];
          log("Modal", `Fetched and stored ${ghostItems.length} ghost component items`);
        }
      } catch (e) {
        console.warn("Failed to fetch ghost items for modal:", e);
      }
    }
    if (lockedComponentIds.length > 0 || ideaComponentIds.length > 0) {
      const allComponentRecords = [];
      const componentHistoryMap = /* @__PURE__ */ new Map();
      for (const componentId of lockedComponentIds) {
        let componentRecord = state.records.all.find((r) => r.id === componentId);
        if (!componentRecord && state.records.archive) {
          componentRecord = state.records.archive.find((r) => r.id === componentId);
        }
        if (componentRecord) {
          allComponentRecords.push({
            record: componentRecord,
            type: "locked",
            history: lockedInHistory.find((item) => item.id === componentId)
          });
          componentHistoryMap.set(componentId, lockedInHistory.find((item) => item.id === componentId));
        }
      }
      for (const ideaId of ideaComponentIds) {
        let ideaRecord = state.records.all.find((r) => r.id === ideaId);
        if (!ideaRecord && state.records.archive) {
          ideaRecord = state.records.archive.find((r) => r.id === ideaId);
        }
        if (ideaRecord) {
          allComponentRecords.push({
            record: ideaRecord,
            type: "idea",
            history: ideasHistory.find((item) => item.id === ideaId)
          });
          componentHistoryMap.set(ideaId, ideasHistory.find((item) => item.id === ideaId));
        }
      }
      const sessionComponentsSection = document.createElement("div");
      sessionComponentsSection.className = "session-components-section";
      sessionComponentsSection.style.cssText = "margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;";
      const planName = linkedSession.fields.Name || "Plan";
      let sectionHeader;
      if (itemIsContainedInSession) {
        sectionHeader = `<h4 style="margin-top: 0; color: #495057;">\u{1F4CB} Part of Plan: ${planName}</h4>`;
      } else {
        sectionHeader = '<h4 style="margin-top: 0; color: #495057;">\u{1F4CB} Plan Components</h4>';
      }
      let componentsHTML = sectionHeader;
      if (allComponentRecords.length > 0) {
        componentsHTML += `
                    <div class="plan-items-carousel" style="margin: 15px 0; position: relative; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        <div class="carousel-container" style="position: relative;">
                            <div class="carousel-image-container" style="width: 100%; height: 300px; position: relative; background: #000;">
                                <img id="plan-carousel-image" style="width: 100%; height: 100%; object-fit: cover;" src="" alt="Item image">
                                <div class="carousel-overlay" style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); padding: 15px; color: white;">
                                    <div id="carousel-item-name" style="font-weight: bold; font-size: 1.1em; margin-bottom: 5px;"></div>
                                    <div id="carousel-item-details" style="font-size: 0.9em; opacity: 0.9;"></div>
                                </div>
                            </div>
                            <button class="carousel-nav carousel-prev" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.9); border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 20px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;">‹</button>
                            <button class="carousel-nav carousel-next" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.9); border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 20px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;">›</button>
                        </div>
                        <div class="carousel-dots" style="display: flex; justify-content: center; padding: 10px; gap: 8px;" id="carousel-dots-container"></div>
                    </div>
                `;
      }
      if (lockedComponentIds.length > 0) {
        componentsHTML += '<div class="locked-in-section" style="margin-bottom: 15px;">';
        componentsHTML += '<h5 style="margin: 10px 0 8px 0; color: #28a745; font-size: 0.95em;">✅ Locked In</h5>';
        componentsHTML += '<div class="session-components-list">';
        for (const componentId of lockedComponentIds) {
          let componentRecord = state.records.all.find((r) => r.id === componentId);
          if (!componentRecord && state.records.archive) {
            componentRecord = state.records.archive.find((r) => r.id === componentId);
          }
          if (componentRecord) {
            const componentName = componentRecord.fields.Name || "Untitled";
            const historyItem = lockedInHistory.find((item) => item.id === componentId);
            const quantity = (historyItem == null ? void 0 : historyItem.quantity) || 1;
            const note = (historyItem == null ? void 0 : historyItem.note) || "";
            const isGhost = !state.records.all.find((r) => r.id === componentId);
            componentsHTML += `
                            <div class="session-component-item" style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background-color: white; border-radius: 4px; border-left: 3px solid #28a745; ${isGhost ? "opacity: 0.7;" : ""}">
                                <div>
                                    <strong>${componentName}</strong> ${quantity > 1 ? `(x${quantity})` : ""}
                                    ${isGhost ? '<span style="color: #6c757d; font-size: 0.85em; margin-left: 8px;">[Archived]</span>' : ""}
                                    ${note ? `<div style="font-size: 0.85em; color: #6c757d; margin-top: 4px;">Note: ${note}</div>` : ""}
                                </div>
                            </div>
                        `;
          } else {
            console.warn("Could not find record for locked component ID:", componentId);
          }
        }
        componentsHTML += "</div></div>";
      }
      if (ideaComponentIds.length > 0) {
        componentsHTML += '<div class="ideas-section">';
        componentsHTML += '<h5 style="margin: 10px 0 8px 0; color: #ffc107; font-size: 0.95em;">\u{1F4A1} Ideas for the Session</h5>';
        componentsHTML += '<div class="session-ideas-list">';
        for (const ideaId of ideaComponentIds) {
          let ideaRecord = state.records.all.find((r) => r.id === ideaId);
          if (!ideaRecord && state.records.archive) {
            ideaRecord = state.records.archive.find((r) => r.id === ideaId);
          }
          if (ideaRecord) {
            const ideaName = ideaRecord.fields.Name || "Untitled";
            const historyItem = ideasHistory.find((item) => item.id === ideaId);
            const quantity = (historyItem == null ? void 0 : historyItem.quantity) || 1;
            const note = (historyItem == null ? void 0 : historyItem.note) || "";
            const isGhost = !state.records.all.find((r) => r.id === ideaId);
            componentsHTML += `
                            <div class="session-idea-item" style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background-color: white; border-radius: 4px; border-left: 3px solid #ffc107; ${isGhost ? "opacity: 0.7;" : ""}">
                                <div>
                                    <strong>${ideaName}</strong> ${quantity > 1 ? `(x${quantity})` : ""}
                                    ${isGhost ? '<span style="color: #6c757d; font-size: 0.85em; margin-left: 8px;">[Archived]</span>' : ""}
                                    ${note ? `<div style="font-size: 0.85em; color: #6c757d; margin-top: 4px;">Note: ${note}</div>` : ""}
                                </div>
                            </div>
                        `;
          } else {
            console.warn("Could not find record for idea ID:", ideaId);
          }
        }
        componentsHTML += "</div></div>";
      }
      sessionComponentsSection.innerHTML = componentsHTML;
      modalItemDescription.parentElement.insertBefore(sessionComponentsSection, modalItemDescription);
      if (allComponentRecords.length > 0) {
        initializePlanCarousel(allComponentRecords);
      }
      const isCollaborator = linkedSession.fields.Collaborators && linkedSession.fields.Collaborators.includes(state.session.user.id);
      const sessionStoreId = linkedSession.fields.Stores && linkedSession.fields.Stores.length > 0 ? linkedSession.fields.Stores[0] : null;
      const isOwnerOfSessionStore = state.session.user.isOwner && state.session.user.ownedStoreId && sessionStoreId === state.session.user.ownedStoreId;
      const userHasPublishAccess = userHasPublishPermission();
      if (isCollaborator || isOwnerOfSessionStore || userHasPublishAccess) {
        log("Modal", "User is collaborator, owns the session store, or has publish access, showing Edit Plan button");
        const editPlanBtn = document.createElement("button");
        editPlanBtn.className = "edit-plan-btn";
        editPlanBtn.style.cssText = "margin: 15px 0 0 0; padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; font-size: 1em; transition: background-color 0.2s;";
        editPlanBtn.textContent = "✏️ Edit Plan";
        editPlanBtn.onmouseover = () => editPlanBtn.style.backgroundColor = "#0056b3";
        editPlanBtn.onmouseout = () => editPlanBtn.style.backgroundColor = "#007bff";
        editPlanBtn.addEventListener("click", () => {
          log("Modal", `Navigating to edit session ${linkedSessionId}`);
          closeDetailModal();
          window.location.href = `${window.location.pathname}?session=${linkedSessionId}&shopId=${state.ui.activeShopId}`;
        });
        sessionComponentsSection.appendChild(editPlanBtn);
      }
    } else {
      const isCollaborator = linkedSession.fields.Collaborators && linkedSession.fields.Collaborators.includes(state.session.user.id);
      const sessionStoreId = linkedSession.fields.Stores && linkedSession.fields.Stores.length > 0 ? linkedSession.fields.Stores[0] : null;
      const isOwnerOfSessionStore = state.session.user.isOwner && state.session.user.ownedStoreId && sessionStoreId === state.session.user.ownedStoreId;
      const userHasPublishAccess = userHasPublishPermission();
      if (itemIsContainedInSession || isCollaborator || isOwnerOfSessionStore || userHasPublishAccess) {
        const planName = linkedSession.fields.Name || "Plan";
        const editPlanSection = document.createElement("div");
        editPlanSection.style.cssText = "margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;";
        if (itemIsContainedInSession) {
          const headerEl = document.createElement("h4");
          headerEl.style.cssText = "margin-top: 0; margin-bottom: 10px; color: #495057;";
          headerEl.textContent = `Part of Plan: ${planName}`;
          editPlanSection.appendChild(headerEl);
          log("Modal", `Showing "Part of Plan" indicator for contained item in session ${linkedSessionId}`);
        } else {
          log("Modal", "User is collaborator, owns the session store, or has publish access (no components yet), showing Edit Plan button");
        }
        if (isCollaborator || isOwnerOfSessionStore || userHasPublishAccess) {
          const editPlanBtn = document.createElement("button");
          editPlanBtn.className = "edit-plan-btn";
          editPlanBtn.style.cssText = "padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; font-size: 1em; transition: background-color 0.2s;";
          editPlanBtn.textContent = "✏️ Edit Plan";
          editPlanBtn.onmouseover = () => editPlanBtn.style.backgroundColor = "#0056b3";
          editPlanBtn.onmouseout = () => editPlanBtn.style.backgroundColor = "#007bff";
          editPlanBtn.addEventListener("click", () => {
            log("Modal", `Navigating to edit session ${linkedSessionId}`);
            closeDetailModal();
            window.location.href = `${window.location.pathname}?session=${linkedSessionId}&shopId=${state.ui.activeShopId}`;
          });
          editPlanSection.appendChild(editPlanBtn);
        }
        modalItemDescription.parentElement.insertBefore(editPlanSection, modalItemDescription);
      }
    }
  }
  try {
    const blurbHtml = generateRecommendationBlurb(record);
    if (blurbHtml && modalRecBlurb) {
      modalRecBlurb.innerHTML = blurbHtml;
      modalRecBlurb.style.display = "block";
    }
  } catch (e) {
    console.warn("Failed to generate recommendation blurb:", e);
  }
  if (modalAdditionalDetails) {
    modalAdditionalDetails.innerHTML = "";
    const fragment = document.createDocumentFragment();
    let hasRankings = false;
    const rankingsHtmlParts = [];
    detailSpecs.forEach((spec) => {
      const value = record.fields[spec.fieldName];
      if (value) {
        const detailItem = document.createElement("div");
        detailItem.className = "detail-item";
        detailItem.innerHTML = `
                    <span class="detail-label">${spec.label}</span>
                    <span class="detail-value">${String(value).replace(/\n/g, "<br>")}</span>
                `;
        fragment.appendChild(detailItem);
      }
    });
    const rankingsJsonString = record.fields["AI_Profile"] || record.fields["Rankings"];
    if (rankingsJsonString) {
      try {
        const rankingsObject = JSON.parse(rankingsJsonString);
        let displayRankings = {};
        if (rankingsObject.profileSource && rankingsObject.Vibe) {
          displayRankings = { ...rankingsObject.Vibe, ...rankingsObject.Intellect, ...rankingsObject.Physicality };
        } else if (rankingsObject.Profile) {
          displayRankings = rankingsObject.Profile;
        } else {
          displayRankings = rankingsObject;
        }
        for (const label in displayRankings) {
          if (Object.hasOwnProperty.call(displayRankings, label)) {
            const value = displayRankings[label];
            if (typeof value === "number" && value > 0) {
              hasRankings = true;
              const stars = "★".repeat(Math.round(value / 2)) + "☆".repeat(Math.max(0, 5 - Math.round(value / 2)));
              rankingsHtmlParts.push(`
                                <div class="ranking-item">
                                    <span class="ranking-label">${label}:</span>
                                    <span class="ranking-stars">${stars}</span>
                                </div>
                            `);
            }
          }
        }
      } catch (error) {
        console.error(`[Modal Debug] Error parsing Rankings JSON for item ${record.id}:`, error);
      }
    }
    if (hasRankings) {
      const rankingContainer = document.createElement("div");
      rankingContainer.className = "ranking-list detail-item";
      rankingContainer.innerHTML = `
                <span class="detail-label">Rankings</span>
                ${rankingsHtmlParts.join("")}
            `;
      fragment.appendChild(rankingContainer);
    }
    modalAdditionalDetails.appendChild(fragment);
  }
  const isGrouping = !record.id.startsWith("custom-") && !record.id.startsWith("ai-search-") && record.fields["Item Type"] === "Grouping";
  const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
  const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : "";
  if (isGrouping) {
    const range = getGroupPriceRange(record);
    modalItemPrice.innerHTML = range && typeof range.min === "number" ? range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}` : "Price Varies";
  } else {
    const price = getRecordPrice(record, itemState.selectedOptionIndex);
    let priceText = typeof price === "number" ? `$${price.toFixed(2)}` : "N/A";
    if ((record.id.startsWith("custom-") || record.id.startsWith("ai-search-")) && price > 0) {
      priceText += " (Est.)";
    }
    modalItemPrice.innerHTML = priceText + pricingTypeHTML;
  }
  let currentPhotoIndex = startPhotoIndex;
  const optimizedMainImage = imageUrls[currentPhotoIndex].includes("cloudinary") ? imageUrls[currentPhotoIndex].replace("/upload/", "/upload/w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive/") : imageUrls[currentPhotoIndex];
  modalMainImage.style.backgroundImage = `url('${optimizedMainImage}')`;
  modalThumbnailStrip.innerHTML = "";
  imageUrls.forEach((url, index) => {
    const thumb = document.createElement("div");
    thumb.className = "thumbnail-img";
    const optimizedThumb = url.includes("cloudinary") ? url.replace("/upload/", "/upload/w_150,h_150,c_fill,f_auto,q_auto/") : url;
    thumb.style.backgroundImage = `url('${optimizedThumb}')`;
    if (index === currentPhotoIndex) thumb.classList.add("active");
    thumb.addEventListener("click", () => {
      var _a;
      currentPhotoIndex = index;
      const optimizedClickImage = imageUrls[index].includes("cloudinary") ? imageUrls[index].replace("/upload/", "/upload/w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive/") : imageUrls[index];
      modalMainImage.style.backgroundImage = `url('${optimizedClickImage}')`;
      (_a = modalThumbnailStrip.querySelector(".active")) == null ? void 0 : _a.classList.remove("active");
      thumb.classList.add("active");
    });
    modalThumbnailStrip.appendChild(thumb);
  });
  modalHeaderActions.innerHTML = "";
  const breadcrumbs = getBreadcrumbs(record);
  if (breadcrumbs.length > 0) {
    modalBreadcrumbs.innerHTML = breadcrumbs.map((name) => `<a class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(" > ");
  }
  const heartBtnContainer = document.createElement("div");
  heartBtnContainer.id = "modal-heart-btn";
  heartBtnContainer.dataset.recordId = record.id;
  modalHeaderActions.appendChild(heartBtnContainer);
  if (record.fields["Item Type"] === "Event") {
    const rsvpYes = record.fields.RSVPs || [];
    const rsvpMaybe = record.fields.RSVPMaybe || [];
    const rsvpNo = record.fields.RSVPNo || [];
    const userId = state.session.user.id;
    const hasRsvpdYes = rsvpYes.includes(userId);
    const hasRsvpdMaybe = rsvpMaybe.includes(userId);
    const hasRsvpdNo = rsvpNo.includes(userId);
    const hasLinkedSession = !!(record.fields.LinkedSession && record.fields.LinkedSession.length > 0);
    const userHasPublishAccess = userHasPublishPermission();
    if (userHasPublishAccess) {
      if (hasLinkedSession) {
        const editEventBtn = document.createElement("button");
        editEventBtn.className = "card-action-btn edit-event-btn";
        editEventBtn.dataset.eventId = record.id;
        editEventBtn.dataset.sessionId = record.fields.LinkedSession[0];
        editEventBtn.textContent = "Edit Event";
        editEventBtn.style.marginRight = "10px";
        modalHeaderActions.appendChild(editEventBtn);
      } else {
        const openToEditBtn = document.createElement("button");
        openToEditBtn.className = "card-action-btn open-to-edit-btn";
        openToEditBtn.dataset.eventId = record.id;
        openToEditBtn.textContent = "Open to Edit";
        openToEditBtn.style.marginRight = "10px";
        modalHeaderActions.appendChild(openToEditBtn);
      }
    }
    const rsvpContainer = document.createElement("div");
    rsvpContainer.className = "rsvp-button-group";
    const yesBtn = document.createElement("button");
    yesBtn.className = `rsvp-btn rsvp-yes ${hasRsvpdYes ? "active" : ""}`;
    yesBtn.dataset.recordId = record.id;
    yesBtn.dataset.rsvpType = "yes";
    yesBtn.innerHTML = hasRsvpdYes ? "Going ✅" : "Yes";
    const maybeBtn = document.createElement("button");
    maybeBtn.className = `rsvp-btn rsvp-maybe ${hasRsvpdMaybe ? "active" : ""}`;
    maybeBtn.dataset.recordId = record.id;
    maybeBtn.dataset.rsvpType = "maybe";
    maybeBtn.innerHTML = hasRsvpdMaybe ? "Maybe ❓" : "Maybe";
    const noBtn = document.createElement("button");
    noBtn.className = `rsvp-btn rsvp-no ${hasRsvpdNo ? "active" : ""}`;
    noBtn.dataset.recordId = record.id;
    noBtn.dataset.rsvpType = "no";
    noBtn.innerHTML = hasRsvpdNo ? "Can't Go ❌" : "No";
    rsvpContainer.appendChild(yesBtn);
    rsvpContainer.appendChild(maybeBtn);
    rsvpContainer.appendChild(noBtn);
    modalHeaderActions.appendChild(rsvpContainer);
  }
  modalOptionsContainer.innerHTML = "";
  const optionGroups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
  let currentSelections = { ...itemState.selections };
  if (Object.keys(currentSelections).length === 0 && itemState.selectedOptionIndex !== void 0) {
    const flatOptions2 = flattenOptionGroups(optionGroups);
    if (flatOptions2.length > 0 && itemState.selectedOptionIndex < flatOptions2.length) {
      let flatIndex = 0;
      for (let gIdx = 0; gIdx < optionGroups.length; gIdx++) {
        const group = optionGroups[gIdx];
        for (let oIdx = 0; oIdx < group.options.length; oIdx++) {
          if (flatIndex === itemState.selectedOptionIndex) {
            currentSelections[`group${gIdx}`] = oIdx;
            break;
          }
          flatIndex++;
        }
      }
    }
  }
  const updateOptionsUI = () => {
    const newPrice = getRecordPrice(record, currentSelections);
    modalItemPrice.innerHTML = (typeof newPrice === "number" ? `$${newPrice.toFixed(2)}` : "N/A") + pricingTypeHTML;
    const fullDescription = getRecordDescription(record, currentSelections);
    modalItemDescription.textContent = fullDescription;
    const imageTag = getActiveImageTag(record, currentSelections);
    if (imageTag) {
      fetchImagesByTags(record, [imageTag], state.records.all).then((taggedImages) => {
        if (taggedImages && taggedImages.length > 0) {
          const optimizedImage = taggedImages[0].includes("cloudinary") ? taggedImages[0].replace("/upload/", "/upload/w_1200,h_1000,c_fill,f_auto,q_auto,fl_progressive/") : taggedImages[0];
          modalMainImage.style.backgroundImage = `url('${optimizedImage}')`;
        }
      }).catch((err) => {
        log("Modal", `Failed to fetch image for tag ${imageTag}: ${err.message}`);
      });
    }
    modalOptionsContainer.dispatchEvent(new CustomEvent("change", {
      bubbles: true,
      detail: { selections: currentSelections }
    }));
  };
  if (optionGroups.length > 0) {
    optionGroups.forEach((group, groupIndex) => {
      const groupContainer = document.createElement("div");
      groupContainer.className = "option-group";
      groupContainer.dataset.groupIndex = groupIndex;
      if (optionGroups.length > 1 || group.name !== "Options") {
        const groupHeader = document.createElement("h4");
        groupHeader.className = "option-group-header";
        groupHeader.textContent = group.name;
        if (group.modifier) {
          const modifierSpan = document.createElement("span");
          modifierSpan.className = "option-group-modifier";
          modifierSpan.textContent = ` (${group.modifier})`;
          groupHeader.appendChild(modifierSpan);
        }
        groupContainer.appendChild(groupHeader);
      }
      const optionsWrapper = document.createElement("div");
      optionsWrapper.className = "option-group-options";
      group.options.forEach((opt, optionIndex) => {
        const optionButton = document.createElement("button");
        optionButton.className = "option-btn";
        optionButton.dataset.groupIndex = groupIndex;
        optionButton.dataset.optionIndex = optionIndex;
        const groupKey = `group${groupIndex}`;
        if (currentSelections[groupKey] === optionIndex) {
          optionButton.classList.add("selected");
        }
        let priceModText = "";
        if (opt.priceOverride !== null) {
          priceModText = `$${opt.priceOverride.toFixed(2)}`;
        } else if (opt.priceModifier !== null) {
          priceModText = `${opt.priceModifier >= 0 ? "+" : ""}$${opt.priceModifier.toFixed(2)}`;
        }
        let buttonContent = opt.name;
        if (priceModText) {
          buttonContent += ` <span class="price-mod">${priceModText}</span>`;
        }
        if (opt.imageTag) {
          buttonContent += ' <span class="image-indicator" title="Changes image">\u{1F4F7}</span>';
        }
        optionButton.innerHTML = buttonContent;
        if (allRecordNames.has(opt.name)) {
          optionButton.dataset.childName = opt.name;
          optionButton.classList.add("navigation-option");
          optionButton.addEventListener("click", (e) => {
            e.stopPropagation();
            const childName = e.currentTarget.dataset.childName;
            const childRecord = state.records.all.find((r) => r.fields.Name === childName);
            if (childRecord) {
              log("Modal", `Navigating from option to item: ${childName}`);
              showDetailModal(childRecord);
            } else {
              log("Modal", `Could not find record for child option: ${childName}`);
            }
          });
        } else {
          optionButton.addEventListener("click", (e) => {
            e.stopPropagation();
            optionsWrapper.querySelectorAll(".option-btn").forEach((btn) => {
              btn.classList.remove("selected");
            });
            e.currentTarget.classList.add("selected");
            const gIdx = parseInt(e.currentTarget.dataset.groupIndex, 10);
            const oIdx = parseInt(e.currentTarget.dataset.optionIndex, 10);
            currentSelections[`group${gIdx}`] = oIdx;
            updateOptionsUI();
          });
        }
        optionsWrapper.appendChild(optionButton);
      });
      groupContainer.appendChild(optionsWrapper);
      modalOptionsContainer.appendChild(groupContainer);
    });
    if (Object.keys(currentSelections).length > 0) {
      updateOptionsUI();
    }
  }
  const isEvent = record.fields["Item Type"] === "Event";
  if (!isGrouping) {
    modalActionsContainer.style.display = "block";
    modalNotesContainer.style.display = isEvent ? "none" : "block";
    modalItemNote.value = itemState.note;
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const effectiveMin = getEffectiveMinQuantity(record);
    modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button type="button" class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${effectiveMin}" step="1"><button type="button" class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
    const existingNudge = modalActionsContainer.querySelector(".umw-sales-nudge");
    const existingBadge = modalActionsContainer.querySelector(".umw-benefit-badge");
    if (existingNudge) existingNudge.remove();
    if (existingBadge) existingBadge.remove();
    let nudgeHTML = "";
    const currentQuantity = itemState.quantity || 1;
    if (effectiveMin < airtableMin && currentQuantity <= airtableMin) {
      nudgeHTML = `<div class="umw-benefit-badge">✅ UMW Benefit: ${airtableMin}-person minimum waived.</div>`;
    } else if (airtableMin > 1 && currentQuantity <= airtableMin) {
      nudgeHTML = `<div class="umw-sales-nudge">\u{1F4A1} <strong>Pro Tip:</strong> Host at <a href="#" class="search-link" data-term="Union Machine Works">Union Machine Works</a> to waive the ${airtableMin}-person minimum.</div>`;
    }
    if (nudgeHTML) {
      modalActionsContainer.insertAdjacentHTML("beforeend", nudgeHTML);
      const searchLink = modalActionsContainer.querySelector(".search-link");
      if (searchLink) {
        searchLink.addEventListener("click", async (e) => {
          e.preventDefault();
          const searchTerm = searchLink.dataset.term;
          const umwRecord = state.records.all.find(
            (r) => r.fields.Name && r.fields.Name.includes(searchTerm)
          );
          if (umwRecord) {
            closeDetailModal();
            setTimeout(() => {
              showDetailModal(umwRecord, 0);
            }, 100);
          } else {
            document.getElementById("name-filter").value = searchTerm;
            closeDetailModal();
            document.getElementById("name-filter").dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
      }
    }
    const plusBtn = modalQuantitySelector.querySelector(".plus");
    const minusBtn = modalQuantitySelector.querySelector(".minus");
    const input = modalQuantitySelector.querySelector("input");
    if (plusBtn && minusBtn && input) {
      const updateProTipVisibility = () => {
        const currentQty = parseInt(input.value, 10) || 1;
        const existingNudge2 = modalActionsContainer.querySelector(".umw-sales-nudge");
        const existingBadge2 = modalActionsContainer.querySelector(".umw-benefit-badge");
        const shouldShowProTip = effectiveMin >= airtableMin && airtableMin > 1 && currentQty <= airtableMin;
        const shouldShowBadge = effectiveMin < airtableMin && currentQty <= airtableMin;
        if (shouldShowProTip && !existingNudge2) {
          const nudgeHTML2 = `<div class="umw-sales-nudge">\u{1F4A1} <strong>Pro Tip:</strong> Host at <a href="#" class="search-link" data-term="Union Machine Works">Union Machine Works</a> to waive the ${airtableMin}-person minimum.</div>`;
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = nudgeHTML2;
          const nudgeElement = tempDiv.firstElementChild;
          modalActionsContainer.appendChild(nudgeElement);
          const searchLink = nudgeElement.querySelector(".search-link");
          if (searchLink) {
            searchLink.addEventListener("click", async (e) => {
              e.preventDefault();
              const searchTerm = searchLink.dataset.term;
              const umwRecord = state.records.all.find(
                (r) => r.fields.Name && r.fields.Name.includes(searchTerm)
              );
              if (umwRecord) {
                closeDetailModal();
                setTimeout(() => {
                  showDetailModal(umwRecord, 0);
                }, 100);
              } else {
                document.getElementById("name-filter").value = searchTerm;
                closeDetailModal();
                document.getElementById("name-filter").dispatchEvent(new Event("input", { bubbles: true }));
              }
            });
          }
        } else if (!shouldShowProTip && existingNudge2) {
          existingNudge2.remove();
        }
        if (shouldShowBadge && !existingBadge2) {
          const badgeHTML = `<div class="umw-benefit-badge">✅ UMW Benefit: ${airtableMin}-person minimum waived.</div>`;
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = badgeHTML;
          const badgeElement = tempDiv.firstElementChild;
          modalActionsContainer.appendChild(badgeElement);
        } else if (!shouldShowBadge && existingBadge2) {
          existingBadge2.remove();
        }
      };
      const handlePlus = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentValue = parseInt(input.value, 10) || 1;
        input.value = currentValue + 1;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        updateProTipVisibility();
      };
      const handleMinus = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentValue = parseInt(input.value, 10) || 1;
        const minValue = parseInt(input.min, 10) || 1;
        if (currentValue > minValue) {
          input.value = currentValue - 1;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          updateProTipVisibility();
        }
      };
      const handleTouchEnd = (e) => {
        e.preventDefault();
        const handler = e.currentTarget === plusBtn ? handlePlus : handleMinus;
        handler(e);
      };
      plusBtn.addEventListener("click", handlePlus);
      plusBtn.addEventListener("touchend", handleTouchEnd, { passive: false });
      minusBtn.addEventListener("click", handleMinus);
      minusBtn.addEventListener("touchend", handleTouchEnd, { passive: false });
    }
  } else {
    modalActionsContainer.style.display = "none";
    modalNotesContainer.style.display = "none";
    modalQuantitySelector.innerHTML = "";
  }
  modalCalendarContainer.innerHTML = "";
  const iCalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
  if (iCalUrl && !isEvent) {
    try {
      modalCalendarContainer.style.display = "block";
      log("Modal", `iCal URL found for ${record.id}, initializing calendar.`);
      if (!window.flatpickr) {
        log("Modal", "Loading Flatpickr dynamically...");
        await loadFlatpickr();
      }
      if (!window.flatpickr) {
        throw new Error("Flatpickr not available after loading");
      }
      if (typeof window.flatpickr !== "function") {
        throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
      }
      const busyTimes = await fetchCalendarForRecord(record);
      const calendarInstance = window.flatpickr(modalCalendarContainer, {
        inline: true,
        showMonths: 1,
        disable: [(date) => {
          const status = getDayStatus(date, busyTimes, record);
          return status.status === AVAILABILITY_STATUS.NONE;
        }],
        onDayCreate: function(dObj, dStr, fp, dayElem) {
          const day = dayElem.dateObj;
          const status = getDayStatus(day, busyTimes, record);
          let className = "";
          let tooltip = status.reason;
          if (status.status === AVAILABILITY_STATUS.FULL) {
            className = "available-full";
          } else if (status.status === AVAILABILITY_STATUS.PARTIAL) {
            className = "available-partial";
            tooltip = `${status.reason}
Available slots: ${getAvailableSlotsForDay(day, busyTimes) || "None"}`;
          } else {
            className = "unavailable";
          }
          dayElem.classList.add(className);
          dayElem.setAttribute("data-tippy-content", tooltip);
        },
        onReady: function() {
          if (window.tippy) {
            tippy(".flatpickr-day", {
              content: (reference) => reference.getAttribute("data-tippy-content"),
              placement: "top",
              theme: "light",
              allowHTML: true
            });
          }
        },
        onChange: (selectedDates) => {
          if (selectedDates.length > 0 && selectedDates[0]) {
            const eventDateInput = document.getElementById("event-date-picker");
            if (eventDateInput && eventDateInput._flatpickr) {
              try {
                eventDateInput._flatpickr.setDate(selectedDates[0], true);
              } catch (error) {
                log("Modal", `Error syncing event date picker: ${error.message}`);
              }
            }
          }
        }
      });
      const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
      if (eventDate) {
        try {
          const dateObj = new Date(eventDate);
          if (!isNaN(dateObj.getTime())) {
            calendarInstance.setDate(dateObj, true);
          } else {
            log("Modal", `Invalid event date: ${eventDate}`);
          }
        } catch (error) {
          log("Modal", `Error setting calendar date: ${error.message}`);
        }
      }
      log("Modal", "Calendar initialized successfully");
    } catch (error) {
      log("Modal", `Error initializing calendar: ${error.message}`);
      console.error("Calendar initialization error:", error);
      modalCalendarContainer.style.display = "none";
      modalCalendarContainer.innerHTML = '<p style="color: #dc3545; padding: 10px; text-align: center;">Unable to load calendar. Please try refreshing the page.</p>';
    }
  } else {
    modalCalendarContainer.style.display = "none";
    log("Modal", `No iCal URL for ${record.id}, hiding calendar.`);
  }
  updateCardIcon(record.id);
  modalOverlay.classList.add("active");
  modalOverlay.style.display = "flex";
  document.body.classList.add("modal-open");
  setTimeout(() => {
    const chatContainer = document.getElementById("modal-chat-container");
    const isChatEnabledOnItem = record.fields["Chat Enabled"] || false;
    const isEvent2 = record.fields["Item Type"] === "Event";
    const userRsvped = isEvent2 && (record.fields.RSVPs || []).includes(state.session.user.id);
    log("Modal Chat Init", {
      isAuthenticated: state.session.user.isAuthenticated,
      isChatEnabledOnItem,
      isEvent: isEvent2,
      userRsvped,
      chatContainerExists: !!chatContainer,
      user: state.session.user
    });
    if (state.session.user.isAuthenticated && chatContainer && (isChatEnabledOnItem || userRsvped)) {
      log("Modal", "All conditions met. Initializing item chat.");
      chatContainer.style.display = "flex";
      initializeItemChat(record.id);
    } else {
      log("Modal", "Hiding chat. Reason:", {
        isAuthenticated: state.session.user.isAuthenticated,
        chatEnabled: isChatEnabledOnItem || userRsvped,
        chatContainerExists: !!chatContainer
      });
      if (chatContainer) {
        chatContainer.style.display = "none";
      }
    }
  }, 0);
}
function hideDetailModal() {
  console.log("[hideDetailModal] Called.");
  const closeBtn3 = document.getElementById("modal-close-btn");
  if (closeBtn3) {
    closeBtn3.onclick = null;
  }
  modalOverlay.removeEventListener("click", handleOverlayClick);
  document.removeEventListener("keydown", handleEscapeKey);
  if (currentItemChatRecordId) {
    log("Chat", `Closing item chat for recordId: ${currentItemChatRecordId}`);
    currentItemChatRecordId = null;
  }
  if (modalOverlay) {
    modalOverlay.classList.remove("active");
    setTimeout(() => {
      modalOverlay.style.display = "none";
      resetModalState();
    }, 300);
    document.body.classList.remove("modal-open");
  }
}
async function showCheckoutModal(shopSettings) {
  currentShopSettings = shopSettings;
  log("Modal", "Showing checkout modal.");
  const checkoutModalOverlay = document.getElementById("checkout-modal-overlay");
  const fullTotalEl = document.getElementById("full-total-price");
  const checkoutCloseBtn = document.getElementById("checkout-close-btn");
  const summaryDetailsEl = document.getElementById("checkout-summary-details");
  const tipAmountInput = document.getElementById("tip-amount");
  const paymentChoiceContainer = document.getElementById("payment-choice-container");
  const termsContainer = document.querySelector(".terms-and-conditions");
  const processingFeeEl = document.getElementById("processing-fee-price");
  const finalChargeEl = document.getElementById("final-charge-price");
  const totalLabel = document.getElementById("checkout-total-label");
  if (totalLabel) {
    if (state.session.user.amountReceived > 0) {
      totalLabel.textContent = "Total Final Cost:";
    } else {
      totalLabel.textContent = "Total Estimated Cost:";
    }
  }
  if (!checkoutModalOverlay) return;
  const handleOverlayClick2 = (e) => {
    if (e.target === checkoutModalOverlay) {
      hideCheckoutModal();
    }
  };
  checkoutModalOverlay.addEventListener("click", handleOverlayClick2);
  checkoutModalOverlay.removeEventListenerOnClick = () => {
    checkoutModalOverlay.removeEventListener("click", handleOverlayClick2);
  };
  if (checkoutCloseBtn) checkoutCloseBtn.addEventListener("click", hideCheckoutModal);
  summaryDetailsEl.innerHTML = "";
  tipAmountInput.value = "";
  let finalTotal = 0;
  const summaryList = document.createElement("ul");
  let isUmwInPlan = false;
  for (const [id] of state.cart.lockedItems) {
    const lockedRecord = state.records.all.find((r) => r.id === id);
    if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
      isUmwInPlan = true;
      break;
    }
  }
  for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    const itemTotal = price * (itemInfo.quantity || 1);
    finalTotal += itemTotal;
    const listItem = document.createElement("li");
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const effectiveMin = getEffectiveMinQuantity(record);
    let edgeCaseNote = "";
    if (airtableMin > 1) {
      if (!isUmwInPlan && itemInfo.quantity === effectiveMin) {
        edgeCaseNote = '<small class="checkout-edge-case-note" style="color: #fd7e14; font-style: italic; display: block;">* At minimum headcount for off-site event</small>';
      } else if (isUmwInPlan && itemInfo.quantity < airtableMin) {
        edgeCaseNote = '<small class="checkout-edge-case-note" style="color: #28a745; font-style: italic; display: block;">✓ Below standard minimum (Union Machine Works venue)</small>';
      }
    }
    let noteHtml = "";
    if (itemInfo.note && itemInfo.note.trim() !== "") {
      noteHtml = `<small class="checkout-summary-note">Note: ${itemInfo.note}</small>`;
    }
    listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${itemInfo.quantity || 1})</span>
                ${edgeCaseNote}
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
    summaryList.appendChild(listItem);
  }
  summaryDetailsEl.appendChild(summaryList);
  fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
  fullTotalEl.dataset.total = finalTotal;
  const paymentHistory = state.session.user.paymentHistory || [];
  const amountReceived = state.session.user.amountReceived || 0;
  if (paymentHistory.length > 0) {
    const paymentsReceivedSection = document.createElement("div");
    paymentsReceivedSection.className = "checkout-payments-received";
    paymentsReceivedSection.style.cssText = "margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;";
    let paymentsHtml = '<h4 style="margin-top: 0; color: #28a745;">✅ Payments Received</h4>';
    paymentsHtml += '<div class="payment-receipts-list">';
    const sortedPayments = paymentHistory.map((payment, originalIndex) => ({ ...payment, originalIndex })).sort((a, b) => new Date(a.date) - new Date(b.date));
    sortedPayments.forEach((payment, displayIndex) => {
      const paymentDate = new Date(payment.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
      paymentsHtml += `
                <div class="payment-receipt-row" style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background-color: white; border-radius: 4px;">
                    <div>
                        <strong>Payment ${displayIndex + 1}</strong>
                        <small style="display: block; color: #6c757d;">${paymentDate}</small>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-weight: bold;">$${payment.amount.toFixed(2)}</span>
                        <button class="receipt-btn" data-payment-index="${payment.originalIndex}" style="padding: 5px 10px; font-size: 0.85em; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Receipt</button>
                    </div>
                </div>
            `;
    });
    paymentsHtml += "</div>";
    paymentsHtml += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #dee2e6; text-align: right;"><strong>Total Paid: $${amountReceived.toFixed(2)}</strong></div>`;
    paymentsReceivedSection.innerHTML = paymentsHtml;
    const totalDepositSection = document.querySelector(".checkout-total-deposit-section");
    if (totalDepositSection) {
      totalDepositSection.parentNode.insertBefore(paymentsReceivedSection, totalDepositSection);
    }
  }
  if (currentShopSettings.paymentOptions === "DepositOrFull" && state.session.user.amountReceived === 0) {
    paymentChoiceContainer.style.display = "block";
    document.querySelectorAll('input[name="paymentChoice"]').forEach((radio) => {
      radio.addEventListener("change", async () => await updateCheckoutDisplay());
    });
  } else {
    paymentChoiceContainer.style.display = "none";
  }
  if (termsContainer && currentShopSettings.terms) {
    termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\\n/g, "<br>")}</p>`;
  }
  try {
    if (!window.Stripe) {
      log("Modal", "Loading Stripe.js dynamically...");
      await loadStripe();
    }
    stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
  } catch (err) {
    console.error("Failed to initialize Stripe:", err);
    alert(`Could not initialize payment system: ${err.message}.`);
    return;
  }
  const paymentForm = document.getElementById("payment-form");
  if (paymentForm) paymentForm.style.display = "block";
  await updateCheckoutDisplay();
  tipAmountInput.addEventListener("input", debounce(async () => await updateCheckoutDisplay(), 500));
  try {
    checkoutModalOverlay.cardElement = null;
    checkoutModalOverlay.classList.add("active");
    setTimeout(() => {
      checkoutModalOverlay.style.display = "flex";
      if (checkoutCloseBtn) checkoutCloseBtn.focus();
    }, 0);
    document.body.classList.add("modal-open");
  } catch (err) {
    console.error("Failed to show checkout modal:", err);
    alert(`Could not display checkout: ${err.message}.`);
    hideCheckoutModal();
  }
}
function hideCheckoutModal() {
  var _a;
  const checkoutModalOverlay = document.getElementById("checkout-modal-overlay");
  if (checkoutModalOverlay) {
    if (checkoutModalOverlay.removeEventListenerOnClick) {
      checkoutModalOverlay.removeEventListenerOnClick();
    }
    (_a = document.getElementById("tip-amount")) == null ? void 0 : _a.removeEventListener("input", updateCheckoutDisplay);
    document.querySelectorAll('input[name="paymentChoice"]').forEach((radio) => {
      radio.removeEventListener("change", updateCheckoutDisplay);
    });
    if (paymentElement) {
      paymentElement.unmount();
      paymentElement = null;
    }
    elements = null;
    currentClientSecret = null;
    currentBaseAmount = 0;
    currentProcessingFee = 0;
    checkoutModalOverlay.classList.remove("active");
    setTimeout(() => {
      const checkoutCloseBtn = document.getElementById("checkout-close-btn");
      if (checkoutCloseBtn) {
        checkoutCloseBtn.removeEventListener("click", hideCheckoutModal);
      }
      checkoutModalOverlay.style.display = "none";
      log("Modal", "Checkout modal hidden.");
    }, 300);
    document.body.classList.remove("modal-open");
  }
}
function getStripeContext() {
  return { stripe, elements };
}

// components/sidebar.js
async function createFavoriteCardElement(record, itemInfo, imageCache2) {
  const fields = record.fields;
  const itemCard = document.createElement("div");
  itemCard.className = `favorite-item lazy-load`;
  itemCard.dataset.recordId = record.id;
  const { imageUrls } = await fetchImagesForRecord(record, state.records.all, imageCache2);
  const defaultPlaceholder = `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520,f_auto,q_auto/ww71meppejsewxsxr4x7.jpg`;
  const bgImageUrl = imageUrls[0] || defaultPlaceholder;
  itemCard.dataset.bgImage = bgImageUrl.includes("cloudinary") && !bgImageUrl.includes("/upload/c_fill") ? bgImageUrl.replace("/upload/", "/upload/c_fill,w_600,h_520,f_auto,q_auto/") : bgImageUrl;
  const priceParam = itemInfo.selections && Object.keys(itemInfo.selections).length > 0 ? itemInfo.selections : itemInfo.selectedOptionIndex;
  const price = getRecordPrice(record, priceParam);
  const tooltipContent = `
        <strong>${fields.Name || "Untitled"}</strong><br>
        <small>${fields.Description || "No description."}</small><br>
        <strong>Price: $${price.toFixed(2)}</strong>
    `;
  itemCard.innerHTML = `
        <div class="card-actions">
            <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
            <button class="action-btn remove-btn" title="Remove">\xD7</button>
        </div>
        <div class="favorite-item-overlay"
            data-tippy-content="${tooltipContent.replace(/"/g, "&quot;")}"
        >
            <span class="favorite-item-name">${fields.Name || "Untitled"}</span>
        </div>
    `;
  if (window.tippy) {
    tippy(itemCard.querySelector(".favorite-item-overlay"), {
      content: tooltipContent,
      allowHTML: true,
      placement: "top",
      theme: "light"
    });
  }
  return itemCard;
}
async function createLockedInItemElement(record, itemInfo) {
  const fields = record.fields;
  let isCustomItem = record.id.startsWith("custom-") || record.id.startsWith("ai-search-");
  let imageUrl = `https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_60,h_60/ww71meppejsewxsxr4x7.jpg`;
  if (!isCustomItem) {
    const { imageUrls } = await fetchImagesForRecord(record, state.records.all, /* @__PURE__ */ new Map());
    if (imageUrls && imageUrls.length > 0) {
      imageUrl = imageUrls[0].replace("/upload/", "/upload/c_fill,g_auto,w_60,h_60/");
    }
  }
  const itemElement = document.createElement("div");
  itemElement.className = "locked-item-card";
  itemElement.dataset.recordId = record.id;
  let optionNames = [];
  if (!isCustomItem) {
    const optionGroups = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    if (itemInfo.selections && Object.keys(itemInfo.selections).length > 0) {
      const sortedKeys = Object.keys(itemInfo.selections).sort((a, b) => {
        const indexA = parseInt(a.replace("group", ""), 10) || 0;
        const indexB = parseInt(b.replace("group", ""), 10) || 0;
        return indexA - indexB;
      });
      for (const groupKey of sortedKeys) {
        const optionIndex = itemInfo.selections[groupKey];
        const groupIndexMatch = groupKey.match(/^group(\d+)$/);
        if (!groupIndexMatch) continue;
        const groupIndex = parseInt(groupIndexMatch[1], 10);
        const group = optionGroups[groupIndex];
        if (!group || !group.options) continue;
        const option = group.options[optionIndex];
        if (option && option.name) {
          optionNames.push(option.name);
        }
      }
    } else if (itemInfo.selectedOptionIndex != null) {
      const flatOptions = flattenOptionGroups(optionGroups);
      if (flatOptions[itemInfo.selectedOptionIndex]) {
        optionNames.push(flatOptions[itemInfo.selectedOptionIndex].name);
      }
    }
  }
  const optionDisplay = optionNames.join(", ");
  const priceParam = itemInfo.selections && Object.keys(itemInfo.selections).length > 0 ? itemInfo.selections : itemInfo.selectedOptionIndex;
  let price = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
  const total = (price || 0) * (itemInfo.quantity || 1);
  let priceDisplay = `$${(price || 0).toFixed(2)}`;
  if (isCustomItem && itemInfo.overridePrice == null && price > 0) {
    priceDisplay = `$${price.toFixed(2)} (Est.)`;
  }
  if (itemInfo.overridePrice != null) {
    let originalPrice = getRecordPrice(record, priceParam);
    priceDisplay = `$${price.toFixed(2)} <em class="price-original">(was $${originalPrice.toFixed(2)})</em>`;
  }
  const effectiveMin = getEffectiveMinQuantity(record);
  const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
  let quantityDisplay = `Qty ${itemInfo.quantity || 1}`;
  let isUmwInPlan = false;
  for (const [id] of state.cart.lockedItems) {
    const lockedRecord = state.records.all.find((r) => r.id === id);
    if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
      isUmwInPlan = true;
      break;
    }
  }
  if (airtableMin > 1) {
    if (!isUmwInPlan && itemInfo.quantity === effectiveMin) {
      quantityDisplay += ` <span class="min-qty-warning" data-tippy-content="Minimum of ${effectiveMin} required for off-site events.<br><strong>Host at Union Machine Works to waive.</strong>">*</span>`;
    } else if (isUmwInPlan && itemInfo.quantity < airtableMin) {
      quantityDisplay += ` <span class="umw-benefit-indicator" data-tippy-content="Below standard minimum of ${airtableMin}<br><strong>Allowed due to Union Machine Works venue</strong>" style="color: #28a745; font-weight: bold; cursor: help; margin-left: 2px;">✓</span>`;
    }
  }
  itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrl}" width="60" height="60" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionDisplay ? `<p class="locked-item-option">${optionDisplay}</p>` : ""}
            <p class="locked-item-pricing">${quantityDisplay} @ ${priceDisplay} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ""}
        </div>
        <div class="locked-item-actions">
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;
  const warningSpan = itemElement.querySelector(".min-qty-warning");
  if (warningSpan && window.tippy) {
    tippy(warningSpan, {
      content: warningSpan.dataset.tippyContent,
      allowHTML: true,
      placement: "top",
      arrow: true
    });
  }
  const benefitSpan = itemElement.querySelector(".umw-benefit-indicator");
  if (benefitSpan && window.tippy) {
    tippy(benefitSpan, {
      content: benefitSpan.dataset.tippyContent,
      allowHTML: true,
      placement: "top",
      arrow: true
    });
  }
  return itemElement;
}
function calculateTotalPlanScore() {
  var _a;
  if (state.cart.lockedItems.size === 0) return 0;
  const sortBy = ((_a = document.getElementById("sort-by")) == null ? void 0 : _a.value) || "recommended";
  const goalBucket = buildGoalBucket(sortBy);
  let totalScore = 0;
  for (const recordId of state.cart.lockedItems.keys()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (record) {
      const score = calculateRecommendationScore(record, goalBucket);
      totalScore += score;
    }
  }
  return totalScore;
}
function updateTotalPlanScoreDisplay(score) {
  const container = document.getElementById("event-health-score");
  if (!container) return;
  let scoreEl = container.querySelector(".plan-score-display");
  if (score > 0) {
    if (!scoreEl) {
      scoreEl = document.createElement("h5");
      scoreEl.className = "plan-score-display";
      scoreEl.style.cssText = "margin: 5px 0 0 0; text-align: center; color: #007bff; font-size: 1.2em;";
      container.prepend(scoreEl);
    }
    scoreEl.innerHTML = `Overall Score: ${score.toFixed(0)} Points<span class='beta-tag-subtle'>Beta</span>`;
  } else if (scoreEl) {
    scoreEl.remove();
  }
}
var isUpdatingEventPlan = false;
var pendingEventPlanUpdate = false;
var shareMenuInitialized = false;
function initializeShareMenu() {
  if (shareMenuInitialized) return;
  const shareMenuBtn = document.getElementById("share-menu-btn");
  const shareMenuDropdown = document.getElementById("share-menu-dropdown");
  const shareCopyLinkBtn = document.getElementById("share-copy-link-btn");
  const shareInviteBtn = document.getElementById("share-invite-btn");
  const sharePublishBtn = document.getElementById("share-publish-btn");
  const shareUpdatePublishedBtn = document.getElementById("share-update-published-btn");
  if (!shareMenuBtn || !shareMenuDropdown) {
    console.warn("[Share Menu] Share menu elements not found");
    return;
  }
  shareMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isVisible = shareMenuDropdown.style.display === "block";
    shareMenuDropdown.style.display = isVisible ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!shareMenuBtn.contains(e.target) && !shareMenuDropdown.contains(e.target)) {
      shareMenuDropdown.style.display = "none";
    }
  });
  if (shareCopyLinkBtn) {
    shareCopyLinkBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const originalHTML = shareCopyLinkBtn.innerHTML;
        shareCopyLinkBtn.innerHTML = '<span class="share-item-icon">&#10003;</span> Copied!';
        setTimeout(() => {
          shareCopyLinkBtn.innerHTML = originalHTML;
        }, 1500);
      }).catch((err) => {
        console.error("Failed to copy link:", err);
      });
      shareMenuDropdown.style.display = "none";
    });
  }
  if (shareInviteBtn) {
    shareInviteBtn.addEventListener("click", () => {
      shareMenuDropdown.style.display = "none";
      openInvitePopup();
    });
  }
  const shareInviteGuestBtn = document.getElementById("share-invite-guest-btn");
  if (shareInviteGuestBtn) {
    shareInviteGuestBtn.addEventListener("click", () => {
      shareMenuDropdown.style.display = "none";
      openInviteGuestPopup();
    });
  }
  if (sharePublishBtn) {
    sharePublishBtn.addEventListener("click", async () => {
      shareMenuDropdown.style.display = "none";
      await handlePublishEvent();
    });
  }
  if (shareUpdatePublishedBtn) {
    shareUpdatePublishedBtn.addEventListener("click", async () => {
      shareMenuDropdown.style.display = "none";
      await handlePublishEvent();
    });
  }
  shareMenuInitialized = true;
  log("Sidebar", "Share menu initialized");
}
var invitePopupInitialized = false;
function openInvitePopup() {
  const popup = document.getElementById("invite-popup");
  if (!popup) return;
  initializeInvitePopup();
  popup.style.display = "block";
  const nameInput = document.getElementById("collab-name");
  const emailInput = document.getElementById("collab-email");
  const statusEl = document.getElementById("invite-status");
  const btn = document.getElementById("invite-btn");
  if (nameInput) nameInput.value = "";
  if (emailInput) emailInput.value = "";
  if (statusEl) statusEl.textContent = "";
  if (btn) {
    btn.textContent = "Send Invite";
    btn.disabled = false;
  }
  if (nameInput) nameInput.focus();
}
function closeInvitePopup() {
  const popup = document.getElementById("invite-popup");
  if (popup) {
    popup.style.display = "none";
  }
}
function initializeInvitePopup() {
  if (invitePopupInitialized) return;
  const popup = document.getElementById("invite-popup");
  const closeBtn3 = document.getElementById("invite-popup-close");
  const inviteBtn = document.getElementById("invite-btn");
  if (!popup) return;
  if (closeBtn3) {
    closeBtn3.addEventListener("click", closeInvitePopup);
  }
  document.addEventListener("click", (e) => {
    var _a;
    if (popup.style.display === "block" && !popup.contains(e.target) && !((_a = document.getElementById("share-invite-btn")) == null ? void 0 : _a.contains(e.target))) {
      closeInvitePopup();
    }
  });
  if (inviteBtn) {
    inviteBtn.addEventListener("click", async () => {
      await handleInvite();
    });
  }
  popup.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInvite();
    }
  });
  invitePopupInitialized = true;
  log("Sidebar", "Invite popup initialized");
}
var inviteGuestPopupInitialized = false;
function openInviteGuestPopup() {
  const popup = document.getElementById("invite-guest-popup");
  if (!popup) return;
  initializeInviteGuestPopup();
  popup.style.display = "block";
  const nameInput = document.getElementById("guest-name");
  const emailInput = document.getElementById("guest-email");
  const statusEl = document.getElementById("invite-guest-status");
  const btn = document.getElementById("invite-guest-btn");
  if (nameInput) nameInput.value = "";
  if (emailInput) emailInput.value = "";
  if (statusEl) statusEl.textContent = "";
  if (btn) {
    btn.textContent = "Send Invitation";
    btn.disabled = false;
  }
  if (nameInput) nameInput.focus();
}
function closeInviteGuestPopup() {
  const popup = document.getElementById("invite-guest-popup");
  if (popup) {
    popup.style.display = "none";
  }
}
function initializeInviteGuestPopup() {
  if (inviteGuestPopupInitialized) return;
  const popup = document.getElementById("invite-guest-popup");
  const closeBtn3 = document.getElementById("invite-guest-popup-close");
  const inviteBtn = document.getElementById("invite-guest-btn");
  if (!popup) return;
  if (closeBtn3) {
    closeBtn3.addEventListener("click", closeInviteGuestPopup);
  }
  document.addEventListener("click", (e) => {
    var _a;
    if (popup.style.display === "block" && !popup.contains(e.target) && !((_a = document.getElementById("share-invite-guest-btn")) == null ? void 0 : _a.contains(e.target))) {
      closeInviteGuestPopup();
    }
  });
  if (inviteBtn) {
    inviteBtn.addEventListener("click", async () => {
      await handleInviteGuest();
    });
  }
  popup.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInviteGuest();
    }
  });
  inviteGuestPopupInitialized = true;
  log("Sidebar", "Invite guest popup initialized");
}
async function handleInviteGuest() {
  var _a;
  const nameInput = document.getElementById("guest-name");
  const emailInput = document.getElementById("guest-email");
  const statusEl = document.getElementById("invite-guest-status");
  const btn = document.getElementById("invite-guest-btn");
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  if (!name || !email) {
    statusEl.textContent = "Please enter both name and email.";
    statusEl.style.color = "#dc3545";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Sending...";
  statusEl.textContent = "";
  try {
    let summaryHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #f8f9fa; text-align: left;">
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6;">Item</th>
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6; text-align: center;">Qty</th>
                    </tr>
                </thead>
                <tbody>
        `;
    state.cart.lockedItems.forEach((info, id) => {
      const record = state.records.all.find((r) => r.id === id);
      if (record) {
        summaryHtml += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${record.fields.Name}</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${info.quantity || 1}</td>
                    </tr>
                `;
      }
    });
    summaryHtml += "</tbody></table>";
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "Event";
    const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const hostName = ((_a = state.session.user) == null ? void 0 : _a.name) || "Your host";
    const response = await fetch("/api/invite-guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.session.id,
        guestName: name,
        guestEmail: email,
        hostName,
        eventName,
        eventDate,
        planSummaryHtml: summaryHtml
      })
    });
    if (response.ok) {
      statusEl.textContent = "Invitation sent!";
      statusEl.style.color = "#28a745";
      nameInput.value = "";
      emailInput.value = "";
      setTimeout(() => {
        closeInviteGuestPopup();
        statusEl.textContent = "";
        btn.textContent = "Send Invitation";
        btn.disabled = false;
      }, 1500);
    } else {
      const err = await response.json();
      throw new Error(err.error || "Failed to send");
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error sending invitation.";
    statusEl.style.color = "#dc3545";
    btn.textContent = "Send Invitation";
    btn.disabled = false;
  }
}
async function updateShareMenuState() {
  const shareMenuBtn = document.getElementById("share-menu-btn");
  const shareMenuDropdown = document.getElementById("share-menu-dropdown");
  const sharePublishBtn = document.getElementById("share-publish-btn");
  const shareUpdatePublishedBtn = document.getElementById("share-update-published-btn");
  const shareDivider = shareMenuDropdown == null ? void 0 : shareMenuDropdown.querySelector(".share-dropdown-divider");
  if (!shareMenuBtn) return;
  if (!state.session.id) {
    shareMenuBtn.style.display = "none";
    return;
  }
  shareMenuBtn.style.display = "flex";
  initializeShareMenu();
  const activeStore = state.stores.all.find((s) => s.id === state.ui.activeShopId);
  const currentUser2 = state.session.user;
  let hasPublishPermission = false;
  if (activeStore && currentUser2) {
    const allowedUsers = activeStore.fields.PublishPermission || [];
    hasPublishPermission = allowedUsers.includes(currentUser2.id);
  }
  if (!hasPublishPermission) {
    if (sharePublishBtn) sharePublishBtn.style.display = "none";
    if (shareUpdatePublishedBtn) shareUpdatePublishedBtn.style.display = "none";
    if (shareDivider) shareDivider.style.display = "none";
    return;
  }
  if (shareDivider) shareDivider.style.display = "block";
  try {
    const session = await fetchSessionById(state.session.id);
    if (!session) return;
    const linkedItemId = session.fields.LinkedItem ? session.fields.LinkedItem[0] : null;
    if (linkedItemId) {
      if (sharePublishBtn) sharePublishBtn.style.display = "none";
      if (shareUpdatePublishedBtn) {
        shareUpdatePublishedBtn.style.display = "flex";
        const linkedItem = state.records.all.find((r) => r.id === linkedItemId);
        if (linkedItem) {
          updateShareMenuRsvpStats(linkedItem);
        }
      }
    } else {
      if (sharePublishBtn) sharePublishBtn.style.display = "flex";
      if (shareUpdatePublishedBtn) shareUpdatePublishedBtn.style.display = "none";
      const existingRsvpStats = shareMenuDropdown == null ? void 0 : shareMenuDropdown.querySelector(".share-rsvp-stats");
      if (existingRsvpStats) existingRsvpStats.remove();
    }
    log("Sidebar", "Share menu state updated");
  } catch (error) {
    console.error("Error updating share menu state:", error);
  }
}
function updateShareMenuRsvpStats(linkedItem) {
  const shareMenuDropdown = document.getElementById("share-menu-dropdown");
  if (!shareMenuDropdown || !linkedItem) return;
  const rsvpYes = linkedItem.fields.RSVPs ? linkedItem.fields.RSVPs.length : 0;
  const rsvpMaybe = linkedItem.fields.RSVPMaybe ? linkedItem.fields.RSVPMaybe.length : 0;
  const rsvpNo = linkedItem.fields.RSVPNo ? linkedItem.fields.RSVPNo.length : 0;
  const existingRsvpStats = shareMenuDropdown.querySelector(".share-rsvp-stats");
  if (existingRsvpStats) existingRsvpStats.remove();
  const rsvpStatsHTML = `
        <div class="share-rsvp-stats">
            <h5>RSVP Statistics</h5>
            <div class="share-rsvp-row">
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count going">${rsvpYes}</span>
                    <span class="share-rsvp-label">Going</span>
                </div>
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count maybe">${rsvpMaybe}</span>
                    <span class="share-rsvp-label">Maybe</span>
                </div>
                <div class="share-rsvp-item">
                    <span class="share-rsvp-count no">${rsvpNo}</span>
                    <span class="share-rsvp-label">Can't Go</span>
                </div>
            </div>
        </div>
    `;
  shareMenuDropdown.insertAdjacentHTML("afterbegin", rsvpStatsHTML);
}
async function updateSessionPublishingControls() {
  const existingControls = document.getElementById("session-publishing-controls");
  if (existingControls) {
    existingControls.remove();
  }
  await updateShareMenuState();
}
async function handlePublishEvent() {
  if (!state.session.id) {
    alert("No active session to publish");
    return;
  }
  try {
    const rawDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    console.log("[PUBLISH DEBUG - Sidebar] Raw date from state:", rawDate);
    console.log("[PUBLISH DEBUG - Sidebar] Raw date type:", typeof rawDate);
    const eventData = {
      Name: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "Untitled Event",
      Date: rawDate,
      Goals: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS),
      GuestCount: state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT)
    };
    console.log("[PUBLISH DEBUG - Sidebar] Complete eventData object:", eventData);
    log("Sidebar", `Publishing session ${state.session.id} as event with data:`, eventData);
    const publishBtn = document.getElementById("publish-event-btn");
    const updateBtn = document.getElementById("update-published-event-btn");
    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.textContent = "Publishing...";
    }
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.textContent = "Updating...";
    }
    const result = await publishSessionAsEvent(state.session.id, eventData);
    log("Sidebar", "Event published/updated successfully:", result);
    alert("Event published successfully! It will now appear in the catalog.");
    await updateSessionPublishingControls();
  } catch (error) {
    console.error("Error publishing event:", error);
    alert(`Failed to publish event: ${error.message}`);
    const publishBtn = document.getElementById("publish-event-btn");
    const updateBtn = document.getElementById("update-published-event-btn");
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.textContent = "\u{1F310} Publish as Public Event";
    }
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "\u{1F504} Update Published Event";
    }
  }
}
async function updateEventPlanSection() {
  console.log("[PUBLISH DEBUG] ========== updateEventPlanSection CALLED ==========");
  console.log("[PUBLISH DEBUG] state.session.id at entry:", state.session.id);
  console.log("[PUBLISH DEBUG] state.cart.lockedItems.size:", state.cart.lockedItems.size);
  if (isUpdatingEventPlan) {
    pendingEventPlanUpdate = true;
    log("Sidebar", "Event plan update already in progress, will retry after completion.");
    console.log("[PUBLISH DEBUG] Already updating, will retry later");
    return;
  }
  isUpdatingEventPlan = true;
  pendingEventPlanUpdate = false;
  try {
    log("Sidebar", "Updating event plan panel.");
    const container = document.getElementById("cart-items-container");
    if (!container) {
      console.log("[PUBLISH DEBUG] ERROR: cart-items-container not found!");
      return;
    }
    container.innerHTML = "";
    console.log("[PUBLISH DEBUG] About to call updateSessionPublishingControls");
    await updateSessionPublishingControls();
    console.log("[PUBLISH DEBUG] updateSessionPublishingControls completed");
    if (state.cart.lockedItems.size === 0) {
      container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
    } else {
      const fragment = document.createDocumentFragment();
      for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        let record = state.records.all.find((r) => r.id === recordId);
        if (!record) {
          record = state.records.archive.find((r) => r.id === recordId);
        }
        if (record) {
          const itemElement = await createLockedInItemElement(record, itemInfo);
          fragment.appendChild(itemElement);
        } else {
          log("Sidebar", `Could not render item ${recordId}, not found in state.records.all or archive.`);
        }
      }
      container.appendChild(fragment);
    }
    observeLazyImages(container);
    updateEventHealthScore();
    updateTotalPlanScoreDisplay(calculateTotalPlanScore());
  } finally {
    isUpdatingEventPlan = false;
    if (pendingEventPlanUpdate) {
      log("Sidebar", "Running pending event plan update.");
      updateEventPlanSection();
    }
  }
}
async function handleInvite() {
  const nameInput = document.getElementById("collab-name");
  const emailInput = document.getElementById("collab-email");
  const statusEl = document.getElementById("invite-status");
  const btn = document.getElementById("invite-btn");
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  if (!name || !email) {
    statusEl.textContent = "Please enter both name and email.";
    statusEl.style.color = "#dc3545";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Sending...";
  statusEl.textContent = "";
  try {
    let summaryHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #f8f9fa; text-align: left;">
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6;">Item</th>
                        <th style="padding: 8px; border-bottom: 2px solid #dee2e6; text-align: center;">Qty</th>
                    </tr>
                </thead>
                <tbody>
        `;
    state.cart.lockedItems.forEach((info, id) => {
      const record = state.records.all.find((r) => r.id === id);
      if (record) {
        summaryHtml += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${record.fields.Name}</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${info.quantity || 1}</td>
                    </tr>
                `;
      }
    });
    summaryHtml += "</tbody></table>";
    const inviterName = state.session.user.name || "A friend";
    const response = await fetch("/api/invite-collaborator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: state.session.id,
        collaboratorName: name,
        collaboratorEmail: email,
        inviterName,
        planSummaryHtml: summaryHtml
      })
    });
    if (response.ok) {
      statusEl.textContent = "Invitation sent!";
      statusEl.style.color = "#28a745";
      nameInput.value = "";
      emailInput.value = "";
      setTimeout(() => {
        closeInvitePopup();
        statusEl.textContent = "";
        btn.textContent = "Send Invite";
        btn.disabled = false;
      }, 1500);
    } else {
      const err = await response.json();
      throw new Error(err.error || "Failed to send");
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error sending invite.";
    statusEl.style.color = "#dc3545";
    btn.textContent = "Send Invite";
    btn.disabled = false;
  }
}
function verifyNoDuplicateItems() {
  const container = document.getElementById("cart-items-container");
  if (!container) return;
  const itemElements = container.querySelectorAll(".locked-item-card[data-record-id]");
  const seenIds = /* @__PURE__ */ new Set();
  const duplicates = [];
  itemElements.forEach((element) => {
    const recordId = element.dataset.recordId;
    if (seenIds.has(recordId)) {
      duplicates.push(recordId);
      log("Sidebar", `WARNING: Duplicate item found in event plan panel: ${recordId}`);
      element.remove();
    } else {
      seenIds.add(recordId);
    }
  });
  if (duplicates.length > 0) {
    log("Sidebar", `Removed ${duplicates.length} duplicate items from event plan panel`);
    return duplicates;
  } else {
    log("Sidebar", "Event plan panel verification: No duplicates found");
    return [];
  }
}
async function updateIdeasCarousel() {
  log("Sidebar", `Updating ideas carousel with ${state.cart.items.size} items.`);
  const ideasSection = document.getElementById("favorites-section");
  const ideasCarousel = document.getElementById("favorites-carousel");
  if (!ideasSection || !ideasCarousel) return;
  if (state.cart.items.size === 0) {
    ideasSection.style.display = "none";
    return;
  }
  ideasSection.style.display = "block";
  ideasCarousel.innerHTML = "";
  const imageCache2 = /* @__PURE__ */ new Map();
  for (const [recordId, itemInfo] of state.cart.items.entries()) {
    const record = state.records.all.find((r) => r.id === recordId);
    if (record) {
      try {
        const card = await createFavoriteCardElement(record, itemInfo, imageCache2);
        if (card) ideasCarousel.appendChild(card);
      } catch (error) {
        console.error(`Failed to create idea card for ${record.fields.Name}:`, error);
      }
    }
  }
  if (typeof ui_exports !== "undefined" && observeLazyImages) {
    observeLazyImages(ideasCarousel);
  } else {
    console.warn("ui.observeLazyImages not found during carousel update.");
  }
}
function updateHeader2() {
  var _a;
  console.log("[DEBUG updateHeader] ========== HEADER UPDATE DEBUG ==========");
  console.log("[DEBUG updateHeader] state.eventDetails.combined contents:", Object.fromEntries(state.eventDetails.combined));
  console.log("[DEBUG updateHeader] CONSTANTS.DETAIL_TYPES.EVENT_NAME:", CONSTANTS.DETAIL_TYPES.EVENT_NAME);
  console.log("[DEBUG updateHeader] CONSTANTS.DETAIL_TYPES.GOALS:", CONSTANTS.DETAIL_TYPES.GOALS);
  const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "";
  console.log("[DEBUG updateHeader] Retrieved eventName:", eventName);
  const activeShop = state.stores.all.find((s) => s.id === state.ui.activeShopId);
  const shopName = ((_a = activeShop == null ? void 0 : activeShop.fields) == null ? void 0 : _a.Name) || "";
  document.title = eventName || (shopName ? `WTFun ${shopName}` : "WTFun");
  const eventNameInput = document.getElementById("header-event-name");
  if (eventNameInput) {
    console.log("[DEBUG updateHeader] Setting header-event-name input to:", eventName);
    eventNameInput.value = eventName;
  } else {
    console.log("[DEBUG updateHeader] WARNING: header-event-name input NOT found!");
  }
  const goalsInput = document.getElementById("header-goals");
  const goalsValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || "";
  console.log("[DEBUG updateHeader] Retrieved goals:", goalsValue);
  if (goalsInput) {
    console.log("[DEBUG updateHeader] Setting header-goals input to:", goalsValue);
    goalsInput.value = goalsValue;
  } else {
    console.log("[DEBUG updateHeader] WARNING: header-goals input NOT found!");
  }
  console.log("[DEBUG updateHeader] ========== END HEADER UPDATE DEBUG ==========");
}
function updateEventHealthScore() {
  const container = document.getElementById("event-health-score");
  if (!container) return;
  const suggestions = calculateMissingCategories();
  const score = 4 - suggestions.length;
  let html = "";
  let scoreText = "\u{1F7E0} Good Start!";
  let scoreColor = "#fd7e14";
  if (score === 4) {
    scoreText = "✅ Well-Rounded Event!";
    scoreColor = "#28a745";
  } else if (score === 1) {
    scoreText = "\u{1F534} Just Beginning!";
    scoreColor = "#dc3545";
  } else if (score === 0) {
    scoreText = "Start Your Plan!";
    scoreColor = "#6c757d";
  } else if (score === 2) {
    scoreText = "\u{1F7E1} Growing!";
    scoreColor = "#ffc107";
  }
  html += `<h5 style="margin: 0 0 5px 0; text-align: center; color: ${scoreColor};">Plan Health: ${scoreText} <span class='beta-tag-subtle'>Beta</span></h5>`;
  if (suggestions.length > 0) {
    html += `<p style="font-size: 0.9em; margin: 0; text-align: center;">
            Our experts recommend adding these components for a full experience:
        </p>`;
    html += `<div style="display: flex; gap: 5px; margin-top: 10px; justify-content: center; flex-wrap: wrap;">`;
    suggestions.forEach((cat) => {
      const displayName = cat;
      let filterTag = displayName.toLowerCase().replace(/\s+/g, " ");
      html += `<button class="filter-btn health-suggestion-btn" data-category-filter="${filterTag}">
                + Add ${displayName}
            </button>`;
    });
    html += `</div>`;
  } else {
    html += `<p style="font-size: 0.9em; margin: 0; text-align: center; color: #28a745;">
            You've covered all the core components for a great guest experience!
        </p>`;
  }
  container.innerHTML = html;
}
function updateTotalCost() {
  const subtotalCostEl = document.getElementById("subtotal-cost");
  const amountPaidCostEl = document.getElementById("amount-paid-cost");
  const amountPaidRowEl = document.querySelector(".amount-paid-row");
  const totalDividerEl = document.querySelector(".total-divider");
  const totalCostEl = document.getElementById("total-cost");
  const checkoutBtn = document.getElementById("checkout-btn");
  const saveShareBtn2 = document.getElementById("save-share-btn");
  const mobileItemCountEl = document.getElementById("mobile-bar-item-count");
  const mobileTotalCostEl = document.getElementById("mobile-bar-total-cost");
  const statusMessageEl = document.getElementById("payment-status-message");
  if (statusMessageEl) statusMessageEl.innerHTML = "";
  if (!totalCostEl || !subtotalCostEl) return;
  let subtotal = 0;
  state.cart.lockedItems.forEach((itemInfo, recordId) => {
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) return;
    const priceParam = itemInfo.selections && Object.keys(itemInfo.selections).length > 0 ? itemInfo.selections : itemInfo.selectedOptionIndex;
    const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
    if (isNaN(unitPrice)) return;
    const minHeadcount = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
    subtotal += unitPrice * effectiveQuantity;
  });
  const amountReceived = state.session.user.amountReceived || 0;
  const totalDue = subtotal - amountReceived;
  subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
  totalCostEl.textContent = `$${totalDue.toFixed(2)}`;
  if (typeof void 0 === "function") {
    (void 0)();
  }
  if (amountReceived > 0) {
    const paymentHistory = state.session.user.paymentHistory || [];
    if (paymentHistory.length === 1) {
      amountPaidCostEl.innerHTML = `<a href="#" class="receipt-link" data-payment-index="0" title="View Receipt">-$${amountReceived.toFixed(2)}</a>`;
    } else if (paymentHistory.length > 1) {
      const sortedPayments = paymentHistory.map((payment, originalIndex) => ({ ...payment, originalIndex })).sort((a, b) => new Date(a.date) - new Date(b.date));
      let paymentsHtml = '<div class="multiple-payments">';
      sortedPayments.forEach((payment, displayIndex) => {
        paymentsHtml += `<div class="payment-item">
                    <a href="#" class="receipt-link" data-payment-index="${payment.originalIndex}" title="View Receipt #${displayIndex + 1}">
                        Payment ${displayIndex + 1}: -$${payment.amount.toFixed(2)}
                    </a>
                </div>`;
      });
      paymentsHtml += "</div>";
      amountPaidCostEl.innerHTML = paymentsHtml;
    } else {
      amountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
    }
    amountPaidRowEl.style.display = "flex";
    totalDividerEl.style.display = "block";
  } else {
    amountPaidRowEl.style.display = "none";
    totalDividerEl.style.display = "none";
  }
  if (mobileItemCountEl && mobileTotalCostEl) {
    const itemCount = state.cart.lockedItems.size;
    mobileItemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""}`;
    mobileTotalCostEl.textContent = `$${totalDue.toFixed(2)}`;
  }
  const isPlanEmpty = state.cart.lockedItems.size === 0 && subtotal === 0;
  const isFullyPaid = totalDue <= 9e-3 && amountReceived > 0;
  document.body.classList.add("mobile-bar-active");
  if (checkoutBtn) {
    checkoutBtn.style.display = "block";
    document.getElementById("total-breakdown").style.display = "block";
    if (isFullyPaid) {
      checkoutBtn.textContent = "View Receipt";
      checkoutBtn.disabled = false;
      if (statusMessageEl) {
        statusMessageEl.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.2em; text-align: center; display: block; margin-bottom: 10px;">✅ Paid in Full</span>';
      }
    } else if (amountReceived > 0) {
      checkoutBtn.textContent = "Pay Remainder";
      checkoutBtn.disabled = isPlanEmpty;
    } else {
      checkoutBtn.textContent = checkoutBtn.dataset.defaultText || "Reserve";
      checkoutBtn.disabled = isPlanEmpty;
    }
  }
  if (saveShareBtn2) {
    saveShareBtn2.disabled = isPlanEmpty && state.ui.saveState !== "SAVING";
  }
  updateEventHealthScore();
  updateTotalPlanScoreDisplay(calculateTotalPlanScore());
}
function displayReservedStatus() {
  const checkoutBtn = document.getElementById("checkout-btn");
  const saveShareBtn2 = document.getElementById("save-share-btn");
  const statusMessageEl = document.getElementById("payment-status-message");
  if (statusMessageEl) {
    statusMessageEl.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.2em; text-align: center; display: block; margin-bottom: 10px;">✅ Event Reserved</span>';
  }
  if (checkoutBtn) {
    checkoutBtn.style.display = "block";
    checkoutBtn.textContent = "View Receipt";
    checkoutBtn.disabled = false;
  }
  if (saveShareBtn2) {
    saveShareBtn2.disabled = false;
  }
}

// components/footer.js
function getStoreDetails(activeShop) {
  if (!activeShop || !activeShop.fields) return null;
  const detailsJson = activeShop.fields["Store Details json"];
  if (!detailsJson) {
    log("Footer", "No Store Details json field found for this store");
    return null;
  }
  try {
    return JSON.parse(detailsJson);
  } catch (e) {
    console.warn("[Footer] Could not parse Store Details json:", e);
    return null;
  }
}
function generateFooterHTML(storeDetails) {
  var _a, _b, _c, _d;
  if (!storeDetails || !storeDetails.businessInfo) {
    return '<a href="/crm-login.html">Admin Dashboard</a>';
  }
  const info = storeDetails.businessInfo;
  const footerItems = [];
  if ((_a = info.site) == null ? void 0 : _a.copyright) {
    footerItems.push(`<span class="footer-copyright">${info.site.copyright}</span>`);
  }
  if ((_b = info.contact) == null ? void 0 : _b.supportEmail) {
    footerItems.push(`<a href="mailto:${info.contact.supportEmail}" class="footer-contact">Contact</a>`);
  } else if ((_c = info.contact) == null ? void 0 : _c.accountingEmail) {
    footerItems.push(`<a href="mailto:${info.contact.accountingEmail}" class="footer-contact">Contact</a>`);
  }
  if ((_d = info.contact) == null ? void 0 : _d.phone) {
    footerItems.push(`<a href="tel:${info.contact.phone.replace(/[^\d+]/g, "")}" class="footer-phone">${info.contact.phone}</a>`);
  }
  if (info.socialMedia) {
    if (info.socialMedia.instagram) {
      footerItems.push(`<a href="${info.socialMedia.instagram}" target="_blank" rel="noopener noreferrer" class="footer-social" title="Instagram">Instagram</a>`);
    }
    if (info.socialMedia.facebook) {
      footerItems.push(`<a href="${info.socialMedia.facebook}" target="_blank" rel="noopener noreferrer" class="footer-social" title="Facebook">Facebook</a>`);
    }
    if (info.socialMedia.twitter) {
      footerItems.push(`<a href="${info.socialMedia.twitter}" target="_blank" rel="noopener noreferrer" class="footer-social" title="Twitter">Twitter</a>`);
    }
    if (info.socialMedia.youtube) {
      footerItems.push(`<a href="${info.socialMedia.youtube}" target="_blank" rel="noopener noreferrer" class="footer-social" title="YouTube">YouTube</a>`);
    }
    if (info.socialMedia.tiktok) {
      footerItems.push(`<a href="${info.socialMedia.tiktok}" target="_blank" rel="noopener noreferrer" class="footer-social" title="TikTok">TikTok</a>`);
    }
  }
  const policies = info.policies || {};
  if (policies.refund || info.refundPolicy) {
    const refundUrl = policies.refund || info.refundPolicy;
    footerItems.push(`<a href="${refundUrl}" target="_blank" rel="noopener noreferrer" class="footer-policy">Refund Policy</a>`);
  }
  if (policies.privacy || info.privacyPolicy) {
    const privacyUrl = policies.privacy || info.privacyPolicy;
    footerItems.push(`<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer" class="footer-policy">Privacy Policy</a>`);
  }
  if (policies.terms || info.termsOfService) {
    const termsUrl = policies.terms || info.termsOfService;
    footerItems.push(`<a href="${termsUrl}" target="_blank" rel="noopener noreferrer" class="footer-policy">Terms of Service</a>`);
  }
  if (info.websiteUrl) {
    footerItems.push(`<a href="${info.websiteUrl}" target="_blank" rel="noopener noreferrer" class="footer-website">Website</a>`);
  }
  footerItems.push('<a href="/crm-login.html" class="footer-admin">Admin</a>');
  return footerItems.join('<span class="footer-separator">|</span>');
}
function updateFooter(activeShop = null) {
  var _a;
  const footerElement = document.querySelector(".footer-link");
  if (!footerElement) {
    log("Footer", "Footer element not found");
    return;
  }
  const shop = activeShop || state.stores.all.find((s) => s.id === state.ui.activeShopId);
  if (!shop) {
    log("Footer", "No active shop found");
    return;
  }
  const storeDetails = getStoreDetails(shop);
  const footerHTML = generateFooterHTML(storeDetails);
  footerElement.innerHTML = footerHTML;
  log("Footer", `Footer updated for store: ${((_a = shop.fields) == null ? void 0 : _a.Name) || "Unknown"}`);
}
function initializeFooter() {
  log("Footer", "Footer component initialized");
}

// ui.js
var lazyLoadObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const element = entry.target;
      if (element.dataset.bgImage) {
        let imageUrl = element.dataset.bgImage;
        const width = element.offsetWidth || 400;
        const height = element.offsetHeight || 300;
        const dpr = window.devicePixelRatio || 1;
        const optimalWidth = Math.min(Math.ceil(width * dpr), 1200);
        const optimalHeight = Math.min(Math.ceil(height * dpr), 900);
        if (shouldUseNetlifyImageCDN(imageUrl)) {
          imageUrl = optimizeImageUrl(imageUrl, {
            width: optimalWidth,
            height: optimalHeight,
            fit: "cover",
            format: "webp",
            quality: 80
          });
        } else if (imageUrl.includes("cloudinary.com")) {
          imageUrl = imageUrl.replace("/upload/", `/upload/f_auto,q_auto,w_${optimalWidth}/`);
        }
        const img = new Image();
        img.onload = () => {
          element.style.backgroundImage = `url('${imageUrl}')`;
          element.classList.add("loaded");
          element.classList.remove("lazy-load");
        };
        img.onerror = () => {
          element.style.backgroundImage = `url('${element.dataset.bgImage}')`;
          element.classList.add("loaded");
          element.classList.remove("lazy-load");
        };
        img.src = imageUrl;
      }
      if (element.dataset.src) {
        let imageUrl = element.dataset.src;
        const width = element.offsetWidth || 400;
        const height = element.offsetHeight || 300;
        const dpr = window.devicePixelRatio || 1;
        const optimalWidth = Math.min(Math.ceil(width * dpr), 1200);
        const optimalHeight = Math.min(Math.ceil(height * dpr), 900);
        if (shouldUseNetlifyImageCDN(imageUrl)) {
          imageUrl = optimizeImageUrl(imageUrl, {
            width: optimalWidth,
            height: optimalHeight,
            fit: "cover",
            format: "webp",
            quality: 80
          });
        } else if (imageUrl.includes("cloudinary.com")) {
          imageUrl = imageUrl.replace("/upload/", `/upload/f_auto,q_auto,w_${optimalWidth}/`);
        }
        const img = new Image();
        img.onload = () => {
          element.src = imageUrl;
          element.classList.add("loaded");
          element.classList.remove("lazy-load");
        };
        img.onerror = () => {
          element.src = element.dataset.src;
          element.classList.add("loaded");
          element.classList.remove("lazy-load");
        };
        img.src = imageUrl;
      }
      observer.unobserve(element);
    }
  });
}, { rootMargin: "0px 0px 300px 0px" });
var promptTimeout;
function observeLazyImages(container) {
  const lazyElements = container.querySelectorAll(".lazy-load");
  lazyElements.forEach((el) => lazyLoadObserver.observe(el));
  const partnerBadges = container.querySelectorAll(".partner-badge");
  if (partnerBadges.length > 0) {
    if (typeof window.loadTooltipLibraries === "function") {
      window.loadTooltipLibraries().then(() => {
        if (typeof tippy === "function") {
          tippy(partnerBadges, {
            content: "This is a partner activity. We handle all booking and logistics to ensure it's a seamless part of your event.",
            placement: "top",
            theme: "light"
          });
        }
      });
    } else if (typeof tippy === "function") {
      tippy(partnerBadges, {
        content: "This is a partner activity. We handle all booking and logistics to ensure it's a seamless part of your event.",
        placement: "top",
        theme: "light"
      });
    }
  }
}
function toggleLoading(show) {
  log("UI", `Toggling loading screen: ${show ? "ON" : "OFF"}`);
  const loadingMessage = document.getElementById("loading-message");
  const mainContent = document.querySelector(".main-content");
  if (loadingMessage) loadingMessage.style.display = show ? "block" : "none";
  if (mainContent) mainContent.style.display = show ? "none" : "grid";
}
function createSkeletonCard() {
  const skeleton = document.createElement("div");
  skeleton.className = "skeleton-card";
  skeleton.innerHTML = `
        <div class="skeleton-image"></div>
        <div class="skeleton-content">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton-footer">
            <div class="skeleton skeleton-price"></div>
            <div class="skeleton skeleton-button"></div>
        </div>
    `;
  return skeleton;
}
function getChildItemsForGrouping(groupingRecord, allRecords) {
  const groupingNameForFilter = groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, " ");
  const results = allRecords.filter((r) => {
    if (r.fields["Item Type"] !== "Bookable Item" && r.fields["Item Type"] !== "Event") return false;
    const itemCategories = (r.fields.Categories || "").split(",").map((cat) => cat.trim().toLowerCase().replace(/\s+/g, " "));
    return itemCategories.includes(groupingNameForFilter);
  });
  return results;
}
async function createGroupingCarouselSection(groupingRecord, childItems, allRecords, imageCache2) {
  console.log("[TileSizing][Carousel] Creating carousel section:", {
    groupingId: groupingRecord.id,
    groupingName: groupingRecord.fields.Name,
    childItemCount: childItems.length,
    viewport: getViewportInfo()
  });
  logCarouselCreation(groupingRecord.fields.Name, childItems.length);
  const section = document.createElement("div");
  section.className = "grouping-carousel-section";
  section.dataset.groupingId = groupingRecord.id;
  section.dataset.categoryName = groupingRecord.fields.Name;
  const fields = groupingRecord.fields;
  const groupingName = fields.Name || "Untitled Collection";
  const description = fields.Description || "";
  const header = document.createElement("div");
  header.className = "grouping-carousel-header";
  header.innerHTML = `
        <h3 class="grouping-carousel-title">${groupingName}</h3>
        <span class="grouping-carousel-count">${childItems.length} items</span>
    `;
  header.addEventListener("click", () => {
    const params = new URLSearchParams(window.location.search);
    params.set("subcategory", groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, " "));
    params.delete("view");
    window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
    if (window.applyFiltersAndSort) {
      window.applyFiltersAndSort(imageCache2);
    }
  });
  section.appendChild(header);
  if (description) {
    const descEl = document.createElement("p");
    descEl.className = "grouping-carousel-description";
    descEl.textContent = description;
    section.appendChild(descEl);
  }
  const wrapper = document.createElement("div");
  wrapper.className = "grouping-carousel-wrapper";
  const container = document.createElement("div");
  container.className = "grouping-carousel-container";
  const itemsToShow = childItems.slice(0, 10);
  const cardPromises = itemsToShow.map((record) => createInteractiveCard(record, allRecords, imageCache2));
  const cards = await Promise.all(cardPromises);
  cards.forEach((card) => {
    if (card) {
      container.appendChild(card);
    }
  });
  console.log("[TileSizing][Carousel] Cards created for carousel:", {
    groupingName: groupingRecord.fields.Name,
    cardCount: cards.filter((c) => c).length,
    containerWidth: container.offsetWidth,
    expectedCardWidth: getViewportInfo().breakpoint === "mobile" ? "calc(100vw - 70px)" : getViewportInfo().breakpoint === "tablet" ? "280px" : "320px"
  });
  wrapper.appendChild(container);
  const getScrollDistance = () => {
    const card = container.querySelector(".event-card");
    if (card) {
      return card.offsetWidth + 20;
    }
    return container.clientWidth;
  };
  const leftNav = document.createElement("button");
  leftNav.className = "grouping-carousel-nav left";
  leftNav.innerHTML = "◄";
  leftNav.setAttribute("aria-label", "Scroll left");
  leftNav.addEventListener("click", (e) => {
    e.stopPropagation();
    container.scrollBy({ left: -getScrollDistance(), behavior: "smooth" });
  });
  const rightNav = document.createElement("button");
  rightNav.className = "grouping-carousel-nav right";
  rightNav.innerHTML = "►";
  rightNav.setAttribute("aria-label", "Scroll right");
  rightNav.addEventListener("click", (e) => {
    e.stopPropagation();
    container.scrollBy({ left: getScrollDistance(), behavior: "smooth" });
  });
  wrapper.appendChild(leftNav);
  wrapper.appendChild(rightNav);
  const updateNavVisibility = () => {
    const hasOverflow = container.scrollWidth > container.clientWidth;
    if (hasOverflow) {
      wrapper.classList.add("has-overflow");
      leftNav.style.opacity = container.scrollLeft <= 0 ? "0.3" : "";
      leftNav.style.pointerEvents = container.scrollLeft <= 0 ? "none" : "";
      const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;
      rightNav.style.opacity = atEnd ? "0.3" : "";
      rightNav.style.pointerEvents = atEnd ? "none" : "";
    } else {
      wrapper.classList.remove("has-overflow");
    }
  };
  container.addEventListener("scroll", updateNavVisibility);
  setTimeout(updateNavVisibility, 100);
  setTimeout(updateNavVisibility, 500);
  section.appendChild(wrapper);
  if (childItems.length > 10) {
    const viewAll = document.createElement("a");
    viewAll.className = "grouping-carousel-view-all";
    viewAll.textContent = `View all ${childItems.length} items →`;
    viewAll.addEventListener("click", (e) => {
      e.preventDefault();
      const params = new URLSearchParams(window.location.search);
      params.set("subcategory", groupingRecord.fields.Name.toLowerCase().replace(/\s+/g, " "));
      params.delete("view");
      window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
      if (window.applyFiltersAndSort) {
        window.applyFiltersAndSort(imageCache2);
      }
    });
    section.appendChild(viewAll);
  }
  return section;
}
async function renderRecords(recordsToRender, imageCache2, append = false) {
  log("UI", `renderRecords called. Attempting to render ${recordsToRender.length} records.`);
  const renderStartTime = performance.now();
  logRenderStart(recordsToRender.length, { append });
  console.log("[TileSizing][RenderRecords] === RENDER START ===");
  console.log("[TileSizing][RenderRecords] Records to render:", recordsToRender.length);
  console.log("[TileSizing][RenderRecords] Append mode:", append);
  console.log("[TileSizing][RenderRecords] Viewport:", getViewportInfo());
  const recordTypes = {
    groupings: recordsToRender.filter((r) => r.fields["Item Type"] === "Grouping").length,
    events: recordsToRender.filter((r) => r.fields["Item Type"] === "Event").length,
    bookableItems: recordsToRender.filter((r) => r.fields["Item Type"] === "Bookable Item").length,
    other: recordsToRender.filter((r) => !["Grouping", "Event", "Bookable Item"].includes(r.fields["Item Type"])).length
  };
  console.log("[TileSizing][RenderRecords] Record types breakdown:", recordTypes);
  const catalogContainer = document.getElementById("catalog-container");
  const loadingMessage = document.getElementById("loading-message");
  if (!catalogContainer) {
    console.error("UI ERROR: catalog-container element not found in the DOM!");
    console.error("[TileSizing][RenderRecords] CRITICAL: catalog-container not found!");
    return;
  }
  console.log("[TileSizing][RenderRecords] Catalog container found:", {
    id: catalogContainer.id,
    className: catalogContainer.className,
    childCount: catalogContainer.children.length,
    sizing: getElementSizing(catalogContainer)
  });
  if (!append) {
    catalogContainer.innerHTML = "";
    const skeletonCount = Math.min(recordsToRender.length, 6);
    for (let i = 0; i < skeletonCount; i++) {
      catalogContainer.appendChild(createSkeletonCard());
    }
    if (loadingMessage) {
      loadingMessage.style.display = "none";
    }
  }
  if (recordsToRender.length === 0 && !append) {
    log("UI", "No records to render, displaying empty state message.");
    const hasActiveFilters = state.ui.selectedCategory !== "all" || state.ui.activeSubcategories.size > 0 || state.ui.nameFilter || state.ui.selectedDateRange.start;
    let emptyMessage = "";
    if (hasActiveFilters) {
      emptyMessage = `
                <div style='text-align: center; padding: 40px 20px; color: #6c757d;'>
                    <p style='font-size: 1.2em; margin-bottom: 10px;'>No items match your filters</p>
                    <p>Try adjusting your search criteria or filters to see more results.</p>
                </div>
            `;
    } else {
      emptyMessage = `
                <div style='text-align: center; padding: 40px 20px; color: #6c757d;'>
                    <p style='font-size: 1.2em; margin-bottom: 10px;'>No items available</p>
                    <p>Check back soon for new event options!</p>
                </div>
            `;
    }
    catalogContainer.innerHTML = emptyMessage;
    if (loadingMessage) {
      loadingMessage.style.display = "none";
    }
    return;
  }
  const groupings = recordsToRender.filter((r) => r.fields["Item Type"] === "Grouping");
  const nonGroupingRecords = recordsToRender.filter((r) => r.fields["Item Type"] !== "Grouping");
  console.log("[TileSizing][RenderRecords] Layout decision inputs:", {
    groupingsCount: groupings.length,
    nonGroupingCount: nonGroupingRecords.length,
    groupingNames: groupings.map((g) => g.fields.Name)
  });
  const params = new URLSearchParams(window.location.search);
  const hasSubcategoryFilter = params.get("subcategory");
  const hasViewFilter = params.get("view");
  const isFilteredView = hasSubcategoryFilter || hasViewFilter || state.ui.nameFilter;
  const existingCarouselSections = catalogContainer.querySelector(".grouping-carousel-section");
  const existingUngroupedSection = catalogContainer.querySelector(".ungrouped-items-section");
  const hasExistingCarouselLayout = existingCarouselSections !== null;
  let layoutMode;
  if (append && hasExistingCarouselLayout) {
    layoutMode = "append-to-ungrouped";
  } else if (isFilteredView || groupings.length === 0) {
    layoutMode = "grid";
  } else {
    layoutMode = "carousel-sections";
  }
  console.log("[TileSizing][RenderRecords] Layout mode:", layoutMode, {
    hasSubcategoryFilter,
    hasViewFilter,
    nameFilter: state.ui.nameFilter,
    isFilteredView,
    append,
    hasExistingCarouselLayout,
    willUseCarousels: !isFilteredView && groupings.length > 0
  });
  logLayoutMode(layoutMode, isFilteredView ? "Filtered view active" : append && hasExistingCarouselLayout ? "Appending to existing carousel layout" : `${groupings.length} groupings found`);
  if (!append) {
    catalogContainer.innerHTML = "";
  }
  if (layoutMode === "append-to-ungrouped") {
    let ungroupedSection = existingUngroupedSection;
    if (!ungroupedSection) {
      ungroupedSection = document.createElement("div");
      ungroupedSection.className = "ungrouped-items-section";
      ungroupedSection.style.display = "grid";
      ungroupedSection.style.gridTemplateColumns = "repeat(auto-fill, minmax(320px, 1fr))";
      ungroupedSection.style.gap = "25px";
      ungroupedSection.style.marginTop = "20px";
      catalogContainer.appendChild(ungroupedSection);
    }
    const fragment = document.createDocumentFragment();
    const CHUNK_SIZE = 4;
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
      const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
      const cardPromises = chunk.map((record) => createInteractiveCard(record, state.records.all, imageCache2));
      const cards = await Promise.all(cardPromises);
      cards.forEach((card) => {
        if (card) fragment.appendChild(card);
      });
      ungroupedSection.appendChild(fragment);
      fragment.textContent = "";
      addEnergy();
      updateProgress(5e-5 * chunk.length);
      if (i + CHUNK_SIZE < recordsToRender.length) {
        await new Promise((resolve) => {
          if (window.requestIdleCallback) {
            requestIdleCallback(resolve, { timeout: 50 });
          } else {
            setTimeout(resolve, 0);
          }
        });
      }
    }
  } else if (isFilteredView || groupings.length === 0) {
    const fragment = document.createDocumentFragment();
    const CHUNK_SIZE = 4;
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
      const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
      const cardPromises = chunk.map((record) => createInteractiveCard(record, state.records.all, imageCache2));
      const cards = await Promise.all(cardPromises);
      cards.forEach((card) => {
        if (card) fragment.appendChild(card);
      });
      catalogContainer.appendChild(fragment);
      fragment.textContent = "";
      addEnergy();
      updateProgress(5e-5 * chunk.length);
      if (i + CHUNK_SIZE < recordsToRender.length) {
        await new Promise((resolve) => {
          if (window.requestIdleCallback) {
            requestIdleCallback(resolve, { timeout: 50 });
          } else {
            setTimeout(resolve, 0);
          }
        });
      }
    }
  } else {
    for (const grouping of groupings) {
      const childItems = getChildItemsForGrouping(grouping, state.records.all);
      if (childItems.length > 0) {
        const carouselSection = await createGroupingCarouselSection(grouping, childItems, state.records.all, imageCache2);
        catalogContainer.appendChild(carouselSection);
        addEnergy();
        updateProgress(5e-5);
        await new Promise((resolve) => {
          if (window.requestIdleCallback) {
            requestIdleCallback(resolve, { timeout: 50 });
          } else {
            setTimeout(resolve, 0);
          }
        });
      }
    }
    const allGroupedItemIds = /* @__PURE__ */ new Set();
    groupings.forEach((g) => {
      const children = getChildItemsForGrouping(g, state.records.all);
      children.forEach((c) => allGroupedItemIds.add(c.id));
    });
    const ungroupedItems = nonGroupingRecords.filter((r) => !allGroupedItemIds.has(r.id));
    if (ungroupedItems.length > 0) {
      const ungroupedSection = document.createElement("div");
      ungroupedSection.className = "ungrouped-items-section";
      ungroupedSection.style.display = "grid";
      ungroupedSection.style.gridTemplateColumns = "repeat(auto-fill, minmax(320px, 1fr))";
      ungroupedSection.style.gap = "25px";
      ungroupedSection.style.marginTop = "20px";
      const fragment = document.createDocumentFragment();
      const CHUNK_SIZE = 4;
      for (let i = 0; i < ungroupedItems.length; i += CHUNK_SIZE) {
        const chunk = ungroupedItems.slice(i, i + CHUNK_SIZE);
        const cardPromises = chunk.map((record) => createInteractiveCard(record, state.records.all, imageCache2));
        const cards = await Promise.all(cardPromises);
        cards.forEach((card) => {
          if (card) fragment.appendChild(card);
        });
        addEnergy();
        updateProgress(5e-5 * chunk.length);
      }
      ungroupedSection.appendChild(fragment);
      catalogContainer.appendChild(ungroupedSection);
    }
  }
  recordsToRender.forEach((record) => {
    updateCardIcon(record.id);
  });
  if (!append) {
    updateAllCardAvailabilityIcons().catch((err) => {
      log("UI", `Error updating availability icons: ${err.message}`);
    });
  }
  observeLazyImages(catalogContainer);
  if (loadingMessage) {
    loadingMessage.style.display = "none";
  }
  const renderEndTime = performance.now();
  const renderDuration = renderEndTime - renderStartTime;
  console.log("[TileSizing][RenderRecords] === RENDER COMPLETE ===");
  console.log("[TileSizing][RenderRecords] Render duration:", renderDuration.toFixed(2) + "ms");
  console.log("[TileSizing][RenderRecords] Final catalog container state:", {
    childCount: catalogContainer.children.length,
    sizing: getElementSizing(catalogContainer),
    hasCarouselSections: catalogContainer.querySelector(".grouping-carousel-section") !== null,
    carouselSectionCount: catalogContainer.querySelectorAll(".grouping-carousel-section").length,
    gridCardCount: catalogContainer.querySelectorAll(".event-card:not(.grouping-carousel-container .event-card)").length,
    carouselCardCount: catalogContainer.querySelectorAll(".grouping-carousel-container .event-card").length
  });
  const allRenderedCards = catalogContainer.querySelectorAll(".event-card");
  if (allRenderedCards.length > 0) {
    console.log("[TileSizing][RenderRecords] Sample card sizing (first 3):");
    Array.from(allRenderedCards).slice(0, 3).forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      console.log(`  Card ${i}:`, {
        recordId: card.dataset.recordId,
        type: card.classList.contains("grouping-card") ? "Grouping" : card.classList.contains("event-type-card") ? "Event" : "BookableItem",
        inCarousel: !!card.closest(".grouping-carousel-container"),
        width: rect.width.toFixed(1) + "px",
        height: rect.height.toFixed(1) + "px"
      });
    });
  }
  logRenderComplete(recordsToRender.length, renderDuration);
  log("UI", `Rendered ${recordsToRender.length} records to the DOM.`);
}
var mainGetItemState;
function initStateHelpers(helpers) {
  mainGetItemState = helpers.getItemState;
}
function getMainGetItemState() {
  return mainGetItemState;
}
function getItemState(recordId) {
  if (state.cart.items.has(recordId)) {
    return state.cart.items.get(recordId);
  }
  return { quantity: 1, selectedOptionIndex: 0, selections: {}, note: "" };
}
function updateItemState(recordId, updates) {
  const existing = getItemState(recordId);
  const newState = { ...existing, ...updates };
  state.cart.items.set(recordId, newState);
}
function updateLockedItemState(recordId, updates) {
  const existing = state.cart.lockedItems.get(recordId) || getItemState(recordId);
  const newState = { ...existing, ...updates };
  state.cart.lockedItems.set(recordId, newState);
}
function updateHeader3() {
  var _a;
  const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || "";
  const activeShop = state.stores.all.find((s) => s.id === state.ui.activeShopId);
  const shopName = ((_a = activeShop == null ? void 0 : activeShop.fields) == null ? void 0 : _a.Name) || "";
  document.title = eventName || (shopName ? `WTFun ${shopName}` : "WTFun");
  const eventNameInput = document.getElementById("header-event-name");
  if (eventNameInput) {
    eventNameInput.value = eventName || "Enter Plan Name";
  }
  const goalsInput = document.getElementById("header-goals");
  if (goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || "";
}
function applyCartLabels(labels) {
  const cartNameEl = document.getElementById("header-event-name");
  if (cartNameEl && labels.cartNamePlaceholder) {
    cartNameEl.value = labels.cartNamePlaceholder;
  }
  const notesLabelEl = document.querySelector('label[for="header-goals"]');
  if (notesLabelEl && labels.notesLabel) {
    notesLabelEl.textContent = labels.notesLabel;
  }
  const dateLabelEl = document.querySelector('label[for="event-date-picker"]');
  if (dateLabelEl && labels.dateLabel) {
    dateLabelEl.textContent = labels.dateLabel;
  }
  const planTitleEl = document.getElementById("itinerary-btn");
  if (planTitleEl && labels.planTitle) {
    planTitleEl.textContent = labels.planTitle;
  }
  const reserveButtonEl = document.getElementById("checkout-btn");
  if (reserveButtonEl && labels.reserveButtonText) {
    reserveButtonEl.textContent = labels.reserveButtonText;
  }
}
async function updateEventPlanDateDisplay() {
  console.log("[DEBUG updateEventPlanDateDisplay] ========== DATE DISPLAY UPDATE DEBUG ==========");
  console.log("[DEBUG updateEventPlanDateDisplay] state.eventDetails.combined contents:", Object.fromEntries(state.eventDetails.combined));
  console.log("[DEBUG updateEventPlanDateDisplay] CONSTANTS.DETAIL_TYPES.DATE:", CONSTANTS.DETAIL_TYPES.DATE);
  log("UI", "Updating event plan date display.");
  const dateInput = document.getElementById("event-date-picker");
  if (!dateInput) {
    console.log("[DEBUG updateEventPlanDateDisplay] WARNING: event-date-picker NOT found!");
    return;
  }
  const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
  console.log("[DEBUG updateEventPlanDateDisplay] Retrieved date from state:", selectedDateISO);
  if (!selectedDateISO) {
    console.log("[DEBUG updateEventPlanDateDisplay] No date in state, setting placeholder");
    dateInput.value = "Select a date";
    dateInput.classList.remove("available-full", "available-partial", "unavailable");
    console.log("[DEBUG updateEventPlanDateDisplay] ========== END DATE DISPLAY UPDATE DEBUG ==========");
    return;
  }
  const selectedDate = new Date(selectedDateISO);
  console.log("[DEBUG updateEventPlanDateDisplay] Parsed date object:", selectedDate);
  console.log("[DEBUG updateEventPlanDateDisplay] Is valid date?", !isNaN(selectedDate.getTime()));
  const lockedItems = Array.from(state.cart.lockedItems.keys()).map((recordId) => state.records.all.find((r) => r.id === recordId)).filter(Boolean);
  const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems);
  const displayValue = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  console.log("[DEBUG updateEventPlanDateDisplay] Display value:", displayValue);
  dateInput.value = displayValue;
  dateInput.classList.remove("available-full", "available-partial", "unavailable");
  switch (overallStatus) {
    case AVAILABILITY_STATUS.FULL:
      dateInput.classList.add("available-full");
      break;
    case AVAILABILITY_STATUS.PARTIAL:
      dateInput.classList.add("available-partial");
      break;
    case AVAILABILITY_STATUS.NONE:
      dateInput.classList.add("unavailable");
      break;
  }
  console.log("[DEBUG updateEventPlanDateDisplay] ========== END DATE DISPLAY UPDATE DEBUG ==========");
}
async function updateLockedItemStatusIcons() {
  log("UI", "Updating locked-in item status icons.");
  const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
  if (!selectedDateISO) {
    document.querySelectorAll(".locked-item-status-icon").forEach((icon) => {
      icon.textContent = "";
    });
    return;
  }
  const selectedDate = new Date(selectedDateISO);
  const lockedItems = document.querySelectorAll(".locked-item-card");
  for (const item of lockedItems) {
    const recordId = item.dataset.recordId;
    const record = state.records.all.find((r) => r.id === recordId);
    if (!record) continue;
    const busyTimes = await fetchCalendarForRecord(record);
    const dayStatus = await getDayStatus(selectedDate, busyTimes, record);
    let statusIconEl = item.querySelector(".locked-item-status-icon");
    if (!statusIconEl) {
      statusIconEl = document.createElement("span");
      statusIconEl.className = "locked-item-status-icon";
      item.querySelector(".locked-item-actions").prepend(statusIconEl);
    }
    statusIconEl.classList.remove("available-full", "available-partial", "unavailable");
    switch (dayStatus.status) {
      case AVAILABILITY_STATUS.FULL:
        statusIconEl.textContent = "✅";
        statusIconEl.classList.add("available-full");
        break;
      case AVAILABILITY_STATUS.PARTIAL:
        statusIconEl.textContent = "\u{1F7E0}";
        statusIconEl.classList.add("available-partial");
        break;
      case AVAILABILITY_STATUS.NONE:
        statusIconEl.textContent = "❌";
        statusIconEl.classList.add("unavailable");
        break;
    }
  }
}
function hideShopSwitcher() {
  const overlay = document.getElementById("shop-switcher-overlay");
  if (overlay) {
    overlay.classList.remove("active");
    setTimeout(() => {
      overlay.style.display = "none";
    }, 300);
  }
}
function showShopSwitcher() {
  const overlay = document.getElementById("shop-switcher-overlay");
  const listContainer = document.getElementById("shop-list-container");
  const modalTitleEl = overlay == null ? void 0 : overlay.querySelector(".checkout-modal-content h3");
  if (!overlay || !listContainer) return;
  if (modalTitleEl) {
    modalTitleEl.innerHTML = `www.whatthefun.wtf <sup>fun finder</sup>`;
    modalTitleEl.style.fontSize = "1.5em";
    modalTitleEl.style.fontWeight = "bold";
  } else {
    console.warn("Shop switcher modal title element not found for branding.");
  }
  const storeRecords = state.stores.all;
  listContainer.innerHTML = "";
  storeRecords.forEach((record) => {
    const link = document.createElement("a");
    link.href = `/?shopId=${record.id}`;
    link.textContent = record.fields.Name;
    link.style.display = "block";
    link.style.padding = "10px";
    link.style.borderBottom = "1px solid #eee";
    link.style.textDecoration = "none";
    link.style.color = "#007bff";
    listContainer.appendChild(link);
  });
  overlay.style.display = "flex";
  setTimeout(() => overlay.classList.add("active"), 10);
  document.getElementById("shop-switcher-close-btn").addEventListener("click", hideShopSwitcher);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      hideShopSwitcher();
    }
  });
}
function showToast(message, duration = 5e3) {
  const toast = document.getElementById("toast-notification");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }
}
function showEventPlanNotification(message, duration = 5e3) {
  const notification = document.getElementById("event-plan-notification");
  if (notification) {
    notification.textContent = message;
    notification.style.display = "block";
    setTimeout(() => {
      notification.style.display = "none";
    }, duration);
  }
}
function renderSessionDropdown() {
  const container = document.getElementById("session-manager-container");
  const dropdown = document.getElementById("session-dropdown");
  const user = state.session.user;
  if (!container || !dropdown || !user.isAuthenticated) {
    if (container) container.style.display = "none";
    return;
  }
  container.style.display = "block";
  dropdown.innerHTML = "";
  const sessions = user.associatedSessions || [];
  const newPlanLink = document.createElement("a");
  newPlanLink.href = window.location.pathname;
  newPlanLink.textContent = "➕ Start New Plan";
  dropdown.appendChild(newPlanLink);
  const divider = document.createElement("div");
  divider.className = "divider";
  dropdown.appendChild(divider);
  if (sessions.length > 0) {
    sessions.forEach((session) => {
      const link = document.createElement("a");
      link.href = `/?session=${session.id}`;
      link.textContent = session.name || "Unnamed Plan";
      if (state.session.id === session.id) {
        link.classList.add("active-session");
      }
      dropdown.appendChild(link);
    });
  } else {
    const noItems = document.createElement("span");
    noItems.textContent = "No saved plans yet.";
    noItems.style.padding = "10px 15px";
    noItems.style.fontSize = "0.9em";
    noItems.style.color = "#6c757d";
    dropdown.appendChild(noItems);
  }
}
function populateMyPlansDropdown(plans) {
  const container = document.getElementById("my-plans-container");
  const dropdown = document.getElementById("my-plans-dropdown");
  if (!container || !dropdown) return;
  dropdown.innerHTML = "";
  container.style.display = "block";
  if (state.session.user.isAuthenticated) {
    const defaultOption = document.createElement("option");
    defaultOption.textContent = "My Saved Plans...";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    dropdown.appendChild(defaultOption);
    const newPlanOption = document.createElement("option");
    newPlanOption.textContent = "✨ Create a New Plan";
    newPlanOption.value = "new";
    dropdown.appendChild(newPlanOption);
    if (plans && plans.length > 0) {
      plans.forEach((plan) => {
        const option = document.createElement("option");
        option.value = plan.id;
        option.textContent = plan.fields.Name || "Untitled Plan";
        if (plan.id === state.session.id) {
          option.selected = true;
          defaultOption.disabled = false;
          defaultOption.selected = false;
        }
        dropdown.appendChild(option);
      });
    }
  } else {
    const guestOption = document.createElement("option");
    guestOption.textContent = "Save & View My Plans...";
    guestOption.value = "login-to-save";
    dropdown.appendChild(guestOption);
  }
}
async function updateMobileBarAvailability() {
  const mobileBar = document.getElementById("mobile-summary-bar");
  if (!mobileBar || window.innerWidth > 999) return;
  const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
  mobileBar.classList.remove("available", "partial", "unavailable");
  if (selectedDateISO && state.cart.lockedItems.size > 0) {
    const selectedDate = new Date(selectedDateISO);
    const lockedItems = Array.from(state.cart.lockedItems.keys()).map((recordId) => state.records.all.find((r) => r.id === recordId)).filter(Boolean);
    const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems);
    switch (overallStatus) {
      case AVAILABILITY_STATUS.FULL:
        mobileBar.classList.add("available");
        break;
      case AVAILABILITY_STATUS.PARTIAL:
        mobileBar.classList.add("partial");
        break;
      case AVAILABILITY_STATUS.NONE:
        mobileBar.classList.add("unavailable");
        break;
    }
  }
}
function updateCatalogHeader() {
  var _a, _b, _c, _d, _e;
  const breadcrumbsEl = document.getElementById("breadcrumbs");
  const nameFilterEl = document.getElementById("name-filter");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  if (!breadcrumbsEl || !nameFilterEl || !clearSearchBtn) return;
  let filterCount = 0;
  breadcrumbsEl.innerHTML = "";
  clearSearchBtn.style.display = "none";
  const activeFiltersHtml = [];
  const params = new URLSearchParams(window.location.search);
  const searchTerm = nameFilterEl.value.trim();
  const isSearchActive = searchTerm.length > 0;
  const view = params.get("view");
  const categoryFilter = params.get("category");
  const subcategoryFilters = ((_a = params.get("subcategory")) == null ? void 0 : _a.split(",").filter(Boolean)) || [];
  const sortByEl = document.getElementById("sort-by");
  const sortBy = sortByEl == null ? void 0 : sortByEl.value;
  const isRecommendedSort = sortBy === "recommended";
  const goalsInput = (_c = (_b = document.getElementById("header-goals")) == null ? void 0 : _b.value) == null ? void 0 : _c.trim();
  if (view === "plan" || view === "likes" || view === "my-sessions") {
    const filterControlsEl2 = document.getElementById("filter-controls");
    if (filterControlsEl2) {
      filterControlsEl2.dataset.activeFilters = 0;
    }
    const pathContainer2 = document.createElement("div");
    pathContainer2.id = "breadcrumb-path-container";
    let viewLabel;
    if (view === "plan") {
      viewLabel = "My Plan";
    } else if (view === "likes") {
      viewLabel = "My Likes";
    } else {
      viewLabel = "My Sessions";
    }
    pathContainer2.innerHTML = `<span>${viewLabel}</span>`;
    breadcrumbsEl.appendChild(pathContainer2);
    return;
  }
  if (isSearchActive) {
    clearSearchBtn.style.display = "block";
    activeFiltersHtml.push(createFilterChip("Search: " + searchTerm, "name-filter", nameFilterEl.value));
    filterCount++;
  }
  const statusEl = document.getElementById("status-filter");
  if (statusEl && statusEl.value !== "Available") {
    activeFiltersHtml.push(createFilterChip("Status: " + statusEl.options[statusEl.selectedIndex].text, "status-filter", statusEl.value));
    filterCount++;
  }
  const headcountEl = document.getElementById("headcount-filter");
  const headcountCustomEl = document.getElementById("headcount-custom");
  if (headcountEl && headcountEl.value !== "any") {
    let text = headcountEl.options[headcountEl.selectedIndex].text;
    if (headcountEl.value === "custom" && headcountCustomEl.value) {
      text = `Headcount: ${headcountCustomEl.value}`;
    }
    activeFiltersHtml.push(createFilterChip(text, "headcount-filter", headcountEl.value));
    filterCount++;
  }
  const locationEl = document.getElementById("location-filter");
  if (locationEl && locationEl.value !== "any") {
    activeFiltersHtml.push(createFilterChip("Location: " + locationEl.options[locationEl.selectedIndex].text, "location-filter", locationEl.value));
    filterCount++;
  }
  const budgetEl = document.getElementById("budget-filter");
  if (budgetEl && budgetEl.value !== "any") {
    activeFiltersHtml.push(createFilterChip("Budget: " + budgetEl.options[budgetEl.selectedIndex].text, "budget-filter", budgetEl.value));
    filterCount++;
  }
  const mainDatePicker2 = (_d = document.getElementById("date-filter")) == null ? void 0 : _d._flatpickr;
  if (mainDatePicker2 && mainDatePicker2.selectedDates.length > 0) {
    let text;
    if (mainDatePicker2.selectedDates.length === 1) {
      text = "Date: " + mainDatePicker2.selectedDates[0].toLocaleDateString();
    } else {
      const start = mainDatePicker2.selectedDates[0].toLocaleDateString();
      const end = mainDatePicker2.selectedDates[1].toLocaleDateString();
      text = `Date: ${start} – ${end}`;
    }
    activeFiltersHtml.push(createFilterChip(text, "date-filter", "active"));
    filterCount++;
  }
  const path = [];
  path.push(`<a href="#" class="breadcrumb-link" data-filter="all">All Categories</a>`);
  const findRecordByName = (filterName) => {
    if (filterName.startsWith("rec")) {
      return state.records.all.find((r) => r.id === filterName);
    }
    let record = state.records.all.find((r) => {
      var _a2;
      return ((_a2 = r.fields.Name) == null ? void 0 : _a2.toLowerCase()) === filterName;
    });
    if (!record) {
      record = state.records.all.find((r) => {
        var _a2;
        return ((_a2 = r.fields.Name) == null ? void 0 : _a2.toLowerCase()) === filterName.replace(/-/g, " ");
      });
    }
    return record;
  };
  if (categoryFilter) {
    const categoryRecord = findRecordByName(categoryFilter);
    const categoryName = (categoryRecord == null ? void 0 : categoryRecord.fields.Name) || categoryFilter;
    path.push(`<a href="#" class="breadcrumb-link" data-filter="${categoryFilter}">${categoryName}</a>`);
  }
  subcategoryFilters.forEach((subcatFilter) => {
    const subcatRecord = findRecordByName(subcatFilter);
    const subcatName = (subcatRecord == null ? void 0 : subcatRecord.fields.Name) || subcatFilter;
    path.push(`<span>${subcatName}</span>`);
  });
  if (isRecommendedSort && goalsInput && goalsInput.length > 0) {
    const STOP_WORDS = /* @__PURE__ */ new Set([
      "a",
      "an",
      "the",
      "for",
      "with",
      "and",
      "is",
      "of",
      "to",
      "in",
      "on",
      "at",
      "my",
      "it",
      "big",
      "small",
      "all",
      "new",
      "old",
      "about",
      "want"
    ]);
    const goalWords = goalsInput.split(/[\s,]+/).filter(
      (word) => word.length > 2 && !STOP_WORDS.has(word.toLowerCase())
    );
    goalWords.forEach((goal) => {
      if (goal.toLowerCase() !== searchTerm.toLowerCase()) {
        activeFiltersHtml.push(createFilterChip(`Goal: ${goal}`, "goal-filter", goal));
      }
    });
  }
  const pathContainer = document.createElement("div");
  pathContainer.id = "breadcrumb-path-container";
  if (path.length > 1 || isSearchActive) {
    pathContainer.innerHTML = path.join(" &gt; ");
    breadcrumbsEl.appendChild(pathContainer);
  } else {
    pathContainer.innerHTML = `<span>All Categories</span>`;
    breadcrumbsEl.appendChild(pathContainer);
  }
  if (activeFiltersHtml.length > 0) {
    const chipContainer = document.createElement("div");
    chipContainer.id = "filter-chip-container";
    chipContainer.innerHTML = `
            <span class="chip-label">Active Filters:</span>
            ${activeFiltersHtml.join("")}
            <button id="clear-all-chips-btn" class="filter-chip-clear-all">Clear Filters</button>
        `;
    breadcrumbsEl.appendChild(chipContainer);
    breadcrumbsEl.querySelectorAll(".filter-chip button").forEach((button) => {
      button.addEventListener("click", handleFilterChipClear);
    });
    (_e = breadcrumbsEl.querySelector("#clear-all-chips-btn")) == null ? void 0 : _e.addEventListener("click", () => {
      var _a2;
      (_a2 = document.getElementById("reset-filters-btn")) == null ? void 0 : _a2.click();
    });
  }
  const filterControlsEl = document.getElementById("filter-controls");
  if (filterControlsEl) {
    filterControlsEl.dataset.activeFilters = filterCount;
  }
  const filterCountBadge = document.getElementById("filter-count-badge");
  const filterToggleBtn = document.getElementById("filter-toggle-btn");
  if (filterCountBadge && filterToggleBtn) {
    if (filterCount > 0) {
      filterCountBadge.textContent = filterCount;
      filterCountBadge.style.display = "inline-block";
      filterToggleBtn.classList.add("has-filters");
    } else {
      filterCountBadge.style.display = "none";
      filterToggleBtn.classList.remove("has-filters");
    }
  }
}
function handleFilterChipClear(e) {
  var _a, _b;
  const chip = e.target.closest(".filter-chip");
  if (!chip) return;
  const type = chip.dataset.filterType;
  const value = chip.dataset.filterValue;
  const applyFilters = () => window.applyFiltersAndSort(window.imageCache);
  if (type === "goal-filter") {
    const goalsInput = document.getElementById("header-goals");
    if (goalsInput) {
      const goalWords = goalsInput.value.split(/[\s,]+/).filter(Boolean);
      const updatedGoals = goalWords.filter((word) => word.toLowerCase() !== value.toLowerCase()).join(" ");
      goalsInput.value = updatedGoals;
      goalsInput.dispatchEvent(new Event("change", { bubbles: true }));
      applyFilters();
      return;
    }
  }
  switch (type) {
    case "name-filter":
      document.getElementById("name-filter").value = "";
      break;
    case "status-filter":
      document.getElementById("status-filter").value = "Available";
      break;
    case "headcount-filter":
      document.getElementById("headcount-filter").value = "any";
      document.getElementById("headcount-custom").value = "";
      document.getElementById("headcount-custom").style.display = "none";
      break;
    case "location-filter":
    case "budget-filter":
      document.getElementById(type).value = "any";
      break;
    case "date-filter":
      const datePicker = (_a = document.getElementById("date-filter")) == null ? void 0 : _a._flatpickr;
      if (datePicker) {
        datePicker.clear();
        state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
      }
      break;
    case "category-filter":
      updateUrl({ category: null, subcategory: null, view: null });
      break;
    case "subcategory-filter":
      const params = new URLSearchParams(window.location.search);
      const subcats = ((_b = params.get("subcategory")) == null ? void 0 : _b.split(",").filter(Boolean)) || [];
      const newSubcats = subcats.filter((s) => s !== value);
      updateUrl({ subcategory: newSubcats.join(",") || null });
      break;
  }
  applyFilters();
}
function createFilterChip(text, type, value) {
  const isGoal = type === "goal-filter";
  const tooltip = isGoal ? "Click to remove this goal from the Goals / Notes box." : "Clear Filter";
  return `<div class="filter-chip ${isGoal ? "goal-chip" : ""}" data-filter-type="${type}" data-filter-value="${value}" data-tippy-content="${tooltip}">
                <span>${text}</span>
                <button title="${tooltip}">\xD7</button>
            </div>`;
}
function showLoginPromptForLikes() {
  const profileButton = document.getElementById("user-profile-button");
  if (!profileButton) return;
  let promptElement = document.getElementById("login-prompt-likes");
  if (!promptElement) {
    promptElement = document.createElement("div");
    promptElement.id = "login-prompt-likes";
    promptElement.style.position = "absolute";
    promptElement.style.bottom = "110%";
    promptElement.style.right = "0";
    promptElement.style.backgroundColor = "#333";
    promptElement.style.color = "white";
    promptElement.style.padding = "8px 12px";
    promptElement.style.borderRadius = "4px";
    promptElement.style.fontSize = "0.85em";
    promptElement.style.whiteSpace = "nowrap";
    promptElement.style.opacity = "0";
    promptElement.style.transition = "opacity 0.3s ease";
    promptElement.style.pointerEvents = "none";
    promptElement.textContent = "Log in to save your likes & get updates!";
    profileButton.parentNode.style.position = "relative";
    profileButton.parentNode.appendChild(promptElement);
  }
  if (promptTimeout) clearTimeout(promptTimeout);
  requestAnimationFrame(() => {
    promptElement.style.opacity = "1";
  });
  promptTimeout = setTimeout(() => {
    promptElement.style.opacity = "0";
  }, 4e3);
}

// components/calendarView.js
var fullEventList = [];
var currentView = "month";
var currentDate = /* @__PURE__ */ new Date();
async function fetchUpcomingEvents() {
  log("Calendar", "Fetching all public events and plans from state...");
  if (!state.records.all || state.records.all.length === 0) {
    log("Calendar", "Records not loaded yet.");
    return [];
  }
  console.log(`[Calendar Debug] Checking ${state.records.all.length} total records from state.records.all.`);
  let checkedCount = 0;
  const eventItems = state.records.all.filter((record) => {
    checkedCount++;
    const itemType = record.fields["Item Type"];
    const hasDate = record.fields.Date;
    const isEvent = itemType === "Event";
    const eventName = record.fields.Name || "Unnamed Record";
    const isOneOfYourEvents = eventName.includes("EVENT_NAME_1") || eventName.includes("EVENT_NAME_2");
    if (checkedCount <= 25 || isOneOfYourEvents) {
      console.log(`[Calendar Debug] Checking: "${eventName}" | Item Type: "${itemType}" | Has Date: ${!!hasDate} | Is "Event": ${isEvent}`);
    }
    return isEvent && hasDate;
  });
  log("Calendar", `Found ${eventItems.length} public events after checking ${checkedCount} total records.`);
  const eventList = eventItems.map((record) => {
    const dateStr = record.fields.Date;
    return {
      recordId: record.id,
      name: record.fields.Name || "Unnamed Event",
      date: dateStr.split("T")[0],
      record,
      type: "event"
    };
  });
  let sessionList = [];
  console.log("[Calendar Debug] Checking for activeShopId:", state.ui.activeShopId);
  if (state.ui.activeShopId) {
    try {
      console.log("[Calendar Debug] Calling fetchSessionsWithDatesForStore with shopId:", state.ui.activeShopId);
      const sessionRecords = await fetchSessionsWithDatesForStore(state.ui.activeShopId);
      console.log("[Calendar Debug] Received sessionRecords:", sessionRecords);
      console.log("[Calendar Debug] Number of session records:", (sessionRecords == null ? void 0 : sessionRecords.length) || 0);
      sessionList = sessionRecords.map((record) => {
        const dateStr = record.fields.Date;
        console.log("[Calendar Debug] Mapping session record:", {
          id: record.id,
          name: record.fields.Name,
          dateStr,
          parsedDate: dateStr.split("T")[0]
        });
        return {
          recordId: record.id,
          name: record.fields.Name || "Unnamed Plan",
          date: dateStr.split("T")[0],
          record,
          type: "session"
        };
      });
      console.log("[Calendar Debug] Created sessionList:", sessionList);
    } catch (error) {
      console.error("[Calendar Debug] Error fetching sessions for calendar:", error);
    }
  } else {
    console.log("[Calendar Debug] No active shop ID, skipping session fetch");
  }
  const combinedList2 = [...eventList, ...sessionList];
  log("Calendar", `Total calendar entries: ${combinedList2.length} (${eventList.length} events + ${sessionList.length} plans)`);
  return combinedList2;
}
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate();
}
function getEventsForDate(dateStr) {
  return fullEventList.filter((event) => event.date === dateStr);
}
function getWeekDates(date) {
  const curr = new Date(date);
  const day = curr.getDay();
  const dates = [];
  const sunday = new Date(curr);
  sunday.setDate(curr.getDate() - day);
  for (let i = 0; i < 7; i++) {
    const weekDay = new Date(sunday);
    weekDay.setDate(sunday.getDate() + i);
    dates.push(weekDay);
  }
  return dates;
}
function createEventCard(event, compact = false) {
  const card = document.createElement("div");
  card.classList.add("event-card");
  if (compact) card.classList.add("compact");
  card.dataset.recordId = event.recordId;
  const isSession = event.type === "session";
  if (isSession) {
    const isAuthenticated = state.session.user.isAuthenticated;
    const collaborators = event.record.fields.Collaborators || [];
    const isCollaborator = isAuthenticated && collaborators.includes(state.session.user.id);
    const isLocked = !isAuthenticated || !isCollaborator;
    const eventDate = /* @__PURE__ */ new Date(event.record.fields.Date + "T00:00:00");
    const dateStr = eventDate.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    const guestCount = event.record.fields["Guest Count"] || null;
    const goals = event.record.fields.Goals || "";
    if (compact) {
      card.innerHTML = `
                <div class="event-compact-content">
                    <div class="event-time">\u{1F4C5} Plan</div>
                    <div class="event-name">${event.name}${isLocked ? " \u{1F512}" : ""}</div>
                </div>
            `;
    } else {
      card.innerHTML = `
                <div class="event-card-header">
                    <h4 class="event-card-title">\u{1F4C5} ${event.name}</h4>
                    <div class="event-card-date">${dateStr}</div>
                </div>
                <div class="event-card-body">
                    ${guestCount ? `<div class="event-card-location">\u{1F465} ${guestCount} guests</div>` : ""}
                    ${goals ? `<p class="event-card-description">${goals.substring(0, 150)}${goals.length > 150 ? "..." : ""}</p>` : ""}
                    <div class="event-price">Event Plan</div>
                </div>
                ${isLocked ? '<div class="event-lock-badge" title="Sign in as collaborator to edit">\u{1F512}</div>' : ""}
            `;
    }
    if (isLocked) {
      card.classList.add("locked");
    }
    card.addEventListener("click", async (e) => {
      log("Calendar", `Session card clicked: ${event.name}`);
      if (isLocked) {
        e.preventDefault();
        log("Calendar", `Access denied: Session is locked. User must be authenticated as collaborator.`);
        if (!isAuthenticated) {
          showUserModal();
        } else {
          alert("You must be a collaborator to access this plan.");
        }
        return;
      }
      if (event.recordId) {
        log("Calendar", `Loading session ${event.recordId} dynamically...`);
        try {
          hideCalendarModal();
          const newUrl = new URL(window.location);
          newUrl.searchParams.set("session", event.recordId);
          if (state.ui.activeShopId) {
            newUrl.searchParams.set("shopId", state.ui.activeShopId);
          }
          window.history.pushState({}, "", newUrl);
          await loadSessionFromAirtable(event.recordId);
          log("Calendar", `Session ${event.recordId} loaded successfully`);
        } catch (error) {
          console.error("[Calendar] Error loading session:", error);
          alert("Failed to load session. Please try again.");
        }
      }
    });
  } else {
    const userRsvps = event.record.fields.RSVPs || [];
    const hasRsvpd = state.session.user.isAuthenticated && userRsvps.includes(state.session.user.id);
    const eventDate = /* @__PURE__ */ new Date(event.record.fields.Date + "T00:00:00");
    const dateStr = eventDate.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    const timeStr = event.record.fields.Time || "";
    const description = event.record.fields.Description || "";
    const location = event.record.fields.Location || "";
    const price = event.record.fields.Price || 0;
    const pricingType = event.record.fields["Pricing Type"] || "Per Person";
    let priceDisplay = "";
    if (price > 0) {
      priceDisplay = `<div class="event-price">$${price} ${pricingType}</div>`;
    } else {
      priceDisplay = '<div class="event-price">Free</div>';
    }
    if (compact) {
      card.innerHTML = `
                <div class="event-compact-content">
                    <div class="event-time">${timeStr || "All Day"}</div>
                    <div class="event-name">${event.name} ${hasRsvpd ? "✅" : ""}</div>
                </div>
            `;
    } else {
      card.innerHTML = `
                <div class="event-card-header">
                    <h4 class="event-card-title">${event.name} ${hasRsvpd ? "✅" : ""}</h4>
                    <div class="event-card-date">${dateStr}${timeStr ? " • " + timeStr : ""}</div>
                </div>
                <div class="event-card-body">
                    ${description ? `<p class="event-card-description">${description.substring(0, 150)}${description.length > 150 ? "..." : ""}</p>` : ""}
                    ${location ? `<div class="event-card-location">\u{1F4CD} ${location}</div>` : ""}
                    ${priceDisplay}
                </div>
            `;
    }
    card.addEventListener("click", () => {
      log("Calendar", `Event card clicked: ${event.name}`);
      showDetailModal(event.record);
      hideCalendarModal();
    });
  }
  return card;
}
function renderMonthView() {
  console.log("[Calendar Debug] Rendering custom month view");
  const container = document.getElementById("calendar-content");
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  container.innerHTML = `
        <div class="calendar-header-controls">
            <button id="cal-prev-btn" class="cal-nav-btn">‹</button>
            <h2 class="calendar-title">${monthNames[month]} ${year}</h2>
            <button id="cal-next-btn" class="cal-nav-btn">›</button>
        </div>
        <div class="calendar-grid">
            <div class="calendar-weekdays">
                <div class="weekday">Sun</div>
                <div class="weekday">Mon</div>
                <div class="weekday">Tue</div>
                <div class="weekday">Wed</div>
                <div class="weekday">Thu</div>
                <div class="weekday">Fri</div>
                <div class="weekday">Sat</div>
            </div>
            <div class="calendar-days" id="calendar-days-grid"></div>
        </div>
    `;
  const daysGrid = document.getElementById("calendar-days-grid");
  for (let i = 0; i < firstDay; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.classList.add("calendar-day", "empty");
    daysGrid.appendChild(emptyDay);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dayDiv = document.createElement("div");
    dayDiv.classList.add("calendar-day");
    const date = new Date(year, month, day);
    const dateYear = date.getFullYear();
    const dateMonth = String(date.getMonth() + 1).padStart(2, "0");
    const dateDay = String(date.getDate()).padStart(2, "0");
    const dateStr = `${dateYear}-${dateMonth}-${dateDay}`;
    const dayEvents = getEventsForDate(dateStr);
    const today = /* @__PURE__ */ new Date();
    if (isSameDay(date, today)) {
      dayDiv.classList.add("today");
    }
    dayDiv.innerHTML = `<div class="day-number">${day}</div>`;
    if (dayEvents.length > 0) {
      dayDiv.classList.add("has-events");
      const eventsContainer = document.createElement("div");
      eventsContainer.classList.add("day-events");
      dayEvents.slice(0, 3).forEach((event) => {
        const eventBadge = document.createElement("div");
        eventBadge.classList.add("event-badge");
        if (event.type === "session") {
          const isAuthenticated = state.session.user.isAuthenticated;
          const collaborators = event.record.fields.Collaborators || [];
          const isCollaborator = isAuthenticated && collaborators.includes(state.session.user.id);
          const isLocked = !isAuthenticated || !isCollaborator;
          eventBadge.textContent = `\u{1F4C5} ${event.name}${isLocked ? " \u{1F512}" : ""}`;
          eventBadge.title = isLocked ? `Plan: ${event.name} (Sign in as collaborator to edit)` : `Plan: ${event.name}`;
          if (isLocked) {
            eventBadge.classList.add("locked");
          }
          eventBadge.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (isLocked) {
              log("Calendar", `Access denied: Session badge clicked but locked. User must be authenticated as collaborator.`);
              if (!isAuthenticated) {
                showUserModal();
              } else {
                alert("You must be a collaborator to access this plan.");
              }
              return;
            }
            log("Calendar", `Loading session ${event.recordId} dynamically from badge...`);
            try {
              hideCalendarModal();
              const newUrl = new URL(window.location);
              newUrl.searchParams.set("session", event.recordId);
              if (state.ui.activeShopId) {
                newUrl.searchParams.set("shopId", state.ui.activeShopId);
              }
              window.history.pushState({}, "", newUrl);
              await loadSessionFromAirtable(event.recordId);
              log("Calendar", `Session ${event.recordId} loaded successfully from badge`);
            } catch (error) {
              console.error("[Calendar] Error loading session from badge:", error);
              alert("Failed to load session. Please try again.");
            }
          });
        } else {
          const timeStr = event.record.fields.Time || "";
          eventBadge.textContent = `${timeStr ? timeStr + " " : ""}${event.name}`;
          eventBadge.title = event.name;
          eventBadge.addEventListener("click", (e) => {
            e.stopPropagation();
            showDetailModal(event.record);
            hideCalendarModal();
          });
        }
        eventsContainer.appendChild(eventBadge);
      });
      if (dayEvents.length > 3) {
        const moreSpan = document.createElement("div");
        moreSpan.classList.add("more-events");
        moreSpan.textContent = `+${dayEvents.length - 3} more`;
        eventsContainer.appendChild(moreSpan);
      }
      dayDiv.appendChild(eventsContainer);
    }
    daysGrid.appendChild(dayDiv);
  }
  document.getElementById("cal-prev-btn").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderMonthView();
  });
  document.getElementById("cal-next-btn").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderMonthView();
  });
}
function renderWeekView() {
  console.log("[Calendar Debug] Rendering week view");
  const container = document.getElementById("calendar-content");
  const weekDates = getWeekDates(currentDate);
  const startDate = weekDates[0];
  const endDate = weekDates[6];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const dateRange = `${monthNames[startDate.getMonth()]} ${startDate.getDate()} - ${monthNames[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`;
  container.innerHTML = `
        <div class="calendar-header-controls">
            <button id="cal-prev-btn" class="cal-nav-btn">‹</button>
            <h2 class="calendar-title">${dateRange}</h2>
            <button id="cal-next-btn" class="cal-nav-btn">›</button>
        </div>
        <div class="week-grid" id="week-grid"></div>
    `;
  const weekGrid = document.getElementById("week-grid");
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const today = /* @__PURE__ */ new Date();
  weekDates.forEach((date, index) => {
    const dayColumn = document.createElement("div");
    dayColumn.classList.add("week-day-column");
    if (isSameDay(date, today)) {
      dayColumn.classList.add("today");
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    const dayEvents = getEventsForDate(dateStr);
    dayColumn.innerHTML = `
            <div class="week-day-header">
                <div class="week-day-name">${dayNames[index]}</div>
                <div class="week-day-date">${date.getMonth() + 1}/${date.getDate()}</div>
            </div>
            <div class="week-day-events"></div>
        `;
    const eventsContainer = dayColumn.querySelector(".week-day-events");
    if (dayEvents.length === 0) {
      eventsContainer.innerHTML = '<div class="no-events">No events</div>';
    } else {
      dayEvents.forEach((event) => {
        const card = createEventCard(event, true);
        eventsContainer.appendChild(card);
      });
    }
    weekGrid.appendChild(dayColumn);
  });
  document.getElementById("cal-prev-btn").addEventListener("click", () => {
    currentDate.setDate(currentDate.getDate() - 7);
    renderWeekView();
  });
  document.getElementById("cal-next-btn").addEventListener("click", () => {
    currentDate.setDate(currentDate.getDate() + 7);
    renderWeekView();
  });
}
function renderListView() {
  console.log("[Calendar Debug] Rendering list view");
  const container = document.getElementById("calendar-content");
  container.innerHTML = '<div id="events-list-container"></div>';
  const listContainer = document.getElementById("events-list-container");
  if (fullEventList.length === 0) {
    listContainer.innerHTML = '<div class="no-events-message">No upcoming events found.</div>';
    return;
  }
  const sortedEvents = [...fullEventList].sort((a, b) => {
    return new Date(a.record.fields.Date) - new Date(b.record.fields.Date);
  });
  sortedEvents.forEach((event) => {
    const card = createEventCard(event, false);
    listContainer.appendChild(card);
  });
}
function switchView(view) {
  currentView = view;
  const monthBtn = document.getElementById("calendar-view-month");
  const weekBtn = document.getElementById("calendar-view-week");
  const listBtn = document.getElementById("calendar-view-list");
  monthBtn == null ? void 0 : monthBtn.classList.remove("active");
  weekBtn == null ? void 0 : weekBtn.classList.remove("active");
  listBtn == null ? void 0 : listBtn.classList.remove("active");
  if (view === "month") {
    monthBtn == null ? void 0 : monthBtn.classList.add("active");
    renderMonthView();
  } else if (view === "week") {
    weekBtn == null ? void 0 : weekBtn.classList.add("active");
    renderWeekView();
  } else {
    listBtn == null ? void 0 : listBtn.classList.add("active");
    renderListView();
  }
}
function setupCalendarEventListeners() {
  var _a, _b, _c, _d;
  const calendarModal = document.getElementById("calendar-modal-overlay");
  const closeBtn3 = document.getElementById("calendar-close-btn");
  (_a = document.getElementById("calendar-view-btn")) == null ? void 0 : _a.addEventListener("click", showCalendarModal);
  closeBtn3 == null ? void 0 : closeBtn3.addEventListener("click", hideCalendarModal);
  calendarModal == null ? void 0 : calendarModal.addEventListener("click", (e) => {
    if (e.target === calendarModal) {
      hideCalendarModal();
    }
  });
  (_b = document.getElementById("calendar-view-month")) == null ? void 0 : _b.addEventListener("click", () => switchView("month"));
  (_c = document.getElementById("calendar-view-week")) == null ? void 0 : _c.addEventListener("click", () => switchView("week"));
  (_d = document.getElementById("calendar-view-list")) == null ? void 0 : _d.addEventListener("click", () => switchView("list"));
}
async function showCalendarModal() {
  const calendarModal = document.getElementById("calendar-modal-overlay");
  log("Calendar", "Showing upcoming events calendar.");
  fullEventList = await fetchUpcomingEvents();
  log("Calendar", `Loaded ${fullEventList.length} events for calendar view.`);
  console.log("[Calendar Debug] Full event list:", fullEventList);
  if (fullEventList.length === 0) {
    log("Calendar", "No events found to display in calendar.");
  }
  currentDate = /* @__PURE__ */ new Date();
  if (currentView === "month") {
    renderMonthView();
  } else if (currentView === "week") {
    renderWeekView();
  } else {
    renderListView();
  }
  if (calendarModal) {
    calendarModal.classList.add("active");
    calendarModal.style.display = "flex";
  }
  document.body.classList.add("modal-open");
}
function hideCalendarModal() {
  const calendarModal = document.getElementById("calendar-modal-overlay");
  log("Calendar", "Hiding calendar modal.");
  if (calendarModal) {
    calendarModal.classList.remove("active");
    setTimeout(() => {
      calendarModal.style.display = "none";
    }, 300);
  }
  document.body.classList.remove("modal-open");
}

// main.js
var imageCache = /* @__PURE__ */ new Map();
window.imageCache = imageCache;
window.applyFiltersAndSort = applyFiltersAndSort;
window.showReceiptModal = showReceiptModal;
function syncUiWithUrl() {
  const params = new URLSearchParams(window.location.search);
  const openItemId = params.get("openItem");
  const view = params.get("view");
  hideDetailModal();
  hideItineraryModal();
  hidePresentationView();
  const categoryFilters = document.getElementById("category-filters");
  if (categoryFilters) {
    categoryFilters.querySelectorAll(".filter-btn").forEach((btn) => btn.classList.remove("active"));
    let buttonToActivate;
    let categoryFilter = params.get("category");
    const activeShop = state.stores.all.find((s) => s.id === state.ui.activeShopId);
    const hasStoreCategories = activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0;
    if (view === "plan") {
      buttonToActivate = document.getElementById("plan-filter-btn");
    } else if (view === "likes") {
      buttonToActivate = document.getElementById("liked-items-header-btn");
    } else if (categoryFilter) {
      buttonToActivate = categoryFilters.querySelector(`.filter-btn[data-filter="${categoryFilter}"]`);
    } else if (hasStoreCategories) {
      buttonToActivate = categoryFilters.querySelector(".filter-btn.category-filter-btn");
      if (buttonToActivate) {
        const newCategory = buttonToActivate.dataset.filter;
        updateUrl2({ category: newCategory, subcategory: null, view: null });
        params.set("category", newCategory);
      }
    } else {
      buttonToActivate = categoryFilters.querySelector('.filter-btn[data-filter="all"]');
    }
    if (buttonToActivate) {
      buttonToActivate.classList.add("active");
    }
  }
  if (typeof applyFiltersAndSort === "function") {
    applyFiltersAndSort(imageCache);
  } else {
    console.error("applyFiltersAndSort is not defined or imported correctly.");
  }
  setTimeout(() => {
    if (view === "present") {
      showPresentationView("ideas");
    } else if (view === "itinerary") {
      showItineraryModal();
    } else if (openItemId) {
      const recordToOpen = state.records.all.find((r) => r.id === openItemId);
      if (recordToOpen) {
        showDetailModal(recordToOpen);
      } else {
        console.warn(`[syncUiWithUrl] Record ID ${openItemId} not found in state.records.all.`);
      }
    }
  }, 100);
}
async function initialize() {
  var _a;
  log("Main", "1. Initialization started.");
  console.log("[Main] ========== INITIAL STATE CHECK ==========");
  console.log("[Main] Initial state.ui.currentProgress:", state.ui.currentProgress);
  console.log("[Main] Initial state.ui:", state.ui);
  console.log("[Main] ========== END INITIAL STATE CHECK ==========");
  initStateHelpers({ getItemState });
  document.addEventListener("userLoggedIn", () => {
    log("Main", "'userLoggedIn' event caught, reapplying filters and reinitializing chat.");
    if (typeof applyFiltersAndSort === "function") {
      applyFiltersAndSort(imageCache);
    }
    const recordIds = Array.from(document.querySelectorAll(".event-card[data-record-id]")).map((card) => card.dataset.recordId);
    if (recordIds.length > 0) batchUpdateCardIcons(recordIds);
    if (typeof initializeSessionChat === "function") {
      log("Main", "User logged in, re-initializing session chat with new user info.");
      initializeSessionChat();
    }
  });
  document.addEventListener("planCreated", () => {
    log("Main", "New plan created.");
  });
  document.addEventListener("sessionReady", () => {
    console.log("[DEBUG sessionReady HANDLER] ========== sessionReady EVENT FIRED ==========");
    console.log("[DEBUG sessionReady HANDLER] Event received at:", (/* @__PURE__ */ new Date()).toISOString());
    console.log("[DEBUG] sessionReady event fired");
    console.log("[DEBUG] state.eventDetails.combined at sessionReady:", Object.fromEntries(state.eventDetails.combined));
    console.log("[DEBUG] Date value in state at sessionReady:", state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE));
    console.log("[DEBUG sessionReady HANDLER] state.session.id:", state.session.id);
    console.log("[DEBUG sessionReady HANDLER] state.cart.lockedItems.size:", state.cart.lockedItems.size);
    console.log("[DEBUG sessionReady HANDLER] state.cart.items.size:", state.cart.items.size);
    log("Main", '"sessionReady" event received, re-initializing session chat.');
    console.log("[DEBUG sessionReady HANDLER] Step 1: Checking initializeSessionChat...");
    if (typeof initializeSessionChat === "function") {
      console.log("[DEBUG sessionReady HANDLER] ✅ initializeSessionChat is a function, calling it...");
      initializeSessionChat();
      console.log("[DEBUG sessionReady HANDLER] ✅ initializeSessionChat completed");
    } else {
      console.error("[DEBUG sessionReady HANDLER] ❌ initializeSessionChat is not defined");
      console.error("initializeSessionChat is not defined or imported correctly.");
    }
    console.log("[DEBUG sessionReady HANDLER] Step 2: Calling UI update functions...");
    console.log("[DEBUG sessionReady HANDLER] Calling ui.updateHeader...");
    updateHeader3();
    console.log("[DEBUG sessionReady HANDLER] ✅ ui.updateHeader completed");
    console.log("[DEBUG sessionReady HANDLER] Calling ui.updateEventPlanSection...");
    updateEventPlanSection();
    console.log("[DEBUG sessionReady HANDLER] ✅ ui.updateEventPlanSection completed");
    console.log("[DEBUG sessionReady HANDLER] Calling ui.updateIdeasCarousel...");
    updateIdeasCarousel();
    console.log("[DEBUG sessionReady HANDLER] ✅ ui.updateIdeasCarousel completed");
    console.log("[DEBUG sessionReady HANDLER] Calling ui.updateTotalCost...");
    updateTotalCost();
    console.log("[DEBUG sessionReady HANDLER] ✅ ui.updateTotalCost completed");
    console.log("[DEBUG] About to call updateEventPlanDateDisplay from sessionReady");
    console.log("[DEBUG sessionReady HANDLER] Calling ui.updateEventPlanDateDisplay...");
    updateEventPlanDateDisplay();
    console.log("[DEBUG sessionReady HANDLER] ✅ ui.updateEventPlanDateDisplay completed");
    console.log("[DEBUG sessionReady HANDLER] Step 3: Updating card icons...");
    const recordIds = Array.from(document.querySelectorAll(".event-card[data-record-id]")).map((card) => card.dataset.recordId);
    console.log("[DEBUG sessionReady HANDLER] Found", recordIds.length, "event cards to update");
    if (recordIds.length > 0) batchUpdateCardIcons(recordIds);
    console.log("[DEBUG sessionReady HANDLER] ✅ Card icons updated");
    console.log("[DEBUG sessionReady HANDLER] Step 4: Setting timeout for duplicate verification...");
    setTimeout(() => {
      console.log("[DEBUG sessionReady HANDLER] Verifying no duplicate items...");
      verifyNoDuplicateItems();
      console.log("[DEBUG sessionReady HANDLER] ✅ Duplicate verification completed");
    }, 100);
    console.log("[DEBUG sessionReady HANDLER] ========== sessionReady HANDLER COMPLETE ==========");
  });
  toggleLoading(true);
  try {
    const [stores, records] = await Promise.all([fetchAllStores(), fetchAllRecords()]);
    const DEFAULT_V21_PROFILE = JSON.stringify({
      "profileSource": "system_default_v21",
      "Pillars": { "Activities": 8, "Food/Drink": 0, "Venue": 0, "Extras": 0 },
      "Vibe": { "Energy": 7, "Relaxation": 3, "Formality": 2, "Novelty": 6 },
      "Intellect": { "Creative": 5, "Analytical": 5 },
      "Physicality": { "Intensity": 5, "Accessibility": 5 },
      "Tags": ["active", "default", "testing", "generic", "fun"]
    });
    records.forEach((record) => {
      if (!record.fields.AI_Profile && (record.fields["Item Type"] === "Bookable Item" || record.fields["Item Type"] === "Event")) {
        record.fields.AI_Profile = DEFAULT_V21_PROFILE;
      }
      if (record.fields.AI_Profile && record.fields.Rankings) {
        record.fields.Rankings = null;
      }
    });
    setState2({
      stores: { all: stores },
      records: { all: records }
    });
    log("Main", `Fetched ${stores.length} stores and ${records.length} items. Applied default AI profiles.`);
  } catch (error) {
    console.error("Failed to load initial store/item data:", error);
    document.getElementById("loading-message").innerHTML = `
            <div style='color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 20px; text-align: center; max-width: 500px; margin: 0 auto;'>
                <p style='margin: 0 0 15px 0; font-weight: bold;'>Unable to Load Catalog</p>
                <p style='margin: 0 0 15px 0;'>We couldn't connect to load the event catalog. Please check your internet connection and try again.</p>
                <button onclick="window.location.reload()" style='background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;'>Retry</button>
            </div>
        `;
    toggleLoading(true);
    return;
  }
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session");
  let shopId = urlParams.get("shopId");
  let activeShop = null;
  const jwt = localStorage.getItem("jwt");
  if (jwt) {
    try {
      const payload = JSON.parse(atob(jwt.split(".")[1]));
      if (payload.exp * 1e3 > Date.now()) {
        setState2({
          session: {
            ...state.session,
            user: {
              ...state.session.user,
              isAuthenticated: true,
              id: payload.userId,
              name: payload.name,
              email: payload.email,
              isOwner: payload.isOwner,
              ownedStoreId: payload.ownedStoreId || null,
              ownerDashboardId: payload.ownerDashboardId || null
            }
          }
        });
        log("Main", `User authenticated via JWT (early init): ${payload.userId}, isOwner: ${payload.isOwner}, ownedStoreId: ${payload.ownedStoreId}`);
      } else {
        localStorage.removeItem("jwt");
        log("Main", "Existing JWT expired (early init).");
      }
    } catch (e) {
      localStorage.removeItem("jwt");
      console.error("[Main] Failed to parse existing JWT (early init):", e);
    }
  }
  if (shopId) {
    activeShop = state.stores.all.find((s) => s.id === shopId);
    log("Main", `Shop ID found in URL: ${shopId}. Found shop: ${!!activeShop}`);
  }
  if (sessionId) {
    log("Main", `Session ID found in URL: ${sessionId}. Loading session...`);
    await loadSessionFromAirtable(sessionId);
    if (!activeShop && state.session.storeId) {
      activeShop = state.stores.all.find((s) => s.id === state.session.storeId);
      log("Main", `Determined shop from loaded session: ${state.session.storeId}. Found shop: ${!!activeShop}`);
    }
  }
  if (!activeShop) {
    const lastVisitedShopId = localStorage.getItem("lastVisitedShopId");
    if (lastVisitedShopId) {
      activeShop = state.stores.all.find((s) => s.id === lastVisitedShopId);
      log("Main", `Using last visited shop from localStorage: ${lastVisitedShopId}. Found shop: ${!!activeShop}`);
    }
  }
  if (!activeShop) {
    activeShop = state.stores.all.find((r) => r.fields.Name === "Tyler's Mystery Tours");
    log("Main", `Falling back to default shop 'Tyler's Mystery Tours'. Found shop: ${!!activeShop}`);
  }
  if (activeShop) {
    console.log("[Main] ========== BEFORE setState FOR ACTIVE SHOP ==========");
    console.log("[Main] state.ui.currentProgress BEFORE setState:", state.ui.currentProgress);
    console.log("[Main] Full state.ui BEFORE setState:", state.ui);
    const uiUpdate = {
      ...state.ui,
      activeShopId: activeShop.id,
      // Ensure currentProgress maintains its default value of 0.3
      currentProgress: state.ui.currentProgress !== void 0 ? state.ui.currentProgress : 0.3
    };
    console.log("[Main] UI object being passed to setState:", uiUpdate);
    console.log("[Main] currentProgress in UI update:", uiUpdate.currentProgress);
    setState2({ ui: uiUpdate });
    console.log("[Main] state.ui.currentProgress AFTER setState:", state.ui.currentProgress);
    console.log("[Main] ========== AFTER setState FOR ACTIVE SHOP ==========");
    localStorage.setItem("lastVisitedShopId", activeShop.id);
    log("Main", `Active Shop set to: ${activeShop.fields.Name} (ID: ${activeShop.id})`);
    if (!state.session.id) {
      log("Main", "No session ID found, creating new session for guest chat...");
      await saveSessionToAirtable();
    }
    const titleElement = document.getElementById("main-shop-title");
    if (titleElement) {
      const shopTitleField = activeShop.fields["Shop Title"] || activeShop.fields.Name;
      const titles = shopTitleField.split("|").map((t) => t.trim()).filter(Boolean);
      const displayTitle = titles.length > 0 ? titles[0] : "Shop";
      const shopTypeLabelField = activeShop.fields["Shop Type Label"] || "Shop";
      const labels = shopTypeLabelField.split("|").map((t) => t.trim()).filter(Boolean);
      const displayLabel = labels.length > 0 ? labels[0] : "Shop";
      titleElement.innerHTML = `${displayTitle} <sup>${displayLabel}</sup><button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`;
      titleElement.style.cursor = "pointer";
      titleElement.addEventListener("click", (e) => {
        if (e.target.id !== "shop-switcher-trigger") {
          const newUrl = `${window.location.pathname}?shopId=${activeShop.id}`;
          history.pushState({}, "", newUrl);
          syncUiWithUrl();
          window.scrollTo({ top: 0, behavior: "smooth" });
          log("Main", `Navigated to top level catalog for shop: ${activeShop.id}`);
        }
      });
      const switcherTrigger = document.getElementById("shop-switcher-trigger");
      if (switcherTrigger) switcherTrigger.addEventListener("click", () => showShopSwitcher());
      const parentCollectiveTrigger = document.getElementById("parent-collective-trigger");
      if (parentCollectiveTrigger) parentCollectiveTrigger.addEventListener("click", () => {
        showShopSwitcher();
      });
    }
    const existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (existingFavicon) existingFavicon.remove();
    const logoTag = activeShop.fields.LogoTag;
    if (logoTag) {
      const imageUrls = await fetchImagesByTags(logoTag);
      if (imageUrls && imageUrls.length > 0) {
        const logoUrl = imageUrls[0];
        const favicon = document.createElement("link");
        favicon.rel = "icon";
        favicon.href = logoUrl.replace("/upload/", "/upload/c_scale,w_32/");
        document.head.appendChild(favicon);
        const headerLogo = document.createElement("img");
        headerLogo.src = logoUrl.replace("/upload/", "/upload/h_50,c_scale,f_auto,q_auto/");
        headerLogo.alt = `${activeShop.fields.Name} Logo`;
        headerLogo.loading = "eager";
        headerLogo.fetchPriority = "high";
        const logoContainer = document.getElementById("shop-logo-container");
        if (logoContainer) {
          logoContainer.innerHTML = "";
          logoContainer.appendChild(headerLogo);
        } else {
          const headerLeft = document.getElementById("header-left");
          if (headerLeft) headerLeft.prepend(headerLogo);
        }
      }
    }
    const shopSettings = {
      shopType: activeShop.fields.ShopType || "Events",
      enabledFilters: activeShop.fields.EnabledFilters || ["Date & Time", "Headcount", "Location", "Subcategories"],
      paymentOptions: activeShop.fields.PaymentOptions || "DepositOnly",
      terms: activeShop.fields.TermsAndConditions || "Default terms and conditions text.",
      cartLabels: {}
    };
    try {
      shopSettings.cartLabels = JSON.parse(activeShop.fields.CartLabels || "{}");
    } catch (e) {
      console.warn("Could not parse CartLabels JSON, using defaults.");
    }
    const marqueeContainer = document.getElementById("marquee-banner-container");
    const marqueeTextElement = document.getElementById("marquee-text");
    if (marqueeContainer && marqueeTextElement) {
      const marqueeContent = activeShop.fields["Marquee Text"] || activeShop.fields.Description || "";
      if (marqueeContent.trim()) {
        marqueeTextElement.textContent = marqueeContent;
        const textLength = marqueeContent.length;
        const duration = Math.min(60, Math.max(10, textLength / 15));
        marqueeTextElement.style.animationDuration = `${duration}s`;
        marqueeContainer.style.display = "block";
        log("Main", `Marquee activated with text (duration: ${duration}s).`);
      } else {
        marqueeContainer.style.display = "none";
        log("Main", "Marquee has no content, keeping it hidden.");
      }
    } else {
      console.warn("Marquee container or text element not found.");
    }
    applyCartLabels(shopSettings.cartLabels);
    initializeEventListeners(imageCache, window.flatpickr, shopSettings);
    updateFooter(activeShop);
    const loginToken = urlParams.get("token");
    if (loginToken) {
      log("Main", "Magic link token found in URL, verifying...");
      try {
        const response = await fetch("/api/auth-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: loginToken })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Token verification failed");
        await _handleSuccessfulLogin(data);
        log("Main", "Magic link verification successful.");
        const cleanUrl = new URL(window.location);
        cleanUrl.searchParams.delete("token");
        window.history.replaceState({}, document.title, cleanUrl.toString());
      } catch (error) {
        console.error(`Sign-in via token failed: ${error.message}`);
        alert(`Sign-in failed: ${error.message}`);
        const cleanUrl = new URL(window.location);
        cleanUrl.searchParams.delete("token");
        window.history.replaceState({}, document.title, cleanUrl.toString());
        handleSignOut();
      }
    } else if (state.session.user.isAuthenticated && state.session.user.likedItemIds.size === 0) {
      log("Main", "User authenticated by JWT, but no likes found. Fetching full user data from /api/update-user-prefs?action=get-user-data...");
      const storedJwt = localStorage.getItem("jwt");
      try {
        const response = await fetch("/api/update-user-prefs?action=get-user-data", {
          method: "GET",
          headers: { "Authorization": `Bearer ${storedJwt}` }
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to fetch user data (Status: ${response.status})`);
        }
        const userData = await response.json();
        if (userData.likedItemIds) {
          setState2({
            session: {
              ...state.session,
              user: {
                ...state.session.user,
                likedItemIds: new Set(userData.likedItemIds),
                rsvps: new Set(userData.rsvpdItemIds || [])
              }
            }
          });
          log("Main", `Successfully fetched and set ${userData.likedItemIds.length} liked items and ${((_a = userData.rsvpdItemIds) == null ? void 0 : _a.length) || 0} RSVPs.`);
          const recordIds = Array.from(document.querySelectorAll(".event-card[data-record-id]")).map((card) => card.dataset.recordId);
          if (recordIds.length > 0) batchUpdateCardIcons(recordIds);
        }
      } catch (error) {
        console.error("[Main] Error fetching user data on reload:", error);
      }
    } else {
      log("Main", "User state restored or not authenticated.");
    }
    if (sessionId && state.session.id !== sessionId) {
      log("Main", `Session ID ${sessionId} detected, loading session data now.`);
      await loadSessionFromAirtable(sessionId);
    } else if (state.session.id) {
      log("Main", `Session ${state.session.id} already loaded or initiated.`);
      if (typeof initializeSessionChat === "function") {
        initializeSessionChat();
      }
      updateHeader3();
      updateEventPlanSection();
      updateIdeasCarousel();
      updateTotalCost();
      setTimeout(() => {
        verifyNoDuplicateItems();
      }, 100);
    } else {
      log("Main", "No active session ID found (this should not happen after the guest-session fix).");
    }
    let defaultFilterValue = activeShop.fields.DefaultStatusFilter || "Available";
    if (defaultFilterValue === "Show All") defaultFilterValue = "all";
    const statusFilterEl = document.getElementById("status-filter");
    if (statusFilterEl) statusFilterEl.value = defaultFilterValue;
    toggleLoading(false);
    updateSaveShareButton();
    initializeChatEventListeners();
    setupAuthEventListeners();
    setupCalendarEventListeners();
    updateUserProfileIcon();
    syncUiWithUrl();
    window.addEventListener("popstate", syncUiWithUrl);
    setState2({ ui: { ...state.ui, isInitializing: false } });
    initBackgroundEngine();
    loadEffect(fluid_default, null);
    log("Main", "Initialization complete.");
  } else {
    console.error("CRITICAL: Could not determine an active shop. Catalog cannot be displayed.");
    document.getElementById("loading-message").innerHTML = `
            <div style='color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 20px; text-align: center; max-width: 500px; margin: 0 auto;'>
                <p style='margin: 0 0 15px 0; font-weight: bold;'>Shop Not Found</p>
                <p style='margin: 0 0 15px 0;'>We couldn't find a valid event shop to display. Please contact support or try again.</p>
                <button onclick="window.location.href='/'" style='background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 10px;'>Go Home</button>
                <button onclick="window.location.reload()" style='background-color: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;'>Retry</button>
            </div>
        `;
    toggleLoading(true);
  }
}
window.addEventListener("unhandledrejection", function(event) {
  console.error("Unhandled Promise Rejection:", event.reason);
});
initialize();
//# sourceMappingURL=main.bundle.js.map
