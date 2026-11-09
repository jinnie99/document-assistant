import { addManualField } from "@/lib/documents/field-regions";
import { errorResponse, InputError, json, requestJson, withBudget } from "@/lib/documents/http";
import { readSelectedField } from "@/lib/documents/openai";
import { parseRegionAddition, parseRegionEdit } from "@/lib/documents/region-validation";
import { analysisStore } from "@/lib/documents/store";

export const maxDuration = 90;

export async function PATCH(request: Request) {
  try {
    const input = parseRegionEdit(await requestJson(request));
    if (request.signal.aborted) throw new InputError("CANCELLED", 499);
    return await withBudget(request, async () => json(analysisStore.updateField(input.analysisId, input.fieldId, input.box)));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const input = parseRegionAddition(await requestJson(request));
    return await withBudget(request, async () => json(await addManualField(analysisStore, readSelectedField, input, request.signal)));
  } catch (error) { return errorResponse(error); }
}
