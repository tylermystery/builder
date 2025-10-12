const fs = require('fs');
const path = require('path');

// --- Configuration ---
// The name of the standardized JSON output file.
const JSON_OUTPUT_FILE = 'project_source.json';
// The directory that Netlify is configured to deploy from (e.g., 'dist', 'build').
const DEPLOY_DIR = 'dist';
// Directories and files to exclude from the project source export.
const IGNORE_LIST = [
    'node_modules',
    '.git',
    // We explicitly exclude the deployment directory itself to prevent infinite recursion
    // and to ensure the source file only contains development source, not build output.
    DEPLOY_DIR, 
    // We also exclude the specific output file names just in case they land in the root.
    JSON_OUTPUT_FILE,
    'project_source' // Catch-all for old timestamped text exports.
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

        try {
            if (fs.statSync(fullPath).isDirectory()) {
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            } else {
                // Only add the relative path, replacing Windows backslashes with forward slashes
                arrayOfFiles.push(relativePath.replace(/\\/g, '/'));
            }
        } catch (error) {
            console.error(`❌ Error accessing file system for ${fullPath}:`, error.message);
        }
    });

    return arrayOfFiles;
}

/**
 * Executes the text export, using the old delimited format (for legacy/debugging).
 * NOTE: This output remains in the root to avoid cluttering the deployment folder 
 * with timestamped debug files.
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
    console.log(`\n✅ Text Build complete! Exported to: ${outputFileName} (in project root).`);
}

/**
 * Executes the JSON export, using the new structured format for the CI/CD workflow.
 * The output is written to the DEPLOY_DIR so Netlify publishes it.
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
        
        // --- CORRECTED OUTPUT PATH ---
        const finalOutputPath = path.join(DEPLOY_DIR, JSON_OUTPUT_FILE);
        fs.writeFileSync(finalOutputPath, jsonContent);
        
        // Verification step to ensure the file was written successfully
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


// --- Main function to build the source file ---
function buildSourceFile() {
    console.log('============================================================');
    console.log('🚀 Starting build process with both Text and JSON exports...');
    console.log('============================================================');
    
    // Ensure the deployment directory exists for output files
    if (!fs.existsSync(DEPLOY_DIR)){
        console.log(`\n⚙️ Creating deployment directory: ${DEPLOY_DIR}`);
        fs.mkdirSync(DEPLOY_DIR);
    }
    
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
