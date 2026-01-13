// Image optimization utility using Netlify Image CDN
// Provides optimized image URLs with automatic format conversion and sizing

// Device pixel ratio detection for responsive images
const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

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

  return `/.netlify/images?${params.toString()}`;
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
