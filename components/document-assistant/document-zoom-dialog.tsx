"use client";

import { useEffect, useId, useRef } from "react";
import { Move, ScanLine, X } from "lucide-react";
import type { DocumentField } from "@/lib/documents/types";
import type { AssistantPhoto } from "./types";
import { DocumentCanvas } from "./document-canvas";
import { useI18n } from "./i18n";

type Props = { photo: AssistantPhoto; field?: DocumentField; fields?: DocumentField[]; onSelect?: (field: DocumentField) => void; onClose: () => void; onEditRegion?: () => void };

export function DocumentZoomDialog({ photo, field, fields, onSelect, onClose, onEditRegion }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t, fieldLabel } = useI18n();
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className="assist-document-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><span>{t.zoomEyebrow}</span><h2 id={titleId}>{field ? fieldLabel(field) : t.zoomPickTitle}</h2></div><button type="button" className="assist-icon-button" onClick={onClose} aria-label={t.zoomCloseAria}><X /></button></header>
    <p className="assist-canvas-instruction"><Move />{t.zoomInstruction}</p>
    <DocumentCanvas photo={photo} field={field} fields={fields} onSelectField={onSelect} />
    <footer>{onEditRegion && <button type="button" className="assist-button assist-secondary" onClick={onEditRegion}><ScanLine />{t.zoomFitRegion}</button>}<button type="button" className="assist-button assist-primary" onClick={onClose}>{t.zoomBack}</button></footer>
  </dialog>;
}
