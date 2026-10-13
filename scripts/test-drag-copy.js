const assert = require('assert').strict;
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const { EventEmitter } = require('events');

function harness(platform = 'darwin') {
  function load(file, mocks = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, require: id => id in mocks ? mocks[id] : require(id),
      process: { platform, env: {}, pid: 100 }, console, setTimeout, clearTimeout,
      // The tests emit clipboard change notifications explicitly on all platforms.
      setInterval: () => 1, clearInterval() {},
    }, { filename: file });
    return module.exports;
  }
  const values = { dragCopy: true, listenClipboard: false, selectionPopup: true,
    selectionPopupTrigger: 'selectionShortcut', doubleClickCopy: false };
  const state = { text: 'original clipboard', selection: 'selected text', captures: 0,
    writes: [], offers: [], shows: [], notifications: [], allowed: true, ownWindow: false, pid: 200 };
  const helper = new EventEmitter();
  helper.configure = () => {};
  helper.request = async command => {
    assert.equal(command, 'capture');
    state.captures++;
    return state.capture ? state.capture() : { text: state.selection };
  };
  const native = {
    readText: async () => state.text,
    selection: { readText: async () => { state.captures++; return state.selection; } },
    writeText: async text => { state.text = text; state.writes.push(text); helper.emit('clipboard'); },
  };
  const configuration = { __esModule: true, default: { get: key => values[key] } };
  const { clipboard } = load('src/main/clipboard.ts', {
    electron: { clipboard: native }, '@/common/configuration': configuration,
    './mac-integration': { macIntegration: helper },
  });
  clipboard.on('text-changed', () => state.notifications.push(state.text));
  const hook = new EventEmitter(); hook.start = hook.stop = () => {};
  const { eventListener: listener } = load('src/main/event-listener.ts', {
    electron: { BrowserWindow: { getFocusedWindow: () => null },
      screen: { getCursorScreenPoint: () => ({ x: 30, y: 40 }), screenToDipPoint: point => point } },
    'uiohook-napi': { uIOhook: hook }, './clipboard': { clipboard },
    '../common/event-bus': { __esModule: true, default: {} }, '../common/configuration': configuration,
    './focus-handler': { foregroundApplication: async () => ({ pid: state.pid, name: 'Fixture', handle: 200 }),
      isValidWindow: async () => state.allowed },
    './mac-integration': { macIntegration: helper },
    './windows-integration': { windowsIntegration: { request: helper.request, stop() {} } },
    './selection-popup': { selectionPopup: { init() {}, hide() {}, pointerDown() {},
      contains: () => state.ownWindow, show: text => state.shows.push(text), offer: text => state.offers.push(text) } },
    './selection-utils': load('src/main/selection-utils.ts'),
  });
  listener.bind();
  return { values, state, helper, hook, clipboard, listener,
    drag: () => listener.gesture({ x: 10, y: 20 }),
    stop() { listener.stop(); clipboard.stopWatching(); } };
}
const settle = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const h = harness(platform);
    try {
      for (const mode of ['off', 'selectionShortcut', 'selectionButton', 'selectionDirect']) {
        for (const dragCopy of [false, true]) for (const listenClipboard of [false, true]) {
          Object.assign(h.values, { selectionPopup: mode !== 'off', selectionPopupTrigger: mode, dragCopy, listenClipboard });
          h.clipboard.stopWatching();
          h.state.text = 'original clipboard';
          if (listenClipboard) await h.clipboard.startWatching();
          const before = { captures: h.state.captures, offers: h.state.offers.length, notifications: h.state.notifications.length };
          await h.drag();
          h.helper.emit('clipboard'); await settle();
          const popup = mode === 'selectionButton' || mode === 'selectionDirect';
          const label = `${platform}: ${mode}, drag=${dragCopy}, listen=${listenClipboard}`;
          assert.equal(h.state.text, dragCopy ? h.state.selection : 'original clipboard', label);
          assert.equal(h.state.captures - before.captures, Number(dragCopy || popup), `${label}: capture once`);
          assert.equal(h.state.offers.length - before.offers, Number(popup), `${label}: preserve popup trigger`);
          assert.equal(h.state.notifications.length - before.notifications, Number(dragCopy && listenClipboard), `${label}: notify listener once`);
          assert.equal(h.state.shows.length, 0, `${label}: no shortcut-triggered popup`);
        }
      }
      Object.assign(h.values, { selectionPopup: true, selectionPopupTrigger: 'selectionShortcut', dragCopy: true });
      h.state.text = 'keep clipboard on shortcut';
      const writes = h.state.writes.length;
      await h.listener.translateSelection();
      assert.equal(h.state.shows.length, 1);
      assert.equal(h.state.writes.length, writes, 'An explicit popup shortcut must not perform Drag Copy');
      assert.equal(h.state.text, 'keep clipboard on shortcut');

      // A double click can still offer a popup while double-click copying is off.
      h.values.selectionPopupTrigger = 'selectionButton';
      const doubleClick = async () => {
        if (platform === 'darwin') h.helper.emit('selection-gesture', { x: 10, y: 20, doubleClick: true });
        else h.hook.emit('mouseup', { button: 1, clicks: 2, x: 10, y: 20 });
        await settle(110);
      };
      const offers = h.state.offers.length;
      await doubleClick();
      assert.equal(h.state.writes.length, writes, 'Popup double clicks must not bypass the copy option');
      assert.equal(h.state.offers.length, offers + 1);
      h.values.doubleClickCopy = true;
      await doubleClick();
      assert.equal(h.state.writes.length, writes + 1);

      const copies = h.state.writes.length;
      h.state.allowed = false; await h.drag();
      h.state.allowed = true; h.state.ownWindow = true; await h.drag();
      h.state.ownWindow = false; h.state.pid = 100; await h.drag();
      h.state.pid = 200; h.state.selection = ''; await h.drag();
      assert.equal(h.state.writes.length, copies, 'Disallowed apps, own windows and empty selections must not overwrite the clipboard');
    } finally { h.stop(); }
  }

  const h = harness();
  try {
    await h.clipboard.startWatching();
    // Simulate a native copy fallback: temporary contents never reach translation.
    h.state.capture = async () => {
      const saved = h.state.text;
      h.state.text = 'temporary copy'; h.helper.emit('clipboard'); await settle();
      h.state.text = saved;
      return { text: 'final selection' };
    };
    await h.drag();
    assert.deepEqual(h.state.notifications, ['final selection']);
    await h.drag();
    h.helper.emit('clipboard'); await settle();
    assert.deepEqual(h.state.notifications, ['final selection'], 'Repeated content must not cause duplicate clipboard translations');
    await h.clipboard.writeText('translated result');
    h.helper.emit('clipboard'); await settle();
    assert.deepEqual(h.state.notifications, ['final selection'], 'Auto-copy of translated output stays silent');

    let resolveCapture;
    h.state.capture = () => new Promise(resolve => { resolveCapture = resolve; });
    h.values.doubleClickCopy = true;
    const doubleClick = h.listener.gesture({ x: 10, y: 20 }, undefined, false, true); await settle(110);
    h.values.doubleClickCopy = false;
    resolveCapture({ text: 'double click disabled while capturing' }); await doubleClick;
    assert.equal(h.state.text, 'translated result', 'Turning double-click copying off takes effect before the write');

    const pending = h.drag(); await settle(110);
    h.helper.emit('pointerdown', { x: 100, y: 100 });
    resolveCapture({ text: 'stale selection' }); await pending;
    assert.equal(h.state.text, 'translated result', 'A newer selection cancels the pending clipboard write');

    const disabled = h.drag(); await settle(110);
    h.values.dragCopy = false; h.listener.refresh();
    resolveCapture({ text: 'disabled selection' }); await disabled;
    assert.equal(h.state.text, 'translated result', 'Turning Drag Copy off cancels an in-flight capture');

    h.values.dragCopy = true;
    const first = h.drag(); await settle(110);
    await h.drag();
    resolveCapture({ text: 'superseded selection' }); await first; await settle(110);
    resolveCapture({ text: 'latest selection' }); await settle();
    assert.equal(h.state.text, 'latest selection', 'Only the latest queued gesture writes to the clipboard');
    assert.deepEqual(h.state.notifications, ['final selection', 'latest selection']);
    assert.deepEqual(h.state.shows, []);
    assert.deepEqual(h.state.offers, []);
  } finally { h.stop(); }
  console.log('PASS: independent Drag Copy on Mac/Windows/Linux, unchanged popup modes, clipboard listener deduplication, double-click gating, app scope and stale/queued selection cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
