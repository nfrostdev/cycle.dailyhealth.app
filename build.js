const { execSync } = require('child_process');
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

// ----------------------------------------
// 1. Clean dist/
// ----------------------------------------
console.log('Cleaning dist/...');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

// ----------------------------------------
// 2. CSS — Tailwind CLI
// ----------------------------------------
console.log('Building CSS...');
execSync('npx tailwindcss -i ./styles/input.css -o ./dist/styles.css --minify', {
  stdio: 'inherit',
});

// ----------------------------------------
// 3. JS — minify with esbuild
// ----------------------------------------
console.log('Minifying JS...');
esbuild.buildSync({
  entryPoints: [path.join(SRC, 'app.js')],
  outfile: path.join(DIST, 'app.js'),
  minify: true,
  target: 'es2017',
});

// ----------------------------------------
// 4. Fonts — copy from fontsource packages
// ----------------------------------------
console.log('Copying fonts...');
const FONTS_DIST = path.join(DIST, 'fonts');
fs.mkdirSync(FONTS_DIST, { recursive: true });

function copyFonts(packageName, filter) {
  const filesDir = path.join(__dirname, 'node_modules', packageName, 'files');
  if (!fs.existsSync(filesDir)) {
    console.warn(`  Warning: ${packageName} not found. Run npm install.`);
    return;
  }
  const files = fs.readdirSync(filesDir).filter(filter);
  if (files.length === 0) {
    console.warn(`  Warning: no matching font files found in ${packageName}/files/`);
    return;
  }
  for (const file of files) {
    fs.copyFileSync(path.join(filesDir, file), path.join(FONTS_DIST, file));
    console.log(`  Copied ${file}`);
  }
}

copyFonts(
  '@fontsource-variable/outfit',
  (f) => f.includes('latin') && f.includes('wght') && f.endsWith('.woff2')
);
copyFonts(
  '@fontsource-variable/fraunces',
  (f) => f.includes('latin') && f.includes('wght') && f.endsWith('.woff2')
);

// ----------------------------------------
// 5. HTML — strip CDN scripts, inject stylesheet
// ----------------------------------------
console.log('Processing index.html...');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// Remove Google Fonts preconnect + stylesheet
html = html.replace(/\n\s*<!-- Preconnect & Fonts -->\n[\s\S]*?rel="stylesheet">\n/, '\n');

// Remove Tailwind CDN script + inline config block (two consecutive <script> tags)
html = html.replace(/\n\s*<!-- Tailwind -->[\s\S]*?<\/script>[\s\S]*?<\/script>\n/, '\n');

// Inject built stylesheet before </head>
html = html.replace('</head>', '  <link rel="stylesheet" href="styles.css">\n</head>');

fs.writeFileSync(path.join(DIST, 'index.html'), html);

// ----------------------------------------
// 6. Service worker — add styles.css + fonts to cache list
// ----------------------------------------
console.log('Processing sw.js...');
let sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');

// Find which font files were copied and add to cache list
const fontFiles = fs.existsSync(FONTS_DIST)
  ? fs.readdirSync(FONTS_DIST).map((f) => `/fonts/${f}`)
  : [];

const extraAssets = ['/styles.css', ...fontFiles];
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
// Done
// ----------------------------------------
const cssSize = (fs.statSync(path.join(DIST, 'styles.css')).size / 1024).toFixed(1);
const jsSize  = (fs.statSync(path.join(DIST, 'app.js')).size  / 1024).toFixed(1);
console.log(`\nBuild complete → dist/`);
console.log(`  styles.css  ${cssSize} kB`);
console.log(`  app.js      ${jsSize} kB`);
