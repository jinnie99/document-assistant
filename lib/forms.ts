/**
 * 등록 양식 데이터 (공개 서식 3종)
 * - 안내 문구는 ① 양식에 인쇄된 문구 ② 양식 속 공식 예시 ③ 법령 근거에서만 만든다.
 * - 그 밖의 예시는 "가상 예시"로 표시한다(exampleOfficial 없음).
 * - 기술 기준·수치는 만들지 않는다. 근거가 없으면 "기관에 확인"으로 안내한다.
 * - box 좌표는 템플릿 이미지(w×h px) 기준 px을 %로 변환한 값.
 */

export type Guide = {
  whose: string; // 누구의 정보인가요?
  where: string; // 어디서 확인하나요?
  how: string; // 어떻게 쓰나요?
  example: string;
  /** 양식에 인쇄된 공식 예시이면 true, 아니면 가상 예시 */
  exampleOfficial?: boolean;
  caution?: string;
  /** 이 안내의 근거(양식 문구 또는 법령) */
  basis?: string;
};

export type Field = {
  id: string;
  label: string;
  box: { x: number; y: number; w: number; h: number };
  guides: Record<string, Guide>;
};

export type LawRef = { label: string; note: string; url?: string };

export type FormDef = {
  id: string;
  name: string;
  summary: string;
  /** PDF 텍스트·AI 식별에 쓰는 양식 제목 */
  titleKey: string;
  template: { src: string; w: number; h: number };
  question: { text: string; options: { id: string; label: string }[] };
  fields: Field[];
  checklist: string[];
  source: { name: string; baseYear: string; note: string; refs: LawRef[] };
};

const LAW = (name: string) => `https://www.law.go.kr/법령/${name}`;

const COMMON_NOTE = "공개 서식을 바탕으로 한 시연용 안내입니다. 실제 작성 전 해당 기관의 최신 서식과 안내를 확인하세요.";

const REF_SAFETY_ACT: LawRef = {
  label: "전기안전관리법 제8조 (자가용전기설비 공사계획의 인가·신고)",
  note: "공사계획 인가는 장관, 신고는 시·도지사 대상. 시행규칙 제4조에서 신청 서식·제출처를 정함. 시행일·조문은 국가법령정보센터에서 최종 확인 필요.",
  url: LAW(encodeURIComponent("전기안전관리법")),
};
const REF_SAFETY_RULE: LawRef = {
  label: "전기안전관리법 시행규칙 제3조·제4조",
  note: "제3조: 인가·신고 대상 공사계획(저압설비 특례에서 전기저장장치·무정전전원장치는 제외). 제4조: 신청서류 제출처. 최종 확인 필요.",
  url: LAW(encodeURIComponent("전기안전관리법시행규칙")),
};

const px = (W: number, H: number) => (x: number, y: number, w: number, h: number) => ({ x: (x / W) * 100, y: (y / H) * 100, w: (w / W) * 100, h: (h / H) * 100 });

const same = (g: Guide, ids: string[]): Record<string, Guide> => Object.fromEntries(ids.map((i) => [i, g]));

/* ------------------------- 1. 사전 기술검토 신청서 ------------------------- */
const a = px(1190, 1684);
const A = ["corp", "indiv"];

