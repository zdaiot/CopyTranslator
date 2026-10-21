const assert = require('assert').strict;
const fs = require('fs');
const {JSDOM} = require('jsdom');

// Exercise the shipped HTML and script in an isolated DOM. No application,
// clipboard, network request, or desktop input is used in this test.
const dom = new JSDOM(fs.readFileSync('public/selection-popup/index.html', 'utf8'), {runScripts: 'outside-only'});
const {window} = dom;
const {document} = window;
window.HTMLElement.prototype.scrollIntoView = function () {};
// The repository's older jsdom lacks this standard method; Electron supports it.
window.Element.prototype.replaceChildren = function (...nodes) {
  while (this.firstChild) this.removeChild(this.firstChild);
  this.append(...nodes);
};
window.requestAnimationFrame = fn => fn();
const calls = [];
let update;
const initial = {
  selectionId: 1, view: 'translation', text: 'Hello', translation: '你好', status: 'done', error: '',
  engine: 'baidu', engines: [{id: 'baidu', name: '百度翻译', ai: false}, {id: 'google', name: '谷歌翻译', ai: false}],
  pinned: false, from: 'en', to: 'zh-CN',
};
window.selectionPopup = {
  state: () => Promise.resolve(initial),
  subscribe: fn => { update = fn; },
  action: (...args) => { calls.push(args); return Promise.resolve(); },
};
window.eval(fs.readFileSync('public/selection-popup/popup.js', 'utf8'));
const get = id => document.getElementById(id);
const option = id => [...document.querySelectorAll('[data-engine-id]')].find(item => item.dataset.engineId === id);
const key = (target, value) => target.dispatchEvent(new window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true}));

