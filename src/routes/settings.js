import { jsonResponse } from '../utils/response.js';

export async function handleGetSettings(request, env) {
	const defaultSettings = {
		showSearchBar: true,
		showStatsCard: true,
		showCalendar: true,
		showTags: true,
		showTimeline: true,
		showRightSidebar: true,
		hideEditorInWaterfall: false,
		showHeatmap: true, // 默认显示热力图
		imageUploadDestination: 'local', // 默认使用R2
		imgurClientId: '',
		surfaceColor: '#ffffff',
		surfaceColorDark: '#151f31',
		surfaceOpacity: 1,
		backgroundOpacity: 1, // 默认完全不透明
		backgroundImage: '/bg.jpg',
		backgroundBlur: 0,
		waterfallCardWidth: 320,
		enableDateGrouping: false,
		telegramProxy: false,
		showFavorites: true,  // 控制收藏夹
		showArchive: true,      // 控制归档
		enablePinning: true,    // 控制置顶功能
		enableSharing: true,    // 控制分享功能
		showDocs: true          // 控制 Docs 链接
	};

	let savedSettings = await env.NOTES_KV.get('user_settings', 'json');

	// 如果 KV 中没有设置，则返回默认值
	if (!savedSettings) {
		return jsonResponse(defaultSettings);
	}
	return jsonResponse(savedSettings);
}

export async function handleSetSettings(request, env) {
	try {
		const settingsToSave = await request.json();
		await env.NOTES_KV.put('user_settings', JSON.stringify(settingsToSave));
		return jsonResponse({ success: true });
	} catch (e) {
		console.error("Set Settings Error:", e.message);
		return jsonResponse({ error: 'Failed to save settings' }, 500);
	}
}
