"use client";
import { useEffect } from "react";
import { useLanguage } from "@/context/langcontext";

export default function HtmlWrapper({ children }: { children: React.ReactNode }) {
    const { language, isRTL } = useLanguage();

    useEffect(() => {
        document.documentElement.lang = language;
        document.documentElement.dir = isRTL ? "rtl" : "ltr";
    }, [language, isRTL]);

    return <>{children}</>;
}
