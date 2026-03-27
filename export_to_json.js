const fs = require('fs');
const path = require('path');

// --- Configuration ---
const PROJECT_ROOT = process.cwd();
const OUTPUT_FILE = 'project_source.json';

// Paths to ignore during the export process (relative to PROJECT_ROOT)
const EXCLUDE_PATHS = [
    'node_modules',
    '.git',
    '.netlify',
    OUTPUT_FILE,
    'temp',
    'dist',
    'package-lock.json',
    'deno.lock',
    '_redirects'
];

/**
 * Recursively retrieves a list of all files in a directory, filtering against EXCLUDE_PATHS.
 * @param {string} dir - The directory to search from.
 * @param {string[]} filelist - Accumulator for the list of file paths.
 * @returns {string[]} The list of file paths (relative to PROJECT_ROOT).
 */
function getFilesRecursive(dir, filelist = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const relativePath = path.relative(PROJECT_ROOT, filePath);

        // Check if the file or directory should be ignored
        if (EXCLUDE_PATHS.includes(file) || EXCLUDE_PATHS.includes(relativePath)) {
            return;
        }

        // Skip project_source text exports
        if (file.startsWith('project_source') && file.endsWith('.txt')) {
            return;
        }

        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            filelist = getFilesRecursive(filePath, filelist);
        } else if (stats.isFile()) {
            filelist.push(relativePath);
        }
    });

    return filelist;
}

/**
 * Scans the project directory, reads the content of relevant files,
 * and exports the entire project structure as a single JSON object.
 */
function exportProjectAsJson() {
    console.log("Starting structured JSON project export...");

    const allFilePaths = getFilesRecursive(PROJECT_ROOT);
    const projectFiles = [];

    allFilePaths.forEach(filePath => {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            projectFiles.push({
                path: filePath.replace(/\\/g, '/'),
                content: content
            });
        } catch (error) {
            console.error(`[ERROR] Could not read file ${filePath}: ${error.message}`);
        }
    });

    const exportData = {
        metadata: {
            exportDate: new Date().toISOString(),
            projectRoot: path.basename(PROJECT_ROOT),
            fileCount: projectFiles.length
        },
        files: projectFiles
    };

    try {
        const jsonContent = JSON.stringify(exportData, null, 2);
        fs.writeFileSync(OUTPUT_FILE, jsonContent);
        console.log(`\nSuccessfully exported ${projectFiles.length} files to ${OUTPUT_FILE}`);
    } catch (error) {
        console.error(`\n❌ Error writing output file ${OUTPUT_FILE}: ${error.message}`);
        process.exit(1);
    }
}

// Allow running standalone or as a module
if (require.main === module) {
    exportProjectAsJson();
}

module.exports = { exportProjectAsJson };
