import { errorResponse, jsonResponse } from '../utils/response.js';
import { buildAccessCondition, requireSession } from '../utils/authz.js';

function isValidTimezone(tz) {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch (e) {
		return false;
	}
}

export async function handleStatsRequest(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const db = env.DB;
	try {
		const access = buildAccessCondition(session);
		const memosCountQuery = db.prepare(`SELECT COUNT(*) as total FROM notes WHERE ${access.clause}`);
		const tagAccess = buildAccessCondition(session, 'n');
		const tagsCountQuery = db.prepare(`
			SELECT COUNT(DISTINCT nt.tag_id) as total
			FROM note_tags nt
			JOIN notes n ON nt.note_id = n.id
			WHERE ${tagAccess.clause}
		`);
		const oldestNoteQuery = db.prepare(`SELECT MIN(updated_at) as oldest_ts FROM notes WHERE ${access.clause}`);

		// 使用 Promise.all 并行执行所有查询，以获得最佳性能
		const [memosResult, tagsResult, oldestNoteResult] = await Promise.all([
			memosCountQuery.bind(...access.bindings).first(),
			tagsCountQuery.bind(...tagAccess.bindings).first(),
			oldestNoteQuery.bind(...access.bindings).first()
		]);

		// 组装最终的 JSON 响应
		const stats = {
			memos: memosResult.total || 0,
			tags: tagsResult.total || 0,
			oldestNoteTimestamp: oldestNoteResult.oldest_ts || null
		};
		return jsonResponse(stats);
	} catch (e) {
		console.error("Stats Error:", e.message);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleTimelineRequest(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const db = env.DB;
	try {
		const { searchParams } = new URL(request.url);
		const timezone = searchParams.get('timezone') || 'UTC';
		if (!isValidTimezone(timezone)) {
			return errorResponse('INVALID_TIMEZONE', 'Invalid timezone', 400);
		}
		const access = buildAccessCondition(session);
		const stmt = db.prepare(`
			SELECT
				CAST(strftime('%Y', datetime(updated_at / 1000, 'unixepoch')) AS INTEGER) AS year,
				CAST(strftime('%m', datetime(updated_at / 1000, 'unixepoch')) AS INTEGER) AS month,
				CAST(strftime('%d', datetime(updated_at / 1000, 'unixepoch')) AS INTEGER) AS day,
				COUNT(*) as count
			FROM notes
			WHERE ${access.clause}
			GROUP BY year, month, day
			ORDER BY year DESC, month DESC, day DESC
		`);
		const { results } = await stmt.bind(...access.bindings).all();
		const timeline = {};
		for (const row of results || []) {
			const year = row.year;
			const month = row.month;
			const day = row.day;
			if (!timeline[year]) {
				timeline[year] = { count: 0, months: {} };
			}
			if (!timeline[year].months[month]) {
				timeline[year].months[month] = { count: 0, days: {} };
			}
			if (!timeline[year].months[month].days[day]) {
				timeline[year].months[month].days[day] = { count: 0 };
			}
			timeline[year].count += row.count;
			timeline[year].months[month].count += row.count;
			timeline[year].months[month].days[day].count += row.count;
		}
		return jsonResponse(timeline);
	} catch (e) {
		console.error("Timeline Error:", e.message);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}
