import sharp from "sharp";
import { detectTableCells, type TableCell } from "./table-cells.ts";
import { parseField } from "./validation.ts";
import type { Box, DocumentField } from "./types.ts";

const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const area = (box: Box) => box.width * box.height;
const intersection = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const GLYPHS: Record<string, string[]> = {
  C: ["0111", "1000", "1000", "1000", "1000", "1000", "0111"],
  0: ["0110", "1001", "1001", "1001", "1001", "1001", "0110"],
  1: ["0010", "0110", "0010", "0010", "0010", "0010", "0111"],
  2: ["0110", "1001", "0001", "0010", "0100", "1000", "1111"],
  3: ["1110", "0001", "0001", "0110", "0001", "0001", "1110"],
  4: ["1001", "1001", "1001", "1111", "0001", "0001", "0001"],
  5: ["1111", "1000", "1000", "1110", "0001", "0001", "1110"],
  6: ["0111", "1000", "1000", "1110", "1001", "1001", "0110"],
  7: ["1111", "0001", "0001", "0010", "0010", "0100", "0100"],
  8: ["0110", "1001", "1001", "0110", "1001", "1001", "0110"],
  9: ["0110", "1001", "1001", "0111", "0001", "0001", "1110"],
};

function markerPath(marker: string, x: number, y: number, unit: number) {
  let path = "";
  for (let index = 0; index < marker.length; index++) GLYPHS[marker[index]].forEach((row, dy) => [...row].forEach((pixel, dx) => {
    if (pixel === "1") path += `M${x + (index * 5 + dx) * unit} ${y + dy * unit}h${unit}v${unit}h-${unit}z`;
  }));
  return path;
}

export function matchFieldToCell(field: DocumentField, cells: TableCell[], cellId?: string): DocumentField {
  if (cellId) {
    const selected = cells.find(cell => cell.id === cellId);
    // An unknown reference must never silently select a different person's row.
    return selected ? { ...field, box: { ...selected.box } } : field;
  }
  const box = field.box;
  if (box.width < .035 || box.height < .006) return field;
  const candidates = cells.flatMap(cell => {
    const covered = intersection(box, cell.box) / area(box), filled = intersection(box, cell.box) / area(cell.box);
    if (covered < .8 || filled < .32 || cell.box.height > box.height * 2.5 || cell.box.width > box.width * 2.5) return [];
    return [{ cell, score: covered * .7 + filled * .3 }];
  }).sort((a, b) => b.score - a.score);
  if (!candidates.length || (candidates[1] && candidates[0].score - candidates[1].score < .15)) return field;
  return { ...field, box: { ...candidates[0].cell.box } };
}

export function parseCellField(value: unknown, cells: TableCell[]): DocumentField {
  if (!value || typeof value !== "object" || Array.isArray(value)) return parseField(value);
  const { cellId, ...raw } = value as Record<string, unknown>;
  if (Object.hasOwn(value, "cellId") && (typeof cellId !== "string" || !/^(?:cell_[1-9]\d{0,3})?$/.test(cellId))) throw new TypeError("표의 칸 선택을 확인하지 못했어요.");
  const field = parseField(raw);
  return cellId === "" ? field : matchFieldToCell(field, cells, cellId as string | undefined);
}

export function cellsInRegion(cells: TableCell[], region: Box): TableCell[] {
  return cells.filter(({ box }) => box.x >= region.x - 1e-7 && box.y >= region.y - 1e-7 && box.x + box.width <= region.x + region.width + 1e-7 && box.y + box.height <= region.y + region.height + 1e-7).map(cell => ({ ...cell, box: {
    x: rounded((cell.box.x - region.x) / region.width), y: rounded((cell.box.y - region.y) / region.height),
    width: rounded(cell.box.width / region.width), height: rounded(cell.box.height / region.height),
  } }));
}

export type TableCellMapping = {
  image: string;
  cells: TableCell[];
  context: { tableCells: { id: string; marker: string; box: Box }[] };
  parseField: (value: unknown) => DocumentField;
  snap: (fields: DocumentField[]) => DocumentField[];
};

// Numbered images exist only for the provider request. The user sees the original photo.
async function markCells(image: string, cells: TableCell[]): Promise<string> {
  if (!cells.length) return image;
  const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 }).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height, fontSize = Math.max(9, Math.min(16, Math.round(width / 85)));
  const marks = cells.map(cell => {
    const marker = `C${cell.id.slice(5)}`, box = cell.box;
    const left = box.x * width, top = box.y * height, right = (box.x + box.width) * width, bottom = (box.y + box.height) * height;
    const unit = fontSize / 7, tagWidth = (marker.length * 5 - 1) * unit + 4, tagHeight = fontSize + 4;
    if (right - left < tagWidth + 4 || bottom - top < tagHeight + 4) return "";
    const positions = [{ x: right - tagWidth - 2, y: top + 2 }, { x: right - tagWidth - 2, y: bottom - tagHeight - 2 }, { x: left + 2, y: bottom - tagHeight - 2 }];
    const ink = ({ x, y }: { x: number; y: number }) => {
      let count = 0;
      for (let row = Math.ceil(y); row < Math.floor(y + tagHeight); row++) for (let col = Math.ceil(x); col < Math.floor(x + tagWidth); col++) if (data[row * width + col] < 175) count++;
      return count;
    };
    positions.sort((a, b) => ink(a) - ink(b));
    const { x, y } = positions[0];
    // Keep printed letters visible; geometry remains available when no clear label site exists.
    if (ink(positions[0]) > tagWidth * tagHeight * .09) return "";
    return `<g><rect x="${x}" y="${y}" width="${tagWidth}" height="${tagHeight}" rx="2" fill="#fff8e3" fill-opacity=".9"/><path d="${markerPath(marker, x + 2, y + 2, unit)}" fill="#9a4800"/></g>`;
  }).join("");
  if (!marks) return image;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}</svg>`);
  const marked = await sharp(bytes, { limitInputPixels: 40_000_000 }).flatten({ background: "white" }).composite([{ input: svg }]).jpeg({ quality: 93 }).toBuffer();
  return `data:image/jpeg;base64,${marked.toString("base64")}`;
}

export async function prepareTableCellMapping(image: string, region?: Box, sourceCells?: TableCell[]): Promise<TableCellMapping> {
  const originalCells = sourceCells ?? await detectTableCells(image);
  const cells = region ? cellsInRegion(originalCells, region) : originalCells;
  return {
    image: await markCells(image, cells), cells,
    context: { tableCells: cells.map(({ id, box }) => ({ id, marker: `C${id.slice(5)}`, box })) },
    parseField: value => parseCellField(value, cells),
    snap: fields => fields.map(field => matchFieldToCell(field, cells)),
  };
}
