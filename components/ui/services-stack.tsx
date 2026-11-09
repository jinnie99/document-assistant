"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * 스크롤하면 패널이 쌓이는(sticky) 서비스 소개 섹션.
 * 각 패널의 선 그림은 시간 t(초)만의 함수이며, 화면에 보일 때만 시계가 돈다.
 * 그림이 "지금 보여 주는 항목"은 아래 칩에서 강조된다.
 */

type Pt = [number, number];
type Step = [from: number, to: number, capability: string];
type Scene = { loop: number; still: number; steps: Step[]; Draw: (props: { t: number }) => React.ReactNode };

const W = 1280;
const H = 536;
const INK = "#1F2933";
const ACCENT = "#285A88";

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const inOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const out = (p: number) => 1 - (1 - p) ** 3;
const back = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const mix = (a: Pt, b: Pt, p: number): Pt => [lerp(a[0], b[0], p), lerp(a[1], b[1], p)];
const quad = (a: Pt, c: Pt, b: Pt, p: number): Pt => mix(mix(a, c, p), mix(c, b, p), p);
const fade = (t: number, loop: number) => prog(t, 0, 0.25) * (1 - prog(t, loop - 0.7, loop));

/** 선을 0(없음)에서 1(전체)까지 그린다. */
const draw = (p: number) =>
  ({ pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: 1 - p, visibility: p > 0 ? "visible" : "hidden" }) as const;

