# Recognition Accuracy and v2 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 체크박스·날짜·서명/날인 인식을 특화 재검증하고, 사진 품질과 확인 필요 상태를 사용자에게 보여 주며 v2 전체 회귀 기준을 통과한다.

**Architecture:** 첫 판독의 빠른 작성칸 스트림은 유지하고, 특수 작성 단위만 확대 영역의 두 번째 vision pass로 재검증한다. 결정적 검증기가 좌표·중복·종류·신뢰도를 합성해 잘못된 확정보다 `needs_review`를 선택하며, 기존 수동 영역 수정 흐름을 그대로 복구 수단으로 쓴다.

**Tech Stack:** TypeScript 5, Sharp 0.35, OpenAI vision Structured Output, Node test runner, existing benchmark scripts

**Spec:** `docs/superpowers/specs/2026-11-09-document-assistant-v2-design.md`

## Global Constraints

- field kind는 `text | checkbox_group | date | signature | stamp | number | unknown`이다.
- 서명/날인을 다른 사람 또는 다른 작성칸에 자동 배정하는 오류는 허용하지 않는다.
- 134개 기준표의 기존 통과 86건을 유지하고 `누락+오매핑` 13건을 3건 이하로 줄이는 것이 완료 게이트다.
- 체크박스·날짜·서명/날인은 범주별 최소 10표본에서 정밀도 95%, 재현율 90%를 목표로 하며 실제 표본 수를 함께 보고한다.
- `.git`이 없으므로 commit 대신 테스트 통과 체크포인트를 기록한다.

## Review Focus

- 체크 표시가 없는 선택지 묶음도 작성 대상 checkbox group으로 남아야 한다. Task 2 fixture 테스트가 보장한다.
- 인쇄된 날짜와 사용자가 적을 날짜 칸을 혼동하지 않아야 한다. Task 2 role 테스트가 보장한다.
- 같은 셀의 성명·서명을 중복 필드로 만들거나 서로 다른 사람에게 합치지 않아야 한다. Task 2 merge 테스트가 보장한다.
- 흐리거나 잘린 특수 칸은 고신뢰도 자동 확정 대신 `needs_review`가 되어야 한다. Task 1 validator 테스트가 보장한다.
- 추가 vision pass 실패가 기존에 찾은 일반 텍스트 필드를 없애지 않아야 한다. Task 2 통합 테스트가 보장한다.

---

### Task 1: 필드 종류·사진 품질·확인 상태 계약

**Files:**
- Create: `lib/documents/special-fields.ts`
- Test: `tests/documents/special-fields.test.ts`
- Modify: `lib/documents/types.ts`
- Modify: `lib/documents/schemas.ts`
- Modify: `lib/documents/validation.ts`
- Modify: `lib/documents/analysis-stream-client.ts`

**Interfaces:**
- Produces: `FieldKind`, `FieldReviewStatus`, optional `DocumentField.kind/reviewStatus`, `PhotoQuality`, `validateSpecialField(candidate, context)`.

- [ ] **Step 1: Write failing validation tests** for all seven kinds, legacy payload defaults, invalid enums, ambiguous signature ownership, low confidence, out-of-bounds geometry, and duplicate candidates.
- [ ] **Step 2: Extend schemas and parsers backward-compatibly** so absent kind becomes `unknown` and absent review status derives from confidence without rejecting old streams.
- [ ] **Step 3: Implement deterministic special-field validation** with `confirmed | needs_review` and no ownership inference from label similarity alone.
- [ ] **Step 4: Add bounded photo-quality fields** for blur, glare, crop, perspective, and readable warning copy.
- [ ] **Step 5: Run focused tests and `npm test`** and record a green checkpoint.

### Task 2: 특수 작성 단위 확대 재판독과 병합

**Files:**
- Create: `lib/documents/special-field-detection.ts`
- Test: `tests/documents/special-field-detection.test.ts`
- Modify: `lib/documents/openai.ts`
- Modify: `lib/documents/field-detection.ts`
- Modify: `lib/documents/analysis-pipeline.ts`

