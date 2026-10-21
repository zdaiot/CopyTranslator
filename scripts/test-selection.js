const assert = require('assert').strict;
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const { EventEmitter } = require('events');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: id => id in mocks ? mocks[id] : require(id), process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(code, context, { filename: file });
  return module.exports;
}
const utils = load('src/main/selection-utils.ts');
const { placeSelectionPopup, SelectionRevision } = utils;
const area = { x: -1920, y: -120, width: 1920, height: 1080 };
for (const point of [{x:-1919,y:-119}, {x:-1,y:959}, {x:-500,y:200}]) {
  const result = placeSelectionPopup(point, {width:450,height:360}, area);
  assert(result.x >= area.x && result.x + result.width <= area.x + area.width);
  assert(result.y >= area.y && result.y + result.height <= area.y + area.height);
}
const bottom = placeSelectionPopup({x:-20,y:940},{width:450,height:360},area);
assert(bottom.y + bottom.height < 940, 'Place above a selection at the bottom edge');
const small = placeSelectionPopup({x:0,y:0},{width:450,height:360},{x:0,y:0,width:320,height:240});
assert(small.width < 320 && small.height < 240);
const revision = new SelectionRevision();
const old = revision.next(); assert(revision.current(old)); revision.next(); assert(!revision.current(old));
const original = {x:-1500,y:100,width:450,height:360};
for (const edge of utils.popupResizeEdges) {
  for (const delta of [{x:5000,y:5000},{x:-5000,y:-5000},{x:25,y:35}]) {
    const resized = utils.resizeSelectionPopup(original, edge, delta, area, {width:340,height:260});
    assert(resized.width>=340 && resized.width<=900); assert(resized.height>=260 && resized.height<=900);
    assert(resized.x>=area.x && resized.x+resized.width<=area.x+area.width);
    assert(resized.y>=area.y && resized.y+resized.height<=area.y+area.height);
    if (edge.includes('w')) assert.equal(resized.x+resized.width,original.x+original.width);
    else assert.equal(resized.x,original.x);
    if (edge.includes('n')) assert.equal(resized.y+resized.height,original.y+original.height);
    else assert.equal(resized.y,original.y);
    if (edge==='n'||edge==='s') assert.equal(resized.width,original.width);
    if (edge==='e'||edge==='w') assert.equal(resized.height,original.height);
  }
}

(async () => {
  // Verify that unchanged text never triggers image decoding when OCR is off,
  // temporary selection copies are muted, and toggles do not retain listeners.
  const helper = new EventEmitter(); helper.configure = () => {};
  let text = '', reads = 0, imageReads = 0;
  const native = { readText: async () => { reads++; return text; }, writeText: async value => { text = value; }, has: async () => { imageReads++; return false; } };
  const { clipboard } = load('src/main/clipboard.ts', { electron: { clipboard: native }, '@/common/configuration': { default: {get: () => false}, __esModule: true }, './mac-integration': { macIntegration: helper } });
  let changes = 0;
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  await clipboard.startWatching();
  clipboard.on('text-changed', () => changes++);
  text = 'first'; helper.emit('clipboard'); await settle(); assert.equal(changes, 1);
  helper.emit('clipboard'); await settle(); assert.equal(changes, 1);
  assert.equal(imageReads, 0);
  await clipboard.withPaused(async () => { text = 'temporary selection'; helper.emit('clipboard'); await settle(); text = 'first'; });
  helper.emit('clipboard'); await settle(); assert.equal(changes, 1);
  await clipboard.writeText('own result'); helper.emit('clipboard'); await settle(); assert.equal(changes, 1);
  clipboard.off('text-changed'); clipboard.on('text-changed', () => changes++);
  text = 'second'; helper.emit('clipboard'); await settle(); assert.equal(changes, 2);
  clipboard.stopWatching(); const stoppedReads = reads; helper.emit('clipboard'); await settle(); assert.equal(reads, stoppedReads);
  console.log('PASS: placement (negative coordinates, edges, small screens), stale revisions, clipboard pause/self-copy/listener lifecycle, no disabled OCR reads.');
})().catch(error => { console.error(error); process.exitCode = 1; });
