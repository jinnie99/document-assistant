import { identifyFromText } from "@/lib/identify";

export type PdfHandle = {
  numPages: number;
  /** 쪽별 양식 식별 결과(텍스트 층 기준, 없으면 undefined) */
  matches: (string | undefined)[];
  /** 텍스트 층이 거의 없는 쪽(스캔본) 여부 */
  scanned: boolean[];
  render: (page: number) => Promise<{ url: string; dataUrl: string; w: number; h: number }>;
};

const MAX_PAGES = 30;

/** PDF를 열어 쪽별로 양식을 식별하고, 선택한 쪽을 이미지로 렌더링한다. 전부 브라우저에서 처리. */
export async function openPdf(file: File): Promise<PdfHandle> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (doc.numPages > MAX_PAGES) throw new Error(`${MAX_PAGES}쪽 이하의 PDF만 올릴 수 있어요. 필요한 쪽만 따로 저장해서 올려 주세요.`);

  const matches: (string | undefined)[] = [];
  const scanned: boolean[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    matches.push(identifyFromText(text));
    scanned.push(text.replace(/\s/g, "").length < 20);
  }

  const render = async (n: number) => {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 1600 / base.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("변환 실패"))), "image/png"));
    return { url: URL.createObjectURL(blob), dataUrl: c.toDataURL("image/jpeg", 0.8), w: c.width, h: c.height };
  };

  return { numPages: doc.numPages, matches, scanned, render };
}
