// Image optimization utility using Netlify Image CDN
// Provides optimized image URLs with automatic format conversion and sizing

// Device pixel ratio detection for responsive images
const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

// Cache for optimized URLs to avoid regenerating the same URLs repeatedly
const imageUrlCache = new Map();
const MAX_CACHE_SIZE = 500;

// Supported image formats for Netlify Image CDN
const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
// Unsupported formats that should use Cloudinary transformations instead
const UNSUPPORTED_FORMATS = ['.heic', '.heif', '.mov', '.mp4', '.avi', '.webm', '.raw', '.tiff', '.tif', '.bmp'];

/**
 * Check if the image format is supported by Netlify Image CDN
 * @param {string} url - The image URL to check
 * @returns {boolean} True if format is supported
 */
export function isSupportedImageFormat(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  // Check for video URLs (cloudinary video path)
  if (lowerUrl.includes('/video/upload/')) return false;
  // Check file extension
  const extension = lowerUrl.match(/\.[a-z0-9]+(?:\?|$)/i)?.[0]?.replace('?', '') || '';
  if (UNSUPPORTED_FORMATS.includes(extension)) return false;
  return true;
}

/**
 * Check if a Cloudinary URL already has transformations
 * @param {string} url - The Cloudinary URL to check
 * @returns {boolean} True if transformations exist
 */
export function hasCloudinaryTransformations(url) {
  if (!url || !url.includes('/upload/')) return false;
  const uploadIndex = url.indexOf('/upload/');
  const afterUpload = url.slice(uploadIndex + 8);
  // Cloudinary transformation patterns start with letter_value (e.g., c_fill, w_600)
  return /^[a-z]_[^/]+/.test(afterUpload);
}

/**
 * Apply Cloudinary transformations to a URL, avoiding duplicates
 * @param {string} url - The Cloudinary URL
 * @param {string} transformations - The transformations to apply (e.g., "c_fill,w_300")
 * @returns {string} URL with transformations applied
 */
export function applyCloudinaryTransform(url, transformations) {
  if (!url || !url.includes('cloudinary') || !url.includes('/upload/')) return url;

  const uploadIndex = url.indexOf('/upload/');

  // Check if URL already has transformations
  if (hasCloudinaryTransformations(url)) {
    // Prepend new transformations before existing ones (Cloudinary chains transformations)
    return url.slice(0, uploadIndex + 8) + transformations + '/' + url.slice(uploadIndex + 8);
  }

  // No existing transformations, add them normally
  return url.slice(0, uploadIndex + 8) + transformations + '/' + url.slice(uploadIndex + 8);
}

/**
 * Get the base Cloudinary URL without any transformations
 * Useful for passing clean URLs to Netlify Image CDN
 * @param {string} url - The Cloudinary URL
 * @returns {string} Base URL without transformations
 */
export function getBaseCloudinaryUrl(url) {
  if (!url || !url.includes('cloudinary') || !url.includes('/upload/')) return url;

  const uploadIndex = url.indexOf('/upload/');
  const afterUpload = url.slice(uploadIndex + 8);

  // Check if there are transformations
  if (/^[a-z]_[^/]+/.test(afterUpload)) {
    // Find where the actual filename starts (after all transformation segments)
    // Cloudinary transformations are separated by / and the last segment before version (v123...) or filename is the last transform
    const segments = afterUpload.split('/');
    let filenameStartIndex = 0;

    for (let i = 0; i < segments.length; i++) {
      // Check if this segment looks like a transformation (starts with letter_something)
      if (/^[a-z]_/.test(segments[i]) || /^[a-z]:[^/]+/.test(segments[i])) {
        filenameStartIndex = i + 1;
      } else {
        break;
      }
    }

    // Reconstruct URL with base and filename parts only
    const baseUrl = url.slice(0, uploadIndex + 8);
    const filenamePart = segments.slice(filenameStartIndex).join('/');
    return baseUrl + filenamePart;
  }

  return url;
}

/**
 * Convert a Cloudinary or external image URL to use Netlify Image CDN
 * @param {string} imageUrl - The original image URL
 * @param {Object} options - Transformation options
 * @param {number} options.width - Target width in pixels
 * @param {number} options.height - Target height in pixels
 * @param {string} options.fit - How to fit image: 'contain', 'cover', 'fill'
 * @param {string} options.format - Output format: 'avif', 'webp', 'jpg', 'png', 'auto'
 * @param {number} options.quality - Quality 1-100 (default 75)
 * @param {boolean} options.useDPR - Whether to multiply dimensions by device pixel ratio (default true)
 * @returns {string} Optimized image URL via Netlify Image CDN
 */
