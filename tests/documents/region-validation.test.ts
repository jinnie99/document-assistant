import assert from "node:assert/strict";
import test from "node:test";
import { parseRegionAddition, parseRegionEdit, validateRegionBox } from "../../lib/documents/region-validation.ts";

const box = { x: .1, y: .2, width: .4, height: .05 };
test("manual region boundaries accept a valid normalized box without mutating the caller", () => {
  assert.deepEqual(validateRegionBox(box), box);
  assert.notEqual(validateRegionBox(box), box);
  assert.deepEqual(parseRegionEdit({ analysisId: "analysis_id", fieldId: "field_1", box }), { analysisId: "analysis_id", fieldId: "field_1", box });
});

test("manual regions reject malformed, nonfinite, tiny, and out-of-photo boxes", () => {
  for (const bad of [null, [], {}, { ...box, extra: 1 }, { ...box, x: "0.1" }, { ...box, x: Number.NaN }, { ...box, height: Infinity }, { ...box, x: -.01 }, { ...box, width: 0 }, { ...box, width: .0001 }, { ...box, width: .003, height: .003 }, { ...box, x: .9, width: .2 }, { ...box, y: .99 }]) {
    assert.throws(() => validateRegionBox(bad), (error) => error instanceof Error && "code" in error && error.code === "INVALID_REGION");
  }
});

test("manual region requests only accept their documented identifiers and fields", () => {
  for (const bad of ["", "a".repeat(81), "<script>"]) assert.throws(() => parseRegionEdit({ analysisId: bad, fieldId: "name", box }));
  assert.throws(() => parseRegionEdit({ analysisId: "analysis", fieldId: "x".repeat(65), box }));
  assert.throws(() => parseRegionEdit({ analysisId: "analysis", fieldId: "name", box, label: "not forwarded" }));
  assert.throws(() => parseRegionAddition({ analysisId: "analysis", box, image: {} }));
  assert.throws(() => parseRegionAddition({ analysisId: "analysis", box, image: "image", injected: true }));
});