const line = { fill: "none", stroke: INK, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const hair = { ...line, strokeWidth: 2, strokeOpacity: 0.22 } as const;
const label = { fontFamily: "inherit" } as const;

function Person({ at, s = 1, color = INK }: { at: Pt; s?: number; color?: string }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]}) scale(${s})`}>
      <circle cy={-14} r={11} fill={color} />
      <path d="M-18 22Q0 -6 18 22" {...line} stroke={color} />
    </g>
  );
}

/** 종이 양식: 제목줄 + 칸 n개 */
function Paper({ x, y, w, h, t, start, rows = 4, hl = -1 }: { x: number; y: number; w: number; h: number; t: number; start: number; rows?: number; hl?: number }) {
  const gap = (h - 90) / rows;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} {...line} fill="#fff" {...draw(inOut(prog(t, start, start + 0.9)))} />
      <line x1={x + 30} y1={y + 36} x2={x + w * 0.6} y2={y + 36} {...line} strokeWidth={5} {...draw(prog(t, start + 0.6, start + 1))} />
      {Array.from({ length: rows }, (_, i) => (
        <rect key={i} x={x + 24} y={y + 66 + i * gap} width={w - 48} height={gap - 18} rx={6} {...(i === hl ? { ...line, stroke: ACCENT } : hair)} fill={i === hl ? ACCENT : "none"} fillOpacity={0.12} {...draw(inOut(prog(t, start + 0.8 + i * 0.25, start + 1.3 + i * 0.25)))} />
      ))}
    </g>
  );
}

function Phone({ x, y, t, start }: { x: number; y: number; t: number; start: number }) {
  return (
    <g>
      <rect x={x} y={y} width={230} height={430} rx={30} {...line} fill="#fff" {...draw(inOut(prog(t, start, start + 0.9)))} />
      <line x1={x + 90} y1={y + 20} x2={x + 140} y2={y + 20} {...line} strokeOpacity={0.4} {...draw(prog(t, start + 0.7, start + 1))} />
    </g>
  );
}

/* 01 사회문제: 낯선 용어와 복잡한 칸, 무엇을 써야 할지 막막하다 */
function Problem({ t }: { t: number }) {
  const marks = [1.6, 3.2, 4.8, 6.4];
  const strike = prog(t, 8.2, 9);
  const walk = inOut(prog(t, 10, 11.4));
  const walkPos = mix([760, 400], [1060, 400], walk);
  return (
    <g opacity={fade(t, 12)}>
      <Paper x={110} y={40} w={380} h={420} t={t} start={0.2} />
      {marks.map((s, i) => (
        <text key={i} x={470} y={118 + i * 82} fontSize={34} fontWeight={700} fill={ACCENT} opacity={prog(t, s, s + 0.3)} transform={`translate(0 ${-6 * (1 - back(prog(t, s, s + 0.3)))})`} style={label}>
          ?
        </text>
      ))}
      <Person at={[700, 330]} s={2.2} />
      <g opacity={prog(t, 4.2, 4.8)}>
        <rect x={620} y={90} width={230} height={56} rx={28} {...line} fill="#fff" />
        <text x={735} y={126} textAnchor="middle" fontSize={22} fill={INK} style={label}>
          여기엔 누구 정보를?
        </text>
      </g>
      <line x1={140} y1={176 + 82 * 2} x2={430} y2={176 + 82 * 2} {...line} stroke={ACCENT} strokeWidth={4} {...draw(strike)} />
      <text x={110} y={490} fontSize={20} fill={INK} fillOpacity={0.55} opacity={prog(t, 8.6, 9)} style={label}>
        재작성 ×2
      </text>
      <rect x={1000} y={120} width={190} height={190} rx={10} {...hair} {...draw(prog(t, 9.6, 10.4))} />
      <text x={1095} y={225} textAnchor="middle" fontSize={22} fill={INK} fillOpacity={0.5} opacity={prog(t, 10, 10.4)} style={label}>
        창구
      </text>
      {t > 10 && <circle cx={walkPos[0]} cy={walkPos[1]} r={9} fill={INK} />}
    </g>
  );
}

/* 02 이용 장면: 찍고, 질문에 답하고, 궁금한 칸을 누르고, 안내를 보고, 직접 쓴다 */
function Use({ t }: { t: number }) {
  const scan = prog(t, 0.6, 1.8);
  const tapAt = prog(t, 3.4, 3.8);
  const tapField = prog(t, 4.6, 5);
  const card = inOut(prog(t, 6, 7));
  const pen = inOut(prog(t, 10, 11.4));
  return (
    <g opacity={fade(t, 12)}>
      <Paper x={70} y={70} w={260} h={360} t={t} start={0.1} rows={3} hl={t > 10 ? 1 : -1} />
      <path d="M60 60h30M60 60v30M340 60h-30M340 60v30M60 440h30M60 440v-30M340 440h-30M340 440v-30" {...line} stroke={ACCENT} strokeWidth={3} opacity={prog(t, 0.4, 0.7) * (1 - prog(t, 1.9, 2.1))} />
      <line x1={70} y1={lerp(80, 420, scan)} x2={330} y2={lerp(80, 420, scan)} {...line} stroke={ACCENT} strokeWidth={3} opacity={scan > 0 && scan < 1 ? 0.8 : 0} />

      <Phone x={470} y={50} t={t} start={1.6} />
      <g opacity={prog(t, 2, 2.4)}>
        <rect x={495} y={95} width={180} height={50} rx={6} {...hair} />
        <rect x={495} y={165} width={180} height={50} rx={6} {...(t > 4.6 ? { ...line, stroke: ACCENT } : hair)} fill={ACCENT} fillOpacity={t > 4.6 ? 0.18 : 0} />
        <rect x={495} y={235} width={180} height={50} rx={6} {...hair} />
      </g>
      <g opacity={prog(t, 2.4, 2.9) * (1 - prog(t, 4, 4.4))}>
        <rect x={485} y={320} width={200} height={140} rx={16} {...line} fill="#fff" />
        <text x={585} y={352} textAnchor="middle" fontSize={17} fill={INK} style={label}>
          부탁받아 신청하나요?
        </text>
        <rect x={500} y={384} width={80} height={44} rx={10} fill={ACCENT} />
        <text x={540} y={413} textAnchor="middle" fontSize={18} fill="#fff" style={label}>
          네
        </text>
        <rect x={592} y={384} width={80} height={44} rx={10} {...hair} />
      </g>
      {tapAt > 0 && tapAt < 1 && <circle cx={540} cy={406} r={8 + 26 * out(tapAt)} {...line} stroke={ACCENT} strokeWidth={2} strokeOpacity={1 - tapAt} />}
      {tapField > 0 && tapField < 1 && <circle cx={585} cy={190} r={8 + 26 * out(tapField)} {...line} stroke={ACCENT} strokeWidth={2} strokeOpacity={1 - tapField} />}

      <path d="M700 190C740 190 760 200 800 200" {...hair} strokeOpacity={0.4} {...draw(card)} />
      <g opacity={card}>
        <rect x={810} y={80} width={380} height={300} rx={16} {...line} fill="#fff" />
        {[0, 1, 2].map((i) => (
          <g key={i} opacity={prog(t, 6.2 + i * 0.3, 6.6 + i * 0.3)}>
            <circle cx={850} cy={130 + i * 80} r={18} {...hair} />
            <path d={`M885 ${122 + i * 80}H1150M885 ${142 + i * 80}H1060`} {...line} strokeWidth={2} strokeOpacity={0.4} />
          </g>
        ))}
        <g opacity={prog(t, 8, 8.5)}>
          <rect x={830} y={336} width={340} height={30} rx={8} fill="#d3e3f6" />
          <path d="M1130 351l6 6l12 -12" {...line} stroke={ACCENT} />
        </g>
      </g>
      <path d="M150 262H230" {...line} stroke={ACCENT} strokeWidth={4} {...draw(pen)} />
      <g transform={`translate(${lerp(150, 230, pen)} 250) rotate(40)`} opacity={t > 10 ? 1 : 0}>
        <rect x={-4} y={-30} width={8} height={30} rx={3} {...line} fill="#fff" />
      </g>
    </g>
  );
}

/* 03 서비스가 하는 일 · AI */
function Service({ t }: { t: number }) {
  const scan = prog(t, 0.6, 2);
  const boxes: [number, number, number, number][] = [[130, 130, 240, 50], [130, 210, 240, 50], [130, 290, 240, 50]];
  const ring = t * 40;
  const flow = (k: number) => ((t - 4) * 0.5 + k / 3) % 1;
  return (
    <g opacity={fade(t, 12)}>
      <rect x={90} y={60} width={320} height={380} rx={14} {...line} fill="#fff" {...draw(inOut(prog(t, 0.1, 0.9)))} />
      {boxes.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={6} {...line} stroke={ACCENT} strokeWidth={2.5} fill={ACCENT} fillOpacity={0.1} {...draw(prog(t, 2 + i * 0.4, 2.5 + i * 0.4))} />
      ))}
      <line x1={110} y1={lerp(80, 420, scan)} x2={390} y2={lerp(80, 420, scan)} {...line} stroke={ACCENT} strokeWidth={3} opacity={scan > 0 && scan < 1 ? 0.8 : 0} />
      <path d="M410 250C470 250 500 250 560 250" {...hair} strokeOpacity={0.4} {...draw(prog(t, 1.8, 2.6))} />

      <circle cx={620} cy={250} r={56} {...line} fill="#fff" {...draw(inOut(prog(t, 1.6, 2.4)))} />
      <circle cx={620} cy={250} r={76} {...line} strokeWidth={2} strokeDasharray="4 12" opacity={0.5 * prog(t, 2, 2.6)} transform={`rotate(${ring} 620 250)`} />
      <text x={620} y={260} textAnchor="middle" fontSize={30} fontWeight={700} fill={INK} opacity={prog(t, 2.2, 2.6)} style={label}>
        AI
      </text>

      <g opacity={prog(t, 4, 4.6)}>
        <path d="M680 190C740 140 760 110 820 100" {...hair} strokeOpacity={0.4} />
        <rect x={820} y={60} width={160} height={90} rx={10} {...line} fill="#fff" />
        <path d="M840 90H960M840 110H930M840 130H900" {...line} strokeWidth={2} strokeOpacity={0.4} />
        <text x={900} y={50} textAnchor="middle" fontSize={20} fill={INK} fillOpacity={0.55} style={label}>
          공식 기준
        </text>
      </g>
      {t > 4.4 &&
        [0, 1, 2].map((k) => {
          const u = flow(k);
          const [x, y] = quad([820, 100], [760, 110], [676, 215], u);
          return <circle key={k} cx={x} cy={y} r={6} fill={ACCENT} opacity={Math.sin(Math.PI * u)} />;
        })}

      <g opacity={inOut(prog(t, 6, 7))}>
        <path d="M690 270C760 290 790 300 840 300" {...hair} strokeOpacity={0.4} />
        <rect x={840} y={210} width={350} height={200} rx={14} {...line} fill="#fff" />
        <path d="M865 245H1150M865 275H1080M865 305H1120" {...line} strokeWidth={2} strokeOpacity={0.4} {...draw(prog(t, 6.4, 7.4))} />
        <rect x={865} y={335} width={200} height={50} rx={10} fill="#d3e3f6" opacity={prog(t, 8, 8.5)} />
        <text x={965} y={367} textAnchor="middle" fontSize={20} fill={INK} opacity={prog(t, 8.2, 8.6)} style={label}>
          내 상황 예시
        </text>
      </g>

      <g opacity={prog(t, 10, 10.6)}>
        <rect x={900} y={440} width={290} height={50} rx={25} {...line} fill="#fff" />
        <text x={990} y={472} textAnchor="middle" fontSize={20} fill={INK} style={label}>
          개정판 확인
        </text>
        <circle cx={1150} cy={465} r={14} fill={ACCENT} />
        <path d="M1143 465l5 5l9 -10" {...line} stroke="#fff" />
      </g>
    </g>
  );
}

/* 04 기대효과 */
function Effect({ t }: { t: number }) {
  const bars: [number, number, string][] = [
    [560, 280, INK],
    [660, 130, ACCENT],
  ];
  const items = [8, 8.5, 9, 9.5];
  const seal = back(prog(t, 10.4, 11));
  return (
    <g opacity={fade(t, 12)}>
      <Paper x={100} y={60} w={320} h={380} t={t} start={0.1} rows={3} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${380} ${150 + i * 90}) scale(${back(prog(t, 1 + i * 0.4, 1.4 + i * 0.4))})`}>
          <circle r={16} fill={ACCENT} />
          <path d="M-6 0l4 5l8 -10" {...line} stroke="#fff" />
        </g>
      ))}
      <line x1={500} y1={420} x2={800} y2={420} {...hair} {...draw(prog(t, 4, 4.6))} />
      {bars.map(([x, h, c], i) => {
        const p = out(prog(t, 4.4 + i * 0.5, 5.4 + i * 0.5));
        return <rect key={i} x={x} y={420 - h * p} width={60} height={h * p} rx={6} fill={c} fillOpacity={i === 0 ? 0.35 : 1} />;
      })}
      <text x={590} y={450} textAnchor="middle" fontSize={20} fill={INK} fillOpacity={0.55} opacity={prog(t, 5, 5.4)} style={label}>
        전
      </text>
      <text x={690} y={450} textAnchor="middle" fontSize={20} fill={INK} fillOpacity={0.55} opacity={prog(t, 5.6, 6)} style={label}>
        후
      </text>
      <text x={500} y={60} fontSize={22} fill={INK} fillOpacity={0.55} opacity={prog(t, 4.6, 5)} style={label}>
        작성 시간 · 도움 요청
      </text>

      <rect x={880} y={80} width={310} height={310} rx={14} {...line} fill="#fff" {...draw(inOut(prog(t, 7.4, 8.2)))} />
      {items.map((s, i) => (
        <g key={i} opacity={prog(t, s, s + 0.3)}>
          <rect x={910} y={115 + i * 66} width={30} height={30} rx={6} {...hair} />
          <path d={`M916 ${130 + i * 66}l6 7l12 -14`} {...line} stroke={ACCENT} {...draw(prog(t, s + 0.2, s + 0.5))} />
          <path d={`M960 ${122 + i * 66}H1150M960 ${138 + i * 66}H1100`} {...line} strokeWidth={2} strokeOpacity={0.35} />
        </g>
      ))}
      {seal > 0 && (
        <g transform={`translate(1100 400) scale(${seal})`}>
          <circle r={36} {...line} fill="#fff" stroke={ACCENT} />
          <path d="M-12 0l8 9l16 -18" {...line} stroke={ACCENT} />
        </g>
      )}
      {t > 10.6 && <Person at={[1000, 470]} s={0.9} color={ACCENT} />}
    </g>
  );
}

