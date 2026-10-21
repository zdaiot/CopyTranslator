const assert=require('assert').strict, fs=require('fs'), ts=require('typescript'), vm=require('vm');
const {EventEmitter}=require('events');
function load(file,mocks={}) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>mocks[id]||require(id),process:{platform:'darwin',env:{},pid:100},console,setTimeout,clearTimeout});
  return module.exports;
}
const helper=new EventEmitter(); helper.configure=()=>{};
let captures=0, allowed=true, nextCapture, offers=[], shows=[], spaceChanges=0;
helper.request=async command=>{assert.equal(command,'capture');captures++;return nextCapture ? nextCapture : {text:'current selection'};};
const values={selectionPopup:true,selectionPopupTrigger:'selectionShortcut'};
const utils=load('src/main/selection-utils.ts');
const {eventListener:listener}=load('src/main/event-listener.ts',{
  electron:{BrowserWindow:{getFocusedWindow:()=>null},screen:{getCursorScreenPoint:()=>({x:30,y:40})}},
  './simulate':{__esModule:true,default:{}},'./clipboard':{clipboard:{withPaused:fn=>fn()}},
  '../common/event-bus':{__esModule:true,default:{}},'../common/configuration':{__esModule:true,default:{get:key=>values[key]}},
  './focus-handler':{foregroundApplication:async()=>({pid:200,name:'Fixture'}),isValidWindow:async()=>allowed},
  './mac-integration':{macIntegration:helper},'./windows-integration':{windowsIntegration:{stop(){}}},
  './selection-popup':{selectionPopup:{init(){},hide(){},dismiss(){},workspaceChanged(){spaceChanges++;},contains:()=>false,pointerDown(){},show:text=>shows.push(text),offer:text=>offers.push(text)}},
  './selection-utils':utils,
});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  listener.bind(); helper.emit('selection-gesture',{x:10,y:20}); await wait(110);
  assert.equal(captures,0,'Shortcut-only mode must not capture passive selections');
  await listener.translateSelection(); assert.deepEqual(shows,['current selection']);
  values.selectionPopupTrigger='selectionButton'; helper.emit('selection-gesture',{x:10,y:20}); await wait(110);
  assert.deepEqual(offers,['current selection']); assert.equal(shows.length,1);
  allowed=false; await listener.translateSelection(); assert.equal(captures,2,'Application scope applies to shortcuts too'); allowed=true;
  values.selectionPopup=false; await listener.translateSelection(); assert.equal(captures,2);
  values.selectionPopup=true; let resolve; nextCapture=new Promise(r=>resolve=r);
  const pending=listener.translateSelection(); await wait(110); listener.refresh(); resolve({text:'stale selection'}); await pending;
  assert.equal(shows.length,1,'Changing modes or disabling selection invalidates pending capture');
  nextCapture=null; helper.emit('selection-gesture',{x:10,y:20}); helper.emit('pointerdown',{x:100,y:100}); await wait(110);
  assert.equal(offers.length,1,'A new click invalidates the pending gesture');
  nextCapture=new Promise(r=>resolve=r);
  const switching=listener.translateSelection(); await wait(110);
  helper.emit('space-changed'); resolve({text:'old desktop'}); await switching;
  assert.equal(spaceChanges,1); assert.equal(shows.length,1,'A Space change invalidates capture before it can open a stale popup');
  listener.stop(); console.log('PASS: shortcut-only capture gating, explicit fresh capture, application lists, master switch and capture cancellation.');
})().catch(error=>{listener.stop();console.error(error);process.exitCode=1;});
