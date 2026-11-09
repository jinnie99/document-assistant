"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Hand, LoaderCircle, ScanLine, X } from "lucide-react";
import type { Box, DocumentField } from "@/lib/documents/types";
import type { AssistantPhoto } from "./types";
import { DocumentCanvas } from "./document-canvas";

type Props = { photo: AssistantPhoto; field?: DocumentField; loading: boolean; error?: string; onClose: () => void; onSave: (selection: { box: Box; image?: string }) => void };

async function cropPhoto(photo: AssistantPhoto, box: Box): Promise<string> {
  const image = new Image(); image.src = photo.url; await image.decode();
  const scale = Math.min(1, 1600 / Math.max(box.width * photo.width, box.height * photo.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * photo.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * photo.height * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, box.x * photo.width, box.y * photo.height, box.width * photo.width, box.height * photo.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .9);
}

export function RegionEditorDialog({ photo, field, loading, error, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selection, setSelection] = useState<Box | undefined>(field?.box);
  const [mode, setMode] = useState<"pan" | "select">("select");
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const pending = useRef(false);
  const busy = loading || preparing;
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  const valid = Boolean(selection && selection.width >= .005 && selection.height >= .005);
  const save = async () => {
    if (busy || pending.current) return;
    if (!valid || !selection) { setLocalError("항목 이름과 적을 칸이 함께 보이게 둘러 주세요."); return; }
    pending.current = true; setPreparing(true); setLocalError(undefined);
    try { onSave({ box: selection, ...(field ? {} : { image: await cropPhoto(photo, selection) }) }); }
    catch { setLocalError("선택한 사진을 준비하지 못했어요. 다시 골라 주세요."); }
    finally { pending.current = false; setPreparing(false); }
  };
  return <dialog ref={ref} className="assist-document-dialog assist-region-editor" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span>{field ? field.label : "빠진 칸 추가"}</span><h2 id={titleId}>{field ? "파란 영역을 맞춰주세요" : "어느 칸이 빠졌나요?"}</h2></div><button type="button" className="assist-icon-button" disabled={busy} onClick={onClose} aria-label="영역 선택 닫기"><X /></button></header>
    <p className="assist-canvas-instruction">{field ? "맞는 위치를 손가락으로 둘러 주세요." : "항목 이름과 빈칸을 함께 둘러 주세요."}</p>
    <div className="assist-region-modes" role="group" aria-label="사진 조작 방법"><button type="button" disabled={busy} aria-pressed={mode === "select"} onClick={() => setMode("select")}><ScanLine />칸 선택</button><button type="button" disabled={busy} aria-pressed={mode === "pan"} onClick={() => setMode("pan")}><Hand />사진 이동</button></div>
    <DocumentCanvas photo={photo} field={field} selection={selection} mode={mode} disabled={busy} onSelection={box => { setSelection(box); setLocalError(undefined); }} onConfirm={() => void save()} />
    {(error || localError) && <p className="assist-region-error" role="alert">{error || localError}</p>}
    <footer><button type="button" className="assist-button assist-primary assist-full" disabled={busy || !valid} onClick={() => void save()}>{busy ? <><LoaderCircle className="assist-spin" />칸을 확인하고 있어요</> : field ? "이 영역으로 맞추기" : "이 칸 안내받기"}</button></footer>
  </dialog>;
}
