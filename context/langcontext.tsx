"use client";
import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

type Language = 'en' | 'fr';

interface LanguageContextType {
    language: Language;
    toggleLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    // Create a state for the language, initially null until client-side rendering
    const [language, setLanguage] = useState<Language | null>(null);

    // Once the component mounts, check for stored language in localStorage
    useEffect(() => {
        const storedLanguage = localStorage.getItem('language') as Language;
        if (storedLanguage) {
            setLanguage(storedLanguage);
        } else {
            setLanguage('en'); // Default language
        }
    }, []);

    // Update localStorage whenever the language changes
    useEffect(() => {
        if (language) {
            localStorage.setItem('language', language);
        }
    }, [language]);

    // Prevent rendering until language is set
    if (language === null) {
        return null; // You can show a loading spinner or something here
    }

    const toggleLanguage = (lang: Language) => setLanguage(lang);

    return (
        <LanguageContext.Provider value={{ language, toggleLanguage }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};