export function optimizeImageUrl(imageUrl, options = {}) {
  if (!imageUrl) return imageUrl;

  // Skip if already using Netlify Image CDN
  if (imageUrl.includes('/.netlify/images')) {
    return imageUrl;
  }

  // Generate cache key
  const cacheKey = `${imageUrl}|${JSON.stringify(options)}`;

  // Check cache first
  if (imageUrlCache.has(cacheKey)) {
    return imageUrlCache.get(cacheKey);
  }

  // Check if format is supported by Netlify Image CDN
  if (!isSupportedImageFormat(imageUrl)) {
    // Fall back to Cloudinary transformations for unsupported formats
    if (imageUrl.includes('res.cloudinary.com')) {
      const width = options.width || 400;
      const result = applyCloudinaryTransform(imageUrl, `f_auto,q_auto,w_${width},c_limit`);
      cacheResult(cacheKey, result);
      return result;
    }
    // Return original URL for other unsupported formats
    return imageUrl;
  }

  // For Cloudinary URLs, get the base URL without transformations to avoid double-transforming
  let cleanUrl = imageUrl;
  if (imageUrl.includes('res.cloudinary.com') && hasCloudinaryTransformations(imageUrl)) {
    cleanUrl = getBaseCloudinaryUrl(imageUrl);
  }

  // Build query parameters
  const params = new URLSearchParams();
  params.set('url', cleanUrl);

  // Apply DPR scaling for sharper images on high-res displays
  const useDPR = options.useDPR !== false;
  const scaleFactor = useDPR ? DPR : 1;

  if (options.width) params.set('w', Math.round(options.width * scaleFactor));
  if (options.height) params.set('h', Math.round(options.height * scaleFactor));
  if (options.fit) params.set('fit', options.fit);
  if (options.format) params.set('fm', options.format);
  if (options.quality) params.set('q', options.quality);

  const result = `/.netlify/images?${params.toString()}`;
  cacheResult(cacheKey, result);
  return result;
}

/**
 * Helper to cache results with size limit
 */
function cacheResult(key, value) {
  // Evict oldest entries if cache is full
  if (imageUrlCache.size >= MAX_CACHE_SIZE) {
    const firstKey = imageUrlCache.keys().next().value;
    imageUrlCache.delete(firstKey);
  }
  imageUrlCache.set(key, value);
}

/**
 * Get responsive image srcset using Netlify Image CDN
 * @param {string} imageUrl - The original image URL
 * @param {number[]} widths - Array of widths for srcset
 * @param {Object} options - Additional options (format, quality, fit)
 * @returns {string} srcset string for responsive images
 */
export function getResponsiveSrcset(imageUrl, widths = [320, 640, 960, 1280, 1920], options = {}) {
  if (!imageUrl) return '';

  return widths.map(width => {
    const url = optimizeImageUrl(imageUrl, { ...options, width, useDPR: false });
    return `${url} ${width}w`;
  }).join(', ');
}

/**
 * Get sizes attribute for responsive images
 * @param {Object} breakpoints - Breakpoint configuration
 * @returns {string} sizes attribute value
 */
export function getResponsiveSizes(breakpoints = {}) {
  const defaults = {
    mobile: '100vw',
    tablet: '50vw',
    desktop: '33vw',
    mobileMax: 768,
    tabletMax: 1024
  };
  const config = { ...defaults, ...breakpoints };

  return `(max-width: ${config.mobileMax}px) ${config.mobile}, (max-width: ${config.tabletMax}px) ${config.tablet}, ${config.desktop}`;
}

/**
 * Preload critical images using link preload
 * @param {string[]} imageUrls - Array of image URLs to preload
 * @param {Object} options - Optimization options
 */
export function preloadCriticalImages(imageUrls, options = {}) {
  const head = document.head;

  imageUrls.forEach(url => {
    const optimizedUrl = optimizeImageUrl(url, {
      width: options.width || 400,
      format: 'webp',
      quality: 80,
      ...options
    });

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = optimizedUrl;
    link.type = 'image/webp';
    link.fetchPriority = 'high';
    head.appendChild(link);
  });
}

/**
 * Generate a blurhash placeholder URL
 * @param {string} imageUrl - The original image URL
 * @returns {string} Blurhash placeholder URL
 */
export function getBlurhashPlaceholder(imageUrl) {
  if (!imageUrl) return '';
  return optimizeImageUrl(imageUrl, { format: 'blurhash', width: 32, height: 32, useDPR: false });
}

