import { NextResponse } from "next/server";
import { getForm } from "@/lib/forms";

/**
 * 선택한 칸의 안내를 "더 쉬운 말로" 다시 설명한다.
 * - 등록된 공식 기준(guide) 안에서만 설명하도록 제한한다.
 * - ANTHROPIC_API_KEY가 없거나 호출이 실패하면 등록된 안내를 그대로 돌려준다(시연 안전장치).
 */
export async function POST(req: Request) {
  const { formId, fieldId, answerId } = (await req.json()) as { formId: string; fieldId: string; answerId: string };
  const form = getForm(formId);
  const guide = form?.fields.find((f) => f.id === fieldId)?.guides[answerId];
  if (!form || !guide) return NextResponse.json({ error: "unknown field" }, { status: 400 });

  const fallback = { text: `${guide.whose}. ${guide.how}`, source: "registered" as const };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json(fallback);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
        max_tokens: 400,
        system:
          "당신은 종이 서류 작성을 돕는 안내자입니다. 아래 '등록된 안내' 안의 내용만 사용해 어르신도 이해할 쉬운 한국어로 2~3문장 설명하세요. 새로운 법적 기준이나 숫자를 만들지 말고, 모르면 기관에 확인하라고 말하세요.",
        messages: [
          {
            role: "user",
            content: `양식: ${form.name}\n칸: ${form.fields.find((f) => f.id === fieldId)?.label}\n등록된 안내: ${JSON.stringify(guide)}`,
          },
        ],
      }),
    });
    if (!res.ok) return NextResponse.json(fallback);
    const data = await res.json();
    const text = data?.content?.[0]?.text as string | undefined;
    return NextResponse.json(text ? { text, source: "ai" } : fallback);
  } catch {
    return NextResponse.json(fallback);
  }
}
