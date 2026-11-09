export type AuditTruth = { fixture: string; units: { id: string }[] };
export type AuditField = { id: string };
type Verdict = "pass" | "partial" | "missing" | "wrong_mapping" | "ambiguous";
type Disposition = "matched" | "duplicate" | "unexpected" | "ambiguous";
export type FullFieldAudit = {
  fixture: string; run: string;
  units: { truthId: string; verdict: Verdict; fieldIds: string[]; reason: string; grouped?: boolean }[];
  outputs: { fieldId: string; disposition: Disposition; truthIds: string[]; reason: string }[];
  summaryNotes: string[];
};
function exactSet(actual: string[], expected: string[], label: string) {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length || actual.length !== expected.length || actual.some(id => !expected.includes(id))) throw new Error(`${label}: incomplete or duplicate accounting`);
}
export function validateFullFieldAudit(truth: AuditTruth, fields: AuditField[], audit: FullFieldAudit) {
  if (truth.fixture !== audit.fixture) throw new Error("Wrong fixture");
  const truthIds = truth.units.map(unit => unit.id), fieldIds = fields.map(field => field.id);
  exactSet(audit.units.map(unit => unit.truthId), truthIds, "Truth units");
  exactSet(audit.outputs.map(output => output.fieldId), fieldIds, "AI outputs");
  const unitCounts: Record<Verdict, number> = { pass: 0, partial: 0, missing: 0, wrong_mapping: 0, ambiguous: 0 };
  const outputCounts: Record<Disposition, number> = { matched: 0, duplicate: 0, unexpected: 0, ambiguous: 0 };
  for (const unit of audit.units) {
    if (!Object.hasOwn(unitCounts, unit.verdict) || !unit.reason.trim()) throw new Error("Invalid unit judgment");
    if (new Set(unit.fieldIds).size !== unit.fieldIds.length || unit.fieldIds.some(id => !fieldIds.includes(id))) throw new Error("Unknown or duplicate field link");
    if ((unit.verdict === "pass" || unit.verdict === "wrong_mapping") && !unit.fieldIds.length) throw new Error("Judgment needs an actual field");
    if (unit.verdict === "missing" && unit.fieldIds.length) throw new Error("Missing unit has a conflicting field link");
    for (const fieldId of unit.fieldIds) {
      if (!audit.outputs.find(output => output.fieldId === fieldId)?.truthIds.includes(unit.truthId)) throw new Error("Asymmetric field link");
    }
    unitCounts[unit.verdict]++;
  }
  for (const output of audit.outputs) {
    if (!Object.hasOwn(outputCounts, output.disposition) || !output.reason.trim()) throw new Error("Invalid output judgment");
    if (new Set(output.truthIds).size !== output.truthIds.length || output.truthIds.some(id => !truthIds.includes(id))) throw new Error("Unknown or duplicate truth link");
    if ((output.disposition === "matched" || output.disposition === "duplicate") && !output.truthIds.length) throw new Error("Output needs a truth link");
    if (output.disposition === "unexpected" && output.truthIds.length) throw new Error("Unexpected output has a conflicting truth link");
    for (const truthId of output.truthIds) {
      const unit = audit.units.find(unit => unit.truthId === truthId);
      if (!unit?.fieldIds.includes(output.fieldId)) throw new Error("Asymmetric truth link");
      if (output.truthIds.length > 1 && unit.verdict === "pass" && !unit.grouped) throw new Error("Composite coverage needs explicit review");
    }
    outputCounts[output.disposition]++;
  }
  return { fixture: truth.fixture, run: audit.run, totalUnits: truthIds.length, totalOutputs: fieldIds.length, unitCounts, outputCounts,
    contentPassed: unitCounts.pass === truthIds.length && !outputCounts.duplicate && !outputCounts.unexpected && !outputCounts.ambiguous };
}
