export type AssistantPhoto = {
  url: string;
  dataUrl: string;
  width: number;
  height: number;
  name: string;
  sample: boolean;
  warnings: string[];
};

export type GuidePage = { kind: "explanation" | "example" | "check"; label: string; text: string; start: number; end: number };