/**
 * Check if we should use Netlify Image CDN for this URL
 * @param {string} imageUrl - The image URL to check
 * @returns {boolean} Whether to use Netlify Image CDN
 */
export function shouldUseNetlifyImageCDN(imageUrl) {
  if (!imageUrl) return false;

  // Check if format is supported
  if (!isSupportedImageFormat(imageUrl)) return false;

  // Use for Cloudinary images
  if (imageUrl.includes('res.cloudinary.com')) return true;

  // Use for local images
  if (imageUrl.startsWith('/') && !imageUrl.startsWith('//')) return true;

  return false;
}

/**
 * Create an optimized image element with lazy loading and responsive attributes
 * @param {string} imageUrl - The original image URL
 * @param {Object} options - Configuration options
 * @returns {HTMLImageElement} Configured image element
 */
export function createOptimizedImage(imageUrl, options = {}) {
  const {
    alt = '',
    width = 400,
    height,
    className = '',
    loading = 'lazy',
    decoding = 'async',
    fetchPriority,
    sizes,
    widths = [320, 640, 960, 1280]
  } = options;

  const img = document.createElement('img');

  // Set optimized src
  img.src = optimizeImageUrl(imageUrl, { width, height, format: 'webp', quality: 80 });

  // Add srcset for responsive images
  if (shouldUseNetlifyImageCDN(imageUrl)) {
    img.srcset = getResponsiveSrcset(imageUrl, widths, { format: 'webp', quality: 80 });
    img.sizes = sizes || getResponsiveSizes();
  }

  // Set attributes
  img.alt = alt;
  if (className) img.className = className;
  img.loading = loading;
  img.decoding = decoding;
  if (fetchPriority) img.fetchPriority = fetchPriority;

  // Add width and height to prevent layout shift
  if (width) img.width = width;
  if (height) img.height = height;

  return img;
}

/**
 * Prefetch images that will likely be needed soon
 * @param {string[]} imageUrls - Array of image URLs to prefetch
 */
export function prefetchImages(imageUrls) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      imageUrls.forEach(url => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'image';
        link.href = optimizeImageUrl(url, { width: 400, format: 'webp', quality: 75 });
        document.head.appendChild(link);
      });
    }, { timeout: 3000 });
  }
}

// Default placeholder images for fallback scenarios
// Using a simple gray gradient as data URI (no external files needed)
const PLACEHOLDER_DATA_URI = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23f0f0f0" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-family="system-ui" font-size="16"%3EImage unavailable%3C/text%3E%3C/svg%3E';

const DEFAULT_PLACEHOLDERS = {
  card: PLACEHOLDER_DATA_URI,
  avatar: PLACEHOLDER_DATA_URI,
  thumbnail: PLACEHOLDER_DATA_URI,
  default: PLACEHOLDER_DATA_URI
};

/**
 * Handle image load error with intelligent fallback
 * @param {HTMLImageElement} img - The image element that failed to load
 * @param {Object} options - Fallback options
 * @param {string} options.originalUrl - The original image URL before optimization
 * @param {string} options.type - Type of image for placeholder selection: 'card', 'avatar', 'thumbnail', 'default'
 * @param {string} options.fallbackUrl - Custom fallback URL to try before placeholder
 * @param {Function} options.onFallback - Callback when fallback is used
 */
export function handleImageError(img, options = {}) {
  const { originalUrl, type = 'default', fallbackUrl, onFallback } = options;

  // Track retry attempts to prevent infinite loops
  const retryCount = parseInt(img.dataset.retryCount || '0', 10);

  if (retryCount === 0 && originalUrl) {
    // First retry: try the original URL without optimization
    img.dataset.retryCount = '1';
    img.src = originalUrl;
    return;
  }

  if (retryCount === 1 && fallbackUrl) {
    // Second retry: try custom fallback URL
    img.dataset.retryCount = '2';
    img.src = fallbackUrl;
    return;
  }

  // Final fallback: use placeholder
  img.dataset.retryCount = '3';
  const placeholder = DEFAULT_PLACEHOLDERS[type] || DEFAULT_PLACEHOLDERS.default;
  img.src = placeholder;

  // Add visual indicator that this is a placeholder
  img.classList.add('image-fallback');

  if (onFallback) {
    onFallback(img, originalUrl);
  }
}

/**
 * Attach error handler to an image element with fallback support
 * @param {HTMLImageElement} img - The image element
 * @param {string} originalUrl - The original image URL before optimization
 * @param {Object} options - Additional options for handleImageError
 */
export function attachImageErrorHandler(img, originalUrl, options = {}) {
  img.onerror = () => handleImageError(img, { originalUrl, ...options });
}
