export const NOTES_PER_PAGE = 10;
export const ATTACHMENTS_PER_PAGE = 20;
export const MAX_FILENAME_LENGTH = 255;
export const MAX_NOTE_CONTENT_LENGTH = 100000; // 字符上限，防止超长内容拖垮存储
export const MAX_TAG_BATCH = 100;

export const SESSION_DURATION_SECONDS = 30 * 86400; // Session 有效期: 30 天
export const SESSION_COOKIE = '__session';
export const CSRF_COOKIE = 'csrf_token';
export const PBKDF2_ITERATIONS = 100000; // Workers 限制 100k 以内
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const ALLOWED_UPLOAD_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif',
	'image/svg+xml',
	'video/mp4',
	'video/webm',
	'video/ogg',
	'application/pdf',
	'text/plain',
];

export const MAX_TIME_RANGE_MS = 365 * 24 * 60 * 60 * 1000; // 时间范围上限（默认 1 年）
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 单次上传大小上限 10MB
export const MAX_PAGE = 1000; // 防止过大分页拖垮查询
export const MAX_OFFSET = MAX_PAGE * NOTES_PER_PAGE;

export const SHARE_DEFAULT_TTL_SECONDS = 3600;
export const SHARE_LOCK_TTL_SECONDS = 30;
export const DOCS_TREE_MAX_NODES = 2000;
export const TELEGRAM_PROXY_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天

export const VISIBILITY_OPTIONS = ['private', 'users', 'public'];

export const DEFAULT_USER_SETTINGS = {
	showSearchBar: true,
	showStatsCard: true,
	showCalendar: true,
	showTags: true,
	showTimeline: true,
	showRightSidebar: true,
	hideEditorInWaterfall: false,
	showHeatmap: true,
	imageUploadDestination: 'local',
	imgurClientId: '',
	surfaceColor: '#ffffff',
	surfaceColorDark: '#151f31',
	surfaceOpacity: 1,
	backgroundOpacity: 1,
	backgroundImage: '/bg.jpg',
	backgroundBlur: 0,
	waterfallCardWidth: 320,
	enableDateGrouping: false,
	telegramProxy: false,
	showFavorites: true,
	showArchive: true,
	enablePinning: true,
	enableSharing: true,
	showDocs: true,
	enableContentTruncation: true,
};
