// export.js
// This script runs during the Netlify build process.
// It reads all project files and creates a single text file.

const fs = require('fs');
const path = require('path');

// --- Configuration ---
const filesToExport = [
    'spec sheet',
    'main.js',
    'api.js',
    'ui.js',
    'state.js',
    'config.js',
    'index.html',
    'netlify.toml',
    'package.json',
    'netlify/functions/airtable.js'
];

const outputFileName = 'project_source.txt';

// --- Script Logic ---
async function exportProjectFiles() {
    let combinedContent = `Project Export - ${new Date().toISOString()}\n\n`;
    console.log('Starting project export for Netlify build...');

    for (const filePath of filesToExport) {
        try {
            // In the Netlify build environment, the path is relative to the repository root
            const fullPath = path.join(__dirname, filePath);
            const content = await fs.promises.readFile(fullPath, 'utf8');
            
            combinedContent += `\n\n============================================================\n`;
            combinedContent += `// FILE: ${filePath}\n`;
            combinedContent += `============================================================\n\n`;
            combinedContent += content;
            
            console.log(`Successfully added: ${filePath}`);
        } catch (error) {
            combinedContent += `\n\n// ERROR: Could not read file: ${filePath}\n\n`;
            console.error(`Error reading file ${filePath}:`, error.message);
        }
    }

    try {
        // The output file will be placed in the root of the deployed site
        await fs.promises.writeFile(outputFileName, combinedContent);
        console.log(`\n✅ Export successful! Created: ${outputFileName}`);
    } catch (error)
        console.error(`\n❌ Error writing to output file:`, error.message);
    }
}

exportProjectFiles();
