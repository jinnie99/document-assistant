export type LegalReferenceKind = "law" | "administrative_rule";

export type LegalSearchReference = {
  name: string;
  kind: LegalReferenceKind;
  authority?: string;
  number?: string;
  date?: string;
  formNumber?: string;
};

export type LegalPrintedArticle = { lawName: string; article: string; removed?: boolean };

export type LegalFormListing = { title: string; lawName: string; lawSerial: string; number: string; authority: string; date: string };

export type LegalCurrentForm = {
  title: string;
  lawName: string;
  lawSerial: string;
  label: string;
  revision: string;
  hwpUrl: string;
  pdfUrl: string;
  articles: LegalPrintedArticle[];
};

export type LegalReferenceHints = {
  references: LegalSearchReference[];
  /** 서류에 인쇄된 수신처·처리기관 문구. 공식 근거가 아니라 사진에 적힌 그대로의 값이다. */
  receivingOffice?: string;
  /** 서류 문구에 인쇄된 근거 조문. 예: 전기사업법 시행규칙 제32조제5항 */
  citedArticles?: LegalPrintedArticle[];
};

export type LegalCandidate = {
  id: string;
  serialNumber: string;
  kind: LegalReferenceKind;
  name: string;
  category: string;
  authority: string;
  promulgationNumber: string;
  promulgationDate: string;
  effectiveDate: string;
  status: "current" | "repealed" | "unknown";
  apiTarget: "law" | "admrul";
};

export type LegalApiResult<T> = {
  value: T;
  retrievedAt: string;
  stale: boolean;
};

export type LegalApiDocument = {
  target: string;
  payload: unknown;
};

export type LegalSource = {
  id: string;
  title: string;
  url: string;
  kind: "law" | "administrative_rule" | "procedure" | "form";
  retrievedAt: string;
};

export type LegalProvision = {
  id: string;
  lawName: string;
  article: string;
  title: string;
  text: string;
  sourceIds: string[];
};

export type LegalHierarchy = {
  act: LegalCandidate | null;
  decree: LegalCandidate | null;
  rule: LegalCandidate | null;
  administrativeRules: LegalCandidate[];
};

export type ProcedureInfo = {
  reception: string;
  submission: string;
  requiredItems: string[];
  fee: string;
  processingTime: string;
  contact: string;
  sourceIds: string[];
  /** 항목별 출처. 법령에서 먼저 채우고 빈 항목만 웹 자료로 채운다. */
  fieldOrigins?: Partial<Record<"reception" | "submission" | "requiredItems" | "fee" | "processingTime" | "contact", "law" | "web">>;
};

export type LegalFormEntry = { id: string; title: string; url: string; sourceIds: string[]; label?: string; revision?: string };
export type LegalContact = { department: string; phone: string };

export type LegalContext = {
  status: "pending" | "completed" | "unavailable" | "ambiguous" | "not_found";
  detectedReferences: LegalSearchReference[];
  candidates: LegalCandidate[];
  canonicalRule: LegalCandidate | null;
  hierarchy: LegalHierarchy;
  provisions: LegalProvision[];
  forms: LegalFormEntry[];
  currentForm?: LegalCurrentForm;
  contacts?: LegalContact[];
  authority: string;
  department?: string;
  printedReceivingOffice?: string;
  printedArticles?: LegalPrintedArticle[];
  procedure: ProcedureInfo | null;
  summary: string;
  summarySourceIds?: string[];
  sources: LegalSource[];
  warnings: string[];
  retrievedAt: string;
  stale: boolean;
};
