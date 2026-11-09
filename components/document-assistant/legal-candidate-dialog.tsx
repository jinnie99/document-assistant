"use client";

import { useState } from "react";
import { AssistantDialog } from "./selection-dialog";
import type { LegalViewCandidate } from "@/lib/legal/view-model";

export function LegalCandidateDialog({ candidates, currentId, busy = false, error, onSelect, onClose }: { candidates: LegalViewCandidate[]; currentId?: string; busy?: boolean; error?: string; onSelect: (candidateId: string) => void; onClose: () => void }) {
  const [choice, setChoice] = useState<string | undefined>(currentId);
  const chosen = candidates.find(candidate => candidate.id === choice);
  return <AssistantDialog title="서류와 맞는 법령 고르기" onClose={onClose} footer={<button className="assist-button assist-primary assist-full" disabled={!chosen || busy || chosen.id === currentId} onClick={() => chosen && onSelect(chosen.id)}>{busy ? "법령을 확인하고 있어요" : "이 법령으로 보기"}</button>}>
    <p className="assist-small">서류 사진에 적힌 이름과 번호를 바탕으로 찾았어요. 맞는 것을 고르면 그 법령 기준으로 다시 보여드려요.</p>
    <fieldset className="assist-legal-choices" disabled={busy}>
      <legend className="assist-small">후보 목록</legend>
      {candidates.map(candidate => <label key={candidate.id} className={`assist-legal-choice${choice === candidate.id ? " is-selected" : ""}`}>
        <input type="radio" name="legal-candidate" value={candidate.id} checked={choice === candidate.id} onChange={() => setChoice(candidate.id)} />
        <span><strong>{candidate.name}</strong><small>{candidate.detail}</small></span>
      </label>)}
    </fieldset>
    {error && <p className="assist-legal-notice" role="alert">{error}</p>}
  </AssistantDialog>;
}
