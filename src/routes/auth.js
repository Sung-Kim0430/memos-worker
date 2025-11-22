import {
	LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
	LOGIN_RATE_LIMIT_WINDOW_SECONDS,
	PBKDF2_ITERATIONS,
	CSRF_COOKIE,
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

function parseCookieValue(cookieHeader, name) {
	if (!cookieHeader || !name) return '';
	for (const segment of cookieHeader.split(';')) {
		const trimmed = segment.trim();
		if (!trimmed) continue;
		const [cookieName, ...rest] = trimmed.split('=');
		if (cookieName === name) {
			const value = rest.join('=').trim();
			return value.replace(/^"|"$/g, '');
		}
	}
	return '';
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
	return parseCookieValue(cookieHeader, SESSION_COOKIE);
}

function buildLoginRateLimitKey(request, username = '') {
	const ip = getClientIp(request) || 'unknown';
	const uname = (username || '').toString().toLowerCase() || 'anonymous';
	return `login_attempts:${ip}:${uname}`;
}

async function checkLoginRateLimit(env, request, username = '') {
	const key = buildLoginRateLimitKey(request, username);
	const record = await env.NOTES_KV.get(key, 'json');
	if (record && record.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
		return { limited: true, remaining: 0 };
	}
	return { limited: false, remaining: LOGIN_RATE_LIMIT_MAX_ATTEMPTS - (record?.count || 0) };
}

async function recordLoginFailure(env, request, username = '') {
	const key = buildLoginRateLimitKey(request, username);
	const now = Math.floor(Date.now() / 1000);
	const record = await env.NOTES_KV.get(key, 'json');
	const next = {
		count: (record?.count || 0) + 1,
		expires: now + LOGIN_RATE_LIMIT_WINDOW_SECONDS
	};
	await env.NOTES_KV.put(key, JSON.stringify(next), { expirationTtl: LOGIN_RATE_LIMIT_WINDOW_SECONDS });
}

async function clearLoginFailures(env, request, username = '') {
	const key = buildLoginRateLimitKey(request, username);
	try {
		await env.NOTES_KV.delete(key);
	} catch (e) {
		console.error("Failed to clear login failures:", e);
	}
}

function buildSetCookie(name, value, request, { maxAge = SESSION_DURATION_SECONDS, httpOnly = false } = {}) {
	const secureFlag = isSecureRequest(request) ? '; Secure' : '';
	const httpOnlyFlag = httpOnly ? '; HttpOnly' : '';
	const sameSite = '; SameSite=Strict';
	return `${name}=${value}; Path=/; Max-Age=${maxAge}${secureFlag}${httpOnlyFlag}${sameSite}`;
}

function buildSessionHeaders(request, sessionId, csrfToken) {
	const headers = new Headers();
	headers.append('Set-Cookie', buildSetCookie(SESSION_COOKIE, sessionId, request, { httpOnly: true }));
	headers.append('Set-Cookie', buildSetCookie(CSRF_COOKIE, csrfToken, request, { httpOnly: false }));
	return headers;
}

function buildSessionKvOptions() {
	const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
	return {
		expirationTtl: SESSION_DURATION_SECONDS,
		metadata: { expiresAt }
	};
}

export function validateCsrf(request, session) {
	const method = request.method.toUpperCase();
	if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
		return null;
	}
	const cookieHeader = request.headers.get('Cookie');
	const cookieToken = parseCookieValue(cookieHeader, CSRF_COOKIE);
	const headerToken = request.headers.get('x-csrf-token');
	if (!session?.csrfToken || !cookieToken || !headerToken || headerToken !== cookieToken || headerToken !== session.csrfToken) {
		return errorResponse('CSRF_FAILED', 'Invalid CSRF token', 403);
	}
	return null;
}

export async function isSessionAuthenticated(request, env) {
	const cookieHeader = request.headers.get('Cookie');
	const sessionId = parseSessionIdFromCookie(cookieHeader);
	if (!sessionId) return null;
	const sessionKey = `session:${sessionId}`;
	const session = await env.NOTES_KV.get(sessionKey, 'json');
	if (!session || !session.userId) {
		return null;
	}
	const user = await getUserById(env, session.userId);
	if (!user) {
		await env.NOTES_KV.delete(`session:${sessionId}`);
		return null;
	}
	const revokedAt = await env.NOTES_KV.get(`session_revoked:${user.id}`);
	const loggedInAt = Number(session.loggedInAt) || 0;
	if (revokedAt && loggedInAt && loggedInAt < Number(revokedAt)) {
		await env.NOTES_KV.delete(`session:${sessionId}`);
		return null;
	}
	// 滑动过期：仅在剩余 TTL 较短时刷新，减少同步 KV 写放大
	try {
		const remaining = await env.NOTES_KV.getWithMetadata(sessionKey);
		const expiresAt = Number(remaining?.metadata?.expiresAt);
		const kvExpirationSeconds = Number(remaining?.expiration);
		const deriveSecondsLeft = (expiryMs) => Math.floor((expiryMs - Date.now()) / 1000);
		const secondsLeft = Number.isFinite(expiresAt)
			? deriveSecondsLeft(expiresAt)
			: (Number.isFinite(kvExpirationSeconds) ? kvExpirationSeconds - Math.floor(Date.now() / 1000) : null);
		if (secondsLeft === null || secondsLeft <= SESSION_DURATION_SECONDS * 0.25) {
			// 异步续期，尽量不阻塞请求
			request?.cf?.ctx?.waitUntil?.(
				env.NOTES_KV.put(sessionKey, JSON.stringify(session), buildSessionKvOptions())
			);
		}
	} catch (e) {
		console.error("Failed to extend session TTL:", e);
	}
	return {
		id: user.id,
		username: user.username,
		isAdmin: !!user.is_admin,
		csrfToken: session.csrfToken || '',
	};
}

