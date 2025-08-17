// export.js
// A simple Node.js script to concatenate project files into a single text file
// and inject the content into index.html for easy review.

const fs = require('fs');
const path = require('path');

// --- Configuration ---
// Add the paths to all the files you want to include in the export.
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

const outputFileName = 'project_export.txt';
const mainHtmlFile = 'index.html';
const injectionPlaceholder = '';

// --- Helper Functions ---
function escapeHtml(text) {
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

// --- Script Logic ---
async function exportAndInject() {
    let combinedContent = `Project Export - ${new Date().toISOString()}\n\n`;
    console.log('Starting project export...');

    for (const filePath of filesToExport) {
        try {
            const fullPath = path.join(__dirname, filePath);
            const content = await fs.promises.readFile(fullPath, 'utf8');
            
            combinedContent += `\n\n============================================================\n`;
            combinedContent += `// FILE: ${filePath}\n`;
            combinedContent += `============================================================\n\n`;
            combinedContent += content;
            
            console.log(`Successfully added: ${filePath}`);

        } catch (error) {
            const errorMessage = `\n\n============================================================\n`;
            errorMessage += `// ERROR: Could not read file: ${filePath}\n`;
            errorMessage += `============================================================\n\n`;
            combinedContent += errorMessage;
            console.error(`Error reading file ${filePath}:`, error.message);
        }
    }

    try {
        await fs.promises.writeFile(outputFileName, combinedContent);
        console.log(`\n✅ Export successful! All files combined into: ${outputFileName}`);
    } catch (error) {
        console.error(`\n❌ Error writing to output file:`, error.message);
    }

    // --- New Injection Logic ---
    console.log(`\nInjecting source code into ${mainHtmlFile}...`);
    try {
        let htmlContent = await fs.promises.readFile(mainHtmlFile, 'utf8');
        
        if (htmlContent.includes(injectionPlaceholder)) {
            const escapedCode = escapeHtml(combinedContent);
            htmlContent = htmlContent.replace(injectionPlaceholder, escapedCode);
            
            await fs.promises.writeFile(mainHtmlFile, htmlContent);
            console.log(`✅ Successfully injected source code into ${mainHtmlFile}.`);
        } else {
            console.warn(`⚠️ Warning: Placeholder "${injectionPlaceholder}" not found in ${mainHtmlFile}. Skipping injection.`);
        }
    } catch (error) {
        console.error(`\n❌ Error injecting code into HTML:`, error.message);
    }
}

// Run the main function
exportAndInject();
