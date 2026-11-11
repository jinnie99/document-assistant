"use client";

import type { Ref } from "react";
import { Check, FileText, Rows3, Search } from "lucide-react";
import type { DocumentIdentity } from "@/lib/documents/types";
import type { AssistantPhoto } from "./types";
import { useI18n } from "./i18n";
import type { Messages } from "./messages/ko";

export type AnalysisStage = "identifying" | "mapping" | "searching";

type Props = {
  photo: AssistantPhoto;
  stage: AnalysisStage;
  identity?: DocumentIdentity;
  confirmed?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onCancel: () => void;
};

const stageCopy = (t: Messages): Record<AnalysisStage, { title: string; detail: string; photoLabel: string }> => ({
  identifying: { title: t.stageIdentifyingTitle, detail: t.stageIdentifyingDetail, photoLabel: t.stageIdentifyingPhoto },
  mapping: { title: t.stageMappingTitle, detail: t.stageMappingDetail, photoLabel: t.stageMappingPhoto },
  searching: { title: t.stageSearchingTitle, detail: t.stageSearchingDetail, photoLabel: t.stageSearchingPhoto },
});

export function AnalysisPhoto({ photo, label, active = true }: { photo: AssistantPhoto; label: string; active?: boolean }) {
  const { t } = useI18n();
  return <div className={`assist-analysis-photo${active ? " is-active" : ""}`}>
    <div className="assist-analysis-paper">
      <svg className="assist-analysis-photo-image" viewBox={`0 0 ${photo.width} ${photo.height}`} role="img" aria-label={t.photoAlt}>
        <image href={photo.url} width={photo.width} height={photo.height} preserveAspectRatio="xMidYMid meet" />
      </svg>
      <div className="assist-analysis-scan" aria-hidden="true"><span /></div>
      <div className="assist-analysis-corners" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
    <span className="assist-analysis-photo-label"><FileText aria-hidden="true" />{label}</span>
  </div>;
}

export function AnalysisProgress({ photo, stage, identity, confirmed = false, headingRef, onCancel }: Props) {
  const { t } = useI18n();
  const copy = stageCopy(t)[stage];
  return <section className="assist-analysis-progress">
    <div className="assist-analysis-heading">
      <span className="assist-analysis-eyebrow">{confirmed ? t.analysisConfirmed : t.analysisWorking}</span>
      <h1 ref={headingRef} tabIndex={-1}>{copy.title}</h1>
      <p role="status" aria-live="polite" aria-atomic="true"><span key={stage} className="assist-analysis-stage-message">{copy.detail}</span></p>
    </div>
    <AnalysisPhoto photo={photo} label={copy.photoLabel} />
    {confirmed && identity && <p className="assist-analysis-confirmed"><Check aria-hidden="true" /><span>{identity.title}</span></p>}
    <ol className="assist-analysis-steps" aria-label={t.analysisStepsAria}>
      <li className={identity ? "is-complete" : stage === "identifying" ? "is-current" : ""} aria-current={stage === "identifying" ? "step" : undefined}>
        <span className="assist-analysis-step-icon">{identity ? <Check aria-hidden="true" /> : <FileText aria-hidden="true" />}</span>
        <span>{t.stepName}</span><small>{identity ? t.stepNameDone : t.stepNameDoing}</small>
      </li>
      <li className={stage === "searching" ? "is-complete" : stage === "mapping" ? "is-current" : ""} aria-current={stage === "mapping" ? "step" : undefined}>
        <span className="assist-analysis-step-icon">{stage === "searching" ? <Check aria-hidden="true" /> : <Rows3 aria-hidden="true" />}</span>
        <span>{t.stepFields}</span><small>{stage === "searching" ? t.stepFieldsDone : stage === "identifying" ? t.stepFieldsNext : t.stepFieldsDoing}</small>
      </li>
      <li className={stage === "searching" ? "is-current" : ""} aria-current={stage === "searching" ? "step" : undefined}>
        <span className="assist-analysis-step-icon"><Search aria-hidden="true" /></span>
        <span>{t.stepGuide}</span><small>{stage === "searching" ? t.stepGuideDoing : t.stepGuideNext}</small>
      </li>
    </ol>
    <button className="assist-button assist-secondary assist-analysis-cancel" onClick={onCancel}>{t.analysisCancel}</button>
  </section>;
}
