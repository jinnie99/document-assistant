import test from "node:test";
import assert from "node:assert/strict";
import { validateFullFieldAudit, type FullFieldAudit } from "../../scripts/full-field-audit-validation.ts";

const truth = { fixture: "test", units: [{ id: "name" }, { id: "address" }] };
const fields = [{ id: "f1" }, { id: "f2" }];
const audit = (): FullFieldAudit => ({ fixture: "test", run: "baseline", units: [
  { truthId: "name", verdict: "pass", fieldIds: ["f1"], reason: "Correct name row" },
  { truthId: "address", verdict: "pass", fieldIds: ["f2"], reason: "Correct address row" },
], outputs: [
  { fieldId: "f1", disposition: "matched", truthIds: ["name"], reason: "Name" },
  { fieldId: "f2", disposition: "matched", truthIds: ["address"], reason: "Address" },
], summaryNotes: [] });

test("selected passing fields cannot stand in for the whole form", () => {
  const result = audit(); result.units.pop(); result.outputs.pop();
  assert.throws(() => validateFullFieldAudit(truth, fields, result), /incomplete/);
});
test("every returned AI field must be checked for duplicates and unexpected areas", () => {
  const result = audit(); result.outputs.pop();
  assert.throws(() => validateFullFieldAudit(truth, fields, result), /AI outputs/);
});
test("role or position failure is counted even when all API fields are valid", () => {
  const result = audit(); result.units[1].verdict = "wrong_mapping";
  const summary = validateFullFieldAudit(truth, fields, result);
  assert.equal(summary.unitCounts.wrong_mapping, 1);
  assert.equal(summary.contentPassed, false);
});
test("unexplained composite boxes do not automatically cover multiple fields", () => {
  const result = audit(); result.units[1].fieldIds = ["f1"]; result.outputs = [{ ...result.outputs[0], truthIds: ["name", "address"] }];
  assert.throws(() => validateFullFieldAudit(truth, fields.slice(0, 1), result), /Composite/);
});
test("duplicate labels are not hidden in the correct-field total", () => {
  const result = audit(); result.units[0].fieldIds.push("duplicate"); result.outputs.push({ fieldId: "duplicate", disposition: "duplicate", truthIds: ["name"], reason: "Same blank repeated" });
  const summary = validateFullFieldAudit(truth, [...fields, { id: "duplicate" }], result);
  assert.equal(summary.unitCounts.pass, 2);
  assert.equal(summary.outputCounts.duplicate, 1);
  assert.equal(summary.contentPassed, false);
});
test("unmatched areas and true omissions are kept separate", () => {
  const result = audit(); result.units[1] = { truthId: "address", verdict: "missing", fieldIds: [], reason: "Address absent" };
  result.outputs[1] = { fieldId: "f2", disposition: "unexpected", truthIds: [], reason: "Printed instructions only" };
  const summary = validateFullFieldAudit(truth, fields, result);
  assert.equal(summary.unitCounts.missing, 1);
  assert.equal(summary.outputCounts.unexpected, 1);
  assert.equal(summary.contentPassed, false);
});
