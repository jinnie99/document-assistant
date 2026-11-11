"use client";

import type { Ref } from "react";
import Image from "next/image";
import { ArrowRight, Camera, Download, ShieldCheck, Upload } from "lucide-react";
import { SAMPLE_DOCUMENT_NAME, SAMPLE_DOCUMENT_URL } from "./sample-document";
import { LanguagePicker } from "./language-picker";
import { useI18n, type Locale } from "./i18n";

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  preparing: boolean;
  configured: boolean | null;
  onCamera: () => void;
  onGallery: () => void;
  onSample: () => void;
  onLocale: (locale: Locale) => void;
};

export function HomeScreen({ headingRef, preparing, configured, onCamera, onGallery, onSample, onLocale }: Props) {
  const { t } = useI18n();
  return <section className="assist-home">
    <LanguagePicker onChange={onLocale} disabled={preparing} />
    <div className="assist-home-copy">
      <p className="assist-home-eyebrow">{t.homeEyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1}>{t.homeTitle[0]}<br /><span>{t.homeTitle[1]}</span></h1>
      <p className="assist-home-description">{t.homeDescription[0]}<br />{t.homeDescription[1]}</p>
    </div>
    <div className="assist-home-art" aria-hidden="true">
      <Image className="assist-home-illustration" src="/images/home-guide-warm.webp" alt="" fill sizes="(max-width: 480px) 100vw, 390px" loading="eager" fetchPriority="high" />
    </div>
    <div className="assist-home-buttons">
      <button className="assist-button assist-primary" disabled={preparing} onClick={onCamera}><Camera />{t.homeCamera}</button>
      <button className="assist-button assist-secondary" disabled={preparing} onClick={onGallery}><Upload />{t.homeGallery}</button>
      <div className="assist-home-links">
        <button className="assist-text-button" disabled={preparing} onClick={onSample}>{preparing ? t.homePreparing : t.homeSample}<ArrowRight /></button>
        <a className="assist-text-button" href={SAMPLE_DOCUMENT_URL} download={SAMPLE_DOCUMENT_NAME}><Download />{t.homeDownload}</a>
      </div>
    </div>
    <p className="assist-reassurance"><ShieldCheck />{t.homeReassurance}</p>
    {configured === false && <p className="assist-service-note">{t.homeServiceNote}</p>}
  </section>;
}
