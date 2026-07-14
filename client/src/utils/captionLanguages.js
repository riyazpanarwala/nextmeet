// Curated list — the Web Speech API doesn't expose a way to enumerate
// what a browser actually supports, so we hardcode common BCP-47 tags
// with human-readable labels rather than guessing at runtime.
export const CAPTION_LANGUAGES = [
    { code: 'en-US', label: 'English (US)' },
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'en-IN', label: 'English (India)' },
    { code: 'es-ES', label: 'Spanish (Spain)' },
    { code: 'es-MX', label: 'Spanish (Mexico)' },
    { code: 'fr-FR', label: 'French' },
    { code: 'de-DE', label: 'German' },
    { code: 'it-IT', label: 'Italian' },
    { code: 'pt-BR', label: 'Portuguese (Brazil)' },
    { code: 'pt-PT', label: 'Portuguese (Portugal)' },
    { code: 'nl-NL', label: 'Dutch' },
    { code: 'hi-IN', label: 'Hindi' },
    { code: 'gu-IN', label: 'Gujarati' },
    { code: 'ta-IN', label: 'Tamil' },
    { code: 'te-IN', label: 'Telugu' },
    { code: 'bn-IN', label: 'Bengali' },
    { code: 'mr-IN', label: 'Marathi' },
    { code: 'zh-CN', label: 'Chinese (Mandarin, Simplified)' },
    { code: 'zh-TW', label: 'Chinese (Mandarin, Traditional)' },
    { code: 'ja-JP', label: 'Japanese' },
    { code: 'ko-KR', label: 'Korean' },
    { code: 'ar-SA', label: 'Arabic' },
    { code: 'ru-RU', label: 'Russian' },
    { code: 'tr-TR', label: 'Turkish' },
    { code: 'vi-VN', label: 'Vietnamese' },
    { code: 'id-ID', label: 'Indonesian' },
    { code: 'pl-PL', label: 'Polish' },
];

const STORAGE_KEY = 'nexmeet-caption-lang';

export function getStoredCaptionLang() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && CAPTION_LANGUAGES.some((l) => l.code === stored)) return stored;
    } catch {
        // Ignore storage failures (e.g. private browsing).
    }
    return 'en-US';
}

export function storeCaptionLang(code) {
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch {
        // Ignore storage failures; the in-session choice still works.
    }
}