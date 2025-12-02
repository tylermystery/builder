/**
 * Bundle Configuration for Client-Side JavaScript
 *
 * Uses esbuild to bundle all ES modules into optimized bundles:
 * - main.bundle.js: Main application bundle (tree-shaken and minified)
 * - crm.bundle.js: CRM dashboard bundle (separate entry point)
 *
 * Benefits:
 * - Reduces HTTP requests from ~20+ to 2-3
 * - Tree-shakes unused code
 * - Minifies for smaller file sizes
 * - Generates sourcemaps for debugging
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Configuration
const isProduction = process.env.NODE_ENV === 'production' || process.env.CONTEXT === 'production';
const OUTPUT_DIR = 'dist';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Build timestamp for cache busting
const buildTimestamp = Date.now();

async function bundle() {
    console.log('============================================================');
    console.log('🚀 Starting JavaScript bundling with esbuild...');
    console.log(`   Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log('============================================================\n');

    const startTime = Date.now();

    try {
        // Bundle main application
        console.log('📦 Bundling main application (main.js)...');
        const mainResult = await esbuild.build({
            entryPoints: ['main.js'],
            bundle: true,
            outfile: path.join(OUTPUT_DIR, 'main.bundle.js'),
            format: 'esm',
            target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
            minify: isProduction,
            sourcemap: true,
            treeShaking: true,
            metafile: true,
            define: {
                'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            },
            // Handle external dependencies that should not be bundled
            external: [],
            // Preserve import.meta for module context
            platform: 'browser',
            // Splitting for dynamic imports (if needed in future)
            splitting: false,
            // Log level
            logLevel: 'info',
        });

        // Analyze main bundle
        const mainMeta = mainResult.metafile;
        const mainBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'main.bundle.js')).size;
        const mainInputFiles = Object.keys(mainMeta.inputs).length;
        console.log(`   ✅ main.bundle.js: ${(mainBundleSize / 1024).toFixed(2)} KB (${mainInputFiles} modules bundled)`);

        // Bundle CRM dashboard (separate entry point)
        console.log('\n📦 Bundling CRM dashboard (crm.js)...');
        const crmResult = await esbuild.build({
            entryPoints: ['crm.js'],
            bundle: true,
            outfile: path.join(OUTPUT_DIR, 'crm.bundle.js'),
            format: 'esm',
            target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
            minify: isProduction,
            sourcemap: true,
            treeShaking: true,
            metafile: true,
            define: {
                'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            },
            external: [],
            platform: 'browser',
            splitting: false,
            logLevel: 'info',
        });

        // Analyze CRM bundle
        const crmMeta = crmResult.metafile;
        const crmBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'crm.bundle.js')).size;
        const crmInputFiles = Object.keys(crmMeta.inputs).length;
        console.log(`   ✅ crm.bundle.js: ${(crmBundleSize / 1024).toFixed(2)} KB (${crmInputFiles} modules bundled)`);

        // Bundle store dashboard
        if (fs.existsSync('store-dashboard.js')) {
            console.log('\n📦 Bundling store dashboard (store-dashboard.js)...');
            const dashboardResult = await esbuild.build({
                entryPoints: ['store-dashboard.js'],
                bundle: true,
                outfile: path.join(OUTPUT_DIR, 'store-dashboard.bundle.js'),
                format: 'esm',
                target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
                minify: isProduction,
                sourcemap: true,
                treeShaking: true,
                metafile: true,
                define: {
                    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
                },
                external: [],
                platform: 'browser',
                splitting: false,
                logLevel: 'info',
            });
            const dashboardBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'store-dashboard.bundle.js')).size;
            console.log(`   ✅ store-dashboard.bundle.js: ${(dashboardBundleSize / 1024).toFixed(2)} KB`);
        }

        // Bundle invitee view (simplified guest view)
        if (fs.existsSync('components/invitee.js')) {
            console.log('\n📦 Bundling invitee view (components/invitee.js)...');
            const inviteeResult = await esbuild.build({
                entryPoints: ['components/invitee.js'],
                bundle: true,
                outfile: path.join(OUTPUT_DIR, 'invitee.bundle.js'),
                format: 'esm',
                target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
                minify: isProduction,
                sourcemap: true,
                treeShaking: true,
                metafile: true,
                define: {
                    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
                },
                external: [],
                platform: 'browser',
                splitting: false,
                logLevel: 'info',
            });
            const inviteeBundleSize = fs.statSync(path.join(OUTPUT_DIR, 'invitee.bundle.js')).size;
            console.log(`   ✅ invitee.bundle.js: ${(inviteeBundleSize / 1024).toFixed(2)} KB`);
        }

        // Generate bundle manifest for cache busting
        const manifest = {
            version: buildTimestamp,
            bundles: {
                main: `main.bundle.js?v=${buildTimestamp}`,
                crm: `crm.bundle.js?v=${buildTimestamp}`,
                storeDashboard: `store-dashboard.bundle.js?v=${buildTimestamp}`,
                invitee: `invitee.bundle.js?v=${buildTimestamp}`,
            },
            generated: new Date().toISOString(),
        };
        fs.writeFileSync(
            path.join(OUTPUT_DIR, 'manifest.json'),
            JSON.stringify(manifest, null, 2)
        );

        // Write bundle analysis report
        console.log('\n📊 Generating bundle analysis report...');
        const analysisReport = generateAnalysisReport(mainMeta, crmMeta);
        fs.writeFileSync(path.join(OUTPUT_DIR, 'bundle-analysis.txt'), analysisReport);

        const endTime = Date.now();
        const totalSize = mainBundleSize + crmBundleSize;

        console.log('\n============================================================');
        console.log('✨ Bundling complete!');
        console.log(`   Total bundle size: ${(totalSize / 1024).toFixed(2)} KB`);
        console.log(`   Time: ${endTime - startTime}ms`);
        console.log(`   Output: ${OUTPUT_DIR}/`);
        console.log('============================================================\n');

        return true;

    } catch (error) {
        console.error('\n❌ Bundling failed:', error);
        process.exit(1);
    }
}

function generateAnalysisReport(mainMeta, crmMeta) {
    let report = '=== Bundle Analysis Report ===\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += '--- Main Bundle (main.bundle.js) ---\n';
    report += 'Input files:\n';
    Object.keys(mainMeta.inputs).sort().forEach(file => {
        const size = mainMeta.inputs[file].bytes;
        report += `  ${file}: ${(size / 1024).toFixed(2)} KB\n`;
    });

    report += '\n--- CRM Bundle (crm.bundle.js) ---\n';
    report += 'Input files:\n';
    Object.keys(crmMeta.inputs).sort().forEach(file => {
        const size = crmMeta.inputs[file].bytes;
        report += `  ${file}: ${(size / 1024).toFixed(2)} KB\n`;
    });

    return report;
}

// Run bundler
bundle().then(success => {
    if (success) {
        console.log('Bundle process completed successfully.');
    }
}).catch(error => {
    console.error('Bundle process failed:', error);
    process.exit(1);
});
