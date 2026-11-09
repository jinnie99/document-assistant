import { isDeepStrictEqual } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { AnalysisStreamError, consumeAnalysisStream } from "../lib/documents/analysis-stream-client.ts";
import { parseGuidance, validateImage } from "../lib/documents/validation.ts";
import type { AnalysisResult, Box, SearchResult } from "../lib/documents/types.ts";

type Fixture = { id: string; imagePath: string };
type MappingStatus = NonNullable<AnalysisResult["mappingStatus"]>;
type Snapshot = {
  event: "mapped" | "fields" | "complete";
  elapsedMs: number;
  fieldCount: number;
  mappingStatus: MappingStatus;
  searchStatus: SearchResult["status"];
};
type Progress = { id: string; event: string; elapsedMs: number; fieldCount?: number; mappingStatus?: MappingStatus; searchStatus?: SearchResult["status"] };
type Benchmark = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  httpStatus?: number;
  requestCounts: { analyze: number; guide: number; delete: number };
  elapsedMs: { firstIdentity: number | null; firstMapped: number | null; mappingCompleted: number | null; complete: number | null; streamFinished: number | null; guideStarted: number | null; guideFinished: number | null; total: number | null };
  firstMapped?: Snapshot;
  firstField?: { id: string; box: Box };
  updates: Snapshot[];
  guide: { httpStatus: number | null; provenance?: string; questionPresent?: boolean };
  cleanup?: { httpStatus?: number; deleted: boolean };
  checks: {
    analysisHttp200: boolean;
    identityReceived: boolean;
    mappedSearchPending: boolean;
    mappedMappingInProgress: boolean;
    initialFieldCountIsOne: boolean;
    firstFieldStable: boolean;
    laterFieldCountGrows: boolean;
    mappingCompleted: boolean;
    streamCompleted: boolean;
    oneGuideRequest: boolean;
    guideHttp200: boolean;
    guideResponseValid: boolean;
    guideStartedBeforeMappingComplete: boolean;
    guideFinishedBeforeMappingComplete: boolean;
    guideFinishedBeforeComplete: boolean;
    guideFinishedBeforeMappingOrComplete: boolean;
  };
  failureCodes: string[];
  passed: boolean;
};

async function fixtureImage(fixture: Fixture) {
  const mime = extname(fixture.imagePath).toLowerCase() === ".png" ? "png" : "jpeg";
  return validateImage(`data:image/${mime};base64,${(await readFile(fixture.imagePath)).toString("base64")}`);
}

