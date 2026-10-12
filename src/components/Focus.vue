<template>
  <div
    class="focus-container"
    :style="focusContainerStyle"
    @wheel="wheelHandler($event, 'result')"
    @keydown.ctrl.187="keyboardFontHandler($event, 'result')"
    @keydown.ctrl.189="keyboardFontHandler($event, 'result')"
  >
    <div class="input-toolbar">
      <v-btn x-small text @click="editingSource = !editingSource">{{ editingSource ? '返回译文' : '输入原文' }}</v-btn>
      <v-btn v-if="editingSource || mode === 'none'" x-small text color="primary" :disabled="!sourceText.trim()" @click="translate">翻译 · {{ inputShortcut }}</v-btn>
    </div>
    <div
      class="max focus-content"
      @keydown="translateKeydown"
      @keyup.ctrl.71.capture="google"
      @keyup.ctrl.66.capture="baidu"
      @keyup.ctrl.80.capture="command"
      v-on:drop="dragTranslate"
    >
        <textarea
          v-if="editingSource || mode === 'none'"
          class="focusText max focusPadding"
          v-model="sourceText"
          :style="focusStyle"
          :placeholder="inputPlaceholder"
          aria-label="原文，可直接输入或粘贴"
        ></textarea>
        <div
          v-else-if="mode === 'normal'"
          class="focusPadding"
          style="height: 100%;"
          v-bind:style="focusStyle"
          @contextmenu="openMenu('focusContext')"
        >
        <div v-if="(config.focusSource && mode=='normal')">
          <div>原文：</div>
          <div class="focusText" id="focusSource" contenteditable="true">
            {{ sharedResult.text }}
          </div>
          <div>译文：</div>
          <div class="focusText" contenteditable="true">
            {{ sharedResult.translation }}
          </div>
        </div>
        <textarea
          v-else
          class="focusText max focusPadding"
          v-model="sharedResult.translation"
          v-bind:style="focusStyle"
        ></textarea>
      </div>
      <DiffTextArea
        v-else-if="mode == 'diff'"
        class="focusText max focusPadding"
        id="diffText"
      ></DiffTextArea>
      <DictResultPanel
        v-else-if="mode === 'dict'"
        id="dictResultPanel"
        class="max focusPadding"
      ></DictResultPanel>
    </div>
    <div style="font-size: 15px; position: absolute; right: 0px; bottom: 5px;">
      <div
        v-if="
          status !== 'Translating' &&
          mode === 'normal' &&
          sharedResult.engine !== '' &&
          sharedResult.engine !== currentEngine
        "
      >
        <a>
          <span>
            {{ currentEngine }}&nbsp;{{ trans["fallbackPrompt1"]
            }}{{ sharedResult.engine }}{{ trans["fallbackPrompt2"] }}
          </span>
        </a>
      </div>
      <div v-else-if="currentEngine === 'keyan'">
        <a @click="toKeyan()">
          <span>{{ trans["keyanSlogan"] }}</span>
        </a>
      </div>
      <div v-else-if="currentEngine === 'stepfun'">
        <a @click="toStepfun()">
          <span>{{ trans["stepfunSlogan"] }}</span>
        </a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import BaseView from "./BaseView.vue";
import DictResultPanel from "./DictResult.vue";
import { Mixins, Ref, Component, Watch } from "vue-property-decorator";
import DiffTextArea from "./DiffTextArea.vue";
import eventBus from "@/common/event-bus";

@Component({
  components: {
    DictResultPanel,
    DiffTextArea,
  },
})
export default class FocusMode extends Mixins(BaseView) {
  editingSource = false;
  sourceText = "";
  private submittedText = "";

  @Watch("sharedResult.text", { immediate: true })
  syncSourceText(text: string) {
    if (this.status === "Translating" && (!text || text === this.submittedText)) return;
    this.sourceText = text || "";
  }

  translate() {
    const text = this.getModifiedText();
    if (!text?.trim()) return;
    this.submittedText = text;
    this.editingSource = false;
    eventBus.at("dispatch", "translate", text);
  }
  dragTranslate(event: any) {
    console.log(event.dataTransfer.getData("text/plain"));
  }

  capture() {
    // this.$proxy.capture();
  }

  get focusStyle() {
    return {
      fontSize: this.resultSize.toString() + "px",
      color: this.fontColor,
    };
  }

  get focusContainerStyle() {
    return {
      "--content-padding": `${this.contentPadding}px`,
      "--content-line-height": this.contentLineHeight.toString(),
    };
  }

  getTextById(id: string) {
    const e = document.getElementById(id) as HTMLElement;
    const text = e.innerText;
    return text;
  }

  getModifiedText() {
    if (this.editingSource || this.mode === "none") return this.sourceText;
    let text: string | undefined;
    switch (this.mode) {
      case "diff":
        text = this.getTextById("diffText");
        break;
      case "dict":
        text = this.getTextById("dictResultPanel");
        break;
      case "normal":
        if (this.config.focusSource) {
          text = this.getTextById("focusSource");
        } else {
          text = this.sharedResult.translation;
        }
        break;
      case "none":
        text = text = this.sharedResult.translation;
        break;
    }
    if (text) {
      this.$forceUpdate();
    }
    return text;
  }
}
</script>

<style scoped>
.focus-container { display: flex; flex-direction: column; }
.input-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px; flex-shrink: 0; border-bottom: 1px solid rgba(128, 128, 128, .16); }
.focus-content { flex: 1; min-height: 0; }
.focus-content textarea::placeholder { font-size: 14px; opacity: .65; }
.focusText {
  resize: none;
  line-height: var(--content-line-height);
}
.max {
  height: 100%;
  width: 100%;
}
.focusPadding {
  padding: var(--content-padding);
  box-sizing: border-box;
}
</style>
