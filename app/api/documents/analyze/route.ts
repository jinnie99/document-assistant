import { readDocument, searchDocument } from "@/lib/documents/openai";
import { analysisStore } from "@/lib/documents/store";
import { validateImage } from "@/lib/documents/validation";
import { consumeAnalysisQuota, errorResponse, InputError, json, requestJson, withBudget } from "@/lib/documents/http";
import { createAnalysisStream } from "@/lib/documents/analysis-pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const input = await requestJson(request);
    let image: string;
    try { image = validateImage(input.image); } catch { throw new InputError("INVALID_IMAGE"); }
    consumeAnalysisQuota(request);
    if (request.headers.get("accept")?.toLowerCase().split(",").some(value => value.trim().split(";")[0] === "application/x-ndjson")) return createAnalysisStream(request, image);
    return await withBudget(request, async () => {
      const document = await readDocument(image, request.signal);
      const search = await searchDocument(document, request.signal);
      return json(analysisStore.put(document, search));
    });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const input = await requestJson(request);
    if (typeof input.id !== "string" || input.id.length > 80) throw new InputError("INVALID_JSON");
    analysisStore.delete(input.id);
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
