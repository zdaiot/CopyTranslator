import { ConfigParser } from "./configParser";
import {
  Identifier,
  MenuActionType,
  Role,
  roles,
  layoutTypes,
  ActionView,
  compose,
  hideDirections,
  SubActionView,
  decompose,
  ActionInitOpt,
  ActionLayout,
  colorModes,
  structActionTypes,
  translatorTypes,
  translatorGroups,
  Category,
  dragCopyModes,
  selectionPopupTriggers,
  listenClipboardModes,
  categories,
  displayTexts,
  ConfigSnapshots,
  SubMenuGenerator,
} from "./types";
import { dictionaryTypes } from "./dictionary/types";
import { getLanguageLocales, Language } from "./translate/locale";
import store from "../store";
import bus from "../common/event-bus";
import logger from "./logger";
import { TranslatorNameResolver } from "./translate/translator-name-resolver";
import { getEnabledWithCustomIds } from "./translate/translators";

type Actions = Map<Identifier, ActionView>;
type PostLocaleFunc = (x: string) => string;

function subMenuGenerator(
  identifier: Identifier,
  list: Array<string>,
  needLocale: boolean = false,
  postLocaleFunc?: PostLocaleFunc
): SubActionView[] {
  const l = store.getters.locale;
  return list.map((e) => {
    const id = compose([identifier, e]);
    let label = e;
    if (needLocale) {
      // 使用统一的名称解析器
      label = TranslatorNameResolver.getDisplayName(e, l);
      if (postLocaleFunc != undefined) {
        label = postLocaleFunc(label);
      }
    }
    return {
      id,
      type: "checkbox",
      label,
    };
  });
}

const alias = new Map<string, string[]>([
  ["focus", ["layoutType|focus"]],
  ["contrast", ["layoutType|horizontal"]],
  ["simulateIncrementCopy", ["incrementCounter", "simulateCopy"]],
]);

//兼容旧版本的
const isMain = process.type == "browser";

class ActionManager {
  actions = new Map<Identifier, ActionView>();
  config: ConfigParser;
  constructor(config: ConfigParser) {
    this.config = config;
    bus.on("dispatch", (...args: any[]) => {
      this.dispatch(...args);
    });
  }

  dispatch(...args: any[]) {
    const { identifier, param } = decompose(...args);

    if (alias.get(identifier) != undefined) {
      for (const id of alias.get(identifier) as string[]) {
        this.dispatch(id);
      }
      return;
    }
    const action = this.getAction(identifier);
    bus.at("callback", {
      identifier,
      param,
      type: action.actionType,
      isMain,
    });
  }

  getAction(identifier: Identifier): ActionView {
    if (!this.actions.has(identifier)) {
      logger.toast(`动作 ${identifier} 不存在`);
      return { id: identifier, type: "normal" } as ActionView;
    }
    const action = this.actions.get(identifier) as ActionView;
    if (action && action.subMenuGenerator) {
      action.submenu = action.subMenuGenerator(action.id);
    }
    return action;
  }

  append(action: ActionInitOpt) {
    if (!action.actionType) {
      action.actionType = action.type;
    }
    if (this.actions.has(action.id)) {
      throw "duplicated action id";
    }
    this.actions.set(action.id, action as ActionView);
  }

