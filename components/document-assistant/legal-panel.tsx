"use client";

import { AlertTriangle, BookOpen, ExternalLink, Scale } from "lucide-react";
import type { LegalContext } from "@/lib/legal/types";
import { buildLegalViewModel } from "@/lib/legal/view-model";

export function LegalPanel({ legal, busy = false, error, formDescription, documentTitle, onChooseCandidate, onRetry }: { legal?: LegalContext; busy?: boolean; error?: string; formDescription?: string; documentTitle?: string; onChooseCandidate: () => void; onRetry?: () => void }) {
  const model = buildLegalViewModel(legal, { documentTitle });
  if (model.state === "hidden") return null;
  const sourceById = new Map(model.sources.map(source => [source.id, source]));
  const summarySources = model.summarySourceIds.flatMap(id => sourceById.get(id) ?? []);

  return <section className="assist-legal" aria-labelledby="assist-legal-title" aria-busy={model.state === "pending" || busy}>
    <div className="assist-legal-heading">
      <Scale aria-hidden="true" />
      <div>
        <h2 id="assist-legal-title" tabIndex={-1}>{model.canonicalName || "법령·절차"}</h2>
        <p>{model.headline}</p>
      </div>
    </div>

    {model.formGuide && <div className="assist-legal-block assist-legal-form">
      <h3>이 서식 안내</h3>
      {formDescription && <p>{formDescription}</p>}
      <dl className="assist-legal-rows">
        <div><dt>근거</dt><dd>{model.canonicalName} {model.formGuide.formLabel}</dd></div>
        {model.formGuide.printedRevision && <div><dt>사진 속 개정</dt><dd>{model.formGuide.printedRevision}</dd></div>}
        <div><dt>{model.formGuide.differentForm && !model.formGuide.download ? "현행 같은 번호" : "현행 서식"}</dt><dd>{model.formGuide.currentRevision || model.formGuide.currentTitle ? [model.formGuide.currentRevision, model.formGuide.currentTitle].filter(Boolean).join(" · ") : "현행 목록에서 찾지 못했어요"}{model.formGuide.differentForm && !model.formGuide.download ? " (다른 서식)" : ""}</dd></div>
      </dl>
      {model.formGuide.download && <a className="assist-button assist-secondary assist-full" href={model.formGuide.download.url} target="_blank" rel="noopener noreferrer"><BookOpen aria-hidden="true" />{model.formGuide.download.label}<ExternalLink aria-hidden="true" /></a>}
      <ul className="assist-legal-list assist-legal-sources">{model.formGuide.articles.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer"><Scale aria-hidden="true" /><span>{item.heading}{item.note && <small className="assist-legal-note">{item.note}</small>}</span><ExternalLink aria-hidden="true" /></a></li>)}{model.formGuide.lawUrl && <li><a href={model.formGuide.lawUrl} target="_blank" rel="noopener noreferrer"><Scale aria-hidden="true" /><span>{model.canonicalName} 원문 보기{model.formGuide.articles.length ? "" : " (조문 목록)"}</span><ExternalLink aria-hidden="true" /></a></li>}</ul>
    </div>}

    {model.notices.map(notice => <p key={notice} className="assist-legal-notice" role="status"><AlertTriangle aria-hidden="true" />{notice}</p>)}
    {error && <p className="assist-legal-notice" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>}

    {model.state === "pending" && <p className="assist-small">사진 안내는 먼저 볼 수 있어요. 법령 정보는 확인되는 대로 여기에 나와요.</p>}

    {(model.state === "ambiguous") && <button className="assist-button assist-primary assist-full" disabled={busy} onClick={onChooseCandidate}>법령 골라 주기</button>}

    {model.state === "unavailable" && onRetry && <button className="assist-button assist-secondary assist-full" disabled={busy} onClick={onRetry}>다시 확인하기</button>}

    {model.state === "completed" && <>
      {model.candidates.length > 1 && <button className="assist-text-button" disabled={busy} onClick={onChooseCandidate}>다른 법령 고르기</button>}

      {model.hierarchy.length > 0 && <div className="assist-legal-block">
        <h3>법령 관계</h3>
        <dl className="assist-legal-rows">{model.hierarchy.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      </div>}

      {model.administrativeRules.length > 0 && <div className="assist-legal-block">
        <h3>관련 행정규칙</h3>
        <ul className="assist-legal-list">{model.administrativeRules.map(row => <li key={row.value}>{row.value}</li>)}</ul>
        {model.moreAdministrativeRules > 0 && <p className="assist-small">외 {model.moreAdministrativeRules}건은 법령 원문에서 확인할 수 있어요.</p>}
      </div>}

      {model.provisions.length > 0 && <div className="assist-legal-block">
        <h3>서류에 적힌 조문</h3>
        {model.provisions.map(item => <details key={item.id} className="assist-legal-provision"><summary>{item.heading}</summary><p>{item.text}</p></details>)}
      </div>}

      <div className="assist-legal-block">
        <h3>민원 절차</h3>
        {model.procedure
          ? <dl className="assist-legal-rows">{model.procedure.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          : <p className="assist-small">공식 절차 안내를 아직 찾지 못했어요. 접수처와 준비물은 소관 기관에 확인해 주세요.</p>}
      </div>

      <div className="assist-legal-block">
        <h3>소관 기관</h3>
        {model.office.length
          ? <dl className="assist-legal-rows">{model.office.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          : <p className="assist-small">소관 기관을 확인하지 못했어요. 서류에 적힌 기관이나 공식 안내에서 확인해 주세요.</p>}
        {model.contacts.length > 0 && <>
          <p className="assist-small">법령 연락 부서예요. 이 서식을 맡는 부서와 다를 수 있어요.</p>
          <ul className="assist-legal-list">{model.contacts.map(item => <li key={item.department}>{item.department} · {item.phone}</li>)}</ul>
        </>}
      </div>

      {model.summary && <div className="assist-legal-block">
        <h3>쉬운 설명</h3>
        <p>{model.summary}</p>
        {summarySources.length > 0 && <p className="assist-small">근거: {summarySources.map(source => source.title).join(", ")}</p>}
      </div>}

      {model.sources.length > 0 && <div className="assist-legal-block">
        <h3>근거 자료</h3>
        <ul className="assist-legal-list assist-legal-sources">{model.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer"><BookOpen aria-hidden="true" /><span>{source.label} · {source.title}</span><ExternalLink aria-hidden="true" /></a></li>)}</ul>
      </div>}
    </>}

    {model.queryTime && <p className="assist-small">{model.queryTime}</p>}
    <p className="assist-transfer-note">{model.disclaimer}</p>
  </section>;
}
