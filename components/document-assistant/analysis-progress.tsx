"use client";

import type { Ref } from "react";
import { Check, FileText, Rows3, Search } from "lucide-react";
import type { DocumentIdentity } from "@/lib/documents/types";
import type { AssistantPhoto } from "./types";

export type AnalysisStage = "identifying" | "mapping" | "searching";

type Props = {
  photo: AssistantPhoto;
  stage: AnalysisStage;
  identity?: DocumentIdentity;
  confirmed?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onCancel: () => void;
};

const stageCopy: Record<AnalysisStage, { title: string; detail: string; photoLabel: string }> = {
  identifying: { title: "어떤 서류인지 살펴봐요", detail: "먼저 서류 이름과 내용을 읽고 있어요.", photoLabel: "서류 이름 읽는 중" },
  mapping: { title: "작성할 칸을 찾고 있어요", detail: "어디에 무엇을 쓰는지 살펴보고 있어요.", photoLabel: "작성할 칸 찾는 중" },
  searching: { title: "작성 안내를 찾고 있어요", detail: "같은 서류의 작성 안내를 확인하고 있어요.", photoLabel: "작성 안내 확인 중" },
};

export function AnalysisPhoto({ photo, label, active = true }: { photo: AssistantPhoto; label: string; active?: boolean }) {
  return <div className={`assist-analysis-photo${active ? " is-active" : ""}`}>
    <div className="assist-analysis-paper">
      <svg className="assist-analysis-photo-image" viewBox={`0 0 ${photo.width} ${photo.height}`} role="img" aria-label="선택한 서류 사진">
        <image href={photo.url} width={photo.width} height={photo.height} preserveAspectRatio="xMidYMid meet" />
      </svg>
      <div className="assist-analysis-scan" aria-hidden="true"><span /></div>
      <div className="assist-analysis-corners" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
    <span className="assist-analysis-photo-label"><FileText aria-hidden="true" />{label}</span>
  </div>;
}

export function AnalysisProgress({ photo, stage, identity, confirmed = false, headingRef, onCancel }: Props) {
  const copy = stageCopy[stage];
  return <section className="assist-analysis-progress">
    <div className="assist-analysis-heading">
      <span className="assist-analysis-eyebrow">{confirmed ? "서류 확인 완료" : "사진에서 차근차근"}</span>
      <h1 ref={headingRef} tabIndex={-1}>{copy.title}</h1>
      <p role="status" aria-live="polite" aria-atomic="true"><span key={stage} className="assist-analysis-stage-message">{copy.detail}</span></p>
    </div>
    <AnalysisPhoto photo={photo} label={copy.photoLabel} />
    {confirmed && identity && <p className="assist-analysis-confirmed"><Check aria-hidden="true" /><span>{identity.title}</span></p>}
    <ol className="assist-analysis-steps" aria-label="서류 안내 준비 과정">
      <li className={identity ? "is-complete" : stage === "identifying" ? "is-current" : ""} aria-current={stage === "identifying" ? "step" : undefined}>
        <span className="assist-analysis-step-icon">{identity ? <Check aria-hidden="true" /> : <FileText aria-hidden="true" />}</span>
        <span>서류 이름</span><small>{identity ? "읽었어요" : "읽고 있어요"}</small>
      </li>
      <li className={stage === "searching" ? "is-complete" : stage === "mapping" ? "is-current" : ""} aria-current={stage === "mapping" ? "step" : undefined}>
        <span className="assist-analysis-step-icon">{stage === "searching" ? <Check aria-hidden="true" /> : <Rows3 aria-hidden="true" />}</span>
        <span>작성할 칸</span><small>{stage === "searching" ? "찾았어요" : stage === "identifying" ? "이어서 살펴봐요" : "살펴보고 있어요"}</small>
      </li>
      <li className={stage === "searching" ? "is-current" : ""} aria-current={stage === "searching" ? "step" : undefined}>
        <span className="assist-analysis-step-icon"><Search aria-hidden="true" /></span>
        <span>작성 안내</span><small>{stage === "searching" ? "확인하고 있어요" : "함께 찾아봐요"}</small>
      </li>
    </ol>
    <button className="assist-button assist-secondary assist-analysis-cancel" onClick={onCancel}>그만하고 사진 확인</button>
  </section>;
}
