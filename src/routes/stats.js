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
			SELECT updated_at FROM notes
			WHERE ${access.clause} AND updated_at >= ?
		`);
		const { results } = await stmt.bind(...access.bindings, minTimestamp).all();
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		});
		const timeline = {};
		for (const row of results || []) {
			const ts = Number(row.updated_at);
			if (!Number.isFinite(ts)) continue;
			const parts = formatter.formatToParts(new Date(ts));
			const year = parseInt(parts.find(p => p.type === 'year')?.value || '', 10);
			const month = parseInt(parts.find(p => p.type === 'month')?.value || '', 10);
			const day = parseInt(parts.find(p => p.type === 'day')?.value || '', 10);
			if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
			if (!timeline[year]) {
				timeline[year] = { count: 0, months: {} };
			}
			if (!timeline[year].months[month]) {
				timeline[year].months[month] = { count: 0, days: {} };
			}
			if (!timeline[year].months[month].days[day]) {
				timeline[year].months[month].days[day] = { count: 0 };
			}
			timeline[year].count += 1;
			timeline[year].months[month].count += 1;
			timeline[year].months[month].days[day].count += 1;
		}
		return jsonResponse(timeline);
	} catch (e) {
		console.error("Timeline Error:", e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}
