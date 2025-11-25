// Image optimization utility using Netlify Image CDN
// Provides optimized image URLs with automatic format conversion and sizing

/**
 * Convert a Cloudinary or external image URL to use Netlify Image CDN
 * @param {string} imageUrl - The original image URL
 * @param {Object} options - Transformation options
 * @param {number} options.width - Target width in pixels
 * @param {number} options.height - Target height in pixels
 * @param {string} options.fit - How to fit image: 'contain', 'cover', 'fill'
 * @param {string} options.format - Output format: 'avif', 'webp', 'jpg', 'png', 'auto'
 * @param {number} options.quality - Quality 1-100 (default 75)
 * @returns {string} Optimized image URL via Netlify Image CDN
 */
export function optimizeImageUrl(imageUrl, options = {}) {
  if (!imageUrl) return imageUrl;

  // Skip if already using Netlify Image CDN
  if (imageUrl.includes('/.netlify/images')) {
    return imageUrl;
  }

  // Build query parameters
  const params = new URLSearchParams();
  params.set('url', imageUrl);

  if (options.width) params.set('w', options.width);
  if (options.height) params.set('h', options.height);
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
export function getResponsiveSrcset(imageUrl, widths = [320, 640, 960, 1280], options = {}) {
  if (!imageUrl) return '';

  return widths.map(width => {
    const url = optimizeImageUrl(imageUrl, { ...options, width });
    return `${url} ${width}w`;
  }).join(', ');
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
  return optimizeImageUrl(imageUrl, { format: 'blurhash', width: 32, height: 32 });
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
