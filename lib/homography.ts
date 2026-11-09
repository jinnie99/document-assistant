export type Pt = [number, number];

/** 4쌍의 대응점으로 원근 변환(src → dst) 행렬 H(3x3, 행 우선, h33=1)를 구한다. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  // 가우스 소거법(부분 피벗)
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((r) => r[8]), 1];
}

export function applyH(h: number[], [x, y]: Pt): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export const FULL_QUAD: Pt[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export const INSET_QUAD: Pt[] = [
  [0.08, 0.08],
  [0.92, 0.08],
  [0.92, 0.92],
  [0.08, 0.92],
];

/** 템플릿(w×h px) 위의 %-상자 4모서리를, 이미지 정규화 좌표(0~1)로 옮긴 점들 */
export function boxToImage(box: { x: number; y: number; w: number; h: number }, tpl: { w: number; h: number }, quad: Pt[]): Pt[] {
  const H = homography(
    [
      [0, 0],
      [tpl.w, 0],
      [tpl.w, tpl.h],
      [0, tpl.h],
    ],
    quad,
  );
  const x0 = (box.x / 100) * tpl.w;
  const y0 = (box.y / 100) * tpl.h;
  const x1 = x0 + (box.w / 100) * tpl.w;
  const y1 = y0 + (box.h / 100) * tpl.h;
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]).map((p) => applyH(H, p));
}
