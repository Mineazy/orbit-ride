// The driver location rules (how often to send, heartbeats, errors) and the native background-location adapter.
//
//   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../../src/prod/tracker.ts';
import { startNativeTracking } from '../../src/prod/nativeTracking.ts';

// 1 degree of latitude is about 111 km; good enough for a fake distance
const km = (a, b) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 111);
const CBD = [-22.5615, 17.0835];
const move = (pos, metres) => [pos[0] + metres / 111_000, pos[1]];

function setup(over = {}) {
  const sent = [];
  const states = [];
  const fixes = [];
  const clock = { t: 1_000_000 };
  const tracker = createTracker({
    send: over.send ?? (async (pos) => { sent.push(pos); }),
    onState: (s) => states.push(s),
    onFix: (p) => fixes.push(p),
    now: () => clock.t,
    distance: km,
  });
  return { tracker, sent, states, fixes, clock };
}

describe('when positions are sent', () => {
  test('the first position goes straight away and reports ok', async () => {
    const { tracker, sent, states, fixes } = setup();
    await tracker.position(CBD);
    assert.deepEqual(sent, [CBD]);
    assert.deepEqual(states, ['ok']);
    assert.deepEqual(fixes, [CBD]);
  });

  test('never more often than every 5 seconds, even when moving fast', async () => {
    const { tracker, sent, clock } = setup();
    await tracker.position(CBD);
    clock.t += 2000;
    await tracker.position(move(CBD, 500));
    assert.equal(sent.length, 1);
    clock.t += 3000; // 5 s since the first
    await tracker.position(move(CBD, 500));
    assert.equal(sent.length, 2);
  });

  test('a stationary driver is not sent again until the heartbeat is due', async () => {
    const { tracker, sent, clock } = setup();
    await tracker.position(CBD);
    clock.t += 10_000;
    await tracker.position(move(CBD, 3)); // 3 m: GPS noise
    assert.equal(sent.length, 1);
    clock.t += 20_000; // 30 s since the last send
    await tracker.position(move(CBD, 3));
    assert.equal(sent.length, 2);
  });

  test('moving 10 m or more sends after the minimum gap', async () => {
    const { tracker, sent, clock } = setup();
    await tracker.position(CBD);
    clock.t += 6000;
    await tracker.position(move(CBD, 15));
    assert.equal(sent.length, 2);
  });

  test('only one send at a time', async () => {
    let release;
    const slow = new Promise((r) => { release = r; });
    const calls = [];
    const { tracker, clock } = setup({ send: async (p) => { calls.push(p); await slow; } });
    const first = tracker.position(CBD);
    clock.t += 60_000;
    await tracker.position(move(CBD, 500)); // arrives while the first is still in flight
    assert.equal(calls.length, 1);
    release();
    await first;
  });

  test('a failed send is not counted: the next position tries again at once', async () => {
    let fail = true;
    const sent = [];
    const { tracker, states, clock } = setup({ send: async (p) => { if (fail) throw new Error('offline'); sent.push(p); } });
    await tracker.position(CBD);
    assert.deepEqual(states, []); // not reported ok
    fail = false;
    clock.t += 100; // well inside the minimum gap, but nothing was sent yet
    await tracker.position(CBD);
    assert.equal(sent.length, 1);
    assert.deepEqual(states, ['ok']);
  });
});

describe('heartbeat', () => {
  test('re-sends the last position when nothing has been sent for 30 seconds', async () => {
    const { tracker, sent, clock } = setup();
    await tracker.position(CBD);
    clock.t += 29_000;
    await tracker.heartbeat();
    assert.equal(sent.length, 1);
    clock.t += 1000;
    await tracker.heartbeat();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], CBD);
  });

  test('does nothing before the first position, so a driver without a fix is not reported somewhere invented', async () => {
    const { tracker, sent, clock } = setup();
    clock.t += 120_000;
    await tracker.heartbeat();
    assert.equal(sent.length, 0);
  });
});

