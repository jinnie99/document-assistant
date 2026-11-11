/** 예시로 살펴보기에 쓰는 서식: 정기검사 신청서. 홈 화면의 "예시 서류 사진 받기"와 같은 파일이다. */
export const SAMPLE_DOCUMENT_URL = "/samples/inspection-form-sample.png";
export const SAMPLE_DOCUMENT_NAME = "정기검사_신청서_예시.png";

export async function createSampleFile(): Promise<File> {
  const response = await fetch(SAMPLE_DOCUMENT_URL).catch(() => undefined);
  if (!response?.ok) throw new Error("예시 사진을 준비하지 못했어요.");
  return new File([await response.blob()], SAMPLE_DOCUMENT_NAME, { type: "image/png" });
}
