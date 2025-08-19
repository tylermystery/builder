/*
 * Version: 1.1.0
 * Last Modified: 2025-08-18 06:15 PM PDT
 *
 * Changelog:
 *
 * v1.1.0 - 2025-08-18 06:15 PM PDT
 * - Added logic to read and combine all project files into project_source.txt during build.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */
const fs = require('fs');
const path = require('path');

const files = [
    'spec_sheet.md',
    'index.html',
    'main.js',
    'ui.js',
    'api.js',
    'config.js',
    'state.js',
    'netlify.toml',
    'package.json',
    'netlify/functions/airtable.js'
];

const output = `Project Export - ${new Date().toISOString()}\n\n${files.map(filename => {
    const filePath = path.join(__dirname, filename);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : `/* File ${filename} not found */`;
    return `============================================================\n// FILE: ${filename}\n============================================================\n${content}`;
}).join('\n')}`;

fs.writeFileSync(path.join(__dirname, 'project_source.txt'), output);
console.log('Project source exported to project_source.txt');