export async function runProgressiveFixture(fixture: Fixture, base: URL, options: { request?: typeof fetch; onProgress?: (value: Progress) => void } = {}): Promise<Benchmark> {
  const request = options.request ?? fetch;
  const onProgress = options.onProgress ?? (value => console.log(JSON.stringify(value)));
  const run: Benchmark = {
    id: fixture.id, startedAt: new Date().toISOString(), requestCounts: { analyze: 0, guide: 0, delete: 0 },
    elapsedMs: { firstIdentity: null, firstMapped: null, mappingCompleted: null, complete: null, streamFinished: null, guideStarted: null, guideFinished: null, total: null },
    updates: [], guide: { httpStatus: null }, failureCodes: [], passed: false,
    checks: {
      analysisHttp200: false, identityReceived: false, mappedSearchPending: false, mappedMappingInProgress: false, initialFieldCountIsOne: false,
      firstFieldStable: true, laterFieldCountGrows: false, mappingCompleted: false, streamCompleted: false, oneGuideRequest: false,
      guideHttp200: false, guideResponseValid: false, guideStartedBeforeMappingComplete: false, guideFinishedBeforeMappingComplete: false,
      guideFinishedBeforeComplete: false, guideFinishedBeforeMappingOrComplete: false,
    },
  };
  let sessionId: string | undefined;
  let guidePromise: Promise<void> | undefined;
  let begin: number | undefined;
  const elapsed = () => Math.round((performance.now() - begin!) * 100) / 100;
  const failure = (code: string) => { if (!run.failureCodes.includes(code)) run.failureCodes.push(code); };
  const headers = { "Content-Type": "application/json", Origin: base.origin };

  async function requestGuide(analysisId: string, fieldId: string) {
    run.requestCounts.guide++;
    run.elapsedMs.guideStarted = elapsed();
    onProgress({ id: fixture.id, event: "guide-started", elapsedMs: run.elapsedMs.guideStarted });
    try {
      const response = await request(new URL("/api/documents/guide", base), {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(90_000), headers,
        body: JSON.stringify({ analysisId, fieldId, answers: {} }),
      });
      run.guide.httpStatus = response.status;
      run.checks.guideHttp200 = response.status === 200;
      if (!response.ok) { await response.body?.cancel(); failure("GUIDE_HTTP_FAILED"); return; }
      const guide = parseGuidance(await response.json(), fieldId);
      run.guide.provenance = guide.provenance;
      run.guide.questionPresent = guide.question !== null;
      run.checks.guideResponseValid = true;
    } catch { failure("GUIDE_REQUEST_OR_RESPONSE_FAILED"); }
    finally {
      run.elapsedMs.guideFinished = elapsed();
      onProgress({ id: fixture.id, event: "guide-finished", elapsedMs: run.elapsedMs.guideFinished });
    }
  }

  try {
    const image = await fixtureImage(fixture);
    const body = JSON.stringify({ image });
    const signal = AbortSignal.timeout(320_000);
    begin = performance.now();
    run.requestCounts.analyze++;
    const response = await request(new URL("/api/documents/analyze", base), {
      method: "POST", cache: "no-store", signal, headers: { ...headers, Accept: "application/x-ndjson" }, body,
    });
    run.httpStatus = response.status;
    run.checks.analysisHttp200 = response.status === 200;
    await consumeAnalysisStream(response, event => {
      const time = elapsed();
      if (event.type === "identity" && run.elapsedMs.firstIdentity === null) {
        run.elapsedMs.firstIdentity = time;
        run.checks.identityReceived = true;
        onProgress({ id: fixture.id, event: "identity", elapsedMs: time });
      }
      if (event.type !== "mapped" && event.type !== "fields" && event.type !== "complete") return;
      if (sessionId && sessionId !== event.analysis.id) failure("SESSION_ID_CHANGED");
      sessionId ??= event.analysis.id;
      const snapshot: Snapshot = {
        event: event.type, elapsedMs: time, fieldCount: event.analysis.document.fields.length,
        mappingStatus: event.analysis.mappingStatus ?? "completed", searchStatus: event.analysis.search.status,
      };
      run.updates.push(snapshot);
      if (event.type === "mapped") {
        if (run.firstMapped) { failure("DUPLICATE_MAPPED_EVENT"); return; }
        run.firstMapped = snapshot;
        run.elapsedMs.firstMapped = time;
        run.checks.mappedSearchPending = snapshot.searchStatus === "pending";
        run.checks.mappedMappingInProgress = snapshot.mappingStatus === "in_progress";
        run.checks.initialFieldCountIsOne = snapshot.fieldCount === 1;
        const first = event.analysis.document.fields[0];
        if (first) {
          run.firstField = { id: first.id, box: { ...first.box } };
          guidePromise = requestGuide(event.analysis.id, first.id);
        } else failure("NO_FIRST_FIELD");
      }
      const first = event.analysis.document.fields[0];
      if (run.firstField && (!first || first.id !== run.firstField.id || !isDeepStrictEqual(first.box, run.firstField.box))) {
        run.checks.firstFieldStable = false;
        failure("FIRST_FIELD_CHANGED");
      }
      if (run.firstMapped && snapshot.fieldCount > run.firstMapped.fieldCount) run.checks.laterFieldCountGrows = true;
      if (snapshot.mappingStatus === "completed" && run.elapsedMs.mappingCompleted === null) {
        run.elapsedMs.mappingCompleted = time;
        run.checks.mappingCompleted = true;
      }
      if (event.type === "complete") {
        run.elapsedMs.complete = time;
        run.checks.streamCompleted = true;
      }
      onProgress({ id: fixture.id, ...snapshot });
    }, signal);
    run.elapsedMs.streamFinished = elapsed();
  } catch (error) {
    const safeCode = error instanceof AnalysisStreamError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || "") ? error.code! : begin === undefined ? "INPUT_READ_FAILED" : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "TIMEOUT" : "BENCHMARK_FAILED";
    failure(safeCode);
  } finally {
    if (guidePromise) await guidePromise;
    const { guideStarted, guideFinished, mappingCompleted, complete } = run.elapsedMs;
    run.checks.oneGuideRequest = run.requestCounts.guide === 1;
    run.checks.guideStartedBeforeMappingComplete = guideStarted !== null && mappingCompleted !== null && guideStarted < mappingCompleted;
    run.checks.guideFinishedBeforeMappingComplete = run.checks.guideHttp200 && guideFinished !== null && mappingCompleted !== null && guideFinished < mappingCompleted;
    run.checks.guideFinishedBeforeComplete = run.checks.guideHttp200 && guideFinished !== null && complete !== null && guideFinished < complete;
    run.checks.guideFinishedBeforeMappingOrComplete = run.checks.guideFinishedBeforeMappingComplete || run.checks.guideFinishedBeforeComplete;
    if (sessionId) {
      run.requestCounts.delete++;
      try {
        const response = await request(new URL("/api/documents/analyze", base), {
          method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(10_000), headers, body: JSON.stringify({ id: sessionId }),
        });
        const body: unknown = response.ok ? await response.json() : null;
        run.cleanup = { httpStatus: response.status, deleted: response.status === 200 && body !== null && typeof body === "object" && "deleted" in body && body.deleted === true };
        if (!response.ok) await response.body?.cancel();
        if (!run.cleanup.deleted) failure("SESSION_DELETE_FAILED");
      } catch { run.cleanup = { deleted: false }; failure("SESSION_DELETE_FAILED"); }
    }
    const requiredChecks = Object.entries(run.checks).filter(([name]) => name !== "guideFinishedBeforeMappingComplete" && name !== "guideFinishedBeforeComplete");
    for (const [name, passed] of requiredChecks) if (!passed) failure(`CHECK_${name.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`);
    if (begin !== undefined) run.elapsedMs.total = elapsed();
    run.finishedAt = new Date().toISOString();
    run.passed = requiredChecks.every(([, passed]) => passed) && run.cleanup?.deleted === true && run.failureCodes.length === 0;
  }
  return run;
}

