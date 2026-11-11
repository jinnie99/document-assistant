"use client";

import type { Ref } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { DocumentIdentity } from "@/lib/documents/types";
import { AnalysisPhoto } from "./analysis-progress";
import type { AssistantPhoto } from "./types";
import { READING_IDENTITY_DESCRIPTION } from "@/lib/documents/analysis-flow";
import { useI18n } from "./i18n";

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
  const { t } = useI18n();
  // 칸 인식이 모두 끝나야 완료로 보고 다음 단계로 넘어갈 수 있게 한다.
  const done = ready && !mappingPending;
  const description = identity.description && identity.description !== READING_IDENTITY_DESCRIPTION ? identity.description : t.reviewDescriptionFallback;
  return <section className="assist-identity-review">
    <div className="assist-identity-heading">
      <h1 ref={headingRef} tabIndex={-1}>{t.reviewTitle}</h1>
      <p>{t.reviewHint}</p>
    </div>
    <div className="assist-identity-copy">
      <div className="assist-identity-meta"><span>{photo.sample ? t.reviewSample : t.reviewFromPhoto}</span>{identity.institution && <span title={identity.institution}>{identity.institution}</span>}</div>
      <h2 title={identity.title}>{identity.title || t.reviewUntitled}</h2>
      <p>{description}</p>
    </div>
    <AnalysisPhoto photo={photo} label={t.photoAlt} active={!done} />
    <div className={`assist-identity-status${done ? " is-ready" : " is-working"}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="assist-identity-status-icon">{done ? <Check aria-hidden="true" /> : <LoaderCircle className="assist-spin" aria-hidden="true" />}</span>
      <div><p>{done ? t.reviewReady : foundCount > 0 ? t.reviewPartial(foundCount) : t.reviewFinding}</p>{!done && foundCount > 0 ? <small>{t.reviewMoreFields}</small> : done && searchPending ? <small>{t.reviewSearching}</small> : null}</div>
    </div>
    <div className="assist-identity-actions">
      {!done && <p id="assist-identity-confirm-wait" className="assist-identity-wait">{t.reviewConfirmWaiting}</p>}
      <button className="assist-button assist-primary" onClick={onConfirm} disabled={!done} aria-describedby={done ? undefined : "assist-identity-confirm-wait"}>{t.reviewConfirm}<ArrowRight aria-hidden="true" /></button>
      <button className="assist-text-button" onClick={onBack}>{t.reviewBack}</button>
    </div>
  </section>;
}
