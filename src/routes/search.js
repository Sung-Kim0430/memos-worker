import { NOTES_PER_PAGE } from '../constants.js';
import { jsonResponse } from '../utils/response.js';
import { handleNotesList } from './notes.js';

function sanitizeFtsQuery(raw) {
	if (!raw) return '';
	// 移除会导致 FTS 语法错误的特殊字符，保留常见文字、数字、下划线及连字符
	const cleaned = raw.replace(/["'()<>]/g, ' ').replace(/[^\p{L}\p{N}_\s-]/gu, ' ').trim();
	return cleaned.split(/\s+/).filter(Boolean).join(' ');
}

function appendAccess(whereClauses, bindings, session) {
	if (session?.isAdmin) return;
	whereClauses.push("(n.owner_id = ? OR n.visibility IN ('users','public'))");
	bindings.push(session?.id || '');
}

export async function handleSearchRequest(request, env, session) {
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	const { searchParams } = new URL(request.url);
	const query = searchParams.get('q');

	// 1. 如果搜索查询为空或只包含空格，则将请求委托给 handleNotesList
	if (!query || query.trim().length === 0) {
		// 直接调用 handleNotesList 并返回其结果，实现无缝回退
		return handleNotesList(request, env, session);
	}
	const sanitized = sanitizeFtsQuery(query);
	if (sanitized.length === 0) {
		return jsonResponse({ notes: [], hasMore: false });
	}
	// 2. 保留对过短查询的检查
	if (sanitized.length < 2) {
		return jsonResponse({ notes: [], hasMore: false });
	}

	// --- 引入分页逻辑 ---
	const page = parseInt(searchParams.get('page') || '1');
	const offset = (page - 1) * NOTES_PER_PAGE;
	const limit = NOTES_PER_PAGE;
	const tagName = searchParams.get('tag');
	const startTimestamp = searchParams.get('startTimestamp');
	const endTimestamp = searchParams.get('endTimestamp');
	const isFavoritesMode = searchParams.get('favorites') === 'true';
	const isArchivedMode = searchParams.get('archived') === 'true';

	const db = env.DB;
	try {
		let whereClauses = ["notes_fts MATCH ?"];
		let bindings = [sanitized + '*'];
		let joinClause = "";

		appendAccess(whereClauses, bindings, session);

		if (isArchivedMode) {
			whereClauses.push("n.is_archived = 1");
		} else {
			whereClauses.push("n.is_archived = 0");
		}

		if (isFavoritesMode) {
			whereClauses.push("n.is_favorited = 1");
		}
		if (startTimestamp && endTimestamp) {
			const startMs = parseInt(startTimestamp);
			const endMs = parseInt(endTimestamp);
			if (!isNaN(startMs) && !isNaN(endMs)) {
				whereClauses.push("n.updated_at >= ? AND n.updated_at < ?");
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

		const whereString = whereClauses.join(" AND ");
		const stmt = db.prepare(`
            SELECT n.* FROM notes n
            JOIN notes_fts fts ON n.id = fts.rowid
            ${joinClause}
            WHERE ${whereString}
            ORDER BY rank
            LIMIT ? OFFSET ?
        `);

		bindings.push(limit + 1, offset);
		const { results: notesPlusOne } = await stmt.bind(...bindings).all();

		const hasMore = notesPlusOne.length > limit;
		const notes = notesPlusOne.slice(0, limit);

		notes.forEach(note => {
			if (typeof note.files === 'string') {
				try { note.files = JSON.parse(note.files); } catch (e) { note.files = []; }
			}
		});
		return jsonResponse({ notes, hasMore });
	} catch (e) {
		console.error("Search Error:", e.message);
		const message = (e.message || '').toLowerCase().includes('fts')
			? 'Invalid search query'
			: 'Database Error';
		const status = message === 'Invalid search query' ? 400 : 500;
		return jsonResponse({ error: message, message: e.message }, status);
	}
}

export async function handleTagsList(request, env, session) {
	if (!session) {
		return jsonResponse({ error: 'Unauthorized' }, 401);
	}
	const db = env.DB;
	try {
		// 使用 LEFT JOIN 和 COUNT 来统计每个标签关联的笔记数量
		// ORDER BY count DESC, name ASC 实现了按数量降序、名称升序的排序
		const whereClause = session?.isAdmin ? '1=1' : "(n.owner_id = ? OR n.visibility IN ('users','public'))";
		const stmt = db.prepare(`
            SELECT t.name, COUNT(nt.note_id) as count
            FROM tags t
            LEFT JOIN note_tags nt ON t.id = nt.tag_id
            LEFT JOIN notes n ON nt.note_id = n.id
            WHERE ${whereClause}
            GROUP BY t.id, t.name
            HAVING count > 0 -- 只返回被使用过的标签
            ORDER BY count DESC, t.name ASC
        `);
		const { results } = await stmt.bind(...(session?.isAdmin ? [] : [session?.id || ''])).all();
		return jsonResponse(results);
	} catch (e) {
		console.error("Tags List Error:", e.message);
		return jsonResponse({ error: 'Database Error' }, 500);
	}
}
