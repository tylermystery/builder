const fs = require('fs');
const path = require('path');

// --- Configuration ---
// Directories and files to exclude from the export.
// We must exclude the output files themselves to avoid infinite recursion.
const JSON_OUTPUT_FILE = 'project_source.json';
const IGNORE_LIST = [
    'node_modules',
    '.git',
    'build.js',             // Excludes this script itself.
    JSON_OUTPUT_FILE,       // Excludes the structured JSON output.
    'project_source'        // Catch-all for old timestamped text exports.
];
const STARTING_DIRECTORY = '.'; // Start from the current directory.

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

        // Check if the current file/directory name is in our ignore list, 
        // or if the path starts with an ignored item (e.g., 'node_modules/...')
        if (IGNORE_LIST.some(ignored => relativePath.startsWith(ignored) || file === ignored)) {
            return;
        }

        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            // Only add the relative path, replacing Windows backslashes with forward slashes
            arrayOfFiles.push(relativePath.replace(/\\/g, '/'));
        }
    });

    return arrayOfFiles;
}

/**
 * Executes the text export, using the old delimited format.
 * @param {Array<string>} filePaths - List of relative file paths to export.
 * @param {string} timestamp - Current ISO timestamp.
 */
function runTextExport(filePaths, timestamp) {
    const outputParts = [];
    outputParts.push(`Project Export - ${timestamp}\n`);
    
    filePaths.forEach(relativePath => {
        try {
            console.log(`\t[Text Export] Adding file: ${relativePath}`);
            
            // Text format separators
            outputParts.push('============================================================');
            outputParts.push(`// FILE: ${relativePath}`);
            outputParts.push('============================================================');

            const content = fs.readFileSync(path.join(STARTING_DIRECTORY, relativePath), 'utf8');
            outputParts.push(content);
            outputParts.push('\n'); 

        } catch (error) {
            console.error(`❌ Error reading file ${relativePath} for text export:`, error.message);
            outputParts.push(`// ERROR: Could not read file: ${relativePath}`);
        }
    });

    const outputContent = outputParts.join('\n');
    const outputFileName = `project_source - ${timestamp}.txt`;
    fs.writeFileSync(outputFileName, outputContent);
    console.log(`\n✅ Text Build complete! Exported to: ${outputFileName}`);
}

/**
 * Executes the JSON export, using the new structured format.
 * @param {Array<string>} filePaths - List of relative file paths to export.
 * @param {string} timestamp - Current ISO timestamp.
 */
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
        fs.writeFileSync(JSON_OUTPUT_FILE, jsonContent);
        console.log(`\n✅ JSON Build complete! Exported to: ${JSON_OUTPUT_FILE}`);
        console.log(`This file is ready for use by your automated workflow.`);
    } catch (error) {
        console.error(`\n❌ Error writing output file ${JSON_OUTPUT_FILE}: ${error.message}`);
    }
}


// --- Main function to build the source file ---
function buildSourceFile() {
    console.log('============================================================');
    console.log('🚀 Starting build process with both Text and JSON exports...');
    console.log('============================================================');
    
    const timestamp = new Date().toISOString();
    
    // Get the dynamic list of all files in the project.
    const filePaths = getAllFiles(STARTING_DIRECTORY);
    console.log(`\n➡️ Found ${filePaths.length} project files to include in exports.`);

    // 1. Run the old Text Export
    runTextExport(filePaths, timestamp);

    // 2. Run the new JSON Export (the standardized output for deployment)
    runJsonExport(filePaths, timestamp);
    
    console.log('\n✨ All exports completed successfully! ✨');
}

// Run the build process
buildSourceFile();
