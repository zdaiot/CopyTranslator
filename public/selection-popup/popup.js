const api = window.selectionPopup;
const byId = (id) => document.getElementById(id);
const names = {'zh-CN':'简体中文','zh-TW':'繁體中文',en:'英语',ja:'日语',ko:'韩语',fr:'法语',de:'德语',auto:'自动检测'};
let sourceText = '';
let optionSignature = '';
let selectedEngine = '';
let engines = [];
let selectionId;
let activePane = 'translation';
let chatState = {engine: '', engines: [], messages: [], status: 'idle', error: ''};
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
  const chat = activePane === 'chat';
  const label = chat ? '对话模型' : '翻译引擎';
  const name = engines.find(engine => engine.id === selectedEngine)?.name || `选择${label}`;
  byId('engine-name').textContent = name;
  engineButton.title = chat ? `对话模型 · ${name}（切换后开始新对话）` : `切换翻译引擎 · ${name}`;
  engineButton.setAttribute('aria-label', `${label}：${name}`);
  engineMenu.querySelectorAll('[data-engine-id]').forEach(item => {
    item.setAttribute('aria-checked', String(item.dataset.engineId === selectedEngine));
  });
}
function renderEngineMenu() {
  // Keep the chooser in the same web contents. A native <select> menu can fail
  // to appear above a non-activating macOS panel in another app's fullscreen Space.
  engineMenu.replaceChildren();
  (activePane === 'chat' ? [true] : [false, true]).forEach(ai => {
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', ai ? 'AI 模型' : '翻译引擎');
    const heading = document.createElement('div'); heading.className = 'menu-heading';
    heading.textContent = ai ? (activePane === 'chat' ? '对话模型' : 'AI 翻译模型') : '翻译引擎'; heading.setAttribute('aria-hidden', 'true');
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
function updateChatSend() {
  byId('chat-send').disabled = chatState.status === 'loading' || !chatState.engine || !sourceText || !byId('chat-input').value.trim();
}
function renderChat(chat) {
  const list = byId('chat-messages');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
  list.replaceChildren();
  if (!chat.messages.length) {
    const empty = document.createElement('div'); empty.className = 'chat-empty';
    empty.textContent = '这段话有哪些难点？可以让 AI 解释、总结或比较。'; list.append(empty);
  }
  chat.messages.forEach(message => {
    const item = document.createElement('div'); item.className = `chat-message ${message.role}`;
    const label = document.createElement('span'); label.className = 'chat-message-label';
    label.textContent = message.role === 'user' ? '你' : 'AI';
    const content = document.createElement('div'); content.textContent = message.content || (message.status === 'loading' ? '正在回答…' : '');
    item.append(label, content);
    if (message.status === 'stopped' || message.status === 'error') {
      const status = document.createElement('div'); status.className = 'chat-message-status'; status.textContent = message.status === 'stopped' ? '已停止' : '回答未完成'; item.append(status);
    }
    list.append(item);
  });
  if (atBottom) list.scrollTop = list.scrollHeight;
  byId('chat-unavailable').hidden = !!chat.engines.length;
  byId('chat-input').disabled = !chat.engine || !sourceText;
  byId('chat-stop').hidden = chat.status !== 'loading';
  byId('chat-error').textContent = chat.error;
  byId('chat-error').hidden = !chat.error;
  const last = chat.messages[chat.messages.length - 1];
  byId('chat-retry').hidden = chat.status === 'loading' || !last || last.role !== 'assistant' || last.status === 'done';
  byId('chat-clear').disabled = !chat.messages.length;
  updateChatSend();
}
function render(state) {
  if (!state) return;
  const button = state.view === "button";
  byId("selection-button").hidden = !button;
  document.querySelector(".popup").hidden = button;
  if (selectionId !== state.selectionId) { closeEngineMenu(); selectionId = state.selectionId; byId('chat-input').value = ''; }
  if (button) { closeEngineMenu(); return; }
  if (sourceText !== state.text) closeEngineMenu();
  const previousPane = activePane;
  activePane = state.pane || 'translation';
  chatState = state.chat || {engine: '', engines: [], messages: [], status: 'idle', error: ''};
  if (activePane !== previousPane) closeEngineMenu();
  engines = activePane === 'chat' ? chatState.engines : state.engines;
  const signature = activePane + JSON.stringify(engines);
  if (signature !== optionSignature) {
    const wasOpen = !engineMenu.hidden;
    renderEngineMenu();
    optionSignature = signature;
    selectedEngine = activePane === 'chat' ? chatState.engine : state.engine;
    updateEngineLabel();
    if (wasOpen) openEngineMenu();
  }
  selectedEngine = activePane === 'chat' ? chatState.engine : state.engine;
  updateEngineLabel();
  if (sourceText !== state.text) { byId('source').classList.remove('expanded'); byId('expand').textContent = '展开原文'; }
  sourceText = state.text;
  const chatting = activePane === 'chat';
  document.querySelector('.popup').classList.toggle('chat-mode', chatting);
  byId('translation-panel').hidden = chatting;
  byId('chat-panel').hidden = !chatting;
  byId('source-label').textContent = chatting ? '已附上原文' : '原文';
  document.querySelectorAll('[data-pane]').forEach(tab => { tab.setAttribute('aria-selected', String(tab.dataset.pane === activePane)); tab.tabIndex = tab.dataset.pane === activePane ? 0 : -1; });
  if (chatting) renderChat(chatState);
  if (chatting && previousPane !== activePane && chatState.engine) byId('chat-input').focus({preventScroll: true});
  byId('source').textContent = state.text || (state.status === 'idle' ? '已清空，请继续选中文字。' : '');
  byId('copy-source').disabled = !state.text;
  byId('incremental').setAttribute('aria-pressed', String(!!state.incremental));
  byId('incremental').title = state.incremental ? '增量复制已开启；与主界面共用开关。关闭后，下次选区单独翻译。' : '与主界面共用开关：累积原文，每次全量重译';
  byId('clear-accumulated').hidden = !state.incremental;
  byId('clear-accumulated').disabled = !state.accumulatedCount;
  byId('incremental-status').hidden = !state.incremental;
  byId('incremental-status').textContent = `已累积 ${state.accumulatedCount || 0} 段 · 每次全量重译`;
  byId('incremental-status').title = '关闭浮窗保留累积原文；点击“清空”或关闭增量复制后重新开始。';
  byId('result').textContent = state.translation;
  byId('error').textContent = state.error;
  byId('loading').hidden = state.status !== 'loading';
  byId('error').hidden = state.status !== 'error';
  byId('retry').hidden = state.status !== 'error';
  byId('copy-result').disabled = !state.translation;
  byId('pin').setAttribute('aria-pressed', String(state.pinned));
  byId('pin').title = state.pinned ? '取消固定：下次翻译可更新此窗口' : '保留当前内容，下次翻译新开窗口，方便对比';
  byId('pin').setAttribute('aria-label', state.pinned ? '取消固定浮窗' : '固定浮窗');
  byId('hint').textContent = state.pinned ? '已固定 · 下次翻译新开窗口' : '留在当前桌面 · 点击外部关闭 · Esc';
  document.querySelectorAll('[data-size]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.size === state.sizePreset)));
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
  api.action(activePane === 'chat' ? 'chat-engine' : 'engine', id);
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
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => api.action('size-preset', button.dataset.size)));
byId('expand').addEventListener('click', () => { const expanded = byId('source').classList.toggle('expanded'); byId('expand').textContent = expanded ? '收起原文' : '展开原文'; });
document.querySelectorAll('[data-pane]').forEach(tab => {
  tab.addEventListener('click', () => api.action('pane', tab.dataset.pane));
  tab.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const next = activePane === 'chat' ? 'translation' : 'chat';
      document.querySelector(`[data-pane="${next}"]`).focus(); api.action('pane', next);
    }
  });
});
const chatInput = byId('chat-input');
let composing = false;
chatInput.addEventListener('compositionstart', () => { composing = true; });
chatInput.addEventListener('compositionend', () => { composing = false; });
chatInput.addEventListener('input', updateChatSend);
function sendQuestion() {
  if (composing || byId('chat-send').disabled) return;
  const question = chatInput.value.trim();
  if (!question || question.length > 4000) return;
  api.action('chat-send', question);
  chatInput.value = ''; updateChatSend();
}
byId('chat-form').addEventListener('submit', event => { event.preventDefault(); sendQuestion(); });
chatInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229) { event.preventDefault(); sendQuestion(); }
});
// Explicit pointer capture works for the macOS panel as well as Windows.
// Coordinates are screen-space DIP; only this popup can request its own movement.
function bindWindowGesture(handle, action, edge) {
  let pointer, frame, pendingPoint;
  function flush() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (pendingPoint) { api.action(`${action}-move`, pendingPoint); pendingPoint = undefined; }
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); closeEngineMenu();
    pointer = event.pointerId;
    handle.setPointerCapture(pointer);
    handle.classList.add('dragging');
    api.action(`${action}-start`, {x: event.screenX, y: event.screenY, ...(edge ? {edge} : {})});
  });
  // Listen on the document as well as capturing the pointer: non-activating
  // panels can deliver a drag to a neighbouring element before capture settles.
  document.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    if (event.buttons === 0) { end(event); return; }
    pendingPoint = {x: event.screenX, y: event.screenY};
    if (frame === undefined) frame = requestAnimationFrame(flush);
  }, true);
  function end(event) {
    if (event.pointerId !== pointer) return;
    flush(); api.action(`${action}-end`);
    pointer = undefined; handle.classList.remove('dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  handle.addEventListener('lostpointercapture', end);
}
bindWindowGesture(byId('drag-handle'), 'drag');
document.querySelectorAll('[data-resize]').forEach(handle => bindWindowGesture(handle, 'resize', handle.dataset.resize));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeEngineMenu(); api.action('close'); } });
api.subscribe(render);
api.state().then(render);
