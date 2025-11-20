import { SESSION_COOKIE, SESSION_DURATION_SECONDS } from '../constants.js';
import { jsonResponse } from '../utils/response.js';

const PBKDF_ITERATIONS = 100000; // Workers 限制 100k 以内

async function deriveKey(password, salt, iterations = PBKDF_ITERATIONS) {
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

async function hashPassword(password, salt = crypto.randomUUID()) {
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
		throw new Error("USERNAME/PASSWORD environment variables must be set for admin bootstrap.");
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

export async function isSessionAuthenticated(request, env) {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader || !cookieHeader.includes(SESSION_COOKIE)) {
		return null;
	}
	const cookies = cookieHeader.split(';').map(c => c.trim());
	const sessionCookie = cookies.find(c => c.startsWith(`${SESSION_COOKIE}=`));
	if (!sessionCookie) return null;
	const sessionId = sessionCookie.split('=')[1];
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
		const { username, password } = await request.json();
		if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
			return jsonResponse({ error: 'Invalid credentials' }, 401);
		}
		const user = await getUserByUsername(env, username);
		if (user && await verifyPassword(password, user)) {
			const sessionId = crypto.randomUUID();
			const sessionData = { userId: user.id, username: user.username, isAdmin: !!user.is_admin, loggedInAt: Date.now() };
			await env.NOTES_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), {
				expirationTtl: SESSION_DURATION_SECONDS,
			});
			const headers = new Headers();
			headers.append('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}`);
			return jsonResponse({ success: true, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } }, 200, headers);
		}
	} catch (e) {
		console.error("Login Error:", e.message);
		return jsonResponse({ error: 'Server error during login', message: e.message }, 500);
	}
	return jsonResponse({ error: 'Invalid credentials' }, 401);
}

export async function handleRegister(request, env, session) {
	try {
		const { username, password, isAdmin = false, telegram_user_id } = await request.json();
		if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
			return jsonResponse({ error: 'Username and password are required.' }, 400);
		}
		const totalUsers = await getUserCount(env);
		if (totalUsers > 0 && (!session || !session.isAdmin)) {
			return jsonResponse({ error: 'Only admin can create new users.' }, 403);
		}
	if (await getUserByUsername(env, username)) {
		return jsonResponse({ error: 'Username already exists.' }, 400);
	}
	if (telegram_user_id) {
		const dup = await env.DB.prepare("SELECT id FROM users WHERE telegram_user_id = ?").bind(telegram_user_id).first();
		if (dup) {
			return jsonResponse({ error: 'Telegram user id already bound.' }, 400);
		}
	}
	const { hash, salt } = await hashPassword(password);
		const now = Date.now();
		const userId = crypto.randomUUID();
		const isFirstUser = totalUsers === 0;
		await env.DB.prepare(
			"INSERT INTO users (id, username, password_hash, salt, is_admin, telegram_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
		).bind(
			userId,
			username,
			hash,
			salt,
			isFirstUser ? 1 : (isAdmin && session?.isAdmin ? 1 : 0),
			telegram_user_id || null,
			now
		).run();
		return jsonResponse({ success: true, userId });
	} catch (e) {
		console.error("Register Error:", e.message);
		return jsonResponse({ error: 'Failed to register user', message: e.message }, 500);
	}
}

async function ensureAtLeastOneAdmin(env, excludeUserId = null) {
	const row = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1 AND id != ?").bind(excludeUserId).first();
	return (row?.count || 0) > 0;
}

export async function handleUsersList(env, session) {
	if (!session?.isAdmin) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	const { results } = await env.DB.prepare("SELECT id, username, is_admin, telegram_user_id, created_at FROM users ORDER BY created_at ASC").all();
	return jsonResponse({ users: results });
}

export async function handleUserUpdate(request, env, targetUserId, session) {
	if (!session?.isAdmin) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	const target = await getUserById(env, targetUserId);
	if (!target) {
		return jsonResponse({ error: 'User not found' }, 404);
	}
	const payload = await request.json();
	const updates = [];
	const bindings = [];

	if (payload.username) {
		const exists = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id != ?").bind(payload.username, targetUserId).first();
		if (exists) {
			return jsonResponse({ error: 'Username already exists.' }, 400);
		}
		updates.push("username = ?");
		bindings.push(payload.username);
	}
	if (payload.hasOwnProperty('telegram_user_id')) {
		if (payload.telegram_user_id) {
			const dup = await env.DB.prepare("SELECT id FROM users WHERE telegram_user_id = ? AND id != ?").bind(payload.telegram_user_id, targetUserId).first();
			if (dup) {
				return jsonResponse({ error: 'Telegram user id already bound.' }, 400);
			}
		}
		updates.push("telegram_user_id = ?");
		bindings.push(payload.telegram_user_id || null);
	}
	if (payload.hasOwnProperty('is_admin')) {
		const keepAdmin = payload.is_admin ? 1 : 0;
		if (!keepAdmin) {
			const hasOtherAdmin = await ensureAtLeastOneAdmin(env, targetUserId);
			if (!hasOtherAdmin) {
				return jsonResponse({ error: 'Cannot remove the last admin.' }, 400);
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
		return jsonResponse({ error: 'No fields to update.' }, 400);
	}
	const stmt = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
	bindings.push(targetUserId);
	await env.DB.prepare(stmt).bind(...bindings).run();
	return jsonResponse({ success: true });
}

export async function handleUserDelete(env, targetUserId, session) {
	if (!session?.isAdmin) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	const target = await getUserById(env, targetUserId);
	if (!target) {
		return jsonResponse({ error: 'User not found' }, 404);
	}
	if (target.is_admin) {
		const hasOtherAdmin = await ensureAtLeastOneAdmin(env, targetUserId);
		if (!hasOtherAdmin) {
			return jsonResponse({ error: 'Cannot delete the last admin.' }, 400);
		}
	}
	const admin = await ensureAdminUser(env);
	// 转移该用户的笔记给管理员
	await env.DB.prepare("UPDATE notes SET owner_id = ? WHERE owner_id = ?").bind(admin.id, targetUserId).run();
	await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId).run();
	return jsonResponse({ success: true });
}

export async function handleLogout(request, env) {
	const cookieHeader = request.headers.get('Cookie');
	if (cookieHeader && cookieHeader.includes(SESSION_COOKIE)) {
		const sessionId = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
		if (sessionId) {
			await env.NOTES_KV.delete(`session:${sessionId}`);
		}
	}
	const headers = new Headers();
	headers.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
	return jsonResponse({ success: true }, 200, headers);
}

export { ensureAdminUser };
