"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { boxToImage, type Pt } from "@/lib/homography";
import type { FormDef } from "@/lib/forms";

type Props = {
  form: FormDef;
  src: string;
  size: { w: number; h: number };
  /** 템플릿 4모서리가 이미지 위에서 놓인 위치(0~1). 기본은 이미지 전체 */
  quad: Pt[];
  fieldId?: string;
  onSelect?: (id: string) => void;
  /** 정렬 모드: 모서리 핸들 표시 */
  onQuadChange?: (q: Pt[]) => void;
};

const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(" ");

/** 이미지 위에 등록된 칸(원근 변환 적용)을 겹쳐 보여 준다. 칸을 누르면 선택, 정렬 모드에서는 모서리를 끌 수 있다. */
export function FormOverlay({ form, src, size, quad, fieldId, onSelect, onQuadChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const aligning = !!onQuadChange;

  const drag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = box.current!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      onQuadChange!(quad.map((p, k) => (k === i ? ([x, y] as Pt) : p)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={box} className="relative w-full select-none overflow-hidden rounded-xl border border-[#1F2933]/15 bg-white shadow-sm" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${form.name} 서식`} draggable={false} className="absolute inset-0 size-full object-fill" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {aligning && <polygon points={pts(quad)} fill="none" stroke="#B3392F" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {form.fields.map((f) => {
          const on = fieldId === f.id;
          const poly = boxToImage(f.box, form.template, quad);
          return (
            <polygon
              key={f.id}
              points={pts(poly)}
              role="button"
              tabIndex={aligning ? -1 : 0}
              aria-label={`${f.label} 칸 선택`}
              onClick={() => onSelect?.(f.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.(f.id)}
              vectorEffect="non-scaling-stroke"
              strokeWidth={on ? 3 : 1.5}
              strokeDasharray={on ? undefined : "4 3"}
              className={cn("transition-colors", aligning ? "pointer-events-none" : "cursor-pointer", on ? "fill-[#285A88]/30 stroke-[#1F4A73]" : "fill-[#285A88]/10 stroke-[#285A88]/70 hover:fill-[#285A88]/25")}
            />
          );
        })}
      </svg>
      {!aligning &&
        form.fields.map((f) => {
          if (fieldId !== f.id) return null;
          const [x, y] = boxToImage(f.box, form.template, quad)[0];
          return (
            <span key={f.id} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} className="pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded bg-[#1F4A73] px-1.5 py-0.5 text-[0.9rem] font-semibold text-white">
              {f.label}
            </span>
          );
        })}
      {aligning &&
        quad.map(([x, y], i) => (
          <div
            key={i}
            onPointerDown={drag(i)}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, touchAction: "none" }}
            className="absolute z-20 size-8 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-[#B3392F] shadow-lg active:cursor-grabbing"
            aria-label={`모서리 ${i + 1}`}
          />
        ))}
    </div>
  );
}