const apply: FormDef = {
  id: "apply",
  name: "사전 기술검토 신청서 (무정전전원장치)",
  summary: "UPS 공사계획 기술검토를 신청할 때",
  titleKey: "사전 기술검토 신청서",
  template: { src: "/templates/apply.png", w: 1190, h: 1684 },
  question: {
    text: "신청하는 쪽은 어디인가요?",
    options: [
      { id: "corp", label: "회사(법인)예요" },
      { id: "indiv", label: "개인사업자·개인이에요" },
    ],
  },
  fields: [
    {
      id: "receipt",
      label: "접수번호·접수일자",
      box: a(118, 288, 937, 52),
      guides: same(
        {
          whose: "접수 처리 때 채워지는 칸 — 신청인이 쓰지 않아요",
          where: "해당 없음",
          how: "바탕색이 어두운(회색) 칸은 신청인이 작성하지 않으니 비워 두세요.",
          example: "(작성하지 않음)",
          exampleOfficial: true,
          basis: "양식 안내문: '바탕색이 어두운 난은 신청인이 작성하지 않습니다.'",
        },
        A,
      ),
    },
    {
      id: "project",
      label: "공사명",
      box: a(180, 362, 875, 49),
      guides: same(
        {
          whose: "이번 UPS 공사의 이름",
          where: "공사계약서 · 공사계획서",
          how: "함께 내는 공사계획서·기술 규격서의 공사명과 똑같이 적어요.",
          example: "○○센터 무정전전원장치 설치공사",
          caution: "서류마다 공사명이 다르게 적히지 않도록 하세요.",
          basis: "첨부서류(공사계획서, 공사계획 기술 규격서 등)와 함께 제출",
        },
        A,
      ),
    },
    {
      id: "rep",
      label: "대표자 성명·전화번호",
      box: a(265, 412, 790, 52),
      guides: {
        corp: {
          whose: "회사(법인)의 대표자 이름과 전화번호",
          where: "사업자등록증 · 법인 서류",
          how: "대표자 성명과, 연락이 닿는 전화번호를 적어요.",
          example: "홍○○ / 02-000-0000",
        },
        indiv: {
          whose: "개인사업자 본인(대표자)의 이름과 전화번호",
          where: "사업자등록증",
          how: "대표자 란에 본인 성명과 연락 가능한 전화번호를 적어요.",
          example: "홍○○ / 010-0000-0000",
        },
      },
    },
    {
      id: "company",
      label: "회사명 또는 상호",
      box: a(265, 465, 790, 52),
      guides: {
        corp: {
          whose: "회사(법인)의 이름",
          where: "사업자등록증 · 법인 서류",
          how: "(주) 등을 포함해 등록된 이름 그대로 적어요.",
          example: "(주)가상전기",
        },
        indiv: {
          whose: "사업장의 상호(가게·사업장 이름)",
          where: "사업자등록증",
          how: "등록된 상호를 그대로 적어요.",
          example: "가상전기",
        },
      },
    },
    {
      id: "addr",
      label: "주소",
      box: a(265, 518, 790, 52),
      guides: same(
        {
          whose: "신청인(회사·사업장)의 주소",
          where: "사업자등록증 · 등기 서류",
          how: "도로명 주소를 건물·호수까지 적어요.",
          example: "가상시 예시구 샘플로 1, 5층",
        },
        A,
      ),
    },
    {
      id: "contact",
      label: "담당자",
      box: a(265, 593, 790, 104),
      guides: same(
        {
          whose: "이 신청을 실제로 챙기는 담당자(대표자와 다를 수 있어요)",
          where: "내 회사의 업무 담당자",
          how: "소속, 성명, 전화번호, E-mail을 모두 적어요. 문의가 올 때 연락받을 분이에요.",
          example: "공무팀 / 김○○ / 02-000-0000 / name@example.com",
        },
        A,
      ),
    },
    {
      id: "sign",
      label: "작성일·신청인 서명",
      box: a(690, 780, 360, 65),
      guides: same(
        {
          whose: "신청인",
          where: "해당 없음",
          how: "신청하는 날짜(년·월·일)를 쓰고, 신청인 이름을 적은 뒤 서명하거나 도장을 찍어요('서명 또는 인').",
          example: "2026년 10월 28일  신청인 ○○○ (서명)",
          caution: "날짜 칸이 비어 있지 않은지 확인하세요.",
          basis: "양식 문구: '신청인 (서명 또는 인)'",
        },
        A,
      ),
    },
    {
      id: "attach",
      label: "첨부서류",
      box: a(205, 928, 850, 222),
      guides: same(
        {
          whose: "함께 내야 하는 서류 목록 (쓰는 칸이 아니라 준비물 확인 칸)",
          where: "내 공사 서류철 · 설계 업체",
          how: "1~7번 서류를 부수까지 맞춰 준비하세요. 5번은 공사감리 대상인 경우만, 6번은 공사계획을 변경하는 경우만 해당해요.",
          example: "1. 공사계획서 1부 … 7. 공사계획 기술 규격서 1부",
          exampleOfficial: true,
          caution: "7번 '공사계획 기술 규격서'는 [서식2] 무정전전원장치 기술 규격서예요.",
          basis: "양식 '첨부서류' 1~7호",
        },
        A,
      ),
    },
    {
      id: "target",
      label: "신청 대상",
      box: a(118, 1427, 938, 100),
      guides: same(
        {
          whose: "내 설비가 사전 기술검토를 신청하는 대상인지 확인하는 칸",
          where: "양식 하단 '사전 기술검토 신청 대상'",
          how: "대상은 ① 사업용전기설비, ② 자가용전기설비 중 제출대상 기관이 산업부인 경우예요. 내 설비가 어디에 해당하는지 헷갈리면 기관에 먼저 확인하세요.",
          example: "(쓰는 칸 아님)",
          exampleOfficial: true,
          basis: "양식 문구 '사전 기술검토 신청 대상'",
        },
        A,
      ),
    },
  ],
  checklist: [
    "회색(바탕색이 어두운) 칸은 비워 두었나요?",
    "공사명이 첨부서류의 공사명과 같은가요?",
    "날짜와 신청인 서명(또는 인)을 했나요?",
    "첨부서류 1~7호 중 해당하는 것을 부수대로 챙겼나요?",
  ],
  source: {
    name: "공사계획 사전 기술검토 신청서 [서식1] (한국전기안전공사 수신)",
    baseYear: "확인 필요",
    note: COMMON_NOTE,
    refs: [
      {
        label: "양식 인쇄 근거: 전기사업법 제61조, 같은 법 시행규칙 제29조, 전기안전관리법 제8조, 같은 법 시행규칙 제4조",
        note: "신청서에 직접 적혀 있는 근거 조문. '사전기술검토'를 정한 별도 조문 번호는 확인하지 못했어요(확인 필요).",
      },
      { label: "전력기술관리법 제12조의2 제4항 (감리원 배치확인서)", note: "첨부서류 5호 — 공사감리 대상인 경우만 해당(양식 문구)." },
      REF_SAFETY_ACT,
      REF_SAFETY_RULE,
    ],
  },
};

