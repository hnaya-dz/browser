"use client";
import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

type Language = 'ar' | 'fr' | 'en';

interface LanguageContextType {
    language: Language;
    toggleLanguage: (lang: Language) => void;
    isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguage] = useState<Language | null>(null);

    useEffect(() => {
        const stored = localStorage.getItem('language') as Language;
        setLanguage(stored && ['ar', 'fr', 'en'].includes(stored) ? stored : 'ar');
    }, []);

    useEffect(() => {
        if (language) {
            localStorage.setItem('language', language);
        }
    }, [language]);

    if (language === null) return null;

    const toggleLanguage = (lang: Language) => setLanguage(lang);
    const isRTL = language === 'ar';

    return (
        <LanguageContext.Provider value={{ language, toggleLanguage, isRTL }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
    return context;
};
