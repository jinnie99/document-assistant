/** 도우미가 안내하는 언어. 서식은 한국어여도 화면과 AI 안내는 고른 언어로 보여 준다. */
export const LOCALES = ["ko", "en", "zh", "vi", "ja", "th"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ko";

/** 언어 선택 버튼에 쓰는 이름(그 언어로 적은 이름)과 html lang 값. */
export const LOCALE_INFO: Record<Locale, { name: string; lang: string }> = {
  ko: { name: "한국어", lang: "ko" },
  en: { name: "English", lang: "en" },
  zh: { name: "中文", lang: "zh-Hans" },
  vi: { name: "Tiếng Việt", lang: "vi" },
  ja: { name: "日本語", lang: "ja" },
  th: { name: "ไทย", lang: "th" },
};

/** AI에게 출력 언어를 지시할 때 쓰는 이름. */
export const PROMPT_LANGUAGE: Record<Locale, string> = {
  ko: "한국어",
  en: "영어(English)",
  zh: "중국어 간체(简体中文)",
  vi: "베트남어(Tiếng Việt)",
  ja: "일본어(日本語)",
  th: "태국어(ภาษาไทย)",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** 모르는 값은 한국어로 본다. 요청 본문에서 받은 값을 그대로 넘겨도 된다. */
export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** 한국어가 아닌 언어는 같은 뜻을 적는 데 글자가 더 필요해 안내 길이 제한을 넓힌다. */
/** check는 다 쓴 뒤 점검할 항목을 2~3개 담아야 해서 설명·예시보다 조금 길게 둔다. */
export type GuideLimits = { text: number; check: number; question: number; choice: number };
export const KOREAN_GUIDE_LIMITS: GuideLimits = { text: 80, check: 120, question: 50, choice: 20 };
export const TRANSLATED_GUIDE_LIMITS: GuideLimits = { text: 280, check: 360, question: 160, choice: 70 };
export function guideLimits(locale: Locale): GuideLimits {
  return locale === "ko" ? KOREAN_GUIDE_LIMITS : TRANSLATED_GUIDE_LIMITS;
}
