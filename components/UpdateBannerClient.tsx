"use client";
import dynamic from "next/dynamic";

const UpdateBanner = dynamic(() => import("./UpdateBanner"), { ssr: false });

export default function UpdateBannerClient() {
  return <UpdateBanner />;
}
