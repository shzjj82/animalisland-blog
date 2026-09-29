import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { zh } from "./locales/zh";

export type AppLocale = "zh" | "en";

const LOCALE_KEY = "editor:locale";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof zh };
  }
}

/** 用户选过就用选的；否则跟随浏览器语言：中文环境用中文，其余用英文 */
function initialLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === "zh" || stored === "en") {
      return stored;
    }
  } catch {
    // 读不到本地设置时退回浏览器语言
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function syncDocument() {
  document.documentElement.lang = appLocale() === "zh" ? "zh-CN" : "en";
  document.title = i18n.t("app.title");
}

void i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: initialLocale(),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
  initAsync: false,
});
syncDocument();
i18n.on("languageChanged", syncDocument);

export function appLocale(): AppLocale {
  return i18n.language === "en" ? "en" : "zh";
}

export async function setAppLocale(locale: AppLocale) {
  localStorage.setItem(LOCALE_KEY, locale);
  await i18n.changeLanguage(locale);
}

/** 组件外（store、lib、Editor.js 工具）用；组件内用 useTranslation 才能随语言切换重渲染 */
export const t = i18n.t.bind(i18n);

const UNTITLED = new Set<string>([zh.common.untitled, en.common.untitled]);

/** 没写标题的页面会把当时语言的「无标题」存进数据，显示时统一换成当前语言 */
export function pageTitle(title: string | undefined | null): string {
  const text = title?.trim() ?? "";
  return text && !UNTITLED.has(text) ? text : t("common.untitled");
}

export default i18n;
