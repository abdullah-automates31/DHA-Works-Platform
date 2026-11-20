import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  phaseCentre,
  RADIUS_OPTIONS,
  arrange,
  chooseOrigin,
  distanceLabel,
  haversineKm,
  jobDistanceKm,
  nearKarachi,
  radiusLabel,
  type Point,
} from './distance.ts';

const jobs = [
  { id: 'a', phase: 8 },
  { id: 'b', phase: 5 },
  { id: 'c', phase: 6 },
  { id: 'd', phase: 99 },
];

test('haversine: zero for the same point, symmetric, about 111 km per degree of latitude', () => {
  const p = (phaseCentre(5) as Point);
  assert.equal(haversineKm(p, p), 0);
  const q = { lat: p.lat + 1, lng: p.lng };
  assert.ok(Math.abs(haversineKm(p, q) - 111.2) < 0.5);
  assert.equal(haversineKm(p, q), haversineKm(q, p));
});

test('every DHA phase 1 to 8 has a centre inside Karachi', () => {
  for (let p = 1; p <= 8; p++) {
    assert.ok((phaseCentre(p) as Point), `phase ${p}`);
    assert.ok(nearKarachi((phaseCentre(p) as Point)));
  }
});

test('origin: phone location near Karachi wins, far away or missing falls back to the worker areas', () => {
  const here = { lat: 24.80, lng: 67.05 };
  assert.deepEqual(chooseOrigin(here, [5]), { kind: 'gps', point: here });
  assert.deepEqual(chooseOrigin({ lat: 51.5, lng: -0.12 }, [5, 6]), { kind: 'areas', phases: [5, 6] });
  assert.deepEqual(chooseOrigin({ lat: Number.NaN, lng: 67 }, [5]), { kind: 'areas', phases: [5] });
  assert.deepEqual(chooseOrigin(null, [5, 77]), { kind: 'areas', phases: [5] });
  assert.deepEqual(chooseOrigin(null, []), { kind: 'none' });
});

test('job distance: own phase is 0, nearest chosen phase counts, unknown phase or no origin is null', () => {
  const areas = chooseOrigin(null, [5, 6]);
  assert.equal(jobDistanceKm(5, areas), 0);
  assert.equal(jobDistanceKm(6, areas), 0);
  const km7 = jobDistanceKm(7, areas) as number;
  assert.ok(km7 > 0 && km7 < haversineKm((phaseCentre(5) as Point), (phaseCentre(7) as Point)) + 0.001);
  assert.equal(jobDistanceKm(99, areas), null);
  assert.equal(jobDistanceKm(5, { kind: 'none' }), null);
  const gps = chooseOrigin((phaseCentre(5) as Point), []);
  assert.equal(jobDistanceKm(5, gps), 0);
  assert.ok((jobDistanceKm(8, gps) as number) > 3);
});

test('labels', () => {
  assert.equal(distanceLabel(null), '');
  assert.equal(distanceLabel(Number.NaN), '');
  assert.equal(distanceLabel(0), 'Near you');
  assert.equal(distanceLabel(0.84), '~0.8 km');
  assert.equal(distanceLabel(2.449), '~2.4 km');
  assert.equal(distanceLabel(12.4), '~12 km');
  assert.equal(radiusLabel(3), 'Within 3 km');
  assert.equal(radiusLabel(null), 'Any distance');
  assert.deepEqual(RADIUS_OPTIONS, [1, 3, 5, 10, null]);
});

test('newest keeps the server order, nearest sorts by distance and keeps ties and unknowns stable', () => {
  const origin = chooseOrigin(null, [5]);
  const newest = arrange(jobs, { sort: 'newest', radius: null, origin }).map((r) => r.job.id);
  assert.deepEqual(newest, ['a', 'b', 'c', 'd']);
  const nearest = arrange(jobs, { sort: 'nearest', radius: null, origin }).map((r) => r.job.id);
  assert.equal(nearest[0], 'b'); // own phase = 0 km
  assert.equal(nearest[nearest.length - 1], 'd'); // unknown goes last
  assert.deepEqual(nearest, ['b', 'c', 'a', 'd']);
});

test('radius filter hides far jobs, never hides unknown ones, and does not change the input', () => {
  const origin = chooseOrigin(null, [5]);
  const copy = JSON.stringify(jobs);
  const within1 = arrange(jobs, { sort: 'newest', radius: 1, origin }).map((r) => r.job.id);
  assert.ok(within1.includes('b') && within1.includes('d') && !within1.includes('a'));
  const any = arrange(jobs, { sort: 'newest', radius: null, origin });
  assert.equal(any.length, 4);
  assert.equal(JSON.stringify(jobs), copy);
  assert.deepEqual(arrange([], { sort: 'nearest', radius: 3, origin }), []);
  // without any origin nothing can be measured, so nothing is hidden
  assert.equal(arrange(jobs, { sort: 'nearest', radius: 1, origin: { kind: 'none' } }).length, 4);
});
