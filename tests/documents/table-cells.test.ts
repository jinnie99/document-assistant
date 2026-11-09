import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectTableCells } from "../../lib/documents/table-cells.ts";

async function image(lines: [number, number, number, number, string?][], width = 600, height = 500) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${lines.map(([x1, y1, x2, y2, color]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || "black"}" stroke-width="2"/>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const near = (actual: number, expected: number, tolerance = .005) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);

test("global cell detection follows complete borders even when there is no proposed text box", async () => {
  const cells = await detectTableCells(await image([[60, 50, 540, 50], [60, 150, 540, 150], [60, 250, 540, 250], [60, 50, 60, 250], [300, 50, 300, 250], [540, 50, 540, 250]]));
  assert.equal(cells.length, 4);
  assert.deepEqual(cells.map(cell => cell.id), ["cell_1", "cell_2", "cell_3", "cell_4"]);
  near(cells[0].box.x, .1); near(cells[0].box.y, .1);
  near(cells[0].box.width, .4); near(cells[0].box.height, .2);
  near(cells[3].box.x, .5); near(cells[3].box.y, .3);
  assert.ok(cells.every(cell => cell.confidence >= .8));
});

test("a separator absent from the lower row produces one merged cell rather than an invented grid", async () => {
  const bytes = await image([[60, 50, 540, 50], [60, 150, 540, 150], [60, 250, 540, 250], [60, 50, 60, 250], [300, 50, 300, 150], [540, 50, 540, 250]]);
  const cells = await detectTableCells(`data:image/png;base64,${bytes.toString("base64")}`);
  assert.equal(cells.length, 3);
  near(cells[2].box.x, .1); near(cells[2].box.y, .3);
  near(cells[2].box.width, .8); near(cells[2].box.height, .2);
});

test("a vertical merged cell keeps its full height across neighbouring row boundaries", async () => {
  const cells = await detectTableCells(await image([[60, 50, 540, 50], [300, 150, 540, 150], [60, 250, 540, 250], [60, 50, 60, 250], [300, 50, 300, 250], [540, 50, 540, 250]]));
  assert.equal(cells.length, 3);
  near(cells[0].box.x, .1); near(cells[0].box.height, .4);
  assert.ok(cells.every(cell => cell.box.width < .5));
});

test("small scan gaps are repaired while isolated noise does not subdivide a cell", async () => {
  const cells = await detectTableCells(await image([[60, 50, 250, 50], [253, 50, 540, 50], [60, 150, 540, 150], [60, 50, 60, 150], [540, 50, 540, 150], [200, 90, 215, 90], [400, 93, 400, 100]]));
  assert.equal(cells.length, 1);
  near(cells[0].box.width, .8);
});

test("an open table is not converted to a closed rectangle", async () => {
  assert.deepEqual(await detectTableCells(await image([[60, 50, 540, 50], [60, 150, 540, 150], [60, 50, 60, 150]])), []);
});

test("plain pages and short text-like strokes produce no table cells", async () => {
  const strokes: [number, number, number, number][] = [];
  for (let y = 50; y < 400; y += 30) for (let x = 60; x < 500; x += 20) strokes.push([x, y, x + 9, y], [x, y, x, y + 12]);
  assert.deepEqual(await detectTableCells(await image([])), []);
  assert.deepEqual(await detectTableCells(await image(strokes)), []);
});

test("red annotation rectangles are excluded while green form ruling stays detectable", async () => {
  const cells = await detectTableCells(await image([[60, 50, 540, 50, "#00994d"], [60, 150, 540, 150, "#00994d"], [60, 50, 60, 150, "#00994d"], [540, 50, 540, 150, "#00994d"], [100, 70, 280, 70, "red"], [100, 130, 280, 130, "red"], [100, 70, 100, 130, "red"], [280, 70, 280, 130, "red"]]));
  assert.equal(cells.length, 1);
  near(cells[0].box.x, .1); near(cells[0].box.y, .1);
  near(cells[0].box.width, .8);
});

test("red annotation covering an existing border is bridged using the surviving green ruling", async () => {
  const cells = await detectTableCells(await image([[60, 50, 540, 50, "#00994d"], [60, 150, 540, 150, "#00994d"], [60, 250, 540, 250, "#00994d"], [60, 50, 60, 250, "#00994d"], [400, 50, 400, 250, "#00994d"], [540, 50, 540, 250, "#00994d"], [60, 50, 260, 50, "red"], [60, 130, 260, 130, "red"], [60, 50, 60, 130, "red"], [260, 50, 260, 130, "red"]]));
  assert.equal(cells.length, 4);
  near(cells[0].box.x, .1); near(cells[0].box.y, .1);
  near(cells[0].box.width, 340 / 600); near(cells[0].box.height, .2);
});
