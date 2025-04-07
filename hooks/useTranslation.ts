import { useLanguage } from '@/context/langcontext';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

const translations = {
    en,
    fr,
};

type NestedKey<T> = T extends object ? { [K in keyof T]: NestedKey<T[K]> } : never;
type TranslationKey = keyof typeof en | `${keyof typeof en}.${string}`;

export const useTranslation = () => {
    const { language } = useLanguage();
    const t = (key: TranslationKey) => {
        const keys = key.split('.') as (keyof typeof en)[];
        let translation = translations[language] as any;

        for (let k of keys) {
            translation = translation[k];
            if (!translation) return key;
        }

        return translation;
    };
    return { t };
};