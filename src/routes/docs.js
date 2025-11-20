import { buildTree } from '../utils/content.js';
import { jsonResponse } from '../utils/response.js';

function requireAdmin(session) {
	return !!session?.isAdmin;
}

function isUuid(id) {
	return typeof id === 'string' && /^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$/.test(id);
}

export async function handleDocsTree(request, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	try {
		const stmt = env.DB.prepare("SELECT id, type, title, parent_id FROM nodes ORDER BY title ASC");
		const { results } = await stmt.all();
		const tree = buildTree(results, null);
		return jsonResponse(tree);
	} catch (e) {
		console.error("Docs Tree Error:", e.message);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleDocsNodeGet(request, nodeId, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	if (!isUuid(nodeId)) {
		return jsonResponse({ error: 'Invalid node id' }, 400);
	}
	try {
		const stmt = env.DB.prepare("SELECT id, type, title, content FROM nodes WHERE id = ?");
		const node = await stmt.bind(nodeId).first();
		if (!node) {
			return jsonResponse({ error: 'Not Found' }, 404);
		}
		return jsonResponse(node);
	} catch (e) {
		console.error(`Docs Get Node Error (id: ${nodeId}):`, e.message);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleDocsNodeUpdate(request, nodeId, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	if (!isUuid(nodeId)) {
		return jsonResponse({ error: 'Invalid node id' }, 400);
	}
	try {
		const { content } = await request.json();
		const stmt = env.DB.prepare("UPDATE nodes SET content = ?, updated_at = ? WHERE id = ?");
		await stmt.bind(content, Date.now(), nodeId).run();
		return jsonResponse({ success: true });
	} catch (e) {
		console.error(`Docs Update Node Error (id: ${nodeId}):`, e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleDocsNodeCreate(request, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	try {
		const { type, title, parent_id } = await request.json();

		if (!type || !title || typeof type !== 'string' || typeof title !== 'string') {
			return jsonResponse({ error: 'Both type and title are required.' }, 400);
		}
		if (parent_id) {
			if (!isUuid(parent_id)) {
				return jsonResponse({ error: 'Invalid parent id' }, 400);
			}
			const parent = await env.DB.prepare("SELECT id FROM nodes WHERE id = ?").bind(parent_id).first();
			if (!parent) {
				return jsonResponse({ error: 'Parent node does not exist.' }, 400);
			}
		}

		const id = crypto.randomUUID();
		const now = Date.now();
		const stmt = env.DB.prepare("INSERT INTO nodes (id, type, title, parent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?) RETURNING id");
		const { id: insertedId } = await stmt.bind(id, type.trim(), title.trim(), parent_id, now, now).first();
		return jsonResponse({ id: insertedId });
	} catch (e) {
		console.error("Docs Create Node Error:", e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

async function getAllDescendantIds(db, parentId) {
	let descendantIds = [];
	const stmt = db.prepare("SELECT id FROM nodes WHERE parent_id = ?");
	const { results } = await stmt.bind(parentId).all();

	for (const row of results) {
		descendantIds.push(row.id);
		const childDescendants = await getAllDescendantIds(db, row.id);
		descendantIds = descendantIds.concat(childDescendants);
	}
	return descendantIds;
}

export async function handleDocsNodeDelete(request, nodeId, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	if (!isUuid(nodeId)) {
		return jsonResponse({ error: 'Invalid node id' }, 400);
	}
	const db = env.DB;
	try {
		const existing = await db.prepare("SELECT id FROM nodes WHERE id = ?").bind(nodeId).first();
		if (!existing) {
			return jsonResponse({ error: 'Node not found' }, 404);
		}

		const descendantIds = await getAllDescendantIds(db, nodeId);
		descendantIds.push(nodeId);

		const deleteNodesStmt = db.prepare(`
            DELETE FROM nodes
            WHERE id IN (${descendantIds.map(() => '?').join(',')})
        `);
		await deleteNodesStmt.bind(...descendantIds).run();

		return jsonResponse({ success: true, deletedIds: descendantIds });
	} catch (e) {
		console.error(`Docs Delete Node Error (id: ${nodeId}):`, e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleDocsNodeMove(request, nodeId, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	if (!isUuid(nodeId)) {
		return jsonResponse({ error: 'Invalid node id' }, 400);
	}
	const db = env.DB;
	try {
		const { new_parent_id } = await request.json();

		const currentNode = await db.prepare("SELECT id FROM nodes WHERE id = ?").bind(nodeId).first();
		if (!currentNode) {
			return jsonResponse({ error: 'Node not found' }, 404);
		}

		if (new_parent_id === nodeId) {
			return jsonResponse({ error: 'A node cannot be its own parent.' }, 400);
		}

		// Allow moving to the root by passing null/empty parent_id
		let targetParent = null;
		if (new_parent_id) {
			if (!isUuid(new_parent_id)) {
				return jsonResponse({ error: 'Invalid target parent id' }, 400);
			}
			targetParent = await db.prepare("SELECT id FROM nodes WHERE id = ?").bind(new_parent_id).first();
			if (!targetParent) {
				return jsonResponse({ error: 'Target parent not found' }, 404);
			}

			// Prevent creating cycles (cannot move under a descendant)
			const descendantIds = await getAllDescendantIds(db, nodeId);
			if (descendantIds.includes(new_parent_id)) {
				return jsonResponse({ error: 'Cannot move a node under its descendant.' }, 400);
			}
		}

		const stmt = db.prepare("UPDATE nodes SET parent_id = ?, updated_at = ? WHERE id = ?");
		await stmt.bind(new_parent_id || null, Date.now(), nodeId).run();

		return jsonResponse({ success: true });
	} catch (e) {
		console.error(`Docs Move Node Error (id: ${nodeId}):`, e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}

export async function handleDocsNodeRename(request, nodeId, env, session) {
	if (!requireAdmin(session)) {
		return jsonResponse({ error: 'Forbidden' }, 403);
	}
	if (!isUuid(nodeId)) {
		return jsonResponse({ error: 'Invalid node id' }, 400);
	}
	const db = env.DB;
	try {
		const { new_title } = await request.json();

		// 验证 new_title 是否存在且不为空
		if (!new_title || typeof new_title !== 'string' || new_title.trim() === '') {
			return jsonResponse({ error: "A valid new title is required." }, 400);
		}

		const stmt = db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?");
		await stmt.bind(new_title.trim(), Date.now(), nodeId).run();

		return jsonResponse({ success: true, new_title: new_title.trim() });
	} catch (e) {
		console.error(`Docs Rename Node Error (id: ${nodeId}):`, e.message, e.cause);
		return jsonResponse({ error: 'Database Error', message: e.message }, 500);
	}
}
