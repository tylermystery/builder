// netlify/functions/fetch-website-image.js
// Scrapes websites for Open Graph images, meta images, and favicons
// Returns the best available image URL for a given website

const fetch = require('node-fetch');

/**
 * Extracts the best image from HTML content
 * Priority: og:image > twitter:image > link[rel="image_src"] > first large image > favicon
 */
function extractImageFromHTML(html, baseUrl) {
    const results = {
        ogImage: null,
        twitterImage: null,
        linkImage: null,
        favicon: null,
        metaDescription: null
    };

    // Extract og:image
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImageMatch) {
        results.ogImage = resolveUrl(ogImageMatch[1], baseUrl);
    }

    // Extract twitter:image
    const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
    if (twitterImageMatch) {
        results.twitterImage = resolveUrl(twitterImageMatch[1], baseUrl);
    }

    // Extract link rel="image_src"
    const linkImageMatch = html.match(/<link[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
    if (linkImageMatch) {
        results.linkImage = resolveUrl(linkImageMatch[1], baseUrl);
    }

    // Extract favicon for last resort
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
    if (faviconMatch) {
        results.favicon = resolveUrl(faviconMatch[1], baseUrl);
    }

    // Extract og:description for context
    const descMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    if (descMatch) {
        results.metaDescription = descMatch[1];
    }

    return results;
}

/**
 * Resolves a potentially relative URL to an absolute URL
 */
function resolveUrl(url, baseUrl) {
    if (!url) return null;

    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    // Protocol-relative
    if (url.startsWith('//')) {
        return 'https:' + url;
    }

    try {
        const base = new URL(baseUrl);
        // Root-relative
        if (url.startsWith('/')) {
            return base.origin + url;
        }
        // Relative path
        return new URL(url, baseUrl).href;
    } catch (e) {
        console.error('[fetch-website-image] URL resolution error:', e.message);
        return null;
    }
}

/**
 * Validates if an image URL is likely valid and usable
 */
async function validateImageUrl(imageUrl, timeout = 5000) {
    if (!imageUrl) return false;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(imageUrl, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; WhatTheFunFinder/1.0)'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) return false;

        const contentType = response.headers.get('content-type') || '';
        return contentType.startsWith('image/');
    } catch (e) {
        console.log('[fetch-website-image] Image validation failed:', imageUrl, e.message);
        return false;
    }
}

/**
 * Tries to fetch an image from social media profiles
 */
function getSocialMediaImageUrls(businessName, websiteUrl) {
    const socialUrls = [];
    const encodedName = encodeURIComponent(businessName.toLowerCase().replace(/[^a-z0-9]+/g, ''));

    // Common social media profile patterns
    // These return avatar/profile images which can be useful

    // Try Facebook page (many businesses have these)
    socialUrls.push(`https://graph.facebook.com/${encodedName}/picture?type=large`);

    // Try a Google business image search pattern
    // Note: This is a heuristic and may not always work
    socialUrls.push(`https://logo.clearbit.com/${new URL(websiteUrl).hostname}`);

    return socialUrls;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { websiteUrl, businessName, imageKeywords } = JSON.parse(event.body);

        if (!websiteUrl && !businessName) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Either websiteUrl or businessName is required' })
            };
        }

        console.log(`[fetch-website-image] Processing request:`, { websiteUrl, businessName, imageKeywords });

        const result = {
            success: false,
            imageUrl: null,
            source: null,
            attempts: []
        };

        // Attempt 1: Scrape the business website for og:image
        if (websiteUrl) {
            try {
                console.log(`[fetch-website-image] Attempt 1: Fetching website ${websiteUrl}`);
                result.attempts.push({ method: 'website_scrape', url: websiteUrl, status: 'trying' });

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(websiteUrl, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const html = await response.text();
                    const images = extractImageFromHTML(html, websiteUrl);

                    console.log(`[fetch-website-image] Extracted images:`, images);

                    // Try images in priority order
                    const candidates = [
                        { url: images.ogImage, source: 'og:image' },
                        { url: images.twitterImage, source: 'twitter:image' },
                        { url: images.linkImage, source: 'link:image_src' }
                    ];

                    for (const candidate of candidates) {
                        if (candidate.url) {
                            const isValid = await validateImageUrl(candidate.url);
                            if (isValid) {
                                result.success = true;
                                result.imageUrl = candidate.url;
                                result.source = candidate.source;
                                result.attempts[result.attempts.length - 1].status = 'success';
                                result.attempts[result.attempts.length - 1].foundImage = candidate.source;

                                console.log(`[fetch-website-image] SUCCESS via ${candidate.source}:`, candidate.url);

                                return {
                                    statusCode: 200,
                                    body: JSON.stringify(result)
                                };
                            }
                        }
                    }

                    result.attempts[result.attempts.length - 1].status = 'no_valid_images';
                } else {
                    result.attempts[result.attempts.length - 1].status = `http_${response.status}`;
                }
            } catch (fetchError) {
                console.log(`[fetch-website-image] Website fetch failed:`, fetchError.message);
                result.attempts[result.attempts.length - 1].status = 'error';
                result.attempts[result.attempts.length - 1].error = fetchError.message;
            }
        }

        // Attempt 2: Try Clearbit Logo API (free, no auth required for basic usage)
        if (websiteUrl) {
            try {
                const hostname = new URL(websiteUrl).hostname.replace('www.', '');
                const clearbitUrl = `https://logo.clearbit.com/${hostname}`;

                console.log(`[fetch-website-image] Attempt 2: Trying Clearbit logo ${clearbitUrl}`);
                result.attempts.push({ method: 'clearbit_logo', url: clearbitUrl, status: 'trying' });

                const isValid = await validateImageUrl(clearbitUrl);
                if (isValid) {
                    result.success = true;
                    result.imageUrl = clearbitUrl;
                    result.source = 'clearbit_logo';
                    result.attempts[result.attempts.length - 1].status = 'success';

                    console.log(`[fetch-website-image] SUCCESS via Clearbit:`, clearbitUrl);

                    return {
                        statusCode: 200,
                        body: JSON.stringify(result)
                    };
                } else {
                    result.attempts[result.attempts.length - 1].status = 'not_found';
                }
            } catch (e) {
                result.attempts[result.attempts.length - 1].status = 'error';
            }
        }

        // Attempt 3: Try Google favicon service as last resort
        if (websiteUrl) {
            try {
                const hostname = new URL(websiteUrl).hostname;
                const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=256`;

                console.log(`[fetch-website-image] Attempt 3: Trying Google favicon ${googleFaviconUrl}`);
                result.attempts.push({ method: 'google_favicon', url: googleFaviconUrl, status: 'trying' });

                // Google favicons almost always work
                const isValid = await validateImageUrl(googleFaviconUrl);
                if (isValid) {
                    result.success = true;
                    result.imageUrl = googleFaviconUrl;
                    result.source = 'google_favicon';
                    result.attempts[result.attempts.length - 1].status = 'success';

                    console.log(`[fetch-website-image] SUCCESS via Google favicon:`, googleFaviconUrl);

                    return {
                        statusCode: 200,
                        body: JSON.stringify(result)
                    };
                } else {
                    result.attempts[result.attempts.length - 1].status = 'not_found';
                }
            } catch (e) {
                result.attempts[result.attempts.length - 1].status = 'error';
            }
        }

        // No image found through any method
        console.log(`[fetch-website-image] No image found for:`, { websiteUrl, businessName });

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('[fetch-website-image] Function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch website image: ' + error.message })
        };
    }
};
