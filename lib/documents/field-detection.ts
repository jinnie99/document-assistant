import sharp from "sharp";
import { MAX_DOCUMENT_FIELDS } from "./limits.ts";
import { detectTableCells } from "./table-cells.ts";
import { matchFieldToCell } from "./table-cell-mapping.ts";
import type { Box, DocumentField, DocumentReading } from "./types.ts";

export type DocumentSection = { image: string; region: Box };
export type SectionFields = { fields: DocumentField[]; region: Box };
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const imageBytes = (image: string) => Buffer.from(image.slice(image.indexOf(",") + 1), "base64");

export async function createDocumentSections(image: string): Promise<DocumentSection[]> {
  const bytes = imageBytes(image);
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  const width = metadata.width, height = metadata.height;
  if (!width || !height || width < 64 || height < 128) return [];
  const topEnd = Math.ceil(height * .56), bottomStart = Math.floor(height * .44);
  return Promise.all([{ top: 0, height: topEnd }, { top: bottomStart, height: height - bottomStart }].map(async (section) => {
    const crop = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .extract({ left: 0, top: section.top, width, height: section.height })
      .flatten({ background: "white" }).resize({ width: 2000, height: 1600, fit: "inside" })
      .jpeg({ quality: 92 }).toBuffer();
    return { image: `data:image/jpeg;base64,${crop.toString("base64")}`, region: { x: 0, y: section.top / height, width: 1, height: section.height / height } };
  }));
}

export function mapSectionFields(fields: DocumentField[], region: Box): DocumentField[] {
  return fields.map((field) => {
    const x = rounded(region.x + field.box.x * region.width), y = rounded(region.y + field.box.y * region.height);
    return { ...field, box: { x, y, width: rounded(Math.min(1 - x, field.box.width * region.width)), height: rounded(Math.min(1 - y, field.box.height * region.height)) } };
  });
}

export function knownFieldsInSection(fields: DocumentField[], region: Box) {
  return fields.flatMap(({ id, label, printedHint, box }) => {
    const left = Math.max(box.x, region.x), top = Math.max(box.y, region.y);
    const right = Math.min(box.x + box.width, region.x + region.width), bottom = Math.min(box.y + box.height, region.y + region.height);
    if (right <= left || bottom <= top) return [];
    return [{ id, label, printedHint: printedHint.slice(0, 160), box: { x: rounded((left - region.x) / region.width), y: rounded((top - region.y) / region.height), width: rounded((right - left) / region.width), height: rounded((bottom - top) / region.height) } }];
  });
}

