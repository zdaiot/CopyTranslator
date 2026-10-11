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
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>mocks[id] || require(id),process,console,setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?100:ms),clearTimeout,global:{controller}},{filename:file});
  return module.exports;
}
let window, handlers = {}, requests = [];
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
  '@/common/configuration':{__esModule:true,default:{get:key=>values[key]}},
  '@/common/translate/translators':{getTranslator:id=>({translate:text=>new Promise((resolve,reject)=>requests.push({id,text,resolve,reject}))}),getEnabledWithCustomIds:()=>['mock', ...values.customTranslators],hasTranslator:id=>['mock', ...values.customTranslators].includes(id)},
  '@/common/translate/translator-name-resolver':{TranslatorNameResolver:{getDisplayName:id=>id,isCustomTranslator:id=>values.customTranslators.includes(id)}},
  '@/common/translate/helper':{autoReSegment:value=>({resultString:value}),normalizeAppend:text=>text},
  './clipboard':{clipboard:{writeText:()=>{}}},'./selection-utils':utils,
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
  requests[beforeAI].resolve('AI result'); await wait(0);
  await handlers['selection-popup:action']({sender:{}}, 'ai-settings');
  assert.equal(settingsActions.length, 0, 'Reject settings actions from other renderers');
  await handlers['selection-popup:action']({sender:window.webContents}, 'ai-settings');
  assert.deepEqual(settingsActions, [['settings', 'customTranslators']]); assert(!window.visible);
  popup.stop();
  console.log('PASS: popup IPC isolation, stale replies, pin/outside close, dismissed requests, translation errors, button gating/focus/resize, pinned button behavior, shortcut-only/direct/disabled modes, AI engine routing and setup IPC.');
})().catch(error=>{popup.stop();console.error(error);process.exitCode=1;});
