import { MAX_DOCUMENT_FIELDS } from "./limits.ts";
import { parseField, parseReading } from "./validation.ts";
import type { DocumentField, DocumentReading } from "./types.ts";

export class ReadingStreamError extends Error {
  code: string;
  constructor(code = "AI_INVALID_RESPONSE") { super(code); this.code = code; }
}
function invalid(): never { throw new ReadingStreamError(); }
const MAX_TEXT_BYTES = 1_048_576;
const MAX_EVENT_BYTES = 2_097_152;
const MAX_STREAM_BYTES = 4_194_304;

// Only complete JSON values are parsed. Quotes and escapes inside printed text
// never participate in the container depth used to find a field boundary.
function valueEnd(text: string, start: number): number | undefined {
  const first = text[start];
  if (first === undefined) return;
  if (first !== '"' && first !== "{" && first !== "[") {
    const end = text.slice(start).search(/[\s,}\]]/);
    return end < 0 ? undefined : start + end;
  }
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') { quoted = false; if (first === '"' && stack.length === 0) return index + 1; }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") { stack.push(char); if (stack.length > 16) invalid(); }
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) invalid();
      if (!stack.length) return index + 1;
    }
  }
}

export function createReadingPrefixParser(onField: (reading: DocumentReading) => void, snap: (fields: DocumentField[]) => DocumentField[] = fields => fields, parseInputField: (value: unknown) => DocumentField = parseField) {
  let text = "", cursor = 0, bytes = 0, key = "";
  let state: "start" | "key" | "colon" | "value" | "field" | "fieldAfter" | "after" | "done" = "start";
  let mayEnd = true;
  const seen = new Set<string>(), fields: DocumentField[] = [];
  const metadata: Record<string, unknown> = { title: "", institution: "", formNumber: "", revision: "", readable: true, warnings: [] };
  const snapshot = () => parseReading({ ...metadata, fields }, { allowEmptyFields: true });
  return {
    append(delta: string) {
      bytes += Buffer.byteLength(delta, "utf8");
      if (bytes > MAX_TEXT_BYTES) invalid();
      text += delta;
      for (;;) {
        while (/[ \t\r\n]/.test(text[cursor] || "") && cursor < text.length) cursor++;
        const char = text[cursor];
        if (char === undefined) return;
        if (state === "start") { if (char !== "{") invalid(); cursor++; state = "key"; }
        else if (state === "key") {
          if (char === "}" && mayEnd) { cursor++; state = "done"; continue; }
          if (char !== '"') invalid();
          const end = valueEnd(text, cursor);
          if (end === undefined) { if (text.length - cursor > 64) invalid(); return; }
          key = JSON.parse(text.slice(cursor, end)) as string;
          if (!["title", "institution", "formNumber", "revision", "readable", "warnings", "fields"].includes(key) || seen.has(key)) invalid();
          seen.add(key); cursor = end; state = "colon";
        } else if (state === "colon") { if (char !== ":") invalid(); cursor++; state = "value"; }
        else if (state === "value") {
          if (key === "fields") { if (char !== "[") invalid(); cursor++; state = "field"; mayEnd = true; continue; }
          const end = valueEnd(text, cursor);
          if (end === undefined) { if (text.length - cursor > 16_384) invalid(); return; }
          if (end - cursor > 16_384) invalid();
          metadata[key] = JSON.parse(text.slice(cursor, end)); snapshot();
          cursor = end; state = "after";
        } else if (state === "field") {
          if (char === "]" && mayEnd) { cursor++; state = "after"; continue; }
          if (char !== "{" || fields.length >= MAX_DOCUMENT_FIELDS || text.length - cursor > MAX_TEXT_BYTES) invalid();
          const end = valueEnd(text, cursor);
          if (end === undefined) { if (text.length - cursor > 16_384) invalid(); return; }
          if (end - cursor > 16_384) invalid();
          const field = parseInputField(JSON.parse(text.slice(cursor, end)));
          if (fields.some(item => item.id === field.id)) invalid();
          fields.push(...snap([field]).map(parseField));
          cursor = end; state = "fieldAfter";
          onField(snapshot());
        } else if (state === "fieldAfter") {
          if (char === ",") { cursor++; state = "field"; mayEnd = false; }
          else if (char === "]") { cursor++; state = "after"; }
          else invalid();
        } else if (state === "after") {
          if (char === ",") { cursor++; state = "key"; mayEnd = false; }
          else if (char === "}") { cursor++; state = "done"; }
          else invalid();
        } else invalid();
      }
    },
    finish(finalText: string): DocumentReading {
      if (state !== "done" || finalText !== text) invalid();
      const raw = JSON.parse(finalText);
      const final = parseReading({ ...raw, fields: Array.isArray(raw.fields) ? raw.fields.map(parseInputField) : raw.fields });
      if (final.fields.length !== fields.length) invalid();
      return parseReading({ ...final, fields });
    },
  };
}

