import sharp from "sharp";
import type { Box } from "./types.ts";

export type TableCell = { id: string; box: Box; confidence: number };
type Segment = { position: number; start: number; end: number };

const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const MAX_SIDE = 1600;
const MAX_CELLS = 240;

function lineSegments(ink: Uint8Array, occlusion: Uint8Array, width: number, height: number, horizontal: boolean): Segment[] {
  const outer = horizontal ? height : width, inner = horizontal ? width : height;
  const minimum = horizontal ? Math.max(24, Math.round(width * .022)) : Math.max(12, Math.round(height * .007));
  const minimumRun = horizontal ? Math.max(12, Math.round(width * .01)) : 8;
  const segments: Segment[] = [];
  for (let position = 0; position < outer; position++) {
    let start = -1, last = -1, count = 0, visible = 0, run = 0, longest = 0;
    for (let offset = 0; offset <= inner; offset++) {
      const pixel = horizontal ? position * width + offset : offset * width + position;
      const dark = offset < inner && ink[pixel], covered = offset < inner && occlusion[pixel];
      if (dark || covered) {
        if (start < 0) start = offset;
        last = offset; count++;
        if (dark) { visible++; run++; longest = Math.max(longest, run); }
        else run = 0;
      } else {
        run = 0;
        if (start >= 0 && (offset - last > 3 || offset === inner)) {
          const length = last - start + 1;
          if (length >= minimum && count / length >= .75 && visible >= minimum && longest >= minimumRun) segments.push({ position, start, end: last });
          start = -1; count = 0; visible = 0; longest = 0;
        }
      }
    }
  }
  return segments;
}

function drawSegments(segments: Segment[], mask: Uint8Array, width: number, horizontal: boolean) {
  for (const { position, start, end } of segments) {
    if (horizontal) mask.fill(1, position * width + start, position * width + end + 1);
    else for (let offset = start; offset <= end; offset++) mask[offset * width + position] = 1;
  }
}

function connectedSegments(segments: Segment[], perpendicular: Uint8Array, width: number, height: number, horizontal: boolean) {
  const minimumSpan = horizontal ? Math.max(20, width * .018) : 9;
  return segments.filter(({ position, start, end }) => {
    let first = -1;
    for (let offset = start; offset <= end; offset++) {
      const x = horizontal ? offset : position, y = horizontal ? position : offset;
      const connected = perpendicular[y * width + x]
        || (horizontal ? (y > 0 && perpendicular[(y - 1) * width + x]) || (y + 1 < height && perpendicular[(y + 1) * width + x])
          : (x > 0 && perpendicular[y * width + x - 1]) || (x + 1 < width && perpendicular[y * width + x + 1]));
      if (connected) {
        if (first < 0) first = offset;
        else if (offset - first >= minimumSpan) return true;
      }
    }
    return false;
  });
}

/** Finds closed, axis-aligned ruled cells globally; text bounds are never inputs. */
export async function detectTableCells(image: string | Buffer): Promise<TableCell[]> {
  const bytes = typeof image === "string" ? Buffer.from(image.slice(image.indexOf(",") + 1), "base64") : image;
  const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .flatten({ background: "white" }).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 32 || height < 32) return [];
  const ink = new Uint8Array(width * height), occlusion = new Uint8Array(width * height);
  for (let pixel = 0; pixel < ink.length; pixel++) {
    const r = data[pixel * channels], g = data[pixel * channels + 1], b = data[pixel * channels + 2];
    // Red editorial boxes must not become borders; black and green form rules remain eligible.
    if (r > g + 45 && r > b + 45) occlusion[pixel] = 1;
    else if ((r * 77 + g * 150 + b * 29) / 256 < 175) ink[pixel] = 1;
  }
  const horizontal = lineSegments(ink, occlusion, width, height, true), vertical = lineSegments(ink, occlusion, width, height, false);
  if (!horizontal.length || !vertical.length) return [];
  const horizontalMask = new Uint8Array(ink.length), verticalMask = new Uint8Array(ink.length);
  drawSegments(horizontal, horizontalMask, width, true);
  drawSegments(vertical, verticalMask, width, false);
  const state = new Uint8Array(ink.length);
  drawSegments(connectedSegments(horizontal, verticalMask, width, height, true), state, width, true);
  drawSegments(connectedSegments(vertical, horizontalMask, width, height, false), state, width, false);

  const queue = new Int32Array(ink.length);
  const cells: { left: number; top: number; right: number; bottom: number; confidence: number }[] = [];
  for (let seed = 0; seed < state.length; seed++) {
    if (state[seed]) continue;
    let read = 0, write = 1, area = 0;
    let left = width, right = 0, top = height, bottom = 0, exterior = false;
    queue[0] = seed; state[seed] = 2;
    while (read < write) {
      const pixel = queue[read++], x = pixel % width, y = (pixel / width) | 0;
      area++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) exterior = true;
      if (x > 0 && !state[pixel - 1]) { state[pixel - 1] = 2; queue[write++] = pixel - 1; }
      if (x + 1 < width && !state[pixel + 1]) { state[pixel + 1] = 2; queue[write++] = pixel + 1; }
      if (y > 0 && !state[pixel - width]) { state[pixel - width] = 2; queue[write++] = pixel - width; }
      if (y + 1 < height && !state[pixel + width]) { state[pixel + width] = 2; queue[write++] = pixel + width; }
    }
    if (exterior || right - left < Math.max(20, width * .018) || bottom - top < 8) continue;
    const rectangularity = area / ((right - left + 1) * (bottom - top + 1));
    // A missing corner or L-shaped merged region has no single rectangular cell.
    if (rectangularity < .985) continue;
    const coverage = (horizontal: boolean, position: number, start: number, end: number) => {
      let found = 0;
      for (let offset = start; offset <= end; offset++) {
        const x = horizontal ? offset : position, y = horizontal ? position : offset;
        if (occlusion[y * width + x]) found += .9;
        else if (ink[y * width + x]
          || (horizontal ? ink[(y - 1) * width + x] || ink[(y + 1) * width + x]
            : ink[y * width + x - 1] || ink[y * width + x + 1])) found++;
      }
      return found / (end - start + 1);
    };
    const confidence = Math.min(coverage(true, top - 1, left, right), coverage(true, bottom + 1, left, right), coverage(false, left - 1, top, bottom), coverage(false, right + 1, top, bottom));
    if (confidence < .75) continue;
    cells.push({ left: left - 1, top: top - 1, right: right + 1, bottom: bottom + 1, confidence });
  }
  cells.sort((a, b) => Math.abs(a.top - b.top) > 3 ? a.top - b.top : a.left - b.left);
  return cells.slice(0, MAX_CELLS).map((cell, index) => ({
    id: `cell_${index + 1}`,
    box: { x: rounded(cell.left / width), y: rounded(cell.top / height), width: rounded((cell.right - cell.left) / width), height: rounded((cell.bottom - cell.top) / height) },
    confidence: rounded(cell.confidence),
  }));
}