**Interfaces:**
- Consumes: initial `DocumentReading`, image, special-field validator from Task 1.
- Produces: `detectSpecialFields(image, reading, signal, onProgress?)` and `mergeSpecialFields(base,candidates)`.

- [ ] **Step 1: Add fixture-driven failing tests** for empty checkbox groups, writable versus printed dates, separate signer rows, combined name/signature cells, stamps, clipped regions, and second-pass failure.
- [ ] **Step 2: Implement candidate region planning** from first-pass hints, table geometry, and bottom/signature areas with strict crop and concurrency limits.
- [ ] **Step 3: Implement special-field Structured Output requests** that return kind, role text, bounds, confidence, and review reason without returning filled personal values.
- [ ] **Step 4: Implement geometry-aware merge** preserving existing IDs/manual edits, removing semantic/IoU duplicates, and retaining uncertain candidates as reviewable rather than confirmed.
- [ ] **Step 5: Publish merged fields progressively** without delaying the first mapped event and without making special-pass failure fatal.
- [ ] **Step 6: Run focused tests, pipeline tests, and `npm test`** and record a green checkpoint.

### Task 3: 품질 및 확인 필요 UI

**Files:**
- Create: `components/document-assistant/photo-quality-card.tsx`
- Modify: `components/document-assistant/document-view.tsx`
- Modify: `components/document-assistant/identity-review.tsx`
- Modify: `components/document-assistant/analysis-progress.tsx`
- Modify: `components/document-assistant/assistant.tsx`
- Modify: `app/assist/assistant.css`
- Modify: `lib/i18n/catalog.ts`
- Test: `tests/documents/recognition-view-model.test.ts`

**Interfaces:**
- Consumes: `PhotoQuality`, `kind`, and `reviewStatus`.
- Produces: localized quality warnings, special-field badges, review queue, and manual-region correction entry points.

- [ ] **Step 1: Write failing view-model tests** for clean photo, retake-required photo, mixed confirmed/review fields, signature warning, and all-viewed completion count.
- [ ] **Step 2: Show photo quality before analysis confirmation** with one primary corrective action and accessible warning semantics.
- [ ] **Step 3: Distinguish special and `needs_review` overlays** without relying on color alone; selecting one opens the existing region editor and guide flow.
- [ ] **Step 4: Track viewed, unviewed, and review-needed counts** on guide and finish screens in all six locales.
- [ ] **Step 5: Run UI-adjacent tests, lint, typecheck, and mobile manual inspection** and record a green checkpoint.

### Task 4: 기준표 확대, 전체 검증, 매뉴얼 갱신

**Files:**
- Create: `tests/fixtures/special-fields/README.md`
- Modify: `scripts/full-field-audit-validation.ts`
- Modify: `docs/verification/baseline-full-matrix.md`
- Create: `docs/verification/v2-recognition-report.md`
- Modify: `docs/KNOWN_ISSUES.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed v2 implementation and approved non-personal fixtures.
- Produces: reproducible metrics/report for the 134-unit regression and category-specific precision/recall.

- [ ] **Step 1: Add at least 10 labeled non-personal samples per special category** or explicitly record the lower available count; keep fixtures synthetic or redacted.
- [ ] **Step 2: Extend the benchmark script** to report TP/FP/FN, precision, recall, missing, wrong mapping, partial, and preserved baseline passes by category.
- [ ] **Step 3: Run the 134-unit audit** and verify 86 prior passes remain and missing+wrong mapping is at most 3; if not, keep the task open and record exact failures.
- [ ] **Step 4: Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build -- --webpack`** and preserve command output summaries.
- [ ] **Step 5: Perform one opt-in live API smoke test** with the configured law credential, verifying no credential appears in browser/network-visible payloads or logs.
- [ ] **Step 6: Update the user manual and known issues** with 법령 후보 선택, 출처, 다국어 beta, 사진 품질, 확인 필요, and current limitations; record Phase 3 completion.

