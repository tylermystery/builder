/**
 * Build Script for WTFun
 *
 * This script handles:
 * 1. JavaScript bundling (via esbuild) - reduces HTTP requests and file sizes
 * 2. Airtable shortcut redirects generation
 * 3. Service worker cache version updates
 * 4. Project source exports (JSON/text)
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Configuration ---
const JSON_OUTPUT_FILE = 'project_source.json';
const DEPLOY_DIR = '.';
const IGNORE_LIST = [
    'node_modules',
    '.git',
    JSON_OUTPUT_FILE,
    'project_source' // Catch-all for old timestamped text exports.
];
const STARTING_DIRECTORY = '.';
const REDIRECTS_OUTPUT_FILE = '_redirects'; // Netlify redirects file name
const SITEMAP_OUTPUT_FILE = 'sitemap.xml'; // SEO sitemap file
const SITE_URL = 'https://whatthefun.net'; // Base URL for SEO assets

// --- Airtable Configuration (Use Environment Variables in production/Netlify) ---
const AIRTABLE_PAT = process.env.AIRTABLE_PAT || 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57'; // Fallback for local testing if needed
const BASE_ID = process.env.BASE_ID || 'app5yTznb3R5YNUFw'; // Fallback for local testing if needed
const ITEMS_TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SHORTCUT_FIELD_NAME = 'Unique Page Shortcut Name'; // The exact field name
const STORES_FIELD_NAME = 'Stores'; // The exact field name for linked stores

// --- SEO Configuration ---
const SEO_ITEM_TYPES = ['Event', 'Bookable Item', 'Grouping']; // Item types to include in SEO assets
const SEO_STATUS_FILTER = 'Available'; // Only include items with this status

// --- START: getAllFiles FUNCTION DEFINITION (Ensure this is present and before buildSourceFile) ---
/**
 * Recursively walks a directory to find all file paths.
 * @param {string} dirPath - The directory to start from.
 * @param {Array<string>} [arrayOfFiles] - Used for recursion.
 * @returns {Array<string>} A list of all relative file paths.
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        const relativePath = path.relative(STARTING_DIRECTORY, fullPath);

        if (IGNORE_LIST.some(ignored => relativePath.startsWith(ignored) || file === ignored)) {
            return;
        }

        try {
            if (fs.statSync(fullPath).isDirectory()) {
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            } else {
                arrayOfFiles.push(relativePath.replace(/\\\\/g, '/')); // Corrected backslash replace
            }
        } catch (error) {
            console.error(`❌ Error accessing file system for ${fullPath}:`, error.message);
        }
    });

    return arrayOfFiles;
}
// --- END: getAllFiles FUNCTION DEFINITION ---



// --- JSON Export Function ---
function runJsonExport(filePaths, timestamp) {
    const projectFiles = [];

    filePaths.forEach(relativePath => {
        try {
            console.log(`\t[JSON Export] Adding file: ${relativePath}`);
            const content = fs.readFileSync(path.join(STARTING_DIRECTORY, relativePath), 'utf8');

            projectFiles.push({
                path: relativePath,
                content: content
            });
        } catch (error) {
            console.error(`❌ Error reading file ${relativePath} for JSON export:`, error.message);
        }
    });

    const exportData = {
        metadata: {
            exportDate: timestamp,
            projectRoot: path.basename(process.cwd()),
            fileCount: projectFiles.length
        },
        files: projectFiles
    };

    try {
        const jsonContent = JSON.stringify(exportData, null, 2);
        const finalOutputPath = path.join(DEPLOY_DIR, JSON_OUTPUT_FILE);
        fs.writeFileSync(finalOutputPath, jsonContent);

        if (fs.existsSync(finalOutputPath)) {
             const fileSizeKB = (fs.statSync(finalOutputPath).size / 1024).toFixed(2);
             console.log(`\n✅ JSON Build complete! Exported to: ${finalOutputPath}.`);
             console.log(`File size: ${fileSizeKB} KB. This file should now be included in your Netlify deployment.`);
        } else {
             throw new Error(`Write failed: File ${finalOutputPath} does not exist after write operation.`);
        }

    } catch (error) {
        console.error(`\n❌ Error writing output file ${JSON_OUTPUT_FILE}: ${error.message}`);
    }
}

// --- Fetch Shortcuts Function ---
async function fetchShortcutsFromAirtable() {
    console.log(`\n🌀 Fetching shortcuts from Airtable...`);
    let allRecords = [];
    let offset = null;

    // --- THIS IS THE CORRECTED SECTION ---
    // Encode field names individually and construct the query string correctly
    const fieldsParams = [
        `fields[]=${encodeURIComponent(SHORTCUT_FIELD_NAME)}`,
        `fields[]=${encodeURIComponent(STORES_FIELD_NAME)}`
    ];
    const fieldsQueryString = fieldsParams.join('&');
    // --- END CORRECTED SECTION ---

    // Filter by records where the shortcut field is not empty
    const filter = encodeURIComponent(`NOT({${SHORTCUT_FIELD_NAME}} = BLANK())`);
    // Construct the base URL using the corrected fields query string
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE_ID}?${fieldsQueryString}&filterByFormula=${filter}`;

    try {
        do {
            let url = baseUrl;
            if (offset) {
                url += `&offset=${offset}`;
            }
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                console.error('Airtable Error fetching shortcuts:', errorData);
                throw new Error(`Failed to fetch shortcuts. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log(`✅ Found ${allRecords.length} items with shortcuts.`);
        return allRecords;
    } catch (error) {
        console.error('❌ Error fetching shortcut data:', error);
        return []; // Return empty array on error to avoid breaking the build
    }
}


// --- Generate Redirects Function ---
function generateAndWriteRedirects(shortcutItems, seoRedirectRules = []) {
    console.log(`\n⚙️ Generating ${REDIRECTS_OUTPUT_FILE}...`);

    const shortcutRedirectLines = [];
    let skippedCount = 0;

    // Process shortcut items
    if (shortcutItems && shortcutItems.length > 0) {
        shortcutItems.forEach(item => {
            const shortcut = item.fields[SHORTCUT_FIELD_NAME];
            const storeIds = item.fields[STORES_FIELD_NAME];

            if (!shortcut || typeof shortcut !== 'string' || !shortcut.trim()) {
                console.warn(`\t⚠️ Skipping item ID ${item.id}: Invalid or empty shortcut name.`);
                skippedCount++;
                return;
            }
            if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
                console.warn(`\t⚠️ Skipping shortcut '/${shortcut.trim()}' (Item ID ${item.id}): Item is not linked to any Stores.`);
                skippedCount++;
                return;
            }

            const firstStoreId = storeIds[0];
            const itemId = item.id;
            const sourcePath = `/${shortcut.trim()}`;
            const destinationPath = `/?shopId=${firstStoreId}&openItem=${itemId}`;
            const statusCode = 302;

            shortcutRedirectLines.push(`${sourcePath} ${destinationPath} ${statusCode}`);
        });
    }

    // Combine shortcut redirects with SEO redirects
    const totalRedirectCount = shortcutRedirectLines.length + seoRedirectRules.length;

    if (totalRedirectCount > 0) {
        // Build file content with sections
        let fileContent = `# Netlify redirects generated by build.js\n# ${new Date().toISOString()}\n`;

        // Add shortcut redirects section
        if (shortcutRedirectLines.length > 0) {
            fileContent += `\n# === Custom Shortcut Redirects (${shortcutRedirectLines.length}) ===\n`;
            fileContent += shortcutRedirectLines.join('\n') + '\n';
        }

        // Add SEO pretty URL redirects section
        if (seoRedirectRules.length > 0) {
            fileContent += `\n# === SEO Pretty URL Rewrites (${seoRedirectRules.length}) ===\n`;
            fileContent += `# These use 200 (rewrite) to keep the pretty URL in the browser\n`;
            fileContent += seoRedirectRules.join('\n') + '\n';
        }

        try {
            fs.writeFileSync(REDIRECTS_OUTPUT_FILE, fileContent);
            console.log(`✅ Successfully wrote ${totalRedirectCount} redirect rules to ${REDIRECTS_OUTPUT_FILE}.`);
            console.log(`   - Shortcut redirects: ${shortcutRedirectLines.length}`);
            console.log(`   - SEO pretty URL rewrites: ${seoRedirectRules.length}`);
            if (skippedCount > 0) {
                 console.log(`   ℹ️ Skipped ${skippedCount} shortcut items due to missing data.`);
            }
        } catch (error) {
            console.error(`❌ Error writing ${REDIRECTS_OUTPUT_FILE}: ${error.message}`);
        }
    } else {
         console.log(`⚠️ No redirect rules generated.`);
         try {
             fs.writeFileSync(REDIRECTS_OUTPUT_FILE, '# No redirects generated by build script\n');
         } catch (writeError) {
             console.error(`❌ Error writing empty redirects file: ${writeError.message}`);
         }
    }
}

// --- SEO Assets Generation Functions ---

/**
 * Generates a URL-friendly slug from a name string.
 * @param {string} name - The item name to convert to a slug.
 * @param {string} recordId - The Airtable record ID to append.
 * @returns {string} The generated slug (e.g., "sunset-boat-party-rec123").
 */
