// FILE: build.js
const fs = require('fs');
const path = require('path');

// --- Configuration ---
// Directories and files to exclude from the export.
const IGNORE_LIST = [
    'node_modules',
    '.git',
    'build.js' // Excludes this script itself.
];
const STARTING_DIRECTORY = '.'; // Start from the current directory.

/**
 * Recursively walks a directory to find all file paths.
 * @param {string} dirPath - The directory to start from.
 * @param {Array<string>} [arrayOfFiles] - Used for recursion.
 * @returns {Array<string>} A list of all file paths.
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);

        // Check if the current path is in our ignore list.
        if (IGNORE_LIST.includes(file)) {
            return;
        }

        // If it's a directory, recurse into it. If it's a file, add it to the list.
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            // Check to ensure we don't include previous build outputs.
            if (!file.startsWith('project_source')) {
                arrayOfFiles.push(fullPath);
            }
        }
    });

    return arrayOfFiles;
}


// --- Main function to build the source file ---
function buildSourceFile() {
    console.log('🚀 Starting build process with automatic file discovery...');
    const outputParts = [];
    const timestamp = new Date().toISOString();
    
    // Get the dynamic list of all files in the project.
    const filePaths = getAllFiles(STARTING_DIRECTORY);
    console.log(`Found ${filePaths.length} files to include.`);

    // Add a header to the export file
    outputParts.push(`Project Export - ${timestamp}\n`);

    // Loop through each file path
    filePaths.forEach(filePath => {
        try {
            console.log(`   - Adding file: ${filePath}`);

            // Add a separator and file header (use relative path for cleaner output)
            const relativePath = path.relative(STARTING_DIRECTORY, filePath);
            outputParts.push('============================================================');
            outputParts.push(`// FILE: ${relativePath.replace(/\\/g, '/')}`);
            outputParts.push('============================================================');

            // Read the file content
            const content = fs.readFileSync(filePath, 'utf8');
            outputParts.push(content);
            outputParts.push('\n'); // Add a newline for spacing

        } catch (error) {
            console.error(`❌ Error reading file ${filePath}:`, error.message);
            outputParts.push(`// ERROR: Could not read file: ${filePath}`);
        }
    });

    const outputContent = outputParts.join('\n');
    const outputFileName = `project_source - ${timestamp}.txt`;
    
    // Write the combined content to the output file
    fs.writeFileSync(outputFileName, outputContent);
    console.log(`\n✅ Build complete! Exported to: ${outputFileName}`);
}

// Run the build process
buildSourceFile();
