export type Normalized = { url: string; dataUrl: string; w: number; h: number; warnings: string[] };

const MAX_EDGE = 2000;
const API_EDGE = 2000;

/** 이미지 파일을 EXIF 회전 보정 + 축소해 JPEG로 만들고, 품질 경고를 계산한다. 전부 브라우저에서 처리. */
export async function normalizeImage(file: File): Promise<Normalized> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("이 이미지를 열 수 없어요. HEIC 사진은 JPEG로 바꾸거나 사진 앱에서 '호환 가능' 형식으로 공유해 주세요.");
  }
  const draw = (edge: number) => {
    const s = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const context = c.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, c.width, c.height);
    context.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  };
  const main = draw(MAX_EDGE);
  const blob = await new Promise<Blob>((res, rej) => main.toBlob((b) => (b ? res(b) : rej(new Error("변환 실패"))), "image/jpeg", 0.9));
  const warnings = quality(draw(256), Math.min(bmp.width, bmp.height));
  const dataUrl = draw(API_EDGE).toDataURL("image/jpeg", 0.9);
  const out = { url: URL.createObjectURL(blob), dataUrl, w: main.width, h: main.height, warnings };
  bmp.close();
  return out;
}

/** 어두움·흐림·해상도를 간단히 점검한다(경고만 하고 막지 않는다). */
function quality(c: HTMLCanvasElement, minEdge: number): string[] {
  const { width: w, height: h } = c;
  const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    sum += g[i];
  }
  const mean = sum / (w * h);
  let acc = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      acc += lap * lap;
      n++;
    }
  const sharp = acc / n;
  const out: string[] = [];
  if (minEdge < 800) out.push("해상도가 낮아요. 가까이에서 다시 찍으면 더 정확해요.");
  if (mean < 70) out.push("사진이 어두워요. 밝은 곳에서 다시 찍어 주세요.");
  if (sharp < 40) out.push("사진이 흐려 보여요. 손을 고정하고 다시 찍어 주세요.");
  return out;
}
