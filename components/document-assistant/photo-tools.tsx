"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw, ShieldCheck, Undo2 } from "lucide-react";
import type { AssistantPhoto } from "./types";
import { useI18n } from "./i18n";

type Mask = { x: number; y: number; width: number; height: number };

async function imageFrom(photo: AssistantPhoto): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = photo.url;
  await image.decode();
  return image;
}

async function canvasPhoto(canvas: HTMLCanvasElement, photo: AssistantPhoto): Promise<AssistantPhoto> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("사진을 바꾸지 못했어요.")), "image/jpeg", 0.92));
  const api = document.createElement("canvas");
  const scale = Math.min(1, 2000 / Math.max(canvas.width, canvas.height));
  api.width = Math.max(1, Math.round(canvas.width * scale)); api.height = Math.max(1, Math.round(canvas.height * scale));
  api.getContext("2d")!.drawImage(canvas, 0, 0, api.width, api.height);
  return { ...photo, url: URL.createObjectURL(blob), dataUrl: api.toDataURL("image/jpeg", 0.86), width: canvas.width, height: canvas.height };
}

export function PhotoTools({ photo, onChange, onError, onBusyChange }: { photo: AssistantPhoto; onChange: (photo: AssistantPhoto) => void; onError: (message: string) => void; onBusyChange: (busy: boolean) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const photoArea = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(200);
  const [masking, setMasking] = useState(false);
  const [mask, setMask] = useState<Mask>();
  const [editing, setEditing] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<AssistantPhoto[]>([]);
  const { t } = useI18n();

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(1, Math.min(element.clientWidth / photo.width, element.clientHeight / photo.height) * photo.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [photo.width, photo.height]);

  const edit = async (rotate: boolean, rectangle?: Mask) => {
    if (editing) return;
    setEditing(true); onBusyChange(true);
    try {
      const image = await imageFrom(photo), canvas = document.createElement("canvas");
      canvas.width = rotate ? photo.height : photo.width; canvas.height = rotate ? photo.width : photo.height;
      const context = canvas.getContext("2d")!;
      if (rotate) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
      context.drawImage(image, 0, 0);
      if (rectangle) { context.fillStyle = "#172033"; context.fillRect(rectangle.x * photo.width, rectangle.y * photo.height, rectangle.width * photo.width, rectangle.height * photo.height); }
      const next = await canvasPhoto(canvas, photo);
      history.current.push(photo);
      if (history.current.length > 10) { const expired = history.current.shift(); if (expired) URL.revokeObjectURL(expired.url); }
      setUndoCount(history.current.length);
      onChange(next); setMask(undefined); anchor.current = null;
    } catch { onError(t.photoChangeFailed); }
    finally { setEditing(false); onBusyChange(false); }
  };
  const point = (event: React.PointerEvent) => {
    const box = photoArea.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  };
  const keyMask = (event: React.KeyboardEvent) => {
    if (!masking) return;
    const current = mask ?? { x: .3, y: .3, width: .3, height: .08 };
    const change = .02;
    if (event.key === "Enter") { event.preventDefault(); void edit(false, current); return; }
    if (event.key === "Escape") { setMasking(false); setMask(undefined); return; }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = { ...current };
    if (event.shiftKey) {
      next.width = Math.max(.02, Math.min(1 - next.x, next.width + (event.key === "ArrowRight" ? change : event.key === "ArrowLeft" ? -change : 0)));
      next.height = Math.max(.02, Math.min(1 - next.y, next.height + (event.key === "ArrowDown" ? change : event.key === "ArrowUp" ? -change : 0)));
    } else {
      next.x = Math.max(0, Math.min(1 - next.width, next.x + (event.key === "ArrowRight" ? change : event.key === "ArrowLeft" ? -change : 0)));
      next.y = Math.max(0, Math.min(1 - next.height, next.y + (event.key === "ArrowDown" ? change : event.key === "ArrowUp" ? -change : 0)));
    }
    setMask(next);
  };

  return <div className="assist-photo-editor">
    <div ref={frame} className="assist-photo-stage"><div ref={photoArea} className={`assist-photo-area${masking ? " is-masking" : ""}`} style={{ width, aspectRatio: `${photo.width} / ${photo.height}` }} tabIndex={masking ? 0 : -1} role={masking ? "application" : undefined} aria-label={masking ? t.photoMaskAria : t.photoAlt} onKeyDown={keyMask} onPointerDown={(event) => { if (!masking || editing) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); anchor.current = point(event); setMask({ ...anchor.current, width: 0, height: 0 }); }} onPointerMove={(event) => { if (!anchor.current) return; const end = point(event); setMask({ x: Math.min(anchor.current.x, end.x), y: Math.min(anchor.current.y, end.y), width: Math.abs(anchor.current.x - end.x), height: Math.abs(anchor.current.y - end.y) }); }} onPointerUp={(event) => { if (!anchor.current) return; const end = point(event), start = anchor.current; anchor.current = null; const rectangle = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) }; if (rectangle.width > .005 && rectangle.height > .005) void edit(false, rectangle); else setMask(undefined); }} onPointerCancel={() => { anchor.current = null; setMask(undefined); }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저의 일시 사진 URL을 표시한다. */}
      <img src={photo.url} alt={t.photoAlt} draggable={false} />
      {mask && <svg className="assist-mask-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x={mask.x * 100} y={mask.y * 100} width={mask.width * 100} height={mask.height * 100} /></svg>}
    </div></div>
    <div className="assist-photo-toolbar"><button disabled={editing} onClick={() => void edit(true)}><RotateCw />{t.photoRotate}</button><button disabled={editing} aria-pressed={masking} onClick={() => { setMasking(!masking); setMask(undefined); }}><ShieldCheck />{t.photoMask}</button><button disabled={editing || !undoCount} onClick={() => { const previous = history.current.pop(); if (previous) onChange(previous); setUndoCount(history.current.length); setMask(undefined); }}><Undo2 />{t.photoUndo}</button></div>
    {masking && <p className="assist-mask-instruction">{t.photoMaskInstruction}<span className="assist-visually-hidden">{t.photoMaskKeyboard}</span></p>}
  </div>;
}
