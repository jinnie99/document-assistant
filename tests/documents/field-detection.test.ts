import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mapSectionFields, mergeFieldReadings, createDocumentSections, snapFieldsToGrid } from "../../lib/documents/field-detection.ts";
import type { DocumentField, DocumentReading } from "../../lib/documents/types.ts";

const field = (patch: Partial<DocumentField> = {}): DocumentField => ({ id: "same", label: "성명", printedHint: "신청인", confidence: .9, box: { x: .1, y: .2, width: .6, height: .06 }, ...patch });
const reading = (fields: DocumentField[]): DocumentReading => ({ title: "원본 신청서", institution: "기관", formNumber: "제1호", revision: "2026", readable: true, warnings: [], fields });

test("preserveIds retains original IDs through coordinate correction and gives every crop addition a fresh ID", () => {
  const full = reading([field({ id: "field_2" }), field({ id: "original", label: "주소", box: { x: .1, y: .6, width: .6, height: .06 } })]);
  const result = mergeFieldReadings(full, [{ fields: [field({ id: "colliding", confidence: .99, box: { x: .11, y: .2, width: .59, height: .06 } }), field({ id: "field_2", label: "연락처", box: { x: .1, y: .4, width: .6, height: .06 } })], region: { x: 0, y: 0, width: 1, height: 1 } }], 0, { preserveIds: true });
  assert.equal(result.fields.find(item => item.label === "성명")?.id, "field_2");
  assert.equal(result.fields.find(item => item.label === "주소")?.id, "original");
  assert.equal(new Set(result.fields.map(item => item.id)).size, 3);
  assert.ok(!["field_2", "original"].includes(result.fields.find(item => item.label === "연락처")!.id));
});

test("부분 이미지의 상대 좌표를 실제 원본 영역으로 정확하게 환산한다", () => {
  const result = mapSectionFields([field()], { x: .05, y: .44, width: .9, height: .56 });
  assert.deepEqual(result[0].box, { x: .14, y: .552, width: .54, height: .0336 });
});

test("겹친 부분의 같은 칸만 합치고 다른 줄의 같은 성명·다른 사람 칸은 남긴다", () => {
  const full = reading([field(), field({ id: "second", printedHint: "대리인", box: { x: .1, y: .6, width: .6, height: .06 } })]);
  const section = [field({ box: { x: .11, y: .201, width: .59, height: .059 }, confidence: .92 }), field({ label: "주민등록번호", printedHint: "신청인", box: { x: .1, y: .3, width: .6, height: .06 } })];
  const result = mergeFieldReadings(full, [{ fields: section, region: { x: 0, y: 0, width: 1, height: .56 } }]);
  assert.equal(result.title, full.title);
  assert.equal(result.fields.length, 3);
  assert.equal(result.fields.filter(f => f.label === "성명").length, 2);
  assert.equal(new Set(result.fields.map(f => f.id)).size, 3);
  assert.equal(result.fields.find(f => f.label === "주민등록번호")?.printedHint, "신청인");
});

test("빈칸 24개를 넘어 80개까지 보존하고 초과 시 누락 가능 경고를 남긴다", () => {
  const fields = Array.from({ length: 81 }, (_, i) => field({ id: `f_${i}`, label: `항목${i}`, box: { x: .1, y: i / 100, width: .6, height: .008 } }));
  const result = mergeFieldReadings(reading(fields.slice(0, 40)), [{ fields: fields.slice(40), region: { x: 0, y: 0, width: 1, height: 1 } }]);
  assert.equal(result.fields.length, 80);
  assert.ok(result.warnings.some(w => /많|일부/.test(w)));
});

test("원본 경고가 많더라도 확대 확인 실패 경고가 잘리지 않는다", () => {
  const full = { ...reading([field()]), warnings: Array.from({ length: 8 }, (_, i) => `원본 주의 ${i + 1}`) };
  const result = mergeFieldReadings(full, [], 1);
  assert.equal(result.warnings.length, 8);
  assert.ok(result.warnings.some(warning => /확인.*못/.test(warning)));
});

test("상·하단 이미지에는 겹침이 있으며 실제 픽셀 경계의 비율을 제공한다", async () => {
  const bytes = await sharp({ create: { width: 600, height: 1001, channels: 3, background: "white" } }).png().toBuffer();
  const sections = await createDocumentSections(`data:image/png;base64,${bytes.toString("base64")}`);
  assert.equal(sections.length, 2);
  assert.ok(sections[0].region.y + sections[0].region.height > sections[1].region.y);
  assert.ok(Math.abs(sections[1].region.y + sections[1].region.height - 1) < 1e-9);
  for (const section of sections) assert.ok(section.image.startsWith("data:image/jpeg;base64,"));
});

test("닫힌 표 경계가 모두 확인되는 가까운 칸만 선에 맞추고 선 없는 칸은 보존한다", async () => {
  const width = 500, height = 500;
  const pixels = Buffer.alloc(width * height, 255);
  for (let x = 100; x <= 400; x++) { pixels[100 * width + x] = 0; pixels[150 * width + x] = 0; }
  for (let y = 100; y <= 150; y++) { pixels[y * width + 100] = 0; pixels[y * width + 400] = 0; }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const image = `data:image/png;base64,${bytes.toString("base64")}`;
  const input = [field({ box: { x: .204, y: .204, width: .592, height: .092 } }), field({ id: "free", label: "기타", box: { x: .2, y: .6, width: .6, height: .1 } })];
  const result = await snapFieldsToGrid(image, input);
  assert.deepEqual(result[0].box, { x: .2, y: .2, width: .6, height: .1 });
  assert.deepEqual(result[1].box, input[1].box);
});

