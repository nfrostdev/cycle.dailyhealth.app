/**
 * Build output guarantees.
 *
 * Runs the real build, then asserts the properties that are easy to regress
 * silently: shipping fonts nothing references, and shipping third-party asset
 * requests from an app that promises data never leaves the device.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

before(() => {
  execFileSync('node', ['build.js'], { cwd: ROOT, stdio: 'pipe' });
});

/** Font filenames declared by @font-face in styles/input.css */
function declaredFonts() {
  const css = fs.readFileSync(path.join(ROOT, 'styles', 'input.css'), 'utf8');
  return [...new Set([...css.matchAll(/url\(['"]?\/fonts\/([^'")]+)['"]?\)/g)].map((m) => m[1]))].sort();
}

describe('fonts', () => {
  test('ships exactly what input.css declares — no unreferenced cuts', () => {
    assert.deepEqual(fs.readdirSync(path.join(DIST, 'fonts')).sort(), declaredFonts());
  });

  test('the service worker pre-caches only those fonts', () => {
    const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
    const cached = [...sw.matchAll(/'\/fonts\/([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(cached, declaredFonts());
  });

  test('every pre-cached asset actually exists in dist', () => {
    const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
    const assets = [...sw.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]).filter((a) => a !== '/');
    for (const asset of assets) {
      assert.ok(fs.existsSync(path.join(DIST, asset)), `${asset} is pre-cached but missing`);
    }
  });
});

describe('no third-party requests', () => {
  test('no script loads from a remote origin', () => {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const remote = (html.match(/<script\b[^>]*>/gi) || [])
      .filter((t) => /\bsrc\s*=\s*["']\s*(?:https?:)?\/\//i.test(t));
    assert.deepEqual(remote, [], 'CDN script survived the strip');
  });

  test('no stylesheet, preconnect or preload points off-origin', () => {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const remote = (html.match(/<link\b[^>]*>/gi) || []).filter((tag) => {
      if (!/["']\s*(?:https?:)?\/\//i.test(tag)) return false;
      const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      return rel.toLowerCase() !== 'canonical'; // canonical is metadata, never fetched
    });
    assert.deepEqual(remote, [], 'Google Fonts link survived the strip');
  });

  test('the stylesheet fetches no remote url()', () => {
    const cssFile = fs.readdirSync(DIST).find((f) => f.startsWith('styles-') && f.endsWith('.css'));
    const css = fs.readFileSync(path.join(DIST, cssFile), 'utf8');
    assert.deepEqual(css.match(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi) || [], []);
  });
});
