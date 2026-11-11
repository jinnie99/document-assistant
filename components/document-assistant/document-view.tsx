"use client";

import { useId, useState } from "react";
import { Maximize2, Plus, ScanLine } from "lucide-react";
import type { DocumentField } from "@/lib/documents/types";
import { fieldCrop, pixelBox } from "@/lib/documents/view-geometry";
import type { AssistantPhoto } from "./types";
import { DocumentZoomDialog } from "./document-zoom-dialog";
import { useI18n } from "./i18n";

type ViewProps = { photo: AssistantPhoto; fields: DocumentField[]; onSelect: (field: DocumentField) => void; onAddField?: () => void };

export function DocumentView({ photo, fields, onSelect, onAddField }: ViewProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const { t, fieldLabel } = useI18n();
  return <div className="assist-document-view">
    {fields.length > 0 && <div className="assist-document-tools"><button type="button" onClick={() => setZoomOpen(true)}><Maximize2 />{t.viewZoom}</button>{onAddField && <button type="button" onClick={onAddField}><Plus />{t.viewAddField}</button>}</div>}
    <div className="assist-document-stage">
      <svg className="assist-document-svg" viewBox={`0 0 ${photo.width} ${photo.height}`} aria-label={t.viewDocumentAria}>
        <image href={photo.url} width={photo.width} height={photo.height} />
        {fields.map(field => <g key={field.id} role="button" tabIndex={0} aria-label={t.viewFieldAria(fieldLabel(field))} onClick={() => onSelect(field)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(field); } }}>
          <title>{fieldLabel(field)}</title><rect className="assist-field-hit" {...pixelBox(field.box, photo)} rx={4} vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>
    </div>
    {zoomOpen && <DocumentZoomDialog photo={photo} fields={fields} onClose={() => setZoomOpen(false)} onSelect={field => { setZoomOpen(false); onSelect(field); }} />}
  </div>;
}

export function FieldFocus({ photo, field, onEditRegion }: { photo: AssistantPhoto; field: DocumentField; onEditRegion?: () => void }) {
  const clipId = useId().replace(/:/g, "");
  const [zoomOpen, setZoomOpen] = useState(false);
  const crop = pixelBox(fieldCrop(field.box), photo);
  const { t, fieldLabel } = useI18n();
  return <>
    <div className="assist-field-focus">
      <div className="assist-field-focus-heading"><span>{t.focusHeading}</span><div><button type="button" onClick={() => setZoomOpen(true)}><Maximize2 />{t.viewZoom}</button>{onEditRegion && <button type="button" onClick={onEditRegion}><ScanLine />{t.focusEdit}</button>}</div></div>
      <svg viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t.focusAria(fieldLabel(field))}>
        <defs><clipPath id={clipId}><rect {...crop} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}><image href={photo.url} width={photo.width} height={photo.height} /><rect className="assist-field-selected" {...pixelBox(field.box, photo)} vectorEffect="non-scaling-stroke" /></g>
      </svg>
    </div>
    {zoomOpen && <DocumentZoomDialog photo={photo} field={field} onClose={() => setZoomOpen(false)} onEditRegion={onEditRegion ? () => { setZoomOpen(false); onEditRegion(); } : undefined} />}
  </>;
}