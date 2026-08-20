/**
 * Interaction paths: rendering, click delegation, modal wiring, persistence.
 * Drives the real DOM through real click events rather than calling handlers.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { bootApp, dayOffset, period, regularHistory, sleep } = require('./helpers/app.js');

/** regularHistory plus an ongoing period started `startedAgo` days back */
const ongoingSince = (startedAgo) => [...regularHistory(), period('cur', -startedAgo, null)];

describe('first run', () => {
  test('renders the welcome state', () => {
    const app = bootApp(null);
    assert.match(app.text(), /Welcome/);
  });

  test('offers no skip prompt with nothing to predict from', () => {
    const app = bootApp(null);
    assert.equal(app.doc.querySelector('#logSkippedCycleBtn'), null);
  });

  test('starting a period marks it active', () => {
    const app = bootApp(null);
    assert.ok(app.click('#togglePeriodBtn'));
    assert.match(app.text(), /Day 1 of your period/);
    assert.match(app.html(), /Active/);
  });
});

describe('ending a period', () => {
  test('a normal-length period ends on one tap, no modal', () => {
    const app = bootApp(ongoingSince(5));
    assert.ok(app.click('#togglePeriodBtn'));
    assert.equal(app.doc.getElementById('endPeriodModal'), null, 'should not prompt');
    assert.match(app.text(), /of your cycle/);
  });

  test('a suspiciously short period prompts before ending', () => {
    const app = bootApp(ongoingSince(0));
    assert.ok(app.click('#togglePeriodBtn'));
    assert.ok(app.doc.getElementById('endPeriodModal'), 'should prompt');
    assert.match(app.doc.getElementById('endPeriodModal').textContent, /shorter than your usual 5 days/);
  });

  test('cancelling the prompt leaves the period running', () => {
    const app = bootApp(ongoingSince(0));
    app.click('#togglePeriodBtn');
    assert.ok(app.click('#cancelEndPeriodBtn'));
    assert.equal(app.doc.getElementById('endPeriodModal'), null);
    assert.match(app.text(), /of your period/);
  });

  test('confirming without the checkbox records a real one-day period', () => {
    const app = bootApp(ongoingSince(0));
    app.click('#togglePeriodBtn');
    assert.ok(app.click('#confirmEndPeriodBtn'));
    assert.match(app.html(), /1 day</, 'singular, not "1 days"');
    assert.equal(app.skipCount(), 0, 'should be a real period');
  });

  test('confirming with the checkbox records a skipped cycle', () => {
    const app = bootApp(ongoingSince(0));
    app.click('#togglePeriodBtn');
    app.doc.getElementById('endPeriodSkippedInput').checked = true;
    assert.ok(app.click('#confirmEndPeriodBtn'));
    assert.equal(app.skipCount(), 1);
    assert.match(app.text(), /no bleeding/);
  });
});

describe('deleting a period', () => {
  test('confirming removes exactly one row', () => {
    const app = bootApp(regularHistory());
    const before = app.doc.querySelectorAll('.delete-period-btn').length;
    app.doc.querySelectorAll('.delete-period-btn')[0].click();
    assert.ok(app.doc.getElementById('deleteModal'), 'should confirm first');
    assert.ok(app.click('#confirmDeleteBtn'));
    assert.equal(app.doc.getElementById('deleteModal'), null, 'modal should close');
    assert.equal(app.doc.querySelectorAll('.delete-period-btn').length, before - 1);
  });

  test('cancelling keeps the period', () => {
    const app = bootApp(regularHistory());
    const before = app.doc.querySelectorAll('.delete-period-btn').length;
    app.doc.querySelectorAll('.delete-period-btn')[0].click();
    assert.ok(app.click('#cancelDeleteBtn'));
    assert.equal(app.doc.querySelectorAll('.delete-period-btn').length, before);
  });
});