type ProviderResponse = { status?: string; output?: { content?: { type?: string; text?: string }[] }[] };
export async function readResponseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onDelta: (text: string) => void): Promise<string> {
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", lineCursor = 0, bufferBytes = 0, data: string[] = [], eventBytes = 0, wireBytes = 0, textBytes = 0, output = "", target = "";
  let completion: string | undefined;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const dispatch = () => {
    if (!data.length) { eventBytes = 0; return; }
    let event: Record<string, unknown>;
    try { event = JSON.parse(data.join("\n")) as Record<string, unknown>; } catch { return invalid(); }
    data = []; eventBytes = 0;
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") invalid();
    if (event.type.startsWith("response.refusal.")) throw new ReadingStreamError("AI_REFUSED");
    if (event.type === "error" || event.type === "response.failed") throw new ReadingStreamError("AI_UPSTREAM_ERROR");
    if (event.type === "response.incomplete") throw new ReadingStreamError("AI_INCOMPLETE");
    if (event.type === "response.output_text.delta") {
      if (typeof event.delta !== "string") invalid();
      const current = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
      if (target && target !== current) invalid(); target = current;
      textBytes += Buffer.byteLength(event.delta, "utf8"); if (textBytes > MAX_TEXT_BYTES) invalid();
      output += event.delta; onDelta(event.delta);
    } else if (event.type === "response.completed") {
      const response = event.response as ProviderResponse | undefined;
      if (!response || response.status !== "completed") throw new ReadingStreamError("AI_INCOMPLETE");
      if (!Array.isArray(response.output)) invalid();
      const content = response.output.flatMap(item => item.content || []);
      if (content.some(part => part.type === "refusal")) throw new ReadingStreamError("AI_REFUSED");
      const finalText = content.filter(part => part.type === "output_text").map(part => part.text || "").join("\n");
      if (!finalText) throw new ReadingStreamError("AI_EMPTY_RESPONSE");
      if (finalText !== output || Buffer.byteLength(finalText, "utf8") > MAX_TEXT_BYTES) invalid();
      completion = finalText;
    }
  };
  const lines = (eof = false) => {
    let start = 0, scanned = lineCursor;
    for (let index = lineCursor; index < buffer.length; index++) {
      scanned = index + 1;
      const char = buffer[index];
      if (char !== "\r" && char !== "\n") continue;
      if (char === "\r" && index === buffer.length - 1 && !eof) { scanned = index; break; }
      const line = buffer.slice(start, index);
      if (char === "\r" && buffer[index + 1] === "\n") index++;
      start = index + 1;
      if (!line) dispatch();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      eventBytes += Buffer.byteLength(line, "utf8") + 1;
      if (eventBytes > MAX_EVENT_BYTES) invalid();
      if (completion !== undefined) break;
    }
    bufferBytes -= Buffer.byteLength(buffer.slice(0, start), "utf8");
    buffer = buffer.slice(start);
    lineCursor = Math.max(0, scanned - start);
    if (bufferBytes + eventBytes > MAX_EVENT_BYTES) invalid();
  };
  try {
    if (signal.aborted) throw new ReadingStreamError("CANCELLED");
    while (completion === undefined) {
      const chunk = await reader.read().catch(() => { throw new ReadingStreamError("AI_UNAVAILABLE"); });
      if (signal.aborted) throw new ReadingStreamError("CANCELLED");
      if (chunk.done) { const end = decoder.decode(); buffer += end; bufferBytes += Buffer.byteLength(end, "utf8"); lines(true); break; }
      wireBytes += chunk.value.byteLength; if (wireBytes > MAX_STREAM_BYTES) invalid();
      const decoded = decoder.decode(chunk.value, { stream: true });
      buffer += decoded; bufferBytes += Buffer.byteLength(decoded, "utf8"); lines();
    }
    if (completion === undefined) throw new ReadingStreamError("AI_INCOMPLETE");
    return completion;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
