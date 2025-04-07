"use client"
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

export default function Home() {
  const [query, setQuery] = useState("")
  const router = useRouter();
  const { t } = useTranslation();

  const handleSearch = () => {
    if (query.trim()) {
      router.push(`/results?q=${encodeURIComponent(query)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };


  return (
    <section className="flex flex-col items-center w-[100vw] h-[92vh]">
      <div className="flex flex-col justify-center items-center gap-12 mt-[24vh]">
        <img src="hnaya.png" alt="Hnaya DZ" />
        <div className="flex gap-4">
          <Input
            className="w-[50vw]"
            value={query}
            onKeyDown={handleKeyDown}
            onChange={(e) => setQuery(e.target.value)} />
          <Button onPress={handleSearch} color="primary" className="font-bold">
            {t("HomePage.search")}
          </Button>
        </div>
      </div>
    </section>
  );
}
