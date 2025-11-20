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

	const statements = [];
	statements.push(db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId));

	if (uniqueTags.length > 0) {
		for (const tagName of uniqueTags) {
			await db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").bind(tagName).run();
			const tag = await db.prepare("SELECT id FROM tags WHERE name = ?").bind(tagName).first();
			if (tag) {
				statements.push(
					db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)")
						.bind(noteId, tag.id)
				);
			}
		}
	}
	if (statements.length > 0) {
		await db.batch(statements);
	}
}
