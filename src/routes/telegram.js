import { processNoteTags } from '../utils/tags.js';

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

export async function handleTelegramProxy(request, env) {
	const { pathname } = new URL(request.url);
	const match = pathname.match(/^\/api\/tg-media-proxy\/([^\/]+)$/);

	if (!match || !match[1]) {
		return new Response('Invalid file_id', { status: 400 });
	}

	const fileId = match[1];
	const botToken = env.TELEGRAM_BOT_TOKEN;

	if (!botToken) {
		console.error("TELEGRAM_BOT_TOKEN secret is not set.");
		return new Response('Bot not configured', { status: 500 });
	}

	try {
		// 1. 调用 getFile API
		const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
		const fileInfoRes = await fetch(getFileUrl);
		const fileInfo = await fileInfoRes.json();

		if (!fileInfo.ok) {
			console.error(`Telegram getFile API error for file_id ${fileId}:`, fileInfo.description);
			return new Response(`Telegram API error: ${fileInfo.description}`, { status: 502 }); // 502 Bad Gateway
		}

		// 2. 构建临时的下载链接
		const temporaryDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;

		// 3. 返回 302 重定向
		return Response.redirect(temporaryDownloadUrl, 302);

	} catch (e) {
		console.error("Telegram Proxy Error:", e.message);
		return new Response('Failed to proxy Telegram media', { status: 500 });
	}
}

export async function handleTelegramWebhook(request, env, secret) {
	if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
		return new Response('Unauthorized', { status: 401 });
	}
	let chatId = null;
	const botToken = env.TELEGRAM_BOT_TOKEN;
	try {
		const update = await request.json();
		const message = update.message || update.channel_post;
		if (!message) {
			return new Response('OK', { status: 200 });
		}

		const authorizedIdsStr = env.AUTHORIZED_TELEGRAM_IDS;
		if (!authorizedIdsStr) {
			console.error("安全警告：AUTHORIZED_TELEGRAM_IDS 环境变量未设置。");
			return new Response('OK', { status: 200 });
		}
		chatId = message.chat.id;
		const senderId = message.from?.id;
		if (!senderId || authorizedIdsStr != senderId.toString()) {
			console.log(`已阻止来自未授权或未知用户 ${senderId || ''} 的请求。`);
			return new Response('OK', { status: 200 });
		}

		const db = env.DB;
		const bucket = env.NOTES_R2_BUCKET;
		if (!botToken) {
			console.error("TELEGRAM_BOT_TOKEN secret is not set.");
			return new Response('Bot not configured', { status: 500 });
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

		if (!contentFromTelegram.trim() && !photo && !document && !video) {
			return new Response('OK', { status: 200 });
		}
		const defaultSettings = { telegramProxy: false };
		const settings = await env.NOTES_KV.get('user_settings', 'json') || defaultSettings;

		// 1) 创建一个空内容的 note 占位
		const now = Date.now();
		const insertStmt = db.prepare("INSERT INTO notes (content, files, is_pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?) RETURNING id");
		const { id: noteId } = await insertStmt.bind("", "[]", now, now).first();

		const filesMeta = [];
		const picObjects = [];
		const mediaEmbeds = [];
		const videoObjects = [];

		// --- 处理照片 ---
		if (photo) {
			if (settings.telegramProxy) {
				// --- 代理模式 ---
				const proxyUrl = `/api/tg-media-proxy/${photo.file_id}`;
				mediaEmbeds.push(`![tg-image](${proxyUrl})`);
				picObjects.push(proxyUrl);
			} else {
				// --- 二次上传模式 ---
				const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`;
				const fileInfoRes = await fetch(getFileUrl);
				const fileInfo = await fileInfoRes.json();
				if (!fileInfo.ok) throw new Error(`Telegram getFile API 错误: ${fileInfo.description}`);
				const filePath = fileInfo.result.file_path;
				const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
				const fileRes = await fetch(downloadUrl);
				if (!fileRes.ok) throw new Error("从 Telegram 下载图片失败。");
				const fileId = crypto.randomUUID();
				await bucket.put(`${noteId}/${fileId}`, fileRes.body);
				const fileUrl = `/api/files/${noteId}/${fileId}`;
				mediaEmbeds.push(`![tg-image](${fileUrl})`);
				picObjects.push(fileUrl);
			}
		}

		if (video) {
			if (settings.telegramProxy) {
				// --- 代理模式 ---
				const proxyUrl = `/api/tg-media-proxy/${video.file_id}`;
				videoObjects.push(proxyUrl);
				mediaEmbeds.push(`[tg-video](${proxyUrl})`);
			} else {
				// --- 二次上传模式 ---
				const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${video.file_id}`;
				const fileInfoRes = await fetch(getFileUrl);
				const fileInfo = await fileInfoRes.json();
				if (!fileInfo.ok) throw new Error(`Telegram getFile API 错误 (video): ${fileInfo.description}`);
				const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
				const videoRes = await fetch(downloadUrl);
				if (!videoRes.ok) throw new Error("从 Telegram 下载视频失败。");
				const videoId = crypto.randomUUID();
				await bucket.put(`${noteId}/${videoId}`, videoRes.body, {
					httpMetadata: {
						contentType: video.mime_type || 'video/mp4'
					}
				});
				const videoUrl = `/api/files/${noteId}/${videoId}`;
				videoObjects.push(videoUrl);
				mediaEmbeds.push(`[tg-video](${videoUrl})`);
			}
		}

		if (document) {
			if (settings.telegramProxy) {
				// --- 代理模式 ---
				// 只存储 file_id, 不拉取文件内容
				filesMeta.push({
					type: 'telegram_document', // 特殊类型
					file_id: document.file_id,
					name: document.file_name,
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
				const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
				const fileRes = await fetch(downloadUrl);
				if (!fileRes.ok) throw new Error("从 Telegram 下载文件失败。");
				const fileId = crypto.randomUUID();
				await bucket.put(`${noteId}/${fileId}`, fileRes.body);
				filesMeta.push({
					id: fileId,
					name: document.file_name,
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

		const updateStmt = db.prepare("UPDATE notes SET content = ?, files = ?, pics = ?, videos = ? WHERE id = ?");
		await updateStmt.bind(
			finalContent,
			JSON.stringify(filesMeta),
			JSON.stringify(picObjects),
			JSON.stringify(videoObjects), // [新增] 绑定 videoObjects
			noteId
		).run();

		await processNoteTags(db, noteId, finalContent);
		await sendTelegramMessage(chatId, `✅ 笔记已保存！ (ID: ${noteId})`, botToken);

	} catch (e) {
		console.error("Telegram Webhook Error:", e.message);
		if (chatId && botToken) {
			await sendTelegramMessage(chatId, `❌ 保存笔记时出错: ${e.message}`, botToken);
		}
	}
	return new Response('OK', { status: 200 });
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
