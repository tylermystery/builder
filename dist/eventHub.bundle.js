// utils/debug.js
var isDebugMode = false;
function log(prefix, ...args) {
  if (isDebugMode) {
    console.log(`[${prefix}]`, ...args);
  }
}

// api.js
var PERSONAL_ACCESS_TOKEN = "patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57";
var BASE_ID = "app5yTznb3R5YNUFw";
var SESSIONS_TABLE_NAME = "Sessions";
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

// chat.js
var originalTitle = document.title;
var isTabActive = true;
window.addEventListener("focus", () => {
  isTabActive = true;
  document.title = originalTitle;
});
window.addEventListener("blur", () => {
  isTabActive = false;
});

// components/effects/fractal.js
console.log("[fractal.js] File execution started.");
var settings = {};
var angle = 0;
var fractalEffect = {
  name: "Fractal (Simple)",
  type: "canvas",
  // <-- ADD THIS LINE
  init: (ctx, width, height) => {
    log("FX:Fractal", "Initializing...");
  },
  draw: (ctx, width, height, deltaTime, colors, currentSettings) => {
    settings = currentSettings;
    ctx.fillStyle = `rgba(255, 255, 255, 0.05)`;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    angle += settings.spin * 1e-3 * deltaTime;
    ctx.rotate(angle);
    const maxLevels = Math.floor(settings.complexity);
    const branchLength = settings.zoom;
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
function compileShader(gl2, type, source) {
  const shader2 = gl2.createShader(type);
  gl2.shaderSource(shader2, source);
  gl2.compileShader(shader2);
  if (!gl2.getShaderParameter(shader2, gl2.COMPILE_STATUS)) {
    console.error("An error occurred compiling the shaders: " + gl2.getShaderInfoLog(shader2));
    gl2.deleteShader(shader2);
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
  constructor(gl2, vsSource2, fsSource2) {
    this.gl = gl2;
    const vertexShader = compileShader(gl2, gl2.VERTEX_SHADER, vsSource2);
    const fragmentShader = compileShader(gl2, gl2.FRAGMENT_SHADER, fsSource2);
    const program = gl2.createProgram();
    gl2.attachShader(program, vertexShader);
    gl2.attachShader(program, fragmentShader);
    gl2.linkProgram(program);
    if (!gl2.getProgramParameter(program, gl2.LINK_STATUS)) {
      console.error("Unable to initialize the shader program: " + gl2.getProgramInfoLog(program));
      return;
    }
    this.program = program;
    this.uniforms = {};
    const positionBuffer = gl2.createBuffer();
    gl2.bindBuffer(gl2.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(positions), gl2.STATIC_DRAW);
    this.positionAttributeLocation = gl2.getAttribLocation(program, "a_position");
    gl2.enableVertexAttribArray(this.positionAttributeLocation);
    gl2.bindBuffer(gl2.ARRAY_BUFFER, positionBuffer);
    gl2.vertexAttribPointer(this.positionAttributeLocation, 2, gl2.FLOAT, false, 0, 0);
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
var gl = null;
var shader = null;
var drawCallCount = 0;
var lastLoggedProgress = null;
var fluidEffect = {
  name: "Fluid Energy",
  type: "webgl",
  // This is our new type
  init: (context) => {
    gl = context;
    shader = new Shader(gl, vsSource, fsSource);
  },
  // MODIFIED: Added 'progress' to the draw function
  draw: (gl2, width, height, time, energy, progress) => {
    if (!shader) return;
    drawCallCount++;
    lastLoggedProgress = progress;
    shader.use();
    gl2.uniform2f(shader.getUniformLocation("u_resolution"), width, height);
    gl2.uniform1f(shader.getUniformLocation("u_time"), time);
    gl2.uniform1f(shader.getUniformLocation("u_energy"), energy);
    gl2.uniform1f(shader.getUniformLocation("u_progress"), progress);
    gl2.drawArrays(gl2.TRIANGLES, 0, 6);
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
console.log("[auth.js] 4. File execution finished. Exports are ready.");

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
var modalOverlay = document.getElementById("detail-modal-overlay");

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

// eventHub.js
async function initializeEventHub() {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get("slug");
  if (!slug) {
    document.body.innerHTML = "<h1>Error: No event specified.</h1>";
    return;
  }
  try {
    const response = await fetch(`/api/get-event-by-slug?slug=${slug}`);
    if (!response.ok) {
      throw new Error("Could not load event data.");
    }
    const { event, session } = await response.json();
    document.getElementById("event-name").textContent = event.fields.Name;
    const sessionData = JSON.parse(session.fields["Items with Variations"] || "{}");
    const lockedItems = new Map(Object.entries(sessionData.lockedInItems || {}));
    const itemNames = Array.from(lockedItems.keys()).join(", ");
    document.getElementById("event-content").innerHTML = `
            <h2>Event Plan</h2>
            <p>Items: ${itemNames || "None"}</p> 
        `;
    document.getElementById("event-chat").innerHTML = `<h2>Event Chat</h2><p>Chat will be here.</p>`;
  } catch (error) {
    document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
  }
}
initializeEventHub();
//# sourceMappingURL=eventHub.bundle.js.map
