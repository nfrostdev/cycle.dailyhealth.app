const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC = path.resolve(__dirname, 'public');
const DIST = path.resolve(__dirname, 'dist');

// ----------------------------------------
// Helpers
// ----------------------------------------

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function contentHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

// ----------------------------------------
// 1. Clean dist/
// ----------------------------------------
console.log('Cleaning dist/...');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

// ----------------------------------------
// 2. CSS — Tailwind CLI (unhashed first, rename after)
// ----------------------------------------
console.log('Building CSS...');
execSync('npx tailwindcss -i ./styles/input.css -o ./dist/styles.css --minify', {
  stdio: 'inherit',
});
const cssHash = contentHash(path.join(DIST, 'styles.css'));
const cssFilename = `styles-${cssHash}.css`;
fs.renameSync(path.join(DIST, 'styles.css'), path.join(DIST, cssFilename));

// ----------------------------------------
// 3. JS — minify with esbuild (unhashed first, rename after)
// ----------------------------------------
console.log('Minifying JS...');
esbuild.buildSync({
  entryPoints: [path.join(SRC, 'app.js')],
  outfile: path.join(DIST, 'app.js'),
  minify: true,
  target: 'es2017',
});
// Inject the semver from package.json in place of the __VERSION__ placeholder
const { version } = require('./package.json');
let jsContent = fs.readFileSync(path.join(DIST, 'app.js'), 'utf8');
jsContent = jsContent.replace('__VERSION__', version);
fs.writeFileSync(path.join(DIST, 'app.js'), jsContent);

// Hash the final content (post-injection) so the filename and SW cache name
// reflect what's actually deployed — including version-only changes
const jsHash = contentHash(path.join(DIST, 'app.js'));
const jsFilename = `app-${jsHash}.js`;
fs.renameSync(path.join(DIST, 'app.js'), path.join(DIST, jsFilename));

// ----------------------------------------
// 4. Fonts — copy from fontsource packages
// ----------------------------------------
console.log('Copying fonts...');
const FONTS_DIST = path.join(DIST, 'fonts');
fs.mkdirSync(FONTS_DIST, { recursive: true });

// Copy exactly the fonts styles/input.css declares - no more, no less.
// A broad filename filter previously matched the latin-ext and italic cuts
// too, which no @font-face references but the service worker still pre-cached.
const FONT_PACKAGES = ['@fontsource-variable/outfit', '@fontsource-variable/fraunces'];
const inputCss = fs.readFileSync(path.join(__dirname, 'styles', 'input.css'), 'utf8');
const wantedFonts = [...new Set(
  [...inputCss.matchAll(/url\(['"]?\/fonts\/([^'")]+)['"]?\)/g)].map((m) => m[1])
)];

if (wantedFonts.length === 0) {
  console.error('Build failed: styles/input.css declares no @font-face sources.');
  process.exit(1);
}

for (const name of wantedFonts) {
  const source = FONT_PACKAGES
    .map((pkg) => path.join(__dirname, 'node_modules', pkg, 'files', name))
    .find((candidate) => fs.existsSync(candidate));

  // Previously a warning, which shipped a build with missing fonts
  if (!source) {
    console.error(`Build failed: ${name} is declared in input.css but absent from every font package.`);
    process.exit(1);
  }

  fs.copyFileSync(source, path.join(FONTS_DIST, name));
  console.log(`  Copied ${name}`);
}

// ----------------------------------------
// 5. HTML — strip CDN scripts, inject hashed stylesheet + script
// ----------------------------------------
console.log('Processing index.html...');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// Remove Google Fonts preconnect + stylesheet
html = html.replace(/\n\s*<!-- Preconnect & Fonts -->\n[\s\S]*?rel="stylesheet">\n/, '\n');

// Remove Tailwind CDN script + inline config block (two consecutive <script> tags)
html = html.replace(/\n\s*<!-- Tailwind -->[\s\S]*?<\/script>[\s\S]*?<\/script>\n/, '\n');

// Inject hashed stylesheet before </head>
html = html.replace('</head>', `  <link rel="stylesheet" href="${cssFilename}">\n</head>`);

// Update app.js script src to hashed filename
html = html.replace('src="app.js"', `src="${jsFilename}"`);

fs.writeFileSync(path.join(DIST, 'index.html'), html);

// ----------------------------------------
// 6. Service worker — inject hashed filenames + cache name
// ----------------------------------------
console.log('Processing sw.js...');
let sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');

// Use JS hash in cache name so each deploy gets a fresh cache
sw = sw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'cycle-${jsHash}';`);

// Replace bare asset filenames with hashed versions
sw = sw.replace("'/app.js'", `'/${jsFilename}'`);

// Inject styles.css (hashed) + fonts into STATIC_ASSETS
const fontFiles = fs.readdirSync(FONTS_DIST).map((f) => `/fonts/${f}`);
const extraAssets = [`/${cssFilename}`, ...fontFiles];
sw = sw.replace(
  "const STATIC_ASSETS = [",
  `const STATIC_ASSETS = [\n  ${extraAssets.map((a) => `'${a}'`).join(',\n  ')},`
);

fs.writeFileSync(path.join(DIST, 'sw.js'), sw);

// ----------------------------------------
// 7. Static files
// ----------------------------------------
console.log('Copying static files...');
copy(path.join(SRC, 'manifest.json'), path.join(DIST, 'manifest.json'));
copy(path.join(SRC, 'favicon.svg'), path.join(DIST, 'favicon.svg'));
copyDir(path.join(SRC, 'icons'), path.join(DIST, 'icons'));

// ----------------------------------------
// 8. Verify nothing third-party is loaded
// ----------------------------------------
// The CDN strip in step 5 is regex-driven. If index.html is edited so a
// pattern stops matching, the build would silently ship Tailwind and Google
// Fonts requests from an app whose whole premise is that nothing leaves the
// device. Fail loudly instead.
console.log('Verifying no external assets...');
const builtHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const builtCss = fs.readFileSync(path.join(DIST, cssFilename), 'utf8');
const offenders = [];

for (const tag of builtHtml.match(/<script\b[^>]*>/gi) || []) {
  if (/\bsrc\s*=\s*["']\s*(?:https?:)?\/\//i.test(tag)) offenders.push(tag.trim());
}
for (const tag of builtHtml.match(/<link\b[^>]*>/gi) || []) {
  if (!/["']\s*(?:https?:)?\/\//i.test(tag)) continue;
  const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  if (rel.toLowerCase() === 'canonical') continue; // metadata, never fetched
  offenders.push(tag.trim());
}
for (const m of builtCss.match(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi) || []) {
  offenders.push(m.trim());
}

if (offenders.length) {
  console.error('\nBuild failed: dist/ would load third-party assets:');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}

// ----------------------------------------
// Done
// ----------------------------------------
const cssSize = (fs.statSync(path.join(DIST, cssFilename)).size / 1024).toFixed(1);
const jsSize  = (fs.statSync(path.join(DIST, jsFilename)).size  / 1024).toFixed(1);
console.log(`\nBuild complete → dist/  (v${version}, build ${jsHash})`);
console.log(`  ${cssFilename}  ${cssSize} kB`);
console.log(`  ${jsFilename}   ${jsSize} kB`);
