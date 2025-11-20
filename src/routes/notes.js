import { NOTES_PER_PAGE, MAX_TIME_RANGE_MS, MAX_UPLOAD_BYTES } from '../constants.js';
import { extractImageUrls, extractVideoUrls } from '../utils/content.js';
import { jsonResponse } from '../utils/response.js';
import { processNoteTags } from '../utils/tags.js';

function canAccessNoteRecord(note, session) {
	if (!note) return false;
	if (session?.isAdmin) return true;
	if (note.owner_id && session?.id === note.owner_id) return true;
	if (note.visibility === 'users' && session) return true;
	if (note.visibility === 'public') return true;
	return false;
}

function appendAccessConditions(whereClauses, bindings, session) {
	if (session?.isAdmin) {
		return;
	}
	whereClauses.push("(n.owner_id = ? OR n.visibility IN ('users','public'))");
	bindings.push(session?.id || '');
}

function canModifyNote(note, session) {
	return !!(session?.isAdmin || (note.owner_id && session?.id === note.owner_id));
}

function parsePositiveInt(value, fallback = 1) {
	const num = Number(value);
	if (!Number.isInteger(num) || num <= 0) {
		return null;
	}
	return num;
}

function isValidTimestamp(value) {
	const num = Number(value);
	return Number.isFinite(num) && num > 0;
}

