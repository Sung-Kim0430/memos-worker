import { SHARE_DEFAULT_TTL_SECONDS, SHARE_LOCK_TTL_SECONDS } from '../constants.js';
import { sanitizeContent } from '../utils/content.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { canModifyNote, requireSession } from '../utils/authz.js';

function parseNoteIdStrict(noteId) {
	if (noteId === null || noteId === undefined) return null;
	const num = Number(noteId);
	if (!Number.isInteger(num) || num <= 0) return null;
	if (String(num) !== String(noteId).trim()) return null;
	return num;
}

async function hashString(input) {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getShareTtlSeconds(env, publicId) {
	const list = await env.NOTES_KV.list({ prefix: `public_memo:${publicId}` });
	const entry = list.keys.find(k => k.name === `public_memo:${publicId}`);
	if (entry?.expiration) {
		const ttl = Math.floor(entry.expiration - Date.now() / 1000);
		return ttl > 0 ? ttl : 0;
	}
	return null;
}

async function cachePublicFile(env, shareId, privateUrl, kvPayload, ttlSeconds) {
	const cacheKey = `public_file_cache:${shareId}:${await hashString(privateUrl)}`;
	const existing = await env.NOTES_KV.get(cacheKey);
	if (existing) {
		return existing;
	}
	const newPublicId = crypto.randomUUID();
	const options = {};
	if (ttlSeconds && ttlSeconds > 0) {
		options.expirationTtl = ttlSeconds;
	}
	await env.NOTES_KV.put(`public_file:${newPublicId}`, JSON.stringify(kvPayload), options);
	await env.NOTES_KV.put(cacheKey, newPublicId, options);
	return newPublicId;
}

async function cleanupPublicFilesForShare(env, shareId) {
	const prefix = `public_file_cache:${shareId}:`;
	const list = await env.NOTES_KV.list({ prefix });
	for (const { name } of list.keys) {
		const publicFileId = await env.NOTES_KV.get(name);
		if (publicFileId) {
			await env.NOTES_KV.delete(`public_file:${publicFileId}`);
		}
		await env.NOTES_KV.delete(name);
	}
}

export async function handleShareFileRequest(noteId, fileId, request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const db = env.DB;
	const id = parseNoteIdStrict(noteId);
	if (!id) {
		return errorResponse('INVALID_NOTE_ID', 'Invalid Note ID', 400);
	}

	try {
		const note = await db.prepare("SELECT files, owner_id FROM notes WHERE id = ?").bind(id).first();
		if (!note) {
			return errorResponse('NOTE_NOT_FOUND', 'Note not found', 404);
		}
		if (!canModifyNote(note, session)) {
			return errorResponse('FORBIDDEN', 'Forbidden', 403);
		}

		let files = [];
		try {
			if (typeof note.files === 'string') {
				files = JSON.parse(note.files);
			}
		} catch (e) { /* ignore */ }

		const fileIndex = files.findIndex(f => f.id === fileId);
		if (fileIndex === -1) {
			return errorResponse('FILE_NOT_FOUND', 'File not found in this note', 404);
		}

		const file = files[fileIndex];
		let publicId = file.public_id;

		if (!publicId) {
			publicId = crypto.randomUUID();
			// 1. 在 KV 中存储映射关系，用于快速、免认证的查找
			await env.NOTES_KV.put(`public_file:${publicId}`, JSON.stringify({
				noteId: id,
				fileId: file.id,
				fileName: file.name,
				contentType: file.type
			}));

			// 2. 将 public_id 持久化到 D1 数据库中
			files[fileIndex].public_id = publicId;
			await db.prepare("UPDATE notes SET files = ? WHERE id = ?").bind(JSON.stringify(files), id).run();
		}

		const { protocol, host } = new URL(request.url);
		const publicUrl = `${protocol}//${host}/api/public/file/${publicId}`;

		return jsonResponse({ url: publicUrl });
	} catch (e) {
		console.error(`Share File Error (noteId: ${noteId}, fileId: ${fileId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database error while generating link', 500, e.message);
	}
}

export async function handlePublicFileRequest(publicId, request, env) {
	const kvData = await env.NOTES_KV.get(`public_file:${publicId}`, 'json');
	if (!kvData) {
		return errorResponse('PUBLIC_LINK_NOT_FOUND', 'Public link not found or has expired.', 404);
	}

	let object;
	let fileName;
	let contentType;

	if (kvData.telegramProxyId) {
		const botToken = env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return errorResponse('TELEGRAM_NOT_CONFIGURED', 'Bot not configured', 500);
		}
		try {
			const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${kvData.telegramProxyId}`;
			const fileInfoRes = await fetch(getFileUrl);
			const fileInfo = await fileInfoRes.json();

			if (!fileInfo.ok) {
				console.error(`Telegram getFile API error for file_id ${kvData.telegramProxyId}:`, fileInfo.description);
				return errorResponse('TELEGRAM_API_ERROR', `Telegram API error: ${fileInfo.description}`, 502);
			}

			const temporaryDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
			return Response.redirect(temporaryDownloadUrl, 302);
		} catch (e) {
			console.error("Telegram Public Proxy Error:", e);
			return errorResponse('TELEGRAM_PROXY_FAILED', 'Failed to proxy Telegram media', 500, e.message);
		}
	}

	if (kvData.standaloneImageId) {
		// 1. 是独立上传的图片
		object = await env.NOTES_R2_BUCKET.get(`uploads/${kvData.standaloneImageId}`);
		fileName = kvData.fileName || `image_${kvData.standaloneImageId}.png`;
		contentType = kvData.contentType || 'image/png';
	} else if (kvData.noteId && kvData.fileId) {
		// 2. 是笔记的附件
		object = await env.NOTES_R2_BUCKET.get(`${kvData.noteId}/${kvData.fileId}`);
		fileName = kvData.fileName;
		contentType = kvData.contentType;
	} else {
		return errorResponse('INVALID_PUBLIC_LINK', 'Invalid public link data.', 500);
	}

	if (object === null) {
		return errorResponse('FILE_NOT_FOUND', 'File not found in storage', 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=86400, immutable');

	headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);

	if (contentType) {
		headers.set('Content-Type', contentType);
	} else {
		const file = await env.NOTES_R2_BUCKET.head(object.key);
		const detectedContentType = file?.httpMetadata?.contentType || 'application/octet-stream';
		headers.set('Content-Type', detectedContentType);
	}

	return new Response(object.body, { headers });
}

export async function handleShareNoteRequest(noteId, request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const parsedNoteId = parseNoteIdStrict(noteId);
	if (!parsedNoteId) {
		return errorResponse('INVALID_NOTE_ID', 'Invalid Note ID', 400);
	}
	const lockKey = `share_lock:${parsedNoteId}`;
	let lockAcquired = false;
	try {
		const note = await env.DB.prepare("SELECT owner_id FROM notes WHERE id = ?").bind(parsedNoteId).first();
		if (!note) {
			return errorResponse('NOTE_NOT_FOUND', 'Note not found', 404);
		}
		if (!canModifyNote(note, session)) {
			return errorResponse('FORBIDDEN', 'Forbidden', 403);
		}
		try {
			await env.NOTES_KV.put(lockKey, '1', { expirationTtl: SHARE_LOCK_TTL_SECONDS, ifNotExists: true });
			lockAcquired = true;
		} catch (lockErr) {
			if (lockErr?.message?.includes('exists')) {
				return errorResponse('RESOURCE_LOCKED', 'Share update is in progress, please retry.', 409);
			}
			throw lockErr;
		}
		// 1) 检查 request body 中是否有 "expirationTtl" 字段
		const bodyText = await request.text();
		let body = {};
		try {
			body = bodyText ? JSON.parse(bodyText) : {};
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
			const noteShareKey = `note_share:${parsedNoteId}`;
			const publicMemoKey = `public_memo:${body.publicId}`;

		// --- 如果提供了 publicId 和新的 expirationTtl，则更新原有链接 ---
		if (body.publicId) {
			const currentPublicId = await env.NOTES_KV.get(noteShareKey);
			if (!currentPublicId || currentPublicId !== body.publicId) {
				return errorResponse('PUBLIC_LINK_NOT_FOUND', 'Shared memo not found. Cannot update expiration.', 404);
			}
			const memoData = await env.NOTES_KV.get(publicMemoKey);
			if (!memoData) {
				return errorResponse('PUBLIC_LINK_NOT_FOUND', 'Shared memo not found. Cannot update expiration.', 404);
			}

			// 确保请求显式提供有效 TTL；否则保持原样
			if (typeof body.expirationTtl !== 'number' || body.expirationTtl < 0) {
				return errorResponse('INVALID_INPUT', 'expirationTtl is required and must be >= 0', 400);
			}

			const options = {};
			if (body.expirationTtl > 0) {
				options.expirationTtl = body.expirationTtl;
			}

			// 使用新 TTL 重新写入两个键
			await Promise.all([
				env.NOTES_KV.put(publicMemoKey, memoData, options),
				env.NOTES_KV.put(noteShareKey, body.publicId, options)
			]);
			await cleanupPublicFilesForShare(env, body.publicId);

			return jsonResponse({ success: true, message: 'Expiration updated.' });

		} else {
			// --- 创建或获取新链接 ---
			let publicId = await env.NOTES_KV.get(`note_share:${parsedNoteId}`);

			if (!publicId) {
				publicId = crypto.randomUUID();
				// 默认过期时间为 1 小时 (3600 秒)
				const expirationTtl = (body.expirationTtl !== undefined) ? body.expirationTtl : SHARE_DEFAULT_TTL_SECONDS;
				const options = {};
				if (expirationTtl > 0) {
					options.expirationTtl = expirationTtl;
				}

				await Promise.all([
					env.NOTES_KV.put(`public_memo:${publicId}`, JSON.stringify({ noteId: parsedNoteId }), options),
					env.NOTES_KV.put(`note_share:${parsedNoteId}`, publicId, options)
				]);
			}

			const { protocol, host } = new URL(request.url);
			const displayUrl = `${protocol}//${host}/share/${publicId}`;
			const rawUrl = `${protocol}//${host}/api/public/note/raw/${publicId}`;

			return jsonResponse({ displayUrl, rawUrl, publicId }); // 返回 publicId 以便前端更新
		}
	} catch (e) {
		console.error(`Share/Update Note Error (noteId: ${noteId}):`, e);
		return errorResponse('SHARE_FAILED', 'Database or KV error during operation', 500, e.message);
	} finally {
		if (lockAcquired) {
			try { await env.NOTES_KV.delete(lockKey); } catch (cleanupErr) { console.error("Release share lock failed:", cleanupErr.message); }
		}
	}
}

export async function handleUnshareNoteRequest(noteId, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const parsedNoteId = parseNoteIdStrict(noteId);
	if (!parsedNoteId) {
		return errorResponse('INVALID_NOTE_ID', 'Invalid Note ID', 400);
	}
	try {
		const note = await env.DB.prepare("SELECT owner_id FROM notes WHERE id = ?").bind(parsedNoteId).first();
		if (!note) {
			return errorResponse('NOTE_NOT_FOUND', 'Note not found', 404);
		}
		if (!canModifyNote(note, session)) {
			return errorResponse('FORBIDDEN', 'Forbidden', 403);
		}
		const publicId = await env.NOTES_KV.get(`note_share:${parsedNoteId}`);
		if (publicId) {
			await Promise.all([
				env.NOTES_KV.delete(`public_memo:${publicId}`),
				env.NOTES_KV.delete(`note_share:${parsedNoteId}`)
			]);
			await cleanupPublicFilesForShare(env, publicId);
		}
		return jsonResponse({ success: true, message: 'Sharing has been revoked.' });
	} catch (e) {
		console.error(`Unshare Note Error (noteId: ${noteId}):`, e);
		return errorResponse('SHARE_REVOKE_FAILED', 'Database error while revoking link', 500, e.message);
	}
}

export async function handlePublicNoteRequest(publicId, env) {
	const kvData = await env.NOTES_KV.get(`public_memo:${publicId}`, 'json');
	if (!kvData || !kvData.noteId) {
		return errorResponse('PUBLIC_LINK_NOT_FOUND', 'Shared note not found or has expired', 404);
	}

	const noteId = kvData.noteId;

	try {
		const note = await env.DB.prepare("SELECT id, content, updated_at, files FROM notes WHERE id = ?").bind(noteId).first();
		if (!note) {
			return errorResponse('NOTE_NOT_FOUND', 'Shared note content not found', 404);
		}
		const shareTtlSeconds = await getShareTtlSeconds(env, publicId);

		// --- 辅助函数：将任何私有 URL 转换为公开 URL ---
			const createPublicUrlFor = async (privateUrl) => {
				const fileMatch = privateUrl.match(/^\/api\/files\/(\d+)\/([a-zA-Z0-9-]+)$/);
				const imageMatch = privateUrl.match(/^\/api\/images\/([a-zA-Z0-9-]+)$/);
				const tgProxyMatch = privateUrl.match(/^\/api\/tg-media-proxy\/([a-zA-Z0-9_-]+)$/);

				let kvPayload = null;
				if (fileMatch) {
					const targetNoteId = parseInt(fileMatch[1]);
					// 仅允许当前正在分享的笔记内部的文件生成公开链接，避免跨笔记 IDOR
					if (Number.isFinite(targetNoteId) && targetNoteId === note.id) {
						kvPayload = { noteId: targetNoteId, fileId: fileMatch[2], fileName: 'media' };
					}
				} else if (imageMatch) {
					kvPayload = { standaloneImageId: imageMatch[1], fileName: 'image.png' };
				} else if (tgProxyMatch) {
					kvPayload = { telegramProxyId: tgProxyMatch[1], fileName: 'tg-media', contentType: 'application/octet-stream' };
				}

			if (kvPayload) {
				const publicFileId = await cachePublicFile(env, publicId, privateUrl, kvPayload, shareTtlSeconds);
				return `/api/public/file/${publicFileId}`;
			}

			return privateUrl; // 如果不是有效的私有链接，则原样返回
		};

		// 1. 处理笔记正文 `content` 中的内联图片和视频
			const urlRegex = /(\/api\/(?:files|images|tg-media-proxy)\/[a-zA-Z0-9\/_.-]+)/g;
			const matches = [...note.content.matchAll(urlRegex)];
			let processedContent = '';
			let lastIndex = 0;
			for (const match of matches) {
				const privateUrl = match[0];
				const start = match.index ?? lastIndex;
				if (start > lastIndex) {
					processedContent += note.content.slice(lastIndex, start);
				}
				const publicUrl = await createPublicUrlFor(privateUrl);
				processedContent += publicUrl;
				lastIndex = start + privateUrl.length;
			}
			processedContent += note.content.slice(lastIndex);
		note.content = sanitizeContent(processedContent);

		// 2. 处理 `files` 附件列表
		let files = [];
		if (typeof note.files === 'string') {
			try { files = JSON.parse(note.files); } catch (e) { /* an empty array is fine */ }
		}
		for (const file of files) {
			if (file.type === 'telegram_document') {
				const proxyId = file.file_id || file.id;
				if (proxyId) {
					const publicFileId = await cachePublicFile(env, publicId, `/api/tg-media-proxy/${proxyId}`, {
						telegramProxyId: proxyId,
						fileName: file.name || 'tg-file',
						contentType: file.mime_type || 'application/octet-stream'
					}, shareTtlSeconds);
					file.public_url = `/api/public/file/${publicFileId}`;
				}
				continue;
			}
			if (file.id) { // 只处理有 id 的内部文件
				const privateUrl = `/api/files/${note.id}/${file.id}`;
				// 复用上面的逻辑，但这次我们知道所有元数据
				const filePublicId = await cachePublicFile(env, publicId, privateUrl, {
					noteId: note.id,
					fileId: file.id,
					fileName: file.name,
					contentType: file.type
				}, shareTtlSeconds);
				file.public_url = `/api/public/file/${filePublicId}`;
			}
		}
		note.files = files;

		// 3. 安全处理：移除敏感信息
		delete note.id;

		// `pics` 和 `videos` 字段的内容已经被处理并包含在 `content` 中，
		// 为保持 API 响应干净，我们不再需要它们。
		delete note.pics;
		delete note.videos;

		return jsonResponse(note);

	} catch (e) {
		console.error(`Public Note Error (publicId: ${publicId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handlePublicRawNoteRequest(publicId, env) {
	// 1. 从 KV 获取 noteId
	const kvData = await env.NOTES_KV.get(`public_memo:${publicId}`, 'json');
	if (!kvData || !kvData.noteId) {
		return errorResponse('PUBLIC_LINK_NOT_FOUND', 'Not Found', 404);
	}

	try {
		// 2. 使用获取到的 noteId 从 D1 查询笔记内容
		const note = await env.DB.prepare("SELECT content FROM notes WHERE id = ?").bind(kvData.noteId).first();
		if (!note) {
			return errorResponse('NOTE_NOT_FOUND', 'Not Found', 404);
		}
		const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' });
		return new Response(note.content, { headers });
	} catch (e) {
		console.error(`Public Raw Note Error (publicId: ${publicId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Server Error', 500, e.message);
	}
}
