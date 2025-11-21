import {
	LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
	LOGIN_RATE_LIMIT_WINDOW_SECONDS,
	PBKDF2_ITERATIONS,
	SESSION_COOKIE,
	SESSION_DURATION_SECONDS,
} from '../constants.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { requireAdmin } from '../utils/authz.js';

async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS) {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
		keyMaterial,
		256
	);
	return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function hashPassword(password, salt = null) {
	if (!salt) {
		const randomBytes = crypto.getRandomValues(new Uint8Array(32));
		salt = btoa(String.fromCharCode(...randomBytes));
	}
	const hash = await deriveKey(password, salt);
	return { hash, salt };
}

async function verifyPassword(password, user) {
	const expectedHash = await deriveKey(password, user.salt);
	return expectedHash === user.password_hash;
}

async function getUserByUsername(env, username) {
	return env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
}

async function getUserById(env, id) {
	return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

async function getUserCount(env) {
	const row = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
	return row?.count || 0;
}

async function ensureAdminUser(env) {
	if (!env.USERNAME || !env.PASSWORD) {
		// 不再强制抛错：如果已有管理员用户则沿用，否则返回 null 让调用方决定提示
		const existingAdmin = await env.DB.prepare("SELECT * FROM users WHERE is_admin = 1 LIMIT 1").first();
		if (existingAdmin) {
			return existingAdmin;
		}
		return null;
	}
	let admin = await getUserByUsername(env, env.USERNAME);
	if (!admin) {
		const telegramId = (env.AUTHORIZED_TELEGRAM_IDS || '').split(',').map(v => v.trim()).filter(Boolean)[0] || null;
		const { hash, salt } = await hashPassword(env.PASSWORD);
		const now = Date.now();
		await env.DB.prepare(
			"INSERT INTO users (id, username, password_hash, salt, is_admin, created_at, telegram_user_id) VALUES (?, ?, ?, ?, 1, ?, ?)"
		).bind(crypto.randomUUID(), env.USERNAME, hash, salt, now, telegramId).run();
		admin = await getUserByUsername(env, env.USERNAME);
	}
	// 将无 owner 的历史笔记归属给管理员
	if (admin) {
		await env.DB.prepare("UPDATE notes SET owner_id = ? WHERE owner_id IS NULL").bind(admin.id).run();
		await env.DB.prepare("UPDATE notes SET visibility = 'private' WHERE visibility IS NULL").run();
	}
	return admin;
}

function getClientIp(request) {
	return request.headers.get('cf-connecting-ip')
		|| (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
		|| '';
}

function isSecureRequest(request) {
	const url = new URL(request.url);
	const forwardedProto = request.headers.get('x-forwarded-proto')
		|| request.headers.get('X-Forwarded-Proto')
		|| request.headers.get('forwarded')?.match(/proto=([^;]+)/i)?.[1];
	const proto = (forwardedProto || url.protocol || '').toLowerCase();
	return proto.startsWith('https');
}

function parseSessionIdFromCookie(cookieHeader) {
	if (!cookieHeader) return '';
	for (const segment of cookieHeader.split(';')) {
		const trimmed = segment.trim();
		if (!trimmed) continue;
		const [name, ...rest] = trimmed.split('=');
		if (name === SESSION_COOKIE) {
			const value = rest.join('=').trim();
			return value.replace(/^"|"$/g, '');
		}
	}
	return '';
}

async function checkLoginRateLimit(env, request) {
	const ip = getClientIp(request) || 'unknown';
	const key = `login_attempts:${ip}`;
	const record = await env.NOTES_KV.get(key, 'json');
	if (record && record.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
		return { limited: true, remaining: 0 };
	}
	return { limited: false, remaining: LOGIN_RATE_LIMIT_MAX_ATTEMPTS - (record?.count || 0) };
}

async function recordLoginFailure(env, request) {
	const ip = getClientIp(request) || 'unknown';
	const key = `login_attempts:${ip}`;
	const now = Math.floor(Date.now() / 1000);
	const record = await env.NOTES_KV.get(key, 'json');
	const next = {
		count: (record?.count || 0) + 1,
		expires: now + LOGIN_RATE_LIMIT_WINDOW_SECONDS
	};
	await env.NOTES_KV.put(key, JSON.stringify(next), { expirationTtl: LOGIN_RATE_LIMIT_WINDOW_SECONDS });
}

async function clearLoginFailures(env, request) {
	const ip = getClientIp(request) || 'unknown';
	const key = `login_attempts:${ip}`;
	await env.NOTES_KV.delete(key);
}

export async function isSessionAuthenticated(request, env) {
	const cookieHeader = request.headers.get('Cookie');
	const sessionId = parseSessionIdFromCookie(cookieHeader);
	if (!sessionId) return null;
	const session = await env.NOTES_KV.get(`session:${sessionId}`, 'json');
	if (!session || !session.userId) {
		return null;
	}
	const user = await getUserById(env, session.userId);
	if (!user) {
		await env.NOTES_KV.delete(`session:${sessionId}`);
		return null;
	}
	return {
		id: user.id,
		username: user.username,
		isAdmin: !!user.is_admin,
	};
}

export async function handleLogin(request, env) {
	try {
		await ensureAdminUser(env);
		const rate = await checkLoginRateLimit(env, request);
		if (rate.limited) {
			return errorResponse('RATE_LIMITED', 'Too many login attempts. Please try again later.', 429, { remaining: rate.remaining });
		}
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		const { username, password } = body;
		if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
			return errorResponse('INVALID_CREDENTIALS', 'Invalid credentials', 401);
		}
		const user = await getUserByUsername(env, username);
		if (user && await verifyPassword(password, user)) {
			const sessionId = crypto.randomUUID();
			const sessionData = { userId: user.id, username: user.username, isAdmin: !!user.is_admin, loggedInAt: Date.now() };
			await env.NOTES_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), {
				expirationTtl: SESSION_DURATION_SECONDS,
			});
			await clearLoginFailures(env, request);
			const headers = new Headers();
			const secureFlag = isSecureRequest(request) ? '; Secure' : '';
			headers.append('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}`);
			return jsonResponse({ success: true, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } }, 200, headers);
		}
		await recordLoginFailure(env, request);
	} catch (e) {
		console.error("Login Error:", e);
		return errorResponse('LOGIN_ERROR', 'Server error during login', 500, e.message);
	}
	return errorResponse('INVALID_CREDENTIALS', 'Invalid credentials', 401);
}

