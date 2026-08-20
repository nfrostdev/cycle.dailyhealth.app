/**
 * Cycle math: intervals, averages, gates, mutators, phases, import parsing.
 * Exercises the functions app.js actually ships.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { bootApp, dayOffset, SETTINGS } = require('./helpers/app.js');

let A;
before(() => { A = bootApp(null).win; });

// Literal-date fixtures keep interval math independent of the clock
const p = (id, s, e, skipped) => skipped
  ? { id, startDate: s, endDate: e, skipped: true }
  : { id, startDate: s, endDate: e };
const D = (periods) => ({ periods, settings: SETTINGS });

const CLEAN = [p('a', '2026-01-01', '2026-01-05'), p('b', '2026-01-29', '2026-02-02'), p('c', '2026-02-26', '2026-03-02')];
const SKIP_MARKER = p('s', '2026-03-26', '2026-03-26', true);
const AFTER_SKIP = p('d', '2026-04-23', '2026-04-27');

describe('surviving intervals', () => {
  test('three clean periods yield two 28-day intervals', () => {
    assert.deepEqual(A.getSurvivingIntervals(D(CLEAN)), [28, 28]);
  });

  test('a skip voids both intervals adjoining it', () => {
    assert.deepEqual(A.getSurvivingIntervals(D([...CLEAN, SKIP_MARKER, AFTER_SKIP])), [28, 28]);
  });

  test('alternating skips leave nothing to average', () => {
    const periods = [
      p('a', '2026-01-01', '2026-01-05'),
      p('s1', '2026-01-29', '2026-01-29', true),
      p('b', '2026-02-26', '2026-03-02'),
      p('s2', '2026-03-26', '2026-03-26', true),
      p('c', '2026-04-23', '2026-04-27')
    ];
    assert.deepEqual(A.getSurvivingIntervals(D(periods)), []);
  });

  test('an unflagged long gap still counts — we only help when told', () => {
    const periods = [p('a', '2026-01-01', '2026-01-05'), p('b', '2026-01-29', '2026-02-02'), p('c', '2026-03-26', '2026-03-30')];
    assert.deepEqual(A.getSurvivingIntervals(D(periods)), [28, 56]);
  });

  test('an ongoing period contributes no interval', () => {
    assert.deepEqual(A.getSurvivingIntervals(D([...CLEAN, p('x', '2026-03-26', null)])), [28, 28]);
  });
});

describe('cycle average — the reason the feature exists', () => {
  test('an unflagged skipped cycle drags the average to 37', () => {
    assert.equal(A.calculateAverageCycleLength(D([...CLEAN, AFTER_SKIP])), 37);
  });

  test('flagging it holds the average at 28', () => {
    assert.equal(A.calculateAverageCycleLength(D([...CLEAN, SKIP_MARKER, AFTER_SKIP])), 28);
  });

  test('when every interval is voided, fall back to the default', () => {
    const periods = [p('a', '2026-01-01', '2026-01-05'), p('s', '2026-01-29', '2026-01-29', true), p('b', '2026-02-26', '2026-03-02')];
    assert.equal(A.calculateAverageCycleLength(D(periods)), SETTINGS.defaultCycleLength);
  });
});

describe('legacy data carries no flag and must behave exactly as before', () => {
  test('cycle average unchanged', () => assert.equal(A.calculateAverageCycleLength(D(CLEAN)), 28));
  test('period average unchanged', () => assert.equal(A.calculateAveragePeriodLength(D(CLEAN)), 5));
  test('cycle gate passes on three periods', () => assert.equal(A.hasCycleData(D(CLEAN)), true));
  test('period gate passes on three periods', () => assert.equal(A.hasPeriodData(D(CLEAN)), true));
  test('two periods remain below the cycle gate', () => {
    assert.equal(A.hasCycleData(D(CLEAN.slice(0, 2))), false);
  });
});

describe('the two gates diverge once skips exist', () => {
  const DIVERGE = D([
    p('a', '2026-01-01', '2026-01-05'),
    p('s1', '2026-01-29', '2026-01-29', true),
    p('b', '2026-02-26', '2026-03-02'),
    p('s2', '2026-03-26', '2026-03-26', true),
    p('c', '2026-04-23', '2026-04-27')
  ]);

  test('cycle gate fails — no interval survives', () => assert.equal(A.hasCycleData(DIVERGE), false));
  test('period gate passes — three clean bleed samples', () => assert.equal(A.hasPeriodData(DIVERGE), true));
  test('period average stays real rather than falling back', () => {
    assert.equal(A.calculateAveragePeriodLength(DIVERGE), 5);
  });
  test('skips are excluded from bleed samples', () => assert.equal(A.getBleedSamples(DIVERGE).length, 3));
});

describe('mutators', () => {
  const base = D([p('a', '2026-03-26', '2026-03-30')]);

  test('flagging sets skipped and preserves the dates', () => {
    assert.deepEqual(A.updatePeriodSkipped(base, 'a', true).periods[0], {
      id: 'a', startDate: '2026-03-26', endDate: '2026-03-30', skipped: true
    });
  });

  test('unflagging removes the key rather than storing false', () => {
    const flagged = A.updatePeriodSkipped(base, 'a', true);
    const cleared = A.updatePeriodSkipped(flagged, 'a', false).periods[0];
    assert.deepEqual(cleared, { id: 'a', startDate: '2026-03-26', endDate: '2026-03-30' });
    assert.equal('skipped' in cleared, false);
  });

  test('flagging an ongoing period closes it on its start date', () => {
    assert.deepEqual(A.updatePeriodSkipped(D([p('a', '2026-03-26', null)]), 'a', true).periods[0], {
      id: 'a', startDate: '2026-03-26', endDate: '2026-03-26', skipped: true
    });
  });

  test('logSkippedCycle places the marker on the predicted date', () => {
    const next = A.logSkippedCycle(D([...CLEAN, SKIP_MARKER, AFTER_SKIP]));
    const marker = next.periods[next.periods.length - 1];
    assert.equal(next.periods.length, 6);
    assert.equal(marker.startDate, '2026-05-21'); // AFTER_SKIP start + 28
    assert.equal(marker.endDate, '2026-05-21');
    assert.equal(marker.skipped, true);
  });

  test('logSkippedCycle no-ops with no history to predict from', () => {
    assert.deepEqual(A.logSkippedCycle(D([])).periods, []);
  });

  test('mutators do not mutate their input', () => {
    const original = JSON.stringify(base);
    A.updatePeriodSkipped(base, 'a', true);
    A.logSkippedCycle(D(CLEAN));
    assert.equal(JSON.stringify(base), original);
  });
});

describe('import normalisation', () => {
  const parse = (data) => A.parseImportFile(JSON.stringify({ version: 1, data }));

  test('a legacy backup imports untouched', () => {
    const out = parse({ periods: [p('a', '2026-01-01', '2026-01-05')], settings: SETTINGS });
    assert.deepEqual(out.data.periods[0], { id: 'a', startDate: '2026-01-01', endDate: '2026-01-05' });
  });

  test('truthy non-boolean junk is normalised away', () => {
    const out = parse({ periods: [{ id: 'a', startDate: '2026-01-01', endDate: '2026-01-05', skipped: 'yes' }], settings: SETTINGS });
    assert.equal('skipped' in out.data.periods[0], false);
  });

  test('a real flag survives the round trip', () => {
    const out = parse({ periods: [SKIP_MARKER], settings: SETTINGS });
    assert.equal(out.data.periods[0].skipped, true);
  });

  test('a non-backup file is still rejected', () => {
    assert.equal(A.parseImportFile('{"nope":1}').ok, false);
    assert.equal(A.parseImportFile('not json').ok, false);
  });
});

describe('phase selection after a skip', () => {
  // These depend on "today", so they use relative offsets
  const history = [
    p('a', dayOffset(-84), dayOffset(-80)),
    p('b', dayOffset(-56), dayOffset(-52)),
    p('c', dayOffset(-28), dayOffset(-24))
  ];
  const startedToday = (skipped) => D([...history, p('t', dayOffset(0), dayOffset(0), skipped)]);

  test('day 1 of a skipped cycle is not menstrual', () => {
    assert.equal(A.getCurrentPhase(startedToday(true)).id, 'follicular');
  });

  test('day 1 of a real one-day period is still menstrual', () => {
    assert.equal(A.getCurrentPhase(startedToday(false)).id, 'menstrual');
  });

  test('the timeline menstrual band collapses for a skip', () => {
    assert.equal(A.getPhaseBoundaries(startedToday(true))[0].end, 0);
  });

  test('the timeline menstrual band survives for a real period', () => {
    assert.ok(A.getPhaseBoundaries(startedToday(false))[0].end > 0);
  });

  test('a skip marker never reads as an ongoing period', () => {
    assert.equal(A.isOnPeriod(D([SKIP_MARKER])), false);
  });
});
