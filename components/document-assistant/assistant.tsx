"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { createI18n, I18nProvider, LOCALE_INFO, localizedError, useStoredLocale } from "./i18n";
import { ko, type Messages } from "./messages/ko";

type Screen = "home" | "preview" | "analyzing" | "review" | "mapping" | "guide" | "finish";
type Dialog = "help" | "fields" | "sources" | "legal" | "legal-candidates" | null;

function legalEntryLabel(legal: LegalContext, t: Messages) {
  const state = buildLegalViewModel(legal).state;
  if (state === "pending") return t.legalPending;
  if (state === "ambiguous") return t.legalAmbiguous;
  if (state === "completed") return t.legalCompleted;
  return t.legalUnavailable;
}

/** code는 서버 오류 코드이거나, 응답을 읽지 못했을 때의 "NETWORK"다. 화면에서 고른 언어의 문구로 바꾼다. */
class ApiRequestError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

/** 화면이 이미 고른 언어로 만든 안내 문구. 그대로 보여 준다. */
class UserError extends Error {}

const PHOTO_WARNING_KEYS = ["photoLowResolution", "photoDark", "photoBlurry"] as const;

function searchLabel(analysis: AnalysisResult, t: Messages) {
  if (analysis.mappingStatus === "in_progress") return t.searchPartial;
  if (analysis.search.status === "pending") return t.searchPending;
  if (analysis.search.status === "unavailable") return t.searchUnavailable;
  return analysis.search.case === "form_and_guide" ? t.searchFormAndGuide : analysis.search.case === "form_only" ? t.searchFormOnly : t.searchPhotoOnly;
}