/* ------------------------- 2. 경미한 사항 변경 확인서 ------------------------- */
const m = px(1190, 1682);
const M = ["owner", "agent"];

const minor: FormDef = {
  id: "minor",
  name: "경미한 사항 변경 확인서",
  summary: "도면·현장이 달라졌지만 경미한 변경일 때",
  titleKey: "경미한 사항 변경 확인서",
  template: { src: "/templates/minor.png", w: 1190, h: 1682 },
  question: {
    text: "서명하는 분은 누구인가요?",
    options: [
      { id: "owner", label: "설비 소유자 본인이에요" },
      { id: "agent", label: "소유자의 위임을 받은 감리자예요" },
    ],
  },
  fields: [
    {
      id: "customer",
      label: "고객명",
      box: m(278, 205, 292, 45),
      guides: same(
        { whose: "고객(검사를 받는 쪽)의 이름", where: "검사 신청 때 적은 이름", how: "검사 신청서와 같은 이름으로 적어요.", example: "홍○○" },
        M,
      ),
    },
    {
      id: "company",
      label: "상호",
      box: m(726, 205, 349, 45),
      guides: same(
        { whose: "사업장·회사의 상호", where: "사업자등록증", how: "등록된 상호를 그대로 적어요.", example: "가상에너지(주)" },
        M,
      ),
    },
    {
      id: "type",
      label: "설비종류",
      box: m(278, 251, 292, 46),
      guides: same(
        {
          whose: "검사받는 설비의 종류 (미리 '태양광발전설비'로 인쇄돼 있어요)",
          where: "해당 없음",
          how: "내 설비가 태양광발전설비가 맞는지 확인하세요.",
          example: "태양광발전설비 (인쇄됨)",
          exampleOfficial: true,
          caution: "다른 종류의 설비라면 이 서식을 그대로 써도 되는지 기관에 먼저 확인하세요.",
          basis: "양식에 '태양광발전설비'가 미리 인쇄됨",
        },
        M,
      ),
    },
    {
      id: "address",
      label: "설비주소",
      box: m(726, 251, 349, 46),
      guides: same(
        { whose: "설비가 설치된 장소의 주소", where: "설비 설치 허가·신고 서류", how: "설비가 있는 곳의 주소를 적어요(소유자 주소와 다를 수 있어요).", example: "가상시 예시구 샘플로 123" },
        M,
      ),
    },
    {
      id: "capacity",
      label: "설비용량",
      box: m(278, 298, 292, 46),
      guides: same(
        { whose: "설비의 용량", where: "설비 설치 서류 · 검사 서류", how: "숫자만 적으세요. 단위 [kW]는 이미 인쇄돼 있어요.", example: "99.9" },
        M,
      ),
    },
    {
      id: "date",
      label: "검사일시",
      box: m(726, 298, 349, 46),
      guides: same(
        { whose: "검사를 받는(받은) 날짜", where: "검사 일정 안내", how: "년·월·일을 숫자로 적어요.", example: "2026년 11월 3일" },
        M,
      ),
    },
    {
      id: "changes",
      label: "경미한 변경사항",
      box: m(117, 430, 790, 620),
      guides: same(
        {
          whose: "설계(도면)와 현장이 달라진 내용 중 '경미한' 것",
          where: "수정 도면 · 최종 기술도서",
          how: "변경 내용을 한 줄에 하나씩 적어요. 이 칸에는 전기사업법 시행규칙 [별표 8]의 '공사계획 기재사항에 해당하지 않는' 변경만 적어요.",
          example: "○○ 위치 변경 (수정 도면 ○쪽 반영)",
          caution: "어떤 변경이 경미한지는 내가 정하지 않아요. [별표 8]과 기관 안내로 확인하세요.",
          basis: "양식 주석 '* 전기사업법 시행규칙 [별표 8]에 따른 공사계획 기재사항에 해당하지 않는 사항'",
        },
        M,
      ),
    },
    {
      id: "remark",
      label: "비고",
      box: m(908, 430, 167, 620),
      guides: same(
        { whose: "변경사항에 대한 짧은 덧붙임", where: "수정 도면", how: "필요하면 도면 번호나 참고 사항을 짧게 적어요. 없으면 비워도 돼요.", example: "도면 3쪽 참조" },
        M,
      ),
    },
    {
      id: "agree",
      label: "동의함 (3개)",
      box: m(117, 1080, 958, 225),
      guides: same(
        {
          whose: "아래 세 문장에 동의하는 분(소유자)",
          where: "해당 없음",
          how: "세 문장을 끝까지 읽고, 동의하는 칸마다 □에 체크해요. ① 경미한 변경으로 처리 ② 수정 도면을 허가권자(지자체장)에게 변경 제출했고 사용전검사 도면과 공사계획 도면이 일치 ③ 현장에 맞게 도면을 수정함을 인지·동의.",
          example: "☑ 동의함",
          exampleOfficial: true,
          caution: "읽지 않고 체크하지 마세요. 사실과 다르면 체크하지 말고 기관에 문의하세요.",
          basis: "양식 본문 동의 문구 3개",
        },
        M,
      ),
    },
    {
      id: "sign",
      label: "소유자 서명",
      box: m(596, 1306, 479, 58),
      guides: {
        owner: {
          whose: "설비 소유자(발전사업자) 본인",
          where: "해당 없음",
          how: "소유자 본인이 직접 서명해요.",
          example: "홍○○ (서명)",
          basis: "양식 주석 '** 소유자 또는 소유자의 위임을 받은 감리자'",
        },
        agent: {
          whose: "소유자의 위임을 받은 감리자",
          where: "소유자의 위임 관계 확인",
          how: "소유자에게 위임받은 감리자가 서명할 수 있어요. 위임을 받았는지 먼저 확인하세요.",
          example: "김○○ (감리자, 서명)",
          caution: "위임에 필요한 서류가 있는지는 기관에 확인하세요.",
          basis: "양식 주석 '** 소유자 또는 소유자의 위임을 받은 감리자'",
        },
      },
    },
    {
      id: "attach",
      label: "붙임",
      box: m(117, 1366, 958, 57),
      guides: same(
        {
          whose: "함께 내는 서류 표시",
          where: "내 공사 서류철",
          how: "최종 기술도서(도면, 구조계산서 등)를 함께 내는 경우 □에 체크하고 서류를 챙겨요.",
          example: "☑ 붙임 : 최종 기술도서(도면, 구조계산서 등)",
          exampleOfficial: true,
          basis: "양식 문구 '붙임 : 최종 기술도서(도면, 구조계산서 등)'",
        },
        M,
      ),
    },
  ],
  checklist: [
    "설비종류(태양광발전설비)가 내 설비와 맞나요?",
    "변경사항에 [별표 8]에 해당하지 않는 경미한 내용만 적었나요?",
    "동의함 3곳을 읽고 체크했나요?",
    "소유자 본인 또는 위임받은 감리자가 서명했나요?",
    "최종 기술도서(도면, 구조계산서 등)를 챙겼나요?",
  ],
  source: {
    name: "경미한 사항 변경 확인서",
    baseYear: "확인 필요",
    note: COMMON_NOTE,
    refs: [
      { label: "전기사업법 시행규칙 [별표 8] (공사계획 기재사항)", note: "양식 주석에 직접 적힌 기준. 별표의 현행 내용은 국가법령정보센터에서 확인 필요.", url: LAW(encodeURIComponent("전기사업법시행규칙")) },
      REF_SAFETY_ACT,
    ],
  },
};

