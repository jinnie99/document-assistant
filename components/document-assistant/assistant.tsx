"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, FileText, HelpCircle, List, Scale, X } from "lucide-react";
import type { AnalysisResult, ApiError, Box, DocumentField, DocumentIdentity, FieldGuidance, GuideAnswers } from "@/lib/documents/types";
import type { LegalContext } from "@/lib/legal/types";
import { buildLegalViewModel, pendingLegalContext } from "@/lib/legal/view-model";
import { LegalPanel } from "./legal-panel";
import { LegalCandidateDialog } from "./legal-candidate-dialog";
import { consumeAnalysisStream } from "@/lib/documents/analysis-stream-client";
import { documentConfirmationDestination, documentIdentityForReading, mergeAnalysisFields, mergeAnalysisSearch, mergeRegionAnalysis } from "@/lib/documents/analysis-flow";
import { normalizeImage } from "@/lib/image";
import { DocumentView, FieldFocus } from "./document-view";
import { GuideCard } from "./guide-card";
import { PhotoTools } from "./photo-tools";
import { AssistantDialog, FieldDialog, SourceDialog } from "./selection-dialog";
import { createSampleFile } from "./sample-document";
import { HomeScreen } from "./home-screen";
import { RegionEditorDialog } from "./region-editor-dialog";
import { AnalysisProgress, type AnalysisStage } from "./analysis-progress";
import { IdentityReview } from "./identity-review";
import type { AssistantPhoto } from "./types";

type Screen = "home" | "preview" | "analyzing" | "review" | "mapping" | "guide" | "finish";
type Dialog = "help" | "fields" | "sources" | "legal" | "legal-candidates" | null;

function legalEntryLabel(legal: LegalContext) {
  const state = buildLegalViewModel(legal).state;
  if (state === "pending") return "법령·절차 찾는 중";
  if (state === "ambiguous") return "비슷한 법령 중 골라 주세요";
  if (state === "completed") return "관련 법령과 민원 절차 보기";
  return "법령·절차 정보를 찾지 못했어요";
}

class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function searchLabel(analysis: AnalysisResult) {
  if (analysis.mappingStatus === "in_progress") return "찾은 칸부터 사진으로 먼저 안내해요";
  if (analysis.search.status === "pending") return "사진으로 먼저 안내해요 · 작성 안내 검색 중";
  if (analysis.search.status === "unavailable") return "검색 연결이 어려워 사진으로 안내해요";
  return analysis.search.case === "form_and_guide" ? "서류와 작성 안내를 찾았어요" : analysis.search.case === "form_only" ? "서류를 찾아 AI가 설명해요" : "사진을 읽어 AI가 설명해요";
}

async function requestJson<T>(url: string, body: unknown, signal: AbortSignal, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  let result: T | ApiError;
  try { result = await response.json(); } catch { throw new Error("연결이 원활하지 않아요. 잠시 뒤 다시 해 주세요."); }
  if (!response.ok) {
    const error = result as ApiError;
    if (response.status === 410) throw new ApiRequestError("안내 시간이 지났어요. 사진을 다시 확인하면 계속할 수 있어요.", 410);
    throw new Error(error.error || "안내를 준비하지 못했어요. 다시 시도해 주세요.");
  }
  return result as T;
}

function discardAnalysis(id?: string) {
  if (!id) return;
  void fetch("/api/documents/analyze", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {});
}

