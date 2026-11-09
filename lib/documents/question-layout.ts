export type QuestionLayout = "all" | "choices" | "separate";

export type QuestionMeasurements = {
  height: number;
  questionHeight: number;
  choiceHeights: number[];
  choiceGap: number;
  sectionGap: number;
  pagerHeight: number;
};

export function questionLayout({ height, questionHeight, choiceHeights, choiceGap, sectionGap, pagerHeight }: QuestionMeasurements): QuestionLayout {
  const allChoices = choiceHeights.reduce((total, choiceHeight) => total + choiceHeight, 0) + choiceGap * Math.max(0, choiceHeights.length - 1);
  if (questionHeight + sectionGap + allChoices <= height) return "all";
  const oneChoice = Math.max(0, ...choiceHeights);
  return questionHeight + oneChoice + pagerHeight + sectionGap * 2 <= height ? "choices" : "separate";
}