(async () => {
  await Promise.resolve();
  const trigger = get('engine'), menu = get('engine-menu');
  assert.equal(document.querySelector('select'), null, 'Do not depend on a native menu in the macOS panel');
  assert.equal(get('engine-name').textContent, '百度翻译');
  assert(menu.hidden);
  trigger.click();
  assert(!menu.hidden, 'Clicking the displayed engine opens the in-window menu');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, option('baidu'));
  assert.equal(option('baidu').getAttribute('aria-checked'), 'true');
  assert(menu.textContent.includes('尚未启用 AI 模型'));
  assert.equal(calls.length, 0, 'Opening the menu must not send a translation request');
  option('baidu').click();
  assert(menu.hidden); assert.equal(calls.length, 0, 'Reselecting the current engine must not spend another request');
  trigger.click();
  option('google').querySelector('span:last-child').click();
  assert.deepEqual(calls.pop(), ['engine', 'google']);
  assert.equal(get('engine-name').textContent, '谷歌翻译');
  assert(menu.hidden); assert.equal(document.activeElement, trigger);

  const aiName = '<img src=x onerror=alert(1)> / AI 模型';
  const withAI = {...initial, engine: 'google', engines: [...initial.engines, {id: 'provider/model', name: aiName, ai: true}]};
  update(withAI);
  key(trigger, 'ArrowDown');
  assert(!menu.hidden); assert.equal(document.activeElement, option('google'));
  key(document.activeElement, 'ArrowDown');
  assert.equal(document.activeElement, option('provider/model'));
  key(document.activeElement, 'Enter');
  assert.deepEqual(calls.pop(), ['engine', 'provider/model']);
  assert.equal(get('engine-name').textContent, aiName);
  assert.equal(menu.querySelector('img'), null, 'Provider/model names are text, never executable HTML');

  update({...withAI, engine: 'provider/model', status: 'loading', translation: ''});
  trigger.click();
  update({...withAI, engine: 'provider/model', status: 'done'});
  assert(!menu.hidden, 'A translation reply must not close a menu the user is browsing');
  key(document.activeElement, 'End');
  assert.equal(document.activeElement.dataset.action, 'ai-settings');
  key(document.activeElement, 'Home');
  assert.equal(document.activeElement, option('baidu'));
  key(document.activeElement, 'ArrowUp');
  assert.equal(document.activeElement.dataset.action, 'ai-settings', 'Arrow navigation wraps around');
  key(document.activeElement, ' ');
  assert.deepEqual(calls.pop(), ['ai-settings']); assert(menu.hidden);

  trigger.click(); trigger.click(); assert(menu.hidden, 'Second click on the trigger collapses the menu');
  trigger.click();
  get('source').dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true}));
  assert(menu.hidden); assert.equal(calls.length, 0, 'Clicking the result closes only the chooser');
  trigger.click(); get('pin').focus(); assert(menu.hidden, 'Tabbing outside the menu dismisses it');
  trigger.click(); key(document.activeElement, 'Escape');
  assert(menu.hidden); assert.deepEqual(calls.pop(), ['close'], 'Escape retains the popup close behavior');

  trigger.click();
  update({...withAI, selectionId: 2});
  assert(menu.hidden, 'Reopening the same selected text starts with a collapsed menu');
  trigger.click();
  update({...withAI, view: 'button', selectionId: 3});
  assert(menu.hidden); assert(document.querySelector('.popup').hidden);
  update({...withAI, selectionId: 4});
  key(trigger, 'ArrowUp');
  assert.equal(document.activeElement.dataset.action, 'ai-settings');
  const many = Array.from({length: 50}, (_, index) => ({id: `ai-${index}`, name: `Model ${index}`, ai: true}));
  update({...withAI, selectionId: 4, engines: [...initial.engines, ...many]});
  assert(!menu.hidden);
  assert.equal(menu.querySelectorAll('[role=menuitemradio]').length, 52);
  assert(menu.contains(document.activeElement), 'Rebuilding an open list keeps keyboard focus inside it');
  key(document.activeElement, 'End'); key(document.activeElement, 'ArrowUp'); key(document.activeElement, 'Enter');
  assert.deepEqual(calls.pop(), ['engine', 'ai-49']);
  assert.equal(calls.length, 0);
  update({...initial, incremental: true, accumulatedCount: 2, text: 'A B'});
  assert.equal(get('incremental').getAttribute('aria-pressed'), 'true');
  assert.equal(get('incremental-status').textContent, '已累积 2 段 · 每次全量重译');
  assert(!get('clear-accumulated').hidden); assert(!get('clear-accumulated').disabled);
  get('incremental').click(); assert.deepEqual(calls.pop(), ['incremental']);
  get('clear-accumulated').click(); assert.deepEqual(calls.pop(), ['clear-accumulated']);
  update({...initial, incremental: true, accumulatedCount: 0, status: 'idle', text: '', translation: ''});
  assert(get('clear-accumulated').disabled); assert(get('copy-source').disabled); assert(get('copy-result').disabled);
  assert(get('loading').hidden); assert(get('source').textContent.includes('已清空'));
  update({...initial, incremental: false, accumulatedCount: 0});
  assert.equal(get('incremental').getAttribute('aria-pressed'), 'false');
  assert(get('clear-accumulated').hidden); assert(get('incremental-status').hidden);
  const chat = {engine:'chat-model', engines:[{id:'chat-model',name:'阅读模型',ai:true}], messages:[], status:'idle', error:''};
  get('chat-tab').click(); assert.deepEqual(calls.pop(), ['pane', 'chat']);
  update({...initial, pane:'chat', chat, pinned:true});
  assert.equal(get('chat-tab').getAttribute('aria-selected'), 'true');
  assert(get('translation-panel').hidden); assert(!get('chat-panel').hidden);
  assert.equal(get('source-label').textContent, '已附上原文');
  assert.equal(get('engine-name').textContent, '阅读模型');
  assert.equal(document.activeElement, get('chat-input'));
  get('engine').click(); assert.equal(menu.querySelectorAll('[data-engine-id]').length, 1, 'Chat only lists enabled AI models');
  get('engine').click();
  const input = get('chat-input');
  input.value = '解释一下'; input.dispatchEvent(new window.Event('input'));
  assert(!get('chat-send').disabled);
  input.dispatchEvent(new window.Event('compositionstart')); key(input, 'Enter'); assert.equal(calls.length, 0, 'IME selection must not send');
  input.dispatchEvent(new window.Event('compositionend'));
  key(input, 'Enter'); assert.deepEqual(calls.pop(), ['chat-send', '解释一下']); assert.equal(input.value, '');
  update({...initial, pane:'chat', chat:{...chat,status:'loading',messages:[{role:'user',content:'问题',status:'done'},{role:'assistant',content:'<script>unsafe</script>',status:'loading'}]}});
  assert(get('chat-send').disabled); assert(!get('chat-stop').hidden);
  assert.equal(get('chat-messages').querySelector('script'), null, 'Conversation is text, never HTML');
  assert(get('chat-messages').textContent.includes('<script>unsafe</script>'));
  get('chat-stop').click(); assert.deepEqual(calls.pop(), ['chat-stop']);
  update({...initial, pane:'chat', chat:{...chat,status:'error',error:'Controlled failure',messages:[{role:'user',content:'问题',status:'done'},{role:'assistant',content:'partial',status:'error'}]}});
  assert(!get('chat-error').hidden); assert(!get('chat-retry').hidden);
  get('chat-retry').click(); assert.deepEqual(calls.pop(), ['chat-retry']);
  get('chat-clear').click(); assert.deepEqual(calls.pop(), ['chat-clear']);
  update({...initial, pane:'chat', chat:{...chat,engine:'',engines:[]}});
  assert(!get('chat-unavailable').hidden); assert(input.disabled);
  update({...initial, pane:'translation'});
  assert(!get('translation-panel').hidden); assert(get('chat-panel').hidden);
  // Simulate pointer capture in an isolated DOM, without desktop input.
  const handle = get('drag-handle');
  handle.setPointerCapture = () => {}; handle.hasPointerCapture = () => true; handle.releasePointerCapture = () => {};
  const pointer = (type, x, y) => {
    const event = new window.MouseEvent(type, {button:0,buttons:type==='pointerup'?0:1,screenX:x,screenY:y,bubbles:true,cancelable:true});
    Object.defineProperty(event,'pointerId',{value:1}); handle.dispatchEvent(event);
  };
  pointer('pointerdown',100,100); pointer('pointermove',180,160); pointer('pointerup',180,160);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [['drag-start',{x:100,y:100}],['drag-move',{x:180,y:160}],['drag-end']]);
  pointer('pointermove',200,200); assert.equal(calls.length,0,'Movement stops when released');
  for (const preset of ['small','medium','large']) {
    document.querySelector(`[data-size="${preset}"]`).click();
    assert.deepEqual(calls.pop(), ['size-preset', preset]);
    update({...initial,sizePreset:preset});
    assert.equal(document.querySelectorAll('.size-presets [aria-pressed="true"]').length,1);
    assert.equal(document.querySelector('.size-presets [aria-pressed="true"]').dataset.size,preset);
  }
  update({...initial,sizePreset:'custom'});
  assert.equal(document.querySelectorAll('.size-presets [aria-pressed="true"]').length,0,'Manual sizes do not claim to match a preset');
  const handles=[...document.querySelectorAll('[data-resize]')];
  assert.equal(handles.length,8);
  for (const handle of handles) {
    handle.setPointerCapture=()=>{}; handle.hasPointerCapture=()=>true; handle.releasePointerCapture=()=>{};
    for (const [type,x,y] of [['pointerdown',100,100],['pointermove',140,130],['pointercancel',140,130],['pointermove',200,200]]) {
      const event=new window.MouseEvent(type,{button:0,buttons:type==='pointercancel'?0:1,screenX:x,screenY:y,bubbles:true,cancelable:true});
      Object.defineProperty(event,'pointerId',{value:5});
      // A non-activating panel may deliver moves to adjacent content before
      // pointer capture takes effect; all eight handles must keep resizing.
      (type==='pointermove'?get('source'):handle).dispatchEvent(event);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))),[['resize-start',{x:100,y:100,edge:handle.dataset.resize}],['resize-move',{x:140,y:130}],['resize-end']]);
  }
  update({...initial,pinned:true});
  assert.equal(get('pin').getAttribute('aria-label'),'取消固定浮窗');
  assert(get('hint').textContent.includes('下次翻译新开窗口'));
  update({...initial,pinned:false}); assert(get('hint').textContent.includes('留在当前桌面'));
  dom.window.close();
  console.log('PASS: shipped popup menu open/close, builtin and AI switching, no duplicate requests, safe labels, keyboard navigation, AI setup, async updates, reopening and long lists.');
})().catch(error => { dom.window.close(); console.error(error); process.exitCode = 1; });