test("실제 가족관계 서류의 한 행 차이와 신청인 신청 자격 변형은 교차 패스에서 합친다", () => {
  const full = [
    field({ label: "신청인 휴대전화번호 등", printedHint: "신청인", box: { x: .57, y: .673, width: .347, height: .021 } }),
    field({ label: "신청인 신청 자격", printedHint: "신청인", box: { x: .650177, y: .650625, width: .265901, height: .020625 } }),
    field({ label: "위임인 성명", printedHint: "위임인", box: { x: .241166, y: .691875, width: .29682, height: .021875 } }),
  ];
  const section = [
    field({ label: "신청인 휴대전화번호 등", printedHint: "신청인", box: { x: .650177, y: .650625, width: .265018, height: .020625 } }),
    field({ label: "신청인 자격", printedHint: "신청인", box: { x: .652, y: .63824, width: .263, height: .01904 } }),
    field({ label: "위임인 성명", printedHint: "위임인", box: { x: .242, y: .67688, width: .296, height: .02072 } }),
  ];
  const result = mergeFieldReadings(reading(full), [{ fields: section, region: { x: 0, y: .44, width: 1, height: .56 } }]);
  assert.equal(result.fields.length, 3);
  assert.deepEqual(result.fields.find(f => /휴대전화/.test(f.label))?.box, full[0].box);
});

test("실제 가족관계 포함 선택란은 선택 접미사와 큰 좌표 차이가 있어도 패스별 유일하면 합친다", () => {
  const full = field({ label: "특정증명서 교부 신청 시 등록기준지 포함 선택", printedHint: "특정증명서 교부 신청을 하는 경우에만 선택", box: { x: .368, y: .474, width: .012, height: .012 } });
  const section = field({ label: "등록기준지 포함", printedHint: "특정증명서 교부 신청을 하는 경우에만 선택", box: { x: .795, y: .47024, width: .013, height: .00896 } });
  const result = mergeFieldReadings(reading([full]), [{ fields: [section], region: { x: 0, y: .44, width: 1, height: .56 } }]);
  assert.equal(result.fields.length, 1);
  assert.deepEqual(result.fields[0].box, full.box);
});

test("같은 패스의 반복 행과 부·모·신청인·위임인의 같은 항목은 합치지 않는다", () => {
  const roles = ["부", "모", "신청인", "위임인"];
  const full = roles.map(printedHint => field({ label: "주민등록번호", printedHint }));
  const result = mergeFieldReadings(reading(full), [{ fields: [field({ label: "주민등록번호", printedHint: "모", confidence: .99 })], region: { x: 0, y: 0, width: 1, height: .56 } }]);
  assert.equal(result.fields.length, 4);
  assert.deepEqual(new Set(result.fields.map(f => f.printedHint)), new Set(roles));
  const repeated = mergeFieldReadings(reading([]), [{ fields: [field(), field({ id: "next-row" })], region: { x: 0, y: 0, width: 1, height: .56 } }]);
  assert.equal(repeated.fields.length, 2);
});

test("같은 패스에 이름이 반복되면 멀리 있는 다른 행을 유일 항목으로 추정해 합치지 않는다", () => {
  const full = [field({ printedHint: "", box: { x: .1, y: .1, width: .6, height: .03 } }), field({ id: "second", printedHint: "", box: { x: .1, y: .2, width: .6, height: .03 } })];
  const result = mergeFieldReadings(reading(full), [{ fields: [field({ printedHint: "", box: { x: .1, y: .5, width: .6, height: .03 } })], region: { x: 0, y: 0, width: 1, height: .56 } }]);
  assert.equal(result.fields.length, 3);
});

test("성명과 한자는 서로 다른 작성 영역이므로 같은 박스로 판독돼도 임의로 합치지 않는다", () => {
  const result = mergeFieldReadings(reading([field({ label: "성명" })]), [{ fields: [field({ label: "한자" })], region: { x: 0, y: 0, width: 1, height: .56 } }]);
  assert.equal(result.fields.length, 2);
});

test("주민등록번호 기입칸을 공개 여부 선택란과 같은 항목으로 합쳐 버리지 않는다", () => {
  const disclosure = field({ label: "주민등록번호 공개신청 여부", printedHint: "신청 대상자 본인만 공개", box: { x: .2, y: .5, width: .3, height: .05 } });
  const number = field({ label: "주민등록번호", printedHint: "신청 대상자", box: { x: .3, y: .2, width: .6, height: .04 } });
  const result = mergeFieldReadings(reading([disclosure]), [{ fields: [number], region: { x: 0, y: 0, width: 1, height: .56 } }], 0, { preserveIds: true });
  assert.equal(result.fields.length, 2);
  assert.deepEqual(result.fields[1].box, number.box);
});

test("다른 실제 셀에 연결된 동명 항목은 역할 문구가 짧아도 각각 보존한다", () => {
  const first = field({ label: "주민등록번호", printedHint: "", box: { x: .3, y: .2, width: .6, height: .05 } });
  const second = field({ label: "주민등록번호", printedHint: "", box: { x: .3, y: .25, width: .6, height: .05 } });
  const result = mergeFieldReadings(reading([first]), [{ fields: [second], region: { x: 0, y: 0, width: 1, height: 1 } }], 0, { preserveIds: true, cellBoxes: [first.box, second.box] });
  assert.equal(result.fields.length, 2);
});
