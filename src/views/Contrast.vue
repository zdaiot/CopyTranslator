<template>
  <div class="window-container" :style="borderRadiusStyle">
    <v-app v-bind:style="[appStyle, transparency]">
      <v-dialog v-model="dialog">
        <Tips @close="dialog = false"></Tips>
      </v-dialog>
      <v-app-bar
        app
        :color="barColor"
        dark
        dense
        :height="titlebarHeight"
        :flat="config.penerate"
        :class="{ 'rounded-top-bar': !drawer, 'rounded-top-right-only': drawer }"
      >
        <ActionButton
          v-if="!config.penerate"
          left_click="drawer"
          right_click="settings"
          icon="mdi-menu"
        ></ActionButton>
        <div class="noSelect" style="overflow: hidden;">
          <p
            style="margin-top: auto; margin-bottom: auto; white-space: nowrap;"
            class="hidden-mobile"
            v-if="!isMini"
          >
            {{ trans[layoutType] }}
          </p>
        </div>
        <v-spacer
          style="height: calc(100% - 1px); padding-top: 1px;"
          @mouseover="penerate(true)"
          @mouseleave="penerate(false)"
        >
          <div :class="{ dragableDiv: !config.penerate }"></div>
        </v-spacer>
        <v-menu offset-y max-width="360">
          <template v-slot:activator="{ on }">
            <div
              style="display: flex;"
              v-on="on"
              @contextmenu="callback('listenClipboard')"
            >
              <v-badge
                dot
                :color="badgeColor"
                offset-y="pl/ml-5"
                offset-x="pl/ml-1"
                style="margin: auto;"
              >
                <EngineButton
                  :engine="currentEngine"
                  :valid="valid"
                  :enable="false"
                  :tooltip="trans['engineButton']"
                ></EngineButton>
              </v-badge>
            </div>
          </template>
          <v-list dense class="engine-menu">
            <template v-for="group in engineGroups">
              <v-subheader :key="group.key">{{ group.title }}</v-subheader>
              <v-list-item v-for="engine in group.items" :key="group.key + engine" @click="chooseEngine(engine, group.key === 'dictionary')">
                <v-list-item-icon>
                  <v-icon v-if="engine === currentEngine && (group.key === 'dictionary') === valid" small color="primary">mdi-check</v-icon>
                  <span v-else :class="['engine-menu-icon', engineClass(engine)]"></span>
                </v-list-item-icon>
                <v-list-item-content><v-list-item-title>{{ engineName(engine) }}</v-list-item-title></v-list-item-content>
              </v-list-item>
              <div v-if="group.key === 'ai' && !group.items.length" :key="group.key + '-empty'" class="engine-help">{{ isChinese ? '尚未启用 AI 模型，请先添加供应商。' : 'No AI models enabled. Add a provider to get started.' }}</div>
            </template>
            <div v-if="valid" class="engine-help">{{ isChinese ? '选择翻译引擎会关闭智能词典模式。' : 'Choosing a translation engine turns off smart dictionary mode.' }}</div>
            <v-divider></v-divider>
            <v-list-item @click="callback('settings', 'customTranslators')">
              <v-list-item-icon><v-icon small>mdi-plus-circle-outline</v-icon></v-list-item-icon>
              <v-list-item-title>{{ isChinese ? '配置 AI 翻译商' : 'Configure AI providers' }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
        <div class="d-flex flex-row" style="height: 100%; padding-right: 1px;">
          <div
            v-if="config.penerate"
            class="dragableDiv"
            style="display: flex;"
          >
            <ActionButton
              icon="mdi-cursor-move"
              style="margin: auto;"
            ></ActionButton>
          </div>
          <ActionButton
            v-if="config.penerate"
            left_click="drawer"
            right_click="settings"
            icon="mdi-menu"
          ></ActionButton>
          <ActionButton
            class="action-btn"
            v-for="(actionButton, buttonIndex) in actionButtons"
            :left_click="actionButton.left_click"
            :right_click="actionButton.right_click"
            :icon="actionButton.icon"
            :tooltip="actionButton.tooltip"
            :predefined="actionButton.predefined"
            :key="buttonIndex"
          ></ActionButton>
        </div>
      </v-app-bar>
      <v-navigation-drawer
        v-model="drawer"
        app
        disable-resize-watcher
        :permanent="drawer"
        hide-overlay
        :width="200"
        :style="drawerStyle"
        class="rounded-left-drawer"
      >
        <div class="drawer-groups">
          <SelectionControls :compact="true"></SelectionControls>
          <div
            v-for="group in drawerGroups"
            :key="group.key"
            class="drawer-group"
          >
            <div v-if="group.title" class="drawer-group-title">
              {{ group.title }}
            </div>
            <Action
              v-for="actionId in group.items"
              :identifier="actionId"
              :key="actionId"
              :class="drawerActionClass(actionId)"
            ></Action>
          </div>
        </div>
      </v-navigation-drawer>

      <ContrastPanel
        :style="[area, transparentArea]"
        v-bind:class="{ active: drawer, 'rounded-panel': true }"
        @mouseover.native="penerate(true)"
        @mouseleave.native="penerate(false)"
      ></ContrastPanel>
    </v-app>
  </div>
</template>

<script lang="ts">
import ActionButton from "../components/ActionButton.vue";
import ContrastPanel from "../components/ContrastPanel.vue";
import BaseView from "../components/BaseView.vue";
import WindowController from "../components/WindowController.vue";
import Action from "../components/Action.vue";
import Component from "vue-class-component";
import { Mixins } from "vue-property-decorator";
import Tips from "@/components/Tips.vue";
import {
  Identifier,
  ActionButton as ActionButtonType,
  abstractTranslatorTypes,
  hexToRgb,
  colorStatusMap,
} from "../common/types";
import SelectionControls from "../components/SelectionControls.vue";
import { TranslatorNameResolver } from "../common/translate/translator-name-resolver";
import EngineButton from "../components/EngineButton.vue";

import { dictionaryTypes } from "../common/dictionary/types";
import "@/css/shared-styles.css";

@Component({
  components: {
    Action,
    ContrastPanel,
    EngineButton,
    ActionButton,
    SelectionControls,
    Tips,
  },
})
export default class Contrast extends Mixins(BaseView, WindowController) {
  readonly routeName = "contrast";
  actionKeys: Identifier[] = this.$controller.action.getKeys(
    "contrastPanel"
  ) as Identifier[];
  drawerActionClass(actionId: Identifier) {
    const action = this.$controller.action.getAction(actionId);
    return action.layout?.stack ? "drawer-action-language" : "";
  }
  get drawerGroups() {
    const actions = this.actionKeys.filter(id => !["selectionPopup", "selectionPopupTrigger", "selectionPermission"].includes(id)).map((id) =>
      this.$controller.action.getAction(id)
    );
    const groups: Array<{ key: string; title: string; items: Identifier[] }> =
      [];
    const groupMap = new Map<string, { key: string; title: string; items: Identifier[] }>();
    actions.forEach((action) => {
      const title = action.layout?.group || "";
      const key = title || "group";
      if (!groupMap.has(key)) {
        const group = { key, title, items: [action.id] };
        groupMap.set(key, group);
        groups.push(group);
      } else {
        groupMap.get(key)?.items.push(action.id);
      }
    });
    return groups;
  }

  dialog: boolean = false;

  get valid() {
    return this.mode === "dict";
  }

  penerate(value: boolean) {
    if (this.config.penerate) {
      //穿透，那就根据鼠标的情况进行设置
      this.set("ignoreMouseEvents", value);
    } else if (this.config.ignoreMouseEvents) {
      //不穿透,但是此时却说要ignore，这就不对，要更新值
      this.set("ignoreMouseEvents", false);
    }
  }

  get isMini() {
    return this.config.transparency > 0;
  }

  mounted() {
    if (!this.config.neverShowTips) this.dialog = true;
  }



  get isChinese() { return String(this.trans.localeName).includes("中文"); }

  get engineGroups() {
    const custom = this.config.customTranslators || [];
    const builtins = [...new Set<string>([
      ...this.config["translator-enabled"].filter((id: string) => TranslatorNameResolver.isBuiltInTranslator(id)),
      ...abstractTranslatorTypes,
    ])];
    return [
      ...(this.valid ? [{ key: "dictionary", title: this.isChinese ? "词典" : "Dictionary", items: [...dictionaryTypes] }] : []),
      { key: "translation", title: this.isChinese ? "翻译引擎" : "Translation engines", items: builtins },
      { key: "ai", title: this.isChinese ? "AI 翻译模型" : "AI models", items: custom },
    ];
  }

  engineName(id: string) { return TranslatorNameResolver.getDisplayName(id, this.trans); }
  engineClass(id: string) { return TranslatorNameResolver.getEngineClass(id); }

  chooseEngine(id: string, dictionary: boolean) {
    if (dictionary) { this.callback("dictionaryType", id); return; }
    if (this.valid || (this.config.customTranslators || []).includes(id)) this.callback("smartDict", false);
    this.callback("multiSource", id === "copytranslator");
    if (id !== "copytranslator") this.callback("translatorType", id);
  }

  get actionButtons(): ActionButtonType[] {
    return this.config.actionButtons;
  }

  get badgeColor() {
    return colorStatusMap.get(this.status);
  }

  get barWidth(): number {
    return this.drawer ? 200 : 0;
  }

  get area() {
    return {
      "margin-top": this.titlebarHeight,
      width: `calc(100vw - ${this.barWidth.toString()}px)`,
      "font-family": this.config.contentFontFamily,
    };
  }

  get transparentArea() {
    return {};
  }

  get drawerStyle() {
    return {
      "border-width": "2px 0px 2px 2px",
      "border-style": "solid",
      "border-color": this.barColor,
    };
  }

  get drawer(): boolean {
    return this.config.drawer;
  }

  set drawer(val: boolean) {
    this.set("drawer", val);
  }

  get layoutType() {
    return this.config.layoutType;
  }

  get backgroundColor() {
    const alpha = 1 - this.config.transparency; //不透明度
    const bgColor = this.$vuetify.theme.dark
      ? this.config.backgroundColor.dark
      : this.config.backgroundColor.light;
    const rgb = hexToRgb(bgColor as string);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }

  get barColor() {
    const alpha = 1 - this.config.transparency; //不透明度
    const bgColor = this.$vuetify.theme.currentTheme.primary;
    const rgb = hexToRgb(bgColor as string);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }

  get transparency() {
    return {
      background: this.backgroundColor,
    };
  }

  // 统一的圆角大小设置 - 修改此处即可修改所有圆角
  get borderRadius() {
    return "10px";
  }

  get borderRadiusStyle() {
    return {
      "--border-radius": this.borderRadius,
      "border-width": "2px",
      "border-style": "solid",
      "border-color": this.barColor,
    };
  }
}
</script>
<style>
.window-container {
  border-radius: var(--border-radius);
  overflow: hidden;
  height: 100vh;
  width: 100vw;
}

/* v-app 圆角 */
.window-container .v-application {
  border-radius: var(--border-radius) !important;
  overflow: hidden !important;
}

.window-container .v-application__wrap {
  border-radius: var(--border-radius) !important;
}

/* 顶部栏圆角 */
.window-container .rounded-top-bar {
  border-radius: var(--border-radius) var(--border-radius) 0 0 !important;
  overflow: hidden !important;
}

.window-container .rounded-top-bar .v-toolbar__content {
  border-radius: var(--border-radius) var(--border-radius) 0 0 !important;
}

.window-container .rounded-top-bar::before,
.window-container .rounded-top-bar::after {
  border-radius: var(--border-radius) var(--border-radius) 0 0 !important;
}

/* 顶部栏只有右上圆角 - 当抽屉打开时 */
.window-container .rounded-top-right-only {
  border-radius: 0 var(--border-radius) 0 0 !important;
  overflow: hidden !important;
}

.window-container .rounded-top-right-only .v-toolbar__content {
  border-radius: 0 var(--border-radius) 0 0 !important;
}

.window-container .rounded-top-right-only::before,
.window-container .rounded-top-right-only::after {
  border-radius: 0 var(--border-radius) 0 0 !important;
}

/* 左侧抽屉圆角 */
.window-container .rounded-left-drawer {
  border-radius: var(--border-radius) 0 0 var(--border-radius) !important;
}

/* 主面板圆角 - 当抽屉关闭时显示左下角圆角，始终显示右侧圆角 */
.rounded-panel {
  border-radius: 0 0 var(--border-radius) var(--border-radius) !important;
}

.rounded-panel.active {
  border-radius: 0 0 var(--border-radius) 0 !important;
}

.drawer-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
}
.drawer-group {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.drawer-group-title {
  font-weight: 600;
  margin-bottom: 4px;
  text-align: left;
}
.drawer-group .action-label {
  white-space: nowrap;
}
.drawer-group .action-control {
  min-width: 96px;
  max-width: 120px;
}
.drawer-action-language .action-row {
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}
.drawer-action-language .action-label {
  white-space: normal;
}
.drawer-action-language .action-control {
  min-width: 0;
  max-width: 100%;
  width: 100%;
}

.active {
  margin-left: 200px;
}

@media (max-width: 300px) {
  .hidden-mobile {
    display: none;
  }
}

.dragableDiv {
  -webkit-app-region: drag;
  height: 100%;
  width: 100%;
}

.noPad {
  padding: 0px;
}

::-webkit-scrollbar {
  display: none;
}

.noSelect {
  user-select: none;
  display: flex;
  -webkit-app-region: drag;
}

.popup {
  padding-top: 5px;
  text-align: center;
}

.action-btn {
  margin: auto;
}
</style>

<style scoped>
.engine-menu { width: 320px; max-width: calc(100vw - 24px); max-height: 70vh; overflow-y: auto; }
.engine-menu .v-list-item__icon { margin-right: 12px; }
.engine-menu .v-list-item__title { white-space: normal; overflow-wrap: anywhere; font-size: 13px; }
.engine-menu-icon { display: block; width: 20px; height: 20px; background-position: center; background-size: contain; }
.engine-help { padding: 4px 16px 12px; font-size: 12px; opacity: .7; }
</style>
