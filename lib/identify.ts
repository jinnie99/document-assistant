import { forms } from "@/lib/forms";

const norm = (s: string) => s.replace(/\s+/g, "");

/**
 * PDF 텍스트 층에서 양식 제목을 찾아 양식 ID를 돌려준다. (AI 없이, 정확)
 * 다른 양식 제목이 본문에 함께 나올 수 있어(예: 신청서 첨부서류 속 '기술 규격서'),
 * 텍스트에서 가장 앞에 나오는 제목을 고른다.
 */
export function identifyFromText(text: string): string | undefined {
  const t = norm(text);
  let best: { id: string; at: number } | undefined;
  for (const f of forms) {
    const at = t.indexOf(norm(f.titleKey));
    if (at >= 0 && (!best || at < best.at)) best = { id: f.id, at };
  }
  return best?.id;
}
