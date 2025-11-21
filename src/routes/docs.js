import { buildTree } from '../utils/content.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { requireAdmin as ensureAdminSession } from '../utils/authz.js';
import { DOCS_TREE_MAX_NODES } from '../constants.js';

function isUuid(id) {
	return typeof id === 'string' && /^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$/.test(id);
}

export async function handleDocsTree(request, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	try {
		const url = new URL(request.url);
		const parentId = url.searchParams.get('parentId');
		if (parentId && !isUuid(parentId)) {
			return errorResponse('INVALID_PARENT_ID', 'Invalid parent id', 400);
		}
		if (!parentId) {
			const countRow = await env.DB.prepare("SELECT COUNT(*) as count FROM nodes").first();
			if ((countRow?.count || 0) > DOCS_TREE_MAX_NODES) {
				return errorResponse('DOCS_TOO_LARGE', 'Docs tree too large, please query by parentId', 413);
			}
		}

		let results;
		if (parentId) {
			const stmt = env.DB.prepare(`
				WITH RECURSIVE subtree AS (
					SELECT id, type, title, parent_id FROM nodes WHERE id = ?
					UNION ALL
					SELECT n.id, n.type, n.title, n.parent_id FROM nodes n JOIN subtree s ON n.parent_id = s.id
				)
				SELECT * FROM subtree ORDER BY title ASC
			`);
			({ results } = await stmt.bind(parentId).all());
		} else {
			const stmt = env.DB.prepare("SELECT id, type, title, parent_id FROM nodes ORDER BY title ASC");
			({ results } = await stmt.all());
		}
		const tree = buildTree(results, parentId || null);
		return jsonResponse(tree);
	} catch (e) {
		console.error("Docs Tree Error:", e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleDocsNodeGet(request, nodeId, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	if (!isUuid(nodeId)) {
		return errorResponse('INVALID_NODE_ID', 'Invalid node id', 400);
	}
	try {
		const stmt = env.DB.prepare("SELECT id, type, title, content FROM nodes WHERE id = ?");
		const node = await stmt.bind(nodeId).first();
		if (!node) {
			return errorResponse('NODE_NOT_FOUND', 'Not Found', 404);
		}
		return jsonResponse(node);
	} catch (e) {
		console.error(`Docs Get Node Error (id: ${nodeId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleDocsNodeUpdate(request, nodeId, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	if (!isUuid(nodeId)) {
		return errorResponse('INVALID_NODE_ID', 'Invalid node id', 400);
	}
	try {
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		const { content } = body;
		const stmt = env.DB.prepare("UPDATE nodes SET content = ?, updated_at = ? WHERE id = ?");
		await stmt.bind(content, Date.now(), nodeId).run();
		return jsonResponse({ success: true });
	} catch (e) {
		console.error(`Docs Update Node Error (id: ${nodeId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleDocsNodeCreate(request, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	try {
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		const { type, title, parent_id } = body;

		if (!type || !title || typeof type !== 'string' || typeof title !== 'string') {
			return errorResponse('INVALID_INPUT', 'Both type and title are required.', 400);
		}
		if (parent_id) {
			if (!isUuid(parent_id)) {
				return errorResponse('INVALID_PARENT_ID', 'Invalid parent id', 400);
			}
			const parent = await env.DB.prepare("SELECT id FROM nodes WHERE id = ?").bind(parent_id).first();
			if (!parent) {
				return errorResponse('PARENT_NOT_FOUND', 'Parent node does not exist.', 400);
			}
		}

		const id = crypto.randomUUID();
		const now = Date.now();
		const stmt = env.DB.prepare("INSERT INTO nodes (id, type, title, parent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?) RETURNING id");
		const { id: insertedId } = await stmt.bind(id, type.trim(), title.trim(), parent_id, now, now).first();
		return jsonResponse({ id: insertedId });
	} catch (e) {
		console.error("Docs Create Node Error:", e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

async function getAllDescendantIds(db, parentId) {
	const { results } = await db.prepare(`
		WITH RECURSIVE descendants(id) AS (
			SELECT id FROM nodes WHERE parent_id = ?
			UNION ALL
			SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
		)
		SELECT id FROM descendants
	`).bind(parentId).all();
	return (results || []).map(row => row.id);
}

export async function handleDocsNodeDelete(request, nodeId, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	if (!isUuid(nodeId)) {
		return errorResponse('INVALID_NODE_ID', 'Invalid node id', 400);
	}
	const db = env.DB;
	try {
		const existing = await db.prepare("SELECT id FROM nodes WHERE id = ?").bind(nodeId).first();
		if (!existing) {
			return errorResponse('NODE_NOT_FOUND', 'Node not found', 404);
		}

		const descendantIds = await getAllDescendantIds(db, nodeId);
		descendantIds.push(nodeId);

		const idsToDelete = descendantIds;
		const batchSize = 200;
		for (let i = 0; i < idsToDelete.length; i += batchSize) {
			const slice = idsToDelete.slice(i, i + batchSize);
			const deleteNodesStmt = db.prepare(`
            DELETE FROM nodes
            WHERE id IN (${slice.map(() => '?').join(',')})
        `);
			await deleteNodesStmt.bind(...slice).run();
		}

		return jsonResponse({ success: true, deletedIds: idsToDelete });
	} catch (e) {
		console.error(`Docs Delete Node Error (id: ${nodeId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleDocsNodeMove(request, nodeId, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	if (!isUuid(nodeId)) {
		return errorResponse('INVALID_NODE_ID', 'Invalid node id', 400);
	}
	const db = env.DB;
	try {
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		const { new_parent_id } = body;

		const currentNode = await db.prepare("SELECT id FROM nodes WHERE id = ?").bind(nodeId).first();
		if (!currentNode) {
			return errorResponse('NODE_NOT_FOUND', 'Node not found', 404);
		}

		if (new_parent_id === nodeId) {
			return errorResponse('INVALID_PARENT', 'A node cannot be its own parent.', 400);
		}

		// Allow moving to the root by passing null/empty parent_id
		let targetParent = null;
		if (new_parent_id) {
			if (!isUuid(new_parent_id)) {
				return errorResponse('INVALID_PARENT', 'Invalid target parent id', 400);
			}
			targetParent = await db.prepare("SELECT id FROM nodes WHERE id = ?").bind(new_parent_id).first();
			if (!targetParent) {
				return errorResponse('PARENT_NOT_FOUND', 'Target parent not found', 404);
			}

			// Prevent creating cycles (cannot move under a descendant)
			const descendantIds = await getAllDescendantIds(db, nodeId);
			if (descendantIds.includes(new_parent_id)) {
				return errorResponse('INVALID_PARENT', 'Cannot move a node under its descendant.', 400);
			}
		}

		const stmt = db.prepare("UPDATE nodes SET parent_id = ?, updated_at = ? WHERE id = ?");
		await stmt.bind(new_parent_id || null, Date.now(), nodeId).run();

		return jsonResponse({ success: true });
	} catch (e) {
		console.error(`Docs Move Node Error (id: ${nodeId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleDocsNodeRename(request, nodeId, env, session) {
	const authError = ensureAdminSession(session);
	if (authError) {
		return authError;
	}
	if (!isUuid(nodeId)) {
		return errorResponse('INVALID_NODE_ID', 'Invalid node id', 400);
	}
	const db = env.DB;
	try {
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
		}
		const { new_title } = body;

		// 验证 new_title 是否存在且不为空
		if (!new_title || typeof new_title !== 'string' || new_title.trim() === '') {
			return errorResponse('INVALID_INPUT', "A valid new title is required.", 400);
		}

		const stmt = db.prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?");
		await stmt.bind(new_title.trim(), Date.now(), nodeId).run();

		return jsonResponse({ success: true, new_title: new_title.trim() });
	} catch (e) {
		console.error(`Docs Rename Node Error (id: ${nodeId}):`, e);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}