function labelKey(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}⁰¹²³⁴⁵⁶⁷⁸⁹]/gu, ""); }
function itemKey(field: DocumentField) { return labelKey(field.label).replace(/선택(?:란)?$/, "").replace(/신청인신청자격/g, "신청인자격"); }
function roleIn(value: string) {
  const known = value.replace(/\s/g, "").match(/신청대상자|발급대상자|급여대상자|대리신청인|신청인|대리인|위임인|보호자|부양의무자|세대주|세대원|증인|신고인|제출인|출생자|본인/)?.[0];
  if (known) return /신청대상자|발급대상자/.test(known) ? "발급대상자" : known;
  const father = /(?:^|[\s/·(])부(?:의|\s|\/|·|\(|$)|아버지/.test(value);
  const mother = /(?:^|[\s/·(])모(?:의|\s|\/|·|\(|$)|어머니/.test(value);
  return father && mother ? "부·모" : father ? "부" : mother ? "모" : undefined;
}
function role(field: DocumentField) { return roleIn(field.label) || roleIn(field.printedHint); }
function sectionKey(field: DocumentField) { return labelKey(field.printedHint.match(/\[([^\]]+)\]/)?.[1] || ""); }
function overlap(a: Box, b: Box) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection || 1);
}
function sameMeaning(a: DocumentField, b: DocumentField) {
  const aLabel = itemKey(a), bLabel = itemKey(b);
  if (!aLabel || !bLabel || !(aLabel === bLabel || aLabel.includes(bLabel) || bLabel.includes(aLabel))) return false;
  // A value, its disclosure choice, and instructions mentioning it are separate units.
  const kind = (value: string) => /(?:기재|작성).*안내|안내문/.test(value) ? "instruction" : /공개|비공개|동의|여부/.test(value) ? "choice" : "value";
  if (kind(aLabel) !== kind(bLabel)) return false;
  const aNumbers = aLabel.match(/\d+/g), bNumbers = bLabel.match(/\d+/g);
  if (aNumbers && bNumbers && aNumbers.join(",") !== bNumbers.join(",")) return false;
  const aRole = role(a), bRole = role(b);
  if (aRole && bRole && aRole !== bRole) return false;
  const aSection = sectionKey(a), bSection = sectionKey(b);
  if (aSection && bSection && aSection !== bSection) return false;
  return true;
}
function samePosition(a: DocumentField, b: DocumentField) {
  const centerY = Math.abs(a.box.y + a.box.height / 2 - b.box.y - b.box.height / 2);
  return overlap(a.box, b.box) >= .3 && centerY <= Math.max(a.box.height, b.box.height) * .65;
}
function edgeClipped(field: DocumentField, region: Box) {
  return (region.y > 0 && field.box.y < region.y + .004) || (region.y + region.height < 1 && field.box.y + field.box.height > region.y + region.height - .004);
}

export function mergeFieldReadings(full: DocumentReading, sections: SectionFields[], failedSections = 0, options: { preserveIds?: boolean; cellBoxes?: Box[] } = {}): DocumentReading {
  const usedIds = new Set(full.fields.map(field => field.id));
  let nextId = 1;
  const additionId = () => { while (usedIds.has(`field_${nextId}`)) nextId++; const id = `field_${nextId++}`; usedIds.add(id); return id; };
  const passes = [full.fields, ...sections.map(section => section.fields)];
  const uniqueInPass = (field: DocumentField, pass: number) => passes[pass].filter(item => sameMeaning(item, field)).length === 1;
  const cellIndex = (field: DocumentField) => options.cellBoxes?.findIndex(box => overlap(box, field.box) > .94) ?? -1;
  const candidates = full.fields.map(field => ({ field, score: field.confidence, passes: new Set([0]) }));
  for (const [sectionIndex, section] of sections.entries()) for (const field of section.fields) {
    if (field.box.width <= 0 || field.box.height <= 0) continue;
    const pass = sectionIndex + 1;
    const score = field.confidence + .4 - (edgeClipped(field, section.region) ? .7 : 0);
    const targetCell = cellIndex(field);
    const compatible = candidates.filter(candidate => {
      if (candidate.passes.has(pass) || !sameMeaning(candidate.field, field)) return false;
      const existingCell = cellIndex(candidate.field);
      return targetCell < 0 || existingCell < 0 || targetCell === existingCell;
    });
    const positioned = compatible.filter(candidate => samePosition(candidate.field, field)).sort((a, b) => overlap(b.field.box, field.box) - overlap(a.field.box, field.box));
    const candidate = positioned[0] || compatible.find(candidate => {
      const specific = Boolean(role(candidate.field) && role(field)) || Math.min(itemKey(candidate.field).length, itemKey(field).length) >= 5;
      return specific && uniqueInPass(field, pass) && [...candidate.passes].every(source => uniqueInPass(candidate.field, source));
    });
    if (!candidate) candidates.push({ field: options.preserveIds ? { ...field, id: additionId() } : field, score, passes: new Set([pass]) });
    else {
      candidate.passes.add(pass);
      // 위치가 크게 다르면 더 넓은 원본 문맥에서 얻은 기존 박스를 보존한다.
      if (samePosition(candidate.field, field) && score > candidate.score) { candidate.field = options.preserveIds ? { ...field, id: candidate.field.id } : field; candidate.score = score; }
    }
  }
  if (!options.preserveIds) candidates.sort((a, b) => Math.abs(a.field.box.y - b.field.box.y) > Math.min(a.field.box.height, b.field.box.height) * .5 ? a.field.box.y - b.field.box.y : a.field.box.x - b.field.box.x);
  const warnings: string[] = [];
  if (failedSections) warnings.push("사진의 일부 확대 확인을 마치지 못했어요. 빠진 칸은 직접 골라 주세요.");
  if (candidates.length > MAX_DOCUMENT_FIELDS) warnings.push("칸이 많아 일부 항목은 빠졌을 수 있어요. 빠진 칸은 직접 골라 주세요.");
  warnings.push(...full.warnings);
  return { ...full, warnings: [...new Set(warnings)].slice(0, 8), fields: candidates.slice(0, MAX_DOCUMENT_FIELDS).map(({ field }, index) => ({ ...field, id: options.preserveIds ? field.id : `field_${index + 1}` })) };
}

export async function snapFieldsToGrid(image: string, fields: DocumentField[]): Promise<DocumentField[]> {
  return (await prepareFieldGrid(image))(fields);
}

export async function prepareFieldGrid(image: string): Promise<(fields: DocumentField[]) => DocumentField[]> {
  const cells = await detectTableCells(image);
  return fields => fields.map(field => matchFieldToCell(field, cells));
}
