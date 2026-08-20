/**
 * Test harness: loads the real public/app.js into a jsdom-backed VM context.
 *
 * Nothing here reimplements app logic — tests exercise the same source that
 * ships. Top-level `function` declarations in app.js become properties of the
 * context global, so they are reachable as win.<name>. Top-level `const`/`let`
 * stay lexical and are deliberately not reachable; observe state through the
 * DOM or localStorage instead, the way a user would.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const STORAGE_KEY = 'periodTrackerData';

/** ISO date N days from today (negative = past) */
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

/** Build a period record; pass skipped=true for a skipped-cycle marker */
function period(id, startOffset, endOffset, skipped) {
  const p = {
    id,
    startDate: dayOffset(startOffset),
    endDate: endOffset === null ? null : dayOffset(endOffset)
  };
  if (skipped) p.skipped = true;
  return p;
}

const SETTINGS = { defaultCycleLength: 28, defaultPeriodLength: 5 };

/** Three clean 5-day periods, 28 days apart. avgCycle 28, avgPeriod 5. */
function regularHistory(shift = 0) {
  return [
    period('p1', -84 + shift, -80 + shift),
    period('p2', -56 + shift, -52 + shift),
    period('p3', -28 + shift, -24 + shift)
  ];
}

/**
 * Boot the app against seeded data.
 * @param {Array} periods - seed records, or null for a first-run app
 * @returns {Object} { win, doc, click, html, stored }
 */
function bootApp(periods) {
  const dom = new JSDOM(SHELL, {
    runScripts: 'outside-only',
    url: 'https://cycle.dailyhealth.app/'
  });
  const win = dom.window;

  // jsdom implements neither matchMedia nor the SW API; app.js feature-detects
  // the latter but calls the former unconditionally at load.
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  if (periods) {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify({ periods, settings: SETTINGS }));
  }

  vm.runInContext(APP_SRC, dom.getInternalVMContext(), { filename: 'public/app.js' });

  // app.js wires these on DOMContentLoaded, which jsdom already fired while
  // parsing the shell — before the script was injected.
  win.attachEventListeners();
  win.render();

  return {
    win,
    doc: win.document,
    /** Click the first match, returning false if absent */
    click(selector) {
      const el = win.document.querySelector(selector);
      if (!el) return false;
      el.click();
      return true;
    },
    /** Rendered text of #app, whitespace-collapsed */
    html() {
      return win.document.getElementById('app').innerHTML;
    },
    text() {
      return win.document.getElementById('app').textContent.replace(/\s+/g, ' ').trim();
    },
    /**
     * How many history rows are flagged as skipped.
     * Queries the attribute rather than matching /skipped/ against innerHTML —
     * every edit button carries data-skipped="" so a bare regex always matches.
     */
    skipCount() {
      return win.document.querySelectorAll('.edit-period-btn[data-skipped="1"]').length;
    },
    /** The edit button of the first skipped row, or null */
    skipRow() {
      return win.document.querySelector('.edit-period-btn[data-skipped="1"]');
    },
    /** Parsed localStorage contents (writes are debounced ~300ms) */
    stored() {
      const raw = win.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { bootApp, dayOffset, period, regularHistory, SETTINGS, STORAGE_KEY, sleep };
