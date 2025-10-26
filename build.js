// REPLACE THE ENTIRE CONTENTS of build.js with this corrected version:

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

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

// --- Airtable Configuration (Use Environment Variables in production/Netlify) ---
const AIRTABLE_PAT = process.env.AIRTABLE_PAT || 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57'; // Fallback for local testing if needed
const BASE_ID = process.env.BASE_ID || 'app5yTznb3R5YNUFw'; // Fallback for local testing if needed
const ITEMS_TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SHORTCUT_FIELD_NAME = 'Unique Page Shortcut Name'; // The exact field name
const STORES_FIELD_NAME = 'Stores'; // The exact field name for linked stores

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


// --- Text Export Function ---
function runTextExport(filePaths, timestamp) {
    const outputParts = [];
    outputParts.push(`Project Export - ${timestamp}\n`); // Corrected newline

    filePaths.forEach(relativePath => {
        try {
            console.log(`\t[Text Export] Adding file: ${relativePath}`);

            outputParts.push('============================================================');
            outputParts.push(`// FILE: ${relativePath}`);
            outputParts.push('============================================================');

            const content = fs.readFileSync(path.join(STARTING_DIRECTORY, relativePath), 'utf8');
            outputParts.push(content);
            outputParts.push('\n'); // Corrected newline

        } catch (error) {
            console.error(`❌ Error reading file ${relativePath} for text export:`, error.message);
            outputParts.push(`// ERROR: Could not read file: ${relativePath}`);
        }
    });

    const outputContent = outputParts.join('\n'); // Corrected newline
    const outputFileName = `project_source - ${timestamp}.txt`;
    fs.writeFileSync(outputFileName, outputContent);
    console.log(`\n✅ Text Build complete! Exported to: ${outputFileName} (in project root).`);
}

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
function generateAndWriteRedirects(shortcutItems) {
    console.log(`\n⚙️ Generating ${REDIRECTS_OUTPUT_FILE}...`);
    if (!shortcutItems || shortcutItems.length === 0) {
        console.log('⚠️ No shortcut items found, skipping redirects file generation.');
         try {
             fs.writeFileSync(REDIRECTS_OUTPUT_FILE, '# No redirects generated by build script\n'); // Corrected newline
         } catch (writeError) {
             console.error(`❌ Error writing empty redirects file: ${writeError.message}`);
         }
        return;
    }

    const redirectLines = [];
    let skippedCount = 0;
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

        redirectLines.push(`${sourcePath} ${destinationPath} ${statusCode}`);
    });

    if (redirectLines.length > 0) {
        // Corrected newline characters for the file content
        const fileContent = `# Netlify redirects generated by build.js\n# ${new Date().toISOString()}\n\n${redirectLines.join('\n')}\n`;
        try {
            fs.writeFileSync(REDIRECTS_OUTPUT_FILE, fileContent);
            console.log(`✅ Successfully wrote ${redirectLines.length} redirect rules to ${REDIRECTS_OUTPUT_FILE}.`);
            if (skippedCount > 0) {
                 console.log(`\tℹ️ Skipped ${skippedCount} items due to missing data.`);
            }
        } catch (error) {
            console.error(`❌ Error writing ${REDIRECTS_OUTPUT_FILE}: ${error.message}`);
        }
    } else {
         console.log(`⚠️ No valid redirect rules generated after filtering.`);
         try {
             fs.writeFileSync(REDIRECTS_OUTPUT_FILE, '# No valid redirects generated by build script\n'); // Corrected newline
         } catch (writeError) {
             console.error(`❌ Error writing empty redirects file: ${writeError.message}`);
         }
    }
}

// --- Main Build Function ---
async function buildSourceFile() {
    console.log('============================================================');
    console.log('🚀 Starting build process: Text, JSON, and Redirects...');
    console.log('============================================================');

    const timestamp = new Date().toISOString();
    const filePaths = getAllFiles(STARTING_DIRECTORY); // Ensure getAllFiles is defined above
    console.log(`\n➡️ Found ${filePaths.length} project files to include in exports.`);

    const shortcutItems = await fetchShortcutsFromAirtable();
    generateAndWriteRedirects(shortcutItems);
    runTextExport(filePaths, timestamp);
    runJsonExport(filePaths, timestamp);

    console.log('\n✨ All build steps completed successfully! ✨');
}

// Run the build process
buildSourceFile();