const scenes: Record<string, Scene> = {
  problem: {
    loop: 12,
    still: 9.5,
    Draw: Problem,
    steps: [
      [0, 2, "낯선 용어"],
      [2, 4, "복잡한 칸"],
      [4, 6, "누구 정보인지 모름"],
      [6, 8, "어디서 확인?"],
      [8, 10, "재작성 부담"],
      [10, 12, "창구 재방문"],
    ],
  },
  use: {
    loop: 12,
    still: 8,
    Draw: Use,
    steps: [
      [0, 2, "양식 촬영"],
      [2, 4, "상황 확인"],
      [4, 6, "궁금한 칸 선택"],
      [6, 8, "칸별 안내"],
      [8, 10, "공식 근거 확인"],
      [10, 12, "직접 작성"],
    ],
  },
  service: {
    loop: 12,
    still: 9,
    Draw: Service,
    steps: [
      [0, 2, "양식 인식"],
      [2, 4, "칸 인식"],
      [4, 6, "공식 기준 대조"],
      [6, 8, "쉬운 말 설명"],
      [8, 10, "상황별 예시"],
      [10, 12, "개정판 확인"],
    ],
  },
  effect: {
    loop: 12,
    still: 11,
    Draw: Effect,
    steps: [
      [0, 4, "혼동 감소"],
      [4, 6, "작성 시간 단축"],
      [6, 8, "재작성 부담 완화"],
      [8, 10, "제출 전 점검"],
      [10, 12, "도움 요청 감소"],
    ],
  },
};

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

