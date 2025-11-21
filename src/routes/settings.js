import { DEFAULT_USER_SETTINGS } from '../constants.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { requireAdmin, requireSession } from '../utils/authz.js';

export async function handleGetSettings(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}

	let savedSettings = await env.NOTES_KV.get('user_settings', 'json');

	// 如果 KV 中没有设置，则返回默认值
	if (!savedSettings) {
		return jsonResponse(DEFAULT_USER_SETTINGS);
	}
	// 合并默认值，防止新增字段在旧配置下为 undefined
	return jsonResponse({ ...DEFAULT_USER_SETTINGS, ...savedSettings });
}

export async function handleSetSettings(request, env, session) {
	const authError = requireAdmin(session);
	if (authError) {
		return authError;
	}
	try {
		const settingsToSave = await request.json();
		await env.NOTES_KV.put('user_settings', JSON.stringify(settingsToSave));
		return jsonResponse({ success: true });
	} catch (e) {
		console.error("Set Settings Error:", e.message);
		return errorResponse('SAVE_FAILED', 'Failed to save settings', 500, e.message);
	}
}
