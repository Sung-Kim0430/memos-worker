import { NOTES_PER_PAGE } from '../constants.js';
import { extractImageUrls } from '../utils/content.js';
import { jsonResponse } from '../utils/response.js';
import { processNoteTags } from '../utils/tags.js';

export async function handleNotesList(request, env) {
	const db = env.DB;

	try {
		switch (request.method) {
			case 'GET': {
				const url = new URL(request.url);
				const page = parseInt(url.searchParams.get('page') || '1');
				const offset = (page - 1) * NOTES_PER_PAGE;
				const limit = NOTES_PER_PAGE;

				const startTimestamp = url.searchParams.get('startTimestamp');
				const endTimestamp = url.searchParams.get('endTimestamp');
				const tagName = url.searchParams.get('tag');
				const isFavoritesMode = url.searchParams.get('favorites') === 'true';
				const isArchivedMode = url.searchParams.get('archived') === 'true';

				let whereClauses = [];
				let bindings = [];
				let joinClause = "";

				if (isArchivedMode) {
					whereClauses.push("n.is_archived = 1");
				} else {
					// 默认（包括收藏夹）都应该排除已归档的
					whereClauses.push("n.is_archived = 0");
				}

				if (startTimestamp && endTimestamp) {
					// 将字符串时间戳转换为数字
					const startMs = parseInt(startTimestamp);
					const endMs = parseInt(endTimestamp);

					if (!isNaN(startMs) && !isNaN(endMs)) {
						whereClauses.push("updated_at >= ? AND updated_at < ?");
						bindings.push(startMs, endMs);
					}
				}
				if (tagName) {
					joinClause = `
                    JOIN note_tags nt ON n.id = nt.note_id
                    JOIN tags t ON nt.tag_id = t.id
                `;
					whereClauses.push("t.name = ?");
					bindings.push(tagName);
				}
				if (isFavoritesMode) {
					whereClauses.push("n.is_favorited = 1");
				}
				const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

				const query = `
                SELECT n.* FROM notes n
                ${joinClause}
                ${whereClause}
                ORDER BY n.is_pinned DESC, n.updated_at DESC
                LIMIT ? OFFSET ?
            `;

				// 将分页参数添加到 bindings 数组的末尾
				bindings.push(limit + 1, offset);

				const notesStmt = db.prepare(query);
				const { results: notesPlusOne } = await notesStmt.bind(...bindings).all();

				const hasMore = notesPlusOne.length > limit;
				const notes = notesPlusOne.slice(0, limit);

				notes.forEach(note => {
					if (typeof note.files === 'string') {
						try { note.files = JSON.parse(note.files); } catch (e) { note.files = []; }
					}
				});

				return jsonResponse({ notes, hasMore });
			}

			case 'POST': {
				const formData = await request.formData();
				const content = formData.get('content')?.toString() || '';
				const files = formData.getAll('file');

				if (!content.trim() && files.every(f => !f.name)) {
					return jsonResponse({ error: 'Content or file is required.' }, 400);
				}

				const now = Date.now();
				const filesMeta = [];

				// 【核心修改】在插入数据库前，先提取图片 URL
				const picUrls = extractImageUrls(content);

				// 【核心修改】在 INSERT 语句中加入新的 pics 字段
				const insertStmt = db.prepare(
					"INSERT INTO notes (content, files, is_pinned, created_at, updated_at, pics) VALUES (?, ?, 0, ?, ?, ?) RETURNING id"
				);
				// 先用一个空的 files 数组插入
				// 【核心修改】将提取出的 picUrls 绑定到 SQL 语句中
				const { id: noteId } = await insertStmt.bind(content, "[]", now, now, picUrls).first();
				if (!noteId) {
					throw new Error("Failed to create note and get ID.");
				}

				// --- 【重要逻辑调整】现在上传的文件，只有非图片类型才算作 "附件" (files) ---
				for (const file of files) {
					// 只有当文件存在，并且 MIME 类型不是图片时，才将其添加到 filesMeta
					if (file.name && file.size > 0 && !file.type.startsWith('image/')) {
						const fileId = crypto.randomUUID();
						await env.NOTES_R2_BUCKET.put(`${noteId}/${fileId}`, file.stream());
						filesMeta.push({ id: fileId, name: file.name, size: file.size, type: file.type });
					}
				}

				// 如果有非图片附件，再更新数据库中的 files 字段
				if (filesMeta.length > 0) {
					const updateFilesStmt = db.prepare("UPDATE notes SET files = ? WHERE id = ?");
					await updateFilesStmt.bind(JSON.stringify(filesMeta), noteId).run();
				}

				await processNoteTags(db, noteId, content);
				// 获取完整的笔记返回给前端
				const newNote = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(noteId).first();
				if (typeof newNote.files === 'string') {
					newNote.files = JSON.parse(newNote.files);
				}

				return jsonResponse(newNote, 201);
			}
		}
	} catch (e) {
		console.error("D1 Error:", e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleNoteDetail(request, noteId, env) {
	const db = env.DB;
	const id = parseInt(noteId);
	if (isNaN(id)) {
		return new Response('Invalid Note ID', { status: 400 });
	}

	try {
		// 首先获取现有笔记，用于文件删除和返回数据
		let existingNote = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first();
		if (!existingNote) {
			return new Response('Not Found', { status: 404 });
		}
		// 确保 files 字段是数组
		try {
			if (typeof existingNote.files === 'string') {
				existingNote.files = JSON.parse(existingNote.files);
			}
		} catch (e) {
			existingNote.files = [];
		}

		switch (request.method) {
			case 'PUT': {
				const formData = await request.formData();
				const shouldUpdateTimestamp = formData.get('update_timestamp') !== 'false';

				if (formData.has('content')) {
					const content = formData.get('content')?.toString() ?? existingNote.content;
					let currentFiles = existingNote.files;

					// --- 现在的文件处理只关心非图片附件 ---
					// 处理附件删除 (逻辑不变，因为它操作的是 files 字段)
					const filesToDelete = JSON.parse(formData.get('filesToDelete') || '[]');
					if (filesToDelete.length > 0) {
						const r2KeysToDelete = filesToDelete.map(fileId => `${id}/${fileId}`);
						await env.NOTES_R2_BUCKET.delete(r2KeysToDelete);
						currentFiles = currentFiles.filter(file => !filesToDelete.includes(file.id));
					}

					// 在处理完文件删除后，检查笔记是否应该被删除
					const hasNewFiles = formData.getAll('file').some(f => f.name && f.size > 0);
					if (content.trim() === '' && currentFiles.length === 0 && !hasNewFiles) {
						// 笔记即将变空，执行删除操作
						// 1. 删除 R2 中的所有剩余文件（如果有的话，虽然逻辑上这里 currentFiles 应该是空的）
						const allR2Keys = existingNote.files.map(file => `${id}/${file.id}`);
						if (allR2Keys.length > 0) {
							await env.NOTES_R2_BUCKET.delete(allR2Keys);
						}
						// 2. 从数据库删除笔记
						await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
						// 3. 返回特殊标记，告知前端整个笔记已被删除
						return jsonResponse({ success: true, noteDeleted: true });
					}
					// 处理新附件上传
					const newFiles = formData.getAll('file');
					for (const file of newFiles) {
						// 只有当文件存在，并且不是图片时，才作为附件处理
						if (file.name && file.size > 0 && !file.type.startsWith('image/')) {
							const fileId = crypto.randomUUID();
							await env.NOTES_R2_BUCKET.put(`${id}/${fileId}`, file.stream());
							currentFiles.push({ id: fileId, name: file.name, size: file.size, type: file.type });
						}
					}

					// 在更新数据库前，提取新的图片 URL 列表
					const picUrls = extractImageUrls(content);
					const newTimestamp = shouldUpdateTimestamp ? Date.now() : existingNote.updated_at;
					// 在 UPDATE 语句中加入 pics 字段的更新
					const stmt = db.prepare(
						"UPDATE notes SET content = ?, files = ?, updated_at = ?, pics = ? WHERE id = ?"
					);
					await stmt.bind(content, JSON.stringify(currentFiles), newTimestamp, picUrls, id).run();
					await processNoteTags(db, id, content);
				}

				if (formData.has('isPinned')) { // --- 这是置顶状态的更新 ---
					const isPinned = formData.get('isPinned') === 'true' ? 1 : 0;
					const stmt = db.prepare("UPDATE notes SET is_pinned = ? WHERE id = ?");
					await stmt.bind(isPinned, id).run();
				}
				if (formData.has('isFavorited')) {
					const isFavorited = formData.get('isFavorited') === 'true' ? 1 : 0;
					const stmt = db.prepare("UPDATE notes SET is_favorited = ? WHERE id = ?");
					await stmt.bind(isFavorited, id).run();
				}
				if (formData.has('is_archived')) {
					const isArchived = formData.get('is_archived') === 'true' ? 1 : 0;
					const stmt = db.prepare("UPDATE notes SET is_archived = ? WHERE id = ?");
					await stmt.bind(isArchived, id).run();
				}

				const updatedNote = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first();
				if (typeof updatedNote.files === 'string') {
					updatedNote.files = JSON.parse(updatedNote.files);
				}
				return jsonResponse(updatedNote);
			}

			case 'DELETE': {
				let allR2KeysToDelete = [];

				if (existingNote.files && existingNote.files.length > 0) {
					const attachmentKeys = existingNote.files
						.filter(file => file.id)
						.map(file => `${id}/${file.id}`);
					allR2KeysToDelete.push(...attachmentKeys);
				}
				let picUrls = [];
				if (typeof existingNote.pics === 'string') {
					try { picUrls = JSON.parse(existingNote.pics); } catch (e) { }
				}

				if (picUrls.length > 0) {
					const imageKeys = picUrls.map(url => {
						const imageMatch = url.match(/^\/api\/images\/([a-zA-Z0-9-]+)$/);
						if (imageMatch) {
							return `uploads/${imageMatch[1]}`;
						}
						const fileMatch = url.match(/^\/api\/files\/\d+\/([a-zA-Z0-9-]+)$/);
						if (fileMatch) {
							return `${id}/${fileMatch[1]}`;
						}
						return null;
					}).filter(key => key !== null);

					allR2KeysToDelete.push(...imageKeys);
				}

				if (allR2KeysToDelete.length > 0) {
					await env.NOTES_R2_BUCKET.delete(allR2KeysToDelete);
				}

				await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();

				return new Response(null, { status: 204 });
			}
		}
	} catch (e) {
		console.error("D1 Error:", e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleMergeNotes(request, env) {
	const db = env.DB;
	try {
		const { sourceNoteId, targetNoteId, addSeparator } = await request.json();

		if (!sourceNoteId || !targetNoteId || sourceNoteId === targetNoteId) {
			return jsonResponse({ error: 'Invalid source or target note ID.' }, 400);
		}

		const [sourceNote, targetNote] = await Promise.all([
			db.prepare("SELECT * FROM notes WHERE id = ?").bind(sourceNoteId).first(),
			db.prepare("SELECT * FROM notes WHERE id = ?").bind(targetNoteId).first(),
		]);

		if (!sourceNote || !targetNote) {
			return jsonResponse({ error: 'One or both notes not found.' }, 404);
		}

		// 目标笔记在前，源笔记在后
		const separator = addSeparator ? '\n\n---\n\n' : '\n\n';
		const mergedContent = targetNote.content + separator + sourceNote.content;
		const targetFiles = JSON.parse(targetNote.files || '[]');
		const sourceFiles = JSON.parse(sourceNote.files || '[]');
		const mergedFiles = JSON.stringify([...targetFiles, ...sourceFiles]);

		const mergedTimestamp = targetNote.updated_at;

		// --- 数据库与 R2 操作 ---

		// 更新目标笔记
		const stmt = db.prepare(
			"UPDATE notes SET content = ?, files = ?, updated_at = ? WHERE id = ?"
		);
		await stmt.bind(mergedContent, mergedFiles, mergedTimestamp, targetNote.id).run();

		// 为更新后的目标笔记重新处理标签
		await processNoteTags(db, targetNote.id, mergedContent);

		// 删除源笔记
		await db.prepare("DELETE FROM notes WHERE id = ?").bind(sourceNote.id).run();

		// 将源笔记的文件移动到目标笔记的 R2 目录下
		if (sourceFiles.length > 0) {
			const r2 = env.NOTES_R2_BUCKET;
			for (const file of sourceFiles) {
				const oldKey = `${sourceNote.id}/${file.id}`;
				const newKey = `${targetNote.id}/${file.id}`;
				const object = await r2.get(oldKey);
				if (object) {
					await r2.put(newKey, object.body);
					await r2.delete(oldKey);
				}
			}
		}

		// 返回更新后的目标笔记
		const updatedMergedNote = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(targetNote.id).first();
		if (typeof updatedMergedNote.files === 'string') {
			updatedMergedNote.files = JSON.parse(updatedMergedNote.files);
		}

		return jsonResponse(updatedMergedNote);

	} catch (e) {
		console.error("Merge Notes Error:", e.message, e.cause);
		return jsonResponse({ error: 'Database or R2 error during merge', message: e.message }, 500);
	}
}