function generateSlug(name, recordId) {
    if (!name || typeof name !== 'string') {
        return recordId; // Fallback to just the record ID if no name
    }
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dashes
        .replace(/^-+|-+$/g, '')     // Remove leading/trailing dashes
        .substring(0, 60);           // Limit length for reasonable URLs

    return `${slug}-${recordId}`;
}

/**
 * Fetches all items from Airtable that should be included in SEO assets.
 * Only fetches items where Status is 'Available' and Item Type is in SEO_ITEM_TYPES.
 * Uses pagination to ensure all records are retrieved.
 * @returns {Promise<Array>} Array of Airtable records.
 */
async function fetchSeoItems() {
    console.log(`\n🔍 Fetching SEO items from Airtable...`);
    let allRecords = [];
    let offset = null;

    // Build the filter formula for Status = 'Available' AND Item Type is one of the allowed types
    const typeConditions = SEO_ITEM_TYPES.map(type => `{Item Type} = '${type}'`).join(', ');
    const filterFormula = `AND({Status} = '${SEO_STATUS_FILTER}', OR(${typeConditions}))`;
    const encodedFilter = encodeURIComponent(filterFormula);

    // Only fetch the fields we need for SEO: Name and the record ID (which comes automatically)
    const fieldsParams = [
        `fields[]=${encodeURIComponent('Name')}`,
        `fields[]=${encodeURIComponent('Item Type')}`,
        `fields[]=${encodeURIComponent('Status')}`
    ];
    const fieldsQueryString = fieldsParams.join('&');
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE_ID}?${fieldsQueryString}&filterByFormula=${encodedFilter}`;

    try {
        do {
            let url = baseUrl;
            if (offset) {
                url += `&offset=${offset}`;
            }
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                console.error('Airtable Error fetching SEO items:', errorData);
                throw new Error(`Failed to fetch SEO items. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log(`✅ Found ${allRecords.length} items for SEO assets.`);
        return allRecords;
    } catch (error) {
        console.error('❌ Error fetching SEO items:', error);
        return []; // Return empty array on error to avoid breaking the build
    }
}

