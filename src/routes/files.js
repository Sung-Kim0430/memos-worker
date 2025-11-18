export async function handleFileRequest(noteId, fileId, request, env) {
	const db = env.DB;
	const id = parseInt(noteId);
	if (isNaN(id)) {
		return new Response('Invalid Note ID', { status: 400 });
	}

	// 尝试从数据库获取元数据
	const note = await db.prepare("SELECT files FROM notes WHERE id = ?").bind(id).first();

	// 【核心修改】即使 note 不存在或 files 为空，我们也不立即返回 404，
	// 因为图片可能只记录在 pics 字段中。

	let files = [];
	if (note && typeof note.files === 'string') {
		try {
			files = JSON.parse(note.files);
		} catch (e) {
			// JSON 解析失败则忽略
		}
	}

	const fileMeta = files.find(f => f.id === fileId);

	// 尝试从 R2 获取文件对象
	const object = await env.NOTES_R2_BUCKET.get(`${id}/${fileId}`);
	if (object === null) {
		// 如果 R2 中确实没有这个文件，才返回 404
		return new Response('File not found in storage', { status: 404 });
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
