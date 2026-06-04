import { useLanguage } from '@/context/langcontext';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import ar from '@/locales/ar.json';

const translations = { en, fr, ar };

type TranslationKey = string;

export const useTranslation = () => {
    const { language } = useLanguage();
    const t = (key: TranslationKey): string => {
        const keys = key.split('.');
        let translation = translations[language] as any;
        for (const k of keys) {
            translation = translation?.[k];
            if (!translation) return key;
        }
        return translation;
    };
    return { t };
};
