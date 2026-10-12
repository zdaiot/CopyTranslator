import { getTranslator, translators, Translator, Language, detectLang } from "./translators";
import {
  TranslateResult,
  DirectionalTranslator,
  ResultBuffer,
  CopyTranslateResult,
  SharedResult,
  emptySharedResult,
} from "./types";
import { TranslatorType } from "@/common/types";
import { AxiosRequestConfig } from "axios";
import { autoReSegment, notEnglish } from "./helper";
import { translationAborted } from "./chat-stream";
import eventBus from "../event-bus";
import config from "../configuration";
import store from "@/store";
import { tracker } from "@/main/tracker";

class ResultBufferManager {
  public resultBufferMap = new Map<TranslatorType | string, SharedResult | undefined>();

  engines: (TranslatorType | string)[] = [];

  clear(engines: (TranslatorType | string)[]) {
    this.engines = engines;
    this.resultBufferMap.clear();
    this.sync();
  }

  sync() {
    let resultBuffer: ResultBuffer = {};
    for (const engine of this.engines) {
      if (this.resultBufferMap.has(engine)) {
        resultBuffer[engine] = this.get(engine) as SharedResult;
      } else {
        resultBuffer[engine] = emptySharedResult({ status: "Translating" });
      }
    }
    store.dispatch("setResultBuffer", resultBuffer);
  }

  extend(engines: (TranslatorType | string)[]) {
    for (const engine of engines) {
      if (!this.engines.includes(engine)) {
        this.engines.push(engine);
      }
    }
    this.sync();
  }

  get(engine: TranslatorType | string) {
    return this.resultBufferMap.get(engine);
  }

  has(engine: TranslatorType | string) {
    const result = this.get(engine);
    return !!result && result.status !== "Translating" && result.status !== "Fail";
  }

  set(engine: TranslatorType | string, result: SharedResult) {
    if (!this.engines.includes(engine)) {
      this.engines.push(engine);
    }
    this.resultBufferMap.set(engine, result);
    this.sync();
  }
}

export class Compound {
  private request?: AbortController;
  mainEngine: TranslatorType | string;
  config: AxiosRequestConfig;
  resultBuffer = new ResultBufferManager();

  text: string = "";
  from: Language = "auto";
  to: Language = "en";

  engines: (TranslatorType | string)[];
  detectEngine: TranslatorType = "baidu";

  constructor(
    engines: (TranslatorType | string)[],
    mainEngine: TranslatorType | string = "google",
    config: AxiosRequestConfig = {}
  ) {
    this.engines = engines;
    this.mainEngine = mainEngine;
    this.config = config;
  }


  initialize() {
    return this.postSetEngines();
  }

  onExit() {
    this.cancel();
    this.engines = []; //关闭所有intercepter引擎
    return this.postSetEngines();
  }

  postSetEngines() {
    return Promise.resolve(true);
  }

  setEngines(engines: (TranslatorType | string)[]) {
    this.engines = engines;
    if (!this.engines.includes(this.mainEngine)) {
      eventBus.at("dispatch", "translatorType", this.engines[0]);
    }
    return this.postSetEngines();
  }

  getMainEngine() {
    return getTranslator(this.mainEngine);
  }

  isSupport(engineName: TranslatorType | string, from: Language, to: Language): boolean {
    const engine = getTranslator(engineName);
    if (engine instanceof DirectionalTranslator) {
      return engine.isSupport(from, to);
    } else {
      const supportLanguages = engine.getSupportLanguages();
      return supportLanguages.includes(from) && supportLanguages.includes(to);
    }
  }