describe('errors and stopping', () => {
  test('reports denied and unavailable', () => {
    const { tracker, states } = setup();
    tracker.error('denied');
    tracker.error('unavailable');
    assert.deepEqual(states, ['denied', 'unavailable']);
  });

  test('after stop nothing more is sent or reported', async () => {
    const { tracker, sent, states, clock } = setup();
    await tracker.position(CBD);
    tracker.stop();
    clock.t += 60_000;
    await tracker.position(move(CBD, 500));
    await tracker.heartbeat();
    tracker.error('denied');
    assert.equal(sent.length, 1);
    assert.deepEqual(states, ['ok']);
  });
});

// ---- the native plugin adapter ------------------------------------------------

function fakePlugin({ failToStart = false } = {}) {
  const plugin = {
    watchers: new Map(),
    options: null,
    removed: [],
    nextId: 1,
    addWatcher(options, callback) {
      plugin.options = options;
      if (failToStart) return Promise.reject(new Error('no plugin'));
      const id = `w${plugin.nextId++}`;
      plugin.watchers.set(id, callback);
      return Promise.resolve(id);
    },
    removeWatcher({ id }) {
      plugin.removed.push(id);
      plugin.watchers.delete(id);
      return Promise.resolve();
    },
  };
  return plugin;
}
const sink = () => {
  const got = { positions: [], errors: [] };
  return { got, position: (p) => got.positions.push(p), error: (k) => got.errors.push(k) };
};
const opts = { notificationTitle: 'Sharing', notificationMessage: 'You are online' };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('native background location', () => {
  test('asks the plugin for a background watcher with a visible notification and permission prompt', async () => {
    const plugin = fakePlugin();
    startNativeTracking(plugin, sink(), opts);
    await flush();
    assert.equal(plugin.options.backgroundTitle, 'Sharing');
    assert.equal(plugin.options.backgroundMessage, 'You are online');
    assert.equal(plugin.options.requestPermissions, true);
    assert.equal(plugin.options.stale, false);
    assert.equal(plugin.options.distanceFilter, 10);
  });

  test('passes positions to the tracker as [lat, lng]', async () => {
    const plugin = fakePlugin();
    const s = sink();
    startNativeTracking(plugin, s, opts);
    await flush();
    [...plugin.watchers.values()][0]({ latitude: -22.5, longitude: 17.1, accuracy: 5 });
    assert.deepEqual(s.got.positions, [[-22.5, 17.1]]);
  });

  test('maps a refused permission to denied and other failures to unavailable', async () => {
    const plugin = fakePlugin();
    const s = sink();
    startNativeTracking(plugin, s, opts);
    await flush();
    const cb = [...plugin.watchers.values()][0];
    cb(undefined, Object.assign(new Error('x'), { code: 'NOT_AUTHORIZED' }));
    cb(undefined, new Error('gps off'));
    assert.deepEqual(s.got.errors, ['denied', 'unavailable']);
  });

  test('stopping removes the watcher, once', async () => {
    const plugin = fakePlugin();
    const stop = startNativeTracking(plugin, sink(), opts);
    await flush();
    stop();
    stop();
    assert.deepEqual(plugin.removed, ['w1']);
  });

  test('stopping before the watcher has started still removes it when it arrives', async () => {
    const plugin = fakePlugin();
    const stop = startNativeTracking(plugin, sink(), opts);
    stop(); // immediately
    await flush();
    assert.deepEqual(plugin.removed, ['w1']);
  });

  test('positions that arrive after stopping are ignored', async () => {
    const plugin = fakePlugin();
    const s = sink();
    const stop = startNativeTracking(plugin, s, opts);
    await flush();
    const cb = [...plugin.watchers.values()][0];
    stop();
    cb({ latitude: 1, longitude: 2, accuracy: 1 });
    assert.deepEqual(s.got.positions, []);
  });

  test('a plugin that cannot start reports unavailable instead of crashing', async () => {
    const s = sink();
    startNativeTracking(fakePlugin({ failToStart: true }), s, opts);
    await flush();
    assert.deepEqual(s.got.errors, ['unavailable']);
  });
});
