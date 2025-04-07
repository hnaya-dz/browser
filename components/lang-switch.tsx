import { useState } from 'react';
import { useLanguage } from '@/context/langcontext';

export default function LangSwitch() {
    const { language, toggleLanguage } = useLanguage();

    return (
        <div className="relative flex justify-center items-center gap-2 text-md font-extrabold bg-gray-300 rounded-lg h-[3vh]">
            {/* Moving Box */}
            <div
                className={`absolute p-1 top-0 left-0 w-1/2 h-[100%] border-gray-300 border-2 bg-white dark:bg-gray-900 rounded-lg transition-all duration-300 ease-in-out transform ${language === 'en' ? 'translate-x-full' : ''
                    }`}
            />
            {/* Language Options */}
            <div
                role='button'
                tabIndex={0}
                className={`cursor-pointer px-4 py-2 z-10 ${language === 'fr' ? 'text-black dark:text-white' : 'text-white dark:text-black'
                    }`}
                onClick={() => toggleLanguage('fr')}
            >
                FR
            </div>
            <div
                role='button'
                tabIndex={0}
                className={`cursor-pointer px-4 py-2 z-10 ${language === 'en' ? 'text-black dark:text-white' : 'text-white dark:text-black'
                    }`}
                onClick={() => toggleLanguage('en')}
            >
                EN
            </div>
        </div>
    );
}