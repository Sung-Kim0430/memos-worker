import { jsonResponse } from '../utils/response.js';

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
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	const db = env.DB;
	const id = parseInt(noteId);
	if (isNaN(id)) {
		return new Response('Invalid Note ID', { status: 400 });
	}

	try {
		const note = await db.prepare("SELECT files, owner_id FROM notes WHERE id = ?").bind(id).first();
		if (!note) {
			return jsonResponse({ error: 'Note not found' }, 404);
		}
		if (!(session?.isAdmin || (note.owner_id && session?.id === note.owner_id))) {
			return jsonResponse({ error: 'Forbidden' }, 403);
		}

		let files = [];
		try {
			if (typeof note.files === 'string') {
				files = JSON.parse(note.files);
			}
		} catch (e) { /* ignore */ }

		const fileIndex = files.findIndex(f => f.id === fileId);
		if (fileIndex === -1) {
			return jsonResponse({ error: 'File not found in this note' }, 404);
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
		console.error(`Share File Error (noteId: ${noteId}, fileId: ${fileId}):`, e.message);
		return jsonResponse({ error: 'Database error while generating link', message: e.message }, 500);
	}
}

export async function handlePublicFileRequest(publicId, request, env) {
	const kvData = await env.NOTES_KV.get(`public_file:${publicId}`, 'json');
	if (!kvData) {
		return new Response('Public link not found or has expired.', { status: 404 });
	}

	let object;
	let fileName;
	let contentType;

	if (kvData.telegramProxyId) {
		const botToken = env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return new Response('Bot not configured', { status: 500 });
		}
		try {
			const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${kvData.telegramProxyId}`;
			const fileInfoRes = await fetch(getFileUrl);
			const fileInfo = await fileInfoRes.json();

			if (!fileInfo.ok) {
				console.error(`Telegram getFile API error for file_id ${kvData.telegramProxyId}:`, fileInfo.description);
				return new Response(`Telegram API error: ${fileInfo.description}`, { status: 502 });
			}

			const temporaryDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
			return Response.redirect(temporaryDownloadUrl, 302);
		} catch (e) {
			console.error("Telegram Public Proxy Error:", e.message);
			return new Response('Failed to proxy Telegram media', { status: 500 });
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
		return new Response('Invalid public link data.', { status: 500 });
	}

	if (object === null) {
		return new Response('File not found in storage', { status: 404 });
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
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	try {
		const note = await env.DB.prepare("SELECT owner_id FROM notes WHERE id = ?").bind(noteId).first();
		if (!note) {
			return jsonResponse({ error: 'Note not found' }, 404);
		}
		if (!(session?.isAdmin || (note.owner_id && session?.id === note.owner_id))) {
			return jsonResponse({ error: 'Forbidden' }, 403);
		}
		// 1) 检查 request body 中是否有 "expirationTtl" 字段
		const bodyText = await request.text();
		let body = {};
		try {
			body = bodyText ? JSON.parse(bodyText) : {};
		} catch (e) {
			return jsonResponse({ error: 'Invalid JSON body' }, 400);
		}
		const noteShareKey = `note_share:${noteId}`;
		const publicMemoKey = `public_memo:${body.publicId}`;

		// --- 如果提供了 publicId 和新的 expirationTtl，则更新原有链接 ---
		if (body.publicId) {
			const memoData = await env.NOTES_KV.get(publicMemoKey);
			if (!memoData) {
				return jsonResponse({ error: 'Shared memo not found. Cannot update expiration.' }, 404);
			}

			// 确保请求显式提供有效 TTL；否则保持原样
			if (typeof body.expirationTtl !== 'number' || body.expirationTtl < 0) {
				return jsonResponse({ error: 'expirationTtl is required and must be >= 0' }, 400);
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
			let publicId = await env.NOTES_KV.get(`note_share:${noteId}`);

			if (!publicId) {
				publicId = crypto.randomUUID();
				// 默认过期时间为 1 小时 (3600 秒)
				const expirationTtl = (body.expirationTtl !== undefined) ? body.expirationTtl : 3600;
				const options = {};
				if (expirationTtl > 0) {
					options.expirationTtl = expirationTtl;
				}

				await Promise.all([
					env.NOTES_KV.put(`public_memo:${publicId}`, JSON.stringify({ noteId: parseInt(noteId, 10) }), options),
					env.NOTES_KV.put(`note_share:${noteId}`, publicId, options)
				]);
			}

			const { protocol, host } = new URL(request.url);
			const displayUrl = `${protocol}//${host}/share/${publicId}`;
			const rawUrl = `${protocol}//${host}/api/public/note/raw/${publicId}`;

			return jsonResponse({ displayUrl, rawUrl, publicId }); // 返回 publicId 以便前端更新
		}
	} catch (e) {
		console.error(`Share/Update Note Error (noteId: ${noteId}):`, e.message);
		return jsonResponse({ error: 'Database or KV error during operation' }, 500);
	}
}

