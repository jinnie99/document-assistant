import test from "node:test";
import assert from "node:assert/strict";
import { questionLayout, type QuestionMeasurements } from "../../lib/documents/question-layout.ts";

const compact: QuestionMeasurements = {
  height: 244,
  questionHeight: 104.4,
  choiceHeights: [66, 66, 44],
  choiceGap: 7,
  sectionGap: 8,
  pagerHeight: 44,
};

test("short questions keep all three answers visible together", () => {
  assert.equal(questionLayout({ ...compact, questionHeight: 26.1, choiceHeights: [44, 44, 44] }), "all");
});

test("a 50 character question and 20 character answers page answers without clipping", () => {
  assert.equal(questionLayout(compact), "choices");
});

test("question and answers become separate pages when even one answer will not fit", () => {
  assert.equal(questionLayout({ ...compact, height: 210 }), "separate");
});

test("fit checks include answer gaps and the full 44px navigation row", () => {
  assert.equal(questionLayout({ ...compact, height: 180, questionHeight: 26, choiceHeights: [44, 44, 44] }), "all");
  assert.equal(questionLayout({ ...compact, height: 179, questionHeight: 26, choiceHeights: [44, 44, 44] }), "choices");
  assert.equal(questionLayout({ ...compact, height: 230.4 }), "choices");
  assert.equal(questionLayout({ ...compact, height: 230.3 }), "separate");
});
