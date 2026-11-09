"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import type { DocumentField, DocumentSource, SearchResult } from "@/lib/documents/types";

export function AssistantDialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="assist-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header><h2 id={titleId} tabIndex={-1}>{title}</h2><button className="assist-icon-button" onClick={onClose} aria-label="닫기"><X /></button></header>
    <div className="assist-dialog-body">{children}</div>
    {footer && <footer>{footer}</footer>}
  </dialog>;
}

function PageControls({ page, count, setPage }: { page: number; count: number; setPage: (page: number) => void }) {
  return <div className="assist-dialog-pages"><button className="assist-button assist-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft />앞 목록</button><span aria-live="polite">{page + 1} / {count}</span><button className="assist-button assist-primary" disabled={page === count - 1} onClick={() => setPage(page + 1)}>다음 목록<ChevronRight /></button></div>;
}

export function FieldDialog({ fields, selectedId, onSelect, onClose }: { fields: DocumentField[]; selectedId?: string; onSelect: (field: DocumentField) => void; onClose: () => void }) {
  const selectedIndex = fields.findIndex((field) => field.id === selectedId);
  const [page, setPage] = useState(Math.max(0, Math.floor(selectedIndex / 3)));
  const count = Math.max(1, Math.ceil(fields.length / 3));
  return <AssistantDialog title="어느 칸이 궁금하세요?" onClose={onClose} footer={<PageControls page={page} count={count} setPage={setPage} />}>
    <p className="assist-small">사진에서 읽은 칸이에요.</p>
    <div className="assist-field-list">{fields.slice(page * 3, page * 3 + 3).map((field, index) => <button key={field.id} onClick={() => onSelect(field)} aria-current={selectedId === field.id ? "true" : undefined}><span className="assist-field-number">{page * 3 + index + 1}</span><span>{field.label}</span><ChevronRight /></button>)}</div>
  </AssistantDialog>;
}

export function SourceDialog({ search, sources, mappingPending = false, onClose }: { search: SearchResult; sources?: DocumentSource[]; mappingPending?: boolean; onClose: () => void }) {
  const items = sources ?? search.sources;
  const [page, setPage] = useState(0);
  const source = items[page];
  return <AssistantDialog title="안내의 근거" onClose={onClose} footer={<div className="assist-source-footer">{source ? <a className="assist-button assist-primary assist-full" href={source.url} target="_blank" rel="noopener noreferrer">원문 열기<ExternalLink /></a> : <button className="assist-button assist-primary assist-full" onClick={onClose}>알겠어요</button>}{items.length > 1 && <PageControls page={page} count={items.length} setPage={setPage} />}</div>}>
    {source ? <div className="assist-source-card"><span className="assist-badge">{source.kind === "guide" ? "작성 안내 자료" : source.kind === "form" && source.guidance.length ? "서류 안의 작성 안내" : source.kind === "form" ? "찾아본 서류" : "참고 자료"}</span><div className="assist-source-title"><span className="assist-source-caption">자료명</span><h3>{source.title}</h3></div><div className="assist-source-summary"><span className="assist-source-caption">판단 요약</span><p>{source.evidence || "이 자료와 사진을 함께 살펴봤어요."}</p></div><p className="assist-source-caption">긴 문구는 줄여 표시해요. 전체 내용은 원문에서 확인해 주세요.</p></div> : <div className="assist-source-empty"><p>{search.status === "pending" ? mappingPending ? "나머지 칸을 찾고 있어요. 먼저 찾은 칸은 사진을 읽은 내용으로 안내해요." : "작성 안내를 찾고 있어요. 지금은 사진에서 읽은 내용으로 먼저 설명해요." : search.status === "unavailable" ? "지금은 검색 연결이 원활하지 않아 사진을 읽은 내용으로 설명해요." : "이 칸의 공식 작성 안내를 확인하지 못해 사진을 읽은 내용으로 설명해요."}</p><p className="assist-small">AI가 설명한 내용이에요. 애매한 내용은 서류를 받는 곳에 확인해 주세요.</p></div>}
  </AssistantDialog>;
}