/**
 * Generates an XML sitemap for the website.
 * @param {Array} seoItems - Array of Airtable records to include in sitemap.
 */
function generateSitemap(seoItems) {
    console.log(`\n📄 Generating ${SITEMAP_OUTPUT_FILE}...`);

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    let sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Homepage -->
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`;

    // Add each item as a URL entry
    seoItems.forEach(item => {
        const name = item.fields.Name || '';
        const slug = generateSlug(name, item.id);
        const url = `${SITE_URL}/item/${slug}`;

        sitemapXml += `  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
    });

    sitemapXml += `</urlset>`;

    try {
        fs.writeFileSync(SITEMAP_OUTPUT_FILE, sitemapXml);
        console.log(`✅ Successfully generated ${SITEMAP_OUTPUT_FILE} with ${seoItems.length + 1} URLs.`);
    } catch (error) {
        console.error(`❌ Error writing ${SITEMAP_OUTPUT_FILE}: ${error.message}`);
    }
}

/**
 * Generates SEO redirect rules for pretty URLs.
 * These are appended to the existing redirects from shortcuts.
 * @param {Array} seoItems - Array of Airtable records.
 * @returns {Array<string>} Array of redirect rule strings.
 */
function generateSeoRedirectRules(seoItems) {
    const redirectRules = [];

    seoItems.forEach(item => {
        const name = item.fields.Name || '';
        const slug = generateSlug(name, item.id);

        // Use 200 status (rewrite) so the URL bar stays pretty while SPA loads content
        // The path /item/slug-recXYZ will serve the content from /?openItem=recXYZ
        redirectRules.push(`/item/${slug}  /?openItem=${item.id}  200`);
    });

    return redirectRules;
}