export async function handleLogin(request, env) {
	try {
		await ensureAdminUser(env);
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
		const rate = await checkLoginRateLimit(env, request, username);
		if (rate.limited) {
			return errorResponse('RATE_LIMITED', 'Too many login attempts. Please try again later.', 429, { remaining: rate.remaining });
		}
		const user = await getUserByUsername(env, username);
			if (user && await verifyPassword(password, user)) {
				const sessionId = crypto.randomUUID();
				const csrfToken = crypto.randomUUID();
				const sessionData = { userId: user.id, username: user.username, isAdmin: !!user.is_admin, loggedInAt: Date.now(), csrfToken };
				await env.NOTES_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), buildSessionKvOptions());
				await clearLoginFailures(env, request, username);
				const headers = buildSessionHeaders(request, sessionId, csrfToken);
				return jsonResponse({ success: true, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } }, 200, headers);
			}
			await recordLoginFailure(env, request, username);
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
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return errorResponse('INVALID_INPUT', 'Invalid payload shape.', 400);
		}
		const { username, password, isAdmin = false, telegram_user_id } = body;
		if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
			return errorResponse('INVALID_INPUT', 'Username and password are required.', 400);
		}
		const db = env.DB;
		await db.prepare("BEGIN IMMEDIATE").run();
		let totalUsers = 0;
		try {
			const row = await db.prepare("SELECT COUNT(*) as count FROM users").first();
			totalUsers = row?.count || 0;

			// 首次创建管理员需要提供预共享口令，避免被抢注
			if (totalUsers === 0) {
				const bootstrapToken = request.headers.get('x-admin-bootstrap-token') || body.bootstrapToken;
				if (!env.ADMIN_BOOTSTRAP_TOKEN || bootstrapToken !== env.ADMIN_BOOTSTRAP_TOKEN) {
					await db.prepare("ROLLBACK").run();
					return errorResponse('BOOTSTRAP_FORBIDDEN', 'Admin bootstrap token is required.', 403);
				}
			} else if (!session || !session.isAdmin) {
				await db.prepare("ROLLBACK").run();
				return errorResponse('FORBIDDEN', 'Only admin can create new users.', 403);
			}
			if (await getUserByUsername(env, username)) {
				await db.prepare("ROLLBACK").run();
				return errorResponse('USERNAME_EXISTS', 'Username already exists.', 400);
			}
		} catch (txErr) {
			try { await db.prepare("ROLLBACK").run(); } catch (_) { /* ignore */ }
			throw txErr;
		}

		const tgId = telegram_user_id ? telegram_user_id.toString() : null;
	if (tgId) {
		const dup = await env.DB.prepare("SELECT id FROM users WHERE telegram_user_id = ?").bind(tgId).first();
		if (dup) {
			try { await db.prepare("ROLLBACK").run(); } catch (_) { /* ignore */ }
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
		await db.prepare("COMMIT").run();
		return jsonResponse({ success: true, userId });
	} catch (e) {
		try { await env.DB.prepare("ROLLBACK").run(); } catch (_) { /* ignore */ }
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
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return errorResponse('INVALID_INPUT', 'Invalid payload shape.', 400);
	}
	const updates = [];
	const bindings = [];

	if (payload.username) {
		if (typeof payload.username !== 'string' || !payload.username.trim()) {
		 return errorResponse('INVALID_INPUT', 'Username must be a non-empty string.', 400);
		}
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
		if (typeof payload.is_admin !== 'boolean') {
			return errorResponse('INVALID_INPUT', 'is_admin must be a boolean.', 400);
		}
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
		if (typeof payload.password !== 'string' || !payload.password.trim()) {
			return errorResponse('INVALID_INPUT', 'Password must be a non-empty string.', 400);
		}
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
	let admin = await env.DB.prepare("SELECT * FROM users WHERE is_admin = 1 AND id != ? LIMIT 1").bind(targetUserId).first();
	if (!admin) {
		admin = await ensureAdminUser(env);
		if (admin?.id === targetUserId) {
			admin = null;
		}
	}
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
	// 标记该用户的所有 Session 需强制失效，避免并发创建的会话漏删
	await env.NOTES_KV.put(`session_revoked:${targetUserId}`, Date.now().toString(), { expirationTtl: SESSION_DURATION_SECONDS });
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
	headers.append('Set-Cookie', buildSetCookie(SESSION_COOKIE, '', request, { maxAge: 0, httpOnly: true }));
	headers.append('Set-Cookie', buildSetCookie(CSRF_COOKIE, '', request, { maxAge: 0, httpOnly: false }));
	return jsonResponse({ success: true }, 200, headers);
}

export { ensureAdminUser };
