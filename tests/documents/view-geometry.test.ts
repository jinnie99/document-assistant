import test from "node:test";
import assert from "node:assert/strict";
import { fieldCrop, fitViewport, zoomViewport, panViewport, pointInPhoto, selectionBox } from "../../lib/documents/view-geometry.ts";

test("selected fields use a tight crop and wide fields start larger", () => {
  const crop = fieldCrop({ x: .3, y: .2, width: .6, height: .03 });
  assert.ok(crop.x > .15);
  assert.ok(crop.width <= .46);
  assert.ok(crop.y <= .2 && crop.y + crop.height >= .23);
  const edge = fieldCrop({ x: .98, y: .98, width: .02, height: .02 });
  assert.ok(edge.x + edge.width <= 1 && edge.y + edge.height <= 1);
});
test("large writing areas initially show their beginning rather than shrinking the entire area", () => {
  const crop = fieldCrop({ x: .1, y: .4, width: .8, height: .3 });
  assert.ok(crop.width <= .46 && crop.height <= .12);
  assert.ok(crop.y <= .4 && crop.y + crop.height > .4);
});

test("wide blank fields retain their printed label while narrow manual fields keep their tight crop", () => {
  const family = { x: .358657, y: .145, width: .55742, height: .024375 };
  const wide = fieldCrop(family);
  assert.ok(wide.x <= .25, "the printed name label at x=.25 remains visible");
  assert.ok(wide.x + wide.width > family.x + .2, "the start of the writing area remains visible");
  assert.equal(wide.width, .46);
  const narrow = fieldCrop({ x: .65, y: .2, width: .26, height: .03 });
  assert.ok(Math.abs(narrow.x - .6375) < .000001);
  assert.ok(Math.abs(narrow.width - .285) < .000001);
  assert.equal(fieldCrop({ x: .08, y: .4, width: .84, height: .3 }).x, 0);
});
test("viewport zoom and pan stay within the photo and preserve their center", () => {
  const bounds = { width: 1000, height: 1500 };
  const zoom = zoomViewport({ x: 200, y: 300, width: 600, height: 800 }, 2, bounds);
  assert.deepEqual(zoom, { x: 350, y: 500, width: 300, height: 400 });
  assert.deepEqual(panViewport(zoom, 9999, -9999, bounds), { x: 700, y: 0, width: 300, height: 400 });
  const fit = fitViewport({ x: 100, y: 200, width: 100, height: 100 }, .5, bounds);
  assert.equal(fit.width / fit.height, .5);
});
test("show all retains every edge when the photo and viewport have different proportions", () => {
  assert.deepEqual(fitViewport({ x: 0, y: 0, width: 1000, height: 1500 }, 2, { width: 1000, height: 1500 }), { x: 0, y: 0, width: 1000, height: 1500 });
});
test("pointer mapping accounts for letterboxing rather than shifting the selected field", () => {
  const point = pointInPhoto({ x: 50, y: 50 }, { left: 0, top: 0, width: 200, height: 100 }, { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(point, { x: 0, y: 50 });
  assert.deepEqual(selectionBox({ x: 800, y: 1200 }, { x: 200, y: 300 }, { width: 1000, height: 1500 }), { x: .2, y: .2, width: .6, height: .6 });
});