export async function handleRegister(request, env, session) {
	try {
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		const { username, password, isAdmin = false, telegram_user_id } = body;
		if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
			return errorResponse('INVALID_INPUT', 'Username and password are required.', 400);
		}
		const totalUsers = await getUserCount(env);
		if (totalUsers > 0 && (!session || !session.isAdmin)) {
			return errorResponse('FORBIDDEN', 'Only admin can create new users.', 403);
		}
		if (await getUserByUsername(env, username)) {
			return errorResponse('USERNAME_EXISTS', 'Username already exists.', 400);
		}

		const tgId = telegram_user_id ? telegram_user_id.toString() : null;
		if (tgId) {
			const dup = await env.DB.prepare("SELECT id FROM users WHERE telegram_user_id = ?").bind(tgId).first();
			if (dup) {
				return errorResponse('TELEGRAM_ID_CONFLICT', 'Telegram user id already bound.', 400);
			}
		}

		const { hash, salt } = await hashPassword(password);
		const now = Date.now();
		const userId = crypto.randomUUID();
		const isFirstUser = totalUsers === 0;
		const isAdminFlag = isFirstUser ? 1 : (isAdmin && session?.isAdmin ? 1 : 0);

		await env.DB.prepare(
			"INSERT INTO users (id, username, password_hash, salt, is_admin, telegram_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
		).bind(
			userId,
			username,
			hash,
			salt,
			isAdminFlag,
			tgId,
			now
		).run();
		return jsonResponse({ success: true, userId });
	} catch (e) {
		console.error("Register Error:", e);
		return errorResponse('REGISTER_FAILED', 'Failed to register user', 500, e.message);
	}
}

async function ensureAtLeastOneAdmin(env, excludeUserId = null) {
	const row = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1 AND id != ?").bind(excludeUserId).first();
	return (row?.count || 0) > 0;
}

export async function handleUsersList(env, session) {
	const authError = requireAdmin(session);
	if (authError) {
		return authError;
	}
	const { results } = await env.DB.prepare("SELECT id, username, is_admin, telegram_user_id, created_at FROM users ORDER BY created_at ASC").all();
	return jsonResponse({ users: results });
}

