import { Translator, Language, TranslateQueryResult } from "@opentranslate/translator";
import { Baidu } from "@opentranslate/baidu";
import { createHash } from "crypto";

interface BaiduConfig { appid?: string; key?: string; legacyClientId?: string }
const languageCodes: Record<string, string> = {
  "zh-CN": "zh", "zh-TW": "cht", ja: "jp", ko: "kor", fr: "fra",
  es: "spa", ar: "ara", bg: "bul", et: "est", da: "dan", sl: "slo", sv: "swe", vi: "vie",
};
const language = (value: string) => languageCodes[value] || value;

/** Preserve the optional Baidu compatibility route shipped with older releases.
 * Build credentials stay in the local environment; user API credentials win.
 */
export class BaiduCompatible extends Translator<BaiduConfig> {
  readonly name = "baidu";
  getSupportLanguages() { return new Baidu().getSupportLanguages(); }

  protected async query(text: string, from: Language, to: Language, config: BaiduConfig): Promise<TranslateQueryResult> {
    const appid = config.appid?.trim(), key = config.key?.trim();
    let url: string, params: Record<string, string>;
    if (appid && key) {
      const salt = String(Date.now());
      url = "https://api.fanyi.baidu.com/api/trans/vip/translate";
      params = { appid, salt, sign: createHash("md5").update(appid + text + salt + key).digest("hex") };
    } else if (appid || key) {
      throw new Error("请在设置 → API 中完整填写百度 APP ID 和密钥，或将两项都留空使用兼容接口。");
    } else if (config.legacyClientId) {
      url = "https://openapi.baidu.com/public/2.0/bmt/translate";
      params = { client_id: config.legacyClientId };
    } else {
      throw new Error("此构建未包含百度兼容配置。请在设置 → API → 百度翻译中填写 APP ID 和密钥。");
    }
    let data: any;
    try {
      ({ data } = await this.request(url, { params: { ...params, q: text, from: language(from), to: language(to) } }));
    } catch {
      // Do not expose request URLs, source text or credentials in error logs.
      throw new Error("连接百度翻译失败，请检查网络或稍后重试。");
    }
    if (data?.error_code) {
      const code = String(data.error_code);
      if (["52003", "54000", "54001", "58000", "58002", "100", "110", "111"].includes(code)) {
        throw new Error(`百度认证失败（${code}）。请检查设置 → API 中的 APP ID、密钥及服务开通状态。`);
      }
      if (["54003", "54004", "54005"].includes(code)) throw new Error(`百度额度或频率受限（${code}），请稍后重试或检查账号额度。`);
      throw new Error(`百度翻译服务暂不可用（${code}），请稍后重试。`);
    }
    const rows = data?.trans_result;
    if (!Array.isArray(rows) || !rows.length || rows.some(row => typeof row.src !== "string" || typeof row.dst !== "string")) {
      throw new Error("百度翻译没有返回有效译文，请稍后重试。");
    }
    const detected = Object.keys(languageCodes).find(key => languageCodes[key] === data.from) || data.from || from;
    const speech = new Baidu();
    return { text, from: detected, to,
      origin: { paragraphs: rows.map(row => row.src), tts: await speech.textToSpeech(text, detected) },
      trans: { paragraphs: rows.map(row => row.dst), tts: await speech.textToSpeech(rows.map(row => row.dst).join(" "), to) } };
  }
}
