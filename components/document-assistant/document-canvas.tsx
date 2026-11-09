"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { Box, DocumentField } from "@/lib/documents/types";
import { fieldCrop, fitViewport, panViewport, pixelBox, pointInPhoto, selectionBox, zoomViewport } from "@/lib/documents/view-geometry";
import type { AssistantPhoto } from "./types";

type Props = {
  photo: AssistantPhoto;
  field?: DocumentField;
  fields?: DocumentField[];
  selection?: Box;
  mode?: "pan" | "select";
  disabled?: boolean;
  onSelection?: (box: Box) => void;
  onSelectField?: (field: DocumentField) => void;
  onConfirm?: () => void;
};

export function DocumentCanvas({ photo, field, fields = [], selection, mode = "pan", disabled = false, onSelection, onSelectField, onConfirm }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const initial = field ? pixelBox(fieldCrop(field.box), photo) : { x: 0, y: 0, width: photo.width, height: photo.height };
  const [view, setView] = useState<Box>(initial);
  const currentView = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const pinchDistance = useRef<number | null>(null);
  const moved = useRef(false);
  const firstPointer = useRef<{ x: number; y: number } | null>(null);
  const multiTouch = useRef(false);
  const aspect = useRef(photo.width / photo.height);
  const updateView = (next: Box) => { currentView.current = next; setView(next); };
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || !element.clientHeight) return;
      aspect.current = element.clientWidth / element.clientHeight;
      const next = fitViewport(currentView.current, aspect.current, photo);
      currentView.current = next; setView(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [photo]);
  const locate = (x: number, y: number) => pointInPhoto({ x, y }, svg.current!.getBoundingClientRect(), currentView.current);
  const changeZoom = (factor: number) => updateView(zoomViewport(currentView.current, factor, photo));
  const reset = () => updateView(fitViewport({ x: 0, y: 0, width: photo.width, height: photo.height }, aspect.current, photo));
  const down = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      moved.current = false; multiTouch.current = false;
      firstPointer.current = { x: event.clientX, y: event.clientY };
      if (mode === "select") drawStart.current = locate(event.clientX, event.clientY);
    }
    if (pointers.current.size === 2) {
      multiTouch.current = true;
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
      drawStart.current = null;
    }
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || !pointers.current.has(event.pointerId)) return;
    const previous = pointers.current.get(event.pointerId)!;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (firstPointer.current && Math.hypot(event.clientX - firstPointer.current.x, event.clientY - firstPointer.current.y) > 5) moved.current = true;
    if (pointers.current.size > 1) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current && distance > 0) updateView(zoomViewport(currentView.current, distance / pinchDistance.current, photo, locate((a.x + b.x) / 2, (a.y + b.y) / 2)));
      pinchDistance.current = distance;
    } else if (mode === "select" && drawStart.current) {
      onSelection?.(selectionBox(drawStart.current, locate(event.clientX, event.clientY), photo));
    } else if (mode === "pan") {
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(rect.width / currentView.current.width, rect.height / currentView.current.height);
      updateView(panViewport(currentView.current, (previous.x - event.clientX) / scale, (previous.y - event.clientY) / scale, photo));
    }
  };
  const up = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!disabled && !multiTouch.current) {
      const end = locate(event.clientX, event.clientY);
      if (mode === "select" && drawStart.current) onSelection?.(selectionBox(drawStart.current, end, photo));
      else if (mode === "pan" && !moved.current && onSelectField) {
        const hit = fields.filter(item => end.x >= item.box.x * photo.width && end.x <= (item.box.x + item.box.width) * photo.width && end.y >= item.box.y * photo.height && end.y <= (item.box.y + item.box.height) * photo.height).sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
        if (hit) onSelectField(hit);
      }
    }
    pointers.current.delete(event.pointerId);
    drawStart.current = null;
    pinchDistance.current = null;
    if (!pointers.current.size) { multiTouch.current = false; firstPointer.current = null; }
  };
  const cancelPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId); drawStart.current = null; pinchDistance.current = null;
    if (!pointers.current.size) { multiTouch.current = false; firstPointer.current = null; }
  };
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(1.5); return; }
    if (event.key === "-") { event.preventDefault(); changeZoom(1 / 1.5); return; }
    if (mode === "select" && event.key === "Enter") { event.preventDefault(); onConfirm?.(); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === "ArrowRight" ? .01 : event.key === "ArrowLeft" ? -.01 : 0;
    const dy = event.key === "ArrowDown" ? .01 : event.key === "ArrowUp" ? -.01 : 0;
    if (mode === "select") {
      const box = selection ?? { x: Math.max(0, Math.min(.8, (view.x + view.width / 2) / photo.width - .1)), y: Math.max(0, Math.min(.95, (view.y + view.height / 2) / photo.height - .025)), width: .2, height: .05 };
      onSelection?.(event.shiftKey
        ? { ...box, width: Math.max(.005, Math.min(1 - box.x, box.width + dx)), height: Math.max(.005, Math.min(1 - box.y, box.height + dy)) }
        : { ...box, x: Math.max(0, Math.min(1 - box.width, box.x + dx)), y: Math.max(0, Math.min(1 - box.height, box.y + dy)) });
    } else updateView(panViewport(view, dx * view.width * 10, dy * view.height * 10, photo));
  };
  const selected = selection ?? field?.box;
  return <div className="assist-canvas-wrap">
    <div ref={stage} className={`assist-document-canvas is-${mode}`} tabIndex={0} role="group" aria-label={mode === "select" ? "서류 영역 선택. 화살표로 이동, Shift와 화살표로 크기 조절, Enter로 확인" : "확대한 서류 사진. 화살표로 이동, 더하기와 빼기로 확대와 축소"} onKeyDown={keyDown}>
      <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelPointer}>
        <image href={photo.url} width={photo.width} height={photo.height} />
        {fields.map(item => <g key={item.id} role={onSelectField && mode === "pan" ? "button" : undefined} tabIndex={onSelectField && mode === "pan" ? 0 : undefined} aria-label={`${item.label} 칸 안내 보기`} onKeyDown={event => { if (!disabled && mode === "pan" && onSelectField && ["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelectField(item); } }}><rect className="assist-field-hit" {...pixelBox(item.box, photo)} rx={3} vectorEffect="non-scaling-stroke" /></g>)}
        {selected && <rect className={mode === "select" ? "assist-region-selection" : "assist-field-selected"} {...pixelBox(selected, photo)} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
    <div className="assist-zoom-controls" aria-label="사진 확대 조절">
      <button type="button" disabled={disabled} onClick={() => changeZoom(1 / 1.5)} aria-label="사진 축소"><Minus />축소</button>
      <span aria-live="polite">{Math.round(photo.width / view.width * 100)}%</span>
      <button type="button" disabled={disabled} onClick={() => changeZoom(1.5)} aria-label="사진 확대"><Plus />확대</button>
      <button type="button" disabled={disabled} onClick={reset}><RotateCcw />전체</button>
    </div>
  </div>;
}
