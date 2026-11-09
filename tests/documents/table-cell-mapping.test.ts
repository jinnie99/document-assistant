import test from "node:test";
import assert from "node:assert/strict";
import { matchFieldToCell, parseCellField, cellsInRegion } from "../../lib/documents/table-cell-mapping.ts";
import type { DocumentField } from "../../lib/documents/types.ts";

const cells = [
  { id: "cell_1", box: { x: .1, y: .2, width: .2, height: .05 }, confidence: 1 },
  { id: "cell_2", box: { x: .3, y: .2, width: .6, height: .05 }, confidence: 1 },
  { id: "cell_3", box: { x: .3, y: .25, width: .6, height: .05 }, confidence: 1 },
];
const field: DocumentField = { id: "name", label: "신청인 성명", printedHint: "신청인", confidence: .95, box: { x: .12, y: .21, width: .1, height: .02 } };

test("선택된 셀 ID가 있으면 글자 주위의 잘못된 좌표 대신 실제 기입 셀 전체를 사용한다", () => {
  const result = matchFieldToCell(field, cells, "cell_2");
  assert.deepEqual(result.box, cells[1].box);
  assert.equal(result.id, field.id);
  assert.equal(result.label, field.label);
  assert.deepEqual(field.box, { x: .12, y: .21, width: .1, height: .02 });
});

test("같은 이름의 다음 행을 임의로 선택하지 않고 알려진 ID만 연결한다", () => {
  assert.deepEqual(matchFieldToCell(field, cells, "cell_3").box, cells[2].box);
  assert.deepEqual(matchFieldToCell(field, cells, "cell_missing").box, field.box);
});

test("셀을 지정하지 않은 기입 영역은 가장 많이 겹치는 하나의 셀 경계로 맞춘다", () => {
  const approx = { ...field, box: { x: .31, y: .205, width: .57, height: .04 } };
  assert.deepEqual(matchFieldToCell(approx, cells).box, cells[1].box);
});

test("행 사이에 걸쳐 있어 모호한 영역은 옆 행으로 강제로 옮기지 않는다", () => {
  const ambiguous = { ...field, box: { x: .31, y: .23, width: .57, height: .04 } };
  assert.deepEqual(matchFieldToCell(ambiguous, cells).box, ambiguous.box);
});

test("작은 체크박스와 표 밖의 서명란은 큰 병합 셀로 늘리지 않는다", () => {
  for (const box of [{ x: .35, y: .21, width: .012, height: .012 }, { x: .1, y: .8, width: .3, height: .04 }]) {
    assert.deepEqual(matchFieldToCell({ ...field, box }, cells).box, box);
  }
});

test("AI 내부 셀 선택 정보는 공개 항목에서 제거하고 나머지 응답은 엄격하게 검증한다", () => {
  const result = parseCellField({ ...field, cellId: "cell_2" }, cells);
  assert.deepEqual(result, { ...field, box: cells[1].box });
  assert.ok(!Object.hasOwn(result, "cellId"));
  assert.throws(() => parseCellField({ ...field, cellId: 2 }, cells));
  assert.throws(() => parseCellField({ ...field, cellId: "cell_2", extra: "bad" }, cells));
});

test("검출한 셀이 없거나 레거시 응답이면 원래 좌표를 사용한다", () => {
  assert.deepEqual(parseCellField(field, []), field);
  assert.deepEqual(parseCellField({ ...field, cellId: "" }, []), field);
});

test("AI가 셀 전체가 아니라 일부 작성칸이라고 명시하면 병합 셀로 확대하지 않는다", () => {
  const partial = { ...field, box: { x: .31, y: .205, width: .4, height: .04 } };
  assert.deepEqual(parseCellField({ ...partial, cellId: "" }, cells).box, partial.box);
});

test("확대 판독에는 완전히 포함된 셀만 전달하고 원본 ID와 부분 좌표를 유지한다", () => {
  const region = { x: 0, y: .22, width: 1, height: .5 };
  const cropped = cellsInRegion(cells, region);
  assert.equal(cropped.length, 1);
  assert.equal(cropped[0].id, "cell_3");
  assert.deepEqual(cropped[0].box, { x: .3, y: .06, width: .6, height: .1 });
});