  init() {
    const config = this.config;
    //普通的按钮，执行一项操作
    function normalAction(id: Identifier, cate?: Category): ActionInitOpt {
      return {
        type: "normal",
        id,
        cate,
      };
    }
    //原生角色
    function roleAction(role: Role): ActionInitOpt {
      return {
        role: role,
        id: role,
        type: "normal",
      };
    }
    //设置常量
    function constantAction(
      identifier: Identifier,
      cate?: Category
    ): ActionInitOpt {
      return {
        actionType: "constant",
        id: identifier,
        cate,
      };
    }
    this.append(constantAction("networkProxy"));
    this.append(switchAction("enableNetworkProxy","advance"));

    //切换状态的动作
    function switchAction(
      identifier: Identifier,
      cate: Category = "basic"
    ): ActionInitOpt {
      return {
        type: "checkbox",
        id: identifier,
        cate,
      };
    }

    //列表类型，是select的一种特化
    function listAction(
      identifier: Identifier,
      list: any,
      cate?: Category,
      needLocale: boolean = false,
      postLocaleFunc?: PostLocaleFunc
    ): ActionInitOpt {
      if (!needLocale) {
        return {
          type: "submenu",
          id: identifier,
          submenu: subMenuGenerator(identifier, list, false),
          cate,
        };
      } else {
        return {
          type: "submenu",
          id: identifier,
          cate,
          subMenuGenerator: () =>
            subMenuGenerator(identifier, list, true, postLocaleFunc),
        };
      }
    }

    //列表类型，是select的一种特化
    function genericListAction(
      actionType: ActionInitOpt["actionType"],
      identifier: Identifier,
      listGenerator: () => string[],
      cate?: Category,
      needLocale: boolean = false,
      postLocaleFunc?: PostLocaleFunc
    ): ActionInitOpt {
      return {
        actionType,
        id: identifier,
        cate,
        subMenuGenerator: () =>
          subMenuGenerator(
            identifier,
            listGenerator(),
            needLocale,
            postLocaleFunc
          ),
      };
    }

    //动态生成子菜单
    function selectAction(
      identifier: Identifier,
      subMenuGenerator: SubMenuGenerator,
      cate?: Category
    ): ActionInitOpt {
      return {
        type: "submenu",
        id: identifier,
        subMenuGenerator: subMenuGenerator,
        cate,
      };
    }

    //含参数的normal action
    function paramNormalAction(
      identifier: Identifier,
      subMenuGenerator: SubMenuGenerator,
      cate?: Category
    ): ActionInitOpt {
      return {
        actionType: "param_normal",
        id: identifier,
        subMenuGenerator: subMenuGenerator,
        cate,
      };
    }

    function typeAction(
      actionType: ActionInitOpt["actionType"],
      identifier: Identifier,
      cate?: Category
    ): ActionInitOpt {
      return {
        actionType: actionType,
        id: identifier,
        cate,
      };
    }

    function getLanguages(isSource: boolean = true): Language[] {
      let langs: Language[] | undefined = isSource
        ? store.state.languages.sources
        : store.state.languages.targets;
      return langs.filter((x) => {
        if (!isSource && x == "auto") {
          return false;
        }
        return true;
      });
    }

    function createLanguageGenerator(
      isSource: boolean = true
    ): SubMenuGenerator {
      return (identifier: string) => {
        const l = getLanguageLocales(store.getters.localeSetting);
        return getLanguages(isSource).map((e) => {
          return {
            id: compose([identifier, e]),
            label: l[e],
            type: "checkbox",
          };
        });
      };
    }

    const localeGenerator: SubMenuGenerator = (id: string) => {
      const locales = store.getters.locales.map((locale: any) => {
        return {
          id: compose([id, locale.lang]),
          label: locale.localeName,
          type: "checkbox",
        };
      });
      return locales;
    };
    const delays = [
      0.0,
      0.1,
      0.2,
      0.3,
      0.3,
      0.4,
      0.5,
      0.6,
      0.7,
      0.8,
      0.9,
      1.0,
      1.5,
      2.0,
    ];
    const heights = [];
    for (let i = 1; i < 41; i++) {
      heights.push(i);
    }
    const paddings = [];
    for (let i = 0; i <= 40; i += 2) {
      paddings.push(i);
    }
    const lineHeights = [];
    for (let i = 10; i <= 30; i++) {
      lineHeights.push(Number((i / 10).toFixed(1)));
    }

    const getTranslatorTypes = (id: Identifier) => {
      return () => {
        const allTranslators = TranslatorNameResolver.getAllTranslatorIds();
        switch (id) {
          case "translator-compare":
          case "translator-cache":
            // 只返回已启用的翻译器（配置中的ID）
            const enabled = config.get<string[]>("translator-enabled") || [];
            const custom = config.get<string[]>("customTranslators") || [];
            return getEnabledWithCustomIds(enabled, custom);
          case "translator-enabled":
          case "translator-double":
            // 返回所有可用翻译器
            return allTranslators;
          default:
            return allTranslators;
        }
      };
    };

    const getConfigSnapshotNames: SubMenuGenerator = (id: string) => {
      const names = [
        ...Object.keys(config.get<ConfigSnapshots>("configSnapshots")),
      ];
      return names.map((option) => {
        return {
          id: compose([id, option]),
          type: "normal",
          label: option,
        };
      });
    };

    this.append(
      genericListAction(
        "submenu",
        "translatorType",
        getTranslatorTypes("translatorType"),
        "translation",
        true
      )
    );
    this.append(listAction("dictionaryType", dictionaryTypes, "translation", true));
    this.append(
      genericListAction(
        "submenu",
        "fallbackTranslator",
        getTranslatorTypes("fallbackTranslator"),
        "translation",
        true
      )
    );
    this.append(listAction("pasteDelay", delays, "translation"));

    this.append(listAction("colorMode", colorModes, "appearance"));
    this.append(typeAction("color_picker", "fontColor", "appearance"));
    this.append(typeAction("color_picker", "backgroundColor", "appearance"));
    this.append(typeAction("color_picker", "primaryColor", "appearance"));
    this.append(
      listAction(
        "transparency",
        [0.0, 0.1, 0.2, 0.3, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        "appearance"
      )
    );
    this.append(normalAction("newConfigSnapshot", "snapshotManage"));
    this.append(
      paramNormalAction(
        "configSnapshot",
        getConfigSnapshotNames,
        "snapshotManage"
      )
    );
    this.append(
      paramNormalAction(
        "delConfigSnapshot",
        getConfigSnapshotNames,
        "snapshotManage"
      )
    );
    this.append(listAction("titlebarHeight", heights, "appearance"));
    this.append(listAction("contentPadding", paddings, "appearance"));
    this.append(listAction("contentLineHeight", lineHeights, "appearance"));
    this.append(switchAction("penerate", "appearance"));
    this.append(constantAction("contentFontFamily", "appearance"));
    this.append(constantAction("interfaceFontFamily", "appearance"));
    this.append(selectAction("localeSetting", localeGenerator, "appearance"));
    this.append(listAction("hideDirect", hideDirections, "appearance"));
    this.append(listAction("layoutType", layoutTypes, "appearance"));

    this.append(switchAction("listenClipboard"));
    this.append(switchAction("enableOCR"));
    this.append(switchAction("stayTop"));
    this.append(switchAction("selectionPopup"));
    this.append(listAction("selectionPopupTrigger", [...selectionPopupTriggers], "basic", true));
    this.append(normalAction("selectionTranslate"));
    if (process.platform === "darwin") this.append(normalAction("selectionPermission", "basic"));
    this.append(switchAction("dragCopy"));
    this.append(switchAction("autoCopy"));
    this.append(switchAction("autoPaste"));
    this.append(switchAction("autoFormat"));
    this.append(switchAction("incrementalCopy"));
    this.append(switchAction("autoHide"));
    this.append(switchAction("autoShow"));
    this.append(switchAction("skipTaskbar"));
    this.append(switchAction("showTrayIcon"));
    this.append(switchAction("multiSource"));

    this.append(switchAction("openAtLogin", "advance"));
    this.append(switchAction("closeAsQuit", "advance"));
    this.append(switchAction("doubleClickCopy", "advance"));
    this.append(switchAction("enableDoubleCopyTranslate", "advance"));
    this.append(switchAction("smartDict", "advance"));
    this.append(switchAction("contrastDict", "advance"));
    this.append(switchAction("focusSource", "advance"));
    this.append(switchAction("enableNotify", "advance"));
    this.append(switchAction("neverShowTips", "advance"));
    this.append(switchAction("autoPurify", "advance"));
    this.append(switchAction("toastTip", "advance"));
    this.append(switchAction("smartTranslate", "advance"));
    this.append(switchAction("autoCheckUpdate", "advance"));
    this.append(switchAction("drawer", "advance"));

    this.append(normalAction("copySource"));
    this.append(normalAction("copyResult"));
    this.append(normalAction("pasteResult"));
    this.append(normalAction("clear"));
    this.append(normalAction("notify"));
    this.append(normalAction("toast"));
    this.append(normalAction("retryTranslate"));
    this.append(normalAction("focus"));
    this.append(normalAction("contrast"));
    this.append(normalAction("capture"));
    this.append(normalAction("checkUpdate"));

    this.append(normalAction("changelog"));
    this.append(normalAction("userManual"));
    this.append(normalAction("homepage"));

    this.append(normalAction("translate"));
    this.append(normalAction("selectionQuery"));
    this.append(normalAction("hideWindow"));
    this.append(normalAction("closeWindow"));
    this.append(normalAction("showWindow"));
    this.append(normalAction("translateClipboard"));
    this.append(normalAction("doubleCopyTranslate"));
    this.append(normalAction("incrementCounter"));
    this.append(normalAction("simulateCopy"));
    this.append(normalAction("translateInput"));
    this.append(normalAction("simpleDebug"));
    this.append(normalAction("welcome"));
    this.append(normalAction("testTranslate"));
    this.append(normalAction("reloadCustomTranslators"));

    //引擎配置
    structActionTypes.forEach((id) => {
      this.append(typeAction("config", id));
    });

    this.append(typeAction("config", "actionButtons"));

    //引擎组设置
    translatorGroups.forEach((id) => {
      this.append(
        genericListAction(
          "multi_select",
          id,
          getTranslatorTypes(id),
          undefined,
          false,
          undefined
        )
      );
    });

    //显示文本的动作
    displayTexts.forEach((id) => {
      this.append(typeAction("prompt", id));
    });

    roles //role action
      .forEach((role) => {
        this.append(roleAction(role));
      });

    this.append(selectAction("sourceLanguage", createLanguageGenerator(true)));
    this.append(selectAction("targetLanguage", createLanguageGenerator(false)));

    this.append(
      listAction("dragCopyMode", dragCopyModes, undefined, true, (x) =>
        x.replace("拖拽复制", "").replace("DragCopy", "").trim()
      )
    ); //TODO 很丑的实现，但是不是很想改

    this.append(
      listAction(
        "listenClipboardMode",
        listenClipboardModes,
        undefined,
        true,
        (x) => x.replace("监听剪贴板", "").replace("ListenClipboard", "").trim()
      )
    ); //TODO 很丑的实现，但是不是很想改

    this.append(typeAction("config", "dragCopyWhiteList"));
    this.append(typeAction("config", "dragCopyBlackList"));

    this.append(typeAction("config", "listenClipboardWhiteList"));
    this.append(typeAction("config", "listenClipboardBlackList"));

    this.append(normalAction("settings"));
    this.append(normalAction("helpAndUpdate"));
    this.append(normalAction("exit"));

    this.append(normalAction("editConfigFile", "other"));
    this.append(normalAction("showConfigFolder", "other"));
    this.append(normalAction("restoreDefault", "other"));
    this.append(normalAction("restoreMultiDefault"));
    this.append(normalAction("enumerateLayouts"));

    const layoutMap: Partial<Record<Identifier, ActionLayout>> = {
      googlePrompt: { group: "提示", span: 1 },
      textAdjustPrompt: { group: "提示", span: 1 },
      translatorType: { group: "翻译器", span: 0.5 },
      dictionaryType: { group: "翻译器", span: 0.5 },
      fallbackTranslator: { group: "翻译器", span: 0.5 },
      sourceLanguage: { group: "语言", span: 0.5, stack: true },
      targetLanguage: { group: "语言", span: 0.5, stack: true },
      localeSetting: { group: "语言", span: 0.5, stack: true },
      pasteDelay: { group: "剪贴板", span: 0.5 },
      listenClipboardMode: { group: "剪贴板", span: 0.5 },
      dragCopyMode: { group: "剪贴板", span: 0.5 },
      listenClipboard: { group: "剪贴板", span: 0.5 },
      autoCopy: { group: "剪贴板", span: 0.5 },
      autoPaste: { group: "剪贴板", span: 0.5 },
      autoFormat: { group: "剪贴板", span: 0.5 },
      selectionPopupTrigger: { group: "剪贴板", span: 1 },
      selectionPopup: { group: "剪贴板", span: 0.5 },
      selectionPermission: { group: "剪贴板", span: 1 },
      dragCopy: { group: "剪贴板", span: 0.5 },
      incrementalCopy: { group: "剪贴板", span: 0.5 },
      colorMode: { group: "主题与颜色", span: 0.5 },
      primaryColor: { group: "主题与颜色", span: 0.5 },
      fontColor: { group: "主题与颜色", span: 0.5 },
      backgroundColor: { group: "主题与颜色", span: 0.5 },
      transparency: { group: "布局", span: 0.5 },
      titlebarHeight: { group: "布局", span: 0.5 },
      contentPadding: { group: "布局", span: 0.5 },
      contentLineHeight: { group: "布局", span: 0.5 },
      layoutType: { group: "布局", span: 0.5 },
      penerate: { group: "布局", span: 0.5 },
      contentFontFamily: { group: "字体", span: 1 },
      interfaceFontFamily: { group: "字体", span: 1 },
      hideDirect: { group: "窗口", span: 0.5 },
      skipTaskbar: { group: "窗口", span: 0.5 },
      showTrayIcon: { group: "窗口", span: 1 },
      stayTop: { group: "窗口", span: 0.5 },
      drawer: { group: "窗口", span: 0.5 },
      autoHide: { group: "窗口", span: 0.5 },
      autoShow: { group: "窗口", span: 0.5 },
      openAtLogin: { group: "窗口", span: 0.5 },
      closeAsQuit: { group: "窗口", span: 0.5 },
      enableOCR: { group: "OCR", span: 0.5 },
      smartDict: { group: "词典与智能", span: 0.5 },
      contrastDict: { group: "词典与智能", span: 0.5 },
      focusSource: { group: "词典与智能", span: 0.5 },
      smartTranslate: { group: "词典与智能", span: 0.5 },
      enableNotify: { group: "提示", span: 0.5 },
      neverShowTips: { group: "提示", span: 0.5 },
      toastTip: { group: "提示", span: 0.5 },
      autoCheckUpdate: { group: "更新与其他", span: 0.5 },
      multiSource: { group: "高级", span: 0.5 },
      enableDoubleCopyTranslate: { group: "高级", span: 0.5 },
      doubleClickCopy: { group: "高级", span: 0.5 },
      newConfigSnapshot: { group: "配置快照", span: 0.5 },
      configSnapshot: { group: "配置快照", span: 0.5 },
      delConfigSnapshot: { group: "配置快照", span: 0.5 },
      translateInput: { group: "翻译", span: 0.5 },
      translate: { group: "翻译", span: 0.5 },
      settings: { group: "翻译", span: 0.5 },
      copySource: { group: "复制", span: 0.5 },
      copyResult: { group: "复制", span: 0.5 },
      clear: { group: "复制", span: 0.5 },
      editConfigFile: { group: "更新与其他", span: 0.5 },
      showConfigFolder: { group: "更新与其他", span: 0.5 },
      restoreDefault: { group: "更新与其他", span: 0.5 },
    };

    Object.entries(layoutMap).forEach(([id, layout]) => {
      const action = this.actions.get(id as Identifier);
      if (action) {
        action.layout = { ...action.layout, ...layout };
      }
    });
  }

  getKeys(optionType: MenuActionType | Category): Array<Identifier> {
    let contain: Array<Identifier> = [];
    const keys = Array.from(this.actions.keys());
    const filterByCate = (cate: Category) => {
      return (x: Identifier) => this.getAction(x).cate === cate;
    };
    switch (optionType) {
      case "translatorGroups":
        contain = Array.from(translatorGroups);
        break;
      case "allActions":
        const invalidTypes: ActionInitOpt["actionType"][] = [
          "prompt",
          "submenu",
          "multi_select",
          "config",
          "constant",
        ];
        const invalidKeys: Identifier[] = [
          "simpleDebug",
          "notify",
          "toast",
          "selectionQuery",
          "simulateCopy",
          "welcome",
          "doubleCopyTranslate",
          "restoreMultiDefault",
          "testTranslate",
          "reloadCustomTranslators",
        ];
        contain = keys.filter((x) => {
          const action = this.getAction(x);
          return (
            (!invalidKeys.includes(x) &&
              !invalidTypes.includes(action.actionType) &&
              !action.role) ||
            x == "minimize"
          );
        });
        break;
      case "contrastPanel":
        contain = this.config.get("contrastPanel");
        break;
      case "tray":
        contain = this.config.get("tray");
        break;
      case "options":
        contain = keys.filter((x) => {
          return (
            ["submenu", "constant"].includes(this.getAction(x).actionType) &&
            ![
              "dragCopyMode",
              "listenClipboardMode",
              "sourceLanguage",
              "targetLanguage",
              "layoutType",
            ].includes(x)
          );
        });
        break;
      case "focusContext":
        contain = [
          "copy",
          "paste",
          "cut",
          "clear",
          "copyResult",
          "copySource",
          "newConfigSnapshot",
          "configSnapshot",
        ];
        break;
      case "contrastContext":
        contain = [
          "copy",
          "paste",
          "cut",
          "clear",
          "copyResult",
          "copySource",
          "newConfigSnapshot",
          "configSnapshot",
        ];
        break;
      case "snapshotManage":
        contain = [
          "newConfigSnapshot",
          "configSnapshot",
          "delConfigSnapshot",
        ];
        break;
      case "diffContext":
        contain = [
          "copy",
          "paste",
          "cut",
          "clear",
          "copySource",
          "translator-compare",
          "newConfigSnapshot",
          "configSnapshot",
        ];
        break;
      default:
        if (categories.includes(optionType as Category)) {
          contain = keys.filter(filterByCate(optionType as Category));
          if (optionType === "appearance") {
            contain = ["textAdjustPrompt", ...contain]; //加一个关于文本大小的调节提示
          } else if (optionType === "translation") {
            contain = ["googlePrompt", ...contain]; //加一个关于谷歌的提示
          }
        } else {
          throw "wrong";
        }
    }
    return contain.filter((key) => keys.includes(key));
  }
}

export { ActionManager };
