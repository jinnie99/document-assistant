import { InputError } from "./http.ts";
import { MAX_DOCUMENT_FIELDS } from "./limits.ts";
import { validateRegionBox, type RegionAdditionInput } from "./region-validation.ts";
import { AnalysisStore, type FieldChange, type RecognizedField } from "./store.ts";
import { validateImage } from "./validation.ts";

export type SelectedFieldReader = (image: string, documentTitle: string, signal?: AbortSignal) => Promise<RecognizedField>;

export async function addManualField(store: AnalysisStore, readField: SelectedFieldReader, input: RegionAdditionInput, signal?: AbortSignal): Promise<FieldChange> {
  if (signal?.aborted) throw new InputError("CANCELLED", 499);
  const record = store.get(input.analysisId);
  if (!record) throw new InputError("SESSION_EXPIRED", 410);
  if (record.analysis.document.fields.length >= MAX_DOCUMENT_FIELDS) throw new InputError("FIELD_LIMIT", 409);
  const box = validateRegionBox(input.box);
  let image: string;
  try { image = validateImage(input.image); } catch { throw new InputError("INVALID_IMAGE"); }
  const version = record.version;
  const recognized = await readField(image, record.analysis.document.title, signal);
  if (signal?.aborted) throw new InputError("CANCELLED", 499);
  return store.addField(input.analysisId, recognized, box, version);
}
