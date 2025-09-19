// FILE: export.js
/*
 * Version: 2.0.0
 * Last Modified: 2025-09-19
 *
 * Changelog:
 *
 * v2.0.0 - 2025-09-19
 * - Replaced hardcoded file list with a dynamic file walker.
 * - The script now recursively finds all relevant source files (.js, .html, .css, .md, .json, .toml).
 * - Added an ignore list for directories like node_modules.
 *
 * v1.1.0 - 2025-08-18
 * - Added logic to read and combine all project files into project_source.txt during build.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;

// Define which file extensions and specific files to include
const includeExtensions = ['.js', '.html', '.css', '.md', '.json', '.toml'];
const includeFiles = ['LICENSE', 'README']; // Add specific root files without extensions if needed

// Define directories and files to explicitly ignore
const ignoreList = [
    'node_modules',
    '.git',
    '.DS_Store',
    'package-lock.json',
    'project_source.txt' // Don't include the output file in itself
];

// Recursive function to get all file paths
const getAllFiles = (dirPath, arrayOfFiles = []) => {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        if (ignoreList.includes(file)) {
            return;
        }
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            const isIncludedExtension = includeExtensions.includes(path.extname(file));
            const isIncludedFile = includeFiles.includes(file);
            if (isIncludedExtension || isIncludedFile) {
                arrayOfFiles.push(fullPath);
            }
        }
    });

    return arrayOfFiles;
};

// Get all project files and format them for the output
try {
    const allProjectFiles = getAllFiles(projectRoot);

    const outputContent = allProjectFiles.map(filePath => {
        // Create a relative path from the project root for cleaner headers
        const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf8');
        return `============================================================\n// FILE: ${relativePath}\n============================================================\n${content}`;
    }).join('\n\n');

    const header = `Project Export - ${new Date().toISOString()}\n\n`;
    fs.writeFileSync(path.join(projectRoot, 'project_source.txt'), header + outputContent);
    console.log(`Project source successfully exported to project_source.txt, containing ${allProjectFiles.length} files.`);

} catch (error) {
    console.error('Failed to export project source:', error);
}
