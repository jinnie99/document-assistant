import test from "node:test";
import assert from "node:assert/strict";
import { documentConfirmationDestination, documentIdentityForReading, identityTitleChanged, mergeAnalysisFields, mergeAnalysisSearch, mergeRegionAnalysis } from "../../lib/documents/analysis-flow.ts";
import type { AnalysisResult, DocumentIdentity, DocumentReading } from "../../lib/documents/types.ts";

const document: DocumentReading = { title: "민원 상담 신청서", institution: "", formNumber: "", revision: "", readable: true, warnings: [], fields: [{ id: "name", label: "성명", printedHint: "신청인", confidence: .9, box: { x: .2, y: .2, width: .3, height: .05 } }] };
const identity: DocumentIdentity = { title: "민원상담 신청서", institution: "", formNumber: "", revision: "", readable: true, description: "민원 상담을 신청하는 서류로 보여요." };
const initial: AnalysisResult = { id: "session-one", document, expiresAt: "2099-01-01T00:00:00.000Z", search: { status: "pending", case: "photo_only", summary: "작성 안내를 찾고 있어요.", sources: [] } };

test("칸 준비와 확인 클릭이 겹쳐도 최신 결과로 안내에 진입하고 대기 화면에 갇히지 않는다", () => {
  assert.equal(documentConfirmationDestination(identity, undefined), "mapping");
  assert.equal(documentConfirmationDestination(identity, initial), "guide");
});

test("사용자가 확인한 뒤 읽힌 제목이 바뀌어도 다시 확인 화면을 열지 않는다", () => {
  assert.equal(documentConfirmationDestination(identity, { ...initial, document: { ...document, title: "출생신고서" } }), "guide");
});

test("판독 불가 결과 직전의 확인 클릭은 끝없는 대기 대신 사진 확인으로 돌아간다", () => {
  assert.equal(documentConfirmationDestination(identity, { ...initial, document: { ...document, readable: false, fields: [] } }), "preview");
});

test("설명 재사용 판단은 띄어쓰기 차이를 무시하고 다른 서류 이름을 구분한다", () => {
  assert.equal(identityTitleChanged(identity, document), false);
  assert.equal(identityTitleChanged(identity, { ...document, title: "출생신고서" }), true);
  assert.equal(identityTitleChanged(undefined, document), false);
});

test("빠른 설명은 같은 제목일 때만 유지하고 다른 제목의 용도를 옮기지 않는다", () => {
  assert.equal(documentIdentityForReading(document, identity).description, identity.description);
  const corrected = documentIdentityForReading({ ...document, title: "출생신고서" }, identity);
  assert.equal(corrected.title, "출생신고서");
  assert.notEqual(corrected.description, identity.description);
});

test("늦은 검색 완료가 수동 변경한 칸과 새 칸을 덮어쓰지 않는다", () => {
  const edited = { ...initial, document: { ...document, fields: [...document.fields.map(field => ({ ...field, box: { ...field.box, x: .4 } })), { ...document.fields[0], id: "manual_new" }] } };
  const searched: AnalysisResult = { ...initial, search: { status: "completed", case: "photo_only", summary: "사진으로 안내해요.", sources: [] } };
  const merged = mergeAnalysisSearch(edited, searched)!;
  assert.equal(merged.document.fields.length, 2);
  assert.equal(merged.document.fields[0].box.x, .4);
  assert.equal(merged.search.status, "completed");
  assert.equal(mergeAnalysisSearch(undefined, searched), undefined);
  assert.equal(mergeAnalysisSearch(edited, { ...searched, id: "other" }), edited);
});

test("늦은 영역 저장 응답의 pending 상태가 이미 끝난 검색 상태를 되돌리지 않는다", () => {
  const current: AnalysisResult = { ...initial, search: { ...initial.search, status: "completed" } };
  const regionResult = { ...initial, document: { ...document, fields: document.fields.map(field => ({ ...field, box: { ...field.box, y: .4 } })) } };
  const merged = mergeRegionAnalysis(current, regionResult);
  assert.equal(merged.search.status, "completed");
  assert.equal(merged.document.fields[0].box.y, .4);
  assert.equal(mergeRegionAnalysis(undefined, regionResult), regionResult);
});

test("부분 결과는 기존 선택 칸의 객체와 수동 좌표를 유지하고 새 칸만 추가한다", () => {
  const current: AnalysisResult = { ...initial, mappingStatus: "in_progress", document: { ...document, fields: document.fields.map(field => ({ ...field, box: { ...field.box, x: .4 } })) } };
  const next: AnalysisResult = { ...initial, mappingStatus: "in_progress", document: { ...document, fields: [{ ...document.fields[0], id: "address" }, ...document.fields] } };
  const merged = mergeAnalysisFields(current, next)!;
  assert.deepEqual(merged.document.fields.map(field => field.id), ["name", "address"]);
  assert.equal(merged.document.fields[0], current.document.fields[0]);
  assert.equal(merged.document.fields[0].box.x, .4);
  assert.equal(mergeAnalysisFields(undefined, next), undefined);
  assert.equal(mergeAnalysisFields(current, { ...next, id: "other" }), current);
});

test("늦은 부분 결과나 영역 응답이 완료 상태와 새 칸을 되돌리지 않는다", () => {
  const current: AnalysisResult = { ...initial, mappingStatus: "completed", search: { ...initial.search, status: "completed" }, document: { ...document, fields: [...document.fields, { ...document.fields[0], id: "late_found" }] } };
  const old: AnalysisResult = { ...initial, mappingStatus: "in_progress", document: { ...document, fields: document.fields.map(field => ({ ...field, box: { ...field.box, y: .4 } })) } };
  const refreshed = mergeAnalysisFields(current, old)!;
  assert.equal(refreshed.mappingStatus, "completed");
  assert.equal(refreshed.search.status, "completed");
  const edited = mergeRegionAnalysis(current, old, "name");
  assert.equal(edited.document.fields.length, 2);
  assert.equal(edited.document.fields[0].box.y, .4);
  assert.equal(edited.mappingStatus, "completed");
  assert.equal(edited.search.status, "completed");
});

test("최종 검색 응답도 먼저 보여준 칸을 유지하며 추가 칸과 분석 완료를 반영한다", () => {
  const current: AnalysisResult = { ...initial, mappingStatus: "in_progress" };
  const complete: AnalysisResult = { ...initial, mappingStatus: "completed", search: { ...initial.search, status: "completed" }, document: { ...document, fields: [...document.fields, { ...document.fields[0], id: "added" }] } };
  const merged = mergeAnalysisSearch(current, complete)!;
  assert.equal(merged.mappingStatus, "completed");
  assert.equal(merged.document.fields.length, 2);
  assert.equal(merged.document.fields[0], current.document.fields[0]);
});
