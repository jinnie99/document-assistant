"use client";

import { LOCALE_INFO, LOCALES, useI18n, type Locale } from "./i18n";

function star(cx: number, cy: number, radius: number, rotation = 0): string {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = (index * 36 - 90 + rotation) * Math.PI / 180, r = index % 2 ? radius * .382 : radius;
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

/** 글꼴에 국기 그림 문자가 없는 기기(Windows 등)에서도 보이도록 국기를 직접 그린다. */
const FLAGS: Record<Locale, React.ReactNode> = {
  ko: <>
    <rect width="30" height="20" fill="#fff" />
    <g transform="rotate(33.7 15 10)">
      <circle cx="15" cy="10" r="5" fill="#cd2e3a" />
      <path d="M10 10a5 5 0 0 0 10 0 2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 1-5 0z" fill="#0047a0" />
    </g>
    {[33.7, 146.3, 213.7, 326.3].map(angle => <g key={angle} transform={`translate(15 10) rotate(${angle})`} fill="#111">
      <rect x="7.4" y="-2.1" width=".75" height="4.2" /><rect x="8.55" y="-2.1" width=".75" height="4.2" /><rect x="9.7" y="-2.1" width=".75" height="4.2" />
    </g>)}
  </>,
  en: <>
    <rect width="30" height="20" fill="#fff" />
    {[0, 2, 4, 6].map(row => <rect key={row} y={row * 20 / 7} width="30" height={20 / 7} fill="#b22234" />)}
    <rect width="13" height={80 / 7} fill="#3c3b6e" />
    {[2.6, 5.7, 8.8].flatMap(y => [2.2, 5.1, 8, 10.9].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r=".75" fill="#fff" />))}
  </>,
  zh: <>
    <rect width="30" height="20" fill="#de2910" />
    <polygon points={star(5, 5, 3)} fill="#ffde00" />
    {[[10, 2, 23], [12, 4, 46], [12, 7, 70], [10, 9, 21]].map(([x, y, turn]) => <polygon key={`${x}-${y}`} points={star(x, y, 1, turn)} fill="#ffde00" />)}
  </>,
  vi: <><rect width="30" height="20" fill="#da251d" /><polygon points={star(15, 10.4, 6)} fill="#ffff00" /></>,
  ja: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="6" fill="#bc002d" /></>,
  th: <>
    <rect width="30" height="20" fill="#a51931" />
    <rect y={20 / 6} width="30" height={80 / 6} fill="#f4f5f8" />
    <rect y={40 / 6} width="30" height={40 / 6} fill="#2d2a4a" />
  </>,
};

export function LanguagePicker({ onChange, disabled = false }: { onChange: (locale: Locale) => void; disabled?: boolean }) {
  const { locale, t } = useI18n();
  return <div className="assist-languages" role="radiogroup" aria-label={t.languageAria}>
    {LOCALES.map(code => <button key={code} type="button" role="radio" aria-checked={locale === code} lang={LOCALE_INFO[code].lang} disabled={disabled} onClick={() => onChange(code)}>
      <svg viewBox="0 0 30 20" aria-hidden="true">{FLAGS[code]}</svg>
      <span>{LOCALE_INFO[code].name}</span>
    </button>)}
  </div>;
}