function ServiceAnimation({ id, title, onStep }: { id: string; title: string; onStep?: (c: string | undefined) => void }) {
  const scene = scenes[id];
  const svg = useRef<SVGSVGElement>(null);
  const [clock, setClock] = useState(0);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const loop = scene?.loop ?? 1;

  useEffect(() => {
    const el = svg.current;
    if (!el || reduced) return;
    let raf = 0;
    let last = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      if (last) elapsed += Math.min(0.1, (now - last) / 1000);
      last = now;
      setClock(elapsed % loop);
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(raf);
      last = 0;
      if (entry.isIntersecting) raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reduced, loop]);

  const t = reduced ? (scene?.still ?? 0) : clock;
  const step = scene?.steps.find(([a, b]) => t >= a && t < b)?.[2];

  useEffect(() => {
    onStep?.(step);
  }, [step, onStep]);

  if (!scene) return null;
  const { Draw, steps } = scene;

  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={title}>
      <Draw t={t} />
      {steps.map(([a, b, name]) => {
        const o = prog(t, a, a + 0.3) * (1 - prog(t, b - 0.3, b));
        return o > 0 ? (
          <text key={name} x={90} y={516 + (1 - o) * 8} fontSize={36} fontWeight={700} fill={INK} fillOpacity={0.62} opacity={o} style={label}>
            {name}
          </text>
        ) : null;
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------------- *
 * 섹션: 전체 높이 패널이 스크롤에 따라 쌓이고, 고정 배경이 패널별로 바뀐다.      *
 * ------------------------------------------------------------------------- */

export type Service = {
  /** "problem" | "use" | "service" | "effect" 중 하나가 내장 그림을 고른다. */
  id: string;
  title: string;
  text: string;
  capabilities: string[];
  /** CSS 배경(그라데이션). */
  bg?: string;
};

export const defaultServices: Service[] = [
  {
    id: "problem",
    title: "01 사회문제",
    text: "낯선 용어와 복잡한 칸 앞에서 '무엇을 써야 할지' 막막합니다. 한 칸을 잘못 쓰면 다시 쓰고, 다시 창구에 가야 합니다.",
    capabilities: ["낯선 용어", "복잡한 칸", "누구 정보인지 모름", "어디서 확인?", "재작성 부담", "창구 재방문"],
    bg: "linear-gradient(180deg, #DCE3EA 0%, #C6D3E0 100%)",
  },
  {
    id: "use",
    title: "02 시민의 이용 장면",
    text: "작성 중 막힌 양식을 휴대폰으로 찍고, 필요한 질문에만 답한 뒤, 궁금한 칸을 사진 위에서 바로 누릅니다.",
    capabilities: ["양식 촬영", "상황 확인", "궁금한 칸 선택", "칸별 안내", "공식 근거 확인", "직접 작성"],
    bg: "linear-gradient(180deg, #D8E6F2 0%, #B9CFE3 100%)",
  },
  {
    id: "service",
    title: "03 서비스가 하는 일 · AI",
    text: "AI가 양식과 항목을 인식하고, 등록된 공식 기준을 쉽게 풀어 설명합니다. 내 상황에 맞는 작성 예시까지 보여 줍니다.",
    capabilities: ["양식 인식", "칸 인식", "공식 기준 대조", "쉬운 말 설명", "상황별 예시", "개정판 확인"],
    bg: "linear-gradient(180deg, #D5E8E4 0%, #B4D4CE 100%)",
  },
  {
    id: "effect",
    title: "04 기대효과",
    text: "막힌 칸을 이해하고 직접 작성합니다. 작성 시간과 재작성 부담, 도움 요청이 줄어들 것으로 기대합니다.",
    capabilities: ["혼동 감소", "작성 시간 단축", "재작성 부담 완화", "제출 전 점검", "도움 요청 감소", "자신 있게 제출"],
    bg: "linear-gradient(180deg, #E1E8D6 0%, #C8D5B6 100%)",
  },
];

const panelClass =
  "sticky top-0 mx-auto grid min-h-screen w-full max-w-[104.5rem] origin-top content-center items-center px-4 py-6 sm:px-16 md:px-9 lg:grid-cols-2 lg:px-0 lg:py-20 lg:[@media(max-height:910px)]:py-10";

const capabilityClass =
  "relative items-baseline gap-2 rounded-lg bg-[#E6EBF0] px-2.5 pt-1.5 pb-2 transition-colors duration-500 before:bg-[#1F2933] before:transition-colors before:duration-500 lg:flex lg:pt-2.5 lg:pb-3 lg:before:size-2 lg:before:shrink-0 lg:before:-translate-y-[20%] lg:before:rounded-full";

const activeCapabilityClass = "bg-[#DCE8F3] before:bg-[#285A88]";

export type ServicesStackProps = {
  services?: Service[];
  /** 각 제목 위의 한 줄. */
  eyebrow?: string;
  className?: string;
};

export function ServicesStack({ services = defaultServices, eyebrow = "사진 기반 서류 작성 도우미", className }: ServicesStackProps) {
  const root = useRef<HTMLElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const panels = Array.from(el.querySelectorAll<HTMLElement>("[data-panel]"));
    let raf = 0;
    // 뷰포트보다 큰 패널은 아래쪽 가장자리로 고정해 카드 전체에 닿을 수 있게 한다.
    const fit = () => {
      const vh = window.innerHeight;
      panels.forEach((panel) => {
        panel.style.top = `${Math.min(0, vh - panel.offsetHeight)}px`;
      });
    };
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      let idx = 0;
      panels.forEach((panel, i) => {
        if (panel.getBoundingClientRect().top <= vh * 0.5) idx = i;
        const next = panels[i + 1];
        const card = cards.current[i];
        if (!card) return;
        const covered = next ? Math.min(1, Math.max(0, 1 - next.getBoundingClientRect().top / vh)) : 0;
        card.style.opacity = String(Math.max(0, 1 - covered * 1.4));
        card.style.transform = `scale(${1 - covered * 0.06}) translateY(${-covered * 40}px)`;
      });
      setActive(idx);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onResize = () => {
      fit();
      schedule();
    };
    fit();
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [services.length]);

  return (
    <section ref={root} className={cn("relative isolate w-full text-[#1F2933] lg:px-9", className)}>
      {services.map((s, i) => (
        <div key={s.id} data-panel className={panelClass}>
          <div
            className="mx-auto w-full max-w-[36rem] lg:col-start-2 lg:mx-0 lg:max-w-none"
            ref={(el) => {
              cards.current[i] = el;
            }}
            style={{ transformOrigin: "top center", willChange: "transform, opacity" }}
          >
            <h2 className="text-2xl font-medium text-[#1F2933] lg:sr-only">
              <span className="block text-[#52606D]">{eyebrow}</span>
              <span className="block">{s.title}</span>
            </h2>
            <div className="mt-6 lg:mt-0">
              <ServiceCard service={s} />
            </div>
          </div>
        </div>
      ))}

      {/* 고정 배경: 왼쪽 제목 + 패널별로 바뀌는 배경 */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        <div className="sticky top-0 grid h-screen w-full overflow-hidden py-20">
          <div className="mx-auto hidden w-full max-w-[104.5rem] grid-cols-12 px-9 text-[clamp(1.75rem,0.5263vi+1.6184rem,2.25rem)] leading-[1.15] font-medium tracking-tight text-[#1F2933] lg:grid">
            <div className="col-span-5 flex h-full flex-col">
              <div className="flex h-1/2 flex-col justify-end">
                <h2 className="text-[#52606D]">{eyebrow}</h2>
              </div>
              <div className="relative h-1/2">
                {services.map((s, i) => (
                  <span key={s.id} className={cn("absolute inset-0 transition duration-300", i !== active && "translate-y-10 opacity-0")}>
                    {s.title}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {services.map((s, i) => (
            <div key={s.id} className={cn("absolute inset-0 -z-20 transition-opacity duration-1000", i !== active && "opacity-0")} style={{ background: s.bg ?? "#DCE3EA" }} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ service: s }: { service: Service }) {
  const [step, setStep] = useState<string>();
  return (
    <div className="overflow-hidden rounded-lg bg-gradient-to-b border border-[#D5DBE1] from-white to-[#F6F8FA] px-4 pt-5 lg:max-w-[42.5rem] lg:rounded-xl lg:pt-8">
      <div className="px-2 lg:px-10">
        <ServiceAnimation id={s.id} title={`${s.title}: ${s.capabilities.join(", ")}`} onStep={setStep} />
      </div>
      <div className="p-5 pt-7 lg:px-14 lg:py-12 lg:[@media(max-height:910px)]:py-8">
        <p className="text-[1.1875rem] leading-snug tracking-[0.005em] lg:max-w-[36.25rem]">{s.text}</p>
        <p id={`service-list-title-${s.id}`} className="mt-11 text-base leading-tight font-medium tracking-[0.055rem] text-[#1F2933]/80 lg:[@media(max-height:910px)]:mt-8">
          핵심 장면
        </p>
        <ul className="mt-3.5 grid grid-cols-2 gap-1.5 text-base leading-tight lg:gap-2 lg:[@media(max-height:910px)]:mt-2" aria-labelledby={`service-list-title-${s.id}`}>
          {s.capabilities.map((c) => (
            <li key={c} className={cn(capabilityClass, c === step && activeCapabilityClass)}>
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ServicesStack;
