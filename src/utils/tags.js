export async function processNoteTags(db, noteId, content) {
	// 先移除代码块（```...``` 和行内 `...`）避免误识别标签
	const withoutCodeBlocks = content
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`[^`]*`/g, '');
	const plainTextContent = withoutCodeBlocks.replace(/<[^>]*>/g, '');
	// 1. 定义两个正则表达式：一个用于标签，一个用于 URL
	const tagRegex = /#([\p{L}\p{N}_-]+)/gu;
	const urlRegex = /(https?:\/\/[^\s"']*[^\s"'.?,!])/g;

	// 2. 将内容分割成“普通文本”和“链接文本”的交替数组
	const segments = plainTextContent.split(urlRegex);
	let allTags = [];

	// 3. 遍历所有片段
	segments.forEach(segment => {
		// 4. 关键：只在【非链接】的文本片段中查找标签
		//    我们通过重新测试来判断它是否是 URL
		if (!/^(https?:\/\/[^\s"']*[^\s"'.?,!])/.test(segment)) {
			const matchedInSegment = [...segment.matchAll(tagRegex)].map(match => match[1].toLowerCase());
			allTags.push(...matchedInSegment);
		}
	});

	// 5. 将从所有安全片段中找到的标签进行去重
	const uniqueTags = [...new Set(allTags)];

	const statements = [
		db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId)
	];

	if (uniqueTags.length > 0) {
		const placeholders = uniqueTags.map(() => '(?)').join(',');
		await db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES ${placeholders}`).bind(...uniqueTags).run();

		const tagRows = await db.prepare(
			`SELECT id, name FROM tags WHERE name IN (${uniqueTags.map(() => '?').join(',')})`
		).bind(...uniqueTags).all();

		const idByName = new Map(tagRows.results.map(row => [row.name, row.id]));
		for (const tagName of uniqueTags) {
			const tagId = idByName.get(tagName);
			if (tagId) {
				statements.push(
					db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)")
						.bind(noteId, tagId)
				);
			}
		}
	}

	if (statements.length > 0) {
		await db.batch(statements);
	}
}

// 删除未被任何笔记引用的标签，避免标签表无限增长
export async function cleanupUnusedTags(db) {
	await db.prepare(`
		DELETE FROM tags
		WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)
	`).run();
}
