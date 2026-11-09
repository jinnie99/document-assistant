import Link from "next/link";
import { Camera, TriangleAlert } from "lucide-react";
import { ServicesStack } from "@/components/ui/services-stack";
import { SiteFooter } from "@/components/site-footer";
import { forms } from "@/lib/forms";

export default function Home() {
  return (
    <div id="top" className="min-h-screen bg-[#F3F5F7] text-[#1F2933]" style={{ fontFamily: "var(--font-ui)" }}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <span className="text-xl font-bold">서류도우미</span>
        <Link href="/try" className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl border-2 border-[#285A88] bg-white px-5 text-base font-bold text-[#285A88] hover:bg-[#DCE8F3]">
          <Camera className="size-6" /> 체험하기
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
        <div className="rounded-3xl border border-[#D5DBE1] bg-white p-6 shadow-[0_1px_2px_rgba(31,41,51,.06)] sm:p-12">
          <span className="inline-block rounded-full bg-[#E6EBF0] px-4 py-1.5 text-base font-bold text-[#1F4A73]">2026 공공 AI 대전환 챌린지</span>
          <h1 className="mt-5 max-w-3xl text-[clamp(2rem,5vw,3.25rem)] font-bold leading-tight">사진 기반 서류 작성 도우미</h1>
          <p className="mt-4 max-w-2xl text-[1.45rem] font-bold leading-snug">내 상황에 맞게, 막힌 칸부터 한 칸씩</p>
          <p className="mt-3 max-w-2xl text-lg text-[#52606D]">종이 양식의 칸과 공식 작성 기준, 신청자의 상황을 연결합니다.</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/try" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#285A88] to-[#35739C] px-8 text-xl font-bold text-white hover:from-[#1F4A73] hover:to-[#285A88]">
              <Camera className="size-6" /> 체험해 보기
            </Link>
            <a href="#story" className="inline-flex min-h-14 items-center justify-center rounded-2xl border-2 border-[#285A88] bg-white px-8 text-lg font-bold text-[#285A88] hover:bg-[#DCE8F3]">
              어떻게 쓰이나요?
            </a>
          </div>

          <h2 className="mt-10 text-xl font-bold">시범 양식 3종</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {forms.map((f) => (
              <li key={f.id}>
                <Link href={`/try?form=${f.id}`} className="block min-h-[52px] rounded-2xl border border-[#D5DBE1] bg-[#F6F8FA] p-4 hover:border-[#285A88] hover:bg-[#DCE8F3]">
                  <span className="block text-lg font-bold">{f.name.replace(/ \(.*\)$/, "")}</span>
                  <span className="mt-1 block text-base text-[#52606D]">{f.summary}</span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-6 flex items-start gap-3 rounded-2xl bg-[#FFF4D6] p-4 text-base text-[#5C4300]">
            <TriangleAlert className="mt-0.5 size-6 shrink-0" />
            <span>기획안 · 가상 시연입니다. 안내는 참고용이며 최종 작성 기준은 해당 기관의 최신 서식·안내를 따릅니다.</span>
          </p>
        </div>
      </section>

      <div id="story">
        <ServicesStack />
      </div>

      <SiteFooter
        credit="기획안 · 가상 시연 · 파일은 브라우저에서 처리되며 서버에 저장되지 않습니다."
        cols={[
          {
            title: "시작하기",
            links: [
              { label: "체험해 보기", href: "/try" },
              { label: "사진·PDF 올리기", href: "/try" },
            ],
          },
          {
            title: "시범 양식",
            links: forms.map((f) => ({ label: f.name.replace(/ \(.*\)$/, ""), href: `/try?form=${f.id}` })),
          },
          {
            title: "안내",
            note: "안내는 참고용이며 최종 작성 기준은 해당 기관의 최신 서식·안내를 따릅니다. 이미 작성된 개인정보가 있는 서류는 올리지 마세요.",
          },
        ]}
      />
    </div>
  );
}
