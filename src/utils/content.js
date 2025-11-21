export function extractImageUrls(content) {
	const result = [];
	if (typeof content !== 'string' || !content.includes('![')) return result;
	let idx = 0;
	while (idx < content.length) {
		const start = content.indexOf('![', idx);
		if (start === -1) break;
		const altEnd = content.indexOf('](', start + 2);
		if (altEnd === -1) break;
		const parenStart = altEnd + 1;
		if (content[parenStart] !== '(') {
			idx = altEnd + 1;
			continue;
		}
		let depth = 0;
		let end = -1;
		for (let i = parenStart; i < content.length; i++) {
			const ch = content[i];
			if (ch === '(') depth++;
			else if (ch === ')') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end > parenStart + 1) {
			const url = content.slice(parenStart + 1, end).trim();
			if (url && url !== '#') {
				result.push(url);
			}
			idx = end + 1;
		} else {
			idx = parenStart + 1;
		}
	}
	return result;
}

// 从 Markdown 中提取视频占位（目前用于 Telegram 视频的 [tg-video](url) 格式）
export function extractVideoUrls(content) {
	const regex = /\[tg-video\]\((.*?)\)/g;
	const matches = Array.from(content.matchAll(regex));
	return matches.map(match => match[1]).filter(url => url && url !== '#');
}

// 将 Markdown/纯文本内容进行安全转义，避免在不可信渲染环境下触发脚本
export function sanitizeContent(content = '') {
	let safe = content
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
	// 去掉 Markdown 链接中的危险协议
	safe = safe.replace(/\(\s*javascript:/gi, '(#');
	safe = safe.replace(/\(\s*data:text\/html/gi, '(#');
	return safe;
}

export function detectMimeType(input) {
	const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
	if (!bytes || bytes.length < 4) return null;
	const startsWith = (...vals) => vals.every((v, i) => bytes[i] === v);
	const ascii = (offset, str) => {
		for (let i = 0; i < str.length; i++) {
			if (bytes[offset + i] !== str.charCodeAt(i)) return false;
		}
		return true;
	};
	if (startsWith(0xFF, 0xD8, 0xFF)) return 'image/jpeg';
	if (startsWith(0x89, 0x50, 0x4E, 0x47)) return 'image/png';
	if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
	if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
	if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
	if (bytes.length >= 12 && ascii(4, 'ftyp')) return 'video/mp4';
	if (startsWith(0x1A, 0x45, 0xDF, 0xA3)) return 'video/webm';
	return null;
}

/**
 * 从扁平的节点列表中构建层级树结构
 * @param {Array<object>} nodes - 从数据库查询出的节点数组
 * @param {string|null} parentId - 当前要查找的父节点ID
 * @returns {Array<object>} - 构建好的层级树数组
 */
export function buildTree(nodes, parentId = null) {
	const tree = [];
	const byParent = nodes.reduce((acc, node) => {
		const key = node.parent_id || null;
		if (!acc.has(key)) acc.set(key, []);
		acc.get(key).push(node);
		return acc;
	}, new Map());

	const stack = [{ parent: parentId, container: tree }];
	const seen = new Set();

	while (stack.length) {
		const { parent, container } = stack.pop();
		const children = byParent.get(parent) || [];
		for (const child of children) {
			if (seen.has(child.id)) {
				continue; // 防止环导致死循环
			}
			seen.add(child.id);
			const node = { ...child };
			container.push(node);
			const childContainer = [];
			node.children = childContainer;
			stack.push({ parent: child.id, container: childContainer });
		}
	}
	return tree;
}
