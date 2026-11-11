"use client";

import { useState } from "react";
import { AssistantDialog } from "./selection-dialog";
import type { LegalViewCandidate } from "@/lib/legal/view-model";
import { useI18n } from "./i18n";

export function LegalCandidateDialog({ candidates, currentId, busy = false, error, onSelect, onClose }: { candidates: LegalViewCandidate[]; currentId?: string; busy?: boolean; error?: string; onSelect: (candidateId: string) => void; onClose: () => void }) {
  const [choice, setChoice] = useState<string | undefined>(currentId);
  const chosen = candidates.find(candidate => candidate.id === choice);
  const { t } = useI18n();
  return <AssistantDialog title={t.legalCandidatesTitle} onClose={onClose} footer={<button className="assist-button assist-primary assist-full" disabled={!chosen || busy || chosen.id === currentId} onClick={() => chosen && onSelect(chosen.id)}>{busy ? t.legalCandidatesBusy : t.legalCandidatesSelect}</button>}>
    <p className="assist-small">{t.legalCandidatesHint}</p>
    <fieldset className="assist-legal-choices" disabled={busy}>
      <legend className="assist-small">{t.legalCandidatesLegend}</legend>
      {candidates.map(candidate => <label key={candidate.id} className={`assist-legal-choice${choice === candidate.id ? " is-selected" : ""}`}>
        <input type="radio" name="legal-candidate" value={candidate.id} checked={choice === candidate.id} onChange={() => setChoice(candidate.id)} />
        <span lang="ko"><strong>{candidate.name}</strong><small>{candidate.detail}</small></span>
      </label>)}
    </fieldset>
    {error && <p className="assist-legal-notice" role="alert">{error}</p>}
  </AssistantDialog>;
}
