"use client";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@heroui/link";
import { useTabContext } from "@/context/tabcontext";
import { CircularProgress } from "@heroui/progress";
import { useLoading } from "@/context/loadingcontext";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";


export default function Results() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResultsContent />
    </Suspense>
  );
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const { addTab } = useTabContext();
  const { isLoading, setIsLoading } = useLoading();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [browserMode, setBrowserMode] = useState(false);

  useEffect(() => {
    if (initialQuery) {
      handleSearch(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (query) {
      handleSearch(query);
    }
  }, [language]);


  const handleSearch = async (searchQuery: string) => {
    const url = "https://www.googleapis.com/customsearch/v1";
    const params = new URLSearchParams({
      key: "AIzaSyDiykJAkfIsajSvgdHHexDzNuone_NkCgM",
      cx: "213728a58395143b8",
      cr: "countryDZ",
      lr: `lang_${language}`,
      q: searchQuery,
    });

    try {
      const response = await fetch(`${url}?${params}`);
      const data = await response.json();
      setResults(data.items || []);
    } catch (error) {
      console.error("Error fetching search results:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch(query);
    }
  };

  useEffect(() => {
    const handleNewTab = (event: any, url: string) => {
      addTab(url);
    };

    window.electronAPI?.receive("open-new-tab", handleNewTab);
  }, [addTab]);

  useEffect(() => {
    const handleNewTab = (_event: any, url: string) => {
      addTab(url);
    };

    window.electronAPI?.receive('open-link-in-new-tab', handleNewTab);
  }, []);

  return (
    <>
      {(isLoading) ?
        (<section className="flex w-screen h-[94vh] flex-col items-center justify-center">
          {/* <CircularProgress size="lg" /> */}
        </section>) :
        (<div className="mt-[14vh]">
          <section className="flex flex-col items-start ml-28 my-6">
            <div className="flex justify-center items-center gap-4">
              <Input
                className="w-[50vw]"
                value={query}
                onKeyDown={handleKeyDown}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button onPress={() => handleSearch(query)} color="primary" className="font-bold">
                {t("ResultPage.search")}
              </Button>
            </div>
            <div className="w-[50vw] mt-6">
              {results.length > 0 && (
                <div>
                  {results.map((item: any, index) => (
                    <div key={index} className="mb-4 pb-4 last:border-b-0">
                      <Link
                        className="text-xl font-semibold hover:cursor-pointer"
                        onPress={() => { addTab(item.link); setIsLoading(true) }}
                        rel="noopener noreferrer"
                      >
                        {item.title}
                      </Link>
                      <p className="text-sm">{item.snippet}</p>
                      <p className="text-xs">{item.displayLink}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>)}
    </>
  );
}