"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import type { DocumentField, DocumentSource, SearchResult } from "@/lib/documents/types";
import { useI18n } from "./i18n";

export function AssistantDialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="assist-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header><h2 id={titleId} tabIndex={-1}>{title}</h2><button className="assist-icon-button" onClick={onClose} aria-label={t.close}><X /></button></header>
    <div className="assist-dialog-body">{children}</div>
    {footer && <footer>{footer}</footer>}
  </dialog>;
}

function PageControls({ page, count, setPage }: { page: number; count: number; setPage: (page: number) => void }) {
  const { t } = useI18n();
  return <div className="assist-dialog-pages"><button className="assist-button assist-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft />{t.listPrevious}</button><span aria-live="polite">{page + 1} / {count}</span><button className="assist-button assist-primary" disabled={page === count - 1} onClick={() => setPage(page + 1)}>{t.listNext}<ChevronRight /></button></div>;
}

export function FieldDialog({ fields, selectedId, onSelect, onClose }: { fields: DocumentField[]; selectedId?: string; onSelect: (field: DocumentField) => void; onClose: () => void }) {
  const selectedIndex = fields.findIndex((field) => field.id === selectedId);
  const [page, setPage] = useState(Math.max(0, Math.floor(selectedIndex / 3)));
  const count = Math.max(1, Math.ceil(fields.length / 3));
  const { t, fieldLabel, fieldOriginal } = useI18n();
  return <AssistantDialog title={t.fieldsTitle} onClose={onClose} footer={<PageControls page={page} count={count} setPage={setPage} />}>
    <p className="assist-small">{t.fieldsHint}</p>
    <div className="assist-field-list">{fields.slice(page * 3, page * 3 + 3).map((field, index) => <button key={field.id} onClick={() => onSelect(field)} aria-current={selectedId === field.id ? "true" : undefined}><span className="assist-field-number">{page * 3 + index + 1}</span><span>{fieldLabel(field)}{fieldOriginal(field) && <small className="assist-field-original" lang="ko">{fieldOriginal(field)}</small>}</span><ChevronRight /></button>)}</div>
  </AssistantDialog>;
}

export function SourceDialog({ search, sources, mappingPending = false, onClose }: { search: SearchResult; sources?: DocumentSource[]; mappingPending?: boolean; onClose: () => void }) {
  const items = sources ?? search.sources;
  const [page, setPage] = useState(0);
  const source = items[page];
  const { t } = useI18n();
  return <AssistantDialog title={t.sourcesTitle} onClose={onClose} footer={<div className="assist-source-footer">{source ? <a className="assist-button assist-primary assist-full" href={source.url} target="_blank" rel="noopener noreferrer">{t.sourcesOpen}<ExternalLink /></a> : <button className="assist-button assist-primary assist-full" onClick={onClose}>{t.ok}</button>}{items.length > 1 && <PageControls page={page} count={items.length} setPage={setPage} />}</div>}>
    {source ? <div className="assist-source-card"><span className="assist-badge">{source.kind === "guide" ? t.sourceGuide : source.kind === "form" && source.guidance.length ? t.sourceFormGuide : source.kind === "form" ? t.sourceForm : t.sourceOther}</span><div className="assist-source-title"><span className="assist-source-caption">{t.sourceNameCaption}</span><h3 lang="ko">{source.title}</h3></div><div className="assist-source-summary"><span className="assist-source-caption">{t.sourceSummaryCaption}</span><p>{source.evidence || t.sourceEvidenceFallback}</p></div><p className="assist-source-caption">{[t.sourceTruncated, t.koreanSourceNote].filter(Boolean).join(" ")}</p></div> : <div className="assist-source-empty"><p>{search.status === "pending" ? mappingPending ? t.sourcesEmptyMapping : t.sourcesEmptyPending : search.status === "unavailable" ? t.sourcesEmptyUnavailable : t.sourcesEmptyNone}</p><p className="assist-small">{t.sourcesAiNote}</p></div>}
  </AssistantDialog>;
}