function safeParseJsonArray(value) {
	if (Array.isArray(value)) return value;
	if (value === null || value === undefined) return [];
	if (typeof value === 'string') {
		try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; }
	}
	return [];
}
export async function handleNotesList(request, env, session) {
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	const db = env.DB;

	try {
		switch (request.method) {
			case 'GET': {
				const url = new URL(request.url);
				const pageParam = url.searchParams.get('page') || '1';
				const page = parsePositiveInt(pageParam);
				if (!page) {
					return jsonResponse({ error: 'Invalid page parameter' }, 400);
				}
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

				appendAccessConditions(whereClauses, bindings, session);

				if (isArchivedMode) {
					whereClauses.push("n.is_archived = 1");
				} else {
					// 默认（包括收藏夹）都应该排除已归档的
					whereClauses.push("n.is_archived = 0");
				}

				if (startTimestamp && endTimestamp) {
					// 将字符串时间戳转换为数字并校验范围
					const startMs = Number(startTimestamp);
					const endMs = Number(endTimestamp);

					const now = Date.now();
					if (
						Number.isFinite(startMs) && Number.isFinite(endMs) &&
						startMs > 0 && endMs > 0 && startMs < endMs &&
						endMs <= now + MAX_TIME_RANGE_MS
					) {
						whereClauses.push("updated_at >= ? AND updated_at < ?");
						bindings.push(startMs, endMs);
					} else {
						return jsonResponse({ error: 'Invalid time range' }, 400);
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
					note.files = safeParseJsonArray(note.files);
					note.pics = safeParseJsonArray(note.pics);
					note.videos = safeParseJsonArray(note.videos);
				});

				return jsonResponse({ notes, hasMore });
			}

			case 'POST': {
					const formData = await request.formData();
					const content = formData.get('content')?.toString() || '';
					const files = formData.getAll('file');
					const requestedVisibility = formData.get('visibility');

					if (!content.trim() && files.every(f => !f.name)) {
						return jsonResponse({ error: 'Content or file is required.' }, 400);
					}

				const now = Date.now();
				const filesMeta = [];

				// 【核心修改】在插入数据库前，先提取图片与视频 URL
				const picUrls = extractImageUrls(content);
				const videoUrls = extractVideoUrls(content);

					// 【核心修改】在 INSERT 语句中加入新的 pics 与 owner/visibility
					const insertStmt = db.prepare(
						"INSERT INTO notes (content, files, is_pinned, created_at, updated_at, pics, videos, owner_id, visibility) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)"
					);
					// 先用一个空的 files 数组插入
					// 【核心修改】将提取出的 picUrls 绑定到 SQL 语句中
					const ownerId = session?.id || null;
					const allowedVisibility = ['private', 'users', 'public'];
					const visibility = allowedVisibility.includes(requestedVisibility) ? requestedVisibility : 'private';
					const { id: noteId } = await insertStmt.bind(
						content,
						"[]",
						now,
						now,
						JSON.stringify(picUrls),
						JSON.stringify(videoUrls),
						ownerId,
						visibility
					).first();
				if (!noteId) {
					throw new Error("Failed to create note and get ID.");
				}

				// --- 【重要逻辑调整】现在上传的文件，只有非图片类型才算作 "附件" (files) ---
				for (const file of files) {
					if (file.size > MAX_UPLOAD_BYTES) {
						return jsonResponse({ error: 'File too large.' }, 413);
					}
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
					if (typeof newNote.pics === 'string') {
						try { newNote.pics = JSON.parse(newNote.pics); } catch (e) { newNote.pics = []; }
					}
					if (typeof newNote.videos === 'string') {
						try { newNote.videos = JSON.parse(newNote.videos); } catch (e) { newNote.videos = []; }
					}
					newNote.owner_id = ownerId;
					newNote.visibility = visibility;

					return jsonResponse(newNote, 201);
			}
		}
	} catch (e) {
		console.error("D1 Error:", e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleNoteDetail(request, noteId, env, session) {
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
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
		if (!existingNote.visibility) {
			existingNote.visibility = 'private';
		}
		if (!canAccessNoteRecord(existingNote, session)) {
			return jsonResponse({ error: 'Forbidden' }, 403);
		}
		const canModify = canModifyNote(existingNote, session);
		// 确保 files/pics/videos 字段是数组
		existingNote.files = safeParseJsonArray(existingNote.files);
		const existingPics = safeParseJsonArray(existingNote.pics);
		const existingVideos = safeParseJsonArray(existingNote.videos);

		switch (request.method) {
			case 'GET': {
				// 返回当前笔记详情（解析后的附件/媒体字段）
				return jsonResponse({
					...existingNote,
					files: existingNote.files,
					pics: existingPics,
					videos: existingVideos
				});
			}

			case 'PUT': {
				if (!canModify) {
					return jsonResponse({ error: 'Forbidden' }, 403);
				}
				const formData = await request.formData();
						const shouldUpdateTimestamp = formData.get('update_timestamp') !== 'false';

					if (formData.has('content')) {
						const content = formData.get('content')?.toString() ?? existingNote.content;
						let currentFiles = Array.isArray(existingNote.files) ? [...existingNote.files] : [];

						// --- 现在的文件处理只关心非图片附件 ---
						// 处理附件删除 (逻辑不变，因为它操作的是 files 字段)
						let filesToDelete = [];
						try {
							filesToDelete = JSON.parse(formData.get('filesToDelete') || '[]');
						} catch (e) {
							return jsonResponse({ error: 'Invalid filesToDelete payload' }, 400);
						}
						if (filesToDelete.length > 0) {
							const r2KeysToDelete = filesToDelete.map(fileId => `${id}/${fileId}`);
							await env.NOTES_R2_BUCKET.delete(r2KeysToDelete);
							currentFiles = currentFiles.filter(file => !filesToDelete.includes(file.id));
						}

						// 解析新的图片/视频集合，用于后续更新及空内容判断
						const picUrls = extractImageUrls(content);
						const videoUrls = extractVideoUrls(content);
						const nextPicList = Array.isArray(picUrls) ? picUrls : [];
						const nextVideoList = Array.isArray(videoUrls) ? videoUrls : [];

						// 在处理完文件删除后，检查笔记是否应该被删除
						const hasNewFiles = formData.getAll('file').some(f => f.name && f.size > 0);
						if (content.trim() === '' && currentFiles.length === 0 && nextPicList.length === 0 && nextVideoList.length === 0 && !hasNewFiles) {
							// 笔记即将变空，执行删除操作
							// 1. 删除 R2 中的所有剩余文件/图片/视频
							const attachmentKeys = existingNote.files.map(file => `${id}/${file.id}`);
							const picKeys = existingPics.map(url => {
								const imageMatch = url.match(/^\/api\/images\/([a-zA-Z0-9-]+)$/);
								if (imageMatch) return `uploads/${imageMatch[1]}`;
								const fileMatch = url.match(/^\/api\/files\/\d+\/([a-zA-Z0-9-]+)$/);
								if (fileMatch) return `${id}/${fileMatch[1]}`;
								return null;
							}).filter(Boolean);
							const videoKeys = existingVideos.map(url => {
								const fileMatch = url.match(/^\/api\/files\/\d+\/([a-zA-Z0-9-]+)$/);
								if (fileMatch) return `${id}/${fileMatch[1]}`;
								return null;
							}).filter(Boolean);
							const allR2Keys = [...attachmentKeys, ...picKeys, ...videoKeys];
							if (allR2Keys.length > 0) {
								await env.NOTES_R2_BUCKET.delete(allR2Keys);
							}
							// 2. 删除分享 KV 和标签、笔记
							await db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(id).run();
							const publicId = await env.NOTES_KV.get(`note_share:${id}`);
							if (publicId) {
								await env.NOTES_KV.delete(`public_memo:${publicId}`);
								await env.NOTES_KV.delete(`note_share:${id}`);
								const prefix = `public_file_cache:${publicId}:`;
								const list = await env.NOTES_KV.list({ prefix });
								for (const { name } of list.keys) {
									const filePublicId = await env.NOTES_KV.get(name);
									if (filePublicId) {
										await env.NOTES_KV.delete(`public_file:${filePublicId}`);
									}
									await env.NOTES_KV.delete(name);
								}
							} else {
								await env.NOTES_KV.delete(`note_share:${id}`);
							}
							await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
							// 3. 返回特殊标记，告知前端整个笔记已被删除
							return jsonResponse({ success: true, noteDeleted: true });
						}
					// 处理新附件上传
					const newFiles = formData.getAll('file');
					for (const file of newFiles) {
						// 只有当文件存在，并且不是图片时，才作为附件处理
						if (file.name && file.size > 0 && !file.type.startsWith('image/')) {
							if (file.size > MAX_UPLOAD_BYTES) {
								return jsonResponse({ error: 'File too large.' }, 413);
							}
							const fileId = crypto.randomUUID();
							await env.NOTES_R2_BUCKET.put(`${id}/${fileId}`, file.stream());
							currentFiles.push({ id: fileId, name: file.name, size: file.size, type: file.type });
						}
						}

						// 在更新数据库前，提取新的图片 URL 列表
						const newTimestamp = shouldUpdateTimestamp ? Date.now() : existingNote.updated_at;
						// 在 UPDATE 语句中加入 pics 字段的更新
						const stmt = db.prepare(
							"UPDATE notes SET content = ?, files = ?, updated_at = ?, pics = ?, videos = ? WHERE id = ?"
						);
						await stmt.bind(
							content,
							JSON.stringify(currentFiles),
							newTimestamp,
							JSON.stringify(nextPicList),
							JSON.stringify(nextVideoList),
							id
						).run();
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
				if (formData.has('visibility')) {
					const vis = formData.get('visibility');
					const allowed = ['private', 'users', 'public'];
					if (allowed.includes(vis)) {
						await db.prepare("UPDATE notes SET visibility = ? WHERE id = ?").bind(vis, id).run();
					}
				}

				const updatedNote = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first();
				updatedNote.files = safeParseJsonArray(updatedNote.files);
				updatedNote.pics = safeParseJsonArray(updatedNote.pics);
				updatedNote.videos = safeParseJsonArray(updatedNote.videos);
				return jsonResponse(updatedNote);
			}

				case 'DELETE': {
					if (!canModify) {
						return jsonResponse({ error: 'Forbidden' }, 403);
					}
					let allR2KeysToDelete = [];

				if (existingNote.files && existingNote.files.length > 0) {
					const attachmentKeys = existingNote.files
						.filter(file => file.id)
						.map(file => `${id}/${file.id}`);
					allR2KeysToDelete.push(...attachmentKeys);
				}
				if (existingPics.length > 0) {
					const imageKeys = existingPics.map(url => {
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

				if (existingVideos.length > 0) {
					const videoKeys = existingVideos.map(url => {
						const fileMatch = url.match(/^\/api\/files\/\d+\/([a-zA-Z0-9-]+)$/);
						if (fileMatch) {
							return `${id}/${fileMatch[1]}`;
						}
						return null;
					}).filter(Boolean);
					allR2KeysToDelete.push(...videoKeys);
				}

				if (allR2KeysToDelete.length > 0) {
					await env.NOTES_R2_BUCKET.delete(allR2KeysToDelete);
				} else {
					// 防止元数据解析失败导致附件遗留，尽力清理该笔记下的全部对象
					try {
						const objects = await env.NOTES_R2_BUCKET.list({ prefix: `${id}/` });
						const keys = (objects?.objects || []).map(obj => obj.key);
						if (keys.length > 0) {
							await env.NOTES_R2_BUCKET.delete(keys);
						}
					} catch (fallbackErr) {
						console.error("Failed to list/delete orphaned R2 objects for note:", id, fallbackErr.message);
					}
				}

				await db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(id).run();
				const publicId = await env.NOTES_KV.get(`note_share:${id}`);
				if (publicId) {
					await env.NOTES_KV.delete(`public_memo:${publicId}`);
					await env.NOTES_KV.delete(`note_share:${id}`);
					const prefix = `public_file_cache:${publicId}:`;
					const list = await env.NOTES_KV.list({ prefix });
					for (const { name } of list.keys) {
						const filePublicId = await env.NOTES_KV.get(name);
						if (filePublicId) {
							await env.NOTES_KV.delete(`public_file:${filePublicId}`);
						}
						await env.NOTES_KV.delete(name);
					}
				} else {
					await env.NOTES_KV.delete(`note_share:${id}`);
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

export async function handleMergeNotes(request, env, session) {
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	const db = env.DB;
	const bucket = env.NOTES_R2_BUCKET;
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

	if (!(canModifyNote(sourceNote, session) && canModifyNote(targetNote, session))) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}

		// Helpers
		const parseJsonArray = (value) => {
			if (!value) return [];
			if (Array.isArray(value)) return value;
			if (typeof value === 'string') {
				try { return JSON.parse(value); } catch (e) { return []; }
			}
			return [];
		};
		const replaceAll = (str, search, replacement) => {
			if (!search || search === replacement) return str;
			return str.split(search).join(replacement);
		};
		const movedFileIds = new Set();
		const moveObjectIfExists = async (fileId) => {
			if (!fileId) return false;
			if (movedFileIds.has(fileId)) return true;
			const oldKey = `${sourceNote.id}/${fileId}`;
			const newKey = `${targetNote.id}/${fileId}`;
			if (oldKey === newKey) return true;
			try {
				const destExists = await bucket.head(newKey);
				if (destExists) {
					movedFileIds.add(fileId);
					return true;
				}
			} catch (e) {
				// head 不支持时继续尝试移动
			}
			const object = await bucket.get(oldKey);
			if (!object) {
				return false;
			}
			await bucket.put(newKey, object.body, { httpMetadata: object.httpMetadata });
			await bucket.delete(oldKey);
			movedFileIds.add(fileId);
			return true;
		};

		const targetFiles = parseJsonArray(targetNote.files);
		const sourceFiles = parseJsonArray(sourceNote.files);
		const targetPics = parseJsonArray(targetNote.pics);
		const sourcePics = parseJsonArray(sourceNote.pics);
		const targetVideos = parseJsonArray(targetNote.videos);
		const sourceVideos = parseJsonArray(sourceNote.videos);

		// 目标笔记在前，源笔记在后
		const separator = addSeparator ? '\n\n---\n\n' : '\n\n';
		let mergedContent = targetNote.content + separator + sourceNote.content;

		// Move source attachments to the target note and rewrite URLs in the merged content
		for (const file of sourceFiles) {
			const moved = await moveObjectIfExists(file.id);
			if (moved) {
				const oldUrl = `/api/files/${sourceNote.id}/${file.id}`;
				const newUrl = `/api/files/${targetNote.id}/${file.id}`;
				mergedContent = replaceAll(mergedContent, oldUrl, newUrl);
			}
		}
		// Only keep source attachments that were successfully moved to the target note
		const mergedFiles = [...targetFiles, ...sourceFiles.filter(file => movedFileIds.has(file.id))];

		const rewriteInlineMedia = async (urls) => {
			const rewritten = [];
			for (const url of urls) {
				let newUrl = url;
				const match = url.match(/^\/api\/files\/(\d+)\/([a-zA-Z0-9-]+)$/);
				if (match && match[1] === sourceNote.id.toString()) {
					const fileId = match[2];
					const moved = await moveObjectIfExists(fileId);
					if (moved) {
						newUrl = `/api/files/${targetNote.id}/${fileId}`;
						mergedContent = replaceAll(mergedContent, url, newUrl);
					}
				}
				rewritten.push(newUrl);
			}
			return rewritten;
		};

		const rewrittenPics = await rewriteInlineMedia(sourcePics);
		const rewrittenVideos = await rewriteInlineMedia(sourceVideos);

		const mergedPics = Array.from(new Set([...targetPics, ...rewrittenPics]));
		const mergedVideos = Array.from(new Set([...targetVideos, ...rewrittenVideos]));

		// 合并后内容实际被修改，应以当前时间更新更新时间
		const mergedTimestamp = Date.now();

		// --- 数据库与 R2 操作 ---

		// 更新目标笔记
		const stmt = db.prepare(
			"UPDATE notes SET content = ?, files = ?, updated_at = ?, pics = ?, videos = ? WHERE id = ?"
		);
		await stmt.bind(
			mergedContent,
			JSON.stringify(mergedFiles),
			mergedTimestamp,
			JSON.stringify(mergedPics),
			JSON.stringify(mergedVideos),
			targetNote.id
		).run();

		// 为更新后的目标笔记重新处理标签
		await processNoteTags(db, targetNote.id, mergedContent);

		// 删除源笔记
		await db.prepare("DELETE FROM notes WHERE id = ?").bind(sourceNote.id).run();

		// 返回更新后的目标笔记
		const updatedMergedNote = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(targetNote.id).first();
		if (typeof updatedMergedNote.files === 'string') {
			updatedMergedNote.files = JSON.parse(updatedMergedNote.files);
		}
		if (typeof updatedMergedNote.pics === 'string') {
			try { updatedMergedNote.pics = JSON.parse(updatedMergedNote.pics); } catch (e) { /* keep raw */ }
		}
		if (typeof updatedMergedNote.videos === 'string') {
			try { updatedMergedNote.videos = JSON.parse(updatedMergedNote.videos); } catch (e) { /* keep raw */ }
		}

		return jsonResponse(updatedMergedNote);

	} catch (e) {
		console.error("Merge Notes Error:", e.message, e.cause);
		return jsonResponse({ error: 'Database or R2 error during merge', message: e.message }, 500);
	}
}
