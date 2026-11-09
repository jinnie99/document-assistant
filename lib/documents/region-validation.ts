import { InputError } from "./http.ts";
import type { Box } from "./types.ts";

export type RegionEditInput = { analysisId: string; fieldId: string; box: Box };
export type RegionAdditionInput = { analysisId: string; box: Box; image: string };

function identifier(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new InputError("INVALID_JSON");
  return value;
}

export function validateRegionBox(value: unknown): Box {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("INVALID_REGION");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 || !["x", "y", "width", "height"].every((key) => typeof raw[key] === "number" && Number.isFinite(raw[key]))) throw new InputError("INVALID_REGION");
  const { x, y, width, height } = raw as Box;
  if (x < 0 || y < 0 || x >= 1 || y >= 1 || width < .003 || height < .003 || width * height < .00002 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) throw new InputError("INVALID_REGION");
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

export function parseRegionEdit(input: Record<string, unknown>): RegionEditInput {
  if (Object.keys(input).some((key) => !["analysisId", "fieldId", "box"].includes(key))) throw new InputError("INVALID_JSON");
  return { analysisId: identifier(input.analysisId, 80), fieldId: identifier(input.fieldId, 64), box: validateRegionBox(input.box) };
}

export function parseRegionAddition(input: Record<string, unknown>): RegionAdditionInput {
  if (Object.keys(input).some((key) => !["analysisId", "box", "image"].includes(key))) throw new InputError("INVALID_JSON");
  if (typeof input.image !== "string") throw new InputError("INVALID_IMAGE");
  return { analysisId: identifier(input.analysisId, 80), box: validateRegionBox(input.box), image: input.image };
}
