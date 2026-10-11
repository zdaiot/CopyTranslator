const assert=require('assert').strict, fs=require('fs'), ts=require('typescript'), vm=require('vm');
function load(file,mocks={}) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>mocks[id]||require(id),process,console});
  return module.exports;
}
const helper=load('src/common/selection-shortcut.ts');
assert.equal(helper.formatSelectionShortcut(helper.defaultSelectionShortcut,true),'⌘⇧X');
assert.equal(helper.formatSelectionShortcut(helper.defaultSelectionShortcut,false),'Ctrl+Shift+X');
assert.equal(helper.selectionShortcutFromKey({code:'KeyX',metaKey:true,shiftKey:true},true),'CmdOrCtrl+Shift+X');
assert.equal(helper.selectionShortcutFromKey({code:'KeyJ',ctrlKey:true,altKey:true},false),'CmdOrCtrl+Alt+J');
assert.equal(helper.selectionShortcutFromKey({code:'KeyX',shiftKey:true},true),'');
assert(!helper.validSelectionShortcut({key:'X'})); assert(!helper.validSelectionShortcut('X'));
assert(!helper.validSelectionShortcut('Shift+X')); assert(!helper.validSelectionShortcut('Command+Command+X'));
const id=helper.selectionShortcutIdentity;
const registered=new Map(), occupied=new Set(), invoked=[];
let saved, failSave=false;
const globalShortcut={
  register:(key,fn)=>{if(registered.has(id(key))||occupied.has(id(key)))return false;registered.set(id(key),fn);return true;},
  unregister:key=>registered.delete(id(key)),isRegistered:key=>registered.has(id(key)),
};
const {ShortcutManager}=load('src/main/shortcut.ts',{
  electron:{globalShortcut},'../common/types':{roles:[]},'../common/event-bus':{__esModule:true,default:{}},
  '../common/env':{env:{shortcut:'test-shortcuts.json'}},'../common/selection-shortcut':helper,
  '../common/shortcuts':{resetFile:(_path,value)=>{if(failSave)throw new Error('Disk full');saved=new Map(value);}},
});
const manager=new ShortcutManager(key=>invoked.push(key));
manager.shortcuts=new Map([['selectionTranslate',helper.defaultSelectionShortcut],['focus','Control+Alt+F']]);manager.register();
assert(manager.selectionStatus().registered);
let result=manager.setSelection('CmdOrCtrl+Alt+J');assert(result.ok);assert.equal(saved.get('focus'),'Control+Alt+F');
assert(!globalShortcut.isRegistered(helper.defaultSelectionShortcut));
registered.get(id('CmdOrCtrl+Alt+J'))();assert.deepEqual(invoked,['selectionTranslate'],'New binding works without restarting');
occupied.add(id('CmdOrCtrl+Shift+K'));result=manager.setSelection('CmdOrCtrl+Shift+K');assert.equal(result.error,'conflict');assert(manager.selectionStatus().registered);
failSave=true;result=manager.setSelection('CmdOrCtrl+Shift+L');assert.equal(result.error,'save');assert(!globalShortcut.isRegistered('CmdOrCtrl+Shift+L'));assert(manager.selectionStatus().registered);failSave=false;
result=manager.setSelection('Ctrl+Alt+F');assert.equal(result.error,'conflict','Aliases of another app binding must be rejected');
manager.recordSelection(10,true);manager.recordSelection(11,true);assert.equal(registered.size,0,'Recording temporarily suspends app shortcuts');
manager.recordSelection(10,false);assert.equal(registered.size,0);
manager.recordSelection(11,false);assert.equal(registered.size,2,'Ending or destroying the last editor restores shortcuts');
const before=manager.shortcuts.get('selectionTranslate');result=manager.setSelection('bogus');assert(!result.ok);assert.equal(manager.shortcuts.get('selectionTranslate'),before);

// A failed atomic rename must leave the previous settings intact.
let files=new Map([['shortcuts.json','previous settings']]);
const common=load('src/common/shortcuts.ts',{
  './env':{env:{}},'./types':{mapToObj:m=>Object.fromEntries(m),objToMap:o=>new Map(Object.entries(o))},
  './constant':{version:'test',compatible:()=>true},'./selection-shortcut':helper,
  fs:{__esModule:true,default:{writeFileSync:(path,value)=>files.set(path,value),renameSync:()=>{throw new Error('Read-only destination');},existsSync:path=>files.has(path),unlinkSync:path=>files.delete(path)}},
});
assert.throws(()=>common.resetFile('shortcuts.json',manager.shortcuts));
assert.equal(files.get('shortcuts.json'),'previous settings');assert.equal(files.size,1);
console.log('PASS: shortcut capture/display, immediate rebinding, collision/save rollback, preserving custom keys, recording cleanup and atomic persistence.');
