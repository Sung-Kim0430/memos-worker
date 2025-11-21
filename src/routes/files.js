import { errorResponse } from '../utils/response.js';
import { canAccessNote, requireSession } from '../utils/authz.js';

export async function handleFileRequest(noteId, fileId, request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const db = env.DB;
	const id = parseInt(noteId);
	if (isNaN(id)) {
		return errorResponse('INVALID_NOTE_ID', 'Invalid Note ID', 400);
	}

	// 尝试从数据库获取元数据
	const note = await db.prepare("SELECT files, owner_id, visibility FROM notes WHERE id = ?").bind(id).first();

	if (!note) {
		return errorResponse('NOTE_NOT_FOUND', 'Note not found', 404);
	}

	if (!note.visibility) {
		note.visibility = 'private';
	}

	if (!canAccessNote(note, session)) {
		return errorResponse('FORBIDDEN', 'Forbidden', 403);
	}

	let files = [];
	if (note) {
		try {
			if (typeof note.files === 'string') {
				files = JSON.parse(note.files);
			} else if (Array.isArray(note.files)) {
				files = note.files;
			}
		} catch (e) {
			console.error("Failed to parse files metadata for note:", id, e.message);
			files = [];
		}
	}

	const fileMeta = files.find(f => f.id === fileId);

	// Telegram 代理文档走代理路由，无需访问 R2
	if (fileMeta && fileMeta.type === 'telegram_document') {
		const proxyId = fileMeta.file_id || fileMeta.id || fileId;
		const targetUrl = new URL(`/api/tg-media-proxy/${proxyId}`, request.url);
		return Response.redirect(targetUrl.toString(), 302);
	}

	// 尝试从 R2 获取文件对象
	const object = await env.NOTES_R2_BUCKET.get(`${id}/${fileId}`);
	if (object === null) {
		// 如果 R2 中确实没有这个文件，才返回 404
		return errorResponse('FILE_NOT_FOUND', 'File not found in storage', 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers); // 从 R2 对象中写入元数据（如 Content-Type）
	headers.set('etag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=86400, immutable');

	// --- 根据是否存在 fileMeta 来决定如何设置 headers ---
	if (fileMeta) {
		// 【情况一：元数据存在】这是标准文件或旧的图片，按原逻辑处理
		const contentType = fileMeta.type || 'application/octet-stream';
		const fileExtension = fileMeta.name.split('.').pop().toLowerCase();
		const textLikeExtensions = ['yml', 'yaml', 'md', 'log', 'toml', 'sh', 'py', 'js', 'json', 'css', 'html'];

		if (contentType.startsWith('text/') || textLikeExtensions.includes(fileExtension)) {
			headers.set('Content-Type', 'text/plain; charset=utf-8');
		} else {
			headers.set('Content-Type', contentType);
		}

		const isPreview = new URL(request.url).searchParams.get('preview') === 'true';
		const disposition = isPreview ? 'inline' : 'attachment';
		headers.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileMeta.name)}"`);
	} else {
		// 【情况二：元数据不存在】这是新的 Telegram 图片，我们只确保它能被浏览器正确显示
		// Content-Type 已经通过 object.writeHttpMetadata(headers) 从 R2 中设置好了，
		// 这通常足够让浏览器正确渲染图片。
		// 我们将其设置为 inline，确保它在 <img> 标签中能显示而不是被下载。
		headers.set('Content-Disposition', 'inline');
	}

	return new Response(object.body, { headers });
}
