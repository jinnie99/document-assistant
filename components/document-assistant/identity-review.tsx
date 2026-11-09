"use client";

import type { Ref } from "react";
import { ArrowRight, Check, Rows3 } from "lucide-react";
import type { DocumentIdentity } from "@/lib/documents/types";
import { AnalysisPhoto } from "./analysis-progress";
import type { AssistantPhoto } from "./types";

type Props = {
  photo: AssistantPhoto;
  identity: DocumentIdentity;
  ready: boolean;
  searchPending?: boolean;
  mappingPending?: boolean;
  foundCount?: number;
  headingRef?: Ref<HTMLHeadingElement>;
  onConfirm: () => void;
  onBack: () => void;
};

export function IdentityReview({ photo, identity, ready, searchPending = false, mappingPending = false, foundCount = 0, headingRef, onConfirm, onBack }: Props) {
  return <section className="assist-identity-review">
    <div className="assist-identity-heading">
      <h1 ref={headingRef} tabIndex={-1}>이 서류가 맞나요?</h1>
      <p>먼저 이름과 내용을 확인해 주세요.</p>
    </div>
    <div className="assist-identity-copy">
      <div className="assist-identity-meta"><span>{photo.sample ? "예시 서류" : "사진에서 읽었어요"}</span>{identity.institution && <span title={identity.institution}>{identity.institution}</span>}</div>
      <h2 title={identity.title}>{identity.title || "제목을 확인하기 어려운 서류"}</h2>
      <p>{identity.description || "사진에서 읽은 서류예요. 이름이 맞는지 확인해 주세요."}</p>
    </div>
    <AnalysisPhoto photo={photo} label="선택한 서류 사진" active={!ready || mappingPending} />
    <div className={`assist-identity-status${ready ? " is-ready" : ""}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="assist-identity-status-icon">{ready ? <Check aria-hidden="true" /> : <Rows3 aria-hidden="true" />}</span>
      <div><p>{ready ? mappingPending ? `먼저 ${foundCount}칸이 준비됐어요` : "작성할 칸이 준비됐어요" : "작성할 칸을 찾고 있어요"}</p>{ready && (mappingPending ? <small>나머지 칸도 계속 찾고 있어요.</small> : searchPending ? <small>작성 안내도 함께 확인하고 있어요.</small> : null)}</div>
    </div>
    <div className="assist-identity-actions">
      <button className="assist-button assist-primary" onClick={onConfirm}>네, 이 서류예요<ArrowRight aria-hidden="true" /></button>
      <button className="assist-text-button" onClick={onBack}>다른 사진으로 확인할게요</button>
    </div>
  </section>;
}
