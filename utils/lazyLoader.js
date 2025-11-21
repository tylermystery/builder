// Lazy module loader for performance optimization
// This utility handles dynamic imports for heavy, infrequently used modules

const loadedModules = new Map();

/**
 * Lazy load the chat module when needed
 */
export async function loadChatModule() {
  if (loadedModules.has('chat')) {
    return loadedModules.get('chat');
  }

  try {
    const chatModule = await import('../chat.js');
    loadedModules.set('chat', chatModule);
    console.log('[LazyLoader] Chat module loaded');
    return chatModule;
  } catch (error) {
    console.error('[LazyLoader] Failed to load chat module:', error);
    throw error;
  }
}

/**
 * Lazy load the presentation view component
 */
export async function loadPresentationModule() {
  if (loadedModules.has('presentation')) {
    return loadedModules.get('presentation');
  }

  try {
    const presentationModule = await import('../components/presentation.js');
    loadedModules.set('presentation', presentationModule);
    console.log('[LazyLoader] Presentation module loaded');
    return presentationModule;
  } catch (error) {
    console.error('[LazyLoader] Failed to load presentation module:', error);
    throw error;
  }
}

/**
 * Lazy load the itinerary/scene builder component
 */
export async function loadItineraryModule() {
  if (loadedModules.has('itinerary')) {
    return loadedModules.get('itinerary');
  }

  try {
    const itineraryModule = await import('../components/itinerary.js');
    loadedModules.set('itinerary', itineraryModule);
    console.log('[LazyLoader] Itinerary module loaded');
    return itineraryModule;
  } catch (error) {
    console.error('[LazyLoader] Failed to load itinerary module:', error);
    throw error;
  }
}

/**
 * Lazy load the calendar view component
 */
export async function loadCalendarModule() {
  if (loadedModules.has('calendar')) {
    return loadedModules.get('calendar');
  }

  try {
    const calendarModule = await import('../components/calendarView.js');
    loadedModules.set('calendar', calendarModule);
    console.log('[LazyLoader] Calendar module loaded');
    return calendarModule;
  } catch (error) {
    console.error('[LazyLoader] Failed to load calendar module:', error);
    throw error;
  }
}

/**
 * Lazy load third-party libraries
 */
export async function loadSortableJS() {
  if (loadedModules.has('sortable')) {
    return loadedModules.get('sortable');
  }

  try {
    // Load SortableJS from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';

    const loadPromise = new Promise((resolve, reject) => {
      script.onload = () => {
        loadedModules.set('sortable', window.Sortable);
        console.log('[LazyLoader] SortableJS loaded');
        resolve(window.Sortable);
      };
      script.onerror = reject;
    });

    document.head.appendChild(script);
    return await loadPromise;
  } catch (error) {
    console.error('[LazyLoader] Failed to load SortableJS:', error);
    throw error;
  }
}

/**
 * Lazy load Flatpickr date picker
 */
export async function loadFlatpickr() {
  if (loadedModules.has('flatpickr')) {
    return loadedModules.get('flatpickr');
  }

  try {
    // Load CSS first
    if (!document.querySelector('link[href*="flatpickr"]')) {
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
      document.head.appendChild(cssLink);
    }

    // Load JS
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';

    const loadPromise = new Promise((resolve, reject) => {
      script.onload = () => {
        loadedModules.set('flatpickr', window.flatpickr);
        console.log('[LazyLoader] Flatpickr loaded');
        resolve(window.flatpickr);
      };
      script.onerror = reject;
    });

    document.head.appendChild(script);
    return await loadPromise;
  } catch (error) {
    console.error('[LazyLoader] Failed to load Flatpickr:', error);
    throw error;
  }
}

/**
 * Preload modules in idle time
 */
export function preloadModules() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      console.log('[LazyLoader] Preloading modules during idle time...');
      // Preload less critical modules
      loadChatModule().catch(() => {});
      loadCalendarModule().catch(() => {});
    }, { timeout: 5000 });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      loadChatModule().catch(() => {});
      loadCalendarModule().catch(() => {});
    }, 3000);
  }
}