  async translate(
    text: string,
    from: Language,
    to: Language,
    engines?: (TranslatorType | string)[],
    onProgress?: (result: SharedResult) => void
  ): Promise<SharedResult> {
    this.cancel();
    const request = this.request = new AbortController();
    if (!engines) {
      engines = [...this.engines];
    }
    const fallbackEngine = config.get("fallbackTranslator") as TranslatorType;
    let mainEngine = this.mainEngine;
    if (!engines.includes(this.mainEngine)) {
      engines.push(this.mainEngine);
    } //这里肯定是要有mainEngine

    const supportEngines = engines.filter((engine) => {
      const support = this.isSupport(engine, from, to);
      return support;
    });
    if (!supportEngines.includes(this.mainEngine)) {
      mainEngine = fallbackEngine;
    } //如果主引擎不支持的话，就切换到副引擎
    if (this.text === text && this.from === from && this.to === to) {
      this.resultBuffer.extend(supportEngines);
    } else {
      this.resultBuffer.clear(supportEngines);
      this.text = text;
      this.from = from;
      this.to = to;
    }
    //先清空缓存
    const mainResult = this.translateWith(mainEngine, text, from, to, onProgress, request.signal);
    for (const name of supportEngines) {
      if (name === mainEngine) {
        continue;
      }
      const engine = getTranslator(name);
      if (
        engine instanceof DirectionalTranslator &&
        !engine.isSupport(from, to)
      ) {
        console.log(name, "不支持", from, "to", to);
        continue;
      } else {
        this.translateWith(name, text, from, to, undefined, request.signal).catch((err: any) => {
          if (!request.signal.aborted) console.log(name, "translate error", err);
        }); //这里catch一下就好了
      }
    }
    return mainResult;
  }

  async translateWith(
    engine: TranslatorType | string,
    text: string,
    from: Language,
    to: Language,
    onProgress?: (result: SharedResult) => void,
    signal?: AbortSignal
  ): Promise<SharedResult> {
    if (this.resultBuffer.has(engine)) {
      //如果已经有缓存了,直接返回就行了
      return Promise.resolve(this.resultBuffer.get(engine) as SharedResult);
    }
    const translator = getTranslator(engine);
    const progress = (translation: string) => {
      if (signal?.aborted) return;
      const result: SharedResult = {
        text, translation, from, to, engine, status: "Translating",
        textPara: text.split(/\n+/), transPara: translation.split(/\n+/), chineseStyle: notEnglish(to),
      };
      this.resultBuffer.set(engine, result);
      onProgress?.(result);
    };
    const result = translator.translateStream
      ? translator.translateStream(text, from, to, progress, signal)
      : translator.translate(text, from, to, this.config);
    return result
      .then((res: TranslateResult) => {
        res.engine = engine; //防止res.engine值不一样
        return res;
      })
      .then(autoReSegment)
      .then((result: CopyTranslateResult) => {
        return {
          text: result.text,
          translation: result.resultString,
          from: result.from,
          to: result.to,
          engine: result.engine,
          transPara: result.trans.paragraphs,
          textPara: result.origin.paragraphs,
          chineseStyle: notEnglish(result.to),
        };
      })
      .then((res: SharedResult) => {
        if (signal?.aborted) throw translationAborted();
        tracker.track("translation", String(engine));
        this.resultBuffer.set(engine, res);
        return res;
      }).catch(error => {
        if (!signal?.aborted) this.resultBuffer.set(engine, emptySharedResult({ text, engine, status: "Fail" }));
        throw error;
      });
  }

  cancel() { this.request?.abort(); }

  async detect(text: string) {
    // 优先使用离线检测，速度最快
    const lang = detectLang(text);
    if (lang) {
      return lang;
    }
    // 如果离线检测失败（返回 null/undefined），再回退到在线检测
    return getTranslator(this.detectEngine).detect(text);
  }

  getBuffer(engine: TranslatorType | string) {
    return this.resultBuffer.has(engine) ? this.resultBuffer.get(engine as TranslatorType) : undefined;
  }

  setMainEngine(engineType: TranslatorType | string) {
    this.mainEngine = engineType;
  }

  getSupportLanguages(): Language[] {
    throw "This method should not be used.";
  }

  getSupportSourceLanguages(): Language[] {
    const mainEngine = this.getMainEngine();
    if (mainEngine instanceof DirectionalTranslator) {
      return mainEngine.getSupportSourceLanguages();
    } else {
      return mainEngine.getSupportLanguages();
    }
  }

  getSupportTargetLanguages(): Language[] {
    const mainEngine = this.getMainEngine();
    if (mainEngine instanceof DirectionalTranslator) {
      return mainEngine.getSupportTargetLanguages();
    } else {
      return mainEngine.getSupportLanguages();
    }
  }
}
