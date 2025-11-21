export const NOTES_PER_PAGE = 10;
export const ATTACHMENTS_PER_PAGE = 20;

export const SESSION_DURATION_SECONDS = 30 * 86400; // Session 有效期: 30 天
export const SESSION_COOKIE = '__session';
export const PBKDF2_ITERATIONS = 100000; // Workers 限制 100k 以内
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

export const MAX_TIME_RANGE_MS = 365 * 24 * 60 * 60 * 1000; // 时间范围上限（默认 1 年）
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 单次上传大小上限 10MB

export const SHARE_DEFAULT_TTL_SECONDS = 3600;
export const SHARE_LOCK_TTL_SECONDS = 30;

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
