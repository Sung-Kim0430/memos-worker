import { DEFAULT_USER_SETTINGS } from '../constants.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { requireAdmin, requireSession } from '../utils/authz.js';

const SETTINGS_CACHE = new Map(); // key -> { expires, data }
const SETTINGS_CACHE_TTL_MS = 30 * 1000;

export async function handleGetSettings(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}

	const key = `user_settings:${session.id}`;

	// 尝试内存缓存
	const cached = SETTINGS_CACHE.get(key);
	if (cached && cached.expires > Date.now()) {
		return jsonResponse(cached.data);
	}

	let savedSettings = await env.NOTES_KV.get(key, 'json');

	// 如果 KV 中没有设置，则返回默认值
	if (!savedSettings) {
		SETTINGS_CACHE.set(key, { expires: Date.now() + SETTINGS_CACHE_TTL_MS, data: DEFAULT_USER_SETTINGS });
		return jsonResponse(DEFAULT_USER_SETTINGS);
	}
	// 合并默认值，防止新增字段在旧配置下为 undefined
	const merged = { ...DEFAULT_USER_SETTINGS, ...savedSettings };
	SETTINGS_CACHE.set(key, { expires: Date.now() + SETTINGS_CACHE_TTL_MS, data: merged });
	return jsonResponse(merged);
}

export async function handleSetSettings(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	try {
		let settingsToSave;
		try {
			settingsToSave = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		if (!settingsToSave || typeof settingsToSave !== 'object' || Array.isArray(settingsToSave)) {
			return errorResponse('INVALID_INPUT', 'Invalid settings payload', 400);
		}
		const key = `user_settings:${session.id}`;
		await env.NOTES_KV.put(key, JSON.stringify(settingsToSave));
		SETTINGS_CACHE.set(key, { expires: Date.now() + SETTINGS_CACHE_TTL_MS, data: settingsToSave });
		return jsonResponse({ success: true });
	} catch (e) {
		console.error("Set Settings Error:", e);
		return errorResponse('SAVE_FAILED', 'Failed to save settings', 500, e.message);
	}
}
