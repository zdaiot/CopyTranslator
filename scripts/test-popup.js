const assert = require('assert').strict;
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const { EventEmitter } = require('events');
const settingsActions = [];
const controller = {handle: (...args) => settingsActions.push(args)};
function load(file, mocks) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>mocks[id] || require(id),process,console,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?100:ms),clearTimeout,global:{controller}},{filename:file});
  return module.exports;
}
let window, handlers = {}, requests = [], copied = [];
class FakeWindow extends EventEmitter {
  constructor(options) { super(); window=this; this.options=options; this.visible=false; this.bounds={x:0,y:0,width:450,height:360}; this.webContents=new EventEmitter(); this.webContents.send=(name,state)=>{this.state=JSON.parse(JSON.stringify(state));}; this.webContents.setWindowOpenHandler=()=>{}; }
  setAlwaysOnTop(){} setVisibleOnAllWorkspaces(_enabled, options){this.workspaces=options;} loadFile(){} isDestroyed(){return !!this.destroyed;}
  setMinimumSize(){} setResizable(value){this.resizable=value;} setFocusable(value){this.focusable=value;}
  showInactive(){this.visible=true;} hide(){this.visible=false;} destroy(){this.destroyed=true;this.emit('closed');}
  isVisible(){return this.visible;} getBounds(){return this.bounds;} setBounds(bounds){this.bounds=bounds;}
}
const values={selectionPopup:true,translatorType:'mock','translator-enabled':['mock'],customTranslators:[],sourceLanguage:'en',targetLanguage:'zh-CN'};
const utils=load('src/main/selection-utils.ts',{});
const {selectionPopup:popup}=load('src/main/selection-popup.ts',{
  electron:{app:{isPackaged:false},BrowserWindow:FakeWindow,ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1440,height:900}})}},
  '@/common/configuration':{__esModule:true,default:{get:key=>values[key],set:(key,value)=>{values[key]=value;popup.syncIncrementalMode(!!value);return true;}}},
  '@/common/translate/translators':{getTranslator:id=>({translate:text=>new Promise((resolve,reject)=>requests.push({id,text,resolve,reject})), ...(id === 'provider-model' ? {translateStream: (text, from, to, progress, signal) => new Promise((resolve,reject)=>requests.push({id,text,resolve,reject,progress,signal}))} : {})}),getEnabledWithCustomIds:()=>['mock', ...values.customTranslators],hasTranslator:id=>['mock', ...values.customTranslators].includes(id)},
  '@/common/translate/translator-name-resolver':{TranslatorNameResolver:{getDisplayName:id=>id,isCustomTranslator:id=>values.customTranslators.includes(id)}},
  '@/common/translate/helper':{autoReSegment:value=>({resultString:value}),normalizeAppend:text=>text,appendSourceText:load('src/common/translate/helper.ts',{}).appendSourceText},
  './clipboard':{clipboard:{writeText:text=>{copied.push(text);return Promise.resolve();}}},'./selection-utils':utils,
});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  popup.show('first',{x:500,y:500}); window.emit('ready-to-show');
  assert.equal(handlers['selection-popup:state']({sender:{}}),null,'Deny IPC from other renderers');
  await wait(150); popup.show('second',{x:500,y:500}); await wait(150);
  requests[1].resolve('second result'); await wait(0); requests[0].resolve('old result'); await wait(0);
  assert.equal(window.state.translation,'second result','Late reply must not replace newest selection');
  handlers['selection-popup:action']({sender:window.webContents},'pin');
  popup.pointerDown({x:0,y:0}); assert(window.visible,'Pinned popup survives an outside click');
  handlers['selection-popup:action']({sender:window.webContents},'pin');
  popup.pointerDown({x:0,y:0}); assert(!window.visible);
  popup.show('dismiss before reply',{x:500,y:500}); await wait(150); popup.hide();
  requests[2].resolve('late'); await wait(0); assert(!window.visible);
  popup.show('failure',{x:500,y:500}); await wait(150); requests[3].reject('test failure'); await wait(0);
  assert.equal(window.state.status,'error');
  popup.hide(); await wait(60); popup.pointerDown({x:0,y:0}); await wait(60);
  assert(window.destroyed, 'Repeated outside clicks must not retain the hidden renderer');
  values.selectionPopupTrigger='selectionButton';
  const before=requests.length;
  popup.offer('button only',{x:600,y:600}); window.emit('ready-to-show');
  await wait(150); assert.equal(requests.length,before,'Selection button must not send any translation request');
  assert.equal(window.state.view,'button'); assert.equal(window.bounds.width,40); assert.equal(window.focusable,false);
  if(process.platform==='darwin') {
    assert.equal(window.options.type,'panel','Use a non-activating panel to join fullscreen Spaces without hiding the Dock');
    assert.equal(window.workspaces.visibleOnFullScreen,true);
    assert.equal(window.workspaces.skipTransformProcessType,true,'Do not transform the app to hide its Dock icon');
  }
  window.emit('blur'); assert(window.visible,'An inactive button must survive source app activation changes');
  await handlers['selection-popup:action']({sender:{}},'translate');
  await wait(150); assert.equal(requests.length,before,'Other renderers cannot translate button text');
  await handlers['selection-popup:action']({sender:window.webContents},'translate');
  await wait(150); assert.equal(requests.length,before+1); assert.equal(window.state.view,'translation');
  assert.equal(window.focusable,true); assert.equal(window.bounds.width,450);
  requests[before].resolve('button translation'); await wait(0);
  handlers['selection-popup:action']({sender:window.webContents},'pin');
  popup.offer('do not replace pinned result',{x:0,y:0}); await wait(150);
  assert.equal(requests.length,before+1); assert.equal(window.state.text,'button only');
  popup.hide(); popup.offer('dismissed button',{x:600,y:600}); popup.hide();
  await handlers['selection-popup:action']({sender:window.webContents},'translate');
  assert.equal(requests.length,before+1,'A dismissed button cannot translate stale text');
  values.selectionPopupTrigger='selectionShortcut'; popup.offer('ignored drag',{x:600,y:600});
  await wait(150); assert.equal(requests.length,before+1,'Shortcut-only mode ignores passive selection');
  values.selectionPopupTrigger='selectionDirect'; popup.offer('direct selection',{x:600,y:600});
  window.emit('ready-to-show'); await wait(150); assert.equal(requests.length,before+2);
  requests[before+1].resolve('direct result'); await wait(0);
  values.selectionPopup=false; popup.hide(); popup.offer('disabled',{x:600,y:600}); popup.show('disabled shortcut',{x:600,y:600});
  await wait(150); assert.equal(requests.length,before+2,'Master switch disables all modes');
  values.selectionPopup = true; values.customTranslators = ['provider-model'];
  popup.show('AI selection', {x: 500, y: 500}); window.emit('ready-to-show'); await wait(150);
  requests[requests.length - 1].resolve('built-in result'); await wait(0);
  assert(window.state.engines.some(engine => engine.id === 'provider-model' && engine.ai), 'Enabled AI models appear in the popup');
  const beforeAI = requests.length;
  await handlers['selection-popup:action']({sender:window.webContents}, 'engine', 'unknown');
  await wait(150); assert.equal(requests.length, beforeAI, 'Reject unlisted engines');
  await handlers['selection-popup:action']({sender:window.webContents}, 'engine', 'provider-model');
  await wait(150); assert.equal(requests[beforeAI].id, 'provider-model', 'Send translation to the selected AI model');
  requests[beforeAI].progress('AI partial');
  assert.equal(window.state.translation, 'AI partial'); assert.equal(window.state.status, 'loading');
  requests[beforeAI].resolve('AI result'); await wait(0);
  assert.equal(window.state.status, 'done');
  popup.show('stream to cancel', {x: 500, y: 500}); await wait(150);
  const cancelled = requests.at(-1);
  popup.show('newer selection', {x: 500, y: 500}); await wait(150);
  assert(cancelled.signal.aborted, 'Replacing a selection cancels the old network stream');
  cancelled.progress('stale chunk'); cancelled.resolve('stale completion'); await wait(0);
  assert.notEqual(window.state.translation, 'stale chunk'); assert.notEqual(window.state.translation, 'stale completion');
  const newest = requests.at(-1);
  newest.progress('new partial'); assert.equal(window.state.translation, 'new partial');
  await handlers['selection-popup:action']({sender:{}}, 'ai-settings');
  assert.equal(settingsActions.length, 0, 'Reject settings actions from other renderers');
  await handlers['selection-popup:action']({sender:window.webContents}, 'ai-settings');
  assert.deepEqual(settingsActions, [['settings', 'customTranslators']]); assert(!window.visible);
  assert(newest.signal.aborted, 'Closing a popup cancels a running stream');
  newest.resolve('ignored after close'); await wait(0); assert(!window.visible);
  // Incremental selection shares the main switch, accumulates source, and
  // always sends the full accumulated text. Hiding only dismisses the view.
  const action = (name, value) => handlers['selection-popup:action']({sender: window.webContents}, name, value);
  const finish = async (text, translation = 'translated ' + text) => {
    popup.show(text, {x: 500, y: 500}); window.emit('ready-to-show'); await wait(150);
    const request = requests.at(-1); request.resolve(translation); await wait(0); return request;
  };
  await finish('A', '译文 A');
  const beforeToggle = requests.length;
  await action('incremental');
  assert.equal(values.incrementalCopy, true, 'The popup toggles the same persisted setting as the main window');
  assert.equal(window.state.incremental, true); assert.equal(window.state.accumulatedCount, 1);
  assert.equal(requests.length, beforeToggle, 'Enabling accumulation does not retranslate the current result');
  popup.hide();
  assert.equal((await finish('B', '译文 AB')).text, 'A B');
  assert.equal(window.state.accumulatedCount, 2);
  await action('copy-result'); assert.equal(copied.at(-1), '译文 AB');
  await action('retry'); await wait(150);
  assert.equal(requests.at(-1).text, 'A B'); requests.at(-1).resolve('retried AB'); await wait(0);
  await action('engine', 'mock'); await wait(150);
  assert.equal(requests.at(-1).text, 'A B'); requests.at(-1).resolve('other engine AB'); await wait(0);
  assert.equal((await finish('B')).text, 'A B'); assert.equal(window.state.accumulatedCount, 2);
  popup.hide(); await wait(120); assert(window.destroyed);
  assert.equal((await finish('C')).text, 'A B C'); assert.equal(window.state.accumulatedCount, 3, 'Renderer cleanup must not erase a reading session');
  values.selectionPopupTrigger = 'selectionButton';
  const beforeOffer = requests.length;
  popup.hide(); popup.offer('ignored offer', {x: 500, y: 500});
  assert.equal(window.state.accumulatedCount, 3); popup.hide();
  popup.offer('D', {x: 500, y: 500});
  assert.equal(requests.length, beforeOffer, 'Unclicked offers do not collect or translate');
  await action('translate'); await action('translate'); await wait(150);
  assert.equal(requests.length, beforeOffer + 1); assert.equal(requests.at(-1).text, 'A B C D');
  requests.at(-1).resolve('ABCD'); await wait(0); assert.equal(window.state.accumulatedCount, 4);
  values.incrementalCopy = false; popup.syncIncrementalMode(false);
  assert.equal(window.state.incremental, false); assert.equal(window.state.accumulatedCount, 0);
  assert.equal((await finish('Fresh')).text, 'Fresh', 'Disabling the shared switch makes the next selection standalone');
  values.incrementalCopy = true; popup.syncIncrementalMode(true);
  const beforeLimit = requests.length;
  popup.show('x'.repeat(20000), {x: 500, y: 500}); await wait(150);
  assert.equal(requests.length, beforeLimit); assert.equal(window.state.status, 'error');
  assert.equal(window.state.text, 'Fresh'); assert.equal(window.state.accumulatedCount, 1, 'Reject oversize additions without poisoning the accumulated source');
  assert.equal((await finish('next')).text, 'Fresh next');
  await action('engine', 'provider-model'); await wait(150);
  const duringClear = requests.at(-1); duringClear.progress('unfinished accumulated output');
  await action('clear-accumulated');
  assert(duringClear.signal.aborted); assert.equal(window.state.status, 'idle');
  assert.equal(window.state.accumulatedCount, 0); assert.equal(window.state.text, ''); assert.equal(window.state.translation, '');
  duringClear.progress('obsolete'); duringClear.resolve('obsolete'); await wait(0);
  assert.equal(window.state.translation, '', 'Clear cancels stale streaming updates');
  assert.equal((await finish('Restart')).text, 'Restart'); assert.equal(window.state.accumulatedCount, 1);
  await handlers['selection-popup:action']({sender: {}}, 'incremental');
  await handlers['selection-popup:action']({sender: {}}, 'clear-accumulated');
  assert.equal(values.incrementalCopy, true); assert.equal(window.state.accumulatedCount, 1);
  popup.clearAccumulated(); popup.hide(); await wait(120);
  popup.show('x'.repeat(20001), {x: 500, y: 500}); window.emit('ready-to-show');
  assert(window.visible, 'Even an oversize first selection must visibly report its error');
  assert.equal(window.state.status, 'error'); assert.equal(window.state.accumulatedCount, 0);
  popup.hide();
  popup.stop();
  console.log('PASS: popup IPC isolation, stale replies, pin/outside close, dismissed requests, translation errors, button gating/focus/resize, pinned button behavior, shortcut-only/direct/disabled modes, AI engine routing, setup IPC, shared incremental source mode, full retranslation, explicit collection, retry/dedup, clear/cancellation, limits and renderer recreation.');
})().catch(error=>{popup.stop();console.error(error);process.exitCode=1;});