export function DocumentAssistant() {
  const [screen, setScreen] = useState<Screen>("home");
  const [photo, setPhoto] = useState<AssistantPhoto>();
  const [photoVersion, setPhotoVersion] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult>();
  const [identity, setIdentity] = useState<DocumentIdentity>();
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("identifying");
  const [selected, setSelected] = useState<DocumentField>();
  const [guidance, setGuidance] = useState<FieldGuidance>();
  const [guideVersion, setGuideVersion] = useState(0);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string>();
  const [guideExpired, setGuideExpired] = useState(false);
  const [error, setError] = useState<string>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [large, setLarge] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [regionTarget, setRegionTarget] = useState<DocumentField | null>();
  const [regionBusy, setRegionBusy] = useState(false);
  const [regionError, setRegionError] = useState<string>();
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [answersByField, setAnswersByField] = useState<Record<string, GuideAnswers>>({});
  const [legalBusy, setLegalBusy] = useState(false);
  const [legalError, setLegalError] = useState<string>();
  const legalController = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null), gallery = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const analysisGeneration = useRef(0);
  const streamAnalysisId = useRef<string | undefined>(undefined);
  const latestMapped = useRef<AnalysisResult | undefined>(undefined);
  const confirmedIdentity = useRef(false);
  const regionController = useRef<AbortController | null>(null);
  const regionGeneration = useRef(0);
  const generation = useRef(0), fileGeneration = useRef(0);
  const objectUrls = useRef(new Set<string>());
  const currentPhoto = useRef<AssistantPhoto | undefined>(undefined);
  const guideCache = useRef(new Map<string, FieldGuidance>());
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/documents/status", { signal: abort.signal, cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => { if (typeof result?.configured === "boolean") setConfigured(result.configured); }).catch(() => {});
    const urls = objectUrls.current;
    return () => {
      abort.abort(); controller.current?.abort(); regionController.current?.abort(); analysisController.current?.abort(); legalController.current?.abort();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- DOM 참조가 아닌 작업 취소용 순번을 증가시킨다.
      fileGeneration.current++;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [screen]);

  const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; setGuideLoading(false); };
  const stopAnalysis = (discard = false) => {
    analysisGeneration.current++; analysisController.current?.abort(); analysisController.current = null;
    if (discard) { discardAnalysis(streamAnalysisId.current); streamAnalysisId.current = undefined; }
  };
  const backToPhoto = () => { stopAnalysis(true); latestMapped.current = undefined; confirmedIdentity.current = false; setAnalysis(undefined); setIdentity(undefined); setScreen("preview"); };
  const closeRegion = () => { regionGeneration.current++; regionController.current?.abort(); regionController.current = null; setRegionTarget(undefined); setRegionBusy(false); setRegionError(undefined); };
  const openRegion = (field?: DocumentField) => { closeRegion(); setDialog(null); setRegionTarget(field ?? null); };
  const keepPhoto = (next: AssistantPhoto) => { objectUrls.current.add(next.url); currentPhoto.current = next; setPhoto(next); };
  const onFile = async (file?: File, sample = false) => {
    if (!file) return;
    const token = ++fileGeneration.current;
    cancel(); stopAnalysis(); closeRegion(); setError(undefined); setPreparing(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("15MB 이하의 사진을 골라 주세요.");
      if (!file.type.startsWith("image/")) throw new Error("JPG나 PNG 같은 사진 파일을 골라 주세요.");
      const result = await normalizeImage(file);
      if (token !== fileGeneration.current) { URL.revokeObjectURL(result.url); return; }
      keepPhoto({ url: result.url, dataUrl: result.dataUrl, width: result.w, height: result.h, warnings: result.warnings, name: file.name, sample });
      setPhotoVersion((version) => version + 1);
      discardAnalysis(analysis?.id); discardAnalysis(streamAnalysisId.current);
      streamAnalysisId.current = undefined; latestMapped.current = undefined; confirmedIdentity.current = false; setIdentity(undefined);
      setAnalysis(undefined); setSelected(undefined); setGuidance(undefined); setAnswersByField({}); setViewed(new Set()); guideCache.current.clear();
      setScreen("preview");
    } catch (problem) { if (token === fileGeneration.current) setError(problem instanceof Error ? problem.message : "사진을 열지 못했어요."); }
    finally { if (token === fileGeneration.current) setPreparing(false); }
  };
  const prepareSample = async () => {
    const token = ++fileGeneration.current;
    setError(undefined); setPreparing(true);
    try { const file = await createSampleFile(); if (token === fileGeneration.current) await onFile(file, true); }
    catch (problem) { if (token === fileGeneration.current) { setPreparing(false); setError(problem instanceof Error ? problem.message : "예시를 준비하지 못했어요."); } }
  };
  const reset = () => {
    discardAnalysis(analysis?.id);
    cancel(); stopAnalysis(true); closeRegion(); fileGeneration.current++; setPreparing(false); setPhotoBusy(false); currentPhoto.current = undefined;
    latestMapped.current = undefined; confirmedIdentity.current = false; setIdentity(undefined);
    setPhoto(undefined); setAnalysis(undefined); setSelected(undefined); setGuidance(undefined); setGuideError(undefined); setAnswersByField({}); setViewed(new Set()); setError(undefined); setDialog(null); guideCache.current.clear(); setScreen("home");
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  };
  const analyze = async () => {
    if (!photo || photoBusy || preparing) return;
    discardAnalysis(analysis?.id); setAnalysis(undefined);
    cancel(); stopAnalysis(true);
    const token = ++analysisGeneration.current, abort = new AbortController(); analysisController.current = abort;
    latestMapped.current = undefined; confirmedIdentity.current = false;
    setIdentity(undefined); setSelected(undefined); setGuidance(undefined); setAnswersByField({}); setViewed(new Set()); guideCache.current.clear();
    setError(undefined); setAnalysisStage("identifying"); setScreen("analyzing");
    let quickIdentity: DocumentIdentity | undefined;
    let mapped: AnalysisResult | undefined;
    try {
      const response = await fetch("/api/documents/analyze", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ image: photo.dataUrl }), signal: abort.signal, cache: "no-store" });
      await consumeAnalysisStream(response, (event) => {
        if (abort.signal.aborted || token !== analysisGeneration.current) return;
        if (event.type === "stage") setAnalysisStage(event.stage);
        if (event.type === "identity" && event.identity.readable && event.identity.title.trim()) {
          quickIdentity = event.identity; setIdentity(event.identity);
          if (!confirmedIdentity.current && !latestMapped.current) setScreen("review");
        }
        if (event.type === "mapped" || event.type === "fields") {
          const result = event.analysis;
          const first = !mapped;
          mapped = first ? result : mergeAnalysisFields(latestMapped.current, result) ?? result;
          latestMapped.current = mapped; streamAnalysisId.current = result.id;
          if (first) {
            setAnalysis(result); setIdentity(documentIdentityForReading(result.document, quickIdentity));
            if (!result.document.readable || !result.document.fields.length) {
              setError("사진의 글자나 칸을 잘 읽지 못했어요. 서류를 가까이서 밝게 다시 찍어 주세요."); setScreen("preview");
            } else setScreen(confirmedIdentity.current ? "guide" : "review");
          } else setAnalysis((current) => mergeAnalysisFields(current, result));
        }
        if (event.type === "complete") {
          latestMapped.current = mergeAnalysisSearch(latestMapped.current, event.analysis);
          setAnalysis((current) => mergeAnalysisSearch(current, event.analysis));
        }
        if (event.type === "legal_started") setAnalysis((current) => current?.id === event.analysisId ? { ...current, legal: current.legal ?? pendingLegalContext() } : current);
        if (event.type === "legal_reference") setAnalysis((current) => current?.id === event.analysisId ? { ...current, legal: { ...(current.legal ?? pendingLegalContext()), detectedReferences: event.references } } : current);
        if (event.type === "legal_complete" || event.type === "legal_unavailable") setAnalysis((current) => current?.id === event.analysis.id ? { ...current, legal: event.analysis.legal } : current);
      }, abort.signal);
    } catch (problem) {
      if (token !== analysisGeneration.current || abort.signal.aborted) return;
      if (mapped) {
        setAnalysis((current) => current?.id === mapped!.id ? { ...current, mappingStatus: current.mappingStatus === "in_progress" ? "partial" : current.mappingStatus, search: current.search.status === "pending" ? { status: "unavailable", case: "photo_only", summary: "검색 연결이 끊겨 사진으로 먼저 안내해요.", sources: [] } : current.search } : current);
      } else { setError(problem instanceof Error ? problem.message : "서류를 읽지 못했어요."); setScreen("preview"); }
    } finally {
      if (analysisController.current === abort) analysisController.current = null;
    }
  };
  const confirmDocument = () => {
    const destination = documentConfirmationDestination(identity, latestMapped.current);
    confirmedIdentity.current = destination === "guide" || destination === "mapping";
    setScreen(destination);
  };
  const loadGuide = async (field: DocumentField, nextAnswers: GuideAnswers = answersByField[field.id] ?? {}, bypassCache = false) => {
    if (!analysis) return;
    cancel(); setDialog(null); setSelected(field); setGuideError(undefined); setGuideExpired(false); setGuidance(undefined); setScreen("guide");
    const cacheKey = `${analysis.search.status}:${field.id}:${JSON.stringify(nextAnswers)}`;
    const cached = !bypassCache && guideCache.current.get(cacheKey);
    if (cached) { setGuidance(cached); setGuideVersion((version) => version + 1); if (!cached.question) setViewed((previous) => new Set([...previous, field.id])); return; }
    const token = ++generation.current, abort = new AbortController(); controller.current = abort; setGuideLoading(true);
    try {
      const result = await requestJson<FieldGuidance>("/api/documents/guide", { analysisId: analysis.id, fieldId: field.id, answers: nextAnswers }, abort.signal);
      if (token !== generation.current) return;
      guideCache.current.set(cacheKey, result); setGuidance(result); setGuideVersion((version) => version + 1);
      if (!result.question) setViewed((previous) => new Set([...previous, field.id]));
    } catch (problem) { if (token === generation.current && !abort.signal.aborted) { setGuideExpired(problem instanceof ApiRequestError && problem.status === 410); setGuideError(problem instanceof Error ? problem.message : "이 칸을 설명하지 못했어요."); } }
    finally { if (token === generation.current) setGuideLoading(false); }
  };
  const selectedIndex = analysis?.document.fields.findIndex((field) => field.id === selected?.id) ?? -1;
  const leaveField = () => { cancel(); setSelected(undefined); setGuidance(undefined); setGuideError(undefined); };
  const recoverExpired = () => { leaveField(); stopAnalysis(true); setAnalysis(undefined); setIdentity(undefined); setGuideExpired(false); setAnswersByField({}); setViewed(new Set()); guideCache.current.clear(); setScreen("preview"); };
  const saveRegion = async ({ box, image }: { box: Box; image?: string }) => {
    if (!analysis || regionBusy || regionTarget === undefined) return;
    const target = regionTarget;
    cancel();
    const token = ++regionGeneration.current;
    const abort = new AbortController(); regionController.current = abort;
    setRegionBusy(true); setRegionError(undefined);
    try {
      if (!target && !image) throw new Error("추가할 칸을 다시 골라 주세요.");
      const result = await requestJson<{ analysis: AnalysisResult; field: DocumentField }>("/api/documents/fields", { analysisId: analysis.id, ...(target ? { fieldId: target.id } : { image }), box }, abort.signal, target ? "PATCH" : "POST");
      if (abort.signal.aborted || token !== regionGeneration.current) return;
      latestMapped.current = mergeRegionAnalysis(latestMapped.current, result.analysis, result.field.id);
      setAnalysis((current) => mergeRegionAnalysis(current, result.analysis, result.field.id)); setError(undefined); guideCache.current.clear(); setAnswersByField({}); setViewed(new Set());
      setRegionTarget(undefined); setRegionBusy(false); setRegionError(undefined);
      void loadGuide(result.field, {}, true);
    } catch (problem) {
      if (abort.signal.aborted || token !== regionGeneration.current) return;
      if (problem instanceof ApiRequestError && problem.status === 410) { closeRegion(); recoverExpired(); setError(problem.message); }
      else setRegionError(problem instanceof Error ? problem.message : "영역을 저장하지 못했어요. 다시 골라 주세요.");
    } finally { if (regionController.current === abort) { regionController.current = null; setRegionBusy(false); } }
  };
  const chooseLegalCandidate = async (candidateId: string) => {
    if (!analysis || legalBusy) return;
    const analysisId = analysis.id;
    legalController.current?.abort();
    const abort = new AbortController(); legalController.current = abort;
    setLegalBusy(true); setLegalError(undefined);
    try {
      const legal = await requestJson<LegalContext>("/api/documents/legal", { analysisId, candidateId }, abort.signal, "PATCH");
      if (abort.signal.aborted) return;
      setAnalysis((current) => current?.id === analysisId ? { ...current, legal } : current);
      setDialog(null);
    } catch (problem) {
      if (abort.signal.aborted) return;
      setLegalError(problem instanceof Error ? problem.message : "법령을 다시 확인하지 못했어요. 잠시 뒤 다시 골라 주세요.");
    } finally { if (legalController.current === abort) { legalController.current = null; setLegalBusy(false); } }
  };
  const displaySources = guidance ? analysis?.search.sources.filter((source) => guidance.sourceIds.includes(source.id)) ?? [] : undefined;

  return <div className="assist-shell"><div className={`assist-phone${large ? " assist-large" : ""}`}>
    <header className="assist-header"><button className="assist-brand" onClick={reset} aria-label="서류작성 도우미 처음 화면"><span><FileText /></span>서류작성 도우미</button><div><button className="assist-font-button" aria-label={large ? "기본 글자 크기로" : "글자 크게"} aria-pressed={large} onClick={() => setLarge(!large)}>가</button><button className="assist-icon-button" aria-label="도움말" onClick={() => setDialog("help")}><HelpCircle /></button></div></header>
    <main className={`assist-main is-${screen}${selected && screen === "guide" ? " has-field" : ""}`}>
      {error && screen !== "analyzing" && <div className="assist-error" role="alert"><p>{error}</p><button className="assist-icon-button" aria-label="오류 안내 닫기" onClick={() => setError(undefined)}><X /></button></div>}
      {screen === "home" && <HomeScreen headingRef={title} preparing={preparing} configured={configured} onCamera={() => camera.current?.click()} onGallery={() => gallery.current?.click()} onSample={() => void prepareSample()} />}
      {screen === "preview" && photo && <section className="assist-preview"><div className="assist-screen-heading"><span>사진 확인</span><h1 ref={title} tabIndex={-1}>글자가 잘 보이나요?</h1><p>적힌 개인정보가 있다면 먼저 가려 주세요.</p></div><PhotoTools key={photoVersion} photo={photo} onChange={(next) => { if (currentPhoto.current?.url === photo.url) keepPhoto(next); else URL.revokeObjectURL(next.url); }} onError={setError} onBusyChange={setPhotoBusy} />{photo.warnings.length > 0 && <p className="assist-photo-warning">{photo.warnings[0]}</p>}{analysis && !analysis.document.fields.length && <button className="assist-text-button" disabled={photoBusy || preparing} onClick={() => openRegion()}>작성할 칸 직접 고르기</button>}<p className="assist-transfer-note">안내받기를 누르면 사진을 OpenAI로 보내 읽고 검색해요.{photo.sample ? " 지금은 가상 서류로 시험해요." : " 사진은 이 서버에 저장하지 않아요."}</p><div className="assist-preview-actions"><button className="assist-button assist-secondary" disabled={photoBusy || preparing} onClick={() => gallery.current?.click()}>다시 선택</button><button className="assist-button assist-primary" disabled={photoBusy || preparing || configured === false} onClick={() => void analyze()}>사진으로 안내받기<ArrowRight /></button></div></section>}
      {(screen === "analyzing" || screen === "mapping") && photo && <AnalysisProgress photo={photo} stage={screen === "mapping" ? "mapping" : analysisStage} identity={identity} confirmed={screen === "mapping"} headingRef={title} onCancel={backToPhoto} />}
      {screen === "review" && identity && photo && <IdentityReview photo={photo} identity={identity} ready={Boolean(analysis?.document.readable && analysis.document.fields.length)} searchPending={analysis?.search.status === "pending"} mappingPending={analysis?.mappingStatus === "in_progress"} foundCount={analysis?.document.fields.length ?? 0} headingRef={title} onConfirm={confirmDocument} onBack={backToPhoto} />}
      {screen === "guide" && analysis && photo && <section className={`assist-guide${selected ? " is-selected" : ""}`}><div className="assist-document-heading"><span title={analysis.document.title}>{analysis.mappingStatus === "in_progress" ? `${analysis.document.fields.length}칸부터 안내해요 · 나머지 찾는 중` : analysis.document.title}</span><button className="assist-text-button" onClick={() => setDialog("fields")}><List />칸 고르기</button></div>{!selected && <><h1 className="assist-pick-title" ref={title} tabIndex={-1}>궁금한 칸을 눌러보세요.</h1><button className="assist-search-summary" onClick={() => setDialog("sources")}><BookOpen /><span>{searchLabel(analysis)}</span><ArrowRight /></button>{analysis.legal && <button className="assist-search-summary assist-legal-entry" onClick={() => setDialog("legal")}><Scale /><span>{legalEntryLabel(analysis.legal)}</span><ArrowRight /></button>}<DocumentView photo={photo} fields={analysis.document.fields} onSelect={(field) => void loadGuide(field)} onAddField={() => openRegion()} /><p className="assist-pick-hint">{analysis.mappingStatus === "in_progress" ? "파란 칸부터 눌러보세요. 나머지 칸도 찾고 있어요." : analysis.document.warnings.some((warning) => /일부 확대|칸이 많아/.test(warning)) ? "못 찾은 칸은 ‘빠진 칸 추가’로 골라 주세요." : "파란 칸을 누르거나 칸 목록에서 골라 주세요."}</p><div className="assist-guide-bottom"><button className="assist-text-button" onClick={() => setScreen("preview")}><ArrowLeft />사진 확인</button><button className="assist-text-button" onClick={() => setScreen("finish")}>안내 마치기<Check /></button></div></>}{selected && <><FieldFocus photo={photo} field={selected} onEditRegion={() => openRegion(selected)} /><GuideCard key={`${analysis.id}-${selected.id}-${guideVersion}`} field={selected} guidance={guidance} loading={guideLoading} error={guideError} expired={guideExpired} large={large} hasPrevious={selectedIndex > 0} isLast={selectedIndex === analysis.document.fields.length - 1} moreFieldsPending={analysis.mappingStatus === "in_progress"} onClose={leaveField} onAnswer={(additional) => { const next = { ...(answersByField[selected.id] ?? {}), ...additional }; setAnswersByField((previous) => ({ ...previous, [selected.id]: next })); void loadGuide(selected, next); }} onRetry={() => guideExpired ? recoverExpired() : void loadGuide(selected, answersByField[selected.id] ?? {}, true)} onPreviousField={() => { const previous = analysis.document.fields[selectedIndex - 1]; if (previous) void loadGuide(previous); }} onNextField={() => { const next = analysis.document.fields[selectedIndex + 1]; if (next) void loadGuide(next); else { leaveField(); setScreen(analysis.mappingStatus === "in_progress" ? "guide" : "finish"); } }} onSources={() => setDialog("sources")} /></>}</section>}
      {screen === "finish" && <section className="assist-finish"><div className="assist-success"><Check /></div><div className="assist-screen-heading"><h1 ref={title} tabIndex={-1}>안내를 살펴봤어요.</h1><p>{viewed.size}개 칸을 함께 살펴봤어요.</p></div>{analysis?.legal && <button className="assist-button assist-secondary" onClick={() => setDialog("legal")}><Scale />법령과 민원 절차 보기</button>}<div className="assist-finish-card"><h2>종이에 적기 전에</h2><label><input type="checkbox" />내 상황에 맞는 정보를 적기</label><label><input type="checkbox" />모르는 내용은 기관에 물어보기</label><p>AI 설명이 서류의 작성·제출을 대신하지는 않아요.</p></div><button className="assist-button assist-primary" onClick={() => { leaveField(); setScreen("guide"); setDialog("fields"); }}><List />궁금한 칸 다시 보기</button><button className="assist-button assist-secondary" onClick={reset}>다른 서류로 시작하기</button></section>}
    </main>
    <input className="assist-file-input" ref={camera} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-label="카메라로 서류 촬영" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} /><input className="assist-file-input" ref={gallery} type="file" accept="image/*" tabIndex={-1} aria-label="서류 사진 선택" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
    {regionTarget !== undefined && photo && analysis && <RegionEditorDialog photo={photo} field={regionTarget ?? undefined} loading={regionBusy} error={regionError} onClose={() => { closeRegion(); if (selected && !guidance && !guideLoading) void loadGuide(selected); }} onSave={(selection) => void saveRegion(selection)} />}
    {dialog === "help" && <AssistantDialog title="이렇게 이용해 보세요" onClose={() => setDialog(null)} footer={<button className="assist-button assist-primary assist-full" onClick={() => setDialog(null)}>알겠어요</button>}><div className="assist-help-copy"><p>① 서류 사진을 골라요.</p><p>② 궁금한 칸을 골라요.</p><p>③ 설명과 예시를 넘겨 봐요.</p><p className="assist-transfer-note">사진을 OpenAI로 보내 분석해요. 실제 정보는 종이에 직접 적어 주세요.</p></div></AssistantDialog>}
    {dialog === "fields" && analysis && <FieldDialog fields={analysis.document.fields} selectedId={selected?.id} onSelect={(field) => void loadGuide(field)} onClose={() => setDialog(null)} />}
    {dialog === "legal" && analysis?.legal && <AssistantDialog title="법령과 민원 절차" onClose={() => setDialog(null)} footer={<button className="assist-button assist-primary assist-full" onClick={() => setDialog(null)}>알겠어요</button>}><LegalPanel legal={analysis.legal} formDescription={identity?.description} documentTitle={analysis.document.title} busy={legalBusy} error={legalError} onChooseCandidate={() => { setLegalError(undefined); setDialog("legal-candidates"); }} /></AssistantDialog>}
    {dialog === "legal-candidates" && analysis?.legal && <LegalCandidateDialog candidates={buildLegalViewModel(analysis.legal).candidates} currentId={analysis.legal.canonicalRule?.id} busy={legalBusy} error={legalError} onSelect={(candidateId) => void chooseLegalCandidate(candidateId)} onClose={() => setDialog("legal")} />}
    {dialog === "sources" && analysis && <SourceDialog mappingPending={analysis.mappingStatus === "in_progress"} search={analysis.search} sources={selected && guidance ? displaySources : undefined} onClose={() => setDialog(null)} />}
  </div></div>;
}
