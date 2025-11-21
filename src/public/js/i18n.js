import { STORAGE_KEYS, SUPPORTED_LANGUAGES, VISIBILITY_OPTIONS } from './constants.js';
import enTranslations from './i18n/i18n_en.js';
import zhTranslations from './i18n/i18n_zh-cn.js';

export const translations = {
	en: enTranslations,
	zh: zhTranslations,
};

export class I18n {
	constructor(options = {}) {
		this.translations = options.translations || translations;
		this.fallback = options.fallback || 'en';
		this.supportedLanguages = options.supportedLanguages || SUPPORTED_LANGUAGES;
		this.storageKey = options.storageKey || STORAGE_KEYS.language;
		this.languagePreference = this.loadPreference();
		this.currentLanguage = this.resolveLanguage(this.languagePreference);
	}

	loadPreference() {
		const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
		return saved && this.supportedLanguages.includes(saved) ? saved : 'system';
	}

	resolveLanguage(pref) {
		if (!pref || pref === 'system') {
			const navLang = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en';
			return navLang.toLowerCase().startsWith('zh') ? 'zh' : this.fallback;
		}
		return this.supportedLanguages.includes(pref) ? pref : this.fallback;
	}

	setLanguagePreference(pref) {
		const normalized = this.supportedLanguages.includes(pref) ? pref : 'system';
		this.languagePreference = normalized;
		this.currentLanguage = this.resolveLanguage(normalized);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(this.storageKey, normalized);
		}
		return this.currentLanguage;
	}

	get locale() {
		return this.currentLanguage === 'zh' ? 'zh-CN' : 'en-US';
	}

	t(key) {
		const lang = this.translations[this.currentLanguage] || this.translations[this.fallback] || {};
		const fallbackStrings = this.translations[this.fallback]?.strings || {};
		return lang.strings?.[key] ?? fallbackStrings[key] ?? key;
	}

	translateMessage(message) {
		if (!message) return message;
		const langMessages = this.translations[this.currentLanguage]?.messages || {};
		const fallbackMessages = this.translations[this.fallback]?.messages || {};
		if (langMessages[message]) return langMessages[message];
		if (fallbackMessages[message]) return fallbackMessages[message];
		const langText = this.translations[this.currentLanguage]?.textMap || {};
		if (langText[message]) return langText[message];

		if (message.startsWith('Error:')) {
			return `${this.t('failedToLoadPrefix')} ${message.replace(/^Error:\\s*/, '')}`;
		}
		if (message.startsWith('Failed to load:')) {
			return `${this.t('failedToLoadPrefix')} ${message.replace(/^Failed to load:\\s*/, '')}`;
		}
		if (message.startsWith('Update failed:')) {
			return `${this.t('failedToLoadPrefix')} ${message.replace(/^Update failed:\\s*/, '')}`;
		}
		if (message.startsWith('Upload Failed:')) {
			return `${this.t('failedToLoadPrefix')} ${message.replace(/^Upload Failed:\\s*/, '')}`;
		}
		return message;
	}

	formatNoteCount(count) {
		const num = Number(count) || 0;
		const key = num === 1 ? 'note' : 'notes';
		return `${num} ${this.t(key)}`;
	}

	translateVisibility(value) {
		const normalized = (value || 'private').toLowerCase();
		if (normalized === 'public') return this.translateMessage('Public');
		if (normalized === 'users') return this.translateMessage('Users');
		return this.translateMessage('Private');
	}

	renderVisibilityOptions(selectEl, currentValue, options = VISIBILITY_OPTIONS) {
		if (!selectEl) return;
		const value = currentValue || selectEl.value || 'private';
		selectEl.innerHTML = options.map(opt => `<option value=\"${opt}\">${this.translateVisibility(opt)}</option>`).join('');
		selectEl.value = value;
	}

	renderLanguageOptions(selectEl, currentValue) {
		if (!selectEl) return;
		const current = currentValue || selectEl.value || this.languagePreference;
		const optionsHtml = this.supportedLanguages.map(code => {
			const label = code === 'system'
				? (this.translations[this.currentLanguage]?.strings?.languageFollowSystem || 'System')
				: (this.translations[code]?.langLabel || code);
			return `<option value='${code}'>${label}</option>`;
		});
		selectEl.innerHTML = optionsHtml.join('');
		selectEl.value = current;
	}
}
