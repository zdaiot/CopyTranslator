<template>
  <div :class="['selection-shortcut', { compact }]">
    <v-btn :small="!compact" :x-small="compact" :color="loaded && !registered ? 'warning' : undefined" outlined @click="openEditor" :title="label" :aria-label="label">
      <v-icon small left>mdi-keyboard-outline</v-icon>
      <span v-if="!compact">{{ isChinese ? '划词快捷键：' : 'Selection shortcut: ' }}</span>{{ display || '—' }}
    </v-btn>
    <small v-if="!compact">{{ isChinese ? '默认：' : 'Default: ' }}{{ defaultDisplay }} · {{ availability }}</small>
    <small v-else-if="loaded && !registered" role="status">{{ availability }}</small>
    <v-dialog v-model="dialog" max-width="420" @keydown.esc="closeEditor">
      <v-card>
        <v-card-title>{{ isChinese ? '设置划词快捷键' : 'Selection shortcut' }}</v-card-title>
        <v-card-text>
          <p>{{ isChinese ? '选中文字后按下此组合键即可翻译。全局划词浮窗开关需保持开启。' : 'Select text, then press this shortcut to translate. Enable the selection popup first.' }}</p>
          <p>{{ isChinese ? '默认快捷键：' : 'Default shortcut: ' }}<strong>{{ defaultDisplay }}</strong></p>
          <v-text-field
            :value="draftDisplay" readonly outlined hide-details
            :label="isChinese ? '点击此处，再按下新的组合键' : 'Click here, then press a new shortcut'"
            @focus="startRecording" @click="startRecording" @blur="stopRecording" @keydown.native="capture"
          ></v-text-field>
          <p class="recording-hint">{{ recording ? (isChinese ? '正在录入…请按 Command / Ctrl / Alt 加字母、数字或功能键。' : 'Recording…press Command / Ctrl / Alt with a letter, number or function key.') : (isChinese ? '保存后立即生效，无需重启。' : 'Changes apply immediately. No restart needed.') }}</p>
          <v-alert v-if="error" type="error" dense text role="alert">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn text @click="restoreDefault">{{ isChinese ? '恢复默认' : 'Use default' }}</v-btn>
          <v-spacer></v-spacer>
          <v-btn text @click="closeEditor">{{ isChinese ? '取消' : 'Cancel' }}</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!draft" @click="save">{{ isChinese ? '保存' : 'Save' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch } from "vue-property-decorator";
import { ipcRenderer } from "electron";
import Base from "./Base.vue";
import { defaultSelectionShortcut, formatSelectionShortcut, selectionShortcutFromKey } from "../common/selection-shortcut";

@Component
export default class SelectionShortcut extends Base {
  @Prop({ type: Boolean, default: false }) readonly compact!: boolean;
  dialog = false;
  recording = false;
  saving = false;
  error = "";
  shortcut = defaultSelectionShortcut;
  registered = false;
  loaded = false;
  draft = "";
  get isChinese() { return String(this.trans.localeName).includes("中文"); }
  get display() { return formatSelectionShortcut(this.shortcut); }
  get draftDisplay() { return formatSelectionShortcut(this.draft); }
  get defaultDisplay() { return formatSelectionShortcut(defaultSelectionShortcut); }
  get label() { return `${this.isChinese ? '点击修改划词快捷键' : 'Edit selection shortcut'} · ${this.display}`; }
  get availability() {
    if (!this.loaded) return this.isChinese ? "正在检查…" : "Checking…";
    return this.registered ? (this.isChinese ? "已生效，点击可修改" : "Active · click to edit")
      : (this.isChinese ? "未生效，点击修改以解决占用" : "Unavailable · click to change");
  }
  async refresh() {
    try {
      const state = await ipcRenderer.invoke("selection-shortcut:get");
      this.shortcut = state.shortcut;
      this.registered = state.registered;
      this.loaded = true;
    } catch { this.loaded = true; this.registered = false; }
  }
  async openEditor() {
    await this.refresh(); this.draft = this.shortcut || defaultSelectionShortcut;
    this.error = ""; this.dialog = true;
  }
  async startRecording() {
    if (this.recording || !this.dialog) return;
    this.recording = true;
    try { await ipcRenderer.invoke("selection-shortcut:record", true); }
    catch { this.recording = false; }
  }
  async stopRecording() {
    if (!this.recording) return;
    this.recording = false;
    await ipcRenderer.invoke("selection-shortcut:record", false).catch(() => {});
  }
  capture(event: KeyboardEvent) {
    if (event.key === "Tab") { void this.stopRecording(); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { void this.closeEditor(); return; }
    const value = selectionShortcutFromKey(event);
    if (value) { this.draft = value; this.error = ""; void this.stopRecording(); }
  }
  async restoreDefault() { await this.stopRecording(); this.draft = defaultSelectionShortcut; this.error = ""; }
  async closeEditor() { await this.stopRecording(); this.dialog = false; }
  @Watch("dialog")
  dialogChanged(open: boolean) { if (!open) void this.stopRecording(); }
  async save() {
    this.saving = true;
    await this.stopRecording();
    try {
      const result = await ipcRenderer.invoke("selection-shortcut:set", this.draft);
      if (!result.ok) {
        this.error = result.error === "conflict"
          ? (this.isChinese ? "此快捷键已被占用，请换一个组合。原快捷键仍保留。" : "This shortcut is in use. Choose another combination; your previous shortcut is preserved.")
          : result.error === "save" ? (this.isChinese ? "保存失败，原快捷键已保留。" : "Saving failed. Your previous shortcut is preserved.")
          : (this.isChinese ? "组合键无效，请重新录入。" : "Invalid shortcut. Please record another combination.");
        return;
      }
      this.shortcut = result.shortcut; this.registered = result.registered;
      this.dialog = false;
    } catch { this.error = this.isChinese ? "保存失败，请重试。" : "Could not save. Please retry."; }
    finally { this.saving = false; }
  }
  mounted() {
    void this.refresh();
    ipcRenderer.on("selection-shortcut:updated", this.refresh);
    window.addEventListener("focus", this.refresh);
    window.addEventListener("blur", this.stopRecording);
  }
  beforeDestroy() {
    void this.stopRecording();
    ipcRenderer.removeListener("selection-shortcut:updated", this.refresh);
    window.removeEventListener("focus", this.refresh);
    window.removeEventListener("blur", this.stopRecording);
  }
}
</script>

<style scoped>
.selection-shortcut { -webkit-app-region: no-drag; }
.selection-shortcut small { display: block; margin-top: 6px; opacity: .8; }
.selection-shortcut.compact .v-btn { text-transform: none; letter-spacing: 0; max-width: 100%; height: auto; min-height: 28px; padding: 5px 8px; }
.selection-shortcut.compact >>> .v-btn__content { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
.recording-hint { margin-top: 12px; font-size: 12px; }
</style>
