// Lazy module loader for performance optimization
// This utility handles dynamic imports for heavy, infrequently used modules

const loadedModules = new Map();
const loadingPromises = new Map();

/**
 * Generic lazy loader with deduplication and caching
 * @param {string} moduleName - Name of the module for caching
 * @param {Function} importFn - Function that returns the import promise
 * @returns {Promise} Resolved module
 */
async function lazyLoad(moduleName, importFn) {
  // Return cached module if available
  if (loadedModules.has(moduleName)) {
    return loadedModules.get(moduleName);
  }

  // Return existing loading promise to avoid duplicate requests
  if (loadingPromises.has(moduleName)) {
    return loadingPromises.get(moduleName);
  }

  // Create loading promise
  const loadPromise = importFn()
    .then(module => {
      loadedModules.set(moduleName, module);
      loadingPromises.delete(moduleName);
      console.log(`[LazyLoader] ${moduleName} module loaded`);
      return module;
    })
    .catch(error => {
      loadingPromises.delete(moduleName);
      console.error(`[LazyLoader] Failed to load ${moduleName} module:`, error);
      throw error;
    });

  loadingPromises.set(moduleName, loadPromise);
  return loadPromise;
}

/**
 * Lazy load the chat module when needed
 */
export async function loadChatModule() {
  return lazyLoad('chat', () => import('../chat.js'));
}

/**
 * Lazy load the presentation view component
 */
export async function loadPresentationModule() {
  return lazyLoad('presentation', () => import('../components/presentation.js'));
}

/**
 * Lazy load the itinerary/scene builder component
 */
export async function loadItineraryModule() {
  return lazyLoad('itinerary', () => import('../components/itinerary.js'));
}

/**
 * Lazy load the calendar view component
 */
export async function loadCalendarModule() {
  return lazyLoad('calendar', () => import('../components/calendarView.js'));
}

/**
 * Lazy load third-party libraries with timeout and retry
 */
export async function loadSortableJS() {
  if (loadedModules.has('sortable')) {
    return loadedModules.get('sortable');
  }

  if (loadingPromises.has('sortable')) {
    return loadingPromises.get('sortable');
  }

  const loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';
    script.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      script.remove();
      loadingPromises.delete('sortable');
      reject(new Error('SortableJS load timeout'));
    }, 10000);

    script.onload = () => {
      clearTimeout(timeout);
      loadedModules.set('sortable', window.Sortable);
      loadingPromises.delete('sortable');
      console.log('[LazyLoader] SortableJS loaded');
      resolve(window.Sortable);
    };

    script.onerror = () => {
      clearTimeout(timeout);
      loadingPromises.delete('sortable');
      reject(new Error('SortableJS failed to load'));
    };

    document.head.appendChild(script);
  });

  loadingPromises.set('sortable', loadPromise);
  return loadPromise;
}

/**
 * Lazy load Flatpickr date picker
 */
export async function loadFlatpickr() {
  if (loadedModules.has('flatpickr')) {
    return loadedModules.get('flatpickr');
  }

  if (loadingPromises.has('flatpickr')) {
    return loadingPromises.get('flatpickr');
  }

  const loadPromise = new Promise((resolve, reject) => {
    // Load CSS first
    if (!document.querySelector('link[href*="flatpickr"]')) {
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
      cssLink.crossOrigin = 'anonymous';
      document.head.appendChild(cssLink);
    }

    // Load JS
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';
    script.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      script.remove();
      loadingPromises.delete('flatpickr');
      reject(new Error('Flatpickr load timeout'));
    }, 10000);

    script.onload = () => {
      clearTimeout(timeout);
      loadedModules.set('flatpickr', window.flatpickr);
      loadingPromises.delete('flatpickr');
      console.log('[LazyLoader] Flatpickr loaded');
      resolve(window.flatpickr);
    };

    script.onerror = () => {
      clearTimeout(timeout);
      loadingPromises.delete('flatpickr');
      reject(new Error('Flatpickr failed to load'));
    };

    document.head.appendChild(script);
  });

  loadingPromises.set('flatpickr', loadPromise);
  return loadPromise;
}

/**
 * Preload modules in idle time for faster subsequent access
 */
export function preloadModules() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      console.log('[LazyLoader] Preloading modules during idle time...');
      // Preload less critical modules with lower priority
      loadChatModule().catch(() => {});
    }, { timeout: 5000 });

    // Preload calendar after a longer delay
    requestIdleCallback(() => {
      loadCalendarModule().catch(() => {});
    }, { timeout: 10000 });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      loadChatModule().catch(() => {});
    }, 3000);
    setTimeout(() => {
      loadCalendarModule().catch(() => {});
    }, 6000);
  }
}

/**
 * Check if a module is already loaded
 * @param {string} moduleName - Name of the module
 * @returns {boolean} Whether the module is loaded
 */
export function isModuleLoaded(moduleName) {
  return loadedModules.has(moduleName);
}

/**
 * Clear cached modules (useful for development/testing)
 */
export function clearModuleCache() {
  loadedModules.clear();
  loadingPromises.clear();
}
