<template>
  <div class="custom-translator-manager">
    <v-card flat>
      <v-card-title class="pb-2">
        {{ trans["aiProviders"] || "AI翻译供应商" }}
        <v-spacer></v-spacer>
        <v-btn color="primary" small @click="showAddProviderDialog = true">
          <v-icon small left>mdi-plus</v-icon>
          {{ trans["addAIProvider"] || "添加AI供应商" }}
        </v-btn>
      </v-card-title>

      <v-card-text>
        <!-- AI翻译说明 -->
        <v-alert
          type="info"
          dense
          text
          class="mb-4"
        >
          {{ trans["aiTranslatorDescription"] || "这些翻译器基于人工智能（大语言模型/LLM），可以理解上下文并提供更自然的翻译。所有在此处添加的供应商都需要您自行配置API密钥。" }}
        </v-alert>
        <ol class="setup-steps">
          <li>{{ isChinese ? '添加供应商，填写 API 地址并粘贴 API 密钥（支持 OpenAI 兼容接口）。' : 'Add a provider with its API URL and API key (OpenAI-compatible API).' }}</li>
          <li>{{ isChinese ? '在添加窗口获取模型列表并选择模型，测试连接后保存；也可手动输入模型 ID。' : 'Fetch and select models in the dialog, test the connection, then save. Manual model IDs are also supported.' }}</li>
          <li>{{ isChinese ? '在主界面或划词浮窗的引擎菜单中选择该模型，即可翻译。主界面选择 AI 模型后，单词和句子均使用 AI 翻译。' : 'Choose the model from either engine menu. Selecting an AI model in the main window uses AI for both words and sentences.' }}</li>
        </ol>
        <!-- 供应商列表 -->
        <v-expansion-panels v-if="providers.length > 0" v-model="expandedProviders" multiple>
          <v-expansion-panel
            v-for="provider in providers"
            :key="provider.id"
          >
            <!-- 供应商头部 -->
            <v-expansion-panel-header>
              <div class="d-flex align-center flex-grow-1">
                <div :class="['provider-icon', 'mr-2', `provider-${provider.providerType}`]"></div>
                <div class="flex-grow-1">
                  <div class="font-weight-medium">
                    {{ provider.name }}
                    <v-chip
                      v-if="provider.providerType === 'stepfun'"
                      color="warning"
                      x-small
                      class="ml-2"
                    >
                      {{ trans["stepfunCustomNote"] || "需自备API密钥" }}
                    </v-chip>
                  </div>
                  <div class="caption grey--text">
                    {{ provider.apiBase }} | {{ provider.enabledModels.length }} {{ trans["modelsEnabled"] || "个模型已启用" }}
                  </div>
                </div>
              </div>
            </v-expansion-panel-header>

            <!-- 供应商内容 -->
            <v-expansion-panel-content>
              <v-card flat>
                <!-- 供应商操作按钮 -->
                <v-card-actions class="px-0 py-2">
                  <v-btn small text color="primary" @click="editProvider(provider)">
                    <v-icon small left>mdi-pencil</v-icon>
                    {{ trans["edit"] || "编辑" }}
                  </v-btn>
                  <v-btn small text color="error" @click="removeProviderConfirm(provider.id)">
                    <v-icon small left>mdi-delete</v-icon>
                    {{ trans["delete"] || "删除" }}
                  </v-btn>
                  <v-spacer></v-spacer>
                  <v-btn small text @click="testProvider(provider)">
                    <v-icon small left>mdi-test-tube</v-icon>
                    {{ trans["test"] || "测试" }}
                  </v-btn>
                </v-card-actions>

                <v-divider></v-divider>

                <!-- 模型选择区域 -->
                <v-card-text class="px-0">
                  <p class="caption">{{ isChinese ? '点击模型启用或停用，勾选的模型会出现在主界面和划词浮窗。' : 'Click models to enable or disable them. Checked models appear in both translation menus.' }}</p>
                  <div class="d-flex align-center mb-2">
                    <span class="subtitle-2">{{ trans["selectModels"] || "选择要启用的模型" }}</span>
                    <v-spacer></v-spacer>
                    <v-btn
                      x-small
                      text
                      :loading="provider.fetchingModels"
                      @click="fetchProviderModels(provider)"
                    >
                      <v-icon small left>mdi-refresh</v-icon>
                      {{ isChinese ? '刷新模型' : 'Refresh models' }}
                    </v-btn>
                  </div>

                  <!-- 模型列表 -->
                  <div v-if="provider.availableModels && provider.availableModels.length > 0">
                    <v-chip-group
                      :value="provider.enabledModels"
                      @change="(models) => updateProviderModels(provider.id, models)"
                      multiple
                      column
                    >
                      <v-chip
                        v-for="model in provider.availableModels"
                        :key="model"
                        :value="model"
                        filter
                        outlined
                        small
                      >
                        {{ model }}
                      </v-chip>
                    </v-chip-group>
                  </div>

                  <!-- 无可用模型提示 -->
                  <v-alert
                    v-else-if="!provider.fetchingModels"
                    dense
                    text
                    type="info"
                    class="mt-2"
                  >
                    {{ trans["noModelsHint"] || "点击刷新按钮获取可用模型列表" }}
                  </v-alert>

                  <div class="manual-model">
                    <v-text-field v-model="provider.manualModel" :label="isChinese ? '手动添加模型 ID' : 'Add a model ID manually'" :hint="isChinese ? '填写服务商提供的准确模型名称' : 'Use the exact model ID from your provider'" persistent-hint outlined dense @keydown.enter.prevent="addManualModel(provider)"></v-text-field>
                    <v-btn small outlined color="primary" :disabled="!provider.manualModel || !provider.manualModel.trim()" @click="addManualModel(provider)">{{ isChinese ? '添加并启用' : 'Add & enable' }}</v-btn>
                  </div>

                  <!-- 模型获取错误 -->
                  <v-alert
                    v-if="provider.modelFetchError"
                    dense
                    text
                    type="error"
                    class="mt-2"
                    dismissible
                    @input="provider.modelFetchError = ''"
                  >
                    {{ provider.modelFetchError }}
                  </v-alert>
                </v-card-text>
              </v-card>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- 无供应商提示 -->
        <div v-else class="text-center pa-4 grey--text">
          {{ trans["noAIProviders"] || "暂无AI供应商" }}
        </div>
      </v-card-text>
    </v-card>

    <!-- 添加/编辑供应商对话框 -->
    <v-dialog v-model="showAddProviderDialog" max-width="640px" persistent scrollable>
      <v-card>
        <v-card-title>
          {{ editingProvider ? (trans["editAIProvider"] || "编辑AI供应商") : (trans["addAIProvider"] || "添加AI供应商") }}
        </v-card-title>

        <v-card-text>
          <v-form ref="form" v-model="formValid">
            <!-- 快速选择供应商模板 -->
            <v-select
              v-if="!editingProvider"
              v-model="selectedTemplate"
              :items="templateItems"
              :label="trans['selectProviderTemplate'] || '选择AI供应商类型'"
              @change="onTemplateChange"
              outlined
              dense
            >
              <template v-slot:item="{ item }">
                <div :class="['provider-icon', 'mr-2', `provider-${item.value}`]"></div>
                <div>
                  <div>{{ item.text }}</div>
                  <div class="caption grey--text">{{ item.description }}</div>
                </div>
              </template>
            </v-select>

            <!-- 供应商名称 -->
            <v-text-field
              v-model="providerForm.name"
              :label="trans['providerName'] || '供应商名称'"
              :rules="[rules.required]"
              hint="例如: OpenAI 官方账号"
              outlined
              dense
            ></v-text-field>

            <!-- API Base URL -->
            <v-text-field
              v-model="providerForm.apiBase"
              @input="invalidateDraftConnection"
              :label="trans['apiBase'] || 'API Base URL'"
              :rules="[rules.required]"
              :hint="isChinese ? '填写接口基础地址，例如 https://api.example.com/v1，不含 /chat/completions' : 'API base URL, e.g. https://api.example.com/v1, without /chat/completions'"
              persistent-hint
              outlined
              dense
            ></v-text-field>

            <!-- API Key -->
            <v-text-field
              v-model="providerForm.apiKey"
              @input="invalidateDraftConnection"
              :label="trans['apiKey'] || 'API Key'"
              :rules="[rules.required]"
              type="password"
              autocomplete="new-password"
              :spellcheck="false"
              outlined
              dense
            >
              <template v-slot:append>
                <v-btn text x-small color="primary" @click="pasteApiKey">{{ isChinese ? '粘贴' : 'Paste' }}</v-btn>
              </template>
            </v-text-field>

            <div class="model-picker-heading">
              <span>{{ isChinese ? '翻译模型' : 'Translation models' }}</span>
              <v-btn small text color="primary" :loading="fetchingDraftModels" :disabled="!canConnect" @click="fetchDraftModels">
                <v-icon small left>mdi-refresh</v-icon>{{ draftModels.length ? (isChinese ? '刷新模型列表' : 'Refresh model list') : (isChinese ? '获取模型列表' : 'Fetch model list') }}
              </v-btn>
            </div>
            <v-combobox
              v-model="providerForm.enabledModels" :items="draftModelItems" :search-input.sync="draftModelSearch"
              :label="isChinese ? '选择模型或输入模型 ID' : 'Select models or enter model IDs'"
              :hint="isChinese ? '可多选。没有列表时，输入准确的模型 ID 并按回车。' : 'Select one or more models, or type an exact model ID and press Enter.'"
              :no-data-text="isChinese ? '点击获取模型列表，或输入模型 ID' : 'Fetch models or type a model ID'"
              multiple small-chips deletable-chips :return-object="false" clearable outlined dense persistent-hint
              @change="draftModelsChanged"
            ></v-combobox>
            <p v-if="draftModelNotice" class="caption mt-1" role="status">{{ draftModelNotice }}</p>
            <v-switch
              :input-value="providerForm.config.chatEnabled !== false"
              @change="$set(providerForm.config, 'chatEnabled', $event)"
              :label="isChinese ? '选中文字对话' : 'Chat about selected text'"
              :hint="isChinese ? '该供应商的已启用模型可在划词浮窗中回答问题、连续追问；每次请求附上原文及当前对话。' : 'Use enabled models in the selection popup to ask questions and follow up. Requests include the passage and current conversation.'"
              persistent-hint dense class="mb-4"
            ></v-switch>
            <v-alert v-if="draftModelError" type="warning" dense text class="mt-2" role="alert">{{ draftModelError }}</v-alert>
            <v-select v-if="providerForm.enabledModels.length > 1" :value="draftTestModelId" :items="providerForm.enabledModels"
              :label="isChinese ? '用于测试的模型' : 'Model to test'" outlined dense hide-details class="mt-3"
              @change="draftTestModel = $event; invalidateDraftTest()"
            ></v-select>
            <div class="connection-test">
              <v-btn small outlined color="primary" :loading="testingDraft" :disabled="!canConnect || !hasDraftModel" @click="testDraftConnection">
                {{ isChinese ? '测试连接' : 'Test connection' }}
              </v-btn>
              <span class="caption">{{ isChinese ? '发送一次简短的模型请求，可能消耗少量额度。' : 'Sends a short model request; a small usage charge may apply.' }}</span>
            </div>
            <v-alert v-if="draftTestResult" type="success" dense text role="status" class="connection-result">{{ draftTestResult }}</v-alert>
            <v-alert v-if="draftTestError" type="error" dense text role="alert">{{ draftTestError }}</v-alert>

            <!-- 高级配置 -->
            <v-expansion-panels flat>
              <v-expansion-panel>
                <v-expansion-panel-header>
                  {{ trans["advancedConfig"] || "高级配置" }}
                </v-expansion-panel-header>
                <v-expansion-panel-content>
                  <v-switch
                    :input-value="providerForm.config.stream !== false"
                    @change="setDraftStream"
                    :label="isChinese ? '流式显示译文与回答' : 'Stream translations and answers'"
                    :hint="isChinese ? '收到译文即显示；服务明确拒绝流式时自动改用普通返回。测试连接可验证实际返回方式。' : 'Show text as it arrives. Explicit stream rejection falls back to a complete response. Test the actual response mode below.'"
                    persistent-hint dense
                  ></v-switch>
                  <v-select
                    v-if="showReasoningProtocol"
                    v-model="providerForm.config.reasoningProtocol"
                    :items="reasoningProtocolItems"
                    :label="isChinese ? '思考参数格式' : 'Reasoning API format'"
                    @change="changeReasoningProtocol"
                    outlined dense class="mt-4"
                    :hint="isChinese ? '按服务商文档选择；兼容 Chat Completions 不代表支持同一套思考参数。' : 'Choose the format documented by your provider.'"
                    persistent-hint
                  ></v-select>
                  <v-select
                    v-model="providerForm.config.reasoningEffort"
                    :items="reasoningItems"
                    :label="isChinese ? '思考模式 / 强度' : 'Thinking / reasoning effort'"
                    :disabled="!draftReasoningProtocol"
                    :hint="reasoningHint"
                    @change="invalidateDraftTest"
                    outlined dense persistent-hint class="mt-4"
                  ></v-select>
                  <div class="mt-2">
                    <label class="caption">
                      {{ trans["temperature"] || "温度" }}: {{ providerForm.config.temperature }}
                    </label>
                    <v-slider
                      v-model="providerForm.config.temperature"
                      @change="invalidateDraftTest"
                      min="0"
                      max="1"
                      step="0.1"
                      thumb-label
                      dense
                    ></v-slider>
                    <p class="caption grey--text">{{ temperatureDesc }}</p>
                  </div>

                  <v-text-field
                    v-model.number="providerForm.config.maxTokens"
                    @input="invalidateDraftTest"
                    :label="trans['maxTokens'] || '最大Token数'"
                    type="number"
                    outlined
                    dense
                  ></v-text-field>

                  <v-textarea
                    v-model="providerForm.config.prompt"
                    @input="invalidateDraftTest"
                    :label="trans['customPrompt'] || '自定义提示词'"
                    :placeholder="defaultPrompt"
                    :hint="isChinese ? '{text} = 原文，{to} = 目标语言，{from} = 源语言；留空使用框内默认模板。' : '{text} = source text, {to} = target language, {from} = source language. Empty uses the default template.'"
                    persistent-hint
                    rows="6"
                    outlined
                    dense
                  ></v-textarea>
                  <v-btn small text color="primary" @click="restoreDefaultPrompt">
                    {{ isChinese ? '恢复默认提示词' : 'Restore default prompt' }}
                  </v-btn>
                  <v-textarea
                    v-if="providerForm.config.chatEnabled !== false"
                    v-model="providerForm.config.chatPrompt"
                    :label="isChinese ? '对话提示词' : 'Conversation prompt'"
                    :placeholder="defaultChatPrompt"
                    :hint="isChinese ? '独立于翻译提示词。原文自动附在消息中，无需填写占位符；留空使用默认提示词。' : 'Separate from translation. The passage is attached automatically; no placeholders are needed. Empty uses the default prompt.'"
                    persistent-hint rows="5" outlined dense class="mt-4"
                  ></v-textarea>
                  <v-btn v-if="providerForm.config.chatEnabled !== false" small text color="primary" @click="providerForm.config.chatPrompt = defaultChatPrompt">
                    {{ isChinese ? '恢复默认对话提示词' : 'Restore conversation prompt' }}
                  </v-btn>
                </v-expansion-panel-content>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-form>
          <v-alert v-if="formError" type="error" dense text role="alert">{{ formError }}</v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="closeProviderDialog">{{ trans["cancel"] || "取消" }}</v-btn>
          <v-btn
            color="primary"
            :disabled="!formValid || !hasDraftModel"
            @click="saveProvider"
          >
            {{ isChinese ? '保存并启用' : 'Save & enable' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 测试对话框 -->
    <v-dialog v-model="showTestDialog" max-width="500px">
      <v-card>
        <v-card-title>{{ trans["testAIProvider"] || "测试AI供应商" }}</v-card-title>
        <v-card-text>
          <v-select
            v-model="testModel"
            :items="testingProvider ? testingProvider.enabledModels : []"
            :label="trans['selectModel'] || '选择模型'"
            outlined
            dense
          ></v-select>

          <v-textarea
            v-model="testText"
            :label="trans['testText'] || '测试文本'"
            rows="2"
            outlined
            dense
          ></v-textarea>

          <v-row dense>
            <v-col cols="6">
              <v-select
                v-model="testFrom"
                :items="testLanguages"
                label="From"
                outlined
                dense
              ></v-select>
            </v-col>
            <v-col cols="6">
              <v-select
                v-model="testTo"
                :items="testLanguages"
                label="To"
                outlined
                dense
              ></v-select>
            </v-col>
          </v-row>

          <v-btn color="primary" @click="runTest" :loading="testing" block>
            {{ trans["test"] || "测试" }}
          </v-btn>

          <div v-if="testResult" class="mt-3">
            <v-alert type="success" dense>
              <div><strong>{{ trans["testResult"] || "测试结果" }}:</strong></div>
              <div>{{ testResult }}</div>
            </v-alert>
          </div>

          <div v-if="testError" class="mt-3">
            <v-alert type="error" dense>
              {{ testError }}
            </v-alert>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="showTestDialog = false">{{ trans["cancel"] || "取消" }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import { clipboard, ipcRenderer } from "electron";
import { customTranslatorManager } from "@/common/translate/custom-translators";
import { normalizeProviderConnection, normalizeModelIds } from "@/common/translate/provider-config";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_CONTEXT_CHAT_PROMPT, effectivePrompt, reasoningProtocol, reasoningChoices } from "@/common/translate/chat-settings";
import { ProviderConfig } from "@/common/translate/types";
import { providerTemplates, getProviderTemplate } from "@/common/translate/provider-templates";
import eventBus from "@/common/event-bus";

interface ProviderWithUI extends ProviderConfig {
  fetchingModels?: boolean;
  modelFetchError?: string;
  manualModel?: string;
}

@Component
export default class CustomTranslatorManagerView extends Vue {
  readonly defaultPrompt = DEFAULT_TRANSLATION_PROMPT;
  readonly defaultChatPrompt = DEFAULT_CONTEXT_CHAT_PROMPT;
  providers: ProviderWithUI[] = [];
  expandedProviders: number[] = [];
  showAddProviderDialog = false;
  showTestDialog = false;
  formValid = false;
  editingProvider: ProviderConfig | null = null;
  selectedTemplate = "";
  draftModels: string[] = [];
  draftModelSearch = "";
  draftModelError = "";
  draftModelNotice = "";
  fetchingDraftModels = false;
  modelRequestVersion = 0;
  draftTestModel = "";
  testingDraft = false;
  testRequestVersion = 0;
  draftTestResult = "";
  draftTestError = "";
  formError = "";
  
  // 测试相关
  testing = false;
  testText = "Hello, world!";
  testFrom = "en";
  testTo = "zh-CN";
  testResult = "";
  testError = "";
  testingProvider: ProviderWithUI | null = null;
  testModel = "";

  testLanguages = ["en", "zh-CN", "zh-TW", "ja", "ko", "fr", "es", "de", "ru"];

  // 供应商表单
  providerForm: ProviderConfig = {
    id: "",
    name: "",
    providerType: "custom",
    apiBase: "https://",
    apiKey: "",
    enabledModels: [],
    config: {
      temperature: 0.3,
      maxTokens: 4000,
      prompt: DEFAULT_TRANSLATION_PROMPT,
      stream: true,
      chatEnabled: true,
      chatPrompt: DEFAULT_CONTEXT_CHAT_PROMPT,
      reasoningProtocol: "auto",
      reasoningEffort: "default",
    },
    enabled: true,
  };

  get trans() {
    return this.$store.getters.locale;
  }

  get isChinese() { return String(this.trans.localeName).includes("中文"); }
  get canConnect() { return !!this.providerForm.apiBase.trim() && !!this.providerForm.apiKey.trim(); }
  get hasDraftModel() { return this.providerForm.enabledModels.length > 0 || !!this.draftModelSearch?.trim(); }
  get draftModelItems() { return normalizeModelIds([...this.draftModels, ...this.providerForm.enabledModels]); }
  get draftTestModelId() { return this.providerForm.enabledModels.includes(this.draftTestModel) ? this.draftTestModel : this.providerForm.enabledModels[0] || ""; }

  get draftReasoningProtocol() {
    return reasoningProtocol(this.providerForm.providerType, this.providerForm.apiBase, this.providerForm.config?.reasoningProtocol);
  }

  get showReasoningProtocol() {
    return !reasoningProtocol(this.providerForm.providerType, this.providerForm.apiBase) || (this.providerForm.config?.reasoningProtocol || "auto") !== "auto";
  }

  get reasoningProtocolItems() {
    return [
      { text: this.isChinese ? "自动识别" : "Auto-detect", value: "auto" },
      { text: "DeepSeek (thinking + reasoning_effort)", value: "deepseek" },
      { text: "OpenAI (reasoning_effort)", value: "openai" },
    ];
  }

  get reasoningItems() {
    const zh = { default: "跟随服务商默认", none: "关闭思考", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "更高", max: "最大" };
    const en = { default: "Provider default", none: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" };
    return reasoningChoices(this.draftReasoningProtocol).map(value => ({ value, text: (this.isChinese ? zh : en)[value] }));
  }

  get reasoningHint() {
    if (!this.draftReasoningProtocol) return this.isChinese ? "默认不发送思考参数；如需控制，请先选择服务商支持的参数格式。" : "No reasoning override. Select a format supported by your provider to enable controls.";
    const note = this.draftReasoningProtocol === "deepseek"
      ? (this.isChinese ? "DeepSeek 当前默认开启高强度思考，翻译可选“关闭思考”以缩短等待。" : "DeepSeek currently defaults to high thinking; Off can reduce translation latency.")
      : (this.isChinese ? "不同模型支持的强度不同，部分模型不能关闭思考；请用所选模型测试。" : "Supported levels vary by model; some cannot disable thinking. Test your selected model.");
    return note + (this.isChinese ? " 此设置用于该供应商所有已启用模型，思考过程不作为译文显示。" : " Applies to all enabled models of this provider. Reasoning is not shown as translation.");
  }

  setDraftStream(value: boolean) {
    this.$set(this.providerForm.config!, "stream", value);
    this.invalidateDraftTest();
  }

  changeReasoningProtocol() {
    this.$set(this.providerForm.config!, "reasoningEffort", "default");
    this.invalidateDraftTest();
  }

  restoreDefaultPrompt() {
    this.providerForm.config!.prompt = DEFAULT_TRANSLATION_PROMPT;
    this.invalidateDraftTest();
  }

  invalidateDraftTest() {
    this.testRequestVersion++;
    this.testingDraft = false;
    this.draftTestResult = "";
    this.draftTestError = "";
  }

  invalidateDraftConnection() {
    this.modelRequestVersion++;
    this.fetchingDraftModels = false;
    this.draftModels = [];
    this.draftModelError = "";
    this.draftModelNotice = "";
    this.formError = "";
    this.invalidateDraftTest();
  }

  pasteApiKey() {
    const key = clipboard.readText().trim();
    if (!key) { this.formError = this.isChinese ? "剪贴板没有可粘贴的文本。" : "The clipboard has no text to paste."; return; }
    this.providerForm.apiKey = key;
    this.invalidateDraftConnection();
  }

  draftModelsChanged() {
    this.providerForm.enabledModels = normalizeModelIds(this.providerForm.enabledModels);
    this.invalidateDraftTest();
  }

  commitDraftModelSearch() {
    this.providerForm.enabledModels = normalizeModelIds([...this.providerForm.enabledModels, this.draftModelSearch]);
    this.draftModelSearch = "";
  }

  async fetchDraftModels() {
    if (this.fetchingDraftModels || !this.canConnect) return;
    const version = ++this.modelRequestVersion;
    this.fetchingDraftModels = true;
    this.draftModelError = "";
    this.draftModelNotice = "";
    try {
      const result = await ipcRenderer.invoke("ai-provider:models", { apiBase: this.providerForm.apiBase, apiKey: this.providerForm.apiKey });
      if (version !== this.modelRequestVersion) return;
      if (!result.ok) { this.draftModelError = result.error; return; }
      const models = normalizeModelIds(result.models);
      if (!models.length) {
        this.draftModelError = this.isChinese ? "服务未返回模型，已保留现有列表。也可手动填写模型 ID。" : "No models returned. Existing choices are preserved; you can also enter a model ID.";
        return;
      }
      this.draftModels = models;
      this.draftModelNotice = this.isChinese ? `已获取 ${models.length} 个模型，保存后可直接使用此列表。请选择支持文本对话的模型。` : `Fetched ${models.length} models. This list will be saved. Choose a text chat model.`;
    } catch { if (version === this.modelRequestVersion) this.draftModelError = this.isChinese ? "获取失败，请重试；也可手动填写模型 ID。" : "Could not fetch models. Retry or enter a model ID."; }
    finally { if (version === this.modelRequestVersion) this.fetchingDraftModels = false; }
  }

  async testDraftConnection() {
    if (this.testingDraft || !this.canConnect || !this.hasDraftModel) return;
    this.commitDraftModelSearch();
    const version = ++this.testRequestVersion;
    this.testingDraft = true;
    this.draftTestResult = "";
    this.draftTestError = "";
    try {
      const result = await ipcRenderer.invoke("ai-provider:test", {
        apiBase: this.providerForm.apiBase, apiKey: this.providerForm.apiKey, providerType: this.providerForm.providerType, config: { ...this.providerForm.config },
      }, this.draftTestModelId);
      if (version !== this.testRequestVersion) return;
      if (!result.ok) { this.draftTestError = result.error; return; }
      const seconds = (ms: number) => (ms / 1000).toFixed(2) + "s";
      const mode = result.responseMode === "sse"
        ? (this.isChinese ? `SSE 流式 · ${result.contentDeltas} 个文本增量` : `SSE stream · ${result.contentDeltas} text deltas`)
        : result.responseMode === "fallback"
          ? (this.isChinese ? "服务拒绝流式，已自动改用普通返回" : "Stream rejected; complete-response fallback succeeded")
          : result.requestedStream
            ? (this.isChinese ? "服务直接返回完整 JSON，未收到流式数据" : "Server returned complete JSON, not a stream")
            : (this.isChinese ? "普通返回（流式已关闭）" : "Complete response (streaming off)");
      const timing = this.isChinese
        ? `首段译文 ${seconds(result.firstContentMs ?? result.elapsedMs)} · 总耗时 ${seconds(result.elapsedMs)}`
        : `First text ${seconds(result.firstContentMs ?? result.elapsedMs)} · Total ${seconds(result.elapsedMs)}`;
      const thinking = result.reasoningDeltas ? (this.isChinese ? " · 收到思考输出" : " · Reasoning received") : "";
      this.draftTestResult = `${this.isChinese ? '连接成功' : 'Connected'} · ${result.model}\n${mode}${thinking}\n${timing}\n${result.text}`;
    } catch { if (version === this.testRequestVersion) this.draftTestError = this.isChinese ? "测试失败，请重试。" : "The test failed. Please retry."; }
    finally { if (version === this.testRequestVersion) this.testingDraft = false; }
  }

  beforeDestroy() { this.invalidateDraftConnection(); }

  get templateItems() {
   return providerTemplates.map(t => {
     const item = {
       text: t.name,
       value: t.type,
       description: t.description || "",
     };
     // 为阶跃星辰添加说明
     if (t.type === 'stepfun') {
       item.text = `${t.name} (${this.trans['stepfunCustomNote'] || '需自备API密钥'})`;
     }
     return item;
   });
 }

  get rules() {
    return {
      required: (v: string) => !!v || (this.trans["required"] || "此项必填"),
    };
  }

  get temperatureDesc(): string {
    const temp = this.providerForm.config?.temperature ?? 0.3;
    if (temp < 0.2) return this.trans["temperatureDesc0"] || "更精确，更确定";
    if (temp < 0.5) return this.trans["temperatureDesc1"] || "平衡";
    if (temp < 0.8) return this.trans["temperatureDesc2"] || "更有创意";
    return this.trans["temperatureDesc3"] || "非常有创意，可能不稳定";
  }

  mounted() {
    // 确保从配置加载最新数据
    customTranslatorManager.reload();
    this.loadProviders();
    if (this.providers.length === 1) this.expandedProviders = [0];
  }

  loadProviders() {
    const baseProviders = customTranslatorManager.getAllProviders();
    this.providers = baseProviders.map(p => {
      const previous = this.providers.find(item => item.id === p.id);
      return {
        ...p,
        enabledModels: [...p.enabledModels],
        availableModels: normalizeModelIds([...(p.availableModels || []), ...p.enabledModels]),
        fetchingModels: false,
        modelFetchError: "",
        manualModel: previous?.manualModel || "",
      };
    });
  }

  onTemplateChange(templateType: string) {
    const template = getProviderTemplate(templateType);
    if (template) {
      this.providerForm.providerType = template.type;
      this.providerForm.config!.reasoningProtocol = "auto";
      this.providerForm.config!.reasoningEffort = "default";
      this.providerForm.apiBase = template.apiBase;
      this.providerForm.name = template.name;
      
      // 清空已获取的模型
      this.providerForm.enabledModels = [];
      this.providerForm.apiKey = "";
      this.draftModelSearch = "";
      this.draftTestModel = "";
      this.invalidateDraftConnection();
    }
  }

  async fetchProviderModels(provider: ProviderWithUI) {
    if (provider.fetchingModels) return;
    if (!provider.apiBase || !provider.apiKey) {
      provider.modelFetchError = this.trans["apiConfigRequired"] || "请先配置 API Base 和 API Key";
      return;
    }

    provider.fetchingModels = true;
    provider.modelFetchError = "";
    const { apiBase, apiKey } = provider;
    const isCurrent = () => {
      const current = customTranslatorManager.getProvider(provider.id);
      return this.providers.includes(provider) && current?.apiBase === apiBase && current?.apiKey === apiKey;
    };

    try {
      const result = await ipcRenderer.invoke("ai-provider:models", { apiBase, apiKey });
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(result.error);
      const models = normalizeModelIds(result.models);
      if (!models.length) throw new Error(this.isChinese ? "服务未返回模型，已保留现有列表。" : "No models returned. Existing choices are preserved.");
      const availableModels = normalizeModelIds([...models, ...provider.enabledModels]);
      if (customTranslatorManager.updateProvider(provider.id, { availableModels })) {
        provider.availableModels = availableModels;
      } else {
        provider.modelFetchError = this.isChinese ? "模型列表保存失败，请重试。" : "Could not save the model list. Please retry.";
      }
    } catch (error) {
      if (!isCurrent()) return;
      provider.modelFetchError = error.message || "获取模型列表失败";
      // A failed refresh must not replace previously saved choices.
      if (!provider.availableModels?.length) {
        const template = getProviderTemplate(provider.providerType);
        provider.availableModels = normalizeModelIds([...provider.enabledModels, ...(template?.recommendedModels || [])]);
      }
    } finally {
      provider.fetchingModels = false;
    }
  }

  updateProviderModels(providerId: string, models: string[]) {
    const provider = this.providers.find(item => item.id === providerId);
    if (!provider) return;
    const enabledModels = normalizeModelIds(models);
    const availableModels = normalizeModelIds([...(provider.availableModels || []), ...provider.enabledModels, ...enabledModels]);
    if (customTranslatorManager.updateProvider(providerId, { enabledModels, availableModels })) {
      provider.enabledModels = enabledModels;
      provider.availableModels = availableModels;
    }
  }

  addManualModel(provider: ProviderWithUI) {
    const model = (provider.manualModel || "").trim();
    if (!model) return;
    provider.availableModels = [...new Set([...(provider.availableModels || []), model])];
    this.updateProviderModels(provider.id, [...new Set([...provider.enabledModels, model])]);
    provider.manualModel = "";
  }

  editProvider(provider: ProviderConfig) {
    this.invalidateDraftConnection();
    this.editingProvider = provider;
    // Load only persisted fields, without the list panel's temporary UI state.
    this.providerForm = JSON.parse(JSON.stringify(customTranslatorManager.getProvider(provider.id) || provider));
    this.providerForm.config = { temperature: 0.3, maxTokens: 4000, stream: true, chatEnabled: true, chatPrompt: DEFAULT_CONTEXT_CHAT_PROMPT, reasoningProtocol: "auto", reasoningEffort: "default", ...this.providerForm.config, prompt: effectivePrompt(this.providerForm.config?.prompt) };
    this.draftModels = normalizeModelIds([...(this.providerForm.availableModels || []), ...this.providerForm.enabledModels]);
    this.selectedTemplate = "";
    this.showAddProviderDialog = true;
  }

  removeProviderConfirm(id: string) {
    const provider = this.providers.find(p => p.id === id);
    const name = provider?.name || id;
    if (confirm(`${this.trans["confirmDelete"] || "确认删除"} "${name}"?`)) {
      customTranslatorManager.removeProvider(id);
      this.loadProviders();
    }
  }

  saveProvider() {
    this.commitDraftModelSearch();
    if (!(this.$refs.form as any).validate() || !this.providerForm.enabledModels.length) return;
    try { Object.assign(this.providerForm, normalizeProviderConnection(this.providerForm.apiBase, this.providerForm.apiKey)); }
    catch (error) { this.formError = error.message; return; }
    this.providerForm.name = this.providerForm.name.trim();
    this.providerForm.availableModels = normalizeModelIds([...this.draftModels, ...this.providerForm.enabledModels]);
    // 确保有必要字段
    if (!this.providerForm.config) {
      this.providerForm.config = {
        temperature: 0.3,
        maxTokens: 4000,
        prompt: DEFAULT_TRANSLATION_PROMPT,
        stream: true,
        chatEnabled: true,
        chatPrompt: DEFAULT_CONTEXT_CHAT_PROMPT,
        reasoningProtocol: "auto",
        reasoningEffort: "default",
      };
    }

    let saved: boolean;
    if (this.editingProvider) {
      // 更新现有供应商
      saved = customTranslatorManager.updateProvider(
        this.editingProvider.id,
        this.providerForm
      );
    } else {
      // 添加新供应商时自动生成 ID
      let baseId = this.providerForm.providerType || "custom";
      
      // 如果有名称，尝试使用名称的简化版本
      if (this.providerForm.name) {
        const simpleName = this.providerForm.name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "");
        if (simpleName) {
          baseId = simpleName;
        }
      }
      
      // 生成唯一 ID
      this.providerForm.id = customTranslatorManager.generateUniqueProviderId(baseId);
      saved = customTranslatorManager.addProvider(this.providerForm);
    }
    if (!saved) { this.formError = this.isChinese ? "保存失败，请重试。" : "Could not save. Please retry."; return; }
    this.loadProviders();
    this.expandedProviders = [this.providers.findIndex(provider => provider.id === this.providerForm.id)];
    this.closeProviderDialog();
    eventBus.at("dispatch", "reloadCustomTranslators", null);
  }

  closeProviderDialog() {
    this.invalidateDraftConnection();
    this.showAddProviderDialog = false;
    this.editingProvider = null;
    this.resetProviderForm();
  }

  resetProviderForm() {
    this.providerForm = {
      id: "",
      name: "",
      providerType: "custom",
      apiBase: "https://",
      apiKey: "",
      enabledModels: [],
      config: {
        temperature: 0.3,
        maxTokens: 4000,
        prompt: DEFAULT_TRANSLATION_PROMPT,
        stream: true,
        chatEnabled: true,
        chatPrompt: DEFAULT_CONTEXT_CHAT_PROMPT,
        reasoningProtocol: "auto",
        reasoningEffort: "default",
      },
      enabled: true,
    };
    this.selectedTemplate = "";
    this.draftModelSearch = "";
    this.draftTestModel = "";
  }

  testProvider(provider: ProviderWithUI) {
    if (provider.enabledModels.length === 0) {
      alert(this.trans["noModelsEnabled"] || "请先启用至少一个模型");
      return;
    }
    
    this.testingProvider = provider;
    this.testModel = provider.enabledModels[0];
    this.showTestDialog = true;
    this.testResult = "";
    this.testError = "";
    this.testing = false;
  }

  async runTest() {
    if (!this.testingProvider || !this.testModel) {
      return;
    }

    this.testing = true;
    this.testResult = "";
    this.testError = "";

    try {
      const translatorId = customTranslatorManager.getTranslatorIdForModel(
        this.testingProvider.id,
        this.testModel
      );

      const requestId = Date.now().toString() + Math.random().toString();
      const resultPromise = new Promise((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout>;
        const successHandler = (res: any) => {
          if (res.id === requestId) {
            cleanup();
            resolve(res.data);
          }
        };
        const errorHandler = (err: any) => {
          if (err.id === requestId) {
            cleanup();
            reject(err.error);
          }
        };
        const cleanup = () => {
          eventBus.goff("testTranslateResult", successHandler);
          eventBus.goff("testTranslateError", errorHandler);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        };
        eventBus.gon("testTranslateResult", successHandler);
        eventBus.gon("testTranslateError", errorHandler);

        // Set timeout
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Translation timeout"));
        }, 60000);
      });

      eventBus.at("dispatch", "testTranslate", {
        id: requestId,
        text: this.testText,
        engine: translatorId,
        from: this.testFrom,
        to: this.testTo,
      });

      const result: any = await resultPromise;
      this.testResult = result.trans.paragraphs.join("\n");
    } catch (error) {
      this.testError = String(error);
    } finally {
      this.testing = false;
    }
  }
}
</script>

<style scoped>
.custom-translator-manager {
  height: 100%;
  overflow: auto;
}
.setup-steps { margin: 0 0 20px; padding-left: 20px; line-height: 1.8; }
.manual-model { display: flex; align-items: flex-start; gap: 8px; margin-top: 18px; }
.manual-model .v-btn { margin-top: 4px; flex-shrink: 0; }
.model-picker-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.connection-result { white-space: pre-line; overflow-wrap: anywhere; }
.connection-test { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
@media (max-width: 600px) { .manual-model { flex-direction: column; } .manual-model .v-input { width: 100%; } }
</style>
