import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Col = { title: string; links?: { label: string; href: string }[]; note?: string };

/** my-ui 스킬: 흰 카드 + 큰 글자 3열. 링크는 청색 굵은 글씨, 높이 52px 이상. */
export function SiteFooter({ cols, credit }: { cols: Col[]; credit?: string }) {
  return (
    <footer className="bg-[#F3F5F7] px-4 pb-10 pt-6 text-[#1F2933] sm:px-6">
      <div className="mx-auto max-w-6xl rounded-3xl border border-[#D5DBE1] bg-white p-6 shadow-[0_1px_2px_rgba(31,41,51,.06)] sm:p-8">
        <div className="grid gap-8 sm:grid-cols-3">
          {cols.map((c) => (
            <section key={c.title}>
              <h2 className="text-xl font-bold">{c.title}</h2>
              {c.links && (
                <ul className="mt-3 grid gap-1">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="inline-flex min-h-[52px] items-center gap-2 text-lg font-bold text-[#285A88] underline underline-offset-4 hover:text-[#1F4A73]">
                        {l.label}
                        <ArrowRight className="size-5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {c.note && <p className="mt-3 text-base leading-relaxed text-[#52606D]">{c.note}</p>}
            </section>
          ))}
        </div>
        {credit && <p className="mt-8 border-t border-[#D5DBE1] pt-4 text-base text-[#52606D]">{credit}</p>}
      </div>
    </footer>
  );
}
