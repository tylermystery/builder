// netlify/functions/scrape-website-photos.js
// Scrapes websites for multiple images - og:image, gallery images, social media images
// Returns an array of image URLs suitable for display

const fetch = require('node-fetch');

/**
 * Resolves a potentially relative URL to an absolute URL
 */
function resolveUrl(url, baseUrl) {
    if (!url) return null;

    // Clean the URL
    url = url.trim();

    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    // Data URLs - skip these
    if (url.startsWith('data:')) {
        return null;
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
        console.error('[scrape-website-photos] URL resolution error:', e.message);
        return null;
    }
}

/**
 * Extracts all potential images from HTML content
 */
function extractImagesFromHTML(html, baseUrl) {
    const images = [];
    const seenUrls = new Set();

    // Helper to add unique image
    const addImage = (url, source, priority) => {
        const resolved = resolveUrl(url, baseUrl);
        if (resolved && !seenUrls.has(resolved)) {
            seenUrls.add(resolved);
            images.push({ url: resolved, source, priority });
        }
    };

    // 1. Extract og:image (highest priority)
    const ogImageMatches = html.matchAll(/<meta[^>]*property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/gi);
    for (const match of ogImageMatches) {
        addImage(match[1], 'og:image', 1);
    }
    // Also try reversed attribute order
    const ogImageMatches2 = html.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image(?::url)?["']/gi);
    for (const match of ogImageMatches2) {
        addImage(match[1], 'og:image', 1);
    }

    // 2. Extract twitter:image
    const twitterMatches = html.matchAll(/<meta[^>]*name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/gi);
    for (const match of twitterMatches) {
        addImage(match[1], 'twitter:image', 2);
    }
    const twitterMatches2 = html.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/gi);
    for (const match of twitterMatches2) {
        addImage(match[1], 'twitter:image', 2);
    }

    // 3. Extract structured data images (JSON-LD)
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
        try {
            const jsonData = JSON.parse(match[1]);
            const extractJsonImages = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) {
                    obj.forEach(item => extractJsonImages(item));
                    return;
                }
                if (obj.image) {
                    if (typeof obj.image === 'string') {
                        addImage(obj.image, 'json-ld', 3);
                    } else if (Array.isArray(obj.image)) {
                        obj.image.forEach(img => {
                            if (typeof img === 'string') addImage(img, 'json-ld', 3);
                            else if (img.url) addImage(img.url, 'json-ld', 3);
                        });
                    } else if (obj.image.url) {
                        addImage(obj.image.url, 'json-ld', 3);
                    }
                }
                if (obj.photo) {
                    if (typeof obj.photo === 'string') addImage(obj.photo, 'json-ld', 3);
                    else if (obj.photo.url) addImage(obj.photo.url, 'json-ld', 3);
                }
                Object.values(obj).forEach(val => extractJsonImages(val));
            };
            extractJsonImages(jsonData);
        } catch (e) {
            // JSON parse failed, skip
        }
    }

    // 4. Extract large images from img tags (likely content images)
    // Look for images with width/height attributes or in galleries
    const imgMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    for (const match of imgMatches) {
        const imgTag = match[0];
        const src = match[1];

        // Skip small images, icons, tracking pixels
        if (src.includes('icon') || src.includes('logo') || src.includes('pixel') ||
            src.includes('tracking') || src.includes('avatar') || src.includes('badge') ||
            src.includes('1x1') || src.includes('spacer') || src.includes('.gif') ||
            src.includes('button') || src.includes('sprite')) {
            continue;
        }

        // Check for size indicators suggesting larger images
        const widthMatch = imgTag.match(/width=["']?(\d+)/i);
        const heightMatch = imgTag.match(/height=["']?(\d+)/i);
        const width = widthMatch ? parseInt(widthMatch[1]) : 0;
        const height = heightMatch ? parseInt(heightMatch[1]) : 0;

        // Only include if it seems like a content image (large enough or no size specified)
        if ((width === 0 && height === 0) || (width >= 200 || height >= 200)) {
            // Higher priority for gallery/slider images
            const isGallery = imgTag.includes('gallery') || imgTag.includes('slider') ||
                              imgTag.includes('carousel') || imgTag.includes('hero');
            addImage(src, 'img-tag', isGallery ? 4 : 5);
        }
    }

    // 5. Extract images from srcset attributes
    const srcsetMatches = html.matchAll(/srcset=["']([^"']+)["']/gi);
    for (const match of srcsetMatches) {
        const srcset = match[1];
        // Parse srcset - format is "url1 size1, url2 size2"
        const sources = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
        sources.forEach(src => {
            if (src && !src.includes('icon') && !src.includes('logo')) {
                addImage(src, 'srcset', 6);
            }
        });
    }

    // 6. Extract background images from inline styles
    const bgMatches = html.matchAll(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/gi);
    for (const match of bgMatches) {
        const url = match[1];
        if (!url.includes('gradient') && !url.includes('data:')) {
            addImage(url, 'background-image', 7);
        }
    }

    // Sort by priority and return
    return images.sort((a, b) => a.priority - b.priority);
}

/**
 * Validates if an image URL is likely valid and returns its content-type
 */
async function validateImageUrl(imageUrl, timeout = 5000) {
    if (!imageUrl) return { valid: false };

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

        if (!response.ok) return { valid: false };

        const contentType = response.headers.get('content-type') || '';
        const contentLength = parseInt(response.headers.get('content-length') || '0');

        // Must be an image type and at least 5KB (to filter out placeholder images)
        const isImage = contentType.startsWith('image/');
        const isLargeEnough = contentLength === 0 || contentLength > 5000;

        return {
            valid: isImage && isLargeEnough,
            contentType,
            contentLength
        };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

/**
 * Generates potential social media profile image URLs
 */
function getSocialMediaUrls(businessName, websiteUrl) {
    const urls = [];

    if (!businessName && !websiteUrl) return urls;

    // Extract domain for Clearbit
    if (websiteUrl) {
        try {
            const hostname = new URL(websiteUrl).hostname.replace('www.', '');
            urls.push({
                url: `https://logo.clearbit.com/${hostname}`,
                source: 'clearbit-logo',
                priority: 8
            });
        } catch (e) {
            // Invalid URL
        }
    }

    return urls;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { websiteUrl, businessName, maxImages = 10 } = JSON.parse(event.body);

        if (!websiteUrl) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'websiteUrl is required' })
            };
        }

        console.log(`[scrape-website-photos] Scraping: ${websiteUrl} for business: ${businessName}`);

        const result = {
            success: false,
            images: [],
            sources: {},
            websiteUrl
        };

        // Step 1: Fetch and parse the website
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

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
                const extractedImages = extractImagesFromHTML(html, websiteUrl);

                console.log(`[scrape-website-photos] Extracted ${extractedImages.length} potential images`);

                // Add social media URLs
                const socialUrls = getSocialMediaUrls(businessName, websiteUrl);
                extractedImages.push(...socialUrls);

                // Validate images in parallel (limit to first 20 candidates for performance)
                const candidates = extractedImages.slice(0, 20);
                const validationPromises = candidates.map(async (img) => {
                    const validation = await validateImageUrl(img.url);
                    return { ...img, ...validation };
                });

                const validatedImages = await Promise.all(validationPromises);

                // Filter to valid images and deduplicate
                const seenUrls = new Set();
                for (const img of validatedImages) {
                    if (img.valid && !seenUrls.has(img.url) && result.images.length < maxImages) {
                        seenUrls.add(img.url);
                        result.images.push({
                            url: img.url,
                            source: img.source
                        });
                        result.sources[img.source] = (result.sources[img.source] || 0) + 1;
                    }
                }

                result.success = result.images.length > 0;

                console.log(`[scrape-website-photos] Found ${result.images.length} valid images:`,
                    result.images.map(i => `${i.source}: ${i.url.substring(0, 50)}...`));
            } else {
                console.log(`[scrape-website-photos] Website returned ${response.status}`);
            }
        } catch (fetchError) {
            console.error(`[scrape-website-photos] Fetch error:`, fetchError.message);
        }

        // If no images found from website, try social media fallbacks
        if (result.images.length === 0) {
            const socialUrls = getSocialMediaUrls(businessName, websiteUrl);
            for (const social of socialUrls) {
                const validation = await validateImageUrl(social.url);
                if (validation.valid) {
                    result.images.push({
                        url: social.url,
                        source: social.source
                    });
                    result.sources[social.source] = 1;
                    result.success = true;
                    break;
                }
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('[scrape-website-photos] Function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to scrape website photos: ' + error.message })
        };
    }
};
