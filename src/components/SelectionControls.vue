<template>
  <section :class="['selection-controls', { compact }]">
    <div class="selection-heading">
      <h3>{{ trans.selectionPopup }}</h3>
      <v-switch
        :input-value="config.selectionPopup"
        @change="set('selectionPopup', !!$event)"
        :aria-label="trans.selectionPopup"
        dense hide-details inset class="selection-toggle ma-0 pa-0"
      ></v-switch>
    </div>
    <div v-if="config.selectionPopup" class="selection-details">
      <div>
        <div class="field-label">{{ trans.selectionPopupTrigger }}</div>
        <v-select
          :value="config.selectionPopupTrigger" :items="triggerItems"
          @change="set('selectionPopupTrigger', $event)"
          :aria-label="trans.selectionPopupTrigger"
          dense outlined hide-details
        ></v-select>
        <p class="help">{{ triggerHelp }}</p>
      </div>
      <div class="shortcut-row">
        <div class="field-label">{{ isChinese ? '快捷键' : 'Shortcut' }}</div>
        <SelectionShortcut :compact="true"></SelectionShortcut>
      </div>
      <div v-if="isMac" class="permissions">
        <p class="help" role="status">{{ statusText }}</p>
        <div class="permission-actions">
          <v-btn x-small outlined :loading="checking" @click="refreshStatus">{{ isChinese ? '检查权限' : 'Check permissions' }}</v-btn>
          <v-btn v-if="state && !state.accessibility" x-small text color="primary" @click="callback('selectionPermission')">{{ isChinese ? '打开辅助功能' : 'Open Accessibility' }}</v-btn>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import { Component, Prop, Watch } from "vue-property-decorator";
import { ipcRenderer } from "electron";
import Base from "./Base.vue";
import SelectionShortcut from "./SelectionShortcut.vue";
import { selectionPopupTriggers } from "../common/types";

@Component({ components: { SelectionShortcut } })
export default class SelectionControls extends Base {
  @Prop({ type: Boolean, default: false }) readonly compact!: boolean;
  isMac = process.platform === "darwin";
  checking = false;
  state: { accessibility?: boolean; mouseMonitor?: boolean; error?: string } | null = null;
  get isChinese() { return String(this.trans.localeName).includes("中文"); }
  get triggerItems() { return selectionPopupTriggers.map(value => ({ value, text: this.trans[value] })); }
  get triggerHelp() {
    if (this.config.selectionPopupTrigger === "selectionShortcut") return this.isChinese ? "选中文字后按快捷键翻译。" : "Select text, then press the shortcut.";
    if (this.config.selectionPopupTrigger === "selectionDirect") return this.isChinese ? "选中文字后立即显示译文。" : "Show the translation immediately after selection.";
    return this.isChinese ? "选中文字后点击 CopyTranslator 小按钮，或按快捷键翻译。" : "Select text, then click the CopyTranslator button or press the shortcut.";
  }
  get statusText() {
    if (!this.state) return this.isChinese ? "正在检查权限…" : "Checking permissions…";
    if (this.state.error) return this.isChinese ? "辅助程序未响应，请重启软件。" : "Helper unavailable. Please restart the app.";
    if (!this.state.accessibility) return this.isChinese ? "请在辅助功能中允许 CopyTranslator。" : "Allow CopyTranslator in Accessibility.";
    if (!this.state.mouseMonitor) return this.isChinese ? "监听未启动，请重新开启此开关。" : "Listener inactive. Toggle this switch off and on.";
    return this.isChinese ? "权限已就绪" : "Permissions ready";
  }
  async refreshStatus() {
    if (!this.isMac || !this.config.selectionPopup || this.checking) return;
    this.checking = true;
    try { this.state = await ipcRenderer.invoke("selection-status"); }
    catch { this.state = { error: "helper-unavailable" }; }
    finally { this.checking = false; }
  }
  @Watch("config.selectionPopup")
  selectionChanged() { this.state = null; void this.refreshStatus(); }
  mounted() { void this.refreshStatus(); window.addEventListener("focus", this.refreshStatus); }
  beforeDestroy() { window.removeEventListener("focus", this.refreshStatus); }
}
</script>

<style scoped>
.selection-controls { border: 1px solid rgba(128,128,128,.2); border-radius: 10px; padding: 12px; text-align: left; min-width: 0; }
.selection-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.selection-heading h3 { font-size: 14px; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
.selection-toggle { flex: 0 0 auto; }
.selection-toggle >>> .v-input--selection-controls__input { margin-right: 0; }
.selection-details { display: grid; gap: 10px; margin-top: 10px; }
.field-label { font-size: 12px; margin-bottom: 6px; }
.shortcut-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.shortcut-row .field-label { margin: 0; flex: 0 0 auto; }
.help { font-size: 12px; line-height: 1.5; opacity: .75; margin: 6px 0 0; overflow-wrap: anywhere; }
.permissions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-top: 1px solid rgba(128,128,128,.2); padding-top: 8px; }
.permissions .help { margin: 0; }
.permission-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.selection-controls.compact { padding: 8px; }
.compact .selection-heading h3 { font-size: 12px; }
.compact >>> .v-select__selections { font-size: 12px; }
.compact >>> .v-input__slot { padding: 0 8px !important; }
.compact >>> .v-select__selection { max-width: 100%; }
</style>