/* ------------------------- 3. 공사계획 기술 규격서(UPS) ------------------------- */
const s = px(1190, 1680);
const S = ["have", "ask"];

/** 제품 정보를 이미 알고 있는 경우 / 아직 모르는 경우의 '어디서 확인' 문구 */
const spec = (g: Omit<Guide, "where"> & { where?: string }): Record<string, Guide> => ({
  have: { ...g, where: g.where ?? "제품 명판 · 제조사 사양서(데이터시트)" },
  ask: { ...g, where: "제조사·납품사에 사양서(데이터시트)를 요청해 확인하세요" },
});

const specForm: FormDef = {
  id: "spec",
  name: "공사계획 기술 규격서 (무정전전원장치)",
  summary: "UPS 제품·이차전지 사양을 적을 때",
  titleKey: "공사계획 기술 규격서(무정전전원장치)",
  template: { src: "/templates/spec.png", w: 1190, h: 1680 },
  question: {
    text: "제품 사양서(명판·데이터시트)를 가지고 있나요?",
    options: [
      { id: "have", label: "네, 가지고 있어요" },
      { id: "ask", label: "아니요, 아직 없어요" },
    ],
  },
  fields: [
    {
      id: "project",
      label: "공사명",
      box: s(80, 257, 500, 32),
      guides: same(
        { whose: "이번 UPS 공사의 이름", where: "공사계약서 · 사전 기술검토 신청서", how: "신청서의 공사명과 똑같이 적어요.", example: "○○센터 무정전전원장치 설치공사", basis: "[서식1] 사전 기술검토 신청서와 함께 제출" },
        S,
      ),
    },
    {
      id: "date",
      label: "작성일자",
      box: s(585, 257, 455, 32),
      guides: same({ whose: "이 규격서를 작성하는 날짜", where: "해당 없음", how: "년·월·일을 숫자로 적어요.", example: "2026년 10월 28일" }, S),
    },
    {
      id: "site",
      label: "수용가 명칭·위치",
      box: s(423, 319, 615, 58),
      guides: same(
        { whose: "UPS를 설치해 전기를 쓰는 곳(수용가)의 이름과 주소", where: "사업자등록증 · 공사계약서", how: "'수용가 명칭'에 사업장 이름, '위치(주소)'에 설치 장소 주소를 적어요.", example: "(주)가상전기 ○○센터 / 가상시 예시구 샘플로 1" },
        S,
      ),
    },
    {
      id: "load",
      label: "사용부하",
      box: s(423, 377, 615, 28),
      guides: same(
        { whose: "UPS가 전기를 공급하는 대상의 종류", where: "설계도서 · 설계 담당자", how: "통신부하·전산부하·비상부하 중 해당하는 □에 체크하고, 그 밖이면 '기타'의 괄호에 적어요.", example: "☑ 전산부하" },
        S,
      ),
    },
    {
      id: "maker",
      label: "제조사·형식",
      box: s(423, 407, 615, 58),
      guides: spec({ whose: "전력변환장치(UPS 본체)의 제조사와 형식", how: "제품에 적힌 제조사 이름과 모델(형식)을 그대로 옮겨 적어요.", example: "○○전기 / UPS-000 (가상)" }),
    },
    {
      id: "mode",
      label: "운영방식·구성방식",
      box: s(423, 466, 615, 58),
      guides: spec({
        whose: "UPS가 동작하는 방식과 구성(대수 구성) 방식",
        where: "제품 사양서 · 설계 구성도",
        how: "운영방식(On-line / Off-line / Line-interactive)과 구성방식(단독 / STAND-BY / N+1 / 2N / 2N+1 / STS) 중 해당하는 □에 체크해요.",
        example: "☑ On-line  ☑ N+1 (가상)",
        caution: "어떤 방식인지 모르면 임의로 체크하지 말고 제조사·설계자에게 확인하세요.",
      }),
    },
    {
      id: "capacity",
      label: "용량·수량",
      box: s(423, 525, 615, 58),
      guides: spec({
        whose: "UPS의 총 용량과 구성 수량",
        how: "용량은 숫자만 적고(단위 [kVA] 인쇄됨), 수량은 '용량 x 대수' 형태로 적어요.",
        example: "(예시) 1200 [kVA] / (예시) 600kVA x 2대",
        exampleOfficial: true,
        basis: "양식에 인쇄된 예시: 용량 1200 [kVA], 수량 600kVA x 2대",
      }),
    },
    {
      id: "voltage",
      label: "정격전압",
      box: s(423, 585, 615, 88),
      guides: spec({
        whose: "UPS의 정격전압 — 입력(AC), 출력(AC), 이차전지(DC) 세 줄",
        how: "세 줄 각각 숫자만 적어요. 단위 [V]는 이미 인쇄돼 있어요.",
        example: "(제품 사양서의 값을 그대로)",
        caution: "입력·출력·이차전지 줄이 서로 바뀌지 않게 하세요.",
        basis: "양식: 정격전압 입력(AC) [V] / 출력(AC) [V] / 이차전지(DC) [V]",
      }),
    },
    {
      id: "current",
      label: "정격전류",
      box: s(423, 674, 615, 88),
      guides: spec({
        whose: "UPS의 정격전류 — 입력, 출력, 이차전지 세 줄",
        how: "세 줄 각각 숫자만 적어요. 단위 [A]는 이미 인쇄돼 있어요.",
        example: "(제품 사양서의 값을 그대로)",
        basis: "양식: 정격전류 입력 [A] / 출력 [A] / 이차전지 [A]",
      }),
    },
    {
      id: "protect",
      label: "보호계전장치·인증",
      box: s(423, 762, 615, 58),
      guides: spec({
        whose: "UPS에 적용된 보호계전장치의 종류와 인증 제품 여부",
        where: "제품 사양서 · 설계 도면 · 인증서",
        how: "보호계전장치 종류를 글로 적고, 인증 제품이면 KC / KS / 기타 중 해당하는 □에 체크해요.",
        example: "(사양서에 적힌 종류를 그대로)",
        caution: "인증을 받았는지 모르면 인증서를 확인하거나 제조사에 문의하세요.",
      }),
    },
    {
      id: "battery_type",
      label: "이차전지 종류·제조사",
      box: s(423, 822, 615, 58),
      guides: spec({
        whose: "이차전지(배터리)의 종류와 제조사",
        where: "배터리 명판 · 사양서",
        how: "리튬이온 / 리튬인산철 / 납(연) / 니켈카드뮴 / 기타 중 해당하는 □에 체크하고, 제조사를 적어요.",
        example: "☑ 리튬인산철 / ○○배터리 (가상)",
      }),
    },
    {
      id: "battery_spec",
      label: "이차전지 용량·전압·전류",
      box: s(423, 880, 615, 88),
      guides: spec({
        whose: "이차전지의 용량, 전압범위, 전류",
        how: "각 줄에 숫자만 적어요. 단위는 용량 [kWh], 전압범위 [V], 전류 [A]로 이미 인쇄돼 있어요.",
        example: "(배터리 사양서의 값을 그대로)",
        basis: "양식: 용량 [kWh] / 전압범위 [V] / 전류 [A]",
      }),
    },
    {
      id: "install",
      label: "설치장소·충전율",
      box: s(423, 969, 615, 58),
      guides: same(
        {
          whose: "이차전지가 설치되는 장소와 충전율(SOC)",
          where: "설계 도면 · 설치 계획 · 배터리 사양서",
          how: "옥내 / 옥외(전용건물·컨테이너·기타) 중 해당하는 □에 체크하고, 충전율(SOC)은 숫자만 적어요. 단위 [%]는 인쇄돼 있어요.",
          example: "☑ 옥내",
        },
        S,
      ),
    },
    {
      id: "cert2",
      label: "이차전지 인증",
      box: s(423, 1030, 615, 28),
      guides: spec({
        whose: "이차전지가 인증 제품인지 여부",
        where: "인증서 · 배터리 사양서",
        how: "KS / 기타 중 해당하는 □에 체크하고, 기타이면 괄호에 적어요.",
        example: "☑ KS (가상)",
        caution: "인증 여부를 모르면 인증서를 확인하세요.",
      }),
    },
  ],
  checklist: [
    "공사명이 [서식1] 신청서의 공사명과 같은가요?",
    "각 항목의 체크박스(□)를 해당하는 것에 표시했나요?",
    "전압·전류·용량은 단위(V, A, kVA, kWh)가 인쇄돼 있으니 숫자만 적었나요?",
    "예시(파란 글씨)를 지우고 내 제품 값으로 적었나요?",
  ],
  source: {
    name: "공사계획 기술 규격서(무정전전원장치) [서식2]",
    baseYear: "확인 필요",
    note: COMMON_NOTE,
    refs: [
      { label: "공사계획 기술 규격서는 사전 기술검토 신청서 첨부서류 7호", note: "[서식1] 양식에 인쇄된 첨부서류 문구." },
      REF_SAFETY_RULE,
    ],
  },
};

export const forms: FormDef[] = [apply, minor, specForm];

export const getForm = (id: string) => forms.find((f) => f.id === id);

export const guideText = (g: Guide) =>
  `누구의 정보인가요? ${g.whose}. 어디서 확인하나요? ${g.where}. 어떻게 쓰나요? ${g.how}${g.caution ? ` 주의하세요. ${g.caution}` : ""}`;
