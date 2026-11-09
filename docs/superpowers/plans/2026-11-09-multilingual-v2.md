# Multilingual v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국어 기준 데이터를 유지하면서 영어·일본어·중국어 간체·필리핀어·베트남어 UI와 근거 보존형 동적 번역을 제공한다.

**Architecture:** 정적 UI는 완전한 로컬 사전과 React context로 즉시 전환한다. 동적 번역은 서버가 저장된 분석 세션의 한국어 기준 데이터만 읽어 OpenAI Structured Output으로 번역하고, 구조·숫자·조문·URL·출처 ID 검증을 통과한 결과만 캐시한다.

**Tech Stack:** React 19, TypeScript 5, Next.js 16 Route Handlers, OpenAI Responses API, browser localStorage

**Spec:** `docs/superpowers/specs/2026-11-09-document-assistant-v2-design.md`

## Global Constraints

- 언어 코드는 `ko`, `en`, `ja`, `zh-CN`, `fil`, `vi`로 고정한다.
- 한국어 법령명·기관명·조문번호·시행일·공식 URL은 번역 화면에도 함께 보존한다.
- 실제 기입값과 사진은 번역 요청에 포함하지 않는다.
- 원어민 검수 전 다섯 번역 언어에 `베타` 상태를 표시한다.
- 번역 실패 또는 불변값 검증 실패 시 한국어 원문으로 되돌아간다.
- `.git`이 없으므로 commit 대신 테스트 통과 체크포인트를 기록한다.

## Review Focus

- localStorage 값이 손상되거나 지원하지 않는 언어여도 한국어로 시작해야 한다. Task 1 테스트가 보장한다.
- 긴 베트남어·필리핀어 문구가 모바일 버튼을 잘라내지 않아야 한다. Task 3 수동 검수와 CSS가 보장한다.
- 번역 모델이 금액·날짜·조문·출처 ID를 바꾸면 결과 전체를 거부해야 한다. Task 2 테스트가 보장한다.
- 사용자가 언어를 연속 전환할 때 늦은 이전 응답이 현재 언어를 덮지 않아야 한다. Task 3 요청 세대 테스트가 보장한다.
- 후보 법령을 다시 선택하면 이전 법령 번역이 재사용되지 않아야 한다. Task 2 캐시 키 테스트가 보장한다.

---

### Task 1: 정적 번역 사전과 언어 상태

**Files:**
- Create: `lib/i18n/types.ts`
- Create: `lib/i18n/catalog.ts`
- Create: `lib/i18n/client.tsx`
- Test: `tests/documents/i18n-catalog.test.ts`
- Modify: `app/assist/page.tsx`

**Interfaces:**
- Produces: `Locale`, `SUPPORTED_LOCALES`, `TranslationKey`, `t(locale,key,params?)`, `LanguageProvider`, `useLanguage()`.

- [ ] **Step 1: Write failing catalog tests** asserting six locales have identical keys, no blank values, valid placeholders, beta metadata, and unsupported stored values fall back to `ko`.
- [ ] **Step 2: Implement the typed catalog** with complete Korean, English, Japanese, Simplified Chinese, Filipino, and Vietnamese UI strings.
- [ ] **Step 3: Implement `LanguageProvider`** with hydration-safe Korean default, validated localStorage persistence, and `<html lang>` synchronization after mount.
- [ ] **Step 4: Wrap `/assist` in the provider** without converting server-only modules to client components.
- [ ] **Step 5: Run focused tests, `npm run lint`, and `npx tsc --noEmit`** and record a green checkpoint.

### Task 2: 동적 번역, 불변값 검증, 세션 캐시

**Files:**
- Create: `lib/i18n/dynamic-types.ts`
- Create: `lib/i18n/translate.ts`
- Create: `app/api/documents/translate/route.ts`
- Test: `tests/documents/translation.test.ts`
- Test: `tests/documents/translation-route.test.ts`
- Modify: `lib/documents/store.ts`

**Interfaces:**
- Consumes: stored `AnalysisResult`, legal summary, and store version from Phase 1.
- Produces: `translateAnalysis(record, locale, signal)`, `validateTranslation(source,target)`, POST `/api/documents/translate`, per-session cache key `version:locale:contentHash`; the canonical payload includes document explanations, generated field guides currently stored in the session, legal summary, procedure, and warnings.

- [ ] **Step 1: Write failing validator tests** for exact object keys, source IDs, URLs, article numbers, dates, amounts, Korean canonical names, added/deleted items, and unsupported locale.
- [ ] **Step 2: Implement canonical payload construction and deterministic validation** before any translated value is returned.
- [ ] **Step 3: Write failing route/cache tests** for session expiry, Korean short-circuit, cache hit, locale separation, content hash separation, field edit invalidation, and legal candidate invalidation.
- [ ] **Step 4: Implement Structured Output translation and bounded per-session cache**; never accept client-provided source content, only `analysisId` and target locale.
- [ ] **Step 5: Add safe error codes and Korean fallback response metadata** without exposing provider text.
- [ ] **Step 6: Run focused tests and `npm test`** and record a green checkpoint.

### Task 3: 전체 화면 언어 전환

**Files:**
- Create: `components/document-assistant/language-selector.tsx`
- Create: `components/document-assistant/use-translated-analysis.ts`
- Modify: `components/document-assistant/assistant.tsx`
- Modify: `components/document-assistant/home-screen.tsx`
- Modify: `components/document-assistant/identity-review.tsx`
- Modify: `components/document-assistant/analysis-progress.tsx`
- Modify: `components/document-assistant/guide-card.tsx`
- Modify: `components/document-assistant/legal-panel.tsx`
- Modify: `app/assist/assistant.css`
- Test: `tests/documents/translation-client.test.ts`

**Interfaces:**
- Consumes: `useLanguage`, POST translation API.
- Produces: header language selector and race-safe translated analysis state with Korean fallback.

- [ ] **Step 1: Write failing client-state tests** for rapid locale changes, abort, stale response suppression, Korean reset, and failed translation fallback.
- [ ] **Step 2: Implement language selector** with native language labels, beta badges, keyboard operation, and persistent choice.
- [ ] **Step 3: Replace user-facing literals with typed catalog keys** across the active `/assist` path, dialogs, errors, accessibility labels, and finish screen.
- [ ] **Step 4: Implement dynamic translation loading** that reuses analysis/legal data, aborts obsolete requests, preserves Korean canonical legal text, and never restarts image analysis.
- [ ] **Step 5: Update CSS** for wrapping CJK and long Latin-script strings at 320 px width and large-text mode.
- [ ] **Step 6: Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build -- --webpack`** and manually inspect all six locales at mobile width.

### Task 4: 번역 검수 산출물

**Files:**
- Create: `docs/verification/multilingual-review.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed catalogs and translated views.
- Produces: language-by-language review checklist and clearly recorded beta/review status.

- [ ] **Step 1: Document every high-risk string group**: privacy, legal disclaimer, errors, submit/selection actions, dates, fees, and procedure labels.
- [ ] **Step 2: Record automated key/placeholder results and manual layout observations** for all five translated locales.
- [ ] **Step 3: Mark professional/native review as pending or completed per locale** without claiming unperformed review.
- [ ] **Step 4: Run the full verification suite** and record Phase 2 completion.
