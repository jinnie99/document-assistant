"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, LoaderCircle, X } from "lucide-react";
import type { DocumentField, FieldGuidance, GuideAnswers, Provenance } from "@/lib/documents/types";
import { nextGuideDestination } from "@/lib/documents/guide-navigation";
import type { GuidePage } from "./types";
import { QuestionChoices } from "./question-choices";
import { useI18n } from "./i18n";


type Props = {
  field: DocumentField;
  guidance?: FieldGuidance;
  loading: boolean;
  error?: string;
  expired?: boolean;
  large: boolean;
  hasPrevious: boolean;
  isLast: boolean;
  moreFieldsPending?: boolean;
  onClose: () => void;
  onAnswer: (answers: GuideAnswers) => void;
  onRetry: () => void;
  onPreviousField: () => void;
  onNextField: () => void;
  onSources: () => void;
};

export function GuideCard({ field, guidance, loading, error, expired, large, hasPrevious, isLast, moreFieldsPending = false, onClose, onAnswer, onRetry, onPreviousField, onNextField, onSources }: Props) {
  const [pages, setPages] = useState<GuidePage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const pageIndexRef = useRef(0);
  const pagesRef = useRef<GuidePage[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLParagraphElement>(null);
  const textFocus = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = guidance?.question;
  const { t, fieldLabel, fieldOriginal } = useI18n();
  const provenanceLabels: Record<Provenance, string> = { official_guide: t.provenanceOfficial, form_context: t.provenanceForm, photo_inference: t.provenancePhoto };
  const guideSections = [
    { kind: "explanation", label: t.sectionExplanation },
    { kind: "example", label: t.sectionExample },
    { kind: "check", label: t.sectionCheck },
  ] as const;
  const original = fieldOriginal(field);

  useEffect(() => { if (!loading) heading.current?.focus({ preventScroll: true }); }, [loading]);

  const rebuildPages = useCallback(() => {
    const container = area.current, probe = measure.current;
    if (!container || !probe || !guidance || question) return;
    const style = getComputedStyle(container);
    const width = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (width < 1 || height < 1) return;
    probe.style.width = `${width}px`;
    const units = [
      { kind: "explanation" as const, label: t.pageExplanation, text: guidance.explanation },
      { kind: "example" as const, label: t.pageExample, text: guidance.example },
      { kind: "check" as const, label: t.pageCheck, text: guidance.check },
    ].filter((unit) => unit.text.trim());
    const nextPages: GuidePage[] = [];
    for (const unit of units) {
      const characters = Array.from(unit.text);
      let start = 0;
      while (start < characters.length) {
        let low = 1, high = characters.length - start, fits = 1;
        while (low <= high) {
          const length = Math.floor((low + high) / 2);
          probe.textContent = characters.slice(start, start + length).join("");
          if (probe.getBoundingClientRect().height <= height) { fits = length; low = length + 1; }
          else high = length - 1;
        }
        let end = start + fits;
        if (end < characters.length) {
          const candidate = characters.slice(start, end).join("");
          const sentences = [...candidate.matchAll(/[.!?](?=\s)/gu)];
          const sentenceEnd = sentences.length ? sentences[sentences.length - 1].index! + 1 : 0;
          const boundary = candidate.search(/\s+\S*$/u);
          if (sentenceEnd > fits / 3) end = start + sentenceEnd;
          else if (boundary > fits / 2) end = start + boundary;
        }
        nextPages.push({ ...unit, text: characters.slice(start, end).join("").trim(), start, end });
        start = end;
        while (start < characters.length && /\s/u.test(characters[start])) start++;
      }
    }
    probe.textContent = "";
    const anchor = pagesRef.current[pageIndexRef.current];
    const anchoredIndex = anchor ? nextPages.findIndex((page) => page.kind === anchor.kind && anchor.start >= page.start && anchor.start < page.end) : 0;
    const nextIndex = Math.max(0, anchoredIndex >= 0 ? anchoredIndex : Math.min(pageIndexRef.current, nextPages.length - 1));
    pagesRef.current = nextPages;
    pageIndexRef.current = nextIndex;
    setPages(nextPages);
    setPageIndex(nextIndex);
  }, [guidance, question, t]);

  useLayoutEffect(() => {
    const container = area.current;
    if (!container) return;
    const observer = new ResizeObserver(rebuildPages);
    observer.observe(container);
    const frame = requestAnimationFrame(rebuildPages);
    let active = true;
    document.fonts?.ready.then(() => { if (active) rebuildPages(); });
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [rebuildPages, large]);

  const current = pages[pageIndex] ?? { kind: "explanation", label: t.pageExplanation, text: guidance?.explanation ?? "" };
  const changePage = (index: number) => {
    pageIndexRef.current = index;
    setPageIndex(index);
    requestAnimationFrame(() => textFocus.current?.focus({ preventScroll: true }));
  };
  const nextPage = pages[pageIndex + 1];
  const sectionPages = pages.filter((page) => page.kind === current.kind);
  const sectionPageIndex = sectionPages.indexOf(pages[pageIndex]) + 1;
  const nextDestination = nextGuideDestination(!!nextPage, isLast, moreFieldsPending);
  const nextLabel = nextPage ? nextPage.kind === "example" ? t.cardNextExample : nextPage.kind === "check" ? t.cardNextCheck : t.cardNextPage : nextDestination === "waiting" ? t.cardWaitingFields : nextDestination === "complete" ? t.guideFinish : t.cardNextField;

  return <section className={`assist-guide-card${question ? " is-question" : ""}`} aria-labelledby="assist-field-title">
    <header className="assist-guide-heading"><div><span className="assist-small">{t.cardSelected}{original && <span lang="ko"> · {original}</span>}</span><h2 ref={heading} id="assist-field-title" tabIndex={-1}>{fieldLabel(field)}</h2></div><button className="assist-icon-button" onClick={onClose} aria-label={t.cardPickOtherAria}><X /></button></header>
    {guidance && !loading && <div className="assist-provenance"><span>{provenanceLabels[guidance.provenance]}</span><button onClick={onSources}><BookOpen />{t.cardSources}</button></div>}
    {guidance && !question && !loading && !error && <div className="assist-guide-switches" role="group" aria-label={t.cardSwitchAria}>{guideSections.map(({ kind, label }) => {
      const index = pages.findIndex((page) => page.kind === kind);
      return <button key={kind} type="button" aria-pressed={current.kind === kind} disabled={index < 0} title={index < 0 ? t.cardNotProvided(label) : undefined} onClick={() => { if (index >= 0) changePage(index); }}>{label}</button>;
    })}</div>}
    <div className="assist-guide-body">
      {loading ? <div className="assist-guide-wait" role="status"><LoaderCircle className="assist-spin" /><p>{t.cardWait}</p></div> : error ? <div className="assist-guide-error" role="alert"><p>{error}</p><button className="assist-button assist-primary" onClick={onRetry}>{expired ? t.cardRetryExpired : t.cardRetry}</button></div> : question ? <QuestionChoices key={`${question.id}-${question.text}`} question={question} large={large} onAnswer={onAnswer} /> : <div className="assist-paged-guide"><p className="assist-guide-page-label" aria-live="polite">{current.label} <span>{sectionPages.length > 1 ? `${sectionPageIndex} / ${sectionPages.length}` : ""}</span></p><div ref={area} className={`assist-guide-copy-area is-${current.kind}`}><p ref={textFocus} tabIndex={-1} className="assist-guide-copy">{current.text}</p><p ref={measure} className="assist-guide-copy assist-copy-measure" aria-hidden="true" /></div></div>}
    </div>
    {!question && !loading && !error && <nav className="assist-guide-navigation" aria-label={t.cardNavAria}><button className="assist-button assist-secondary" disabled={pageIndex === 0 && !hasPrevious} onClick={() => pageIndex > 0 ? changePage(pageIndex - 1) : onPreviousField()}><ArrowLeft />{pageIndex > 0 ? t.cardPreviousPage : t.cardPreviousField}</button><button className="assist-button assist-primary" disabled={nextDestination === "waiting"} onClick={() => nextPage ? changePage(pageIndex + 1) : onNextField()}>{nextLabel}<ArrowRight /></button></nav>}
  </section>;
}
