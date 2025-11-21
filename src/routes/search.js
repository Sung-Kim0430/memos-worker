import { MAX_PAGE, MAX_TIME_RANGE_MS, NOTES_PER_PAGE } from '../constants.js';
import { sanitizeContent } from '../utils/content.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { buildAccessCondition, requireSession } from '../utils/authz.js';
import { handleNotesList } from './notes.js';

const TAGS_CACHE = new Map(); // key -> { expires, data }
const TAGS_CACHE_TTL_MS = 30 * 1000;

function sanitizeFtsQuery(raw) {
	if (!raw) return '';
	// 仅允许字母、数字、空格、下划线、连字符
	const cleaned = raw.replace(/[^\p{L}\p{N}_\s-]/gu, ' ').trim();
	return cleaned.split(/\s+/).filter(Boolean).join(' ');
}

export async function handleSearchRequest(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
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
	const pageRaw = searchParams.get('page') || '1';
	const page = Number(pageRaw);
	if (!Number.isInteger(page) || page <= 0) {
		return errorResponse('INVALID_PAGE', 'Invalid page parameter', 400);
	}
	if (page > MAX_PAGE) {
		return errorResponse('INVALID_PAGE', 'Page out of range', 400);
	}
	const offset = (page - 1) * NOTES_PER_PAGE;
	if (offset > MAX_PAGE * NOTES_PER_PAGE) {
		return errorResponse('INVALID_PAGE', 'Page out of range', 400);
	}
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

		const access = buildAccessCondition(session, 'n');
		if (access.clause !== '1=1') {
			whereClauses.push(access.clause);
			bindings.push(...access.bindings);
		}

		if (isArchivedMode) {
			whereClauses.push("n.is_archived = 1");
		} else {
			whereClauses.push("n.is_archived = 0");
		}

		if (isFavoritesMode) {
			whereClauses.push("n.is_favorited = 1");
		}
		if (startTimestamp && endTimestamp) {
			const startMs = Number(startTimestamp);
			const endMs = Number(endTimestamp);
			const now = Date.now();
			if (
				Number.isFinite(startMs) && Number.isFinite(endMs) &&
				startMs > 0 && endMs > 0 &&
				startMs < endMs &&
				endMs <= now &&
				startMs >= now - MAX_TIME_RANGE_MS &&
				(endMs - startMs) <= MAX_TIME_RANGE_MS
			) {
				whereClauses.push("n.updated_at >= ? AND n.updated_at < ?");
				bindings.push(startMs, endMs);
			} else {
				return errorResponse('INVALID_TIME_RANGE', 'Invalid time range', 400);
			}
		} else if (startTimestamp || endTimestamp) {
			return errorResponse('INVALID_TIME_RANGE', 'Invalid time range', 400);
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
			if (typeof note.content === 'string') {
				note.content_safe = sanitizeContent(note.content);
			}
		});
		return jsonResponse({ notes, hasMore });
	} catch (e) {
		console.error("Search Error:", e);
		const isFtsError = (e.message || '').toLowerCase().includes('fts');
		const message = isFtsError ? 'Invalid search query' : 'Database Error';
		const status = message === 'Invalid search query' ? 400 : 500;
		const code = isFtsError ? 'INVALID_QUERY' : 'DATABASE_ERROR';
		return errorResponse(code, message, status, e.message);
	}
}

export async function handleTagsList(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const db = env.DB;
	try {
		const cacheKey = session?.isAdmin ? 'tags:admin' : `tags:${session?.id || 'anon'}`;
		const cached = TAGS_CACHE.get(cacheKey);
		if (cached && cached.expires > Date.now()) {
			return jsonResponse(cached.data);
		}
		// 使用 LEFT JOIN 和 COUNT 来统计每个标签关联的笔记数量
		// ORDER BY count DESC, name ASC 实现了按数量降序、名称升序的排序
		const access = buildAccessCondition(session, 'n');
		const whereClause = access.clause;
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
		const { results } = await stmt.bind(...access.bindings).all();
		TAGS_CACHE.set(cacheKey, { expires: Date.now() + TAGS_CACHE_TTL_MS, data: results });
		return jsonResponse(results);
	} catch (e) {
		console.error("Tags List Error:", e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}
