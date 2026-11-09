import { NextResponse } from "next/server";
import { forms } from "@/lib/forms";

/**
 * 사진 속 양식이 등록 양식 중 무엇인지 식별한다.
 * - 이미지는 식별에만 쓰고 저장·로그하지 않는다.
 * - ANTHROPIC_API_KEY가 없거나 실패하면 formId=null을 돌려주고, 화면에서 사용자가 직접 고른다.
 */
const MAX_BYTES = 6 * 1024 * 1024;

export async function POST(req: Request) {
  const { image } = (await req.json()) as { image?: string };
  const m = image?.match(/^data:(image\/jpeg|image\/png);base64,(.+)$/);
  if (!m || m[2].length > MAX_BYTES) return NextResponse.json({ error: "invalid image" }, { status: 400 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ formId: null, confidence: 0, reason: "no-key" });

  const list = forms.map((f) => `- ${f.id}: ${f.name} (제목: ${f.titleKey})`).join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
        max_tokens: 100,
        system: `사진 속 종이 서식이 아래 등록 양식 중 무엇인지 고르세요. 확실하지 않으면 formId를 null로 하세요. JSON 한 줄만 출력: {"formId":"<id 또는 null>","confidence":0~1}\n${list}`,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }, { type: "text", text: "이 서식은 어떤 양식인가요?" }] }],
      }),
    });
    if (!res.ok) return NextResponse.json({ formId: null, confidence: 0, reason: "ai-error" });
    const text: string = (await res.json())?.content?.[0]?.text ?? "";
    const j = text.match(/\{[^}]*\}/)?.[0];
    const parsed = j ? JSON.parse(j) : {};
    const ok = forms.some((f) => f.id === parsed.formId);
    return NextResponse.json({ formId: ok ? parsed.formId : null, confidence: ok ? Number(parsed.confidence) || 0 : 0, reason: ok ? "ai" : "unknown" });
  } catch {
    return NextResponse.json({ formId: null, confidence: 0, reason: "ai-error" });
  }
}