export async function handleUnshareNoteRequest(noteId, env, session) {
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	try {
		const note = await env.DB.prepare("SELECT owner_id FROM notes WHERE id = ?").bind(noteId).first();
		if (!note) {
			return jsonResponse({ error: 'Note not found' }, 404);
		}
		if (!(session?.isAdmin || (note.owner_id && session?.id === note.owner_id))) {
			return jsonResponse({ error: 'Forbidden' }, 403);
		}
		const publicId = await env.NOTES_KV.get(`note_share:${noteId}`);
		if (publicId) {
			await Promise.all([
				env.NOTES_KV.delete(`public_memo:${publicId}`),
				env.NOTES_KV.delete(`note_share:${noteId}`)
			]);
			await cleanupPublicFilesForShare(env, publicId);
		}
		return jsonResponse({ success: true, message: 'Sharing has been revoked.' });
	} catch (e) {
		console.error(`Unshare Note Error (noteId: ${noteId}):`, e.message);
		return jsonResponse({ error: 'Database error while revoking link' }, 500);
	}
}

export async function handlePublicNoteRequest(publicId, env) {
	const kvData = await env.NOTES_KV.get(`public_memo:${publicId}`, 'json');
	if (!kvData || !kvData.noteId) {
		return jsonResponse({ error: 'Shared note not found or has expired' }, 404);
	}

	const noteId = kvData.noteId;

	try {
		const note = await env.DB.prepare("SELECT id, content, updated_at, files FROM notes WHERE id = ?").bind(noteId).first();
		if (!note) {
			return jsonResponse({ error: 'Shared note content not found' }, 404);
		}
		const shareTtlSeconds = await getShareTtlSeconds(env, publicId);

		// --- 辅助函数：将任何私有 URL 转换为公开 URL ---
			const createPublicUrlFor = async (privateUrl) => {
				const fileMatch = privateUrl.match(/^\/api\/files\/(\d+)\/([a-zA-Z0-9-]+)$/);
				const imageMatch = privateUrl.match(/^\/api\/images\/([a-zA-Z0-9-]+)$/);
				const tgProxyMatch = privateUrl.match(/^\/api\/tg-media-proxy\/([a-zA-Z0-9_-]+)$/);

				let kvPayload = null;
				if (fileMatch) {
					kvPayload = { noteId: parseInt(fileMatch[1]), fileId: fileMatch[2], fileName: 'media' };
				} else if (imageMatch) {
					kvPayload = { standaloneImageId: imageMatch[1], fileName: 'image.png' };
				} else if (tgProxyMatch) {
					kvPayload = { telegramProxyId: tgProxyMatch[1], fileName: 'tg-media', contentType: 'application/octet-stream' };
				}

			if (kvPayload) {
				const publicFileId = await cachePublicFile(env, publicId, privateUrl, kvPayload, shareTtlSeconds);
				return `/api/public/file/${publicFileId}`;
			}

			return privateUrl; // 如果不是私有链接，则原样返回
		};

		// 1. 处理笔记正文 `content` 中的内联图片和视频
			const urlRegex = /(\/api\/(?:files|images|tg-media-proxy)\/[a-zA-Z0-9\/_.-]+)/g;
			const matches = [...note.content.matchAll(urlRegex)];
			let processedContent = note.content;
			for (const match of matches) {
				const privateUrl = match[0];
				const publicUrl = await createPublicUrlFor(privateUrl);
				const escaped = privateUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				processedContent = processedContent.replace(new RegExp(escaped, 'g'), publicUrl);
			}
		note.content = processedContent;

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
		console.error(`Public Note Error (publicId: ${publicId}):`, e.message);
		return jsonResponse({ error: 'Database Error' }, 500);
	}
}

export async function handlePublicRawNoteRequest(publicId, env) {
	// 1. 从 KV 获取 noteId
	const kvData = await env.NOTES_KV.get(`public_memo:${publicId}`, 'json');
	if (!kvData || !kvData.noteId) {
		return new Response('Not Found', { status: 404 });
	}

	try {
		// 2. 使用获取到的 noteId 从 D1 查询笔记内容
		const note = await env.DB.prepare("SELECT content FROM notes WHERE id = ?").bind(kvData.noteId).first();
		if (!note) {
			return new Response('Not Found', { status: 404 });
		}
		const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' });
		return new Response(note.content, { headers });
	} catch (e) {
		console.error(`Public Raw Note Error (publicId: ${publicId}):`, e.message);
		return new Response('Server Error', { status: 500 });
	}
}
