import type { Metadata } from "next";
import { DocumentAssistant } from "@/components/document-assistant/assistant";
import "./assistant.css";

export const metadata: Metadata = {
  title: "서류작성 도우미 · 사진으로 쉽게 안내",
  description: "서류 사진을 읽고 작성 안내를 찾아, 궁금한 칸부터 쉽게 설명합니다.",
};

export default function AssistPage() { return <DocumentAssistant />; }
