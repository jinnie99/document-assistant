"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, LOCALE_INFO, LOCALES, parseLocale, type Locale } from "@/lib/i18n/locales";
import { ko, type Messages } from "./messages/ko";
import { en } from "./messages/en";
import { zh } from "./messages/zh";
import { vi } from "./messages/vi";
import { ja } from "./messages/ja";
import { th } from "./messages/th";

export const MESSAGES: Record<Locale, Messages> = { ko, en, zh, vi, ja, th };

type LabelSource = { id: string; label: string };
export type I18n = {
  locale: Locale;
  t: Messages;
  /** 고른 언어로 옮긴 항목명. 아직 옮기지 못했으면 서류에 인쇄된 한국어 그대로다. */
  fieldLabel: (field: LabelSource) => string;
  /** 옮긴 항목명 옆에 함께 보여 줄 인쇄 원문. 옮긴 말이 없으면 undefined. */
  fieldOriginal: (field: LabelSource) => string | undefined;
};

export function createI18n(locale: Locale, translations: Record<string, string> = {}): I18n {
  const translated = (field: LabelSource) => locale === "ko" ? undefined : translations[field.id];
  return {
    locale, t: MESSAGES[locale],
    fieldLabel: field => translated(field) || field.label,
    fieldOriginal: field => translated(field) && translated(field) !== field.label ? field.label : undefined,
  };
}

const I18nContext = createContext<I18n>(createI18n(DEFAULT_LOCALE));
export const I18nProvider = I18nContext.Provider;
export function useI18n(): I18n { return useContext(I18nContext); }

/** 서버·네트워크 오류를 고른 언어로 바꾼다. 한국어는 서버가 보낸 문구를 그대로 쓴다. */
export function localizedError(i18n: I18n, problem: unknown, fallback: string): string {
  const code = typeof (problem as { code?: unknown })?.code === "string" ? (problem as { code: string }).code : undefined;
  if (i18n.locale === "ko") return problem instanceof Error && problem.message ? problem.message : fallback;
  return (code && i18n.t.errorByCode[code]) || fallback;
}

const STORAGE_KEY = "assist-locale";
const listeners = new Set<() => void>();
let chosen: Locale | undefined;

function currentLocale(): Locale {
  if (chosen) return chosen;
  try { return parseLocale(localStorage.getItem(STORAGE_KEY)); } catch { return DEFAULT_LOCALE; }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

/** 고른 언어를 브라우저에 기억해 다음에 열어도 같은 언어로 시작한다. */
export function useStoredLocale(): [Locale, (locale: Locale) => void] {
  const locale = useSyncExternalStore(subscribe, currentLocale, () => DEFAULT_LOCALE);
  const change = (next: Locale) => {
    chosen = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 저장이 막혀 있어도 이번 화면에서는 바뀐다. */ }
    listeners.forEach(listener => listener());
  };
  return [locale, change];
}

export { LOCALES, LOCALE_INFO };
export type { Locale };