async function requestJson<T>(url: string, body: unknown, signal: AbortSignal, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  let result: T | ApiError;
  try { result = await response.json(); } catch { throw new ApiRequestError(ko.errorNetwork, response.status, "NETWORK"); }
  if (!response.ok) {
    const error = result as ApiError;
    throw new ApiRequestError(error.error || ko.errorGeneric, response.status, typeof error.code === "string" ? error.code : undefined);
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
  const [locale, setLocale] = useStoredLocale();
  const [labels, setLabels] = useState<{ key: string; map: Record<string, string> }>({ key: "", map: {} });
  const labelKey = `${analysis?.id ?? ""}:${locale}`;
  const i18n = useMemo(() => createI18n(locale, labels.key === labelKey ? labels.map : {}), [locale, labels, labelKey]);
  const { t } = i18n;
  const explain = (problem: unknown, fallback: string) => {
    if (problem instanceof UserError) return problem.message;
    if (problem instanceof ApiRequestError && problem.status === 410) return t.errorExpired;
    if (problem instanceof ApiRequestError && problem.code === "NETWORK") return t.errorNetwork;
    return localizedError(i18n, problem, fallback);
  };
  const photoWarning = (text: string) => { const key = PHOTO_WARNING_KEYS.find(item => ko[item] === text); return key ? t[key] : text; };

  // 서류에 인쇄된 한국어 항목명을 고른 언어로 옮겨 받는다. 칸이 늘어날 때마다 새로 생긴 항목만 서버가 옮긴다.
  const analysisId = analysis?.id;
  const fieldSignature = analysis?.document.fields.map(field => field.id).join("|") ?? "";
  const mappingInProgress = analysis?.mappingStatus === "in_progress";
  const labelKeyRef = useRef(labelKey);
  useEffect(() => { labelKeyRef.current = labelKey; }, [labelKey]);
  useEffect(() => {
    if (locale === "ko" || !analysisId || !fieldSignature) return;
    const key = `${analysisId}:${locale}`;
    // 칸을 찾는 동안에는 목록이 계속 늘어나므로 조금 모았다가 한 번에 묻는다. 이미 보낸 요청은 끊지 않고 끝까지 받는다.
    const timer = setTimeout(() => {
      void fetch("/api/documents/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId, locale }), cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .then(result => {
          const map = result?.labels;
          if (!map || typeof map !== "object" || labelKeyRef.current !== key) return;
          const texts = Object.fromEntries(Object.entries(map).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
          setLabels(previous => ({ key, map: previous.key === key ? { ...previous.map, ...texts } : texts }));
        }).catch(() => {});
    }, mappingInProgress ? 1500 : 300);
    return () => clearTimeout(timer);
  }, [locale, analysisId, fieldSignature, mappingInProgress]);

  useEffect(() => { document.documentElement.lang = LOCALE_INFO[locale].lang; }, [locale]);

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
      if (file.size > 15 * 1024 * 1024) throw new UserError(t.fileTooBig);
      if (!file.type.startsWith("image/")) throw new UserError(t.fileNotImage);
      const result = await normalizeImage(file);
      if (token !== fileGeneration.current) { URL.revokeObjectURL(result.url); return; }
      keepPhoto({ url: result.url, dataUrl: result.dataUrl, width: result.w, height: result.h, warnings: result.warnings, name: file.name, sample });
      setPhotoVersion((version) => version + 1);
      discardAnalysis(analysis?.id); discardAnalysis(streamAnalysisId.current);
      streamAnalysisId.current = undefined; latestMapped.current = undefined; confirmedIdentity.current = false; setIdentity(undefined);
      setAnalysis(undefined); setSelected(undefined); setGuidance(undefined); setAnswersByField({}); setViewed(new Set()); guideCache.current.clear();
      setScreen("preview");
    } catch (problem) { if (token === fileGeneration.current) setError(problem instanceof UserError || (locale === "ko" && problem instanceof Error) ? problem.message : t.fileOpenFailed); }
    finally { if (token === fileGeneration.current) setPreparing(false); }
  };
  const prepareSample = async () => {
    const token = ++fileGeneration.current;
    setError(undefined); setPreparing(true);
    try { const file = await createSampleFile(); if (token === fileGeneration.current) await onFile(file, true); }
    catch { if (token === fileGeneration.current) { setPreparing(false); setError(t.sampleFailed); } }
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
      const response = await fetch("/api/documents/analyze", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ image: photo.dataUrl, locale }), signal: abort.signal, cache: "no-store" });
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
              setError(t.errorUnreadable); setScreen("preview");
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
      // 스트림이 끝났는데 칸 찾기가 진행 중으로 남아 있으면 확인 버튼이 계속 잠기지 않게 일부 완료로 정리한다.
      if (token === analysisGeneration.current && !abort.signal.aborted && mapped) {
        setAnalysis((current) => current?.id === mapped!.id && current.mappingStatus === "in_progress" ? { ...current, mappingStatus: "partial" } : current);
      }
    } catch (problem) {
      if (token !== analysisGeneration.current || abort.signal.aborted) return;
      if (mapped) {
        setAnalysis((current) => current?.id === mapped!.id ? { ...current, mappingStatus: current.mappingStatus === "in_progress" ? "partial" : current.mappingStatus, search: current.search.status === "pending" ? { status: "unavailable", case: "photo_only", summary: "검색 연결이 끊겨 사진으로 먼저 안내해요.", sources: [] } : current.search } : current);
      } else { setError(explain(problem, t.errorReadFailed)); setScreen("preview"); }
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
    const cacheKey = `${locale}:${analysis.search.status}:${field.id}:${JSON.stringify(nextAnswers)}`;
    const cached = !bypassCache && guideCache.current.get(cacheKey);
    if (cached) { setGuidance(cached); setGuideVersion((version) => version + 1); if (!cached.question) setViewed((previous) => new Set([...previous, field.id])); return; }
    const token = ++generation.current, abort = new AbortController(); controller.current = abort; setGuideLoading(true);
    try {
      const result = await requestJson<FieldGuidance>("/api/documents/guide", { analysisId: analysis.id, fieldId: field.id, answers: nextAnswers, locale }, abort.signal);
      if (token !== generation.current) return;
      guideCache.current.set(cacheKey, result); setGuidance(result); setGuideVersion((version) => version + 1);
      if (!result.question) setViewed((previous) => new Set([...previous, field.id]));
    } catch (problem) { if (token === generation.current && !abort.signal.aborted) { setGuideExpired(problem instanceof ApiRequestError && problem.status === 410); setGuideError(explain(problem, t.errorGuideFailed)); } }
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
      if (!target && !image) throw new UserError(t.regionReselect);
      const result = await requestJson<{ analysis: AnalysisResult; field: DocumentField }>("/api/documents/fields", { analysisId: analysis.id, ...(target ? { fieldId: target.id } : { image }), box }, abort.signal, target ? "PATCH" : "POST");
      if (abort.signal.aborted || token !== regionGeneration.current) return;
      latestMapped.current = mergeRegionAnalysis(latestMapped.current, result.analysis, result.field.id);
      setAnalysis((current) => mergeRegionAnalysis(current, result.analysis, result.field.id)); setError(undefined); guideCache.current.clear(); setAnswersByField({}); setViewed(new Set());
      setRegionTarget(undefined); setRegionBusy(false); setRegionError(undefined);
      void loadGuide(result.field, {}, true);
    } catch (problem) {
      if (abort.signal.aborted || token !== regionGeneration.current) return;
      if (problem instanceof ApiRequestError && problem.status === 410) { closeRegion(); recoverExpired(); setError(t.errorExpired); }
      else setRegionError(explain(problem, t.regionSaveFailed));
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
      setLegalError(explain(problem, t.legalChooseFailed));
    } finally { if (legalController.current === abort) { legalController.current = null; setLegalBusy(false); } }
  };
  const displaySources = guidance ? analysis?.search.sources.filter((source) => guidance.sourceIds.includes(source.id)) ?? [] : undefined;

  return <I18nProvider value={i18n}><div className="assist-shell"><div className={`assist-phone${large ? " assist-large" : ""}`} lang={LOCALE_INFO[locale].lang}>
    <header className="assist-header"><button className="assist-brand" onClick={reset} aria-label={t.brandHomeAria}><span><FileText /></span>{t.brand}</button><div><button className="assist-font-button" aria-label={large ? t.fontDefault : t.fontLarger} aria-pressed={large} onClick={() => setLarge(!large)}>{t.fontGlyph}</button><button className="assist-icon-button" aria-label={t.help} onClick={() => setDialog("help")}><HelpCircle /></button></div></header>
    <main className={`assist-main is-${screen}${selected && screen === "guide" ? " has-field" : ""}`}>
      {error && screen !== "analyzing" && <div className="assist-error" role="alert"><p>{error}</p><button className="assist-icon-button" aria-label={t.closeError} onClick={() => setError(undefined)}><X /></button></div>}
      {screen === "home" && <HomeScreen headingRef={title} preparing={preparing} configured={configured} onCamera={() => camera.current?.click()} onGallery={() => gallery.current?.click()} onSample={() => void prepareSample()} onLocale={setLocale} />}
      {screen === "preview" && photo && <section className="assist-preview"><div className="assist-screen-heading"><span>{t.previewEyebrow}</span><h1 ref={title} tabIndex={-1}>{t.previewTitle}</h1><p>{t.previewHint}</p></div><PhotoTools key={photoVersion} photo={photo} onChange={(next) => { if (currentPhoto.current?.url === photo.url) keepPhoto(next); else URL.revokeObjectURL(next.url); }} onError={setError} onBusyChange={setPhotoBusy} />{photo.warnings.length > 0 && <p className="assist-photo-warning">{photoWarning(photo.warnings[0])}</p>}{analysis && !analysis.document.fields.length && <button className="assist-text-button" disabled={photoBusy || preparing} onClick={() => openRegion()}>{t.previewPickManually}</button>}<p className="assist-transfer-note">{t.previewTransfer} {photo.sample ? t.previewSample : t.previewNoStore}</p><div className="assist-preview-actions"><button className="assist-button assist-secondary" disabled={photoBusy || preparing} onClick={() => gallery.current?.click()}>{t.previewReselect}</button><button className="assist-button assist-primary" disabled={photoBusy || preparing || configured === false} onClick={() => void analyze()}>{t.previewStart}<ArrowRight /></button></div></section>}
      {(screen === "analyzing" || screen === "mapping") && photo && <AnalysisProgress photo={photo} stage={screen === "mapping" ? "mapping" : analysisStage} identity={identity} confirmed={screen === "mapping"} headingRef={title} onCancel={backToPhoto} />}
      {screen === "review" && identity && photo && <IdentityReview photo={photo} identity={identity} ready={Boolean(analysis?.document.readable && analysis.document.fields.length)} searchPending={analysis?.search.status === "pending"} mappingPending={analysis?.mappingStatus === "in_progress"} foundCount={analysis?.document.fields.length ?? 0} headingRef={title} onConfirm={confirmDocument} onBack={backToPhoto} />}
      {screen === "guide" && analysis && photo && <section className={`assist-guide${selected ? " is-selected" : ""}`}><div className="assist-document-heading"><span title={analysis.document.title}>{analysis.mappingStatus === "in_progress" ? t.guidePartialTitle(analysis.document.fields.length) : analysis.document.title}</span><button className="assist-text-button" onClick={() => setDialog("fields")}><List />{t.guidePickFields}</button></div>{!selected && <><h1 className="assist-pick-title" ref={title} tabIndex={-1}>{t.guidePickTitle}</h1><button className="assist-search-summary" onClick={() => setDialog("sources")}><BookOpen /><span>{searchLabel(analysis, t)}</span><ArrowRight /></button>{analysis.legal && <button className="assist-search-summary assist-legal-entry" onClick={() => setDialog("legal")}><Scale /><span>{legalEntryLabel(analysis.legal, t)}</span><ArrowRight /></button>}<DocumentView photo={photo} fields={analysis.document.fields} onSelect={(field) => void loadGuide(field)} onAddField={() => openRegion()} /><p className="assist-pick-hint">{analysis.mappingStatus === "in_progress" ? t.guideHintPartial : analysis.document.warnings.some((warning) => /일부 확대|칸이 많아/.test(warning)) ? t.guideHintMissing : t.guideHintDefault}</p><div className="assist-guide-bottom"><button className="assist-text-button" onClick={() => setScreen("preview")}><ArrowLeft />{t.guideBackToPhoto}</button><button className="assist-text-button" onClick={() => setScreen("finish")}>{t.guideFinish}<Check /></button></div></>}{selected && <><FieldFocus photo={photo} field={selected} onEditRegion={() => openRegion(selected)} /><GuideCard key={`${analysis.id}-${selected.id}-${guideVersion}`} field={selected} guidance={guidance} loading={guideLoading} error={guideError} expired={guideExpired} large={large} hasPrevious={selectedIndex > 0} isLast={selectedIndex === analysis.document.fields.length - 1} moreFieldsPending={analysis.mappingStatus === "in_progress"} onClose={leaveField} onAnswer={(additional) => { const next = { ...(answersByField[selected.id] ?? {}), ...additional }; setAnswersByField((previous) => ({ ...previous, [selected.id]: next })); void loadGuide(selected, next); }} onRetry={() => guideExpired ? recoverExpired() : void loadGuide(selected, answersByField[selected.id] ?? {}, true)} onPreviousField={() => { const previous = analysis.document.fields[selectedIndex - 1]; if (previous) void loadGuide(previous); }} onNextField={() => { const next = analysis.document.fields[selectedIndex + 1]; if (next) void loadGuide(next); else { leaveField(); setScreen(analysis.mappingStatus === "in_progress" ? "guide" : "finish"); } }} onSources={() => setDialog("sources")} /></>}</section>}
      {screen === "finish" && <section className="assist-finish"><div className="assist-success"><Check /></div><div className="assist-screen-heading"><h1 ref={title} tabIndex={-1}>{t.finishTitle}</h1><p>{t.finishViewed(viewed.size)}</p></div>{analysis?.legal && <button className="assist-button assist-secondary" onClick={() => setDialog("legal")}><Scale />{t.finishLegal}</button>}<div className="assist-finish-card"><h2>{t.finishCardTitle}</h2><label><input type="checkbox" />{t.finishCheckOwn}</label><label><input type="checkbox" />{t.finishCheckAsk}</label><p>{t.finishNote}</p></div><button className="assist-button assist-primary" onClick={() => { leaveField(); setScreen("guide"); setDialog("fields"); }}><List />{t.finishReview}</button><button className="assist-button assist-secondary" onClick={reset}>{t.finishRestart}</button></section>}
    </main>
    <input className="assist-file-input" ref={camera} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-label={t.cameraInputAria} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} /><input className="assist-file-input" ref={gallery} type="file" accept="image/*" tabIndex={-1} aria-label={t.galleryInputAria} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
    {regionTarget !== undefined && photo && analysis && <RegionEditorDialog photo={photo} field={regionTarget ?? undefined} loading={regionBusy} error={regionError} onClose={() => { closeRegion(); if (selected && !guidance && !guideLoading) void loadGuide(selected); }} onSave={(selection) => void saveRegion(selection)} />}
    {dialog === "help" && <AssistantDialog title={t.helpTitle} onClose={() => setDialog(null)} footer={<button className="assist-button assist-primary assist-full" onClick={() => setDialog(null)}>{t.ok}</button>}><div className="assist-help-copy"><p>{t.helpStep1}</p><p>{t.helpStep2}</p><p>{t.helpStep3}</p><p className="assist-transfer-note">{t.helpNote}</p></div></AssistantDialog>}
    {dialog === "fields" && analysis && <FieldDialog fields={analysis.document.fields} selectedId={selected?.id} onSelect={(field) => void loadGuide(field)} onClose={() => setDialog(null)} />}
    {dialog === "legal" && analysis?.legal && <AssistantDialog title={t.legalTitle} onClose={() => setDialog(null)} footer={<button className="assist-button assist-primary assist-full" onClick={() => setDialog(null)}>{t.ok}</button>}>{t.koreanSourceNote && <p className="assist-language-note">{t.koreanSourceNote}</p>}<div lang="ko"><LegalPanel legal={analysis.legal} formDescription={identity?.description} documentTitle={analysis.document.title} busy={legalBusy} error={legalError} onChooseCandidate={() => { setLegalError(undefined); setDialog("legal-candidates"); }} /></div></AssistantDialog>}
    {dialog === "legal-candidates" && analysis?.legal && <LegalCandidateDialog candidates={buildLegalViewModel(analysis.legal).candidates} currentId={analysis.legal.canonicalRule?.id} busy={legalBusy} error={legalError} onSelect={(candidateId) => void chooseLegalCandidate(candidateId)} onClose={() => setDialog("legal")} />}
    {dialog === "sources" && analysis && <SourceDialog mappingPending={analysis.mappingStatus === "in_progress"} search={analysis.search} sources={selected && guidance ? displaySources : undefined} onClose={() => setDialog(null)} />}
  </div></div></I18nProvider>;
}
