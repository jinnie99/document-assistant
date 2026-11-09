# Legal and Procedure v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사진에서 읽은 행정규칙·법령 단서를 국가법령정보센터 정본으로 역조회하고, 확인된 3단 법령 관계와 공식 민원 절차를 출처와 함께 제공한다.

**Architecture:** 법령 기능은 `lib/legal`의 서버 전용 모듈로 격리한다. 분석 스트림은 작성칸을 먼저 발행한 뒤 법령 조회 상태를 별도 이벤트로 전달하고, `AnalysisStore`가 후보 선택과 상세 결과의 단일 진실 원천이 된다. OpenAI는 사진의 법령 단서 추출과 정본 근거의 요약에만 사용한다.

**Tech Stack:** Next.js 16.4.3 App Router Route Handlers, TypeScript 5, Node test runner, OpenAI Responses API, 국가법령정보센터 Open API

**Spec:** `docs/superpowers/specs/2026-11-09-document-assistant-v2-design.md`

## Global Constraints

- `LAW_OPEN_API_OC`는 서버 환경 변수로만 읽고 URL, 로그, 오류, 클라이언트 번들에 노출하지 않는다.
- 행정규칙을 시행규칙으로 간주하지 않으며 API 관계가 확인될 때만 법률·시행령·시행규칙을 연결한다.
- 사진과 기입 개인정보는 국가법령정보 API나 웹 검색에 보내지 않는다.
- 법령 목록 캐시는 6시간, 상세 캐시는 24시간, 장애용 stale 보존은 최대 7일이다.
- 공식 절차 근거가 없으면 절차 값을 생성하지 않는다.
- 현재 작업 공간에는 `.git` 메타데이터가 없으므로 각 task의 commit 단계는 테스트 통과 체크포인트로 기록하고 저장소를 임의로 초기화하지 않는다.

## Review Focus

- 동명의 현행·폐지 규칙이 함께 반환되면 자동 확정하지 않고 구별 가능한 후보를 제공해야 한다. Task 2 후보 점수 테스트가 보장한다.
- 행정규칙 검색 결과를 시행규칙 슬롯에 넣지 않아야 한다. Task 2 계층 정규화 테스트가 보장한다.
- API 인증값이나 upstream 본문이 오류 응답에 포함되지 않아야 한다. Task 1 오류 테스트가 보장한다.
- 법령 조회가 느리거나 실패해도 첫 작성칸과 기존 검색 안내가 계속 동작해야 한다. Task 3 스트림 통합 테스트가 보장한다.
- 공식 검색 URL이 사설 IP·리다이렉트·비허용 도메인으로 바뀌면 본문을 가져오지 않아야 한다. Task 4 URL 정책 테스트가 보장한다.

---

### Task 1: 국가법령정보 API 계약과 stale 캐시

