"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

export default function Browser() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BrowserContent />
    </Suspense>
  );
}

function BrowserContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  return <section></section>;
}