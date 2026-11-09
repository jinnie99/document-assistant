"use client";

import { useEffect, useId, useRef } from "react";
import { Move, ScanLine, X } from "lucide-react";
import type { DocumentField } from "@/lib/documents/types";
import type { AssistantPhoto } from "./types";
import { DocumentCanvas } from "./document-canvas";

type Props = { photo: AssistantPhoto; field?: DocumentField; fields?: DocumentField[]; onSelect?: (field: DocumentField) => void; onClose: () => void; onEditRegion?: () => void };

export function DocumentZoomDialog({ photo, field, fields, onSelect, onClose, onEditRegion }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className="assist-document-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><span>서류 크게 보기</span><h2 id={titleId}>{field?.label || "궁금한 칸을 골라보세요"}</h2></div><button type="button" className="assist-icon-button" onClick={onClose} aria-label="확대 화면 닫기"><X /></button></header>
    <p className="assist-canvas-instruction"><Move />확대하거나 손가락으로 옮겨 보세요.</p>
    <DocumentCanvas photo={photo} field={field} fields={fields} onSelectField={onSelect} />
    <footer>{onEditRegion && <button type="button" className="assist-button assist-secondary" onClick={onEditRegion}><ScanLine />영역 맞추기</button>}<button type="button" className="assist-button assist-primary" onClick={onClose}>안내로 돌아가기</button></footer>
  </dialog>;
}
