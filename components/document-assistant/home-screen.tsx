"use client";

import type { Ref } from "react";
import Image from "next/image";
import { ArrowRight, Camera, PlayCircle, ShieldCheck, Upload } from "lucide-react";

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  preparing: boolean;
  configured: boolean | null;
  onCamera: () => void;
  onGallery: () => void;
  onSample: () => void;
};

export function HomeScreen({ headingRef, preparing, configured, onCamera, onGallery, onSample }: Props) {
  return <section className="assist-home">
    <div className="assist-home-copy">
      <p className="assist-home-eyebrow">사진으로 받는 쉬운 작성 안내</p>
      <h1 ref={headingRef} tabIndex={-1}>서류 쓰다가<br /><span>막히셨나요?</span></h1>
      <p className="assist-home-description">사진으로 보여주시면<br />어디에 무엇을 쓸지 알려드려요.</p>
    </div>
    <div className="assist-home-art" aria-hidden="true">
      <Image className="assist-home-illustration" src="/images/home-guide-warm.webp" alt="" fill sizes="(max-width: 480px) 100vw, 390px" loading="eager" fetchPriority="high" />
    </div>
    <div className="assist-home-buttons">
      <button className="assist-button assist-primary" disabled={preparing} onClick={onCamera}><Camera />서류 사진 찍기<ArrowRight /></button>
      <button className="assist-button assist-secondary" disabled={preparing} onClick={onGallery}><Upload />찍어둔 사진 고르기</button>
      <div className="assist-home-links">
        <button className="assist-text-button" disabled={preparing} onClick={onSample}>{preparing ? "사진을 준비하고 있어요…" : "먼저 예시로 살펴보기"}<ArrowRight /></button>
        <a className="assist-text-button" href="/promo"><PlayCircle />시연영상 보기</a>
      </div>
    </div>
    <p className="assist-reassurance"><ShieldCheck />사진은 서버에 파일로 남기지 않아요.</p>
    {configured === false && <p className="assist-service-note">서비스 연결을 준비하고 있어요. 설정이 끝나면 실제 안내를 받을 수 있어요.</p>}
  </section>;
}
