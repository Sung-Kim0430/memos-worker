import { MAX_TIME_RANGE_MS } from '../constants.js';
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
		const access = buildAccessCondition(session, null); // 使用无别名条件，避免裸表查询出错
		const tagAccess = buildAccessCondition(session, 'n');
		const statsStmt = db.prepare(`
			WITH memo_stats AS (
				SELECT COUNT(*) AS memos, MIN(updated_at) AS oldestNoteTimestamp
				FROM notes
				WHERE ${access.clause}
			),
			tag_stats AS (
				SELECT COUNT(DISTINCT nt.tag_id) AS tags
				FROM note_tags nt
				JOIN notes n ON nt.note_id = n.id
				WHERE ${tagAccess.clause}
			)
			SELECT memos, tags, oldestNoteTimestamp FROM memo_stats CROSS JOIN tag_stats
		`);
		const statsRow = await statsStmt.bind(...access.bindings, ...tagAccess.bindings).first();

		return jsonResponse({
			memos: statsRow?.memos || 0,
			tags: statsRow?.tags || 0,
			oldestNoteTimestamp: statsRow?.oldestNoteTimestamp || null
		});
	} catch (e) {
		console.error("Stats Error:", e);
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
		const minTimestamp = Math.max(0, Date.now() - MAX_TIME_RANGE_MS);
		const access = buildAccessCondition(session, null); // 时间线同样使用无别名条件
		const stmt = db.prepare(`
			SELECT
				CAST(strftime('%Y', datetime(updated_at / 1000, 'unixepoch')) AS INTEGER) AS year,
				CAST(strftime('%m', datetime(updated_at / 1000, 'unixepoch')) AS INTEGER) AS month,
				CAST(strftime('%d', datetime(updated_at / 1000, 'unixepoch')) AS INTEGER) AS day,
				COUNT(*) as count
			FROM notes
			WHERE ${access.clause} AND updated_at >= ?
			GROUP BY year, month, day
			ORDER BY year DESC, month DESC, day DESC
		`);
		const { results } = await stmt.bind(...access.bindings, minTimestamp).all();
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
