export function extractImageUrls(content) {
	// 正则表达式：全局匹配所有 Markdown 图片语法 ![alt](url)
	// 关键点：
	// 1. /g flag - 确保能找到文中所有的图片，而不仅仅是第一个
	// 2. \!\[.*?\] - 非贪婪地匹配 alt 文本部分，处理各种复杂的 alt 内容
	// 3. \((.*?)\) - 捕获组( ... )，非贪婪地捕获括号内的 URL
	const regex = /!\[.*?\]\((.*?)\)/g;

	// 使用 String.prototype.matchAll() 来获取所有匹配项和捕获组
	// 它返回一个迭代器，我们用 Array.from 将其转换为数组
	const matches = Array.from(content.matchAll(regex));

	// 提取每个匹配项的第一个捕获组（也就是 URL）
	return matches.map(match => match[1]);
}

// 从 Markdown 中提取视频占位（目前用于 Telegram 视频的 [tg-video](url) 格式）
export function extractVideoUrls(content) {
	const regex = /\[tg-video\]\((.*?)\)/g;
	const matches = Array.from(content.matchAll(regex));
	return matches.map(match => match[1]);
}

/**
 * 从扁平的节点列表中构建层级树结构
 * @param {Array<object>} nodes - 从数据库查询出的节点数组
 * @param {string|null} parentId - 当前要查找的父节点ID
 * @returns {Array<object>} - 构建好的层级树数组
 */
export function buildTree(nodes, parentId = null) {
	const tree = [];
	nodes
		.filter(node => node.parent_id === parentId)
		.forEach(node => {
			const children = buildTree(nodes, node.id);
			if (children.length > 0) {
				node.children = children;
			}
			tree.push(node);
		});
	return tree;
}