/**
 * Main function to generate all SEO assets.
 * Fetches items and generates sitemap.xml and SEO redirect rules.
 * @returns {Promise<Array<string>>} SEO redirect rules to be appended to _redirects.
 */
async function generateSeoAssets() {
    console.log('\n🌐 Starting SEO asset generation...');

    // Fetch all items for SEO
    const seoItems = await fetchSeoItems();

    if (seoItems.length === 0) {
        console.log('⚠️ No SEO items found, skipping SEO asset generation.');
        return [];
    }

    // Generate sitemap.xml
    generateSitemap(seoItems);

    // Generate SEO redirect rules (to be appended to _redirects)
    const seoRedirectRules = generateSeoRedirectRules(seoItems);
    console.log(`✅ Generated ${seoRedirectRules.length} SEO redirect rules.`);

    return seoRedirectRules;
}

// --- JavaScript Bundling Function ---
async function runBundler() {
    console.log('\n📦 Running JavaScript bundler (esbuild)...');

    try {
        // Check if esbuild is available
        const esbuild = require('esbuild');
        const OUTPUT_DIR = 'dist';
        const isProduction = process.env.NODE_ENV === 'production' || process.env.CONTEXT === 'production';

        // Ensure output directory exists
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        const buildTimestamp = Date.now();
        const startTime = Date.now();

        // Bundle main application
        console.log('   Bundling main.js...');
        const mainResult = await esbuild.build({
            entryPoints: ['main.js'],
            bundle: true,
            outfile: path.join(OUTPUT_DIR, 'main.bundle.js'),
            format: 'esm',
            target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
            minify: isProduction,
            sourcemap: isProduction ? 'linked' : true, // Use linked sourcemaps in production (smaller)
            treeShaking: true,
            metafile: true,
            define: {
                'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            },
            // Drop console.log in production for smaller bundles and better performance
            drop: isProduction ? ['console', 'debugger'] : [],
            platform: 'browser',
            splitting: false,
            logLevel: 'warning',
            // Performance optimizations
            legalComments: isProduction ? 'none' : 'inline', // Remove license comments in production
            charset: 'utf8',
            // Optimize for modern browsers
            mangleProps: isProduction ? /^_/ : undefined, // Mangle private properties in production
        });

        const mainBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'main.bundle.js')).size;
        const mainInputFiles = Object.keys(mainResult.metafile.inputs).length;
        console.log(`   ✅ main.bundle.js: ${(mainBundleSize / 1024).toFixed(2)} KB (${mainInputFiles} modules bundled)`);

        // Bundle CRM dashboard
        console.log('   Bundling crm.js...');
        const crmResult = await esbuild.build({
            entryPoints: ['crm.js'],
            bundle: true,
            outfile: path.join(OUTPUT_DIR, 'crm.bundle.js'),
            format: 'esm',
            target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
            minify: isProduction,
            sourcemap: isProduction ? 'linked' : true,
            treeShaking: true,
            metafile: true,
            define: {
                'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            },
            // Drop console.log in production for smaller bundles and better performance
            drop: isProduction ? ['console', 'debugger'] : [],
            platform: 'browser',
            splitting: false,
            logLevel: 'warning',
            legalComments: isProduction ? 'none' : 'inline',
            charset: 'utf8',
        });

        const crmBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'crm.bundle.js')).size;
        console.log(`   ✅ crm.bundle.js: ${(crmBundleSize / 1024).toFixed(2)} KB`);

        // Bundle store dashboard if it exists
        if (fs.existsSync('store-dashboard.js')) {
            console.log('   Bundling store-dashboard.js...');
            await esbuild.build({
                entryPoints: ['store-dashboard.js'],
                bundle: true,
                outfile: path.join(OUTPUT_DIR, 'store-dashboard.bundle.js'),
                format: 'esm',
                target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
                minify: isProduction,
                sourcemap: isProduction ? 'linked' : true,
                treeShaking: true,
                define: {
                    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
                },
                // Drop console.log in production for smaller bundles and better performance
                drop: isProduction ? ['console', 'debugger'] : [],
                platform: 'browser',
                splitting: false,
                logLevel: 'warning',
                legalComments: isProduction ? 'none' : 'inline',
                charset: 'utf8',
            });
            const dashboardBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'store-dashboard.bundle.js')).size;
            console.log(`   ✅ store-dashboard.bundle.js: ${(dashboardBundleSize / 1024).toFixed(2)} KB`);
        }

        // Bundle teammate page if it exists
        if (fs.existsSync('teammate.js')) {
            console.log('   Bundling teammate.js...');
            await esbuild.build({
                entryPoints: ['teammate.js'],
                bundle: true,
                outfile: path.join(OUTPUT_DIR, 'teammate.bundle.js'),
                format: 'esm',
                target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
                minify: isProduction,
                sourcemap: isProduction ? 'linked' : true,
                treeShaking: true,
                define: {
                    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
                },
                // Drop console.log in production for smaller bundles and better performance
                drop: isProduction ? ['console', 'debugger'] : [],
                platform: 'browser',
                splitting: false,
                logLevel: 'warning',
                legalComments: isProduction ? 'none' : 'inline',
                charset: 'utf8',
            });
            const teammateBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'teammate.bundle.js')).size;
            console.log(`   ✅ teammate.bundle.js: ${(teammateBundleSize / 1024).toFixed(2)} KB`);
        }

        // Bundle eventHub if it exists
        if (fs.existsSync('eventHub.js')) {
            console.log('   Bundling eventHub.js...');
            await esbuild.build({
                entryPoints: ['eventHub.js'],
                bundle: true,
                outfile: path.join(OUTPUT_DIR, 'eventHub.bundle.js'),
                format: 'esm',
                target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
                minify: isProduction,
                sourcemap: isProduction ? 'linked' : true,
                treeShaking: true,
                define: {
                    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
                },
                // Drop console.log in production for smaller bundles and better performance
                drop: isProduction ? ['console', 'debugger'] : [],
                platform: 'browser',
                splitting: false,
                logLevel: 'warning',
                legalComments: isProduction ? 'none' : 'inline',
                charset: 'utf8',
            });
            const eventHubBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'eventHub.bundle.js')).size;
            console.log(`   ✅ eventHub.bundle.js: ${(eventHubBundleSize / 1024).toFixed(2)} KB`);
        }

        // Bundle invitee page if it exists
        if (fs.existsSync('invitee.js')) {
            console.log('   Bundling invitee.js...');
            await esbuild.build({
                entryPoints: ['invitee.js'],
                bundle: true,
                outfile: path.join(OUTPUT_DIR, 'invitee.bundle.js'),
                format: 'esm',
                target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
                minify: isProduction,
                sourcemap: isProduction ? 'linked' : true,
                treeShaking: true,
                define: {
                    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
                },
                drop: isProduction ? ['console', 'debugger'] : [],
                platform: 'browser',
                splitting: false,
                logLevel: 'warning',
                legalComments: isProduction ? 'none' : 'inline',
                charset: 'utf8',
            });
            const inviteeBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'invitee.bundle.js')).size;
            console.log(`   ✅ invitee.bundle.js: ${(inviteeBundleSize / 1024).toFixed(2)} KB`);
        }

        // Generate manifest for cache busting
        const manifest = {
            version: buildTimestamp,
            bundles: {
                main: `main.bundle.js?v=${buildTimestamp}`,
                crm: `crm.bundle.js?v=${buildTimestamp}`,
            },
            generated: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

        const endTime = Date.now();
        console.log(`   ⏱️  Bundling completed in ${endTime - startTime}ms`);

        return true;

    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
            console.log('   ⚠️ esbuild not found, skipping bundling step.');
            console.log('   Run "npm install" to enable JavaScript bundling.');
            return false;
        }
        console.error('   ❌ Bundling failed:', error.message);
        // Don't fail the entire build, just continue without bundling
        return false;
    }
}

