const api = window.selectionPopup;
const byId = (id) => document.getElementById(id);
const names = {'zh-CN':'简体中文','zh-TW':'繁體中文',en:'英语',ja:'日语',ko:'韩语',fr:'法语',de:'德语',auto:'自动检测'};
let sourceText = '';
let optionSignature = '';
let selectedEngine = '';
let engines = [];
let selectionId;
const engineButton = byId('engine');
const engineMenu = byId('engine-menu');

function closeEngineMenu(restoreFocus = false) {
  engineMenu.hidden = true;
  engineButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) engineButton.focus({preventScroll: true});
}
function menuItems() { return [...engineMenu.querySelectorAll('button:not(:disabled)')]; }
function focusMenuItem(item) {
  if (!item) return;
  item.focus({preventScroll: true});
  item.scrollIntoView({block: 'nearest'});
}
function openEngineMenu(last = false) {
  engineMenu.hidden = false;
  engineButton.setAttribute('aria-expanded', 'true');
  const items = menuItems();
  focusMenuItem(last ? items[items.length - 1] : items.find(item => item.getAttribute('aria-checked') === 'true') || items[0]);
}
function updateEngineLabel() {
  const name = engines.find(engine => engine.id === selectedEngine)?.name || '选择翻译引擎';
  byId('engine-name').textContent = name;
  engineButton.title = `切换翻译引擎 · ${name}`;
  engineButton.setAttribute('aria-label', `翻译引擎：${name}`);
  engineMenu.querySelectorAll('[data-engine-id]').forEach(item => {
    item.setAttribute('aria-checked', String(item.dataset.engineId === selectedEngine));
  });
}
function renderEngineMenu() {
  // Keep the chooser in the same web contents. A native <select> menu can fail
  // to appear above a non-activating macOS panel in another app's fullscreen Space.
  engineMenu.replaceChildren();
  [false, true].forEach(ai => {
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', ai ? 'AI 翻译模型' : '翻译引擎');
    const heading = document.createElement('div'); heading.className = 'menu-heading';
    heading.textContent = ai ? 'AI 翻译模型' : '翻译引擎'; heading.setAttribute('aria-hidden', 'true');
    group.append(heading);
    const choices = engines.filter(engine => !!engine.ai === ai);
    choices.forEach(({id, name}) => {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'menu-item';
      item.setAttribute('role', 'menuitemradio'); item.dataset.engineId = id; item.tabIndex = -1;
      const check = document.createElement('span'); check.className = 'menu-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = name;
      item.append(check, label); group.append(item);
    });
    if (!choices.length) {
      const empty = document.createElement('div'); empty.className = 'menu-empty';
      empty.textContent = ai ? '尚未启用 AI 模型' : '没有可用的翻译引擎'; group.append(empty);
    }
    engineMenu.append(group);
  });
  const setup = document.createElement('button'); setup.type = 'button'; setup.className = 'menu-item menu-setup';
  setup.setAttribute('role', 'menuitem'); setup.tabIndex = -1; setup.dataset.action = 'ai-settings';
  setup.textContent = '＋ 配置 AI 翻译商…'; engineMenu.append(setup);
}
function render(state) {
  if (!state) return;
  const button = state.view === "button";
  byId("selection-button").hidden = !button;
  document.querySelector(".popup").hidden = button;
  if (selectionId !== state.selectionId) { closeEngineMenu(); selectionId = state.selectionId; }
  if (button) { closeEngineMenu(); return; }
  if (sourceText !== state.text) closeEngineMenu();
  engines = state.engines;
  const signature = JSON.stringify(state.engines);
  if (signature !== optionSignature) {
    const wasOpen = !engineMenu.hidden;
    renderEngineMenu();
    optionSignature = signature;
    selectedEngine = state.engine;
    updateEngineLabel();
    if (wasOpen) openEngineMenu();
  }
  selectedEngine = state.engine;
  updateEngineLabel();
  if (sourceText !== state.text) { byId('source').classList.remove('expanded'); byId('expand').textContent = '展开原文'; }
  sourceText = state.text;
  byId('source').textContent = state.text;
  byId('result').textContent = state.translation;
  byId('error').textContent = state.error;
  byId('loading').hidden = state.status !== 'loading';
  byId('error').hidden = state.status !== 'error';
  byId('retry').hidden = state.status !== 'error';
  byId('copy-result').disabled = !state.translation;
  byId('pin').setAttribute('aria-pressed', String(state.pinned));
  byId('pin').title = state.pinned ? '取消固定' : '固定浮窗';
  byId('hint').textContent = state.pinned ? '已固定 · Esc 关闭' : '点击外部关闭 · Esc';
  byId('direction').textContent = state.from && state.to ? `${names[state.from] || state.from} → ${names[state.to] || state.to}` : '译文';
  document.querySelector('.result-card').setAttribute('aria-busy', String(state.status === 'loading'));
  requestAnimationFrame(() => { byId('expand').hidden = !byId('source').classList.contains('expanded') && byId('source').scrollHeight <= byId('source').clientHeight + 2; });
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  api.action(button.dataset.action);
  if (button.dataset.action.startsWith('copy-')) { byId('hint').textContent = '已复制'; }
}));
engineButton.addEventListener('click', () => {
  if (engineMenu.hidden) openEngineMenu(); else closeEngineMenu(true);
});
engineButton.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); openEngineMenu(event.key === 'ArrowUp');
  }
});
engineMenu.addEventListener('click', event => {
  const item = event.target.closest('button');
  if (!item || !engineMenu.contains(item)) return;
  if (item.dataset.action === 'ai-settings') { closeEngineMenu(); api.action('ai-settings'); return; }
  const id = item.dataset.engineId;
  if (!engines.some(engine => engine.id === id)) return;
  closeEngineMenu(true);
  if (id === selectedEngine) return;
  selectedEngine = id;
  updateEngineLabel();
  api.action('engine', id);
});
engineMenu.addEventListener('keydown', event => {
  const items = menuItems();
  const index = items.indexOf(document.activeElement);
  if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
    event.preventDefault(); items[index].click(); return;
  }
  let next;
  if (event.key === 'ArrowDown') next = (index + 1) % items.length;
  else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  if (next !== undefined) { event.preventDefault(); focusMenuItem(items[next]); }
});
document.addEventListener('pointerdown', event => {
  if (!engineMenu.contains(event.target) && !engineButton.contains(event.target)) closeEngineMenu();
});
document.addEventListener('focus', event => {
  if (!engineMenu.contains(event.target) && !engineButton.contains(event.target)) closeEngineMenu();
}, true);
byId('pin').addEventListener('click', () => api.action('pin'));
byId('expand').addEventListener('click', () => { const expanded = byId('source').classList.toggle('expanded'); byId('expand').textContent = expanded ? '收起原文' : '展开原文'; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeEngineMenu(); api.action('close'); } });
api.subscribe(render);
api.state().then(render);