async function main() {
  const args = process.argv.slice(2);
  let execute = false;
  let selected = ["bank_university"];
  let base = new URL("http://127.0.0.1:3000");
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--run") execute = true;
    else if (args[index] === "--only" && args[index + 1]) selected = args[++index].split(",");
    else if (args[index] === "--base-url" && args[index + 1]) base = new URL(args[++index]);
    else throw new Error("Use --run, --only <fixture-id[,fixture-id]>, or --base-url <local-url>.");
  }
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(base.hostname) || !["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Only a local test service is allowed.");
  if (!selected.length || selected.some(id => !/^[a-z][a-z0-9_]*$/.test(id)) || new Set(selected).size !== selected.length) throw new Error("Invalid fixture selection.");
  const fixtureDirectory = resolve(".ai-docs/verification/2026-10-29-public-forms");
  const reportPath = resolve(".ai-docs/verification/2026-10-29-progressive-analysis/benchmarks.json");
  const manifest: unknown = JSON.parse(await readFile(join(fixtureDirectory, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest)) throw new Error("Invalid public fixture manifest.");
  const fixtures = selected.map(id => {
    const entry = manifest.find(value => value && typeof value === "object" && value.id === id) as Fixture | undefined;
    const imagePath = join(fixtureDirectory, "fixtures", `${id}.jpg`);
    if (!entry || typeof entry.imagePath !== "string" || resolve(entry.imagePath).toLowerCase() !== imagePath.toLowerCase()) throw new Error("Selected manifest entry is missing or points outside its public JPG fixture.");
    return { id, imagePath };
  });
  for (const fixture of fixtures) await fixtureImage(fixture);
  if (!execute) {
    console.log(JSON.stringify({ mode: "dry-run", fixtureIds: selected, requestsSent: 0, reportPath, execution: "Add --run after the test server is ready." }));
    return;
  }
  const startedAt = new Date().toISOString();
  const runs: Benchmark[] = [];
  await mkdir(dirname(reportPath), { recursive: true });
  for (const fixture of fixtures) {
    const run = await runProgressiveFixture(fixture, base);
    runs.push(run);
    await writeFile(reportPath, JSON.stringify({
      schemaVersion: 1, startedAt, updatedAt: new Date().toISOString(), baseUrl: base.origin, fixtureIds: selected,
      measurement: "Monotonic client milliseconds from immediately before analyze POST fetch. Each event time is captured in its NDJSON callback; complete is distinct from stream-consumption finish. One guide starts synchronously at first mapped without blocking stream consumption and is awaited before DELETE.",
      input: "Selected public blank-form fixtures. No API keys, image bytes, raw response bodies, or guidance text are logged.",
      guideTimingCriterion: "Successful valid guide finishes before full mapping completion or the complete event; both individual timing comparisons are retained.",
      runs, passed: runs.every(value => value.passed),
    }, null, 2) + "\n");
    console.log(JSON.stringify({ id: fixture.id, passed: run.passed, elapsedMs: run.elapsedMs, failureCodes: run.failureCodes, cleanup: run.cleanup }));
  }
  console.log(JSON.stringify({ reportPath, completed: runs.length, passed: runs.every(run => run.passed) }));
  if (runs.some(run => !run.passed)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch { console.error("Progressive benchmark could not start. Check its local arguments and public fixture manifest."); process.exitCode = 1; }
}
