import { jsonResponse } from '../utils/response.js';

export async function handleStatsRequest(request, env) {
	const db = env.DB;
	try {
		const memosCountQuery = db.prepare("SELECT COUNT(*) as total FROM notes");
		const tagsCountQuery = db.prepare("SELECT COUNT(DISTINCT tag_id) as total FROM note_tags");
		const oldestNoteQuery = db.prepare("SELECT MIN(updated_at) as oldest_ts FROM notes");

		// 使用 Promise.all 并行执行所有查询，以获得最佳性能
		const [memosResult, tagsResult, oldestNoteResult] = await Promise.all([
			memosCountQuery.first(),
			tagsCountQuery.first(),
			oldestNoteQuery.first()
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
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleTimelineRequest(request, env) {
	const db = env.DB;
	try {
		const { searchParams } = new URL(request.url);
		const timezone = searchParams.get('timezone') || 'UTC';
		// D1 不直接支持 strftime 或 to_char, 我们需要获取所有创建时间，然后在 JS 中处理
		// 注意：如果笔记数量巨大 (几十万条)，这个查询可能会有性能问题。
		// 对于几千到几万条笔记，这是完全可以接受的。
		const stmt = db.prepare("SELECT updated_at FROM notes ORDER BY updated_at DESC");
		const { results } = await stmt.all();
		if (!results) {
			return jsonResponse({});
		}
		const timezoneFormatter = new Intl.DateTimeFormat('en-US', { // 'en-US' 只是为了格式，不影响结果
			timeZone: timezone,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
		});
		// 在 JavaScript 中进行分组统计
		const timeline = {};
		for (const note of results) {
			const date = new Date(note.updated_at);
			const parts = timezoneFormatter.formatToParts(date);
			const year = parseInt(parts.find(p => p.type === 'year').value, 10);
			const month = parseInt(parts.find(p => p.type === 'month').value, 10);
			const day = parseInt(parts.find(p => p.type === 'day').value, 10);

			// 初始化年
			if (!timeline[year]) {
				timeline[year] = { count: 0, months: {} };
			}
			// 初始化月
			if (!timeline[year].months[month]) {
				timeline[year].months[month] = { count: 0, days: {} };
			}
			// 初始化日
			if (!timeline[year].months[month].days[day]) {
				timeline[year].months[month].days[day] = { count: 0 };
			}
			// 递增计数
			timeline[year].count++;
			timeline[year].months[month].count++;
			timeline[year].months[month].days[day].count++;
		}
		return jsonResponse(timeline);
	} catch (e) {
		console.error("Timeline Error:", e.message);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}
