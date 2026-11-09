export async function createSampleFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1273;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("예시 사진을 준비하지 못했어요.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const text = (value: string, x: number, y: number, size = 23, strong = false) => {
    context.fillStyle = "#243447";
    context.font = `${strong ? "bold " : ""}${size}px sans-serif`;
    context.fillText(value, x, y);
  };
  text("가상 서류 · 실제 기관에서 쓰는 양식이 아닙니다", 65, 70, 18);
  text("동네 생활 상담 신청서", 240, 155, 39, true);
  text("상담받을 분의 정보를 적어 주세요.", 65, 230);
  text("1. 상담받을 분", 65, 290, 27, true);
  const row = (label: string, y: number, height = 64) => {
    context.fillStyle = "#f0f3f7";
    context.fillRect(65, y, 180, height);
    context.strokeStyle = "#778595";
    context.lineWidth = 1.5;
    context.strokeRect(65, y, 770, height);
    context.beginPath(); context.moveTo(245, y); context.lineTo(245, y + height); context.stroke();
    text(label, 82, y + height / 2 + 8);
  };
  row("이름", 320);
  row("전화번호", 384);
  row("사는 곳", 448, 86);
  text("2. 어떤 도움이 필요하신가요?", 65, 600, 27, true);
  context.strokeRect(65, 625, 770, 185);
  text("3. 대신 오신 분이 있다면 적어 주세요", 65, 885, 27, true);
  row("이름과 관계", 910);
  text("상담받을 분과 함께 확인한 뒤 서명해 주세요.", 65, 1070);
  text("서명", 65, 1135);
  context.beginPath(); context.moveTo(245, 1145); context.lineTo(835, 1145); context.stroke();
  text("화면 기능을 시험하기 위한 가상 서류입니다.", 245, 1220, 18);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("예시 사진을 만들지 못했어요.")), "image/png"));
  return new File([blob], "가상-생활상담-신청서.png", { type: "image/png" });
}