**Files:**
- Create: `.env.example`
- Create: `lib/legal/types.ts`
- Create: `lib/legal/cache.ts`
- Create: `lib/legal/client.ts`
- Test: `tests/documents/legal-cache.test.ts`
- Test: `tests/documents/legal-client.test.ts`
- Modify: `app/api/documents/status/route.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `LegalApiClient`, `createLegalApiClient({ oc, fetch, now })`, `StaleCache<K,V>`, `LegalCandidate`, `LegalSource`, `LegalContext`.
- `LegalApiClient` exposes `search(reference, signal)`, `fetchBody(candidate, signal)`, `fetchHierarchy(candidate, signal)`, and `fetchThreeTier(candidate, signal)`.

- [ ] **Step 1: Write failing cache tests** for fresh hit, expired miss, seven-day stale fallback, stale rejection after seven days, and capacity eviction.
- [ ] **Step 2: Run `node --experimental-strip-types --test tests/documents/legal-cache.test.ts`** and verify missing-module failure.
- [ ] **Step 3: Implement `StaleCache<K,V>`** with injected clock, `getFresh`, `getStale`, and `set`; use 6h/24h TTL at the client call site and `604800000` ms stale retention.
- [ ] **Step 4: Write failing client tests** asserting `type=JSON`, encoded query values, abort/timeout behavior, maximum response rejection, normalized candidates, and absence of `oc`/upstream body in thrown errors.
- [ ] **Step 5: Implement `createLegalApiClient`** using server-only environment input, `cache: "no-store"`, explicit timeout, 2 MB response limit, and safe `LegalApiError` codes.
- [ ] **Step 6: Add `.env.example` placeholders** for `OPENAI_API_KEY`, `OPENAI_MODEL`, and `LAW_OPEN_API_OC`; return separate `aiConfigured` and `lawConfigured` flags while retaining the existing `configured` alias for the current client, without returning values.
- [ ] **Step 7: Run the two focused tests plus `npm test`** and record a green checkpoint.

### Task 2: 법령 단서 추출과 정본 역조회

**Files:**
- Create: `lib/legal/reference-schema.ts`
- Create: `lib/legal/resolver.ts`
- Test: `tests/documents/legal-references.test.ts`
- Test: `tests/documents/legal-resolver.test.ts`
- Modify: `lib/documents/openai.ts`
- Modify: `lib/documents/schemas.ts`

**Interfaces:**
- Consumes: `LegalApiClient`, `LegalCandidate` from Task 1.
- Produces: `LegalReferenceHints`, `readLegalReferences(image, signal)`, `resolveLegalContext(hints, client, signal)` returning `LegalResolution` with `status: completed | ambiguous | not_found | unavailable`.

- [ ] **Step 1: Write failing parser tests** that accept only bounded printed names, rule numbers, form numbers, institutions, and dates and reject free-form instructions or personal values.
- [ ] **Step 2: Add `LEGAL_REFERENCE_SCHEMA` and `readLegalReferences`** as a separate structured vision request; do not widen `DocumentReading` or delay field streaming.
- [ ] **Step 3: Write failing resolver tests** for unique exact match, multi-candidate ambiguity, authority/number/date ranking, current-versus-repealed conflict, and no-result behavior.
- [ ] **Step 4: Implement `scoreLegalCandidates` and `resolveLegalContext`**; auto-select only a unique top candidate above the fixed confidence threshold and expose selection-safe candidate metadata otherwise.
- [ ] **Step 5: Add hierarchy/detail tests** proving administrative rules remain in `administrativeRules`, three-tier results fill only `act/decree/rule`, body/related provisions/forms/authority/effective date retain source IDs, and missing relations stay empty.
- [ ] **Step 6: Run both focused tests and `npm test`** and record a green checkpoint.

### Task 3: 분석 세션, 법령 상태 API, 점진 이벤트

**Files:**
- Create: `app/api/documents/legal/route.ts`
- Test: `tests/documents/legal-route.test.ts`
- Modify: `lib/documents/types.ts`
- Modify: `lib/documents/store.ts`
- Modify: `lib/documents/analysis-pipeline.ts`
- Modify: `lib/documents/analysis-stream-client.ts`
- Modify: `tests/documents/store.test.ts`
- Modify: `tests/documents/analysis-pipeline.test.ts`
- Modify: `tests/documents/analysis-stream-client.test.ts`

**Interfaces:**
- Consumes: `readLegalReferences`, `resolveLegalContext` from Task 2.
- Produces: `AnalysisResult.legal`, legal stream events (`legal_started`, `legal_reference`, `legal_complete`, `legal_unavailable`), `AnalysisStore.updateLegal`, `AnalysisStore.selectLegalCandidate`, GET/PATCH `/api/documents/legal`.

- [ ] **Step 1: Extend failing store tests** for legal state updates, ambiguous selection, invalid candidate rejection, session expiry, and version/cache invalidation after selection.
- [ ] **Step 2: Add legal state to types and store** while preserving existing field edits, guide caches, TTL, and capacity behavior.
- [ ] **Step 3: Extend failing pipeline tests** to prove mapped fields arrive before legal completion, legal failure is nonfatal, disconnect aborts legal work, and late results cannot revive deleted sessions.
- [ ] **Step 4: Start legal work after the first stable mapped analysis** and emit bounded NDJSON events without changing the terminal search semantics.
- [ ] **Step 5: Extend the stream parser** with strict runtime validation for every new event and a maximum candidate/source count.
- [ ] **Step 6: Implement GET/PATCH route tests and handlers**; PATCH accepts only `{analysisId,candidateId}`, performs server-side membership validation, refreshes detail, and never accepts a client-supplied URL.
- [ ] **Step 7: Run focused store/pipeline/route/client tests and `npm test`** and record a green checkpoint.

### Task 4: 공식 절차 근거와 OpenAI 근거 제한 요약

**Files:**
- Create: `lib/legal/official-url.ts`
- Create: `lib/legal/procedure.ts`
- Create: `lib/legal/summary.ts`
- Test: `tests/documents/official-url.test.ts`
- Test: `tests/documents/legal-summary.test.ts`
- Modify: `lib/documents/openai.ts`
- Modify: `lib/documents/schemas.ts`

**Interfaces:**
- Consumes: completed `LegalContext` from Task 3.
- Produces: `discoverOfficialProcedureSources(query, signal)`, `fetchOfficialEvidence(url, dependencies, signal)`, `summarizeLegalContext(context, evidence, signal)` returning source-ID-bound `LegalSummary` and `ProcedureInfo`.

- [ ] **Step 1: Write failing URL-policy tests** for HTTPS, allowed government domains, verified public-institution allowlist, credentials, ports, redirects, DNS rebinding, loopback/private/link-local IPs, timeout, content type, and 1 MB HTML cap.
- [ ] **Step 2: Implement URL validation and bounded HTML text extraction**; PDF and non-HTML results remain link-only metadata.
- [ ] **Step 3: Write failing source-discovery tests** proving the search input contains only canonical law/rule name, authority, and form number; returned URLs must pass the official-domain policy before fetch.
- [ ] **Step 4: Implement official source discovery** with OpenAI web search restricted to government/verified-public domains, then revalidate every URL server-side before fetching.
- [ ] **Step 5: Write failing summary validation tests** requiring every nonempty item to cite an existing source ID and preserving Korean law names, article numbers, dates, fees, and official URLs.
- [ ] **Step 6: Implement structured Korean summary generation** with empty fallback for unsupported procedure fields and a deterministic validator that discards unsupported statements.
- [ ] **Step 7: Connect summary enrichment to selected legal context** without sending image bytes or personal field values to search/summary calls.
- [ ] **Step 8: Run focused security/summary tests and `npm test`** and record a green checkpoint.

### Task 5: 법령·절차 사용자 화면

**Files:**
- Create: `components/document-assistant/legal-panel.tsx`
- Create: `components/document-assistant/legal-candidate-dialog.tsx`
- Test: `tests/documents/legal-view-model.test.ts`
- Create: `lib/legal/view-model.ts`
- Modify: `components/document-assistant/assistant.tsx`
- Modify: `app/assist/assistant.css`

**Interfaces:**
- Consumes: `AnalysisResult.legal` and GET/PATCH legal API from Task 3.
- Produces: accessible legal/procedure panel, candidate selection dialog, source links, freshness and mismatch warnings.

- [ ] **Step 1: Write failing view-model tests** for pending, ambiguous, completed, stale, old-form mismatch, no-three-tier, and official-procedure-missing states.
- [ ] **Step 2: Implement pure `buildLegalViewModel(context)`** so UI copy and visibility rules do not depend on JSX branches.
- [ ] **Step 3: Add the legal panel** to review/guide/finish flows with Korean canonical names, hierarchy, procedures, sources, query time, disclaimer, and retry-safe loading states.
- [ ] **Step 4: Add candidate selection dialog** displaying kind, authority, number, effective date, and current status; selection calls PATCH and replaces only legal-derived state.
- [ ] **Step 5: Add responsive and keyboard-visible styling** and keep existing field-guide interactions unchanged.
- [ ] **Step 6: Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build -- --webpack`** and record Phase 1 completion.
