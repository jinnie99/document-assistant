"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, House, RotateCcw, TriangleAlert, Camera, Check, ClipboardCheck, FileText, MessageCircleQuestion, Pencil, Sparkles, User, Volume2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { forms, getForm, guideText, type Field, type FormDef } from "@/lib/forms";
import { FormOverlay } from "@/components/form-overlay";
import { normalizeImage } from "@/lib/image";
import { openPdf, type PdfHandle } from "@/lib/pdf";
import { FULL_QUAD, INSET_QUAD, type Pt } from "@/lib/homography";

type Upload = { url: string; name: string; source: "photo" | "pdf"; w: number; h: number; quad: Pt[]; warnings: string[]; page?: number; pages?: number };
type Ident = { text: string; tone: "ok" | "warn" };

const STEPS = ["양식 촬영", "상황 확인", "궁금한 칸 선택", "칸별 안내", "직접 작성·점검"];

export default function TryPage() {
  const [step, setStep] = useState(0);
  const [formId, setFormId] = useState<string>();
  const [photo, setPhoto] = useState<Upload>();
  const [answer, setAnswer] = useState<string>();
  const [fieldId, setFieldId] = useState<string>();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [ident, setIdent] = useState<Ident>();
  const pdf = useRef<PdfHandle>(undefined);

  // 소개 페이지의 "시범 양식" 링크(?form=)로 들어오면 해당 양식을 미리 선택한다.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("form");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 렌더에는 URL이 없어 마운트 후에 읽는다
    if (f && getForm(f)) setFormId(f);
  }, []);

  const form = formId ? getForm(formId) : undefined;
  const field = form?.fields.find((f) => f.id === fieldId);
  const guide = field && answer ? field.guides[answer] : undefined;

  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(undefined);
    setIdent(undefined);
    if (file.size > 15 * 1024 * 1024) return setError("파일이 너무 커요. 15MB 이하로 올려 주세요.");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf && !file.type.startsWith("image/")) return setError("이미지 또는 PDF 파일만 올릴 수 있어요.");
    try {
      setBusy(isPdf ? "PDF를 읽는 중…" : "사진을 분석하는 중…");
      pdf.current = undefined;
      if (isPdf) {
        const h = await openPdf(file);
        pdf.current = h;
        const first = h.matches.findIndex(Boolean);
        const page = first >= 0 ? first + 1 : 1;
        const r = await h.render(page);
        setPhoto({ url: r.url, name: file.name, source: "pdf", w: r.w, h: r.h, quad: FULL_QUAD, warnings: [], page, pages: h.numPages });
        if (first >= 0) {
          setFormId(h.matches[first]);
          setIdent({ text: `PDF의 ${page}쪽 제목을 읽어 양식을 찾았어요.`, tone: "ok" });
        } else if (h.scanned[page - 1]) {
          const id = await identifyByVision(r.dataUrl);
          setFormId(id.formId ?? undefined);
          setIdent(id.note);
        } else {
          setIdent({ text: "등록된 양식을 찾지 못했어요. 아래에서 직접 골라 주세요.", tone: "warn" });
        }
      } else {
        const n = await normalizeImage(file);
        setPhoto({ url: n.url, name: file.name, source: "photo", w: n.w, h: n.h, quad: INSET_QUAD, warnings: n.warnings });
        const id = await identifyByVision(n.dataUrl);
        setFormId(id.formId ?? undefined);
        setIdent(id.note);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 처리하지 못했어요.");
    } finally {
      setBusy(undefined);
    }
  };

  const onPage = async (page: number) => {
    const h = pdf.current;
    if (!h || !photo) return;
    setBusy("쪽을 불러오는 중…");
    try {
      const r = await h.render(page);
      setPhoto({ ...photo, url: r.url, w: r.w, h: r.h, page });
      const id = h.matches[page - 1];
      setFormId(id);
      setIdent(id ? { text: `${page}쪽 제목을 읽어 양식을 찾았어요.`, tone: "ok" } : { text: `${page}쪽은 등록된 양식이 아니에요. 직접 골라 주세요.`, tone: "warn" });
    } finally {
      setBusy(undefined);
    }
  };

  const reset = () => {
    pdf.current = undefined;
    setBusy(undefined);
    setError(undefined);
    setIdent(undefined);
    setStep(0);
    setFormId(undefined);
    setPhoto(undefined);
    setAnswer(undefined);
    setFieldId(undefined);
    setChecked({});
  };

  return (
    <main className="min-h-screen bg-[#F3F5F7] px-4 py-6 text-[#1F2933] sm:px-6" style={{ fontFamily: "var(--font-ui)" }}>
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3 pb-4">
          <Link href="/" className="inline-flex min-h-[52px] items-center gap-2 rounded-xl px-3 text-base font-bold text-[#285A88] hover:bg-[#E6EBF0]">
            <House className="size-6" /> 소개 화면
          </Link>
          <button onClick={reset} className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl border-2 border-[#285A88] bg-white px-5 text-base font-bold text-[#285A88] hover:bg-[#DCE8F3]">
            <RotateCcw className="size-6" /> 처음부터 다시
          </button>
        </header>

        <div className="rounded-3xl border border-[#D5DBE1] bg-white p-5 shadow-[0_1px_2px_rgba(31,41,51,.06)] sm:p-6">
          <div className="border-b border-[#D5DBE1] pb-4">
            <h1 className="text-[1.65rem] font-bold leading-snug sm:text-[2rem]">사진 기반 서류 작성 도우미</h1>
            <p className="mt-1 text-base text-[#52606D]">내 상황에 맞게, 막힌 칸부터 한 칸씩.</p>
          </div>

          <ol className="mt-5 grid grid-cols-5 gap-1.5 rounded-2xl bg-[#E6EBF0] p-1.5" aria-label="진행 단계">
            {STEPS.map((s, i) => (
              <li
                key={s}
                aria-current={i === step ? "step" : undefined}
                className={cn("flex min-h-[52px] flex-col items-center justify-center rounded-xl px-1 text-center text-[0.9rem] leading-tight", i === step ? "border border-[#D5DBE1] bg-white font-bold text-[#1F2933]" : i < step ? "bg-[#DCE8F3] font-bold text-[#1F4A73]" : "text-[#52606D]")}
              >
                <span className="font-bold">{i < step ? "✓" : `0${i + 1}`}</span>
                {s}
              </li>
            ))}
          </ol>

          <p className="mt-4 flex items-start gap-3 rounded-2xl bg-[#FFF4D6] p-4 text-base text-[#5C4300]">
            <TriangleAlert className="mt-0.5 size-6 shrink-0" />
            <span>공개 서식을 바탕으로 한 시연입니다. 안내는 참고용이며, 최종 작성 기준은 해당 기관의 최신 양식·안내를 확인하세요. 파일은 서버에 저장되지 않습니다.</span>
          </p>
        </div>

        <section className="mt-6">
        {step === 0 && (
          <StepCapture
            photo={photo}
            formId={formId}
            busy={busy}
            error={error}
            ident={ident}
            onFile={onFile}
            onPage={onPage}
            onQuad={(q) => photo && setPhoto({ ...photo, quad: q })}
            onPick={(id) => setFormId(id)}
            onClear={() => {
              setPhoto(undefined);
              setIdent(undefined);
              setFormId(undefined);
              pdf.current = undefined;
            }}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && form && (
          <StepSituation
            form={form}
            answer={answer}
            onAnswer={(a) => {
              setAnswer(a);
              setStep(2);
            }}
          />
        )}
        {(step === 2 || step === 3) && form && answer && (
          <StepFields
            form={form}
            answer={answer}
            photo={photo}
            field={field}
            fieldId={fieldId}
            onSelect={(id) => {
              setFieldId(id);
              setStep(3);
            }}
            showGuide={step === 3}
            onDone={() => setStep(4)}
          />
        )}
        {step === 4 && form && (
          <StepCheck form={form} checked={checked} setChecked={setChecked} onBack={() => setStep(2)} onReset={reset} />
        )}
      </section>
      </div>

      {step === 3 && guide && form && field && answer && (
        <p className="sr-only" aria-live="polite">
          {guideText(guide)}
        </p>
      )}
    </main>
  );
}

/* ----------------------------- 01 양식 촬영 ----------------------------- */

async function identifyByVision(dataUrl: string): Promise<{ formId: string | null; note: Ident }> {
  try {
    const res = await fetch("/api/identify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
    const j = (await res.json()) as { formId: string | null; confidence: number; reason: string };
    if (j.formId) return { formId: j.formId, note: { text: `AI가 양식을 찾았어요 (확신도 ${Math.round(j.confidence * 100)}%). 맞는지 확인해 주세요.`, tone: "ok" } };
    const why = j.reason === "no-key" ? "자동 인식이 꺼져 있어요(시연 모드)." : "등록된 양식을 찾지 못했어요.";
    return { formId: null, note: { text: `${why} 아래에서 직접 골라 주세요.`, tone: "warn" } };
  } catch {
    return { formId: null, note: { text: "자동 인식에 실패했어요. 아래에서 직접 골라 주세요.", tone: "warn" } };
  }
}

type CaptureProps = {
  photo?: Upload;
  formId?: string;
  busy?: string;
  error?: string;
  ident?: Ident;
  onFile: (f?: File) => void;
  onPage: (n: number) => void;
  onQuad: (q: Pt[]) => void;
  onPick: (id: string) => void;
  onClear: () => void;
  onNext: () => void;
};

function FormPicker({ formId, onPick }: { formId?: string; onPick: (id: string) => void }) {
  return (
    <ul className="mt-3 grid gap-2">
      {forms.map((f) => (
        <li key={f.id}>
          <button onClick={() => onPick(f.id)} className={cn("w-full rounded-xl border px-4 py-3 text-left transition-colors", formId === f.id ? "border-[#285A88] bg-[#DCE8F3]" : "border-[#1F2933]/10 hover:bg-[#F3F5F7]")}>
            <span className="block text-lg font-semibold">{f.name}</span>
            <span className="block text-base text-[#1F2933]/60">{f.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StepCapture({ photo, formId, busy, error, ident, onFile, onPage, onQuad, onPick, onClear, onNext }: CaptureProps) {
  const form = formId ? getForm(formId) : undefined;
  const next = (
    <button disabled={!formId || !!busy} onClick={onNext} className="mt-4 w-full rounded-2xl bg-gradient-to-r from-[#285A88] to-[#35739C] hover:from-[#1F4A73] hover:to-[#285A88] min-h-14 px-4 py-3.5 text-xl font-bold text-white disabled:from-[#C5CDD5] disabled:to-[#C5CDD5] disabled:text-[#5F6B76]">
      다음: 상황 확인
    </button>
  );

  // 업로드 후: 양식 확인 + (사진이면) 모서리 정렬
  if (photo) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div>
          {form ? (
            <FormOverlay form={form} src={photo.url} size={photo} quad={photo.quad} onQuadChange={photo.source === "photo" ? onQuad : undefined} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt="올린 양식" className="w-full rounded-xl border" />
          )}
          <p className="mt-2 truncate text-base text-[#1F2933]/60">{photo.name}</p>
        </div>
        <div className="rounded-3xl border border-[#1F2933]/10 bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <FileText className="size-5 text-[#285A88]" /> 이 양식이 맞나요?
          </h2>
          {busy && <p className="mt-2 rounded-lg bg-[#EAF1F8] px-3 py-2 font-medium">{busy}</p>}
          {ident && <p className={cn("mt-2 rounded-lg px-3 py-2", ident.tone === "ok" ? "bg-[#E3F1EA]" : "bg-[#FFF4D6] text-[#5C4300]")}>{ident.text}</p>}
          {photo.warnings.map((w) => (
            <p key={w} className="mt-2 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[#5C4300]">
              ⚠ {w}
            </p>
          ))}
          {photo.source === "pdf" && (photo.pages ?? 1) > 1 && (
            <label className="mt-3 flex items-center gap-2 text-base font-semibold">
              쪽 선택
              <select value={photo.page} onChange={(e) => onPage(Number(e.target.value))} className="rounded-lg border border-[#1F2933]/20 bg-white px-3 min-h-[52px]">
                {Array.from({ length: photo.pages! }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}쪽 / {photo.pages}쪽
                  </option>
                ))}
              </select>
            </label>
          )}
          <FormPicker formId={formId} onPick={onPick} />
          {photo.source === "photo" && form && (
            <p className="mt-3 rounded-lg bg-[#EAF1F8] px-3 py-2 text-base">
              <b>칸 위치 맞추기</b>: 사진 위의 빨간 점 4개를 종이의 네 모서리에 맞게 끌어 주세요. 파란 칸이 서식의 칸과 겹치면 됩니다.{" "}
              <button className="font-semibold underline underline-offset-2" onClick={() => onQuad(INSET_QUAD)}>
                처음 위치로
              </button>
            </p>
          )}
          <p className="mt-2 text-[0.9rem] text-[#1F2933]/50">파일은 이 브라우저에서만 처리돼요. 양식 식별을 위해 사진 이미지가 AI 서버로 잠시 전송될 수 있으며 저장되지 않아요.</p>
          {next}
          <button onClick={onClear} className="mt-2 w-full rounded-xl border border-[#1F2933]/15 px-4 py-2.5 min-h-[52px] font-semibold">
            다른 파일 올리기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-[#1F2933]/10 bg-white p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Camera className="size-5 text-[#285A88]" /> 양식을 찍거나 파일로 올려 주세요
        </h2>
        <p className="mt-1 text-[#1F2933]/70">종이 양식을 찍은 사진이나 PDF를 올리면 어떤 양식인지 찾고, 칸 위치를 맞춰 드려요. 시연에서는 오른쪽의 예시 양식을 골라도 됩니다.</p>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
          className="mt-4 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[#285A88]/50 bg-[#EAF1F8] px-4 py-6 text-center"
        >
          <Upload className="size-7 text-[#285A88]" />
          <span className="text-base text-[#1F2933]/60">여기에 파일을 끌어다 놓거나 아래 버튼을 누르세요 (이미지·PDF, 15MB 이하)</span>
          <div className="flex flex-wrap justify-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#285A88] to-[#35739C] hover:from-[#1F4A73] hover:to-[#285A88] min-h-14 px-4 py-2.5  font-bold text-white">
              <Camera className="size-4" /> 카메라로 촬영
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#285A88] bg-white px-4 py-2.5 min-h-[52px] font-bold text-[#1F4A73]">
              <FileText className="size-4" /> 파일 올리기
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          {busy && <p className="text-base font-medium text-[#1F4A73]">{busy}</p>}
          {error && <p className="text-base font-medium text-red-600">{error}</p>}
        </div>
        <p className="mt-3 text-[0.9rem] text-[#1F2933]/50">파일은 이 브라우저에서만 처리돼요. 사진은 양식 식별을 위해 AI 서버로 잠시 전송될 수 있으며 저장되지 않아요. 이미 작성된 개인정보가 있는 서류는 올리지 마세요.</p>
      </div>

      <div className="rounded-3xl border border-[#1F2933]/10 bg-white p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <FileText className="size-5 text-[#285A88]" /> 예시 양식으로 체험하기
        </h2>
        <p className="mt-1 text-base text-[#1F2933]/60">등록된 공개 서식 3종</p>
        <FormPicker formId={formId} onPick={onPick} />
        {next}
      </div>
    </div>
  );
}

/* ----------------------------- 02 상황 확인 ----------------------------- */

function StepSituation({ form, answer, onAnswer }: { form: FormDef; answer?: string; onAnswer: (a: string) => void }) {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-[#1F2933]/10 bg-white p-6">
      <p className="flex items-center gap-2 text-base font-semibold text-[#285A88]">
        <MessageCircleQuestion className="size-4" /> {form.name} · 필요한 질문은 하나만 할게요
      </p>
      <h2 className="mt-2 text-2xl font-bold leading-snug">{form.question.text}</h2>
      <div className="mt-5 grid gap-3">
        {form.question.options.map((o, i) => (
          <button key={o.id} onClick={() => onAnswer(o.id)} className={cn("rounded-xl px-4 py-4 text-lg font-bold", i === 0 ? "bg-[#1F4A73] text-white" : "border border-[#1F2933]/15 bg-[#F3F5F7]", answer === o.id && "ring-2 ring-[#285A88]")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------ 03·04 칸 선택 + 칸별 안내 ------------------------ */

function StepFields({ form, answer, photo, field, fieldId, onSelect, showGuide, onDone }: { form: FormDef; answer: string; photo?: Upload; field?: Field; fieldId?: string; onSelect: (id: string) => void; showGuide: boolean; onDone: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div>
        <p className="mb-2 text-base text-[#1F2933]/60">궁금한 칸을 눌러 보세요.</p>
        <FormFrame form={form} photo={photo} fieldId={fieldId} onSelect={onSelect} />
        <ul className="mt-3 flex flex-wrap gap-2">
          {form.fields.map((f) => (
            <li key={f.id}>
              <button onClick={() => onSelect(f.id)} className={cn("rounded-full border px-4 py-2 min-h-[52px] text-base", fieldId === f.id ? "border-[#285A88] bg-[#DCE8F3] font-semibold" : "border-[#1F2933]/15 bg-white")}>
                {f.label}
              </button>
            </li>
          ))}
        </ul>
        {photo && <p className="mt-2 text-[0.9rem] text-[#1F2933]/50">칸 위치가 어긋나면 위 칸 목록에서 골라 주세요. (이전 단계로 돌아가 모서리를 다시 맞출 수도 있어요)</p>}
      </div>

      <div>
        {showGuide && field ? (
          <GuideCard key={`${field.id}-${answer}`} form={form} field={field} answer={answer} onDone={onDone} />
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center rounded-3xl border-2 border-dashed border-[#1F2933]/15 bg-white/60 p-8 text-center text-lg text-[#1F2933]/50">
            칸을 선택하면 여기에 작성 안내가 나와요.
          </div>
        )}
      </div>
    </div>
  );
}

function FormFrame({ form, photo, fieldId, onSelect }: { form: FormDef; photo?: Upload; fieldId?: string; onSelect: (id: string) => void }) {
  return photo ? (
    <FormOverlay form={form} src={photo.url} size={photo} quad={photo.quad} fieldId={fieldId} onSelect={onSelect} />
  ) : (
    <FormOverlay form={form} src={form.template.src} size={form.template} quad={FULL_QUAD} fieldId={fieldId} onSelect={onSelect} />
  );
}

function GuideCard({ form, field, answer, onDone }: { form: FormDef; field: Field; answer: string; onDone: () => void }) {
  const g = field.guides[answer];
  const [easy, setEasy] = useState<{ text: string; source: string }>();
  const [loading, setLoading] = useState(false);

  const rows = useMemo(
    () => [
      { Icon: User, q: "누구의 정보인가요?", a: g.whose },
      { Icon: FileText, q: "어디서 확인하나요?", a: g.where },
      { Icon: Pencil, q: "어떻게 쓰나요?", a: g.how },
    ],
    [g],
  );

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  };

  const explain = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formId: form.id, fieldId: field.id, answerId: answer }) });
      setEasy(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border-2 border-[#285A88]/40 bg-gradient-to-b from-[#EAF1F8] to-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl font-bold">선택한 칸의 작성 안내</h2>
        <button onClick={() => speak(guideText(g))} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 min-h-[52px] text-base font-semibold shadow-sm ring-1 ring-[#1F2933]/10">
          <Volume2 className="size-4" /> 읽어주기
        </button>
      </div>
      <p className="mt-1 text-[#1F2933]/60">「{field.label}」 칸</p>

      <ul className="mt-4 grid gap-2.5">
        {rows.map(({ Icon, q, a }) => (
          <li key={q} className="grid grid-cols-[2.5rem_1fr] items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-[#1F2933]/8">
            <span className="grid size-10 place-items-center rounded-full bg-[#E6EBF0]">
              <Icon className="size-5 text-[#1F4A73]" />
            </span>
            <span>
              <span className="block text-base font-bold">{q}</span>
              <span className="block text-lg leading-snug">{a}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-xl bg-[#EAF1F8] p-3">
        <p className="text-base font-semibold text-[#285A88]">{g.exampleOfficial ? "공식 양식 예시" : "가상 예시"}</p>
        <p className="mt-0.5 text-lg">{g.example}</p>
      </div>
      {g.caution && <p className="mt-3 rounded-xl bg-[#FFF4D6] p-3 text-base text-[#5C4300]">⚠ {g.caution}</p>}
      {g.basis && <p className="mt-3 text-base text-[#1F2933]/60">근거: {g.basis}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={explain} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-[#285A88] bg-white px-4 py-2.5 min-h-[52px] font-semibold text-[#1F4A73]">
          <Sparkles className="size-4" /> {loading ? "쉽게 풀어쓰는 중…" : "더 쉽게 설명해줘"}
        </button>
        <button onClick={onDone} className="ml-auto inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#285A88] to-[#35739C] hover:from-[#1F4A73] hover:to-[#285A88] min-h-14 px-4 py-2.5  font-bold text-white">
          <ClipboardCheck className="size-4" /> 제출 전 점검하기
        </button>
      </div>
      {easy && (
        <p className="mt-3 rounded-xl bg-white p-3 text-lg leading-snug ring-1 ring-[#285A88]/30">
          {easy.text}
          <span className="mt-1 block text-[0.9rem] text-[#1F2933]/50">{easy.source === "ai" ? "AI가 등록된 공식 안내 범위 안에서 풀어 쓴 설명이에요." : "등록된 안내를 그대로 보여 드려요. (AI 연결 전 시연 모드)"}</span>
        </p>
      )}

      <div className="mt-4 rounded-xl bg-[#E3F1EA] p-3 text-base">
        <p className="flex items-start gap-2 font-semibold">
          <BookOpenCheck className="mt-0.5 size-4 shrink-0" /> 공식 근거 · 개정판 확인 (기준연도 {form.source.baseYear})
        </p>
        <ul className="mt-1.5 grid gap-1.5 pl-6">
          {form.source.refs.map((r) => (
            <li key={r.label}>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                  {r.label}
                </a>
              ) : (
                <span className="font-medium">{r.label}</span>
              )}
              <span className="block text-[#1F2933]/70">{r.note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 pl-6 text-[#1F2933]/70">{form.source.note}</p>
      </div>
    </div>
  );
}

/* --------------------------- 05 직접 작성 · 점검 --------------------------- */

function StepCheck({ form, checked, setChecked, onBack, onReset }: { form: FormDef; checked: Record<string, boolean>; setChecked: (c: Record<string, boolean>) => void; onBack: () => void; onReset: () => void }) {
  const items = [...form.checklist, "내용은 종이에 직접 쓰고, 서명·인은 해당하는 분이 직접 했나요?"];
  const done = items.every((i) => checked[i]);
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-[#1F2933]/10 bg-white p-6">
      <h2 className="flex items-center gap-2 text-2xl font-bold">
        <ClipboardCheck className="size-6 text-[#285A88]" /> 제출 전 자가점검
      </h2>
      <p className="mt-1 text-[#1F2933]/60">{form.name} · 종이에 직접 쓰고, 아래를 하나씩 확인하세요.</p>
      <ul className="mt-4 grid gap-2.5">
        {items.map((i) => (
          <li key={i}>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-lg", checked[i] ? "border-[#285A88] bg-[#DCE8F3]" : "border-[#1F2933]/10")}>
              <input type="checkbox" className="sr-only" checked={!!checked[i]} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} />
              <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2", checked[i] ? "border-[#285A88] bg-[#285A88] text-white" : "border-[#1F2933]/30")}>{checked[i] && <Check className="size-4" />}</span>
              {i}
            </label>
          </li>
        ))}
      </ul>
      {done && <p className="mt-4 rounded-xl bg-[#E3F1EA] p-3 text-lg font-semibold">모두 확인했어요. 이제 자신 있게 제출하세요!</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onBack} className="rounded-xl border border-[#1F2933]/15 px-4 py-2.5 min-h-[52px] font-semibold">
          다른 칸 보기
        </button>
        <button onClick={onReset} className="ml-auto rounded-2xl bg-gradient-to-r from-[#285A88] to-[#35739C] hover:from-[#1F4A73] hover:to-[#285A88] min-h-14 px-4 py-2.5  font-bold text-white">
          다른 양식 해보기
        </button>
      </div>
    </div>
  );
}