describe('door 1 — period did not arrive', () => {
  const OVERDUE = regularHistory(-7);      // predicted date fell 7 days ago
  const NOT_DUE = regularHistory(18);      // predicted date is 18 days out

  test('appears only once the predicted date has passed', () => {
    assert.ok(bootApp(OVERDUE).doc.querySelector('#logSkippedCycleBtn'), 'expected when overdue');
    assert.equal(bootApp(NOT_DUE).doc.querySelector('#logSkippedCycleBtn'), null, 'not expected when on schedule');
  });

  test('logging a skip holds the cycle average at 28', () => {
    const app = bootApp(OVERDUE);
    assert.match(app.text(), /Cycle Length 28 days/);
    assert.ok(app.click('#logSkippedCycleBtn'));
    assert.equal(app.skipCount(), 1);
    assert.match(app.text(), /Cycle Length 28 days/, 'average must not drift');
  });

  test('the marker lands on the predicted date, not today', () => {
    const app = bootApp(OVERDUE);
    app.click('#logSkippedCycleBtn');
    // Predicted date fell 7 days ago; logging late must not displace the grid
    assert.equal(app.skipRow().dataset.startDate, dayOffset(-7));
    assert.notEqual(app.skipRow().dataset.startDate, dayOffset(0));
  });

  test('a skipped cycle does not render as a period', () => {
    const app = bootApp(OVERDUE);
    app.click('#logSkippedCycleBtn');
    assert.doesNotMatch(app.text(), /of your period/);
    assert.doesNotMatch(app.text(), /Cramps/);
  });
});

describe('door 2 — the edit modal', () => {
  const WITH_SKIP = [...regularHistory(-7), period('sk', -7, -7, true)];

  test('the checkbox reflects an existing flag', () => {
    const app = bootApp(WITH_SKIP);
    app.doc.querySelectorAll('.edit-period-btn')[0].click(); // newest row = the skip
    assert.ok(app.doc.getElementById('editPeriodModal'));
    assert.equal(app.doc.getElementById('editPeriodSkippedInput').checked, true);
  });

  test('the checkbox is clear for a real period', () => {
    const app = bootApp(regularHistory());
    app.doc.querySelectorAll('.edit-period-btn')[0].click();
    assert.equal(app.doc.getElementById('editPeriodSkippedInput').checked, false);
  });

  test('clearing the flag restores a normal period', () => {
    const app = bootApp(WITH_SKIP);
    app.doc.querySelectorAll('.edit-period-btn')[0].click();
    app.doc.getElementById('editPeriodSkippedInput').checked = false;
    assert.ok(app.click('#saveEditPeriodBtn'));
    assert.equal(app.skipCount(), 0, 'flag should be cleared');
  });

  test('setting the flag on a past period removes it from the averages', () => {
    const app = bootApp(regularHistory());
    assert.match(app.text(), /Cycle Length 28 days/);
    app.doc.querySelectorAll('.edit-period-btn')[0].click();
    app.doc.getElementById('editPeriodSkippedInput').checked = true;
    app.click('#saveEditPeriodBtn');
    assert.equal(app.skipCount(), 1);
    assert.match(app.text(), /estimate/, 'gate should fail and say so');
  });
});

describe('persistence', () => {
  test('the flag survives the debounced write to localStorage', async () => {
    const app = bootApp(regularHistory(-7));
    app.click('#logSkippedCycleBtn');
    await sleep(400); // saveData is debounced 300ms
    const marker = app.stored().periods.find((p) => p.skipped === true);
    assert.ok(marker, 'skip marker should be persisted');
    assert.equal(marker.startDate, dayOffset(-7), 'marker sits on the predicted date');
  });

  test('reloading the app rebuilds the same state', async () => {
    const app = bootApp(regularHistory(-7));
    app.click('#logSkippedCycleBtn');
    await sleep(400);
    const reloaded = bootApp(app.stored().periods);
    assert.equal(reloaded.skipCount(), 1);
    assert.match(reloaded.text(), /Cycle Length 28 days/);
  });
});
