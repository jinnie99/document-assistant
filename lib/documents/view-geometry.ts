import type { Box } from "./types.ts";

export type PhotoSize = { width: number; height: number };
export type Point = { x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function fieldCrop(box: Box): Box {
  const width = Math.min(.46, Math.max(.12, box.width + .025));
  const height = Math.min(.12, Math.max(.035, box.height + .018));
  const x = clamp(box.x - (box.width > .46 ? .14 : .0125), 0, 1 - width);
  const y = clamp(box.height > height ? box.y - .009 : box.y + box.height / 2 - height / 2, 0, 1 - height);
  return { x, y, width, height };
}

export function pixelBox(box: Box, photo: PhotoSize): Box {
  return { x: box.x * photo.width, y: box.y * photo.height, width: box.width * photo.width, height: box.height * photo.height };
}
function bounded(view: Box, bounds: PhotoSize): Box {
  const width = clamp(view.width, bounds.width / 20, bounds.width);
  const height = clamp(view.height, bounds.height / 20, bounds.height);
  return { x: clamp(view.x, 0, bounds.width - width), y: clamp(view.y, 0, bounds.height - height), width, height };
}
export function fitViewport(view: Box, aspect: number, bounds: PhotoSize): Box {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : bounds.width / bounds.height;
  let width = view.width, height = view.height;
  if (width / height < ratio) width = height * ratio; else height = width / ratio;
  if (width > bounds.width || height > bounds.height) return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return bounded({ x: view.x + view.width / 2 - width / 2, y: view.y + view.height / 2 - height / 2, width, height }, bounds);
}
export function zoomViewport(view: Box, factor: number, bounds: PhotoSize, anchor?: Point): Box {
  const center = anchor ?? { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const width = clamp(view.width / safeFactor, bounds.width / 20, bounds.width);
  const height = clamp(view.height / safeFactor, bounds.height / 20, bounds.height);
  return bounded({ x: center.x - (center.x - view.x) * width / view.width, y: center.y - (center.y - view.y) * height / view.height, width, height }, bounds);
}
export function panViewport(view: Box, dx: number, dy: number, bounds: PhotoSize): Box {
  return bounded({ ...view, x: view.x + dx, y: view.y + dy }, bounds);
}
export function pointInPhoto(point: Point, rect: { left: number; top: number; width: number; height: number }, view: Box): Point {
  const scale = Math.max(.00001, Math.min(rect.width / view.width, rect.height / view.height));
  const left = rect.left + (rect.width - view.width * scale) / 2;
  const top = rect.top + (rect.height - view.height * scale) / 2;
  return { x: clamp(view.x + (point.x - left) / scale, view.x, view.x + view.width), y: clamp(view.y + (point.y - top) / scale, view.y, view.y + view.height) };
}
export function selectionBox(start: Point, end: Point, bounds: PhotoSize): Box {
  return { x: clamp(Math.min(start.x, end.x) / bounds.width, 0, 1), y: clamp(Math.min(start.y, end.y) / bounds.height, 0, 1), width: clamp(Math.abs(end.x - start.x) / bounds.width, 0, 1), height: clamp(Math.abs(end.y - start.y) / bounds.height, 0, 1) };
}
