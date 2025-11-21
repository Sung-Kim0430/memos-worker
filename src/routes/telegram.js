import { cleanupUnusedTags, processNoteTags } from '../utils/tags.js';
import { ensureAdminUser } from './auth.js';
import { ALLOWED_UPLOAD_MIME_TYPES, DEFAULT_USER_SETTINGS, MAX_FILENAME_LENGTH, MAX_UPLOAD_BYTES, TELEGRAM_PROXY_TTL_SECONDS } from '../constants.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { requireSession } from '../utils/authz.js';

const TG_PROXY_PREFIX = 'tg-proxy:';

function parseAuthorizedIds(raw) {
	if (!raw) return [];
	return raw.split(',').map(v => v.trim()).filter(Boolean);
}

function exceedsSizeLimit(size) {
	return Number.isFinite(size) && size > MAX_UPLOAD_BYTES;
}

function isAllowedMimeType(mime) {
	return !!mime && ALLOWED_UPLOAD_MIME_TYPES.includes(mime);
}

function normalizeFileName(name) {
	const safe = (name || '').toString();
	return safe.length > MAX_FILENAME_LENGTH ? safe.slice(0, MAX_FILENAME_LENGTH) : safe;
}

function parseIp(ip) {
	const parts = (ip || '').split('.').map(p => parseInt(p, 10));
	if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return null;
	return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isIpAllowed(ip, allowlist) {
	if (!allowlist || allowlist.length === 0) return true;
	const ipNum = parseIp(ip);
	if (ipNum === null) return false;
	for (const entry of allowlist) {
		if (!entry) continue;
		const trimmed = entry.trim();
		if (!trimmed) continue;
		if (!trimmed.includes('/')) {
			if (trimmed === ip) return true;
			continue;
		}
		const [cidrIp, maskBitsStr] = trimmed.split('/');
		const baseNum = parseIp(cidrIp);
		const maskBits = parseInt(maskBitsStr, 10);
		if (baseNum === null || Number.isNaN(maskBits) || maskBits < 0 || maskBits > 32) continue;
		const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
		if ((ipNum & mask) === (baseNum & mask)) return true;
	}
	return false;
}

async function createTelegramProxyMapping(env, fileId, mediaType, mimeType = null) {
	const proxyId = crypto.randomUUID();
	await env.NOTES_KV.put(`${TG_PROXY_PREFIX}${proxyId}`, JSON.stringify({ fileId, mediaType, mimeType }), { expirationTtl: TELEGRAM_PROXY_TTL_SECONDS });
	return proxyId;
}

async function resolveTelegramProxyMapping(env, proxyId) {
	return env.NOTES_KV.get(`${TG_PROXY_PREFIX}${proxyId}`, 'json');
}

async function resolveTelegramUser(env, telegramUserId) {
	telegramUserId = telegramUserId?.toString() || null;
	if (!telegramUserId) {
		return ensureAdminUser(env);
	}
	const existing = await env.DB.prepare("SELECT * FROM users WHERE telegram_user_id = ?").bind(telegramUserId).first();
	if (existing) return existing;
	try {
		return await ensureAdminUser(env);
	} catch (e) {
		// If ensureAdminUser fails (e.g. missing env vars), try to find ANY admin
		const admin = await env.DB.prepare("SELECT * FROM users WHERE is_admin = 1 LIMIT 1").first();
		if (admin) return admin;
		throw e;
	}
}

export function telegramEntitiesToMarkdown(text, entities = []) {
	if (!entities || entities.length === 0) {
		return text;
	}

	// 优先级决定了标签的嵌套顺序。数字越小，越在外层。
	const tagPriority = {
		'text_link': 10,
		'bold': 20,
		'italic': 30, // 使用 _ 作为斜体标记，避免与 ** 的 * 冲突
		'underline': 40,
		'strikethrough': 50,
		'spoiler': 60,
		'code': 70,
		'pre': 80
	};
	const mods = Array.from({ length: text.length + 1 }, () => ({ openTags: [], closeTags: [] }));
	entities.forEach(entity => {
		const { type, offset, length, url, language } = entity;
		const endOffset = offset + length;
		const priority = tagPriority[type] || 100;
		let startTag = '', endTag = '';
		switch (type) {
			case 'bold': startTag = '**'; endTag = '**'; break;
			case 'italic': startTag = '_'; endTag = '_'; break;
			case 'underline': startTag = '__'; endTag = '__'; break;
			case 'strikethrough': startTag = '~~'; endTag = '~~'; break;
			case 'spoiler': startTag = '||'; endTag = '||'; break;
			case 'code': startTag = '`'; endTag = '`'; break;
			case 'text_link':
				startTag = '[';
				const encodedUrl = url.replace(/\(/g, '%28').replace(/\)/g, '%29');
				endTag = `](${encodedUrl})`;
				break;
			case 'pre':
				startTag = `\`\`\`${language || ''}\n`; endTag = '\n```'; break;
		}

		if (startTag) {
			mods[offset].openTags.push({ tag: startTag, priority });
			mods[endOffset].closeTags.push({ tag: endTag, priority });
		}
	});

	let result = '';
	let lastIndex = 0;
	const adjacentSensitiveTags = ['**', '_', '__', '~~', '||', '`'];

	for (let i = 0; i <= text.length; i++) {
		const mod = mods[i];
		if (mod.openTags.length === 0 && mod.closeTags.length === 0) {
			continue;
		}
		result += text.substring(lastIndex, i);
		//   - 闭合标签按优先级从高到低（内层先关）
		//   - 起始标签按优先级从低到高（外层先开）
		const closeTags = mod.closeTags.sort((a, b) => b.priority - a.priority);
		const openTags = mod.openTags.sort((a, b) => a.priority - b.priority);

		closeTags.forEach(({ tag }) => {
			if (adjacentSensitiveTags.includes(tag) && result.endsWith(tag)) {
				result += '\u200B'; // 插入零宽度空格
			}
			result += tag;
		});

		openTags.forEach(({ tag }) => {
			if (adjacentSensitiveTags.includes(tag) && result.endsWith(tag)) {
				result += '\u200B'; // 插入零宽度空格
			}
			result += tag;
		});

		lastIndex = i;
	}

	if (lastIndex < text.length) {
		result += text.substring(lastIndex);
	}
	result = result.replace(
		/\*\*((?:(?:\p{Emoji}|\p{Emoji_Component})+))\*\*/gu,
		'$1'
	);
	result = result.replace(/\*\*(\s+)\*\*/g, '$1');
	result = result.replace(/\*\*(\s+)(.*?)\*\*/g, '$1**$2**');
	return result;
}

export async function handleTelegramProxy(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const { pathname } = new URL(request.url);
	const match = pathname.match(/^\/api\/tg-media-proxy\/([^\/]+)$/);

	if (!match || !match[1]) {
		return errorResponse('INVALID_INPUT', 'Invalid file_id', 400);
	}

	const proxyId = match[1];
	if (!/^[A-Za-z0-9_-]+$/.test(proxyId)) {
		return errorResponse('INVALID_INPUT', 'Invalid file_id', 400);
	}
	const mapping = await resolveTelegramProxyMapping(env, proxyId);
	const fileId = mapping?.fileId || proxyId;
	const botToken = env.TELEGRAM_BOT_TOKEN;

	if (!botToken) {
		console.error("TELEGRAM_BOT_TOKEN secret is not set.");
		return errorResponse('TELEGRAM_NOT_CONFIGURED', 'Bot not configured', 500);
	}

	try {
		// 1. 调用 getFile API
			const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
			const fileInfoRes = await fetch(getFileUrl);
			const fileInfo = await fileInfoRes.json();

			if (!fileInfo.ok) {
				console.error(`Telegram getFile API error for file_id ${fileId}:`, fileInfo.description, fileInfo);
				return errorResponse('TELEGRAM_API_ERROR', `Telegram API error: ${fileInfo.description}`, 502);
			}

		// 2. 构建临时的下载链接
		const temporaryDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;

			// 3. 返回 302 重定向
			return Response.redirect(temporaryDownloadUrl, 302);

		} catch (e) {
			console.error("Telegram Proxy Error:", e);
			return errorResponse('TELEGRAM_PROXY_FAILED', 'Failed to proxy Telegram media', 500, e.message);
		}
	}

async function processTelegramUpdate(request, env) {
	let chatId = null;
	const botToken = env.TELEGRAM_BOT_TOKEN;
	const bucket = env.NOTES_R2_BUCKET;
	let noteId = null;
	const cleanupKeys = [];
	try {
		let update;
		try {
			update = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid Telegram payload', 400);
		}
		const message = update.message || update.channel_post;
		if (!message) {
			return jsonResponse({ success: true });
		}

		const authorizedEntries = parseAuthorizedIds(env.AUTHORIZED_TELEGRAM_IDS);
		if (authorizedEntries.length === 0) {
			console.error("安全警告：AUTHORIZED_TELEGRAM_IDS 环境变量未设置。");
			return jsonResponse({ success: true });
		}
		chatId = message.chat.id;
		const senderId = message.from?.id;
		const senderIdStr = senderId?.toString() || '';
		const mappingEntry = authorizedEntries.find(entry => entry.split(':')[0] === senderIdStr);
		if (!mappingEntry) {
			console.log(`已阻止来自未授权或未知用户 ${senderId || ''} 的请求。`);
			return jsonResponse({ success: true });
		}
		const mappedUsername = mappingEntry.split(':')[1];
		let ownerUser = null;
		if (mappedUsername) {
			ownerUser = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(mappedUsername).first();
		}
		if (!ownerUser) {
			ownerUser = await resolveTelegramUser(env, senderIdStr);
		}

		const db = env.DB;
		if (!botToken) {
			console.error("TELEGRAM_BOT_TOKEN secret is not set.");
			return errorResponse('TELEGRAM_NOT_CONFIGURED', 'Bot not configured', 500);
		}

		const text = message.text || message.caption || '';
		const entities = message.entities || message.caption_entities || [];
		const contentFromTelegram = telegramEntitiesToMarkdown(text, entities);

		let forwardInfo = '';
		if (message.forward_from_chat) {
			const chat = message.forward_from_chat;
			const title = chat.title || 'a channel';
			if (chat.username) {
				const channelUrl = `https://t.me/${chat.username}`;
				forwardInfo = `*Forwarded from [${title}](${channelUrl})*`;
			} else {
				forwardInfo = `*Forwarded from ${title}*`;
			}
		} else if (message.forward_from) {
			const fromName = `${message.forward_from.first_name || ''} ${message.forward_from.last_name || ''}`.trim();
			forwardInfo = `*Forwarded from ${fromName}*`;
		}

		let replyMarkdown = '';
		if (message.reply_to_message) {
			const originalMessage = message.reply_to_message;
			const originalText = originalMessage.text || originalMessage.caption || '';
			const originalEntities = originalMessage.entities || originalMessage.caption_entities || [];
			const originalContentMarkdown = telegramEntitiesToMarkdown(originalText, originalEntities);
			if (originalContentMarkdown.trim()) {
				replyMarkdown = originalContentMarkdown.trim().split('\n').map(line => `> ${line}`).join('\n');
			}
		}

		const photo = message.photo ? message.photo[message.photo.length - 1] : null;
		const document = message.document;
		const video = message.video;

		// 基础校验：限制体积和 MIME 类型，避免滥用上传
		const validationErrors = [];
		if (photo?.file_size && exceedsSizeLimit(photo.file_size)) {
			validationErrors.push('照片大小超过上限');
		}
		if (video?.file_size && exceedsSizeLimit(video.file_size)) {
			validationErrors.push('视频大小超过上限');
		}
		if (document?.file_size && exceedsSizeLimit(document.file_size)) {
			validationErrors.push('文件大小超过上限');
		}
		if (video?.mime_type && !isAllowedMimeType(video.mime_type)) {
			validationErrors.push('不支持的视频类型');
		}
		if (document?.mime_type && !isAllowedMimeType(document.mime_type)) {
			validationErrors.push('不支持的文件类型');
		}
			if (validationErrors.length > 0) {
				await sendTelegramMessage(chatId, `❌ 无法保存笔记：${validationErrors.join('、')}（上限 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB）`, botToken);
				return jsonResponse({ success: true });
			}

			if (!contentFromTelegram.trim() && !photo && !document && !video) {
				return jsonResponse({ success: true });
			}
		const settings = await env.NOTES_KV.get('user_settings', 'json') || DEFAULT_USER_SETTINGS;

		// 1) 创建一个空内容的 note 占位
		const now = Date.now();
		const insertStmt = db.prepare("INSERT INTO notes (content, files, is_pinned, created_at, updated_at, owner_id, visibility, pics, videos) VALUES (?, ?, 0, ?, ?, ?, ?, '[]', '[]') RETURNING id");
		const created = await insertStmt.bind("", "[]", now, now, ownerUser.id, 'private').first();
		noteId = created?.id;
		if (!noteId) {
			throw new Error('Failed to create note placeholder');
		}

		const filesMeta = [];
		const picObjects = [];
		const mediaEmbeds = [];
		const videoObjects = [];

			// --- 处理照片 ---
			if (photo) {
				if (settings.telegramProxy) {
					// --- 代理模式 ---
					const proxyId = await createTelegramProxyMapping(env, photo.file_id, 'photo', 'image');
					const proxyUrl = `/api/tg-media-proxy/${proxyId}`;
					mediaEmbeds.push(`![tg-image](${proxyUrl})`);
					picObjects.push(proxyUrl);
				} else {
				// --- 二次上传模式 ---
				const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`;
				const fileInfoRes = await fetch(getFileUrl);
				const fileInfo = await fileInfoRes.json();
				if (!fileInfo.ok) throw new Error(`Telegram getFile API 错误: ${fileInfo.description}`);
				const photoSize = Number(fileInfo.result?.file_size);
				if (exceedsSizeLimit(photoSize)) {
					throw new Error('Telegram photo exceeds size limit');
				}
				const filePath = fileInfo.result.file_path;
				const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
				const fileRes = await fetch(downloadUrl);
				if (!fileRes.ok) throw new Error("从 Telegram 下载图片失败。");
				const fileId = crypto.randomUUID();
				const r2Key = `${noteId}/${fileId}`;
				await bucket.put(r2Key, fileRes.body);
				cleanupKeys.push(r2Key);
				const fileUrl = `/api/files/${noteId}/${fileId}`;
				mediaEmbeds.push(`![tg-image](${fileUrl})`);
				picObjects.push(fileUrl);
			}
		}

			if (video) {
				if (settings.telegramProxy) {
					// --- 代理模式 ---
					const proxyId = await createTelegramProxyMapping(env, video.file_id, 'video', video.mime_type || 'video/mp4');
					const proxyUrl = `/api/tg-media-proxy/${proxyId}`;
					videoObjects.push(proxyUrl);
					mediaEmbeds.push(`[tg-video](${proxyUrl})`);
				} else {
				// --- 二次上传模式 ---
				const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${video.file_id}`;
				const fileInfoRes = await fetch(getFileUrl);
				const fileInfo = await fileInfoRes.json();
				if (!fileInfo.ok) throw new Error(`Telegram getFile API 错误 (video): ${fileInfo.description}`);
				const videoSize = Number(fileInfo.result?.file_size);
				if (exceedsSizeLimit(videoSize)) {
					throw new Error('Telegram video exceeds size limit');
				}
				const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
				const videoRes = await fetch(downloadUrl);
				if (!videoRes.ok) throw new Error("从 Telegram 下载视频失败。");
				const videoId = crypto.randomUUID();
				const r2Key = `${noteId}/${videoId}`;
				await bucket.put(r2Key, videoRes.body, {
					httpMetadata: {
						contentType: video.mime_type || 'video/mp4'
					}
				});
				cleanupKeys.push(r2Key);
				const videoUrl = `/api/files/${noteId}/${videoId}`;
				videoObjects.push(videoUrl);
				mediaEmbeds.push(`[tg-video](${videoUrl})`);
			}
		}

			if (document) {
				if (settings.telegramProxy) {
					// --- 代理模式 ---
					// 只存储 file_id, 不拉取文件内容
					const proxyId = await createTelegramProxyMapping(env, document.file_id, 'document', document.mime_type || 'application/octet-stream');
					filesMeta.push({
						id: proxyId,
						type: 'telegram_document', // 特殊类型标记
						file_id: proxyId,
						mime_type: document.mime_type || 'application/octet-stream',
						name: normalizeFileName(document.file_name),
						size: document.file_size
					});
				// 可以在正文加一个占位符，但这需要前端支持渲染
				// finalContent += `\n\n[Proxy File: ${document.file_name}]`;
			} else {
				// --- 二次上传模式 ---
				const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${document.file_id}`;
				const fileInfoRes = await fetch(getFileUrl);
				const fileInfo = await fileInfoRes.json();
				if (!fileInfo.ok) throw new Error(`Telegram getFile API 错误 (document): ${fileInfo.description}`);
				const docSize = Number(fileInfo.result?.file_size);
				if (exceedsSizeLimit(docSize)) {
					throw new Error('Telegram document exceeds size limit');
				}
				const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
				const fileRes = await fetch(downloadUrl);
				if (!fileRes.ok) throw new Error("从 Telegram 下载文件失败。");
				const fileId = crypto.randomUUID();
				const r2Key = `${noteId}/${fileId}`;
				await bucket.put(r2Key, fileRes.body);
				cleanupKeys.push(r2Key);
				filesMeta.push({
					id: fileId,
					name: normalizeFileName(document.file_name),
					size: document.file_size,
					type: document.mime_type || 'application/octet-stream'
				});
			}
		}

		const contentParts = [];
		if (forwardInfo) contentParts.push(forwardInfo);
		if (mediaEmbeds.length > 0) contentParts.push(mediaEmbeds.join('\n'));
		if (replyMarkdown) contentParts.push(replyMarkdown);
		if (contentFromTelegram.trim()) contentParts.push(contentFromTelegram.trim());

		let finalContent = "#TG " + contentParts.join('\n\n');
		if (finalContent.length > MAX_NOTE_CONTENT_LENGTH) {
			throw new Error('Note content exceeds allowed length');
		}

		const updateStmt = db.prepare("UPDATE notes SET content = ?, files = ?, pics = ?, videos = ? WHERE id = ?");
		await updateStmt.bind(
			finalContent,
			JSON.stringify(filesMeta),
			JSON.stringify(picObjects),
			JSON.stringify(videoObjects), // [新增] 绑定 videoObjects
			noteId
		).run();

		await processNoteTags(db, noteId, finalContent);
		await cleanupUnusedTags(db);
		await sendTelegramMessage(chatId, `✅ 笔记已保存！ (ID: ${noteId})`, botToken);

		} catch (e) {
			console.error("Telegram Webhook Error:", e);
			if (noteId) {
				try {
					await env.DB.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId).run();
					await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(noteId).run();
			} catch (cleanupError) {
				console.error("Failed to cleanup note:", cleanupError.message);
			}
			try { await cleanupUnusedTags(env.DB); } catch (cleanupError) { console.error("Cleanup unused tags failed:", cleanupError.message); }
		}
			if (cleanupKeys.length > 0) {
				try {
					await bucket.delete(cleanupKeys);
				} catch (cleanupError) {
					console.error("Failed to cleanup uploaded files:", cleanupError.message);
				}
			}
			if (chatId && botToken) {
				await sendTelegramMessage(chatId, `❌ 保存笔记时出错: ${e.message}`, botToken);
			}
		}
		return jsonResponse({ success: true });
	}

export async function handleTelegramWebhook(request, env, secret, ctx) {
	const headerToken = request.headers.get('x-telegram-bot-api-secret-token');
	if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
		return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
	}
	if (headerToken && headerToken !== env.TELEGRAM_WEBHOOK_SECRET) {
		return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
	}
	const ip = request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
	const allowlist = (env.TELEGRAM_IP_WHITELIST || '').split(',').map(v => v.trim()).filter(Boolean);
	if (!isIpAllowed(ip, allowlist)) {
		return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
	}
	if (ctx) {
		// 将耗时处理交给 waitUntil，快速返回 200，减少 Telegram 重试
		const cloned = request.clone();
		ctx.waitUntil(processTelegramUpdate(cloned, env).catch(err => console.error("Telegram webhook async error:", err)));
		return jsonResponse({ success: true });
	}
	// 兼容无 ctx 场景
	return processTelegramUpdate(request, env);
}

export async function sendTelegramMessage(chatId, text, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	const payload = {
		chat_id: chatId,
		text: text,
		parse_mode: 'Markdown' // 也可以使用 'HTML'
	};

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		if (!response.ok) {
			const errorBody = await response.json();
			console.error(`Failed to send Telegram message: ${errorBody.description}`);
		}
	} catch (error) {
		console.error(`Error sending Telegram message: ${error.message}`);
	}
}
