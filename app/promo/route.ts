import { readFile } from "node:fs/promises";
import path from "node:path";

/** 출품용 시연영상(submit/홍보영상.html) 한 파일을 그대로 보여준다. 파일을 따로 복사하지 않아 내용이 어긋나지 않는다. */
export async function GET() {
  const html = await readFile(path.join(process.cwd(), "submit", "홍보영상.html"));
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