export async function handleUserUpdate(request, env, targetUserId, session) {
	const authError = requireAdmin(session);
	if (authError) {
		return authError;
	}
	const target = await getUserById(env, targetUserId);
	if (!target) {
		return errorResponse('USER_NOT_FOUND', 'User not found', 404);
	}
	let payload;
	try {
		payload = await request.json();
	} catch (e) {
		return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
	}
	const updates = [];
	const bindings = [];

	if (payload.username) {
		const exists = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id != ?").bind(payload.username, targetUserId).first();
		if (exists) {
			return errorResponse('USERNAME_EXISTS', 'Username already exists.', 400);
		}
		updates.push("username = ?");
		bindings.push(payload.username);
	}
	if (payload.hasOwnProperty('telegram_user_id')) {
		const tgId = payload.telegram_user_id ? payload.telegram_user_id.toString() : null;
		if (tgId) {
			const dup = await env.DB.prepare("SELECT id FROM users WHERE telegram_user_id = ? AND id != ?").bind(tgId, targetUserId).first();
			if (dup) {
				return errorResponse('TELEGRAM_ID_CONFLICT', 'Telegram user id already bound.', 400);
			}
		}
		updates.push("telegram_user_id = ?");
		bindings.push(tgId);
	}
	if (payload.hasOwnProperty('is_admin')) {
		const keepAdmin = payload.is_admin ? 1 : 0;
		if (!keepAdmin) {
			const hasOtherAdmin = await ensureAtLeastOneAdmin(env, targetUserId);
			if (!hasOtherAdmin) {
				return errorResponse('LAST_ADMIN', 'Cannot remove the last admin.', 400);
			}
		}
		updates.push("is_admin = ?");
		bindings.push(keepAdmin);
	}
	if (payload.password) {
		const { hash, salt } = await hashPassword(payload.password);
		updates.push("password_hash = ?");
		bindings.push(hash);
		updates.push("salt = ?");
		bindings.push(salt);
	}
	if (updates.length === 0) {
		return errorResponse('NO_UPDATES', 'No fields to update.', 400);
	}
	const stmt = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
	bindings.push(targetUserId);
	await env.DB.prepare(stmt).bind(...bindings).run();
	return jsonResponse({ success: true });
}

export async function handleUserDelete(env, targetUserId, session) {
	const authError = requireAdmin(session);
	if (authError) {
		return authError;
	}
	const target = await getUserById(env, targetUserId);
	if (!target) {
		return errorResponse('USER_NOT_FOUND', 'User not found', 404);
	}
	if (target.is_admin) {
		const hasOtherAdmin = await ensureAtLeastOneAdmin(env, targetUserId);
		if (!hasOtherAdmin) {
			return errorResponse('LAST_ADMIN', 'Cannot delete the last admin.', 400);
		}
	}
	const admin = await ensureAdminUser(env);
	if (!admin) {
		return errorResponse('ADMIN_MISSING', 'Admin account missing, cannot transfer notes.', 500);
	}
	// 转移笔记 + 删除用户使用事务，避免部分失败导致数据不一致
	const db = env.DB;
	await db.prepare("BEGIN IMMEDIATE").run();
	try {
		await db.prepare("UPDATE notes SET owner_id = ? WHERE owner_id = ?").bind(admin.id, targetUserId).run();
		await db.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId).run();
		await db.prepare("COMMIT").run();
	} catch (e) {
		try { await db.prepare("ROLLBACK").run(); } catch (rollbackErr) { console.error("Rollback failed:", rollbackErr.message); }
		console.error("Delete User Tx Error:", e);
		return errorResponse('DELETE_USER_FAILED', 'Failed to delete user', 500, e.message);
	}
	// 清理该用户相关的会话
	let cursor = undefined;
	let complete = false;
	while (!complete) {
		const list = await env.NOTES_KV.list({ prefix: 'session:', cursor });
		for (const item of list.keys) {
			const payload = await env.NOTES_KV.get(item.name, 'json');
			if (payload?.userId === targetUserId) {
				await env.NOTES_KV.delete(item.name);
			}
		}
		cursor = list.cursor;
		complete = list.list_complete || !cursor;
	}
	return jsonResponse({ success: true });
}

export async function handleLogout(request, env) {
	const cookieHeader = request.headers.get('Cookie');
	const sessionId = parseSessionIdFromCookie(cookieHeader);
	if (sessionId) {
		await env.NOTES_KV.delete(`session:${sessionId}`);
	}
	const headers = new Headers();
	const secureFlag = isSecureRequest(request) ? '; Secure' : '';
	headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=0`);
	return jsonResponse({ success: true }, 200, headers);
}

export { ensureAdminUser };
