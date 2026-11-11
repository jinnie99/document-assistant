"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Hand, LoaderCircle, ScanLine, X } from "lucide-react";
import type { Box, DocumentField } from "@/lib/documents/types";
import type { AssistantPhoto } from "./types";
import { DocumentCanvas } from "./document-canvas";
import { useI18n } from "./i18n";

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
  const { t, fieldLabel } = useI18n();
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
    if (!valid || !selection) { setLocalError(t.regionNeedSelection); return; }
    pending.current = true; setPreparing(true); setLocalError(undefined);
    try { onSave({ box: selection, ...(field ? {} : { image: await cropPhoto(photo, selection) }) }); }
    catch { setLocalError(t.regionPrepareFailed); }
    finally { pending.current = false; setPreparing(false); }
  };
  return <dialog ref={ref} className="assist-document-dialog assist-region-editor" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span>{field ? fieldLabel(field) : t.regionAddEyebrow}</span><h2 id={titleId}>{field ? t.regionFitTitle : t.regionAddTitle}</h2></div><button type="button" className="assist-icon-button" disabled={busy} onClick={onClose} aria-label={t.regionCloseAria}><X /></button></header>
    <p className="assist-canvas-instruction">{field ? t.regionFitInstruction : t.regionAddInstruction}</p>
    <div className="assist-region-modes" role="group" aria-label={t.regionModesAria}><button type="button" disabled={busy} aria-pressed={mode === "select"} onClick={() => setMode("select")}><ScanLine />{t.regionModeSelect}</button><button type="button" disabled={busy} aria-pressed={mode === "pan"} onClick={() => setMode("pan")}><Hand />{t.regionModePan}</button></div>
    <DocumentCanvas photo={photo} field={field} selection={selection} mode={mode} disabled={busy} onSelection={box => { setSelection(box); setLocalError(undefined); }} onConfirm={() => void save()} />
    {(error || localError) && <p className="assist-region-error" role="alert">{error || localError}</p>}
    <footer><button type="button" className="assist-button assist-primary assist-full" disabled={busy || !valid} onClick={() => void save()}>{busy ? <><LoaderCircle className="assist-spin" />{t.regionChecking}</> : field ? t.regionFitButton : t.regionGuideButton}</button></footer>
  </dialog>;
}
