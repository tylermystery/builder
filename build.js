const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outputFile = 'project_source.txt';
const checksumFile = 'checksum.txt';

// Define ALL directories and files to include in the build
const sources = [
    { type: 'file', path: 'spec_sheet.md' },
    { type: 'file', path: 'ARCHITECTURE.md' },
    { type: 'file', path: 'index.html' },
    { type: 'directory', path: './', files: ['main.js', 'ui.js', 'api.js', 'events.js', 'filtering.js', 'state.js', 'config.js', 'session.js', 'availability.js'] },
    { type: 'directory', path: 'utils', files: ['debug.js', 'utils.js'] },
    { type: 'directory', path: 'components', files: ['card.js', 'modal.js', 'sidebar.js'] },
    { type: 'file', path: 'netlify.toml' },
    { type: 'file', path: 'package.json' }
    // NOTE: Add any new files or directories here in the future
];

let fullContent = `Project Export - ${new Date().toISOString()}\n\n`;

console.log('Starting project source build...');

sources.forEach(source => {
    if (source.type === 'file') {
        const filePath = path.join(__dirname, source.path);
        if (fs.existsSync(filePath)) {
            console.log(`Adding file: ${source.path}`);
            const content = fs.readFileSync(filePath, 'utf8');
            fullContent += `============================================================\n`;
            fullContent += `// FILE: ${source.path}\n`;
            fullContent += `============================================================\n`;
            fullContent += content + '\n\n';
        } else {
            console.warn(`WARN: File not found, skipping: ${source.path}`);
        }
    } else if (source.type === 'directory') {
        source.files.forEach(fileName => {
            const filePath = path.join(__dirname, source.path, fileName);
            if (fs.existsSync(filePath)) {
                const relativePath = path.join(source.path, fileName).replace(/\\/g, '/');
                console.log(`Adding file: ${relativePath}`);
                const content = fs.readFileSync(filePath, 'utf8');
                fullContent += `============================================================\n`;
                fullContent += `// FILE: ${relativePath}\n`;
                fullContent += `============================================================\n`;
                fullContent += content + '\n\n';
            } else {
                console.warn(`WARN: File not found, skipping: ${filePath}`);
            }
        });
    }
});

// Write the combined content to the output file
fs.writeFileSync(outputFile, fullContent);
console.log(`\nSuccessfully created ${outputFile}`);

// Calculate and save the checksum
const fileBuffer = fs.readFileSync(outputFile);
const hashSum = crypto.createHash('sha256');
hashSum.update(fileBuffer);
const hex = hashSum.digest('hex');

fs.writeFileSync(checksumFile, `SHA256 Checksum for ${outputFile}:\n${hex}\n`);
console.log(`Successfully created ${checksumFile} with SHA256 hash.`);
console.log(`\nBuild complete!`);

