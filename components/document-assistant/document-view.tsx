"use client";

import { useId, useState } from "react";
import { Maximize2, Plus, ScanLine } from "lucide-react";
import type { DocumentField } from "@/lib/documents/types";
import { fieldCrop, pixelBox } from "@/lib/documents/view-geometry";
import type { AssistantPhoto } from "./types";
import { DocumentZoomDialog } from "./document-zoom-dialog";

type ViewProps = { photo: AssistantPhoto; fields: DocumentField[]; onSelect: (field: DocumentField) => void; onAddField?: () => void };

export function DocumentView({ photo, fields, onSelect, onAddField }: ViewProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  return <div className="assist-document-view">
    {fields.length > 0 && <div className="assist-document-tools"><button type="button" onClick={() => setZoomOpen(true)}><Maximize2 />크게 보기</button>{onAddField && <button type="button" onClick={onAddField}><Plus />빠진 칸 추가</button>}</div>}
    <div className="assist-document-stage">
      <svg className="assist-document-svg" viewBox={`0 0 ${photo.width} ${photo.height}`} aria-label="서류에서 궁금한 칸을 골라 주세요">
        <image href={photo.url} width={photo.width} height={photo.height} />
        {fields.map(field => <g key={field.id} role="button" tabIndex={0} aria-label={`${field.label} 칸 안내 보기`} onClick={() => onSelect(field)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(field); } }}>
          <title>{field.label}</title><rect className="assist-field-hit" {...pixelBox(field.box, photo)} rx={4} vectorEffect="non-scaling-stroke" />
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
  return <>
    <div className="assist-field-focus">
      <div className="assist-field-focus-heading"><span>종이에 적을 칸</span><div><button type="button" onClick={() => setZoomOpen(true)}><Maximize2 />크게 보기</button>{onEditRegion && <button type="button" onClick={onEditRegion}><ScanLine />위치 수정</button>}</div></div>
      <svg viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${field.label} 항목명과 작성할 칸 확대`}>
        <defs><clipPath id={clipId}><rect {...crop} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}><image href={photo.url} width={photo.width} height={photo.height} /><rect className="assist-field-selected" {...pixelBox(field.box, photo)} vectorEffect="non-scaling-stroke" /></g>
      </svg>
    </div>
    {zoomOpen && <DocumentZoomDialog photo={photo} field={field} onClose={() => setZoomOpen(false)} onEditRegion={onEditRegion ? () => { setZoomOpen(false); onEditRegion(); } : undefined} />}
  </>;
}