// Compatibility patches for shortcut-capture 1.2.3. Kept here (and checked) so
// clean installs reproduce them; unrelated dependencies are never modified.
const fs = require('fs');
const path = require('path');
const root = path.dirname(require.resolve('shortcut-capture/package.json'));
function patch(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Unsupported shortcut-capture source: ${file}`);
  fs.writeFileSync(file, source.replace(before, after));
}
patch(path.join(root, 'dist/main.js'), 'webPreferences:{nodeIntegration:!0}', 'webPreferences:{nodeIntegration:!0,contextIsolation:!1,sandbox:!1}');
patch(path.join(root, 'dist/main.js'), 'l.clipboard.writeImage(l.nativeImage.createFromDataURL(n))', 'l.clipboard.write([new l.ClipboardItem({"image/png":new Blob([l.nativeImage.createFromDataURL(n).toPNG()],{type:"image/png"})})])');
const shim = 'e.exports=(()=>{const electron=require("electron"),remote=require("@electron/remote");return Object.assign({},electron,{remote,screen:remote.screen,desktopCapturer:{getSources:(options,callback)=>remote.desktopCapturer.getSources(options).then(sources=>callback(null,sources),callback)}})})()';
const directory = path.join(root, 'dist/renderer/js');
for (const file of fs.readdirSync(directory).filter(name => /^renderer\..*\.js$/.test(name))) {
  patch(path.join(directory, file), 'e.exports=require("electron")', shim);
}
console.log('Prepared shortcut-capture for the current Electron APIs.');