// --- Generate Service Worker with Build Timestamp ---
function generateServiceWorker() {
    console.log('\n⚙️ Generating service-worker.js with build timestamp...');
    
    const buildTimestamp = Date.now();
    const serviceWorkerPath = path.join(STARTING_DIRECTORY, 'service-worker.js');
    
    try {
        let swContent = fs.readFileSync(serviceWorkerPath, 'utf8');
        
        // Replace the cache version with the build timestamp
        swContent = swContent.replace(
            /const CACHE_VERSION = 'v-' \+ Date\.now\(\);/,
            `const CACHE_VERSION = 'v-${buildTimestamp}';`
        );
        
        fs.writeFileSync(serviceWorkerPath, swContent);
        console.log(`✅ Service worker updated with cache version: v-${buildTimestamp}`);
    } catch (error) {
        console.error(`❌ Error updating service worker: ${error.message}`);
    }
}

// --- Main Build Function ---
async function buildSourceFile() {
    console.log('============================================================');
    console.log('🚀 Starting build process: Bundle, SEO, Redirects, Service Worker...');
    console.log('============================================================');

    const timestamp = new Date().toISOString();

    // Step 1: Run JavaScript bundler (esbuild)
    const bundleSuccess = await runBundler();

    // Step 2: Generate SEO assets (sitemap and redirect rules)
    const seoRedirectRules = await generateSeoAssets();

    // Step 3: Fetch shortcuts and generate combined redirects (shortcuts + SEO)
    const shortcutItems = await fetchShortcutsFromAirtable();
    generateAndWriteRedirects(shortcutItems, seoRedirectRules);

    // Step 4: Update service worker cache version
    generateServiceWorker();

    // Step 5: Generate project JSON export (for debugging/reference)
    const filePaths = getAllFiles(STARTING_DIRECTORY);
    console.log(`\n➡️ Found ${filePaths.length} project files to include in JSON export.`);
    runJsonExport(filePaths, timestamp);

    console.log('\n============================================================');
    console.log('✨ All build steps completed successfully! ✨');
    if (bundleSuccess) {
        console.log('   📦 JavaScript bundles ready in dist/');
    }
    console.log('   🌐 SEO assets generated (sitemap.xml + pretty URLs)');
    console.log('============================================================');
}

// Run the build process
buildSourceFile();
