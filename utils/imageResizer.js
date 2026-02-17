/**
 * Client-side image resizer for upload optimization.
 * Automatically resizes large images (especially from mobile cameras)
 * before uploading to reduce payload size and upload time.
 *
 * Uses the HTML5 Canvas API to downscale images that exceed the
 * maximum allowed dimensions while preserving aspect ratio.
 */

// Maximum dimension (width or height) for uploaded images.
// Modern phones shoot 12-50MP photos (4000-8000px+). 2048px is a
// reasonable ceiling: large enough for full-screen display on any
// device while keeping file sizes manageable for upload.
const MAX_DIMENSION = 2048;

// JPEG output quality (0-1). 0.85 provides a good balance between
// visual quality and file size.
const JPEG_QUALITY = 0.85;

// Maximum file size in bytes before resizing is attempted (5MB).
// Files under this threshold with dimensions under MAX_DIMENSION
// are passed through unchanged.
const SIZE_THRESHOLD = 5 * 1024 * 1024;

/**
 * Resize an image file if it exceeds the maximum dimensions or file size.
 * Returns a data URL (base64) of the processed image.
 *
 * If the image is already within limits, the original data URL is returned
 * without re-encoding, preserving the original format and quality.
 *
 * @param {File} file - The image File object from a file input
 * @returns {Promise<string>} A data URL string of the (possibly resized) image
 */
export async function resizeImageForUpload(file) {
    // Load the file into an Image element to get its natural dimensions
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);

    const needsResize = img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION;
    const isLargeFile = file.size > SIZE_THRESHOLD;

    // If the image is within dimension limits and not too large, return as-is
    if (!needsResize && !isLargeFile) {
        return dataUrl;
    }

    // Calculate new dimensions preserving aspect ratio
    let newWidth = img.naturalWidth;
    let newHeight = img.naturalHeight;

    if (needsResize) {
        if (newWidth > newHeight) {
            // Landscape
            newHeight = Math.round((MAX_DIMENSION / newWidth) * newHeight);
            newWidth = MAX_DIMENSION;
        } else {
            // Portrait or square
            newWidth = Math.round((MAX_DIMENSION / newHeight) * newWidth);
            newHeight = MAX_DIMENSION;
        }
    }

    // Draw onto a canvas at the target size
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, newWidth, newHeight);

    // Export as JPEG for consistent compression. PNG screenshots will
    // become JPEG too, which is acceptable for user-uploaded photos.
    const resizedDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    console.log(
        `[ImageResizer] Resized from ${img.naturalWidth}x${img.naturalHeight} to ${newWidth}x${newHeight}` +
        ` (${formatBytes(file.size)} → ~${formatBytes(resizedDataUrl.length * 0.75)})`
    );

    return resizedDataUrl;
}

/**
 * Read a File as a data URL using FileReader.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Load an Image element from a source URL.
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Format a byte count into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
