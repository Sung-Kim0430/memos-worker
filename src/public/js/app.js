import { I18n, translations } from './i18n.js';
import { DEFAULT_UI_SETTINGS, NOTE_TRUNCATE_LENGTH, STORAGE_KEYS, SUPPORTED_LANGUAGES, THEME_OPTIONS, VISIBILITY_OPTIONS } from './constants.js';

const i18n = new I18n({
	translations,
	supportedLanguages: SUPPORTED_LANGUAGES,
	storageKey: STORAGE_KEYS.language,
});
let languagePreference = i18n.languagePreference;
let currentLanguage = i18n.currentLanguage;
const languageSelect = document.getElementById('language-select');
const settingsLanguageSelect = document.getElementById('settings-language-select');
let themePreference = localStorage.getItem(STORAGE_KEYS.theme);
if (!THEME_OPTIONS.includes(themePreference)) {
	themePreference = 'system';
}
const textNodeOriginals = new WeakMap();
let timelineDataCache = null;
const getLocale = () => i18n.locale;
const t = (key) => i18n.t(key);
const translateMessage = (message) => i18n.translateMessage(message);
const formatNoteCountLabel = (count) => i18n.formatNoteCount(count);
const translateVisibility = (value) => i18n.translateVisibility(value);
function renderVisibilityOptions(selectEl, currentValue) {
	i18n.renderVisibilityOptions(selectEl, currentValue, VISIBILITY_OPTIONS);
}

	function extractErrorMessage(errorPayload, fallback = 'Request failed') {
		if (!errorPayload) return fallback;
		if (typeof errorPayload === 'string') return errorPayload;
		if (typeof errorPayload?.error === 'string') return errorPayload.error;
		if (errorPayload?.error?.message) return errorPayload.error.message;
		if (errorPayload?.message) return errorPayload.message;
		if (errorPayload?.error?.code) return errorPayload.error.code;
		return fallback;
	}

	function applyEditorToolbarTranslations() {
		const fontSizeSelector = document.getElementById('fs-fontsize-selector');
		if (fontSizeSelector) {
			fontSizeSelector.title = translateMessage('Font Size');
			const defaultOption = fontSizeSelector.querySelector('option[value=""]');
			if (defaultOption) defaultOption.textContent = translateMessage('Size');
		}
		const fontColorBtn = document.getElementById('fs-fontcolor-btn');
		if (fontColorBtn) fontColorBtn.title = translateMessage('Font Color');
		[
			['button[data-md="bold"]', 'Bold (Ctrl+B)'],
			['button[data-md="underline"]', 'Underline'],
			['button[data-md="italic"]', 'Italic (Ctrl+I)'],
			['button[data-md="strike"]', 'Strikethrough'],
			['button[data-md="link"]', 'Insert Link (Ctrl+K)'],
			['button[data-md="image"]', 'Insert Image'],
			['button[data-md="blockquote"]', 'Blockquote'],
			['button[data-md="ulist"]', 'Unordered List'],
			['button[data-md="code"]', 'Insert Code Block']
		].forEach(([selector, key]) => {
			document.querySelectorAll(selector).forEach(el => {
				el.title = translateMessage(key);
				if (el.textContent && ['Link', 'Img', 'Code'].includes(el.textContent.trim())) {
					// Update short labels for clearer localization
					el.textContent = translateMessage(el.textContent.trim());
				}
			});
		});
		const fsVisibilitySelect = document.getElementById('fs-visibility-select');
		if (fsVisibilitySelect) {
			renderVisibilityOptions(fsVisibilitySelect, fsVisibilitySelect.value);
			fsVisibilitySelect.title = translateMessage('Visibility');
		}
		const fsTimestampLabel = document.getElementById('fs-timestamp-label');
		if (fsTimestampLabel) {
			fsTimestampLabel.title = translateMessage('If unchecked, the note\'s timestamp will be updated upon saving.');
			const span = fsTimestampLabel.querySelector('span');
			if (span) span.textContent = translateMessage('Keep Time');
		}
		const fsTextarea = document.getElementById('fs-editor-textarea');
		if (fsTextarea) fsTextarea.placeholder = t('notePlaceholder');

		const toolbarTitleMap = [
			['#view-mode-split-btn', t('toggleSplit')],
			['#view-mode-preview-btn', t('togglePreview')]
		];
		toolbarTitleMap.forEach(([selector, title]) => {
			const el = document.querySelector(selector);
			if (el) el.title = title;
		});
	}

	const attributeBindings = [
		{ selector: '#username', attr: 'placeholder', key: 'usernamePlaceholder' },
		{ selector: '#password', attr: 'placeholder', key: 'passwordPlaceholder' },
		{ selector: '#login-btn', attr: 'text', key: 'login' },
		{ selector: '#global-search-input', attr: 'placeholder', key: 'searchPlaceholder' },
		{ selector: '#clear-search-btn', attr: 'title', key: 'clear' },
		{ selector: '#clear-tags-filter-btn', attr: 'title', key: 'clearTagFilter' },
		{ selector: '#clear-filter-btn', attr: 'title', key: 'showAllNotes' },
		{ selector: '#note-input', attr: 'placeholder', key: 'notePlaceholder' },
		{ selector: '#insert-tag-btn', attr: 'title', key: 'insertTag' },
		{ selector: '#tag-search-input', attr: 'placeholder', key: 'searchOrSelectTag' },
		{ selector: '#insert-image-btn', attr: 'title', key: 'insertImage' },
		{ selector: '#select-files-btn', attr: 'title', key: 'selectFiles' },
		{ selector: '#enter-fullscreen-btn', attr: 'title', key: 'fullscreenEditor' },
		{ selector: '#main-preview-toggle-btn', attr: 'title', key: 'togglePreview' },
		{ selector: '#main-split-toggle-btn', attr: 'title', key: 'toggleSplit' },
		{ selector: '#refresh-btn', attr: 'title', key: 'refresh' },
		{ selector: '#waterfall-toggle-btn', attr: 'title', key: 'toggleWaterfall' },
		{ selector: '#wide-mode-toggle-btn', attr: 'title', key: 'toggleWide' },
		{ selector: '#more-actions-btn', attr: 'title', key: 'moreOptions' },
		{ selector: '#theme-color-btn', attr: 'title', key: 'themeColor' },
		{ selector: '#share-link-close-btn', attr: 'text', key: 'close' },
		{ selector: '#home-tab-btn', attr: 'title', key: 'homeTabTitle' },
		{ selector: '#favorites-tab-btn', attr: 'title', key: 'favoritesTabTitle' },
		{ selector: '#archive-tab-btn', attr: 'title', key: 'archiveTabTitle' },
		{ selector: '#attachments-tab-btn', attr: 'title', key: 'attachmentsTabTitle' },
		{ selector: '#docs-tab-btn', attr: 'title', key: 'openDocs' }
	];

	function applyAttributeTranslations() {
		attributeBindings.forEach(binding => {
			const el = document.querySelector(binding.selector);
			if (!el) return;
			const value = t(binding.key);
			if (binding.attr === 'text') {
				el.textContent = value;
			} else {
				el.setAttribute(binding.attr, value);
			}
		});
	}

	function applyTextTranslations() {
		const map = translations[currentLanguage]?.textMap || {};
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
			acceptNode: node => {
				if (!node || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
				if (node.parentElement && node.parentElement.closest('script, style')) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});
		let node;
		while ((node = walker.nextNode())) {
			if (!textNodeOriginals.has(node)) {
				textNodeOriginals.set(node, node.nodeValue);
			}
			const original = textNodeOriginals.get(node);
			const key = original.trim();
			const translated = map[key];
			if (translated) {
				node.nodeValue = original.replace(key, translated);
			} else if (currentLanguage === 'en') {
				node.nodeValue = original;
			}
		}
	}

	function renderThemeToggleLabel(theme, preference = theme) {
		const btn = document.getElementById('theme-toggle-btn');
		if (!btn) return;
		const sunIcon = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"currentColor\">' +
			'<path d=\"M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l1.06 1.06c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L5.99 4.58zm12.02 12.02c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l1.06 1.06c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41l-1.06-1.06zM20 6.01c.39-.39.39-1.02 0-1.41-.39-.39-1.02-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0l1.06-1.06zM7.05 18.01c.39-.39.39-1.02 0-1.41-.39-.39-1.02-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0l1.06-1.06z\">' +
			'</path>' +
			`</svg><span>${t('lightMode')}</span>`;
		const moonIcon = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M10 2c-1.82 0-3.53.5-5 1.35C7.99 5.08 10 8.3 10 12s-2.01 6.92-5 8.65C6.47 21.5 8.18 22 10 22c5.52 0 10-4.48 10-10S15.52 2 10 2z\">' +
			'</path></svg>' +
			`<span>${t('darkMode')}</span>`;
		const systemIcon = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M4 5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2H4zm0 2h16v8H4V7zm6.75 10.5L10 19h4l-.75-1.5h-2.5z\" /></svg>';

		if (preference === 'system') {
			const activeLabel = theme === 'dark' ? t('darkMode') : t('lightMode');
			btn.innerHTML = `${systemIcon}<span>${t('systemMode')} (${activeLabel})</span>`;
			return;
		}

		btn.innerHTML = (theme === 'dark') ? moonIcon : sunIcon;
	}

	function renderLanguageOptions(selectEl) {
		i18n.renderLanguageOptions(selectEl, languagePreference);
	}

	function applyTranslations() {
		document.documentElement.lang = i18n.locale;
		applyAttributeTranslations();
		applyTextTranslations();
		applyEditorToolbarTranslations();
		const mainVisibilitySelect = document.getElementById('note-visibility-select');
		renderVisibilityOptions(mainVisibilitySelect);
		if (mainVisibilitySelect) mainVisibilitySelect.title = translateMessage('Visibility');
		const backToTopBtn = document.getElementById('back-to-top-btn');
		if (backToTopBtn) backToTopBtn.title = translateMessage('Back to top');
		[
			{ el: document.getElementById('new-username'), key: 'Username' },
			{ el: document.getElementById('new-password'), key: 'Password' },
			{ el: document.getElementById('new-telegram-id'), key: 'Telegram User ID (optional)' }
		].forEach(item => {
			if (item.el) item.el.placeholder = translateMessage(item.key);
		});
		const popoverShareBtn = document.querySelector('#note-popover-menu [data-action="share"]');
		if (popoverShareBtn) popoverShareBtn.title = translateMessage('Share');
		const popoverDeleteBtn = document.querySelector('#note-popover-menu [data-action="delete"]');
		if (popoverDeleteBtn) popoverDeleteBtn.title = translateMessage('Delete Note');
		if (languageSelect) {
			languageSelect.setAttribute('aria-label', t('languageLabel'));
			renderLanguageOptions(languageSelect);
		}
		if (settingsLanguageSelect) {
			renderLanguageOptions(settingsLanguageSelect);
			settingsLanguageSelect.setAttribute('aria-label', t('languageLabel'));
		}
		document.querySelectorAll('.copy-code-btn').forEach(btn => {
			btn.title = t('copyCode');
		});
		renderThemeToggleLabel(document.body.dataset.theme || 'light', themePreference);
	}

	function setLanguagePreference(pref) {
		currentLanguage = i18n.setLanguagePreference(pref);
		languagePreference = i18n.languagePreference;
		if (languageSelect && languageSelect.value !== pref) {
			languageSelect.value = pref;
		}
		if (settingsLanguageSelect && settingsLanguageSelect.value !== pref) {
			settingsLanguageSelect.value = pref;
		}
		applyTranslations();
		if (typeof reRenderCachedNotes === 'function' && allNotesCache.length) {
			reRenderCachedNotes();
		}
		if (timelineDataCache) {
			loadAndRenderTimeline(timelineDataCache);
		} else {
			loadAndRenderTimeline();
		}
	}

	if (languageSelect) {
		languageSelect.value = languagePreference;
		languageSelect.addEventListener('change', e => setLanguagePreference(e.target.value));
	}
	if (settingsLanguageSelect) {
		settingsLanguageSelect.value = languagePreference;
		settingsLanguageSelect.addEventListener('change', e => setLanguagePreference(e.target.value));
	}
	applyTranslations();

	document.documentElement.lang = i18n.locale;
	window.addEventListener('DOMContentLoaded', applyTranslations);
	// --- 配置 marked.js ---
	const escapeHtml = (str = '') => str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

	const renderer = new marked.Renderer();
	const originalTableRenderer = renderer.table.bind(renderer);
	const originalLinkRenderer = renderer.link.bind(renderer);
	renderer.table = (header, body) => {
		const tableHtml = originalTableRenderer(header, body);
		return `<div class='table-wrapper'>${tableHtml}</div>`;
	};
	renderer.code = function (token) {
		const code = token.text;
		const lang = token.lang;
		let result;
		if (lang && hljs.getLanguage(lang)) {
			result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
		} else {
			result = hljs.highlightAuto(code);
		}
		const languageName = result.language || 'plaintext';
		const highlightedCode = result.value;
		const copyButtonHtml = `
								<button class='copy-code-btn' data-code='${escapeHtml(code)}' title='${t('copyCode')}'>
										<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path></svg>
								</button>
						`;

		const finalHtml = `
							<div class='code-block-wrapper'>
									${copyButtonHtml}
									<pre><code class='hljs language-${languageName}'>${highlightedCode}</code></pre>
							</div>
					`;
		return finalHtml;
	};
	renderer.link = function (token) {
		const { href, title, text } = token;
		if (href && href.trim().toLowerCase().startsWith('javascript:')) {
			return escapeHtml(text || '');
		}
		let linkHtml = originalLinkRenderer.call(this, token);

		if (linkHtml.startsWith('<a ')) {
			linkHtml = linkHtml.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
		}
		return linkHtml;
	};
	const originalImageRenderer = renderer.image.bind(renderer);
	renderer.image = function (href, title, text) {
		if (href && href.trim().toLowerCase().startsWith('javascript:')) {
			return '';
		}
		let imageHtml = originalImageRenderer(href, title, text);
		imageHtml = imageHtml.replace(
			'<img ',
			'<img class="note-image-attachment" style="cursor: zoom-in;" '
		);

		return imageHtml;
	};
	renderer.html = function (html) {
		return escapeHtml(html);
	};
	marked.setOptions({
		renderer: renderer,
		breaks: true, // 将换行符渲染为 <br>
		gfm: true,    // 启用 GitHub Flavored Markdown
		tables: true
	});

	const calendarWrapper = document.getElementById('calendar-wrapper');
	const calendarTooltip = document.getElementById('calendar-tooltip'); // 【新增】
	let notesDataByDate = new Map();
	let calendarInstance = null;

	class Calendar {
		constructor(container, dataProvider) {
			this.container = container;
			this.dataProvider = dataProvider;
			this.currentDate = new Date();
			this.today = new Date();
			this.today.setHours(0, 0, 0, 0);
			this.selectedDate = null;
			this.render();
		}

		render() {
			this.container.innerHTML = '';
			const month = this.currentDate.getMonth();
			const year = this.currentDate.getFullYear();
			const header = document.createElement('div');
			header.className = 'calendar-header';
			const locale = getLocale();
			const monthYearLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(this.currentDate);
			header.innerHTML = `
                <button id='calendar-prev' class='calendar-nav-btn' title='${t('prevMonth')}'>◄</button>
                <span id='calendar-month-year'>${monthYearLabel}</span>
                <button id='calendar-next' class='calendar-nav-btn' title='${t('nextMonth')}'>►</button>
            `;
			this.container.appendChild(header);
			const nextMonthBtn = document.getElementById('calendar-next');
			const firstDayOfNextMonth = new Date(year, month + 1, 1);
			if (firstDayOfNextMonth > this.today) {
				nextMonthBtn.disabled = true;
			}

			const grid = document.createElement('div');
			grid.className = 'calendar-grid';
			const dayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
			const baseDate = new Date(2024, 0, 7); // Sunday
			const dayNames = Array.from({ length: 7 }, (_, i) => {
				const date = new Date(baseDate);
				date.setDate(baseDate.getDate() + i);
				return dayFormatter.format(date);
			});
			dayNames.forEach(name => {
				const dayNameEl = document.createElement('div');
				dayNameEl.className = 'calendar-day-name';
				dayNameEl.textContent = name;
				grid.appendChild(dayNameEl);
			});

			const firstDayOfMonth = new Date(year, month, 1);
			const lastDayOfMonth = new Date(year, month + 1, 0);
			const firstDayOfWeek = firstDayOfMonth.getDay();
			for (let i = 0; i < firstDayOfWeek; i++) {
				grid.appendChild(document.createElement('div'));
			}
			for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
				const dateWrapper = document.createElement('div');
				dateWrapper.className = 'calendar-date-wrapper';
				const dateButton = document.createElement('button');
				dateButton.className = 'calendar-date';
				dateButton.textContent = day;
				const thisDate = new Date(year, month, day);
				const dateString = this.formatDateString(thisDate);
				dateButton.dataset.date = dateString;

				const count = this.dataProvider.get(dateString) || 0;
				if (count > 0) {
					let level = 0;
					if (count >= 1 && count <= 2) level = 1;
					else if (count >= 3 && count <= 5) level = 2;
					else if (count > 5) level = 3;
					if (level > 0) dateButton.dataset.level = level;

					const dotsContainer = document.createElement('div');
					dotsContainer.className = 'calendar-dots-container';
					const dotCount = Math.min(level, 3);
					for (let i = 0; i < dotCount; i++) {
						const dot = document.createElement('div');
						dot.className = 'calendar-dot';
						dotsContainer.appendChild(dot);
					}
					dateWrapper.appendChild(dotsContainer);
				}

				if (this.selectedDate && this.formatDateString(this.selectedDate) === dateString) {
					dateButton.classList.add('is-selected');
				}
				dateWrapper.insertBefore(dateButton, dateWrapper.firstChild);
				grid.appendChild(dateWrapper);
			}
			this.container.appendChild(grid);
			this.addEventListeners();
		}

		addEventListeners() {
			document.getElementById('calendar-prev').addEventListener('click', () => this.changeMonth(-1));
			const nextBtn = document.getElementById('calendar-next');
			if (nextBtn && !nextBtn.disabled) {
				nextBtn.addEventListener('click', () => this.changeMonth(1));
			}

			this.container.querySelectorAll('.calendar-date').forEach(button => {
				button.addEventListener('click', (e) => this.selectDate(e.target));
				button.addEventListener('mouseover', (e) => {
					const target = e.currentTarget;
					const dateStr = target.dataset.date;
					const count = this.dataProvider.get(dateStr) || 0;
					if (count > 0) {
						const countText = formatNoteCountLabel(count);
						calendarTooltip.textContent = `${countText} · ${dateStr}`;
						calendarTooltip.style.display = 'block';
					}
				});

				button.addEventListener('mousemove', (e) => {
					if (calendarTooltip.style.display === 'block') {
						calendarTooltip.style.left = `${e.pageX}px`;
						calendarTooltip.style.top = `${e.pageY}px`;
					}
				});

				button.addEventListener('mouseout', () => {
					calendarTooltip.style.display = 'none';
				});
			});
		}

		changeMonth(direction) {
			this.currentDate.setMonth(this.currentDate.getMonth() + direction);
			this.render();
		}

		selectDate(dateElement) {
			const dateString = dateElement.dataset.date;
			if (this.selectedDate && this.formatDateString(this.selectedDate) === dateString) {
				this.selectedDate = null;
				appState.filters.date = null;
				clearFilterBtn.classList.remove('visible');
			} else {
				const [year, month, day] = dateString.split('-').map(Number);
				this.selectedDate = new Date(year, month - 1, day);
				const startOfDay = new Date(year, month - 1, day);
				const endOfDay = new Date(year, month - 1, day + 1);
				appState.filters.date = {
					startTimestamp: startOfDay.getTime(),
					endTimestamp: endOfDay.getTime()
				};
				clearFilterBtn.classList.add('visible');
			}
			this.render();
			reloadNotes();
		}

		formatDateString(date) {
			const year = date.getFullYear();
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			return `${year}-${month}-${day}`;
		}
	}

	async function handleStandaloneImageUpload(request, env) {
		try {
			const formData = await request.formData();
			const file = formData.get('file');

			if (!file || !file.name || file.size === 0) {
				return jsonResponse({ error: 'A file is required for upload.' }, 400);
			}

			const imageId = crypto.randomUUID();
			const r2Key = `uploads/${imageId}`;
			await env.NOTES_R2_BUCKET.put(r2Key, file.stream(), {
				httpMetadata: { contentType: file.type }
			});
			const imageUrl = `/api/images/${imageId}`;
			return jsonResponse({ success: true, url: imageUrl });
		} catch (e) {
			console.error('Standalone Image Upload Error:', e.message);
			return jsonResponse({ error: 'Upload failed', message: e.message }, 500);
		}
	}

	async function handleServeStandaloneImage(imageId, env) {
		const r2Key = `uploads/${imageId}`;
		const object = await env.NOTES_R2_BUCKET.get(r2Key);
		if (object === null) {
			return new Response('File not found', { status: 404 });
		}
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		return new Response(object.body, { headers });
	}

	async function uploadToLocalWorker(file) {
		const formData = new FormData();
		formData.append('file', file);
		const response = await fetch('/api/upload/image', {
			method: 'POST',
			body: formData
		});
		if (!response.ok) {
			throw new Error(`Local upload failed: ${await response.text()}`);
		}
		const result = await response.json();
		return result.url;
	}

	async function uploadToImgur(file) {
		const clientId = settings.imgurClientId;
		if (!clientId) {
			throw new Error('Imgur Client ID is not set in settings.');
		}
		const formData = new FormData();
		formData.append('file', file);
		formData.append('clientId', clientId);
		const response = await fetch('/api/proxy/upload/imgur', {
			method: 'POST',
			body: formData
		});
		if (!response.ok) {
			const errorResult = await response.json();
			throw new Error(`Imgur proxy failed: ${errorResult.message || 'Unknown error'}`);
		}
		const result = await response.json();
		return result.url;
	}

	function postProcessMarkdownHtml(html) {
		if (!html || html.indexOf('#') === -1) {
			return html;
		}
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = html;
		const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
		let currentNode;
		const nodesToProcess = [];

		while (currentNode = walker.nextNode()) {
			if (currentNode.parentElement.tagName !== 'A' && currentNode.nodeValue.includes('#')) {
				nodesToProcess.push(currentNode);
			}
		}
		const tagRegex = /(#[\p{L}\p{N}_-]+)/gu;
		nodesToProcess.forEach(node => {
			const parent = node.parentElement;
			const text = node.nodeValue;
			if (!tagRegex.test(text)) return;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			text.replace(tagRegex, (match, tagName, offset) => {
				if (offset > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
				}
				const link = document.createElement('a');
				link.href = '#';
				link.className = 'inline-tag';
				link.dataset.tagName = tagName.substring(1).toLowerCase();
				link.textContent = tagName;
				fragment.appendChild(link);
				lastIndex = offset + match.length;
			});
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}
			parent.replaceChild(fragment, node);
		});
		return tempDiv.innerHTML;
	}

	async function handlePastedImage(imageFile, textarea) {
		const placeholderId = `uploading-${Date.now()}`;
		const placeholderMarkdown = `![Uploading image... ${placeholderId}]()`;
		insertTextAtCursor(textarea, placeholderMarkdown);
		try {
			const destination = settings.imageUploadDestination || 'local';
			let finalUrl;
			switch (destination) {
				case 'imgur':
					finalUrl = await uploadToImgur(imageFile);
					break;
				case 'local':
				default:
					finalUrl = await uploadToLocalWorker(imageFile);
					break;
			}
			const finalMarkdown = `![${imageFile.name || 'pasted-image.png'}](${finalUrl})`;
			textarea.value = textarea.value.replace(placeholderMarkdown, finalMarkdown);
		} catch (error) {
			console.error('Image upload failed:', error);
			const errorMarkdown = `![Upload Failed: ${error.message}]()`;
			textarea.value = textarea.value.replace(placeholderMarkdown, errorMarkdown);
			showCustomAlert(`Image upload failed: ${error.message}`, 'error');
		} finally {
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	// --- 使用事件委托为所有复制按钮添加点击事件 ---
	document.body.addEventListener('click', async (event) => {
		const copyButton = event.target.closest('.copy-code-btn');
		if (copyButton) {
			const codeToCopy = copyButton.dataset.code;
			const originalIcon = copyButton.innerHTML;
			const successIcon = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'></polyline></svg>`;

			try {
				await navigator.clipboard.writeText(codeToCopy);
				copyButton.innerHTML = successIcon;
				copyButton.classList.add('copied');
				copyButton.title = t('copied');
				setTimeout(() => {
					copyButton.innerHTML = originalIcon;
					copyButton.classList.remove('copied');
					copyButton.title = t('copyCode');
				}, 2000);
			} catch (err) {
				console.error('Failed to copy text: ', err);
				copyButton.title = t('copyFailed');
			}
		}
	});
	// --- 全局设置管理 ---
	const defaultSettings = DEFAULT_UI_SETTINGS;
	let settings = { ...DEFAULT_UI_SETTINGS };
	let settingsLoaded = false;

	async function loadSettings() {
		settingsLoaded = false;
		try {
			const response = await fetch('/api/settings');
			if (!response.ok) {
				throw new Error(`Failed to fetch settings from server (status ${response.status})`);
			}
			const incoming = await response.json();
			settings = { ...defaultSettings, ...incoming };
			settingsLoaded = true;
			return true;
		} catch (error) {
			console.error("Could not load settings:", error);
			// showCustomAlert(`Error loading settings: ${error.message}. Using local defaults.`, 'error');
			return false;
		}
	}

	async function saveSettings() {
		if (!settingsLoaded) {
			showCustomAlert('Settings are not loaded yet. Please try again after login.', 'error');
			return;
		}
		try {
			const response = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings)
			});
			if (!response.ok) throw new Error('Failed to save settings to server');
		} catch (error) {
			console.error("Could not save settings:", error);
			showCustomAlert(`Error saving settings: ${error.message}`, 'error');
		}
	}
	// --- 全局应用状态 ---
	const appState = {
		baseMode: 'home',
		isWaterfall: false,
		isWide: false,
		filters: {
			query: '',
			tag: null,
			date: null
		},
		pagination: {
			currentPage: 1,
			isLoading: false,
			hasMore: true
		}
	};

	// --- DOM Elements ---
	const authContainer = document.getElementById('auth-container');
	const appContainer = document.getElementById('app-container');
	const loginForm = document.getElementById('login-form');
	const logoutBtn = document.getElementById('logout-btn');
	const noteForm = document.getElementById('note-form');
	const noteInput = document.getElementById('note-input');
	const noteFile = document.getElementById('note-file');
	const noteVisibilitySelect = document.getElementById('note-visibility-select');
	const fileListDisplay = document.getElementById('file-list-display');
	const notesContainer = document.getElementById('notes-container');
	const refreshLoader = document.getElementById('refresh-loader');
	const scrollLoader = document.getElementById('scroll-loader');
	const refreshBtn = document.getElementById('refresh-btn');
	const themeToggleBtn = document.getElementById('theme-toggle-btn');
	const customModalOverlay = document.getElementById('custom-modal-overlay');
	// Alert elements
	const customAlertBox = document.getElementById('custom-alert-box');
	const customAlertMessage = document.getElementById('custom-alert-message');
	const customAlertOkBtn = document.getElementById('custom-alert-ok-btn');
	// Confirm elements
	const customConfirmBox = document.getElementById('custom-confirm-box');
	const customConfirmMessage = document.getElementById('custom-confirm-message');
	const customConfirmOkBtn = document.getElementById('custom-confirm-ok-btn');
	const customConfirmCancelBtn = document.getElementById('custom-confirm-cancel-btn');
	const selectFilesBtn = document.getElementById('select-files-btn');
	const mainPreviewToggleBtn = document.getElementById('main-preview-toggle-btn');
	const mainSplitToggleBtn = document.getElementById('main-split-toggle-btn');

	const mainEditPreview = document.getElementById('main-edit-preview');
	const container = document.querySelector('.container');
	const appLayoutContainer = document.getElementById('app-layout-container');
	const fullscreenEditorOverlay = document.getElementById('fullscreen-editor-overlay');
	const fullscreenEditorBox = document.getElementById('fullscreen-editor-box');
	const fsEditorTextarea = document.getElementById('fs-editor-textarea');
	const fsPreviewPane = document.getElementById('fs-preview-pane');
	const fsVisibilitySelect = document.getElementById('fs-visibility-select');
	const userManagementSection = document.getElementById('user-management-section');
	const createUserForm = document.getElementById('create-user-form');
	const userTableBody = document.getElementById('user-table-body');
	const newUsernameInput = document.getElementById('new-username');
	const newPasswordInput = document.getElementById('new-password');
	const newTelegramInput = document.getElementById('new-telegram-id');
	const newIsAdminCheckbox = document.getElementById('new-is-admin');
	const editorContentArea = document.getElementById('editor-content-area');
	const editorToolbar = document.getElementById('editor-toolbar');
	const viewModeSplitBtn = document.getElementById('view-mode-split-btn');
	const viewModePreviewBtn = document.getElementById('view-mode-preview-btn');
	const fsSaveBtn = document.getElementById('fs-save-btn');
	const fsCancelBtn = document.getElementById('fs-cancel-btn');
	const enterFullscreenBtn = document.getElementById('enter-fullscreen-btn');
	const backToTopBtn = document.getElementById('back-to-top-btn');
	const fsEditorDivider = document.getElementById('fs-editor-divider');
	const insertTagBtn = document.getElementById('insert-tag-btn');
	const tagDropdown = document.getElementById('tag-dropdown');
	const tagSearchInput = document.getElementById('tag-search-input');
	const tagDropdownList = document.getElementById('tag-dropdown-list');
	const globalSearchInput = document.getElementById('global-search-input');
	const clearSearchBtn = document.getElementById('clear-search-btn');
	const themeColorBtn = document.getElementById('theme-color-btn');
	const themeColorPopover = document.getElementById('theme-color-popover');
	const colorPalette = themeColorPopover.querySelector('.color-palette');
	const colorPickerLabel = document.getElementById('color-picker-label');
	const colorPickerPreview = document.getElementById('color-picker-preview');
	const colorPickerInput = document.getElementById('color-picker-input');
	const hexColorInput = document.getElementById('hex-color-input');
	const statsDays = document.getElementById('stats-days');
	const statsMemos = document.getElementById('stats-memos');
	const statsTags = document.getElementById('stats-tags');
	const insertImageBtn = document.getElementById('insert-image-btn');
	const insertCodeBtn = document.getElementById('insert-code-btn');
	const rightSidebar = document.getElementById('right-sidebar');
	const homeTabBtn = document.getElementById('home-tab-btn');
	const favoritesTabBtn = document.getElementById('favorites-tab-btn');
	const archiveTabBtn = document.getElementById('archive-tab-btn');
	const waterfallTabBtn = document.getElementById('waterfall-tab-btn');
	// const waterfallPopoverMenu = document.getElementById('waterfall-popover-menu');
	const toggleDateGrouping = document.getElementById('toggle-date-grouping');

	const toggleRightSidebar = document.getElementById('toggle-right-sidebar');
	const toggleCalendar = document.getElementById('toggle-calendar');
	const toggleEditorInWaterfall = document.getElementById('toggle-editor-in-waterfall');

	// 设置弹框相关元素
	const settingsModalOverlay = document.getElementById('settings-modal-overlay');
	const closeSettingsBtn = document.getElementById('close-settings-btn');
	// 可见性开关
	const toggleSearchBar = document.getElementById('toggle-search-bar');
	const toggleStatsCard = document.getElementById('toggle-stats-card');
	const toggleTags = document.getElementById('toggle-tags');
	const toggleTimeline = document.getElementById('toggle-timeline');
	// 背景设置
	const bgImageUrl = document.getElementById('bg-image-url');
	const bgImageUpload = document.getElementById('bg-image-upload');
	const bgBlurSlider = document.getElementById('bg-blur-slider');
	const clearBgBtn = document.getElementById('clear-bg-btn');
	const restoreBgBtn = document.getElementById('restore-bg-btn');
	const toggleHeatmap = document.getElementById('toggle-heatmap');
	const bgOpacitySlider = document.getElementById('bg-opacity-slider');
	const surfaceColorPickerInput = document.getElementById('surface-color-picker-input');
	const surfaceHexColorInput = document.getElementById('surface-hex-color-input');
	const surfaceOpacitySlider = document.getElementById('surface-opacity-slider');
	const restoreSurfaceBtn = document.getElementById('restore-surface-defaults-btn');
	// 瀑布流设置
	const waterfallWidthSlider = document.getElementById('waterfall-width-slider');
	const waterfallWidthValue = document.getElementById('waterfall-width-value');
	const toggleTelegramProxy = document.getElementById('toggle-telegram-proxy');

	// 需要被控制显隐的左侧栏卡片
	const searchStatsContainer = document.querySelector('.sidebar-search-container');
	const statsCard = document.getElementById('stats-card');
	const tagsSectionWrapper = document.getElementById('tags-section-wrapper');
	const timelineSectionWrapper = document.getElementById('timeline-section-wrapper');

	// --- 富文本编辑相关元素 ---
	const fsFontsizeSelector = document.getElementById('fs-fontsize-selector');
	const fsFontcolorBtn = document.getElementById('fs-fontcolor-btn');
	const fsColorPickerWrapper = document.getElementById('fs-color-picker-wrapper');
	const fsColorPopover = document.getElementById('fs-color-popover');
	const fsColorPalette = fsColorPopover.querySelector('.color-palette.fscolor-palette');

	const waterfallToggleBtn = document.getElementById('waterfall-toggle-btn');
	const wideModeToggleBtn = document.getElementById('wide-mode-toggle-btn');
	const notesSection = document.getElementById('notes-section');

	const heatmapContainerWrapper = document.getElementById('heatmap-container-wrapper');
	const heatmapTooltip = document.getElementById('heatmap-tooltip');
	const imgurClientIdWrapper = document.getElementById('imgur-client-id-wrapper');
	const imgurClientIdInput = document.getElementById('imgur-client-id');
	const uploadDestinationRadios = document.querySelectorAll('input[name="upload-destination"]');
	const attachmentsTabBtn = document.getElementById('attachments-tab-btn');
	const attachmentsViewer = document.getElementById('attachments-viewer');
	const attachmentsContent = document.getElementById('attachments-content');
	const attachmentsTabs = document.querySelector('.attachments-tabs');

	const moreActionsContainer = document.getElementById('more-actions-container');
	const moreActionsBtn = document.getElementById('more-actions-btn');
	const moreMenuPopover = document.getElementById('more-menu-popover');
	const notePopoverMenu = document.getElementById('note-popover-menu');
	let popoverHoverTimer = null;
	let waterfallPopoverHideTimer = null;
	let activePopoverNoteId = null;

	const shareModal = document.getElementById('share-link-modal-overlay');
	const closeShareModalBtn = document.getElementById('share-link-close-btn');
	const copyDisplayLinkBtn = document.getElementById('copy-display-link-btn');
	const copyRawLinkBtn = document.getElementById('copy-raw-link-btn');

	const expirationSelect = document.getElementById('expiration-select');
	const expirationStatus = document.getElementById('expiration-status');
	let currentPublicId = null;

	expirationSelect.addEventListener('change', async () => {
		const shareModal = document.getElementById('share-link-modal-overlay');
		const noteId = shareModal.dataset.noteId;
		const selectedValue = expirationSelect.value;

		if (selectedValue === 'revoke') {
			const confirmed = await showCustomConfirm('Are you sure you want to revoke the public links immediately? This action cannot be undone.');
			if (confirmed) {
				expirationStatus.textContent = t('revoking');
				expirationSelect.disabled = true;
				try {
					const response = await fetch(`/api/notes/${noteId}/share`, { method: 'DELETE' });
					if (!response.ok) {
						const err = await response.json();
						throw new Error(extractErrorMessage(err, 'Failed to revoke share link.'));
					}
					closeShareModal();
					showCustomAlert('Sharing has been successfully revoked.', 'info');
				} catch (error) {
					showCustomAlert(`Error: ${error.message}`, 'error');
					expirationStatus.textContent = t('errored');
				} finally {
					expirationSelect.disabled = false;
				}
			} else {
				expirationSelect.value = "3600";
			}
			return;
		}
		const newExpirationTtl = parseInt(expirationSelect.value, 10);

		if (!noteId || !currentPublicId) return;

		expirationStatus.textContent = t('updating');
		expirationSelect.disabled = true;

		try {
			const response = await fetch(`/api/notes/${noteId}/share`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					publicId: currentPublicId,
					expirationTtl: newExpirationTtl
				})
			});

			if (!response.ok) {
				const err = await response.json();
				throw new Error(extractErrorMessage(err, 'Failed to update expiration.'));
			}

			expirationStatus.textContent = t('updated');
			setTimeout(() => {
				expirationStatus.textContent = '';
			}, 2000);

		} catch (error) {
			expirationStatus.textContent = t('errored');
			showCustomAlert(`Error: ${error.message}`, 'error');
		} finally {
			expirationSelect.disabled = false;
		}
	});

	function closeShareModal() {
		const shareModal = document.getElementById('share-link-modal-overlay');
		shareModal.classList.remove('visible');
		shareModal.querySelector('.custom-modal-box').classList.remove('active');
		delete shareModal.dataset.noteId;
		currentPublicId = null;
	}

	closeShareModalBtn.addEventListener('click', closeShareModal);
	shareModal.addEventListener('click', (e) => {
		if (e.target === shareModal) {
			closeShareModal();
		}
	});

	async function copyLink(inputElement, buttonElement) {
		try {
			await navigator.clipboard.writeText(inputElement.value);
			const originalText = buttonElement.textContent;
			buttonElement.textContent = t('copied');
			setTimeout(() => {
				buttonElement.textContent = originalText;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy text: ', err);
			showCustomAlert('Failed to copy link.', 'error');
		}
	}

	copyDisplayLinkBtn.addEventListener('click', () => copyLink(document.getElementById('share-display-link-input'), copyDisplayLinkBtn));
	copyRawLinkBtn.addEventListener('click', () => copyLink(document.getElementById('share-raw-link-input'), copyRawLinkBtn));
	// --- 显示笔记操作菜单 ---
	function showNotePopover(targetButton, noteId) {
		clearTimeout(popoverHoverTimer);
		if (notePopoverMenu.classList.contains('visible') && activePopoverNoteId === noteId) {
			return;
		}
		activePopoverNoteId = noteId;
		notePopoverMenu.dataset.noteId = noteId;

		const noteData = allNotesCache.find(n => n.id === parseInt(noteId, 10));
		const favoriteBtn = notePopoverMenu.querySelector('[data-action="favorite"]');
		const pinBtn = notePopoverMenu.querySelector('[data-action="pin"]');
		const archiveBtn = notePopoverMenu.querySelector('[data-action="archive"], [data-action="unarchive"]');
		const shareBtn = notePopoverMenu.querySelector('[data-action="share"]');

		shareBtn.style.display = settings.enableSharing ? '' : 'none';
		if (appState.baseMode === 'archive') {
			// 在归档视图下，只可能显示 "Unarchive"
			archiveBtn.style.display = settings.showArchive ? '' : 'none'; // 同样要尊重设置
			archiveBtn.classList.add('unarchive-mode');
			archiveBtn.title = translateMessage('Unarchive');
			archiveBtn.dataset.action = 'unarchive';

			// 强制隐藏其他不相关的按钮
			favoriteBtn.style.display = 'none';
			pinBtn.style.display = 'none';
		} else {
			// 在常规视图下（Home, Favorites）
			archiveBtn.style.display = settings.showArchive ? '' : 'none';
			archiveBtn.classList.remove('unarchive-mode');
			archiveBtn.title = translateMessage('Archive');
			archiveBtn.dataset.action = 'archive';

			// 只有在设置开启时，才显示收藏和置顶按钮
			favoriteBtn.style.display = settings.showFavorites ? '' : 'none';
			pinBtn.style.display = settings.enablePinning ? '' : 'none';

			// 如果按钮是可见的，再更新它们的激活状态 (是否已收藏/已置顶)
			if (noteData) {
				if (settings.showFavorites) {
					favoriteBtn.classList.toggle('favorited', noteData.is_favorited);
					favoriteBtn.title = translateMessage(noteData.is_favorited ? 'Unfavorite' : 'Favorite');
				}
				if (settings.enablePinning) {
					pinBtn.classList.toggle('pinned', noteData.is_pinned);
					pinBtn.title = translateMessage(noteData.is_pinned ? 'Unpin' : 'Pin');
				}
			}
		}

		const btnRect = targetButton.getBoundingClientRect();
		notePopoverMenu.style.top = `${btnRect.bottom + 5}px`;
		notePopoverMenu.style.left = `${btnRect.right - notePopoverMenu.offsetWidth}px`;
		notePopoverMenu.classList.add('visible');
	}

	// --- 隐藏笔记操作菜单 ---
	function hideNotePopover() {
		popoverHoverTimer = setTimeout(() => {
			notePopoverMenu.classList.remove('visible');
			activePopoverNoteId = null;
		}, 200); // 延迟200毫秒隐藏，防止鼠标意外移出
	}

	// --- 为菜单本身添加悬停逻辑，防止鼠标移入菜单时它消失 ---
	notePopoverMenu.addEventListener('mouseenter', () => {
		clearTimeout(popoverHoverTimer);
	});

	notePopoverMenu.addEventListener('mouseleave', () => {
		hideNotePopover();
	});

	// --- 处理菜单项的点击事件 ---
	notePopoverMenu.addEventListener('click', async (e) => {
		const actionButton = e.target.closest('.icon-btn');
		if (!actionButton) return;

		const action = actionButton.dataset.action;
		const noteId = notePopoverMenu.dataset.noteId;
		if (!noteId) return;
		notePopoverMenu.classList.remove('visible');
		activePopoverNoteId = null;
		const noteElement = notesContainer.querySelector(`.note[data-id="${noteId}"]`);

		switch (action) {
			case 'favorite': {
				const isCurrentlyFavorited = actionButton.classList.contains('favorited');
				const newFavoriteState = !isCurrentlyFavorited;
				actionButton.disabled = true;
				const formData = new FormData();
				formData.append('isFavorited', newFavoriteState.toString());
				try {
					const res = await fetch(`/api/notes/${noteId}`, { method: 'PUT', body: formData });
					if (!res.ok) throw new Error('Failed to update favorite status.');
					actionButton.classList.toggle('favorited', newFavoriteState);
					actionButton.title = translateMessage(newFavoriteState ? 'Unfavorite' : 'Favorite');
					const noteInCache = allNotesCache.find(n => n.id === parseInt(noteId));
					if (noteInCache) noteInCache.is_favorited = newFavoriteState;
				} catch (error) {
					showCustomAlert(error.message, 'error');
				} finally {
					actionButton.disabled = false;
				}
				break;
			}
			case 'pin': {
				const isCurrentlyPinned = actionButton.classList.contains('pinned');
				const newPinState = !isCurrentlyPinned;
				actionButton.disabled = true;
				const formData = new FormData();
				formData.append('isPinned', newPinState.toString());
				try {
					const res = await fetch(`/api/notes/${noteId}`, { method: 'PUT', body: formData });
					if (!res.ok) throw new Error('Failed to update pin status.');
					actionButton.classList.toggle('pinned', newPinState);
					actionButton.title = translateMessage(newPinState ? 'Unpin' : 'Pin');
					const noteInCache = allNotesCache.find(n => n.id === parseInt(noteId));
					if (noteInCache) noteInCache.is_pinned = newPinState;
					await refreshNotes();
				} catch (error) {
					showCustomAlert(error.message, 'error');
				} finally {
					actionButton.disabled = false;
				}
				break;
			}
			case 'archive':
			case 'unarchive': {
				const isArchiving = action === 'archive';
				actionButton.disabled = true;
				const formData = new FormData();
				formData.append('is_archived', isArchiving.toString());

				try {
					const res = await fetch(`/api/notes/${noteId}`, { method: 'PUT', body: formData });
					const archiveError = isArchiving ? 'Failed to archive note.' : 'Failed to unarchive note.';
					if (!res.ok) throw new Error(archiveError);

					// 操作成功后，直接从当前视图移除卡片
					if (noteElement) {
						noteElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
						noteElement.style.opacity = '0';
						noteElement.style.transform = 'scale(0.95)';
						setTimeout(() => noteElement.remove(), 300);
					}

					// 更新缓存
					const noteInCache = allNotesCache.find(n => n.id === parseInt(noteId));
					if (noteInCache) noteInCache.is_archived = isArchiving;

				} catch (error) {
					showCustomAlert(error.message, 'error');
				} finally {
					actionButton.disabled = false;
				}
				break;
			}
			case 'share': {
				const shareModal = document.getElementById('share-link-modal-overlay');
				const loader = document.getElementById('share-link-loader');
				const details = document.getElementById('share-link-details');

				shareModal.dataset.noteId = noteId;

				shareModal.classList.add('visible');
				shareModal.querySelector('.custom-modal-box').classList.add('active');
				loader.style.display = 'block';
				details.style.display = 'none';

				// 将下拉框重置为默认值
				expirationSelect.value = "3600";
				expirationStatus.textContent = '';

				try {
					// 初始创建，使用默认过期时间
					const response = await fetch(`/api/notes/${noteId}/share`, { method: 'POST' });
					if (!response.ok) {
						const err = await response.json();
						throw new Error(extractErrorMessage(err, 'Failed to generate share link.'));
					}
					const data = await response.json();

					currentPublicId = data.publicId; // 存储 publicId

					document.getElementById('share-display-link-input').value = data.displayUrl;
					document.getElementById('share-raw-link-input').value = data.rawUrl;
					loader.style.display = 'none';
					details.style.display = 'block';

				} catch (error) {
					showCustomAlert(`Error: ${error.message}`, 'error');
					closeShareModal();
				}
				break;
			}
			case 'delete': {
				if (!noteElement) return;
				const confirmed = await showCustomConfirm('Are you sure you want to delete this note?');
				if (!confirmed) return;
				waterfallObserver.unobserve(noteElement);
				try {
					await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
					noteElement.remove();
					loadAndRenderTags();
					loadAndRenderTimeline();
					loadAndRenderStats();
				} catch (error) {
					showCustomAlert(error.message, 'error');
				}
				break;
			}
		}
	});

	let isMenuPinned = false;
	let hideMenuTimeout;
	function showColorPopover() {
		const moreMenuRect = moreMenuPopover.getBoundingClientRect();
		themeColorPopover.style.top = `${moreMenuRect.bottom + 8}px`;
		themeColorPopover.style.right = `${window.innerWidth - moreMenuRect.right}px`;
		themeColorPopover.style.left = 'auto';
		themeColorPopover.classList.add('visible');
	}

	function hideColorPopover() {
		themeColorPopover.classList.remove('visible');
	}

	// 点击“更多”按钮
	moreActionsBtn.addEventListener('click', () => {
		isMenuPinned = !isMenuPinned;
		moreMenuPopover.classList.toggle('visible', isMenuPinned);
		if (!isMenuPinned) {
			hideColorPopover();
		}
	});

	// 悬停显示
	moreActionsContainer.addEventListener('mouseenter', () => {
		clearTimeout(hideMenuTimeout);
		if (!moreMenuPopover.classList.contains('visible')) {
			moreMenuPopover.classList.add('visible');
		}
	});

	// 离开隐藏
	moreActionsContainer.addEventListener('mouseleave', () => {
		if (!isMenuPinned) {
			hideMenuTimeout = setTimeout(() => {
				// 如果颜色选择器也开着，则不自动隐藏，让用户可以操作
				if (!themeColorPopover.classList.contains('visible')) {
					moreMenuPopover.classList.remove('visible');
				}
			}, 300);
		}
	});

	// 点击菜单内的“主题颜色”按钮
	themeColorBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (themeColorPopover.classList.contains('visible')) {
			hideColorPopover();
		} else {
			showColorPopover();
		}
	});

	// 全局点击事件，用于关闭所有弹窗
	document.addEventListener('click', (e) => {
		if (!moreActionsContainer.contains(e.target)) {
			if (isMenuPinned) {
				isMenuPinned = false;
				moreMenuPopover.classList.remove('visible');
				hideColorPopover();
			}
		}
		if (!themeColorPopover.contains(e.target) && e.target.closest('#theme-color-btn') === null) {
			hideColorPopover();
		}
		if (isTagDropdownOpen && !tagDropdown.contains(e.target) && e.target !== insertTagBtn) {
			closeTagDropdown();
		}
		// if (
		// 	waterfallPopoverMenu.classList.contains('visible') &&
		// 	!waterfallPopoverMenu.contains(e.target) &&
		// 	!e.target.closest('.waterfall-more-btn')
		// ) {
		// 	hideWaterfallPopover();
		// }
	});

	// 窗口大小改变或滚动时，隐藏浮动窗口，避免错位
	window.addEventListener('resize', () => {
		hideColorPopover();
		if (isMenuPinned) {
			isMenuPinned = false;
			moreMenuPopover.classList.remove('visible');
		}
	});
	window.addEventListener('scroll', hideColorPopover, { passive: true });

	const attachmentsState = {
		allData: [],
		currentFilter: 'all',
		isLoaded: false, // 这个现在表示是否已加载过第一页
		isLoading: false,
		currentPage: 1,
		hasMore: true,
	};
	/**
	 * @param {boolean} isInitialLoad - 是否是首次加载或切换筛选器
	 */
	async function fetchAllAttachments(isInitialLoad = false) {
		if (attachmentsState.isLoading || (!attachmentsState.hasMore && !isInitialLoad)) return;

		attachmentsState.isLoading = true;
		const loader = document.createElement('div');
		loader.className = 'loading-indicator';
		loader.textContent = t('loading');
		attachmentsContent.appendChild(loader);

		if (isInitialLoad) {
			attachmentsState.currentPage = 1;
			attachmentsState.hasMore = true;
			attachmentsState.allData = [];
			attachmentsContent.innerHTML = '';
			attachmentsContent.appendChild(loader);
		}

		try {
			const response = await fetch(`/api/attachments?page=${attachmentsState.currentPage}`);
			if (!response.ok) throw new Error('Failed to fetch attachments');
			const data = await response.json();
			// 追加新数据
			attachmentsState.allData.push(...data.attachments);
			attachmentsState.hasMore = data.hasMore;
			attachmentsState.isLoaded = true;
			// 渲染新获取的数据
			renderAttachments(data.attachments, isInitialLoad);
			attachmentsState.currentPage++;
		} catch (error) {
			console.error(error);
			attachmentsContent.innerHTML = `<p>${translateMessage('Failed to load attachments.')}</p>`;
		} finally {
			attachmentsState.isLoading = false;
			const existingLoader = attachmentsContent.querySelector('.loading-indicator');
			if (existingLoader) {
				existingLoader.remove();
			}
		}
	}

	function renderAttachments(attachmentsToRender, isInitialLoad) {
		if (isInitialLoad) {
			attachmentsContent.classList.remove('loading-state');
			attachmentsContent.innerHTML = '';
		}

		const filteredData = attachmentsToRender.filter(item => {
			if (attachmentsState.currentFilter === 'all') return true;
			return item.type === attachmentsState.currentFilter;
		});

		if (isInitialLoad && filteredData.length === 0 && !attachmentsState.hasMore) {
			attachmentsContent.innerHTML = `<p style="text-align: center; color: var(--text-secondary);">${translateMessage('No items to display.')}</p>`;
			return;
		}

		const locale = getLocale();
		const groupedByMonth = attachmentsState.allData.reduce((acc, item) => {
			const date = new Date(item.timestamp);
			const monthKey = date.toLocaleString(locale, { year: 'numeric', month: 'long' });
			if (!acc[monthKey]) acc[monthKey] = [];
			acc[monthKey].push(item);
			return acc;
		}, {});

		for (const monthKey in groupedByMonth) {
			const safeKey = monthKey.replace(/[^A-Za-z0-9_-]+/g, '-');
			let monthGroupEl = document.getElementById(`month-${safeKey}`);
			if (!monthGroupEl) {
				monthGroupEl = document.createElement('div');
				monthGroupEl.className = 'attachment-month-group';
				monthGroupEl.id = `month-${safeKey}`;
				monthGroupEl.innerHTML = `<h4 class="month-header">${monthKey}</h4><div class="attachments-grid"></div>`;
				attachmentsContent.appendChild(monthGroupEl);
			}
		}

		// 只将新获取的数据项添加到对应的网格中
		filteredData.forEach(item => {
			const date = new Date(item.timestamp);
			const monthKey = date.toLocaleString(locale, { year: 'numeric', month: 'long' });
			const safeKey = monthKey.replace(/[^A-Za-z0-9_-]+/g, '-');
			const gridEl = document.getElementById(`month-${safeKey}`).querySelector('.attachments-grid');
			const itemLink = document.createElement('a');
			itemLink.dataset.noteId = item.noteId;
			let shareButtonHTML = '', deleteButtonHTML = '';
			if (item.type === 'file' && item.id) {
				shareButtonHTML = `
                <button class="share-file-btn icon-btn" title="${t('getPublicLink')}" data-note-id="${item.noteId}" data-file-id="${item.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
            `;
				deleteButtonHTML = `
                <button class="delete-file-btn icon-btn" title="${translateMessage('Delete file')}" data-note-id="${item.noteId}" data-file-id="${item.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg>
                </button>
                `;
			}
			if (item.type === 'image') {
				itemLink.href = item.url;
				itemLink.className = 'attachment-item attachment-item-image';
				itemLink.dataset.previewable = true;
				itemLink.innerHTML = `<img src="${item.url}" loading="lazy" class="preview" alt="Image from note ${item.noteId}">`;
				gridEl.appendChild(itemLink);
			} else if (item.type === 'video') {
				const itemContainer = document.createElement('div');
				itemContainer.dataset.noteId = item.noteId;
				itemContainer.className = 'attachment-item attachment-item-image';
				itemContainer.dataset.videoPreviewable = true;
				itemContainer.dataset.url = item.url;
				itemContainer.style.cursor = 'pointer';
				itemContainer.innerHTML = `
        <video src="${item.url}" class="preview" preload="metadata" muted style="object-fit: contain; background: #000; pointer-events: none;"></video>
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; color: rgba(255,255,255,0.7); pointer-events: none;">▶</div>
    `;
				gridEl.appendChild(itemContainer);
			} else { // type === 'file'
				itemLink.href = `/api/files/${item.noteId}/${item.id}`;
				itemLink.className = 'attachment-item attachment-item-file';
				itemLink.download = item.name;
				itemLink.innerHTML = `
                    <div class="file-icon">📄</div>
                    <div class="file-info">
                        <div class="name">${item.name}</div>
                        <div class="size">${formatBytes(item.size)}</div>
                    </div>
                ${shareButtonHTML}
                ${deleteButtonHTML}
                `;
				gridEl.appendChild(itemLink);
			}
		});
	}

	async function showAttachmentsViewer() {
		appState.baseMode = 'attachments';
		updateSidebarTabsUI();
		appContainer.style.display = 'none';
		attachmentsViewer.style.display = 'block';
		appLayoutContainer.classList.add('attachments-mode');
		await fetchAllAttachments(true);
	}

	// --- 附件页面的子选项卡事件监听器 ---
	attachmentsTabs.addEventListener('click', (e) => {
		const tabBtn = e.target.closest('.tab-btn');
		if (!tabBtn || tabBtn.classList.contains('active')) return;

		attachmentsTabs.querySelector('.active').classList.remove('active');
		tabBtn.classList.add('active');

		attachmentsState.currentFilter = tabBtn.dataset.filter;
		fetchAllAttachments(true);
	});

	// --- 为附件内容区添加无限滚动和图片预览的事件委托 ---
	attachmentsContent.addEventListener('scroll', () => {
		// 无限滚动逻辑
		if (attachmentsContent.scrollTop + attachmentsContent.clientHeight >= attachmentsContent.scrollHeight - 100) {
			fetchAllAttachments();
		}
	});

	attachmentsContent.addEventListener('click', async e => {
		const imageLink = e.target.closest('a[data-previewable="true"]');
		const videoContainer = e.target.closest('div[data-video-previewable="true"]');
		if (imageLink) {
			e.preventDefault();
			const imgElement = imageLink.querySelector('img');
			openImagePreview(imgElement.src, imgElement.alt);
		} else if (videoContainer) {
			const videoUrl = videoContainer.dataset.url;
			const noteId = videoContainer.dataset.noteId;
			openVideoPreview(videoUrl, `${t('videoFromNote')} ${noteId}`);
		}

		const shareBtn = e.target.closest('.share-file-btn');
		if (shareBtn) {
			e.preventDefault();
			e.stopPropagation();

			const noteId = shareBtn.dataset.noteId;
			const fileId = shareBtn.dataset.fileId;
			const originalIcon = shareBtn.innerHTML;
			const successIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;

			shareBtn.disabled = true;
			shareBtn.innerHTML = '...';

			try {
				const response = await fetch(`/api/notes/${noteId}/files/${fileId}/share`, { method: 'POST' });
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(extractErrorMessage(errorData, 'Failed to generate link.'));
				}
				const { url } = await response.json();

				await navigator.clipboard.writeText(url);

				shareBtn.innerHTML = successIcon;
				shareBtn.classList.add('copied');
				shareBtn.title = t('copied');

				setTimeout(() => {
					shareBtn.innerHTML = originalIcon;
					shareBtn.classList.remove('copied');
					shareBtn.title = t('getPublicLink');
					shareBtn.disabled = false;
				}, 2000);

			} catch (error) {
				showCustomAlert(`Error: ${error.message}`, 'error');
				shareBtn.innerHTML = originalIcon;
				shareBtn.disabled = false;
			}
		}

		const deleteBtn = e.target.closest('.delete-file-btn');
		if (deleteBtn) {
			e.preventDefault();
			e.stopPropagation();

			const noteId = deleteBtn.dataset.noteId;
			const fileId = deleteBtn.dataset.fileId;

			const confirmed = await showCustomConfirm('Are you sure you want to permanently delete this file? This action cannot be undone.');
			if (!confirmed) return;

			const attachmentItem = deleteBtn.closest('.attachment-item');
			attachmentItem.style.opacity = '0.5';
			deleteBtn.disabled = true;

			const formData = new FormData();
			formData.append('filesToDelete', JSON.stringify([fileId]));

			// 找到对应的笔记内容来填充，以防内容为空
			const originalNote = allNotesCache.find(n => n.id == noteId);
			const content = originalNote ? originalNote.content : ''; // 如果在主列表缓存中能找到就用，否则为空
			formData.append('content', content);
			formData.append('update_timestamp', 'false');

			try {
				const response = await fetch(`/api/notes/${noteId}`, {
					method: 'PUT',
					body: formData
				});

				const result = await response.json();
				if (!response.ok) {
					throw new Error(extractErrorMessage(result, 'Failed to delete file.'));
				}

				if (result.noteDeleted) {
					// 从 Files 视图中移除所有属于该笔记的附件项
					attachmentsContent.querySelectorAll(`.attachment-item a[data-note-id="${noteId}"]`).forEach(el => el.closest('.attachment-item').remove());
					attachmentsState.allData = attachmentsState.allData.filter(item => item.noteId != noteId);
					allNotesCache = allNotesCache.filter(n => n.id !== parseInt(noteId));
					showToast('File and empty note removed.', 'info');
				} else {
					attachmentItem.remove();
					attachmentsState.allData = attachmentsState.allData.filter(item => !(item.noteId == noteId && item.id == fileId));
					if (originalNote) {
						originalNote.files = originalNote.files.filter(f => f.id !== fileId);
					}
					showToast('File deleted successfully.');
				}

			} catch (error) {
				showCustomAlert(`Error: ${error.message}`, 'error');
				attachmentItem.style.opacity = '1';
				deleteBtn.disabled = false;
			}
		}
	});

	// 处理右键预览文本文件的事件
	attachmentsContent.addEventListener('contextmenu', e => {
		// 这里的目标是整个可下载的文件卡片
		const link = e.target.closest('.attachment-item-file');
		if (!link || !link.download) return;

		// 复用已有的全局变量 textFileExtensions
		if (textFileExtensions.includes(link.download.split('.').pop().toLowerCase())) {
			e.preventDefault();
			window.open(`${link.href}?preview=true`, '_blank');
		}
	});
	/**
	 * 从附件视图切换回主页视图
	 */
	function hideAttachmentsViewer() {
		attachmentsViewer.style.display = 'none';
		appContainer.style.display = 'block';
		appLayoutContainer.classList.remove('attachments-mode');
	}

	// --- 右侧栏按钮的点击事件 ---
	homeTabBtn.addEventListener('click', () => {
		if (appState.baseMode === 'home') return;
		hideAttachmentsViewer(); // 从附件页返回
		appState.baseMode = 'home';
		updateSidebarTabsUI();
		updateEditorVisibility();
		reloadNotes();
	});

	favoritesTabBtn.addEventListener('click', () => {
		if (appState.baseMode === 'favorites') return;
		hideAttachmentsViewer(); // 从附件页返回
		appState.baseMode = 'favorites';
		updateSidebarTabsUI();
		updateEditorVisibility();
		reloadNotes();
	});

	archiveTabBtn.addEventListener('click', () => {
		if (appState.baseMode === 'archive') return;
		hideAttachmentsViewer();
		appState.baseMode = 'archive';
		updateSidebarTabsUI();
		updateEditorVisibility(); // 编辑器在归档页不显示
		reloadNotes();
	});

	attachmentsTabBtn.addEventListener('click', () => {
		if (appState.baseMode === 'attachments') return;
		showAttachmentsViewer();
	});

	// --- 为附件页面的子选项卡添加事件委托 ---
	attachmentsTabs.addEventListener('click', (e) => {
		const tabBtn = e.target.closest('.tab-btn');
		if (!tabBtn || tabBtn.classList.contains('active')) return;
		attachmentsTabs.querySelector('.active').classList.remove('active');
		tabBtn.classList.add('active');
		attachmentsState.currentFilter = tabBtn.dataset.filter;
		renderAttachments();
	});

	async function handleImageUploadAndInsert(files, textarea) {
		if (!files || files.length === 0) return;
		const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
		if (imageFiles.length === 0) return;
		for (const imageFile of imageFiles) {
			await handlePastedImage(imageFile, textarea);
		}
	}

	// --- START: 全屏编辑器同步滚动逻辑 ---

	/**
	 * 处理编辑器和预览区之间的同步滚动。
	 * @param {HTMLElement} source - 触发滚动的元素 (textarea 或 preview div)。
	 * @param {HTMLElement} target - 需要被同步滚动的元素。
	 */
	function handleSyncScroll(source, target) {
		// 如果目标元素正在被程序化同步滚动，则重置标志并立即返回，以防止无限循环。
		if (source._isSyncingScroll) {
			source._isSyncingScroll = false; // 重置标志
			return;
		}

		// 计算源元素可滚动的总高度。
		const sourceScrollableHeight = source.scrollHeight - source.clientHeight;
		// 如果源元素不可滚动（例如内容很短），则无需同步。
		if (sourceScrollableHeight <= 0) {
			return;
		}

		// 计算当前滚动的百分比。
		const scrollPercentage = source.scrollTop / sourceScrollableHeight;

		// 计算目标元素可滚动的总高度。
		const targetScrollableHeight = target.scrollHeight - target.clientHeight;

		// 在设置目标元素的 scrollTop 之前，先在其上设置一个标志。
		// 这样，当目标元素的 'scroll' 事件被触发时，我们可以识别出这是由程序控制的，而不是用户操作。
		target._isSyncingScroll = true;

		// 根据百分比设置目标元素的滚动位置。
		target.scrollTop = scrollPercentage * targetScrollableHeight;
	}

	// 为全屏编辑器的文本区添加滚动事件监听
	fsEditorTextarea.addEventListener('scroll', () => {
		// 确保只在分栏（split）模式下同步滚动
		if (editorContentArea.dataset.viewMode === 'split') {
			handleSyncScroll(fsEditorTextarea, fsPreviewPane);
		}
	});

	// 为全屏编辑器的预览区添加滚动事件监听
	fsPreviewPane.addEventListener('scroll', () => {
		// 确保只在分栏（split）模式下同步滚动
		if (editorContentArea.dataset.viewMode === 'split') {
			handleSyncScroll(fsPreviewPane, fsEditorTextarea);
		}
	});

	// --- END: 全屏编辑器同步滚动逻辑 ---

	/**
	 * 应用启动器
	 * 检查用户登录状态，并根据结果显示合适的界面
	 */
	async function initializeApp() {
		// 隐藏初始加载动画
		const initialLoader = document.getElementById('initial-loader');
		initialLoader.style.opacity = '0';
		setTimeout(() => {
			initialLoader.style.display = 'none';
		}, 200);

		try {
			const response = await fetch('/api/notes?page=1');
			if (response.ok) {
				const data = await response.json();
				const loaded = await loadSettings();
				// 显示应用主界面
				showAppScreen();
				if (loaded) {
					applySettings();
					await updateSettingsModalControls();
				}
				await loadUsersIfAdmin();
				allNotesCache = data.notes;
				renderNotes(data.notes);
				appState.pagination.hasMore = data.hasMore;
				appState.pagination.currentPage = 1;

				// 处理加载更多的UI
				if (!data.hasMore) {
					if (allNotesCache.length > 0) {
						scrollLoader.textContent = t('noMoreNotes');
						scrollLoader.style.display = 'block';
					} else {
						notesContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1rem 0;">${t('nothingHere')}</div>`;
						scrollLoader.style.display = 'none';
					}
				}
			} else if (response.status === 401) {
				// 如果 session 无效或不存在，显示登录界面
				showLoginScreen();
			} else {
				// 处理其他网络或服务器错误
				throw new Error(`Server check failed with status: ${response.status}`);
			}
		} catch (error) {
			console.error('Initialization failed:', error);
			document.body.innerHTML = translateMessage('Failed to initialize the application. Please check your connection and try again.');
		} finally {
			document.body.classList.remove('loading');
			const initialLoader = document.getElementById('initial-loader');
			initialLoader.style.opacity = '0';
			setTimeout(() => {
				initialLoader.style.display = 'none';
			}, 200);
		}
	}

	function syncMainEditorLayout() {
		const noteForm = document.getElementById('note-form');
		const textarea = document.getElementById('note-input');
		const preview = document.getElementById('main-edit-preview');

		// 如果当前不是分栏模式，只需确保 textarea 高度自适应即可
		if (!noteForm.classList.contains('split-mode')) {
			autoResizeTextarea(textarea);
			preview.style.minHeight = ''; // 移除可能存在的最小高度
			return;
		}
		autoResizeTextarea(textarea);
		const previewHeight = preview.offsetHeight;
		const textareaHeight = textarea.offsetHeight;
		if (previewHeight > textareaHeight) {
			textarea.style.height = `${previewHeight}px`;
		} else if (textareaHeight > previewHeight) {
			// 这是为了防止在删除大量文本时，右侧预览区突然变短导致布局跳动
			preview.style.minHeight = `${textareaHeight}px`;
		}
	}

	// --- 唯一的笔记编辑区布局管理函数 ---
	function syncNoteEditorLayout(noteElement) {
		if (!noteElement || !noteElement.classList.contains('editing')) return;

		const previewBtn = noteElement.querySelector('.md-preview-toggle-btn');
		const splitBtn = noteElement.querySelector('.md-split-toggle-btn');
		const textarea = noteElement.querySelector('.edit-textarea');
		const preview = noteElement.querySelector('.edit-preview');

		if (!previewBtn || !splitBtn || !textarea || !preview) return;

		const editorWidth = noteElement.offsetWidth;
		const isWide = editorWidth > 1000;
		previewBtn.style.display = isWide ? 'none' : 'inline-flex';
		splitBtn.style.display = isWide ? 'inline-flex' : 'none';

		if (!isWide && noteElement.classList.contains('split-mode')) {
			noteElement.classList.remove('split-mode');
			splitBtn.classList.remove('active');
		}
		if (isWide && noteElement.classList.contains('preview-mode')) {
			noteElement.classList.remove('preview-mode');
			previewBtn.classList.remove('active');
		}

		// 如果处于分栏模式
		if (noteElement.classList.contains('split-mode')) {
			// 强制 textarea 重新计算其自适应高度
			autoResizeTextarea(textarea);

			const previewHeight = preview.offsetHeight;
			const textareaHeight = textarea.offsetHeight;

			if (previewHeight > textareaHeight) {
				textarea.style.height = `${previewHeight}px`;
			}
		}
	}

	const noteEditorResizeObserver = new ResizeObserver(entries => {
		for (const entry of entries) {
			syncNoteEditorLayout(entry.target);
		}
	});

	function scrollToHeatmapEnd() {
		// requestAnimationFrame 确保在浏览器下一次绘制前执行，此时 DOM 元素尺寸已计算完毕
		requestAnimationFrame(() => {
			const scrollContainer = document.getElementById('heatmap-scroll-container');
			if (scrollContainer) {
				scrollContainer.scrollLeft = scrollContainer.scrollWidth;
			}
		});
	}

	function applyViewModes() {
		// 瀑布流模式
		if (appState.isWaterfall) {
			notesSection.classList.add('waterfall-mode');
			waterfallToggleBtn.classList.add('active'); // 按钮变亮
			// 重新计算布局
			document.querySelectorAll('#notes-container .note').forEach(note => {
				waterfallObserver.observe(note);
			});
		} else {
			notesSection.classList.remove('waterfall-mode');
			waterfallToggleBtn.classList.remove('active');
			waterfallObserver.disconnect();
		}

		// 宽屏模式
		if (appState.isWide) {
			appLayoutContainer.classList.add('full-width-mode');
			wideModeToggleBtn.classList.add('active');
		} else {
			appLayoutContainer.classList.remove('full-width-mode');
			wideModeToggleBtn.classList.remove('active');
		}
		scrollToHeatmapEnd();
	}

	waterfallToggleBtn.addEventListener('click', () => {
		appState.isWaterfall = !appState.isWaterfall;
		localStorage.setItem('memos-waterfall-mode', appState.isWaterfall);
		applyViewModes();
		reRenderCachedNotes();
		updateEditorVisibility();
	});

	wideModeToggleBtn.addEventListener('click', () => {
		appState.isWide = !appState.isWide;
		localStorage.setItem('memos-wide-mode', appState.isWide);
		applyViewModes();
	});

	// --- 预定义的主题色 ---
	const themeColors = [
		{ name: 'Blue', color: '#367cff', hover: '#2a63cc' },
		{ name: 'Green', color: '#42c251', hover: '#42c251' },
		{ name: 'Purple', color: '#805ad5', hover: '#6b46c1' },
		{ name: 'Orange', color: '#dd6b20', hover: '#c05621' },
		{ name: 'Pink', color: '#d53f8c', hover: '#b83280' },
		{ name: 'Red', color: '#e53e3e', hover: '#c53030' },
		{ name: 'Teal', color: '#3ad3ba', hover: '#287a78' },
		{ name: 'Yellow', color: '#d69e2e', hover: '#b7791f' }
	];

	// 动态填充预设颜色
	fsColorPalette.innerHTML = themeColors.map(theme =>
		`<button class='color-swatch' data-color='${theme.color}' title='${theme.name}' style='background-color: ${theme.color};'></button>`
	).join('');

	// 点击颜色按钮，显示/隐藏面板
	fsFontcolorBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		fsColorPopover.classList.toggle('visible');
	});

	// 点击预设颜色
	fsColorPalette.addEventListener('click', (e) => {
		const swatch = e.target.closest('.color-swatch');
		if (swatch) {
			const color = swatch.dataset.color;
			applyRichTextCommand('foreColor', color);
			// 更新按钮上的颜色预览
			fsFontcolorBtn.querySelector('span').style.backgroundColor = color;
			fsColorPopover.classList.remove('visible');
		}
	});

	/**
	 * 一个通用的、可撤销的富文本命令执行器
	 */
	function applyRichTextCommand(command, value) {
		const textarea = fsEditorTextarea;
		// Markdown 语法不支持富文本，所以我们用 HTML 标签包裹
		// 注意：这会让你的笔记内容变成 HTML 和 Markdown 的混合体
		let prefix, suffix;
		let selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
		if (!selectedText) return;
		if (command === 'foreColor') {
			selectedText = selectedText.replace(
				/<span style="color: .*?;">(.*?)<\/span>/g,
				'$1'
			);
			prefix = `<span style='color: ${value};'>`;
			suffix = `</span>`;
		} else if (command === 'fontSize') {
			prefix = `<span style='font-size: ${value};'>`;
			suffix = `</span>`;
		} else {
			return; // 不支持的命令
		}

		const start = textarea.selectionStart;
		const textToInsert = prefix + selectedText + suffix;

		document.execCommand('insertText', false, textToInsert);
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		const newCursorPosition = start + prefix.length + selectedText.length;
		textarea.selectionStart = newCursorPosition;
		textarea.selectionEnd = newCursorPosition;
		textarea.focus();
	}

	function setFullscreenViewMode(mode) {
		editorContentArea.dataset.viewMode = mode;
		viewModeSplitBtn.classList.toggle('active', mode === 'split');
		viewModePreviewBtn.classList.toggle('active', mode === 'preview');

		if (mode === 'source') {
			fsEditorTextarea.style.flexBasis = '100%';
		} else if (mode === 'preview') {
			fsPreviewPane.style.flexBasis = '100%';
		} else if (mode === 'split') {
			fsPreviewPane.style.flexBasis = '50%';
			fsEditorTextarea.style.flexBasis = '50%';
		}
	}

	// --- 通用的元素拖拽函数 ---
	function makeDraggable(element, handle) {
		let currentX;
		let currentY;
		let initialX;
		let initialY;
		let xOffset = 0;
		let yOffset = 0;

		handle.onmousedown = dragMouseDown;

		function dragMouseDown(e) {
			e.preventDefault();
			// 获取鼠标按下时的初始位置
			initialX = e.clientX - xOffset;
			initialY = e.clientY - yOffset;

			// 绑定鼠标移动和松开事件
			document.onmouseup = closeDragElement;
			document.onmousemove = elementDrag;
		}

		function elementDrag(e) {
			e.preventDefault();
			currentX = e.clientX - initialX;
			currentY = e.clientY - initialY;
			xOffset = currentX;
			yOffset = currentY;
			element.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
		}

		function closeDragElement() {
			document.onmouseup = null;
			document.onmousemove = null;
		}
	}

	/**
	 * 根据设置，应用特性相关 UI 元素的可见性 (主要针对静态元素)
	 */
	function applyFeatureVisibilitySettings() {
		if (!settings) return;

		// 控制右侧边栏的按钮
		document.getElementById('favorites-tab-btn').style.display = settings.showFavorites ? '' : 'none';
		document.getElementById('archive-tab-btn').style.display = settings.showArchive ? '' : 'none';

		const docsLink = document.querySelector('.sidebar-buttons-group a[href="/docs"]');
		if (docsLink) {
			docsLink.style.display = settings.showDocs ? '' : 'none';
		}
	}
	/**
	 * 根据当前加载的设置，应用所有UI效果
	 */
	async function applySettings() {
		const isDarkMode = document.body.dataset.theme === 'dark';
		const baseSurfaceColor = isDarkMode ? settings.surfaceColorDark : settings.surfaceColor;
		const surfaceOpacity = settings.surfaceOpacity;
		let r = 255, g = 255, b = 255; // 默认白色
		if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(baseSurfaceColor)) {
			let hex = baseSurfaceColor.substring(1).split('');
			if (hex.length === 3) {
				hex = [hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]];
			}
			hex = '0x' + hex.join('');
			r = (hex >> 16) & 255;
			g = (hex >> 8) & 255;
			b = hex & 255;
		}
		const finalSurfaceColor = `rgba(${r}, ${g}, ${b}, ${surfaceOpacity})`;
		document.documentElement.style.setProperty('--surface-color', finalSurfaceColor);
		if (isDarkMode) {
			// 在深色模式下，将 R, G, B 各增加 24 (使其变亮)，但不超过 255
			const r_light = Math.min(255, r + 24);
			const g_light = Math.min(255, g + 24);
			const b_light = Math.min(255, b + 24);
			const finalInputBg = `rgb(${r_light}, ${g_light}, ${b_light})`;
			document.documentElement.style.setProperty('--surface-input-bg', finalInputBg);
		} else {
			// 在浅色模式下，使用默认的背景色
			document.documentElement.style.setProperty('--surface-input-bg', 'var(--bg-color)');
		}

		searchStatsContainer.style.display = settings.showSearchBar ? '' : 'none';
		statsCard.style.display = settings.showStatsCard ? '' : 'none';
		calendarWrapper.style.display = settings.showCalendar ? '' : 'none';
		tagsSectionWrapper.style.display = settings.showTags ? '' : 'none';
		timelineSectionWrapper.style.display = settings.showTimeline ? '' : 'none';
		rightSidebar.style.display = settings.showRightSidebar ? '' : 'none';
		heatmapContainerWrapper.style.display = settings.showHeatmap ? '' : 'none';
		notesSection.classList.toggle('date-grouping-enabled', settings.enableDateGrouping);

		const areAllSidebarsHidden = !settings.showSearchBar && !settings.showStatsCard && !settings.showCalendar && !settings.showTags && !settings.showTimeline;
		const currentDest = settings.imageUploadDestination || 'local';
		const radioToCheck = document.getElementById(`upload-dest-${currentDest}`);
		if (radioToCheck) {
			radioToCheck.checked = true;
		}
		imgurClientIdInput.value = settings.imgurClientId || '';

		if (areAllSidebarsHidden) {
			// 如果都隐藏了，就给主容器添加 .no-sidebars 类
			appLayoutContainer.classList.add('no-sidebars');
		} else {
			// 否则，确保移除这个类，恢复到正常的三栏或宽屏模式
			appLayoutContainer.classList.remove('no-sidebars');
		}
		if (!settings.showRightSidebar) {
			appLayoutContainer.classList.add('no-right-sidebar');
		} else {
			appLayoutContainer.classList.remove('no-right-sidebar');
		}

		const isDefaultBg = settings.backgroundImage === defaultSettings.backgroundImage;
		const isLightMode = document.body.dataset.theme === 'light';

		// 条件：只有在 (不是浅色模式) OR (不是默认背景) 的情况下才应用背景
		if (settings.backgroundImage && (!isLightMode || !isDefaultBg)) {
			// document.body.style.backgroundImage = `url(${settings.backgroundImage})`;
			document.documentElement.style.setProperty('--bg-image-url', `url(${settings.backgroundImage})`);

			document.body.classList.add('custom-background');
			appLayoutContainer.classList.add('glass-effect');
			const authForm = document.querySelector('.auth-form');
			if (authForm) authForm.classList.add('glass-effect');
		} else {
			// 否则，移除背景
			document.body.style.backgroundImage = '';
			document.body.classList.remove('custom-background');
			appLayoutContainer.classList.remove('glass-effect');
			const authForm = document.querySelector('.auth-form');
			if (authForm) authForm.classList.remove('glass-effect');
		}
		document.documentElement.style.setProperty('--bg-blur', `${settings.backgroundBlur}px`);
		document.documentElement.style.setProperty('--bg-opacity', settings.backgroundOpacity);
		scrollToHeatmapEnd();

		document.documentElement.style.setProperty('--waterfall-card-width', `${settings.waterfallCardWidth}px`);
	}

	/**
	 * 将当前加载的设置值，同步到设置弹框的控件上
	 */
	async function updateSettingsModalControls() {
		const isDarkMode = document.body.dataset.theme === 'dark';
		const currentSurfaceColor = isDarkMode ? settings.surfaceColorDark : settings.surfaceColor;
		document.getElementById('surface-opacity-slider').value = settings.surfaceOpacity;
		document.getElementById('surface-color-picker-preview').style.backgroundColor = currentSurfaceColor;
		document.getElementById('surface-hex-color-input').value = currentSurfaceColor;
		document.getElementById('surface-color-picker-input').value = currentSurfaceColor;
		toggleSearchBar.checked = settings.showSearchBar;
		toggleStatsCard.checked = settings.showStatsCard;
		toggleCalendar.checked = settings.showCalendar;
		toggleTags.checked = settings.showTags;
		toggleTimeline.checked = settings.showTimeline;
		toggleRightSidebar.checked = settings.showRightSidebar;
		toggleEditorInWaterfall.checked = settings.hideEditorInWaterfall;
		toggleHeatmap.checked = settings.showHeatmap;
		bgOpacitySlider.value = settings.backgroundOpacity;
		bgImageUrl.value = settings.backgroundImage.startsWith('data:') ? '' : settings.backgroundImage; // 不显示base64
		bgBlurSlider.value = settings.backgroundBlur;
		waterfallWidthSlider.value = settings.waterfallCardWidth;
		waterfallWidthValue.textContent = `${settings.waterfallCardWidth}px`;
		toggleDateGrouping.checked = settings.enableDateGrouping;
		document.getElementById('toggle-content-truncation').checked = settings.enableContentTruncation;
		toggleTelegramProxy.checked = settings.telegramProxy;
		document.getElementById('toggle-feature-favorites').checked = settings.showFavorites;
		document.getElementById('toggle-feature-archive').checked = settings.showArchive;
		document.getElementById('toggle-feature-pinning').checked = settings.enablePinning;
		document.getElementById('toggle-feature-sharing').checked = settings.enableSharing;
		document.getElementById('toggle-feature-docs').checked = settings.showDocs;
	}

	function initializeSettings() {
		document.getElementById('toggle-feature-favorites').addEventListener('change', (e) => {
			settings.showFavorites = e.target.checked;
			applyFeatureVisibilitySettings();
		});
		document.getElementById('toggle-feature-archive').addEventListener('change', (e) => {
			settings.showArchive = e.target.checked;
			applyFeatureVisibilitySettings();
		});
		document.getElementById('toggle-feature-pinning').addEventListener('change', (e) => {
			settings.enablePinning = e.target.checked;
		});
		document.getElementById('toggle-feature-sharing').addEventListener('change', (e) => {
			settings.enableSharing = e.target.checked;
		});
		document.getElementById('toggle-feature-docs').addEventListener('change', (e) => {
			settings.showDocs = e.target.checked;
			applyFeatureVisibilitySettings();
		});
		surfaceOpacitySlider.addEventListener('input', (e) => {
			settings.surfaceOpacity = e.target.value
			applySettings();
		});
		restoreSurfaceBtn.addEventListener('click', () => {
			settings.surfaceOpacity = defaultSettings.surfaceOpacity;  // 更新当前值
			settings.surfaceColor = defaultSettings.surfaceColor;
			settings.surfaceColorDark = defaultSettings.surfaceColorDark;
			applySettings();
			updateSettingsModalControls();
		});
		const handleSurfaceColorChange = (color) => {
			const isDarkMode = document.body.dataset.theme === 'dark';
			if (isDarkMode) {
				settings.surfaceColorDark = color;
			} else {
				settings.surfaceColor = color;
			}
			applySettings();
			updateSettingsModalControls();
		};

		surfaceColorPickerInput.addEventListener('input', (e) => {
			handleSurfaceColorChange(e.target.value);
		});

		surfaceHexColorInput.addEventListener('input', (e) => {
			const rawValue = e.target.value;
			if (/^#[0-9a-f]{6}$/i.test(rawValue)) {
				handleSurfaceColorChange(rawValue);
			}
		});
		toggleSearchBar.addEventListener('change', (e) => {
			settings.showSearchBar = e.target.checked;
			applySettings();
		});
		toggleStatsCard.addEventListener('change', (e) => {
			settings.showStatsCard = e.target.checked;
			applySettings();
		});
		toggleCalendar.addEventListener('change', (e) => {
			settings.showCalendar = e.target.checked;
			applySettings();
		});
		toggleTags.addEventListener('change', (e) => {
			settings.showTags = e.target.checked;
			applySettings();
		});
		toggleTimeline.addEventListener('change', (e) => {
			settings.showTimeline = e.target.checked;
			applySettings();
		});
		toggleRightSidebar.addEventListener('change', (e) => {
			settings.showRightSidebar = e.target.checked;
			applySettings();
		});
		toggleHeatmap.addEventListener('change', (e) => {
			settings.showHeatmap = e.target.checked;
			applySettings();
		});
		uploadDestinationRadios.forEach(radio => {
			radio.addEventListener('change', (e) => {
				const destination = e.target.value;
				settings.imageUploadDestination = destination;
			});
		});
		toggleDateGrouping.addEventListener('change', (e) => {
			const isEnabled = e.target.checked;
			settings.enableDateGrouping = isEnabled;
			if (!isEnabled) {
				notesContainer.innerHTML = '';
			}
			applySettings();
			reloadNotes();
		});
		const toggleContentTruncation = document.getElementById('toggle-content-truncation');
		toggleContentTruncation.addEventListener('change', (e) => {
			settings.enableContentTruncation = e.target.checked;
			reRenderCachedNotes();
		});
		imgurClientIdInput.addEventListener('input', (e) => {
			settings.imgurClientId = e.target.value.trim();
		});
		bgOpacitySlider.addEventListener('input', (e) => {
			settings.backgroundOpacity = e.target.value;
			applySettings();
		});
		toggleEditorInWaterfall.addEventListener('change', (e) => {
			settings.hideEditorInWaterfall = e.target.checked;
			updateEditorVisibility();
		});
		bgImageUrl.addEventListener('input', (e) => {
			settings.backgroundImage = e.target.value;
			applySettings();
		});

		bgImageUpload.addEventListener('change', (e) => {
			const file = e.target.files[0];
			if (file) {
				const reader = new FileReader();
				reader.onload = (event) => {
					settings.backgroundImage = event.target.result;
					applySettings();
				};
				reader.readAsDataURL(file);
			}
		});

		bgBlurSlider.addEventListener('input', (e) => {
			settings.backgroundBlur = e.target.value;
			applySettings();
		});

		clearBgBtn.addEventListener('click', () => {
			bgImageUrl.value = '';
			bgImageUpload.value = '';
			bgBlurSlider.value = defaultSettings.backgroundBlur;
			bgOpacitySlider.value = defaultSettings.backgroundOpacity;
			settings.backgroundImage = '';
			settings.backgroundBlur = defaultSettings.backgroundBlur;
			settings.backgroundOpacity = defaultSettings.backgroundOpacity;
			applySettings();
		});
		restoreBgBtn.addEventListener('click', () => {
			const defaultBg = defaultSettings.backgroundImage;
			const defaultBlur = defaultSettings.backgroundBlur;
			const defaultOpacity = defaultSettings.backgroundOpacity;

			bgImageUrl.value = defaultBg.startsWith('data:') ? '' : defaultBg;
			bgImageUpload.value = '';
			bgBlurSlider.value = defaultBlur;
			bgOpacitySlider.value = defaultOpacity;
			settings.backgroundImage = defaultBg;
			settings.backgroundBlur = defaultBlur;
			settings.backgroundOpacity = defaultOpacity;
			applySettings();
		});
		waterfallWidthSlider.addEventListener('input', (e) => {
			const width = e.target.value;
			waterfallWidthValue.textContent = `${width}px`;
			settings.waterfallCardWidth = width;
			applySettings();
		});
		toggleTelegramProxy.addEventListener('change', (e) => {
			settings.telegramProxy = e.target.checked;
		});
		const settingsBtn = document.getElementById('settings-btn');
		if (settingsBtn) {
			settingsBtn.addEventListener('click', () => {
				updateSettingsModalControls();
				settingsModalOverlay.classList.add('visible');
				settingsModalOverlay.querySelector('.custom-modal-box').classList.add('active');
			});
		}

		const closeSettingsModal = () => {
			saveSettings();
			settingsModalOverlay.classList.remove('visible');
			settingsModalOverlay.querySelector('.custom-modal-box').classList.remove('active');
		};

		closeSettingsBtn.addEventListener('click', closeSettingsModal);

		// --- 点击遮罩层（外部）关闭弹框 ---
		settingsModalOverlay.addEventListener('click', (e) => {
			// 检查点击的是否是遮罩层本身，而不是弹框内容
			if (e.target === settingsModalOverlay) {
				closeSettingsModal();
			}
		});
		makeDraggable(document.getElementById('settings-modal-box'), document.querySelector('.settings-header'));
		applySettings();
	}


	// --- 为瀑布流菜单的按钮添加事件委托 ---
	/*	waterfallPopoverMenu.addEventListener('click', async (e) => {
			const actionButton = e.target.closest('.icon-btn');
			if (!actionButton) return;
			const action = actionButton.dataset.action;
			const noteId = waterfallPopoverMenu.dataset.noteId;
			if (!noteId) return;
			// 先隐藏菜单，提供即时反馈
			hideWaterfallPopover();
	
			const noteElement = notesContainer.querySelector(`.note[data-id="${noteId}"]`);
	
			switch (action) {
				case 'view': {
					const noteData = allNotesCache.find(n => n.id === parseInt(noteId, 10));
					if (noteData) {
						// 调用全屏编辑器，并定制其行为
						openFullscreenEditor(noteData.content, noteId, {
							defaultViewMode: 'split'
						});
					}
					break;
				}
	
				case 'delete': {
					if (!noteElement) return;
					const confirmed = await showCustomConfirm('Are you sure you want to delete this note?');
					if (!confirmed) return;
	
					// 复用现有的删除逻辑
					waterfallObserver.unobserve(noteElement);
					try {
						await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
						noteElement.remove();
					} catch (error) {
						waterfallObserver.observe(noteElement);
						showCustomAlert(error.message, 'error');
					}
					break;
				}
			}
		});
		waterfallPopoverMenu.addEventListener('mouseenter', () => {
			clearTimeout(waterfallPopoverHideTimer);
		});
	
		waterfallPopoverMenu.addEventListener('mouseleave', () => {
			hideWaterfallPopover();
		});*/

	/*function showWaterfallPopover(targetButton, noteId) {
		clearTimeout(waterfallPopoverHideTimer);
		if (waterfallPopoverMenu.classList.contains('visible') && activePopoverNoteId === noteId) {
			return;
		}
		// 获取按钮的位置信息，以便定位菜单
		const btnRect = targetButton.getBoundingClientRect();
		// top: 按钮底部 + 页面滚动距离 + 一点间距
		// left: 按钮左侧 - 菜单宽度 + 按钮宽度 (使其右对齐)
		waterfallPopoverMenu.style.top = `${btnRect.bottom + 5}px`;
		waterfallPopoverMenu.style.left = `${btnRect.right - waterfallPopoverMenu.offsetWidth}px`;
		// 存储当前笔记ID，并显示菜单
		activePopoverNoteId = noteId;
		waterfallPopoverMenu.dataset.noteId = noteId; // 将ID存到菜单上，方便后续操作
		waterfallPopoverMenu.classList.add('visible');
	}*/

	/**
	 * 隐藏“更多”操作菜单
	 */
	// function hideWaterfallPopover() {
	// 	clearTimeout(waterfallPopoverHideTimer);
	// 	waterfallPopoverHideTimer = setTimeout(() => {
	// 		waterfallPopoverMenu.classList.remove('visible');
	// 		activePopoverNoteId = null;
	// 	}, 200);
	// }

	// --- 右侧栏Tab按钮的交互逻辑 ---
	function updateSidebarTabsUI() {
		document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tabName === appState.baseMode);
		});
	}

	homeTabBtn.addEventListener('click', () => {
		if (appState.baseMode === 'home') return;
		appState.baseMode = 'home';
		updateSidebarTabsUI();
		updateEditorVisibility();
		reloadNotes();
	});

	favoritesTabBtn.addEventListener('click', () => {
		if (appState.baseMode === 'favorites') return;
		appState.baseMode = 'favorites';
		updateSidebarTabsUI();
		updateEditorVisibility();
		reloadNotes();
	});


	/**
	 * 初始化侧边栏的折叠状态
	 * 从 localStorage 读取用户的偏好并应用
	 */
	function initializeCollapsibleSidebars() {
		const sections = ['tags-section-wrapper', 'timeline-section-wrapper'];

		sections.forEach(sectionId => {
			const sectionElement = document.getElementById(sectionId);
			// 读取 localStorage，如果值为 'true'，则添加 is-collapsed 类
			if (localStorage.getItem(`sidebar-${sectionId}-collapsed`) === 'true') {
				sectionElement.classList.add('is-collapsed');
			}
		});
	}

	// 使用事件委托，为所有折叠按钮添加点击事件
	document.getElementById('app-layout-container').addEventListener('click', (e) => {
		const toggleBtn = e.target.closest('.sidebar-toggle-btn');
		if (toggleBtn) {
			const parentContent = toggleBtn.closest('.sidebar-content');
			if (parentContent) {
				parentContent.classList.toggle('is-collapsed');
				const isCollapsed = parentContent.classList.contains('is-collapsed');
				localStorage.setItem(`sidebar-${parentContent.id}-collapsed`, isCollapsed);
			}
		}
	});

	async function loadAndRenderStats() {
		try {
			const response = await fetch('/api/stats');
			if (!response.ok) throw new Error('Failed to fetch stats');
			const stats = await response.json();

			// 计算天数
			let days = 0;
			if (stats.oldestNoteTimestamp) {
				const oldestDate = new Date(stats.oldestNoteTimestamp);
				const today = new Date();
				// 设置时间为当天的开始，避免时区和小时差异导致计算错误
				oldestDate.setHours(0, 0, 0, 0);
				today.setHours(0, 0, 0, 0);

				const diffTime = Math.abs(today - oldestDate);
				const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
				days = diffDays;
			}
			statsDays.textContent = days;
			statsMemos.textContent = stats.memos;
			statsTags.textContent = stats.tags;
		} catch (error) {
			console.error('Error loading stats:', error);
			statsDays.textContent = '0';
			statsMemos.textContent = '0';
			statsTags.textContent = '0';
		}
	}
	async function loadAndRenderHeatmap(timelineData) {
		try {
			const countsByDate = new Map();
			for (const year in timelineData) {
				for (const month in timelineData[year].months) {
					for (const day in timelineData[year].months[month].days) {
						const count = timelineData[year].months[month].days[day].count;
						const monthPadded = month.toString().padStart(2, '0');
						const dayPadded = day.toString().padStart(2, '0');
						const dateString = `${year}-${monthPadded}-${dayPadded}`;
						countsByDate.set(dateString, count);
					}
				}
			}
			notesDataByDate.clear();
			countsByDate.forEach((count, dateString) => {
				notesDataByDate.set(dateString, count);
			});
			calendarInstance = new Calendar(calendarWrapper, notesDataByDate);
			const today = new Date();
			const daysToShow = 180;
			const grid = document.createElement('div');
			grid.id = 'heatmap-grid';

			const firstDateToRender = new Date(today);
			firstDateToRender.setDate(today.getDate() - (daysToShow - 1));
			const startDayOfWeek = (firstDateToRender.getDay() + 6) % 7;
			for (let i = 0; i < startDayOfWeek; i++) {
				const placeholder = document.createElement('div');
				placeholder.className = 'heatmap-day placeholder';
				grid.appendChild(placeholder);
			}
			for (let i = 0; i < daysToShow; i++) {
				const date = new Date(firstDateToRender);
				date.setDate(firstDateToRender.getDate() + i);

				const year = date.getFullYear();
				const month = (date.getMonth() + 1).toString().padStart(2, '0');
				const dayOfMonth = date.getDate().toString().padStart(2, '0');
				const dateString = `${year}-${month}-${dayOfMonth}`;

				const count = countsByDate.get(dateString) || 0;

				let level = 0;
				if (count > 0 && count <= 2) level = 1;
				else if (count > 2 && count <= 5) level = 2;
				else if (count > 5 && count <= 8) level = 3;
				else if (count > 8) level = 4;

				const dayElement = document.createElement('div');
				dayElement.className = 'heatmap-day';
				dayElement.dataset.date = dateString;
				dayElement.dataset.count = count;
				dayElement.dataset.level = level;
				grid.appendChild(dayElement);
			}

			heatmapContainerWrapper.innerHTML = '';
			const scrollContainer = document.createElement('div');
			scrollContainer.id = 'heatmap-scroll-container';
			scrollContainer.appendChild(grid);
			heatmapContainerWrapper.appendChild(scrollContainer);

			scrollToHeatmapEnd();
			initializeHeatmapDragToScroll();

		} catch (error) {
			console.error('Error loading heatmap:', error);
			heatmapContainerWrapper.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-secondary);">${translateMessage('Could not load activity data.')}</p>`;
		}
	}

	// --- 热力图交互事件 (事件委托) ---
	heatmapContainerWrapper.addEventListener('mouseover', (e) => {
		const dayElement = e.target.closest('.heatmap-day');
		if (dayElement) {
			const date = dayElement.dataset.date;
			const count = Number(dayElement.dataset.count || 0);
			if (count > 0) {
				const countText = formatNoteCountLabel(count);
				heatmapTooltip.textContent = `${countText} · ${date}`;
			} else {
				heatmapTooltip.textContent = date;
			}
			heatmapTooltip.style.display = 'block';
		}
	});

	heatmapContainerWrapper.addEventListener('mousemove', (e) => {
		// 让 tooltip 跟随鼠标移动
		heatmapTooltip.style.left = `${e.pageX}px`;
		heatmapTooltip.style.top = `${e.pageY}px`;
	});

	heatmapContainerWrapper.addEventListener('mouseout', () => {
		heatmapTooltip.style.display = 'none';
	});

	heatmapContainerWrapper.addEventListener('click', (e) => {
		const dayElement = e.target.closest('.heatmap-day');
		if (dayElement && dayElement.dataset.count > 0) {
			const dateString = dayElement.dataset.date; // "YYYY-MM-DD"

			// --- 复用之前的日期筛选逻辑 ---
			const [year, month, day] = dateString.split('-').map(Number);
			const monthIndex = month - 1;

			const startOfDay = new Date(year, monthIndex, day);
			const endOfDay = new Date(year, monthIndex, day + 1);

			appState.filters.date = {
				startTimestamp: startOfDay.getTime(),
				endTimestamp: endOfDay.getTime()
			};

			document.querySelectorAll('#timeline-container .timeline-item.active').forEach(i => i.classList.remove('active'));
			clearFilterBtn.classList.add('visible');

			reloadNotes();
		}
	});

	let searchDebounceTimer;
	// 防抖函数：延迟执行，避免频繁请求 API
	function debounce(func, delay) {
		return function (...args) {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = setTimeout(() => {
				func.apply(this, args);
			}, delay);
		};
	}

	async function performSearch(query) {
		appState.filters.query = query;
		clearSearchBtn.style.display = query ? 'block' : 'none';
		reloadNotes();
	}

	function handleEditorShortcuts(event) {
		const textarea = event.target;
		if (!textarea.matches('textarea')) return;
		// --- Ctrl+X 剪切当前行 ---
		if (event.ctrlKey && event.key.toLowerCase() === 'x') {
			// 仅当没有文本被选中时，才执行剪切行逻辑
			if (textarea.selectionStart === textarea.selectionEnd) {
				event.preventDefault(); // 阻止默认行为，我们将手动处理

				const cursorPosition = textarea.selectionStart;
				const text = textarea.value;

				// 找到当前行的起始和结束位置
				const lineStart = text.lastIndexOf('\n', cursorPosition - 1) + 1;
				let lineEnd = text.indexOf('\n', cursorPosition);
				if (lineEnd === -1) {
					lineEnd = text.length;
				}

				// 选中整行（包括末尾的换行符，如果有的话）
				textarea.setSelectionRange(lineStart, lineEnd + 1);
				// 这样做的好处是它会自动处理剪贴板，并且操作是可撤销的
				document.execCommand('cut');
			}
		}
	}

	// 监听输入框的 'input' 事件
	globalSearchInput.addEventListener('input', debounce(e => {
		const query = e.target.value.trim();
		if (query.length === 0 || query.length >= 2) {
			performSearch(query);
		}
	}, 300)); // 延迟300毫秒执行搜索
	/**
	 * 监听搜索框的 'keydown' 事件，以捕获回车键
	 */
	globalSearchInput.addEventListener('keydown', e => {
		if (e.key === 'Enter') {
			e.preventDefault();
			const query = e.target.value.trim();
			if (query.length === 0 || query.length >= 2) {
				clearTimeout(searchDebounceTimer);
				performSearch(query);
			}
		}
	});
	// 清除按钮的点击事件
	clearSearchBtn.addEventListener('click', () => {
		globalSearchInput.value = '';
		performSearch('');
		globalSearchInput.focus();
	});

	let currentEditingNoteId = null;
	let isFullscreenMode = false;
	function openFullscreenEditor(content = '', noteId = null, options = {}) {
		currentEditingNoteId = noteId;
		fsEditorTextarea.value = content;
		fsPreviewPane.innerHTML = postProcessMarkdownHtml(marked.parse(content));
		const targetNote = noteId ? allNotesCache.find(n => n.id === noteId) : null;
		const vis = targetNote?.visibility || 'private';
		if (fsVisibilitySelect) {
			fsVisibilitySelect.value = vis;
		}

		const timestampLabel = document.getElementById('fs-timestamp-label');
		const timestampToggle = document.getElementById('fs-update-timestamp-toggle');
		if (noteId === null) {
			// 新建笔记时，不更新时间戳没有意义，因此隐藏该选项
			timestampLabel.style.display = 'none';
		} else {
			// 编辑笔记时，显示并默认勾选（不更新时间戳）
			timestampLabel.style.display = 'flex';
			timestampToggle.checked = true;
		}
		const defaultView = options.defaultViewMode || 'split'; // 默认split
		setFullscreenViewMode(defaultView);
		editorContentArea.dataset.viewMode = defaultView;
		fullscreenEditorOverlay.classList.add('visible');
		fullscreenEditorBox.classList.add('active');
		isFullscreenMode = true;
		fsEditorTextarea.focus();
	}

	// 关闭编辑器
	function closeFullscreenEditor() {
		fullscreenEditorOverlay.classList.remove('visible');
		fullscreenEditorBox.classList.remove('active');
		isFullscreenMode = false;
		currentEditingNoteId = null;
	}

	viewModeSplitBtn.addEventListener('click', () => {
		// 如果当前已经是分屏模式，再次点击则切换回源码模式
		if (editorContentArea.dataset.viewMode === 'split') {
			setFullscreenViewMode('source');
		} else {
			setFullscreenViewMode('split');
		}
	});
	// 点击预览按钮
	viewModePreviewBtn.addEventListener('click', () => {
		// 如果当前已经是预览模式，再次点击则切换回源码模式
		if (editorContentArea.dataset.viewMode === 'preview') {
			setFullscreenViewMode('source');
		} else {
			setFullscreenViewMode('preview');
		}
	});

	// 实时更新预览
	fsEditorTextarea.addEventListener('input', () => {
		fsPreviewPane.innerHTML = postProcessMarkdownHtml(marked.parse(fsEditorTextarea.value));
	});

	// 点击主创建区的全屏按钮
	enterFullscreenBtn.addEventListener('click', () => {
		// 将主输入框的内容带入全屏编辑器
		openFullscreenEditor(noteInput.value, null);
	});
	let isDragging = false;
	fsEditorDivider.addEventListener('mousedown', (e) => {
		e.preventDefault(); // 防止拖拽时选中文字
		isDragging = true;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', handleDrag);
		window.addEventListener('mouseup', stopDrag);
	});

	function handleDrag(e) {
		if (!isDragging) return;

		const container = editorContentArea;
		const containerRect = container.getBoundingClientRect();
		const mouseX = e.clientX - containerRect.left;
		let leftPaneWidth = (mouseX / containerRect.width) * 100;
		const minWidthPercent = 15;
		if (leftPaneWidth < minWidthPercent) {
			leftPaneWidth = minWidthPercent;
		}
		if (leftPaneWidth > (100 - minWidthPercent)) {
			leftPaneWidth = 100 - minWidthPercent;
		}
		const rightPaneWidth = 100 - leftPaneWidth;
		// 使用 flex-basis 来设置宽度
		fsEditorTextarea.style.flexBasis = `${leftPaneWidth}%`;
		fsPreviewPane.style.flexBasis = `${rightPaneWidth}%`;
	}

	function stopDrag() {
		if (!isDragging) return;
		isDragging = false;
		// 移除全局样式
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		// 解绑事件
		window.removeEventListener('mousemove', handleDrag);
		window.removeEventListener('mouseup', stopDrag);
	}

	editorToolbar.addEventListener('click', e => {
		const target = e.target.closest('.toolbar-btn');
		if (!target) return;

		const textarea = fsEditorTextarea;
		const mdType = target.dataset.md;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selectedText = textarea.value.substring(start, end);

		// 让浏览器执行原生的、可撤销的插入命令
		const applyMarkdown = (prefix, suffix = prefix) => {
			textarea.focus();
			document.execCommand('insertText', false, prefix + selectedText + suffix);
			const newCursorPosition = start + prefix.length + selectedText.length;
			textarea.selectionStart = newCursorPosition;
			textarea.selectionEnd = newCursorPosition;
			textarea.focus();
		};

		switch (mdType) {
			case 'bold':
				applyMarkdown('**');
				break;
			case 'underline':
				applyMarkdown('<u>', '</u>');
				break;
			case 'italic':
				applyMarkdown('*');
				break;
			case 'strike':
				applyMarkdown('~~');
				break;
			case 'blockquote':
				applyMarkdown('> ', '');
				break;
			case 'ulist': {
				if (start === end) {
					applyMarkdown('- ', '');
					break;
				}
				const value = textarea.value;
				// Find the start of the first line affected by the selection.
				const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;

				// Find the end of the last line affected by the selection.
				let lastLineEnd = value.indexOf('\n', end);
				if (lastLineEnd === -1) {
					lastLineEnd = value.length;
				}
				// If the selection ends exactly on a newline, don't include the next line.
				if (value.substring(end - 1, end) === '\n') {
					lastLineEnd = end - 1;
				}

				const block = value.substring(firstLineStart, lastLineEnd);
				const lines = block.split('\n');
				let newBlock = '';
				let changeInLength = 0;

				// Intelligent Toggle: If every selected line is already a list item, remove the markers.
				const isTogglingOff = lines.every(line => /^\s*[-*+]\s/.test(line) || line.trim() === '');

				if (isTogglingOff) {
					newBlock = lines.map(line => {
						if (line.trim() === '') return line;
						const transformed = line.replace(/^\s*[-*+]\s/, '');
						changeInLength -= (line.length - transformed.length);
						return transformed;
					}).join('\n');
				} else {
					newBlock = lines.map(line => {
						if (line.trim() === '' || /^\s*[-*+]\s/.test(line)) return line;
						changeInLength += 2; // for '- '
						return '- ' + line;
					}).join('\n');
				}

				// Perform the replacement using an undoable command.
				textarea.focus();
				textarea.setSelectionRange(firstLineStart, lastLineEnd);
				document.execCommand('insertText', false, newBlock);

				// Restore the user's selection over the modified text.
				textarea.setSelectionRange(firstLineStart, lastLineEnd + changeInLength);
				break;
			}
			case 'link':
				const url = prompt(translateMessage('Enter the URL:'), 'https://');
				if (url) applyMarkdown('[', `](${url})`);
				break;
			case 'image':
				const imgUrl = prompt(translateMessage('Enter the image URL:'));
				if (imgUrl) applyMarkdown('![', `](${imgUrl})`);
				break;
			case 'code':
				applyMarkdown('\n```\n', '\n```');
				break;
		}
		// 手动触发input事件，确保预览能够实时更新
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	});

	// 字体大小选择
	fsFontsizeSelector.addEventListener('change', (e) => {
		const size = e.target.value;
		if (size) {
			applyRichTextCommand('fontSize', size);
		}
		e.target.value = ''; // 每次选择后重置，以便可以重复选择相同大小
	});

	// 为全屏编辑器绑定
	// 键盘快捷键
	fsEditorTextarea.addEventListener('keydown', e => {
		handleEditorShortcuts(e);
		handleListAutoInsertion(e);
		handleTabIndentation(e);
		if (e.ctrlKey) {
			let mdType = null;
			if (e.key === 'b') mdType = 'bold';
			if (e.key === 'i') mdType = 'italic';
			if (e.key === 'k') mdType = 'link';

			if (mdType) {
				e.preventDefault();
				// 模拟点击对应的按钮
				document.querySelector(`.toolbar-btn[data-md="${mdType}"]`).click();
			}
		}
	});


	fsCancelBtn.addEventListener('click', closeFullscreenEditor);
	fsSaveBtn.addEventListener('click', async () => {
		const content = fsEditorTextarea.value;
		fsSaveBtn.disabled = true;
		fsSaveBtn.textContent = t('saving');

		try {
			if (currentEditingNoteId === null) {
				const content = fsEditorTextarea.value;
				// 檢查內容和文件是否都為空
				if (!content.trim() && noteFile.files.length === 0) {
					showCustomAlert('Content or a file is required.', 'error');
					// 恢復按鈕狀態
					fsSaveBtn.disabled = false;
					fsSaveBtn.textContent = t('save');
					return; // 提前返回
				}

				const formData = new FormData();
				// 1. 添加從全屏編輯器獲取的新文本內容
				formData.append('content', content);
				formData.append('visibility', fsVisibilitySelect?.value || 'private');
				// 2. 從主界面的 noteFile 輸入框中獲取文件並添加到 formData
				Array.from(noteFile.files).forEach(file => {
					formData.append('file', file);
				});

				try {
					const res = await fetch('/api/notes', { method: 'POST', body: formData });
					if (!res.ok) throw new Error(`Save failed: ${await res.text()}`);

					noteForm.reset(); // 使用 reset() 可以同時清空文本和文件輸入
					if (noteVisibilitySelect) noteVisibilitySelect.value = 'private';
					if (fsVisibilitySelect) fsVisibilitySelect.value = 'private';
					updateMainFileDisplay(); // 更新主界面的文件列表顯示
					closeFullscreenEditor();
					await refreshNotes();

				} catch (error) {
					showCustomAlert(error.message, 'error');
				} finally {
					fsSaveBtn.disabled = false;
					fsSaveBtn.textContent = t('save');
				}

			} else { // 编辑现有笔记
				const noteElement = notesContainer.querySelector(`.note[data-id="${currentEditingNoteId}"]`);
				if (!noteElement) {
					showCustomAlert('Error: Original note element not found.', 'error');
					return;
				}

				fsSaveBtn.disabled = true;
				fsSaveBtn.textContent = t('saving');
				const formData = new FormData();
				// 1. 添加从全屏编辑器获取的新内容
				formData.append('content', content);
				formData.append('visibility', fsVisibilitySelect?.value || 'private');
				const timestampToggle = document.getElementById('fs-update-timestamp-toggle');
				// 如果勾选了 "Keep Time"，则 shouldUpdate 为 false
				const shouldUpdate = !timestampToggle.checked;
				formData.append('update_timestamp', shouldUpdate.toString());

				// 2. 从原始的 noteElement 中获取文件状态并添加到 formData
				// 获取已标记删除的文件
				const filesToDelete = Array.from(noteElement.querySelectorAll('.edit-file-tag[data-deleted="true"]')).map(t => t.dataset.fileId);
				formData.append('filesToDelete', JSON.stringify(filesToDelete));

				// 获取新添加的文件 (如果用户先添加文件再进入全屏)
				if (noteElement.newFiles && noteElement.newFiles.length > 0) {
					Array.from(noteElement.newFiles).forEach(file => formData.append('file', file));
				}

				try {
					const res = await fetch(`/api/notes/${currentEditingNoteId}`, { method: 'PUT', body: formData });
					if (!res.ok) throw new Error(`Update failed: ${await res.text()}`);

					closeFullscreenEditor();
					await refreshNotes(); // 刷新列表以显示最新内容
				} catch (error) {
					showCustomAlert(error.message, 'error');
				} finally {
					fsSaveBtn.disabled = false;
					fsSaveBtn.textContent = t('save');
				}
			}
		} catch (error) {
			showCustomAlert(error.message, 'error');
		} finally {
			fsSaveBtn.disabled = false;
			fsSaveBtn.textContent = t('save');
		}
	});

	selectFilesBtn.addEventListener('click', () => {
		noteFile.click();
	});
	const colorSchemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

	const getSystemTheme = () => colorSchemeMediaQuery.matches ? 'dark' : 'light';
	const resolveTheme = (pref) => pref === 'system' ? getSystemTheme() : pref;

	const applyTheme = (preference) => {
		themePreference = THEME_OPTIONS.includes(preference) ? preference : 'system';
		const resolvedTheme = resolveTheme(themePreference);

		document.body.dataset.theme = resolvedTheme;
		document.documentElement.dataset.theme = resolvedTheme;
		localStorage.setItem(STORAGE_KEYS.theme, themePreference);

		document.getElementById('hljs-light-theme').disabled = (resolvedTheme === 'dark');
		document.getElementById('hljs-dark-theme').disabled = (resolvedTheme !== 'dark');

		renderThemeToggleLabel(resolvedTheme, themePreference);
		applySettings();
	};

	const toggleTheme = () => {
		const currentIndex = THEME_OPTIONS.indexOf(themePreference);
		const nextPreference = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];
		applyTheme(nextPreference);
	};

	const initializeTheme = () => {
		const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
		if (savedTheme) {
			themePreference = savedTheme;
		}
		applyTheme(themePreference);
	};

	const handleSystemThemeChange = () => {
		if (themePreference === 'system') {
			applyTheme('system');
		}
	};

	if (colorSchemeMediaQuery?.addEventListener) {
		colorSchemeMediaQuery.addEventListener('change', handleSystemThemeChange);
	} else if (colorSchemeMediaQuery?.addListener) {
		// 兼容旧版浏览器
		colorSchemeMediaQuery.addListener(handleSystemThemeChange);
	}

	themeToggleBtn.addEventListener('click', toggleTheme);

	const iconEnterFullWidth = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"></path></svg>';
	const iconExitFullWidth = iconEnterFullWidth;

	function initializeViewMode() {
		appState.isWide = localStorage.getItem('memos-wide-mode') === 'true';
		appState.isWaterfall = localStorage.getItem('memos-waterfall-mode') === 'true';
		applyViewModes();
	}

	function updateEditorVisibility() {
		let shouldShow = false; // 默认隐藏
		// 条件1: 基础模式必须是 'home'
		if (appState.baseMode === 'home') {
			shouldShow = true;
		}
		// 条件2: 如果瀑布流开启，并且设置了“隐藏”，则强制隐藏
		if (appState.isWaterfall && settings.hideEditorInWaterfall) {
			shouldShow = false;
		}
		noteForm.style.display = shouldShow ? 'block' : 'none';
	}

	// --- State ---
	let allNotesCache = [];
	let noteCounter = 1;
	const textFileExtensions = ['txt', 'js', 'json', 'py', 'css', 'html', 'md', 'sh', 'java', 'c', 'cpp', 'go', 'rb', 'xml', 'log', 'yaml', 'toml', 'yml'];
	let currentUser = { isAdmin: false };

	let currentFilter = {
		type: 'all', // 'all', 'date'
		value: null
	};

	// --- Utility Functions ---
	const formatBytes = (b, d = 2) => {
		const units = currentLanguage === 'zh' ? ['字节', 'KB', 'MB', 'GB'] : ['B', 'KB', 'MB', 'GB'];
		if (!b || b === 0) return `0 ${units[0]}`;
		const k = 1024;
		const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), units.length - 1);
		return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${units[i]}`;
	};

	const padTimeUnit = (n) => String(n).padStart(2, '0');

	const formatDateTimeParts = (value) => {
		if (!value) return null;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		return {
			date: `${date.getFullYear()}-${padTimeUnit(date.getMonth() + 1)}-${padTimeUnit(date.getDate())}`,
			time: `${padTimeUnit(date.getHours())}:${padTimeUnit(date.getMinutes())}:${padTimeUnit(date.getSeconds())}`
		};
	};

	const formatDateTime = (value) => {
		const parts = formatDateTimeParts(value);
		if (!parts) return '-';
		return `${parts.date} ${parts.time}`;
	};

	let toastTimer;
	function showToast(message, type = 'success', duration = 3000) {
		const toast = document.getElementById('toast-notification');
		if (!toast) return;

		clearTimeout(toastTimer); // 如果已有提示，则重置计时器

		toast.textContent = translateMessage(message);
		toast.className = ''; // 重置类
		toast.classList.add(`toast-${type}`);

		// 强制触发重绘，以便动画能重新播放
		void toast.offsetWidth;

		toast.classList.add('visible');

		toastTimer = setTimeout(() => {
			toast.classList.remove('visible');
		}, duration);
	}

	async function loadUsersIfAdmin() {
		if (!userManagementSection) return;
		try {
			const res = await fetch('/api/users');
			if (!res.ok) {
				userManagementSection.style.display = 'none';
				currentUser.isAdmin = false;
				return;
			}
			const data = await res.json();
			currentUser.isAdmin = true;
			userManagementSection.style.display = '';
			renderUserTable(data.users || []);
		} catch (error) {
			console.error('Load users failed:', error);
			userManagementSection.style.display = 'none';
			currentUser.isAdmin = false;
		}
	}

	function renderUserTable(users = []) {
		if (!userTableBody) return;
		const yesLabel = translateMessage('Yes');
		const noLabel = translateMessage('No');
		const resetPasswordLabel = translateMessage('Reset Password');
		const changeTgidLabel = translateMessage('Change TGID');
		if (!users.length) {
			userTableBody.innerHTML = `<tr><td colspan="5" class="user-table-empty">${translateMessage('No users.')}</td></tr>`;
			return;
		}
		userTableBody.innerHTML = users.map(user => {
			const createdParts = formatDateTimeParts(user.created_at);
			const createdCell = createdParts ? `<span class="time-date">${createdParts.date}</span><span class="time-time">${createdParts.time}</span>` : formatDateTime(user.created_at);
			const telegram = user.telegram_user_id || '-';
			const adminToggleTitle = translateMessage(user.is_admin ? 'Remove admin' : 'Make admin');
			const adminToggleText = translateMessage(user.is_admin ? 'Revoke Admin' : 'Make Admin');
			return `
				<tr data-user-id="${user.id}">
					<td>${user.username}</td>
					<td class="nowrap-cell admin-cell">${user.is_admin ? yesLabel : noLabel}</td>
					<td class="telegram-cell" data-empty="${telegram === '-' ? 'true' : 'false'}">${telegram}</td>
					<td class="time-cell">${createdCell}</td>
					<td class="actions-cell">
						<div class="user-actions" role="group" aria-label="${translateMessage('Actions')}">
							<button class="user-action btn-accent" data-action="toggle-admin" data-next="${user.is_admin ? 'false' : 'true'}" title="${adminToggleTitle}">${adminToggleText}</button>
							<button class="user-action" data-action="reset-password">${resetPasswordLabel}</button>
							<button class="user-action" data-action="change-telegram">${changeTgidLabel}</button>
							<button class="user-action btn-danger" data-action="delete-user">${translateMessage('Delete')}</button>
						</div>
					</td>
				</tr>
			`;
		}).join('');
	}
	// 1. 创建一个函数来计算并设置单个笔记的行跨度
	const setNoteRowSpan = (noteElement) => {
		const notesContainer = document.getElementById('notes-container');
		if (!notesContainer) return;

		// 获取grid的行间距
		const rowGap = parseFloat(getComputedStyle(notesContainer).getPropertyValue('row-gap'));

		// 获取卡片的实际高度
		const noteHeight = noteElement.getBoundingClientRect().height;

		// 计算需要跨越的行数（基准行高为1px）
		const rowSpan = Math.ceil((noteHeight + rowGap) / (1 + rowGap));
		noteElement.style.gridRowEnd = `span ${rowSpan}`;
	};

	// 当任何被观察的笔记卡片大小发生变化时，它会自动调用我们的设置函数
	const waterfallObserver = new ResizeObserver(entries => {
		// 使用 requestAnimationFrame 来确保我们在浏览器下一次绘制前更新布局，避免抖动
		window.requestAnimationFrame(() => {
			for (let entry of entries) {
				setNoteRowSpan(entry.target);
			}
		});
	});
	function formatTimestamp(timestamp) {
		if (!timestamp) return { relative: '', absolute: '' };
		const date = new Date(Number(timestamp));
		const locale = getLocale();
		const absoluteTime = date.toLocaleString(locale, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		const diffMs = Date.now() - date.getTime();
		const dayMs = 24 * 60 * 60 * 1000;
		if (Math.abs(diffMs) < dayMs) {
			const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
			const diffSeconds = Math.round(-diffMs / 1000);
			if (Math.abs(diffSeconds) < 60) {
				return { relative: rtf.format(diffSeconds, 'second'), absolute: absoluteTime };
			}
			const diffMinutes = Math.round(diffSeconds / 60);
			if (Math.abs(diffMinutes) < 60) {
				return { relative: rtf.format(diffMinutes, 'minute'), absolute: absoluteTime };
			}
			const diffHours = Math.round(diffMinutes / 60);
			return { relative: rtf.format(diffHours, 'hour'), absolute: absoluteTime };
		}
		return { relative: absoluteTime, absolute: absoluteTime };
	}

	// START: 笔记拖拽合并
	const ghostElement = document.getElementById('note-ghost-element');
	let dragState = {
		isMouseDown: false,
		isDragging: false,
		sourceNote: null,
		dragStartX: 0,
		dragStartY: 0,
		dragThreshold: 8
	};

	// 1. 在 mousedown 时，只记录状态，不阻止任何默认行为
	notesContainer.addEventListener('mousedown', (e) => {
		if (e.button !== 0 || e.target.closest('button, a, .edit-area, .note-actions')) {
			return;
		}
		const noteElement = e.target.closest('.note');
		if (!noteElement || noteElement.classList.contains('editing')) return;

		dragState.isMouseDown = true;
		dragState.sourceNote = noteElement;
		dragState.dragStartX = e.clientX;
		dragState.dragStartY = e.clientY;
	});

	// 2. 在 mousemove 中智能判断并启动拖拽
	window.addEventListener('mousemove', (e) => {
		if (!dragState.isMouseDown) return;

		if (dragState.isDragging) {
			ghostElement.style.left = `${e.clientX}px`;
			ghostElement.style.top = `${e.clientY}px`;

			document.querySelectorAll('.note.is-drag-target').forEach(el => el.classList.remove('is-drag-target'));
			const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
			const targetNote = elementBelow ? elementBelow.closest('.note:not(.is-drag-source)') : null;
			if (targetNote) {
				targetNote.classList.add('is-drag-target');
			}
			return;
		}

		const dx = Math.abs(e.clientX - dragState.dragStartX);
		const dy = Math.abs(e.clientY - dragState.dragStartY);

		if (dx > dragState.dragThreshold || dy > dragState.dragThreshold) {
			const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
			if (!dragState.sourceNote.contains(elementBelow)) {
				startDrag(e); // 启动拖拽
			}
		}
	});

	// 3. 在 mouseup 时结束所有操作
	window.addEventListener('mouseup', (e) => {
		if (!dragState.isMouseDown) return;

		if (dragState.isDragging) {
			const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
			const targetNote = elementBelow ? elementBelow.closest('.note.is-drag-target') : null;

			if (targetNote) {
				handleMergeDrop(dragState.sourceNote, targetNote);
			}
		}
		resetDragState();
	});

	// 启动拖拽的辅助函数
	function startDrag(e) {
		if (dragState.isDragging) return;

		e.preventDefault();
		if (window.getSelection) {
			window.getSelection().removeAllRanges();
		}

		dragState.isDragging = true;
		document.body.classList.add('note-dragging-active');
		dragState.sourceNote.classList.add('is-drag-source');

		const rect = dragState.sourceNote.getBoundingClientRect();
		const clonedNote = dragState.sourceNote.cloneNode(true);
		const actionsContainer = clonedNote.querySelector('.note-actions');
		if (actionsContainer) {
			actionsContainer.remove();
		}

		// 4. 将这个被修改过的克隆体的内部 HTML 设置为“幽灵”的内容
		ghostElement.innerHTML = clonedNote.innerHTML;
		ghostElement.className = 'note';
		ghostElement.style.width = `${rect.width}px`;
		ghostElement.style.left = `${e.clientX}px`;
		ghostElement.style.top = `${e.clientY}px`;
		ghostElement.style.display = 'block';
	}

	// 重置所有状态
	function resetDragState() {
		if (dragState.isDragging) {
			document.body.classList.remove('note-dragging-active');
			if (dragState.sourceNote) {
				dragState.sourceNote.classList.remove('is-drag-source');
			}
			document.querySelectorAll('.note.is-drag-target').forEach(el => el.classList.remove('is-drag-target'));
			ghostElement.style.display = 'none';
		}

		dragState.isMouseDown = false;
		dragState.isDragging = false;
		dragState.sourceNote = null;
	}

	// 触发合并操作的函数
	async function handleMergeDrop(sourceElement, targetElement) {
		const sourceId = sourceElement.dataset.id;
		const targetId = targetElement.dataset.id;

		const result = await showMergeConfirm(
			`This will merge Note #${sourceId} and Note #${targetId}. The older note will be merged into the newer one and then deleted.`
		);

		if (!result.confirmed) return;

		try {
			const response = await fetch('/api/notes/merge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sourceNoteId: parseInt(sourceId),
					targetNoteId: parseInt(targetId),
					addSeparator: result.addSeparator
				})
			});

			if (!response.ok) {
				const err = await response.json();
				throw new Error(extractErrorMessage(err, 'Merge failed.'));
			}

			const updatedMergedNote = await response.json();

			showToast('Notes merged successfully!');
			await refreshNotes();

		} catch (error) {
			showToast(`Error: ${error.message}`, 'error');
		}
	}
	// END: 笔记拖拽合并
	/**
	 * 处理 Textarea 中的 Tab 和 Shift+Tab 缩进/取消缩进功能。
	 * 此版本使用 document.execCommand 以确保所有操作都是可撤销的 (undoable)。
	 * @param {KeyboardEvent} event - keydown 事件对象。
	 */
	function handleTabIndentation(event) {
		if (event.key !== 'Tab') {
			return; // 如果不是Tab键，则不执行任何操作
		}

		event.preventDefault(); // 阻止Tab键的默认行为（切换焦点）

		const textarea = event.target;
		const indent = '    '; // 四个空格
		const isShiftPressed = event.shiftKey;

		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const value = textarea.value;

		// 为了使用 execCommand，我们必须确保 textarea 是当前活动的元素
		textarea.focus();

		if (start !== end) {
			// --- 场景1: 有文本被选中 (处理多行) ---

			// 1. 确定需要修改的完整行块的范围
			const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;
			const lastLineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
			const selectedBlock = value.substring(firstLineStart, lastLineEnd);

			let newBlock;
			let changeInLength = 0;

			if (isShiftPressed) {
				// 取消缩进
				newBlock = selectedBlock.split('\n').map(line => {
					if (line.startsWith(indent)) {
						changeInLength -= indent.length;
						return line.substring(indent.length);
					} else if (line.startsWith(' ')) {
						const spacesToRemove = line.match(/^ {1,4}/)[0].length;
						changeInLength -= spacesToRemove;
						return line.substring(spacesToRemove);
					}
					return line;
				}).join('\n');
			} else {
				// 增加缩进
				const lines = selectedBlock.split('\n');
				newBlock = lines.map(line => {
					// 如果最后一行是空的（因为选中到行尾），则不缩进
					if (line.length > 0 || lines.length === 1) {
						changeInLength += indent.length;
						return indent + line;
					}
					return line;
				}).join('\n');
			}

			// 2. 选中需要被替换的整个文本块
			textarea.selectionStart = firstLineStart;
			textarea.selectionEnd = lastLineEnd;

			// 3. 执行可撤销的插入命令，用新块替换选中的旧块
			document.execCommand('insertText', false, newBlock);

			// 4. 恢复用户的选择范围
			textarea.selectionStart = start + (isShiftPressed ? (changeInLength > 0 ? -changeInLength : 0) : indent.length);
			textarea.selectionEnd = end + changeInLength;

		} else {
			// --- 场景2: 没有文本被选中 (处理当前光标行) ---
			if (isShiftPressed) {
				// 取消缩进
				const lineStart = value.lastIndexOf('\n', start - 1) + 1;
				const line = value.substring(lineStart, start);
				const spacesMatch = line.match(/^ {1,4}/);

				if (spacesMatch) {
					const spacesToRemove = spacesMatch[0].length;
					// 选中要删除的空格
					textarea.selectionStart = lineStart;
					textarea.selectionEnd = lineStart + spacesToRemove;
					// 用空字符串替换选中的空格，这是一个可撤销的删除操作
					document.execCommand('insertText', false, '');
				}
			} else {
				// 增加缩进：直接在光标处插入缩进符
				document.execCommand('insertText', false, indent);
			}
		}

		// 手动触发input事件，以便实时预览能够更新
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function autoResizeTextarea(textarea) {
		requestAnimationFrame(() => {
			// 1. 保存当前的滚动位置。这对于长文本非常重要，
			//    可以防止在调整高度时页面发生不必要的跳动。
			const savedScrollTop = textarea.scrollTop;
			// 2. 先将高度重置为'auto'，让浏览器计算出内容所需的最小高度。
			//    这是获取正确 scrollHeight 的关键步骤。
			textarea.style.height = 'auto';
			if (textarea.scrollHeight !== 0) {
				textarea.style.height = `${textarea.scrollHeight + 2}px`;
			}
			// 4. 恢复之前保存的滚动位置，确保用户视口保持稳定。
			textarea.scrollTop = savedScrollTop;
		});
	}

	let load = false;
	const showLoginScreen = () => {
		authContainer.style.display = 'block';
		appContainer.style.display = 'none';
		document.body.classList.add('auth-visible');
	};
	const showAppScreen = () => {
		if (load) return;
		load = true;
		authContainer.style.display = 'none';
		appContainer.style.display = 'block';
		document.body.classList.remove('auth-visible');
		document.getElementById('app-layout-container').classList.add('app-visible');
		// 确保只有在登录成功后才执行这些操作
		initializeCollapsibleSidebars(); // 初始化侧边栏折叠状态
		initializeViewMode(); // 初始化宽屏模式
		updateEditorVisibility();
		loadAndRenderStats();
		loadAndRenderTags();
		loadAndRenderTimeline();
		initializeSettings();
	};

	function showCustomAlert(message, type = 'info') {
		customAlertMessage.textContent = translateMessage(message);
		customAlertBox.dataset.type = type;
		customConfirmBox.classList.remove('active');
		customAlertBox.classList.add('active');
		customModalOverlay.classList.add('visible');
		customAlertOkBtn.focus();
	}

	function showCustomConfirm(message) {
		return new Promise(resolve => {
			customConfirmMessage.textContent = translateMessage(message);
			customAlertBox.classList.remove('active'); // Hide alert box if open
			customConfirmBox.classList.add('active');
			customModalOverlay.classList.add('visible');
			customConfirmCancelBtn.focus();
			// Use { once: true } to automatically remove listeners after they fire
			customConfirmOkBtn.addEventListener('click', () => {
				hideCustomModal();
				resolve(true);
			}, { once: true });
			customConfirmCancelBtn.addEventListener('click', () => {
				hideCustomModal();
				resolve(false);
			}, { once: true });
		});
	}

	function showMergeConfirm(message) {
		return new Promise(resolve => {
			const mergeBox = document.getElementById('merge-confirm-box');
			const messageP = document.getElementById('merge-confirm-message');
			const okBtn = document.getElementById('merge-confirm-ok-btn');
			const cancelBtn = document.getElementById('merge-confirm-cancel-btn');
			const separatorCheckbox = document.getElementById('merge-add-separator');

			messageP.textContent = message;
			customAlertBox.classList.remove('active');
			customConfirmBox.classList.remove('active');
			mergeBox.classList.add('active');
			customModalOverlay.classList.add('visible');

			cancelBtn.focus();

			const onOkClick = () => {
				hideCustomModal();
				resolve({
					confirmed: true,
					addSeparator: separatorCheckbox.checked
				});
			};

			const onCancelClick = () => {
				hideCustomModal();
				resolve({ confirmed: false });
			};

			okBtn.addEventListener('click', onOkClick, { once: true });
			cancelBtn.addEventListener('click', onCancelClick, { once: true });
		});
	}
	function hideCustomModal() {
		customModalOverlay.classList.remove('visible');
		customAlertBox.classList.remove('active');
		customConfirmBox.classList.remove('active');
		document.getElementById('merge-confirm-box').classList.remove('active');
		setTimeout(() => {
			customAlertMessage.textContent = '';
			customConfirmMessage.textContent = '';
		}, 300);
	}

	customAlertOkBtn.addEventListener('click', hideCustomModal);
	customModalOverlay.addEventListener('click', (e) => {
		if (e.target === customModalOverlay) {
			if (customConfirmBox.classList.contains('active')) {
				customConfirmCancelBtn.click(); // Programmatically click cancel
			} else {
				hideCustomModal();
			}
		}
	});

	// --- Event Handlers ---
	insertImageBtn.addEventListener('click', () => {
		const url = prompt('请输入图片链接 (URL):', 'https://');

		// 检查用户是否输入了链接 (没有取消或留空)
		if (url && url.trim() !== 'https://' && url.trim() !== '') {
			const markdownImage = `![](${url})`;
			insertTextAtCursor(noteInput, markdownImage);
		}
	});

	/**
	 * 插入代码块
	 */
	/*	insertCodeBtn.addEventListener('click', () => {
			const textarea = noteInput;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const selectedText = textarea.value.substring(start, end);
	
			let code = '```';
			const textBefore = `${code}\n`;
			const textAfter = `\n${code}`;
	
			// 使用 setRangeText 来插入文本并能更好地控制光标
			textarea.setRangeText(textBefore + selectedText + textAfter, start, end);
	
			textarea.focus();
			textarea.selectionStart = start + textBefore.length;
			textarea.selectionEnd = start + textBefore.length + selectedText.length;
			// 手动触发 input 事件，以便实时预览能够更新
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
		});*/

	/**
	 * 应用一个主题色，并更新所有相关的UI
	 */
	function applyThemeColor(hexColor, isCustom = false) {
		// 简单的颜色格式验证
		if (!/^#[0-9a-f]{6}$/i.test(hexColor)) return;

		let primaryColor = hexColor;
		let hoverColor;

		// 将 HEX 转换为 R, G, B 并设置到新的 CSS 变量中
		if (/^#[0-9a-f]{6}$/i.test(primaryColor)) {
			let r = parseInt(primaryColor.slice(1, 3), 16);
			let g = parseInt(primaryColor.slice(3, 5), 16);
			let b = parseInt(primaryColor.slice(5, 7), 16);
			document.documentElement.style.setProperty('--primary-color-rgb', `${r}, ${g}, ${b}`);
		}

		// 1. 计算悬停颜色 (如果颜色是预设的，直接用；如果是自定义的，智能地变暗)
		const predefinedTheme = themeColors.find(t => t.color === hexColor);
		if (predefinedTheme) {
			hoverColor = predefinedTheme.hover;
		} else {
			// 智能计算 hover 颜色：将原色变暗 15%
			// 这是通过将颜色分解为R,G,B，分别乘以0.85，再合成为十六进制实现的
			let r = parseInt(hexColor.slice(1, 3), 16);
			let g = parseInt(hexColor.slice(3, 5), 16);
			let b = parseInt(hexColor.slice(5, 7), 16);
			r = Math.floor(r * 0.85).toString(16).padStart(2, '0');
			g = Math.floor(g * 0.85).toString(16).padStart(2, '0');
			b = Math.floor(b * 0.85).toString(16).padStart(2, '0');
			hoverColor = `#${r}${g}${b}`;
		}

		// 2. 应用 CSS 变量
		document.documentElement.style.setProperty('--primary-color', primaryColor);
		document.documentElement.style.setProperty('--primary-hover', hoverColor);

		// 3. 更新 UI 状态
		// 如果是预设颜色，高亮对应的圆形按钮；否则取消所有高亮
		colorPalette.querySelectorAll('.color-swatch').forEach(swatch => {
			swatch.classList.toggle('active', swatch.dataset.color === hexColor);
		});

		// 实时更新自定义颜色选择器的预览和输入框
		colorPickerPreview.style.backgroundColor = primaryColor;
		// 只有在输入框当前值不等于新值时才更新，避免光标跳动
		if (hexColorInput.value.toLowerCase() !== primaryColor) {
			hexColorInput.value = primaryColor;
		}
		// 同步隐藏的 <input type="color">
		colorPickerInput.value = primaryColor;

		// 4. 保存到本地存储
		localStorage.setItem('memos-theme-color', primaryColor);
	}

	function initializeThemeColor() {
		colorPalette.innerHTML = themeColors.map(theme =>
			`<button class='color-swatch' data-color='${theme.color}' title='${theme.name}' style='background-color: ${theme.color};'></button>`
		).join('');
		const savedColor = localStorage.getItem('memos-theme-color') || themeColors[0].color;
		applyThemeColor(savedColor);
	}

	// 事件监听：点击“自定义颜色”标签时，触发隐藏的颜色选择器
	colorPickerLabel.addEventListener('click', () => {
		colorPickerInput.click();
	});

	// 事件监听：当HTML5颜色选择器的值改变时 (用户关闭调色板后)
	colorPickerInput.addEventListener('input', (e) => {
		applyThemeColor(e.target.value, true);
	});

	// 事件监听：当手动输入十六进制颜色时
	hexColorInput.addEventListener('input', (e) => {
		const rawValue = e.target.value;
		if (/^#[0-9a-f]{6}$/i.test(rawValue)) {
			applyThemeColor(rawValue, true);
		}
	});

	// 事件监听：在颜色面板内点击一个颜色
	colorPalette.addEventListener('click', (e) => {
		const swatch = e.target.closest('.color-swatch');
		if (swatch) {
			const color = swatch.dataset.color;
			applyThemeColor(color);
		}
	});

	// 事件监听：点击页面其他任何地方，关闭面板
	document.addEventListener('click', (e) => {
		if (fsColorPopover.classList.contains('visible') && !fsColorPickerWrapper.contains(e.target)) {
			fsColorPopover.classList.remove('visible');
		}
		if (!moreActionsContainer.contains(e.target)) {
			// 并且菜单当前是固定的
			if (isMenuPinned) {
				isMenuPinned = false; // 取消固定
				moreMenuPopover.classList.remove('visible'); // 关闭菜单
			}
		}
		if (isTagDropdownOpen && !tagDropdown.contains(e.target) && e.target !== insertTagBtn) {
			closeTagDropdown();
		}
		if (!themeColorPopover.contains(e.target) && !themeColorBtn.contains(e.target)) {
			themeColorPopover.classList.remove('visible');
		}
		// 检查菜单是否可见，以及点击的目标是否在菜单内部或是否是“更多”按钮
		// if (
		// 	waterfallPopoverMenu.classList.contains('visible') &&
		// 	!waterfallPopoverMenu.contains(e.target) &&
		// 	!e.target.closest('.waterfall-more-btn')
		// ) {
		// 	hideWaterfallPopover();
		// }
	});

	// --- 返回顶部 ---
	const scrollThreshold = 300;
	// 监听窗口滚动事件
	window.addEventListener('scroll', () => {
		if (window.scrollY > scrollThreshold) {
			backToTopBtn.classList.add('visible');
		} else {
			backToTopBtn.classList.remove('visible');
		}
	});

	backToTopBtn.addEventListener('click', () => {
		window.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
	});

	let allTagsCache = [];
	let isTagDropdownOpen = false;
	// 渲染标签列表到下拉框
	function renderTagList(filter = '') {
		const lowerCaseFilter = filter.toLowerCase();
		const filteredTags = allTagsCache.filter(tag => tag.name.toLowerCase().includes(lowerCaseFilter));

		tagDropdownList.innerHTML = '';

		if (filteredTags.length === 0) {
			const li = document.createElement('li');
			li.className = 'no-results';
			li.textContent = filter ? translateMessage('No tags found') : translateMessage('No tags yet.');
			tagDropdownList.appendChild(li);
			return;
		}

		filteredTags.forEach(tag => {
			const li = document.createElement('li');
			li.textContent = `#${tag.name}`;
			li.dataset.tagName = tag.name;
			tagDropdownList.appendChild(li);
		});
	}

	// 打开下拉框并获取标签
	async function openTagDropdown() {
		if (isTagDropdownOpen) return;

		tagDropdown.style.display = 'block';
		isTagDropdownOpen = true;
		tagSearchInput.focus();
		if (allTagsCache.length === 0) {
			try {
				const response = await fetch('/api/tags');
				if (!response.ok) throw new Error('Failed to fetch tags');
				allTagsCache = await response.json();
			} catch (error) {
				console.error(error);
				allTagsCache = []; // 出错时清空
			}
		}

		renderTagList();
	}

	// 关闭下拉框
	function closeTagDropdown() {
		if (!isTagDropdownOpen) return;
		tagDropdown.style.display = 'none';
		isTagDropdownOpen = false;
		tagSearchInput.value = ''; // 清空搜索框
	}

	// 按钮点击事件：切换下拉框的显示/隐藏
	insertTagBtn.addEventListener('click', (e) => {
		e.stopPropagation(); // 阻止事件冒泡到 document
		if (isTagDropdownOpen) {
			closeTagDropdown();
		} else {
			openTagDropdown();
		}
	});

	// 搜索框输入事件：实时过滤列表
	tagSearchInput.addEventListener('input', () => {
		renderTagList(tagSearchInput.value);
	});

	// 列表点击事件：选择标签并插入
	tagDropdownList.addEventListener('click', (e) => {
		if (e.target && e.target.nodeName === 'LI' && e.target.dataset.tagName) {
			const tagName = e.target.dataset.tagName;
			// 在光标处插入 "#标签名 " (注意末尾的空格，方便继续输入)
			insertTextAtCursor(noteInput, `#${tagName} `);
			closeTagDropdown();
		}
	});


	loginForm.addEventListener('submit', async e => {
		e.preventDefault();
		const btn = document.getElementById('login-btn');
		const err = document.getElementById('login-error');
		btn.disabled = true;
		btn.textContent = t('loggingIn');
		err.textContent = '';
		try {
			const res = await fetch('/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: username.value, password: password.value })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(extractErrorMessage(data, 'Invalid username or password.'));
			currentUser.isAdmin = !!data.user?.isAdmin;
			await loadUsersIfAdmin();
			initializeApp();
		} catch (error) {
			err.textContent = translateMessage(error.message);
		} finally {
			btn.disabled = false;
			btn.textContent = t('login');
		}
	});

	logoutBtn.addEventListener('click', async () => {
		try {
			await fetch('/api/logout', { method: 'POST' });
		} finally {
			window.location.reload();
		}
	});

	if (createUserForm) {
		createUserForm.addEventListener('submit', async e => {
			e.preventDefault();
			try {
				const payload = {
					username: newUsernameInput.value.trim(),
					password: newPasswordInput.value,
					isAdmin: newIsAdminCheckbox.checked,
					telegram_user_id: newTelegramInput.value.trim() || undefined,
				};
				if (!payload.username || !payload.password) {
					showCustomAlert('Username and password are required.', 'error');
					return;
				}
				const res = await fetch('/api/users', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				const data = await res.json();
				if (!res.ok) {
					throw new Error(extractErrorMessage(data, 'Failed to create user'));
				}
				showToast('User created');
				createUserForm.reset();
				await loadUsersIfAdmin();
			} catch (error) {
				showCustomAlert(error.message, 'error');
			}
		});
	}

	if (userTableBody) {
		userTableBody.addEventListener('click', async e => {
			const actionBtn = e.target.closest('.user-action');
			if (!actionBtn) return;
			const row = actionBtn.closest('tr');
			const userId = row?.dataset.userId;
			if (!userId) return;
			const action = actionBtn.dataset.action;
			try {
				if (action === 'toggle-admin') {
					const next = actionBtn.dataset.next === 'true';
					const res = await fetch(`/api/users/${userId}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ is_admin: next }),
					});
					const data = await res.json();
					if (!res.ok) throw new Error(extractErrorMessage(data, 'Failed to update admin flag'));
					showToast('User updated');
				} else if (action === 'reset-password') {
					const newPwd = prompt(translateMessage('Enter new password:'));
					if (!newPwd) return;
					const res = await fetch(`/api/users/${userId}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ password: newPwd }),
					});
					const data = await res.json();
					if (!res.ok) throw new Error(extractErrorMessage(data, 'Failed to reset password'));
					showToast('Password reset');
				} else if (action === 'change-telegram') {
					const currentTgid = row?.querySelector('.telegram-cell')?.textContent?.trim() || '';
					const promptLabel = translateMessage('Enter new Telegram User ID:');
					const nextTgid = prompt(promptLabel, currentTgid === '-' ? '' : currentTgid);
					if (nextTgid === null) return;
					const trimmed = nextTgid.trim();
					const res = await fetch(`/api/users/${userId}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ telegram_user_id: trimmed || null }),
					});
					const data = await res.json();
					if (!res.ok) throw new Error(extractErrorMessage(data, 'Failed to update Telegram ID'));
					showToast('User updated');
				} else if (action === 'delete-user') {
					const confirmed = await showCustomConfirm('Delete this user?');
					if (!confirmed) return;
					const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
					const data = await res.json();
					if (!res.ok) throw new Error(extractErrorMessage(data, 'Failed to delete user'));
					showToast('User deleted', 'info');
				}
				await loadUsersIfAdmin();
			} catch (error) {
				showCustomAlert(error.message, 'error');
			}
		});
	}

	async function fetchNotes(page = 1) {
		if (appState.pagination.isLoading) return;
		appState.pagination.isLoading = true;
		const isAppending = page > 1;
		const currentLoader = isAppending ? scrollLoader : refreshLoader;
		if (isAppending) {
			currentLoader.textContent = t('loadingMore');
		}
		currentLoader.style.display = isAppending ? 'block' : 'flex';
		try {
			const url = new URL(window.location.origin + '/api/notes');
			// 1. 添加分页
			url.searchParams.set('page', page);
			// 2. 添加所有共存的筛选条件
			if (appState.filters.query) {
				url.pathname = '/api/search'; // 切换到搜索 API
				url.searchParams.set('q', appState.filters.query);
			}
			if (appState.filters.tag) {
				url.searchParams.set('tag', appState.filters.tag);
			}
			if (appState.filters.date) {
				url.searchParams.set('startTimestamp', appState.filters.date.startTimestamp);
				url.searchParams.set('endTimestamp', appState.filters.date.endTimestamp);
			}
			if (appState.baseMode === 'favorites') {
				url.searchParams.set('favorites', 'true');
			}
			if (appState.baseMode === 'archive') {
				url.searchParams.set('archived', 'true');
			}

			const response = await fetch(url.toString());
			if (response.status === 401) {
				showLoginScreen();
				return;
			}
			if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
			showAppScreen();
			const data = await response.json();
			if (!isAppending) {
				allNotesCache = [];
				notesContainer.innerHTML = '';
			}
			allNotesCache.push(...data.notes);
			renderNotes(data.notes);
			appState.pagination.hasMore = data.hasMore;
			appState.pagination.currentPage = page;

			if (appState.pagination.hasMore) {
				scrollLoader.style.display = 'none';
			} else {
				if (allNotesCache.length > 0) {
					scrollLoader.textContent = t('noMoreNotes');
					scrollLoader.style.display = 'block';
				} else {
					notesContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1rem 0;">${t('nothingHere')}</div>`;
					scrollLoader.style.display = 'none';
				}
			}
		} catch (error) {
			currentLoader.textContent = translateMessage(`Failed to load: ${error.message}`);
		} finally {
			appState.pagination.isLoading = false;
			refreshLoader.style.display = 'none';

			const initialLoader = document.getElementById('initial-loader');
			if (initialLoader && initialLoader.style.display !== 'none') {
				initialLoader.style.opacity = '0';
				setTimeout(() => {
					initialLoader.style.display = 'none';
				}, 200);
			}
		}
	}

	// --- 统一的入口函数，用于在状态改变后重新加载数据 ---
	function reloadNotes() {
		// 任何筛选条件的改变都应该从第一页开始
		appState.pagination.currentPage = 1;
		appState.pagination.hasMore = true;
		noteCounter = 1;
		window.scrollTo({ top: 0, behavior: 'auto' });
		fetchNotes(1);
	}

	function createNoteElement(note) {
		let isLongContent = false;
		if (settings.enableContentTruncation) {
			isLongContent = note.content.length > NOTE_TRUNCATE_LENGTH;
		}

		const noteElement = document.createElement('div');
		noteElement.className = 'note';

		if (isLongContent) {
			noteElement.classList.add('is-long');
		}
		const noteId = note.id;
		noteElement.dataset.id = noteId;
		noteElement.dataset.visibility = note.visibility || 'private';
		const time = formatTimestamp(note.updated_at);
		const visibilityBadgeLabel = translateVisibility(note.visibility);
		const visibilityOptionsHtml = ['private', 'users', 'public'].map(opt => {
			const selected = note.visibility === opt ? 'selected' : '';
			return `<option value="${opt}" ${selected}>${translateVisibility(opt)}</option>`;
		}).join('');
		const timestampHint = translateMessage('If checked, the note\'s timestamp will not be updated upon saving.');
		let editedIndicatorHtml = '';
		// if (note.updated_at !== note.created_at) {
		// 	const editedTime = formatTimestamp(note.updated_at);
		// 	editedIndicatorHtml = ` ·&nbsp;<span class="note-edited-indicator" title="Edited at: ${editedTime.absolute}">edited</span>`;
		// }
		const pinnedIconHTML = note.is_pinned ? `
				<button class='unpin-btn icon-btn pinned' title='${translateMessage('Unpin')}'>
						<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' stroke-width='2' stroke='currentColor' fill='currentColor' stroke-linecap='round' stroke-linejoin='round'>
								<path stroke='none' d='M0 0h24v24H0z' fill='none'></path>
								<path d='M9 4v6l-2 4v2h10v-2l-2 -4v-6'></path>
								<line x1='12' y1='16' x2='12' y2='21'></line>
								<line x1='8' y1='4' x2='16' y2='4'></line>
						</svg>
				</button>
		` : '';
		let attachmentsHTML = '';
		if (note.files && note.files.length > 0) {
			attachmentsHTML += '<div class="attachments-grid">';
			note.files.forEach(file => {
				const isTelegramDoc = file.type === 'telegram_document';
				const fileUrl = isTelegramDoc ? `/api/tg-media-proxy/${file.file_id || file.id}` : `/api/files/${noteId}/${file.id}`;
				const shareButtonHTML = isTelegramDoc ? '' : `
	            <button class="share-file-btn icon-btn" title="${t('getPublicLink')}" data-note-id="${noteId}" data-file-id="${file.id}">
	                <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3z"/></svg>
	            </button>
	        `;
				const deleteButtonHTML = `
							<button class="delete-file-btn icon-btn" title="${translateMessage('Delete file')}" data-note-id="${noteId}" data-file-id="${file.id}">
							<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg>
							</button>
						`;

				if (file.type?.startsWith('image/')) {
					// 对于图片，将按钮放在一个容器里
					attachmentsHTML += `<div class='attachment-img'>
								<img class='note-image-attachment' loading='lazy' src='${fileUrl}' alt='${file.name}' style='cursor: zoom-in;'>
								${shareButtonHTML}
								${deleteButtonHTML}
							</div>`;
				} else {
					// 对于普通文件，直接在链接内部添加按钮
					attachmentsHTML += `<a href='${fileUrl}' class='attachment-link' ${isTelegramDoc ? "" : `download='${file.name}'`} target='_blank' rel='noopener noreferrer'>
								<span class='file-name'>${file.name}</span>
								<span class='file-size'>${formatBytes(file.size)}</span>
								${shareButtonHTML}
								${deleteButtonHTML}
							</a>`;
				}
			});
			attachmentsHTML += '</div>';
		}

		let index = '';
		// if (appState.isWaterfall) {
		// 	index = `#${noteCounter++} ・`
		// }
		noteElement.innerHTML = `
										<div class='note-header'>
										<div class='note-meta'> ${index}
											<span title='${time.absolute}'>${time.relative}</span>
											<span class='note-visibility-badge'>${visibilityBadgeLabel}</span>
											${editedIndicatorHtml}
										</div>
											<div class='note-actions view-mode'>
													${pinnedIconHTML}
													<button class='edit icon-btn' title='${translateMessage('Edit')}'>
															<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'><path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'></path></svg>
													</button>
													<button class='more-actions-btn icon-btn' title='${translateMessage('More actions')}'>
															 <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
													</button>
											</div>
<!--											<button class='waterfall-more-btn icon-btn' title='More options'>-->
<!--													<svg xmlns='http://www.w3.org/2000/svg' height='24px' viewBox='0 0 24 24' width='24px' fill='currentColor'><path d='M0 0h24v24H0V0z' fill='none'/><path d='M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z'/></svg>-->
<!--											</button>-->
												<div class='edit-actions edit-mode'>
														<label class="timestamp-toggle-label" title="${timestampHint}">
																<input type="checkbox" class="update-timestamp-toggle" checked>
																<span>${translateMessage('Keep Time')}</span>
														</label>
														<select class="edit-visibility-select visibility-select" title="${translateMessage('Visibility')}">
															${visibilityOptionsHtml}
														</select>
														<label class='icon-btn' title='${translateMessage('Add files')}'>
																<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'><path d='M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z'></path></svg>
																<input type='file' class='edit-file-input' multiple style='display:none;'>
														</label>
													<button class='md-preview-toggle-btn icon-btn' title='${t('togglePreview')}'>
															<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' stroke-width='2' stroke='currentColor' fill='none' stroke-linecap='round' stroke-linejoin='round'><path stroke='none' d='M0 0h24v24H0z' fill='none'/><circle cx='12' cy='12' r='2' /><path d='M22 12c-2.667 4.667 -6 7 -10 7s-7.333 -2.333 -10 -7c2.667 -4.667 6 -7 10 -7s7.333 2.333 10 7' /></svg>
													</button>
													<button class='md-split-toggle-btn icon-btn' title='${t('toggleSplit')}' style='display: none;'>
															<svg xmlns='http://www.w3.org/2000/svg' height='24px' viewBox='0 0 24 24' width='24px' fill='currentColor'><path d='M0 0h24v24H0V0z' fill='none'></path><path d='M3 15h8v-2H3v2zm0 4h8v-2H3v2zm0-8h8V9H3v2zm0-6v2h8V5H3zm10 0h8v14h-8V5z'></path></svg>
													</button>
													<button class='fullscreen-edit icon-btn' title='${translateMessage('Fullscreen Edit')}'>
															<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'><path d='M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'></path></svg>
													</button>
													<button class='save-edit icon-btn btn-accent' title='${t('save')}'>
															<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'><path d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z'></path></svg>
													</button>
													<button class='cancel-edit icon-btn' title='${translateMessage('Cancel')}'>
															<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'><path d='M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z'></path></svg>
													</button>
											</div>
									</div>
									<div class='note-content view-mode'></div>
									${attachmentsHTML}
    							<button class='toggle-content-btn'>${t('showMore')}</button>
									<div class='edit-area edit-mode'>
											<textarea class='edit-textarea' placeholder='${t('notePlaceholder')}'></textarea>
											<div class='edit-preview note-content'></div>
									</div>

									<div class='edit-files-container'></div>
							`;
		noteElement.querySelector('.note-content').innerHTML = postProcessMarkdownHtml(marked.parse(note.content));

		if (isLongContent) {
			noteElement.querySelector('.note-content.view-mode').classList.add('truncated');
		}
		noteElement.querySelector('.edit-textarea').value = note.content;

		return noteElement;
	}

	function renderNotes(notes) {
		const fragment = document.createDocumentFragment();
		if (!settings.enableDateGrouping || appState.isWaterfall) {
			notes.forEach(note => {
				const noteElement = createNoteElement(note);
				fragment.appendChild(noteElement);
				if (appState.isWaterfall) {
					waterfallObserver.observe(noteElement);
				}
			});
		} else {
			const pinnedNotes = notes.filter(note => note.is_pinned);
			const regularNotes = notes.filter(note => !note.is_pinned);

			// 如果存在置顶笔记，则创建并渲染置顶区域
			if (pinnedNotes.length > 0) {
				const pinnedContainer = document.createElement('div');
				pinnedContainer.className = 'pinned-notes-container';

				// 为置顶区域添加一个标题/分隔符
				const pinnedHeader = document.createElement('div');
				pinnedHeader.className = 'pinned-section-header';
				pinnedHeader.textContent = t('pinned');
				pinnedContainer.appendChild(pinnedHeader);

				// 循环渲染所有置顶笔记
				pinnedNotes.forEach(note => {
					const noteElement = createNoteElement(note);
					pinnedContainer.appendChild(noteElement);
				});

				// 将整个置顶区域添加到主文档片段中
				fragment.appendChild(pinnedContainer);
			}

			const dateFormatter = new Intl.DateTimeFormat('en-CA', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			});

			const notesByDate = new Map();
			regularNotes.forEach(note => {
				const dateKey = dateFormatter.format(new Date(note.updated_at));
				if (!notesByDate.has(dateKey)) {
					notesByDate.set(dateKey, []);
				}
				notesByDate.get(dateKey).push(note);
			});

			const sortedDates = Array.from(notesByDate.keys()).sort((a, b) => new Date(b) - new Date(a));

			sortedDates.forEach(dateKey => {
				const dateNotes = notesByDate.get(dateKey);

				const groupEl = document.createElement('div');
				groupEl.className = 'date-group';

				const headerEl = document.createElement('div');
				headerEl.className = 'date-group-header';
				headerEl.innerHTML = `
            <div class="date-divider">
                <span class="line"></span>
                <svg class="toggle-icon expanded" width="24" height="24" viewBox='0 0 1024 1024' xmlns="http://www.w3.org/2000/svg" p-id="4990">
                        <path d="M832 288l-320 448-320-448z" fill="currentColor" p-id="4991" />
                </svg>
                <span class="date-label">${dateKey}</span>
                <span class="line"></span>
            </div>
        `;

				const contentEl = document.createElement('div');
				contentEl.className = 'date-group-content';

				dateNotes.forEach(note => {
					const noteElement = createNoteElement(note);
					contentEl.appendChild(noteElement);
				});

				groupEl.appendChild(headerEl);
				groupEl.appendChild(contentEl);
				fragment.appendChild(groupEl);
			});
		}
		notesContainer.appendChild(fragment);
	}

	function reRenderCachedNotes() {
		notesContainer.innerHTML = '';
		noteCounter = 1;
		renderNotes(allNotesCache);
	}

	// --- Main Form and File Handling ---
	const updateMainFileDisplay = () => {
		fileListDisplay.innerHTML = '';
		Array.from(noteFile.files).filter(file => !file.type.startsWith('image/')).forEach(file => {
			const fileTag = document.createElement('div');
			fileTag.className = 'file-tag-item';
			fileTag.textContent = file.name;
			// 将文件名存储在 data 属性中，以便之后识别
			fileTag.dataset.filename = file.name;

			const removeBtn = document.createElement('button');
			removeBtn.type = 'button'; // 防止触发表单提交
			removeBtn.className = 'remove-file-main-btn';
			removeBtn.innerHTML = '&times;';

			fileTag.appendChild(removeBtn);
			fileListDisplay.appendChild(fileTag);
		});
	};
	noteFile.addEventListener('change', async () => {
		// 1. 上传图片并插入 Markdown
		await handleImageUploadAndInsert(noteFile.files, noteInput);
		// 2. 更新附件列表（只显示非图片文件）
		updateMainFileDisplay();
	});

	fileListDisplay.addEventListener('click', e => {
		// 仅当点击的是移除按钮时执行
		if (e.target.classList.contains('remove-file-main-btn')) {
			const fileTag = e.target.closest('.file-tag-item');
			const fileNameToRemove = fileTag.dataset.filename;

			// FileList 是不可变的，需要用 DataTransfer 来创建一个新的 FileList
			const dt = new DataTransfer();
			const currentFiles = Array.from(noteFile.files);

			// 遍历当前文件，只添加那些我们不想移除的文件
			for (const file of currentFiles) {
				if (file.name !== fileNameToRemove) {
					dt.items.add(file);
				}
			}
			// 将更新后的文件列表赋值回 input 元素
			noteFile.files = dt.files;
			// 重新渲染文件列表显示
			updateMainFileDisplay();
		}
	});
	['dragover', 'dragleave', 'drop'].forEach(ev => noteForm.addEventListener(ev, e => {
		e.preventDefault();
		e.stopPropagation();
	}));
	noteForm.addEventListener('dragover', () => noteForm.classList.add('dragover'));
	noteForm.addEventListener('dragleave', () => noteForm.classList.remove('dragover'));
	noteForm.addEventListener('drop', async e => {
		noteForm.classList.remove('dragover');
		if (e.dataTransfer.files.length > 0) {
			await handleImageUploadAndInsert(e.dataTransfer.files, noteInput);

			noteFile.files = e.dataTransfer.files;
			updateMainFileDisplay();
		}
	});

	// 实时更新主预览区内容
	noteInput.addEventListener('input', e => {
		mainEditPreview.innerHTML = postProcessMarkdownHtml(marked.parse(noteInput.value || ''));
		// autoResizeTextarea(noteInput);
		syncMainEditorLayout();
	});

	// 点击按钮切换模式
	mainPreviewToggleBtn.addEventListener('click', () => {
		noteForm.classList.toggle('preview-mode');
		const isPreview = noteForm.classList.contains('preview-mode');
		mainPreviewToggleBtn.classList.toggle('active', isPreview);

		if (isPreview) {
			// 在切换到预览时，确保内容是最新的
			mainEditPreview.innerHTML = postProcessMarkdownHtml(marked.parse(noteInput.value || ''));
		} else {
			noteInput.focus();
		}
	});

	mainSplitToggleBtn.addEventListener('click', () => {
		const isExitingSplitMode = noteForm.classList.contains('split-mode');
		noteForm.classList.toggle('split-mode');
		mainSplitToggleBtn.classList.toggle('active');
		if (isExitingSplitMode) {
			noteInput.style.transition = 'none';
			syncMainEditorLayout();
			setTimeout(() => {
				noteInput.style.transition = '';
			}, 0);
		} else {
			syncMainEditorLayout();
		}
	});

	function handleEditorLayout() {
		const editorWidth = noteForm.offsetWidth;
		const isWide = editorWidth > 1000;

		if (isWide) {
			mainPreviewToggleBtn.style.display = 'none';
			mainSplitToggleBtn.style.display = 'inline-flex'; // 或者 'block'
		} else {
			mainPreviewToggleBtn.style.display = 'inline-flex';
			mainSplitToggleBtn.style.display = 'none';
		}

		// 如果窗口从宽变窄，但之前处于分栏模式，则必须强制退出
		if (!isWide && noteForm.classList.contains('split-mode')) {
			noteForm.classList.remove('split-mode');
			mainSplitToggleBtn.classList.remove('active');
		}
		// 如果窗口从窄变宽，但之前处于预览模式，则强制退出
		if (isWide && noteForm.classList.contains('preview-mode')) {
			noteForm.classList.remove('preview-mode');
			mainPreviewToggleBtn.classList.remove('active');
		}
	}


	// 手动在 textarea 中插入文本
	function insertTextAtCursor(textarea, text) {
		textarea.focus(); // 确保命令在正确的元素上执行
		document.execCommand('insertText', false, text);
		// execCommand 会自动处理光标位置
		// 手动触发 input 事件，以便实时预览等依赖 input 事件的逻辑能够更新
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function convertTableRowElementToMarkdown(tableRowEl, rowNumber) {
		const cells = [];
		const cellEls = tableRowEl.children;
		// 使用 Array.from 进行更现代的遍历
		Array.from(cellEls).forEach(cell => {
			// 清理单元格内容并处理链接
			let cellContent = cell.innerText.trim();
			const link = cell.querySelector('a');
			if (link) {
				cellContent = `[${cellContent}](${link.href})`;
			}
			cells.push(cellContent);
		});

		let row = `| ${cells.join(' | ')} |`;

		if (rowNumber === 0) {
			row += '\n' + createMarkdownDividerRow(cellEls.length);
		}

		return row;
	}

	function createMarkdownDividerRow(cellCount) {
		const dividerCells = Array(cellCount).fill('---');
		return `| ${dividerCells.join(' | ')} |`;
	}

	// --- 核心代码结束 ---
	// --- 智能粘贴逻辑 (使用 Turndown.js) ---
	// 1. 在全局作用域初始化 Turndown 服务，并进行一些推荐配置
	//    检查 TurndownService 是否存在，以防 CDN 加载失败
	const turndownService = typeof TurndownService === 'function'
		? new TurndownService({
			headingStyle: 'atx',      // 标题样式使用 '#' (e.g., ## My Heading)
			codeBlockStyle: 'fenced',
			bulletListMarker: '-',    // 无序列表使用 '-'
			emDelimiter: '*'          // 斜体使用 '*'
		})
		: null;
	if (turndownService) {
		// 使用 .addRule() 来教 Turndown 如何处理 <table> 标签
		turndownService.addRule('customTableRule', {
			// 过滤器：告诉 Turndown 这条规则只应用于 'table' 标签
			filter: 'table',
			// 替换函数：当遇到 <table> 时，调用这个函数来生成 Markdown
			replacement: function (content, node) {
				const rows = [];
				// node 参数就是当前的 <table> DOM 元素
				const trEls = Array.from(node.querySelectorAll('tr'));

				for (let i = 0; i < trEls.length; i++) {
					const markdownRow = convertTableRowElementToMarkdown(trEls[i], i);
					rows.push(markdownRow);
				}
				// 在生成的表格前后添加换行符，确保它与其他 Markdown 内容正确分隔
				return '\n\n' + rows.join('\n') + '\n\n';
			}
		});
		turndownService.addRule('lineBreakRule', {
			filter: ['div', 'p'],
			replacement: function (content) {
				// 如果内容不为空，则在内容后添加一个换行符。
				// 这将保留从代码编辑器复制时的换行，但不会添加额外的空行。
				return content.trim() ? content + '\n' : '';
			}
		});
	}

	// 2. 粘贴事件处理函数
	function handleSmartPaste(event) {
		// 确保只在 textarea 元素中生效，并且 Turndown 库已成功加载
		const textarea = event.target;
		if (!textarea.matches('textarea') || !turndownService) {
			return;
		}

		const clipboardData = event.clipboardData || window.clipboardData;
		const pastedHtml = clipboardData.getData('text/html');
		const pastedText = clipboardData.getData('text/plain');

		// 关键条件：
		// 1. 剪贴板中必须明确包含 HTML 内容。
		// 2. 如果 HTML 内容和纯文本内容完全一样（例如从 VS Code 等纯文本编辑器复制），
		//    则不进行转换，直接使用浏览器默认的粘贴行为。
		if (pastedHtml && pastedHtml.length > 0 && pastedHtml !== pastedText) {

			// 阻止浏览器默认的、会丢失格式的粘贴行为
			event.preventDefault();
			const markdown = turndownService.turndown(pastedHtml);
			// 将转换后的 Markdown 插入到当前光标所在的位置
			insertTextAtCursor(textarea, markdown);
		}
		// 如果不满足以上条件，则不执行任何操作，让浏览器执行默认的纯文本粘贴。
	}

	function handleGlobalPaste(event) {
		// 确保粘贴的目标是一个 textarea
		const textarea = event.target;
		if (!textarea.matches('textarea')) {
			return;
		}

		const clipboardData = event.clipboardData || window.clipboardData;
		if (!clipboardData) return;

		// --- 优先级 1: 检查并处理图片文件 ---
		const imageFile = Array.from(clipboardData.files).find(file => file.type.startsWith('image/'));
		if (imageFile) {
			event.preventDefault();
			handlePastedImage(imageFile, textarea);
			return; // 处理完毕，结束函数
		}

		// --- 优先级 2: 检查并处理其他类型的文件 (非图片) ---
		const otherFiles = Array.from(clipboardData.files).filter(file => !file.type.startsWith('image/'));
		if (otherFiles.length > 0) {
			// 我们只在主编辑区处理非图片文件的粘贴，将其作为附件
			if (textarea.id === 'note-input') {
				event.preventDefault();
				// 使用 DataTransfer 来安全地合并现有文件和新粘贴的文件
				const dt = new DataTransfer();
				for (const f of noteFile.files) {
					dt.items.add(f);
				}
				for (const f of otherFiles) {
					dt.items.add(f);
				}
				noteFile.files = dt.files;
				updateMainFileDisplay();
			}
			return;
		}
		handleSmartPaste(event);
	}

	document.addEventListener('paste', handleGlobalPaste);

	noteForm.addEventListener('submit', async e => {
		e.preventDefault();
		if (!noteInput.value.trim() && noteFile.files.length === 0) return showCustomAlert('Content or a file is required.', 'error');

		const btn = e.target.querySelector('button[type="submit"]');
		btn.disabled = true;
		btn.textContent = t('saving');

		const formData = new FormData();
		formData.append('content', noteInput.value);
		formData.append('visibility', noteVisibilitySelect?.value || 'private');
		Array.from(noteFile.files).forEach(file => {
			if (!file.type.startsWith('image/')) {
				formData.append('file', file);
			}
		});
		try {
			const res = await fetch('/api/notes', { method: 'POST', body: formData });
			if (!res.ok) throw new Error(`Save error: ${await res.text()}`);
			noteForm.reset();
			if (noteVisibilitySelect) noteVisibilitySelect.value = 'private';
			mainEditPreview.innerHTML = '';
			noteForm.classList.remove('preview-mode');
			mainPreviewToggleBtn.classList.remove('active');
			autoResizeTextarea(noteInput);
			updateMainFileDisplay();
			await refreshNotes();
		} catch (error) {
			showCustomAlert(error.message, 'error');
		} finally {
			btn.disabled = false;
			btn.textContent = t('save');
		}
	});

	const refreshNotes = () => {
		appState.filters.query = '';
		appState.filters.tag = null;
		appState.filters.date = null;
		globalSearchInput.value = '';
		clearSearchBtn.style.display = 'none';

		// 重置UI
		document.querySelectorAll('.timeline-item.active, .tag-item.active').forEach(i => i.classList.remove('active'));
		clearFilterBtn.classList.remove('visible');
		clearTagsBtn.classList.remove('visible');

		// 如果当前不在 home 模式，切换回去
		if (appState.baseMode !== 'home') {
			appState.baseMode = 'home';
			updateSidebarTabsUI();
		}

		reloadNotes();
		// 重新加载侧边栏数据
		loadAndRenderTags();
		loadAndRenderTimeline();
		loadAndRenderStats();
	};
	refreshBtn.addEventListener('click', refreshNotes);

	const imagePreviewModal = document.getElementById('image-preview-modal');
	const modalImage = document.getElementById('modal-image');
	const imageCaption = document.getElementById('image-preview-caption');
	const closeImagePreview = document.querySelector('.image-preview-close');
	const videoPreviewModal = document.getElementById('video-preview-modal');
	const modalVideo = document.getElementById('modal-video');
	const videoCaption = document.getElementById('video-preview-caption');
	const closeVideoPreviewBtn = document.querySelector('.video-preview-close');
	function openImagePreview(src, alt) {
		imagePreviewModal.style.display = 'flex';
		if (modalImage.src !== src) {
			modalImage.src = src;
		}
		imageCaption.innerHTML = alt;
	}

	function closePreview() {
		imagePreviewModal.style.display = 'none';
	}
	function openVideoPreview(src, alt) {
		videoPreviewModal.style.display = 'flex';
		if (modalVideo.src !== src) {
			modalVideo.src = src;
		}
		videoCaption.innerHTML = alt;
		modalVideo.play();
	}
	function closeVideoPreview() {
		videoPreviewModal.style.display = 'none';
		modalVideo.pause();
		modalVideo.src = '';
	}

	closeImagePreview.onclick = closePreview;
	imagePreviewModal.addEventListener('click', (e) => {
		if (e.target === imagePreviewModal) {
			closePreview();
		}
	});
	closeVideoPreviewBtn.onclick = closeVideoPreview;
	videoPreviewModal.addEventListener('click', (e) => {
		if (e.target === videoPreviewModal) {
			closeVideoPreview();
		}
	});
	// --- Event Delegation for Notes Container (Corrected for SVG Icons) ---
	notesContainer.addEventListener('click', async e => {
		const target = e.target;

		if (target.classList.contains('toggle-content-btn')) {
			const noteElement = target.closest('.note');
			if (noteElement) {
				noteElement.classList.toggle('is-expanded');
				if (noteElement.classList.contains('is-expanded')) {
					target.textContent = t('collapse');
				} else {
					target.textContent = t('showMore');
				}
			}
			return;
		}
		const shareBtn = target.closest('.share-file-btn');
		if (shareBtn) {
			e.preventDefault();
			e.stopPropagation();

			const noteId = shareBtn.dataset.noteId;
			const fileId = shareBtn.dataset.fileId;
			const originalIcon = shareBtn.innerHTML;
			const successIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;

			shareBtn.disabled = true;
			shareBtn.innerHTML = '...';

			try {
				const response = await fetch(`/api/notes/${noteId}/files/${fileId}/share`, { method: 'POST' });
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(extractErrorMessage(errorData, 'Failed to generate link.'));
				}
				const { url } = await response.json();

				await navigator.clipboard.writeText(url);

				shareBtn.innerHTML = successIcon;
				shareBtn.classList.add('copied');
				shareBtn.title = t('copied');

				setTimeout(() => {
					shareBtn.innerHTML = originalIcon;
					shareBtn.classList.remove('copied');
					shareBtn.title = t('getPublicLink');
					shareBtn.disabled = false;
				}, 2000);

			} catch (error) {
				showCustomAlert(`Error: ${error.message}`, 'error');
				shareBtn.innerHTML = originalIcon;
				shareBtn.disabled = false;
			}
			return; // 处理完分享点击后，终止后续事件处理
		}

		const deleteBtn = target.closest('.delete-file-btn');
		if (deleteBtn) {
			e.preventDefault();
			e.stopPropagation();

			const noteId = deleteBtn.dataset.noteId;
			const fileId = deleteBtn.dataset.fileId;

			const confirmed = await showCustomConfirm('Are you sure you want to permanently delete this file? This action cannot be undone.');
			if (!confirmed) return;

			const attachmentElement = deleteBtn.closest('.attachment-link, .attachment-img');
			const noteElement = deleteBtn.closest('.note');
			attachmentElement.style.opacity = '0.5'; // 提供即时反馈
			deleteBtn.disabled = true;

			const formData = new FormData();
			formData.append('filesToDelete', JSON.stringify([fileId]));
			// 必须发送一个内容，否则PUT请求体可能为空，导致问题
			const currentNote = allNotesCache.find(n => n.id == noteId);
			formData.append('content', currentNote.content);
			formData.append('update_timestamp', 'false');

			try {
				const response = await fetch(`/api/notes/${noteId}`, {
					method: 'PUT',
					body: formData
				});

				const result = await response.json();

				if (!response.ok) {
					throw new Error(extractErrorMessage(result, 'Failed to delete file.'));
				}

				if (result.noteDeleted) {
					noteElement.remove(); // 直接删除DOM元素
					allNotesCache = allNotesCache.filter(n => n.id !== parseInt(noteId));
					showToast('File and empty note removed.', 'info');
				} else {
					attachmentElement.remove();
					if (currentNote) {
						currentNote.files = currentNote.files.filter(f => f.id !== fileId);
					}
					showToast('File deleted successfully.');
				}

			} catch (error) {
				showCustomAlert(`Error: ${error.message}`, 'error');
				attachmentElement.style.opacity = '1';
				deleteBtn.disabled = false;
			}
			return;
		}
		const dateHeader = target.closest('.date-group-header');
		if (dateHeader) {
			const group = dateHeader.parentElement;
			const icon = dateHeader.querySelector('.toggle-icon');
			group.classList.toggle('collapsed');
			icon.classList.toggle('expanded', !group.classList.contains('collapsed'));
			return;
		}
		if (target.matches('.note-image-attachment')) {
			e.preventDefault();
			openImagePreview(target.src, target.alt);
			return;
		}

		const noteElement = target.closest('.note');
		if (!noteElement) return;
		const noteId = noteElement.dataset.id;
		// const moreBtn = target.closest('.waterfall-more-btn');
		// if (moreBtn) {
		// 	e.stopPropagation(); // 阻止事件冒泡到document的关闭监听器
		// 	showWaterfallPopover(moreBtn, noteId);
		// 	return;
		// }
		const editBtn = target.closest('.edit');
		const fullscreenEditBtn = target.closest('.fullscreen-edit');

		const cancelEditBtn = target.closest('.cancel-edit');
		const removeFileBtn = target.closest('.remove-file-btn');
		const saveEditBtn = target.closest('.save-edit');
		const previewToggleBtn = target.closest('.md-preview-toggle-btn');
		const splitToggleBtn = target.closest('.md-split-toggle-btn');
		// 检查被点击的元素或其父元素是否是 .inline-tag
		const inlineTag = event.target.closest('.inline-tag');

		const unpinBtn = target.closest('.unpin-btn');
		if (unpinBtn) {
			unpinBtn.disabled = true;
			const formData = new FormData();
			formData.append('isPinned', 'false');
			try {
				const res = await fetch(`/api/notes/${noteId}`, { method: 'PUT', body: formData });
				if (!res.ok) throw new Error('Failed to unpin note.');
				await refreshNotes();
			} catch (error) {
				showCustomAlert(error.message, 'error');
				unpinBtn.disabled = false;
			}
			return;
		}
		if (inlineTag) {
			// 阻止 <a> 标签的默认跳转行为
			event.preventDefault();

			const tagName = inlineTag.dataset.tagName;
			if (!tagName) return;
			appState.filters.tag = tagName;
			// 更新UI
			document.querySelectorAll('.tag-item.active').forEach(i => i.classList.remove('active'));
			const leftSidebarTag = document.querySelector(`#tags-container .tag-item[data-tag-name="${tagName}"]`);
			if (leftSidebarTag) leftSidebarTag.classList.add('active');
			clearTagsBtn.classList.add('visible');

			reloadNotes();
		}

		if (fullscreenEditBtn) {
			// 从当前笔记的 DOM 元素中找到正在编辑的 textarea
			const editTextarea = noteElement.querySelector('.edit-textarea');
			// 获取 textarea 中最新的、可能尚未保存的内容
			const currentContent = editTextarea.value;
			// 使用这个最新的内容打开全屏编辑器
			openFullscreenEditor(currentContent, noteId);
		} else if (editBtn) {
			noteElement.classList.add('editing');
			// 初始化为编辑模式 (raw)
			noteElement.dataset.editMode = 'raw';
			noteElement.querySelector('.md-preview-toggle-btn').classList.remove('active');
			noteElement.querySelector('.md-split-toggle-btn').classList.remove('active');

			const noteData = allNotesCache.find(n => n.id === parseInt(noteId, 10));
			noteElement.newFiles = new DataTransfer().files;

			const filesContainer = noteElement.querySelector('.edit-files-container');
			filesContainer.innerHTML = '';
			const editTextarea = noteElement.querySelector('.edit-textarea');
			autoResizeTextarea(editTextarea);
			noteData.files.forEach(file => filesContainer.appendChild(createFileTag(file.name, file.id)));

			syncNoteEditorLayout(noteElement);
			noteEditorResizeObserver.observe(noteElement);
			// --- 自动聚焦并将光标移动到末尾 ---
			// 使用 requestAnimationFrame 可以确保在浏览器完成UI渲染（使textarea可见）之后再执行聚焦操作，
			requestAnimationFrame(() => {
				const editTextarea = noteElement.querySelector('.edit-textarea');
				editTextarea.focus({ preventScroll: true });
				const textLength = editTextarea.value.length;
				editTextarea.setSelectionRange(textLength, textLength);
				// 如果文本很长，确保 textarea 内部也滚动到底部，
				editTextarea.scrollTop = editTextarea.scrollHeight;
			});
		} else if (cancelEditBtn) {
			// 1. 从缓存中找到这条笔记的原始数据
			const noteId = parseInt(noteElement.dataset.id, 10);
			const originalNoteData = allNotesCache.find(n => n.id === noteId);

			if (originalNoteData) {
				// 2. 将 textarea 的内容重置为原始文本
				const editTextarea = noteElement.querySelector('.edit-textarea');
				editTextarea.value = originalNoteData.content;

				// 3. 重置高度，以防文本变短后留下空白
				autoResizeTextarea(editTextarea);
			}
			// 清空在本次编辑中新暂存的文件
			noteElement.newFiles = new DataTransfer().files;
			// 移除所有文件的“待删除”标记
			noteElement.querySelectorAll('.edit-file-tag.deleted').forEach(tag => {
				tag.classList.remove('deleted');
				delete tag.dataset.deleted;
			});
			// 移除为新文件创建的UI标签
			// （因为下次点击编辑时会重新渲染，所以这一步可以省略，但加上更严谨）
			const filesContainer = noteElement.querySelector('.edit-files-container');
			filesContainer.innerHTML = '';
			if (originalNoteData && originalNoteData.files) {
				originalNoteData.files.forEach(file => filesContainer.appendChild(createFileTag(file.name, file.id)));
			}
			// 5. 最后，执行原始的UI清理操作
			noteElement.classList.remove('editing', 'preview-mode', 'split-mode');
			noteEditorResizeObserver.unobserve(noteElement);
			delete noteElement.dataset.editMode;
		} else if (removeFileBtn) {
			const fileTag = removeFileBtn.closest('.edit-file-tag');
			if (fileTag.dataset.fileId) { // Existing file
				fileTag.classList.toggle('deleted');
				fileTag.dataset.deleted = fileTag.classList.contains('deleted');
			} else { // New file
				const fileName = fileTag.dataset.fileName;
				const dt = new DataTransfer();
				for (const file of noteElement.newFiles) {
					if (file.name !== fileName) dt.items.add(file);
				}
				noteElement.newFiles = dt.files;
				fileTag.remove();
			}

		} else if (saveEditBtn) {
			noteEditorResizeObserver.unobserve(noteElement);
			saveEditBtn.disabled = true;
			// 找到SVG并替换为加载中的动画或文本
			const originalIcon = saveEditBtn.innerHTML;
			saveEditBtn.innerHTML = '...';

			const formData = new FormData();
			formData.append('content', noteElement.querySelector('.edit-textarea').value.trim());
			const visibilitySelect = noteElement.querySelector('.edit-visibility-select');
			if (visibilitySelect) {
				formData.append('visibility', visibilitySelect.value);
			}

			const timestampToggle = noteElement.querySelector('.update-timestamp-toggle');
			const shouldUpdate = !timestampToggle.checked;
			formData.append('update_timestamp', shouldUpdate.toString());

			const filesToDelete = Array.from(noteElement.querySelectorAll('.edit-file-tag[data-deleted="true"]')).map(t => t.dataset.fileId);
			formData.append('filesToDelete', JSON.stringify(filesToDelete));

			Array.from(noteElement.newFiles).forEach(file => formData.append('file', file));

			try {
				const res = await fetch(`/api/notes/${noteId}`, { method: 'PUT', body: formData });
				if (!res.ok) throw new Error(`Update failed`);
				const updatedNote = await res.json();
				const newNoteElement = createNoteElement(updatedNote);
				noteElement.replaceWith(newNoteElement);

				// 如果当前是瀑布流模式，则需要让 ResizeObserver 开始监视这个新元素
				if (appState.isWaterfall) {
					waterfallObserver.observe(newNoteElement);
				}
				const noteIndex = allNotesCache.findIndex(n => n.id === parseInt(noteId, 10));
				if (noteIndex !== -1) {
					allNotesCache[noteIndex] = updatedNote;
				}
				loadAndRenderTags();
				loadAndRenderTimeline();
				loadAndRenderStats();
			} catch (error) {
				showCustomAlert(error.message, 'error');
				saveEditBtn.disabled = false;
				saveEditBtn.innerHTML = originalIcon; // 恢复图标
			}
		} else if (previewToggleBtn) {
			const currentMode = noteElement.dataset.editMode || 'raw';
			const newMode = currentMode === 'raw' ? 'preview' : 'raw';
			noteElement.dataset.editMode = newMode;

			previewToggleBtn.classList.toggle('active', newMode === 'preview');
			if (newMode === 'preview') {
				const textarea = noteElement.querySelector('.edit-textarea');
				const preview = noteElement.querySelector('.edit-preview');
				preview.innerHTML = postProcessMarkdownHtml(marked.parse(textarea.value || ''));
			}
		} else if (splitToggleBtn) {
			noteElement.classList.toggle('split-mode');
			splitToggleBtn.classList.toggle('active');
			if (splitToggleBtn.classList.contains('active')) {
				const textarea = noteElement.querySelector('.edit-textarea');
				const preview = noteElement.querySelector('.edit-preview');
				preview.innerHTML = postProcessMarkdownHtml(marked.parse(textarea.value || ''));
			}
		}
	});

	notesContainer.addEventListener('mouseover', e => {
		const noteElement = e.target.closest('.note');
		if (!noteElement) return;
		const noteId = noteElement.dataset.id;

		const moreBtn = e.target.closest('.more-actions-btn');
		if (moreBtn) {
			showNotePopover(moreBtn, noteId);
			return;
		}
		// const waterfallMoreBtn = e.target.closest('.waterfall-more-btn');
		// if (waterfallMoreBtn) {
		// 	showWaterfallPopover(waterfallMoreBtn, noteId);
		// 	return;
		// }
	});

	notesContainer.addEventListener('mouseout', e => {
		if (e.target.closest('.more-actions-btn')) {
			hideNotePopover();
		}
		// if (e.target.closest('.waterfall-more-btn')) {
		// 	hideWaterfallPopover();
		// }
	});

	function createFileTag(name, id = null) {
		const tag = document.createElement('div');
		tag.className = 'edit-file-tag';
		tag.textContent = name;
		if (id) tag.dataset.fileId = id;
		else tag.dataset.fileName = name;
		tag.innerHTML += '<button class="remove-file-btn">&times;</button>';
		return tag;
	}

	// Handle adding new files in edit mode
	function addFilesToEditNote(files, noteElement) {
		const filesContainer = noteElement.querySelector('.edit-files-container');
		const dt = new DataTransfer();
		for (const f of noteElement.newFiles) dt.items.add(f);

		const attachmentFiles = Array.from(files).filter(f => !f.type.startsWith('image/'));
		for (const f of attachmentFiles) {
			dt.items.add(f);
			filesContainer.appendChild(createFileTag(f.name));
		}
		noteElement.newFiles = dt.files;
	}

	notesContainer.addEventListener('change', async e => {
		if (e.target.matches('.edit-file-input')) {
			const noteElement = e.target.closest('.note');
			const textarea = noteElement.querySelector('.edit-textarea');
			await handleImageUploadAndInsert(e.target.files, textarea);
			// 旧的附件逻辑现在只处理非图片文件
			addFilesToEditNote(e.target.files, noteElement);
			e.target.value = '';
		}
	});

	['dragover', 'dragleave', 'drop'].forEach(eventName => {
		notesContainer.addEventListener(eventName, async e => {
			const textarea = e.target.closest('.edit-textarea');
			if (!textarea) return;
			e.preventDefault();
			e.stopPropagation();
			if (eventName === 'dragover') textarea.classList.add('dragover');
			else if (eventName === 'dragleave') textarea.classList.remove('dragover');
			else if (eventName === 'drop') {
				textarea.classList.remove('dragover');
				await handleImageUploadAndInsert(e.dataTransfer.files, textarea.closest('.note').querySelector('.edit-textarea'));

				addFilesToEditNote(e.dataTransfer.files, textarea.closest('.note'));
			}
		});
	});
	notesContainer.addEventListener('input', e => {
		const textarea = e.target;
		const noteElement = textarea.closest('.note');
		if (noteElement) {
			const preview = noteElement.querySelector('.edit-preview');
			if (preview) {
				preview.innerHTML = postProcessMarkdownHtml(marked.parse(textarea.value || ''));
			}
		}
		if (e.target.matches('.edit-textarea')) {
			autoResizeTextarea(e.target);
		}

	});
	notesContainer.addEventListener('contextmenu', e => {
		const link = e.target.closest('.attachment-link');
		if (!link || !link.download) return;
		if (textFileExtensions.includes(link.download.split('.').pop().toLowerCase())) {
			e.preventDefault();
			window.open(`${link.href}?preview=true`, '_blank');
		}
	});

	// --- Infinite Scroll & Initial Load ---
	window.addEventListener('scroll', () => {
		if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 100 && appState.pagination.hasMore && !appState.pagination.isLoading) {
			fetchNotes(appState.pagination.currentPage + 1);
		}
	});


	// 获取并渲染时间线和热力图
	async function loadAndRenderTimeline(dataOverride = null) {
		const timelineContainer = document.getElementById('timeline-container');
		try {
			let timelineData = dataOverride;
			if (!timelineData) {
				const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
				const apiUrl = `/api/notes/timeline?timezone=${encodeURIComponent(userTimezone)}`;
				const response = await fetch(apiUrl);
				if (!response.ok) throw new Error('Failed to fetch timeline');
				timelineData = await response.json();
				timelineDataCache = timelineData;
			}
			loadAndRenderHeatmap(timelineData);

			timelineContainer.innerHTML = '';
			const rootUl = document.createElement('ul');
			const sortedYears = Object.keys(timelineData).sort((a, b) => b - a);

			for (const year of sortedYears) {
				const yearData = timelineData[year];
				const yearLi = createTimelineNode('year', year, yearData.count, { year });
				rootUl.appendChild(yearLi);

				const monthUl = document.createElement('ul');
				monthUl.className = 'timeline-children';
				yearLi.appendChild(monthUl);

				monthUl.style.display = 'block'; //直接设置月份列表为可见
				const yearToggle = yearLi.querySelector('.timeline-toggle');
				if (yearToggle) {
					yearToggle.classList.add('expanded');
				}
				const sortedMonths = Object.keys(yearData.months).sort((a, b) => b - a);
				for (const month of sortedMonths) {
					const monthData = yearData.months[month];
					const monthLi = createTimelineNode('month', month, monthData.count, { year, month });
					monthUl.appendChild(monthLi);

					const dayUl = document.createElement('ul');
					dayUl.className = 'timeline-children';
					monthLi.appendChild(dayUl);
					const sortedDays = Object.keys(monthData.days).sort((a, b) => b - a);
					for (const day of sortedDays) {
						const dayData = monthData.days[day];
						const dayLi = createTimelineNode('day', day, dayData.count, { year, month, day });
						dayUl.appendChild(dayLi);
					}
				}
			}
			timelineContainer.appendChild(rootUl);

		} catch (error) {
			console.error('Error loading timeline:', error);
			timelineContainer.innerHTML = `<p>${translateMessage('Error loading timeline.')}</p>`;
		}
	}

	// 创建时间线节点的辅助函数，以支持新的交互模型
	function createTimelineNode(level, label, count, dateParts = {}) {
		const li = document.createElement('li');
		const itemDiv = document.createElement('div');
		itemDiv.className = 'timeline-item';
		itemDiv.dataset.level = level;
		// 存储日期信息用于筛选
		if (dateParts.year) itemDiv.dataset.year = dateParts.year;
		if (dateParts.month) itemDiv.dataset.month = dateParts.month;
		if (dateParts.day) itemDiv.dataset.day = dateParts.day;

		const isExpandable = level === 'year' || level === 'month';

		let filterButtonHtml = '';
		if (isExpandable) {
			filterButtonHtml = `
                <button class='timeline-filter-btn' title='${t('filterNotesFor')} ${label}'>
                    <svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 4.5h18'/><path d='M3 9.5h18'/><path d='M3 14.5h18'/><path d='M3 19.5h18'/></svg>
                </button>
            `;
		}

		itemDiv.innerHTML = `
            <span class='timeline-label'>
                ${isExpandable ? `<svg class='timeline-toggle' viewBox='0 0 24 24'><path fill='currentColor' d='M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z'></path></svg>` : '<span style="width:24px"></span>'}
                ${label}
            </span>
            <div class='timeline-actions'>
                <span class='timeline-count'></span>
                ${filterButtonHtml}
            </div>
        `;
		li.appendChild(itemDiv);
		const countSpan = itemDiv.querySelector('.timeline-count');
		if (countSpan) {
			countSpan.textContent = formatNoteCountLabel(count);
		}
		return li;
	}

	const clearFilterBtn = document.getElementById('clear-filter-btn');
	clearFilterBtn.innerHTML = `
        <svg xmlns='http://www.w3.org/2000/svg' height='24px' viewBox='0 0 24 24' width='24px' fill='currentColor'>
            <path d='M0 0h24v24H0V0z' fill='none'/>
            <path d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z'/>
        </svg>
    `;

	clearFilterBtn.addEventListener('click', () => {
		appState.filters.date = null;
		document.querySelectorAll('#timeline-container .timeline-item.active').forEach(i => i.classList.remove('active'));
		clearFilterBtn.classList.remove('visible');
		reloadNotes();
	});

	// 处理时间线点击事件，由客户端计算精确时间戳
	document.getElementById('timeline-container').addEventListener('click', (event) => {
		const item = event.target.closest('.timeline-item');
		if (!item) return;

		const filterBtn = event.target.closest('.timeline-filter-btn');
		const level = item.dataset.level;

		const applyFilter = (targetItem) => {
			// --- 1. 从 data-* 属性中获取年/月/日 (并转换为数字) ---
			const year = parseInt(targetItem.dataset.year);
			const month = targetItem.dataset.month ? parseInt(targetItem.dataset.month) : null;
			const day = targetItem.dataset.day ? parseInt(targetItem.dataset.day) : null;

			// --- 2. 使用本地时区计算精确的开始和结束时间戳 ---
			let startOfDay, endOfDay;
			const monthIndex = month ? month - 1 : 0;

			if (day) { // 精确到天
				startOfDay = new Date(year, monthIndex, day); // 本地时间的当天 00:00:00
				endOfDay = new Date(year, monthIndex, day + 1); // 本地时间的下一天 00:00:00
			} else if (month) { // 精确到月
				startOfDay = new Date(year, monthIndex, 1); // 本地时间的当月第一天 00:00:00
				endOfDay = new Date(year, monthIndex + 1, 1); // 本地时间的下个月第一天 00:00:00
			} else { // 精确到年
				startOfDay = new Date(year, 0, 1); // 本地时间的当年第一天 00:00:00
				endOfDay = new Date(year + 1, 0, 1); // 本地时间的下一年第一天 00:00:00
			}

			appState.filters.date = {
				startTimestamp: startOfDay.getTime(),
				endTimestamp: endOfDay.getTime()
			};

			document.querySelectorAll('#timeline-container .timeline-item.active').forEach(activeItem => {
				activeItem.classList.remove('active');
			});
			targetItem.classList.add('active');
			clearFilterBtn.classList.add('visible');
			reloadNotes();
		};

		if (filterBtn) {
			applyFilter(item);
			return;
		}
		if (level === 'day') {
			applyFilter(item);
			return;
		}
		if (level === 'year' || level === 'month') {
			const toggle = item.querySelector('.timeline-toggle');
			const childrenUl = item.parentElement.querySelector('.timeline-children');
			if (childrenUl && toggle) {
				const isExpanded = childrenUl.style.display === 'block';
				childrenUl.style.display = isExpanded ? 'none' : 'block';
				toggle.classList.toggle('expanded', !isExpanded);
			}
		}
	});

	async function loadAndRenderTags() {
		const tagsContainer = document.getElementById('tags-container');
		try {
			const response = await fetch('/api/tags');
			if (!response.ok) throw new Error('Failed to fetch tags');
			const tags = await response.json();

			tagsContainer.innerHTML = '<ul></ul>';
			const listElement = tagsContainer.querySelector('ul');

			if (tags.length === 0) {
				listElement.innerHTML = `<li><div class="tag-item-placeholder">${translateMessage('No tags yet.')}</div></li>`;
				return;
			}
			tags.forEach(tag => {
				const tagLi = document.createElement('li');
				tagLi.innerHTML = `
                    <div class='tag-item' data-tag-name='${tag.name}' title='${translateMessage('Filter by tag:')} #${tag.name}'>
                        <span class='tag-label'>
                            <span class='tag-hash'>#</span>
                            <span class='tag-name'>${tag.name}</span>
                        </span>
                        <span class='tag-count'>${tag.count}</span>
                    </div>
                `;
				listElement.appendChild(tagLi);
			});
		} catch (error) {
			console.error('Error loading tags:', error);
			tagsContainer.innerHTML = `<p>${translateMessage('Error loading tags.')}</p>`;
		}
	}

	const clearTagsBtn = document.getElementById('clear-tags-filter-btn');
	document.getElementById('tags-container').addEventListener('click', (event) => {
		const item = event.target.closest('.tag-item');
		if (!item) return;
		appState.filters.tag = item.dataset.tagName;
		// 更新UI
		document.querySelectorAll('#tags-container .tag-item.active').forEach(i => i.classList.remove('active'));
		item.classList.add('active');
		clearTagsBtn.classList.add('visible');

		reloadNotes();
	});
	clearTagsBtn.innerHTML = `
        <svg xmlns='http://www.w3.org/2000/svg' height='24px' viewBox='0 0 24 24' width='24px' fill='currentColor'>
            <path d='M0 0h24v24H0V0z' fill='none'/>
            <path d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z'/>
        </svg>
    `;

	clearTagsBtn.addEventListener('click', () => {
		appState.filters.tag = null;
		document.querySelectorAll('#tags-container .tag-item.active').forEach(i => i.classList.remove('active'));
		clearTagsBtn.classList.remove('visible');
		reloadNotes();
	});

	/**
	 * 监听 textarea 的键盘事件，实现列表自动补全
	 * @param {KeyboardEvent} event
	 */
	function handleListAutoInsertion(event) {
		if (event.key !== 'Enter') return;

		const textarea = event.target;
		const cursorPosition = textarea.selectionStart;
		const text = textarea.value;

		// 寻找当前行的起始位置
		const lineStart = text.lastIndexOf('\n', cursorPosition - 1) + 1;
		const currentLine = text.substring(lineStart, cursorPosition);

		// 匹配无序列表，例如 "- ", "* ", "+ "
		const unorderedListMatch = currentLine.match(/^(\s*[-*+]\s+)/);
		// 匹配有序列表，例如 "1. ", "2. "
		const orderedListMatch = currentLine.match(/^(\s*)(\d+)(\.\s+)/);
		let wasHandled = false;

		if ((unorderedListMatch && currentLine.trim() === unorderedListMatch[0].trim()) ||
			(orderedListMatch && currentLine.trim() === orderedListMatch[0].trim())) {
			event.preventDefault();
			const replacementText = '\n';
			textarea.setRangeText(replacementText, lineStart, cursorPosition);

			const newCursorPosition = lineStart + replacementText.length;
			textarea.selectionStart = textarea.selectionEnd = newCursorPosition;
			wasHandled = true;
		} else {
			let textToInsert = '';
			if (unorderedListMatch) {
				textToInsert = `\n${unorderedListMatch[1]}`;
			} else if (orderedListMatch) {
				const leadingSpace = orderedListMatch[1];
				const number = parseInt(orderedListMatch[2], 10);
				const separator = orderedListMatch[3];
				textToInsert = `\n${leadingSpace}${number + 1}${separator}`;
			}

			if (textToInsert) {
				event.preventDefault();
				textarea.setRangeText(textToInsert, cursorPosition, textarea.selectionEnd);
				const newCursorPosition = cursorPosition + textToInsert.length;
				textarea.selectionStart = textarea.selectionEnd = newCursorPosition;
				wasHandled = true;
			}
		}
		if (wasHandled) {
			autoResizeTextarea(textarea);
		}
	}

	// 为主输入框绑定
	noteInput.addEventListener('keydown', event => {
		handleTabIndentation(event);
		handleEditorShortcuts(event);
		handleListAutoInsertion(event);
	});

	// 通过事件委托为笔记卡片内的编辑框绑定
	notesContainer.addEventListener('keydown', event => {
		if (event.target.matches('.edit-textarea')) {
			handleTabIndentation(event);
			handleEditorShortcuts(event);
			handleListAutoInsertion(event);
		}
	});

	function initializeHeatmapDragToScroll() {
		const scrollContainer = document.getElementById('heatmap-scroll-container');
		// 如果找不到容器（例如加载失败），则不执行任何操作
		if (!scrollContainer) return;

		let isDown = false;
		let isDragging = false;
		let startX;
		let scrollLeftStart;

		scrollContainer.addEventListener('mousedown', (e) => {
			// 阻止默认的文本选择等行为
			e.preventDefault();
			isDown = true;
			isDragging = false; // 每次按下鼠标时，重置拖拽状态
			scrollContainer.classList.add('active-drag');
			// 记录起始点
			startX = e.pageX - scrollContainer.offsetLeft;
			scrollLeftStart = scrollContainer.scrollLeft;
		});
		scrollContainer.addEventListener('mouseleave', () => {
			isDown = false;
			scrollContainer.classList.remove('active-drag');
		});

		scrollContainer.addEventListener('mouseup', () => {
			isDown = false;
			scrollContainer.classList.remove('active-drag');
		});

		scrollContainer.addEventListener('mousemove', (e) => {
			if (!isDown) return;
			isDragging = true;
			const x = e.pageX - scrollContainer.offsetLeft;
			const walk = (x - startX) * 1.5; //乘以1.5可以增加拖动速度，感觉更灵敏
			scrollContainer.scrollLeft = scrollLeftStart - walk;
		});

		scrollContainer.addEventListener('click', (e) => {
			if (isDragging) {
				e.preventDefault();
				e.stopPropagation();
			}
		}, true);
	}

	// document.addEventListener('DOMContentLoaded', () => {
	initializeApp();
	initializeTheme();
	initializeThemeColor();
	const editorResizeObserver = new ResizeObserver(() => {
		handleEditorLayout();
		syncMainEditorLayout();
	});
	editorResizeObserver.observe(noteForm);
	handleEditorLayout();
	// });
