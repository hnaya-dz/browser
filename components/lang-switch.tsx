"use client";
import { useLanguage } from '@/context/langcontext';

const LANGS = [
    { code: 'ar', label: 'ع' },
    { code: 'fr', label: 'FR' },
    { code: 'en', label: 'EN' },
] as const;

export default function LangSwitch() {
    const { language, toggleLanguage } = useLanguage();
    const activeIndex = LANGS.findIndex(l => l.code === language);

    return (
        <div className="relative flex items-center bg-gray-200 dark:bg-gray-800 rounded-lg h-[3vh] p-0.5 gap-0">
            {/* Sliding indicator */}
            <div
                className="absolute h-[calc(100%-4px)] rounded-md bg-white dark:bg-gray-900 shadow transition-all duration-300 ease-in-out"
                style={{
                    width: `${100 / LANGS.length}%`,
                    left: `calc(${(activeIndex / LANGS.length) * 100}% + 2px)`,
                }}
            />
            {LANGS.map(({ code, label }) => (
                <button
                    key={code}
                    onClick={() => toggleLanguage(code)}
                    className={`relative z-10 px-3 py-1 text-xs font-bold rounded-md transition-colors duration-200 ${
                        language === code
                            ? 'text-black dark:text-white'
                            : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
