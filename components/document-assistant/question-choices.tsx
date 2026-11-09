"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { GuideAnswers, SituationQuestion } from "@/lib/documents/types";
import { questionLayout, type QuestionLayout } from "@/lib/documents/question-layout";

export function QuestionChoices({ question, large, onAnswer }: { question: SituationQuestion; large: boolean; onAnswer: (answers: GuideAnswers) => void }) {
  const [layout, setLayout] = useState<QuestionLayout>("choices");
  const [page, setPage] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const pager = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const rebuild = useCallback(() => {
    const container = area.current, probe = measure.current;
    if (!container || !probe || container.clientHeight < 1) return;
    probe.style.width = `${container.clientWidth}px`;
    const questionHeading = probe.querySelector("h3");
    const options = probe.querySelector<HTMLDivElement>(".assist-question-options");
    if (!questionHeading || !options) return;
    const next = questionLayout({
      height: container.clientHeight,
      questionHeight: questionHeading.getBoundingClientRect().height,
      choiceHeights: [...options.querySelectorAll("button")].map(button => button.getBoundingClientRect().height),
      choiceGap: parseFloat(getComputedStyle(options).rowGap) || 0,
      sectionGap: parseFloat(getComputedStyle(container).rowGap) || 0,
      pagerHeight: pager.current?.getBoundingClientRect().height ?? 44,
    });
    setLayout(previous => previous === next ? previous : next);
  }, []);

  useLayoutEffect(() => {
    const container = area.current;
    if (!container) return;
    const observer = new ResizeObserver(rebuild);
    observer.observe(container);
    const frame = requestAnimationFrame(rebuild);
    let active = true;
    document.fonts?.ready.then(() => { if (active) rebuild(); });
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [rebuild, large, question]);

  const separated = layout === "separate";
  const pageIndex = Math.min(page, question.choices.length - (separated ? 0 : 1));
  const questionPage = separated && pageIndex === 0;
  const choiceIndex = pageIndex - (separated ? 1 : 0);
  const choices = layout === "all" ? question.choices : questionPage ? [] : [question.choices[choiceIndex]];
  const lastPage = pageIndex === question.choices.length - (separated ? 0 : 1);
  const go = (next: number) => {
    setPage(next);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  };

  return <div ref={area} className="assist-question">
    <h3 ref={heading} tabIndex={-1}>{separated && !questionPage ? "맞는 답을 눌러 주세요." : question.text}</h3>
    {choices.length > 0 && <div className="assist-question-options">{choices.map(choice => <button key={choice.id} type="button" onClick={() => onAnswer({ [question.id]: choice.id })}>{choice.label}</button>)}</div>}
    {layout !== "all" && <nav ref={pager} className="assist-question-pages" aria-label="질문 선택지 넘겨 보기">
      <button type="button" disabled={pageIndex === 0} onClick={() => go(pageIndex - 1)} aria-label={separated && pageIndex === 1 ? "질문 다시 보기" : "이전 선택지 보기"}><ArrowLeft />{separated && pageIndex === 1 ? "질문 보기" : "이전"}</button>
      <span aria-live="polite">{questionPage ? "질문" : `${choiceIndex + 1} / ${question.choices.length}`}</span>
      <button type="button" disabled={lastPage} onClick={() => go(pageIndex + 1)} aria-label={questionPage ? "선택지 보기" : "다음 선택지 보기"}>{questionPage ? "선택지 보기" : "다음"}<ArrowRight /></button>
    </nav>}
    <div ref={measure} className="assist-question-measure" aria-hidden="true" inert><h3>{question.text}</h3><div className="assist-question-options">{question.choices.map(choice => <button key={choice.id} type="button" tabIndex={-1}>{choice.label}</button>)}</div></div>
  </div>;
}
