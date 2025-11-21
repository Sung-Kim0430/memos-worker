import { ATTACHMENTS_PER_PAGE, MAX_UPLOAD_BYTES } from '../constants.js';
import { errorResponse, jsonResponse } from '../utils/response.js';
import { requireSession } from '../utils/authz.js';

export async function handleStandaloneImageUpload(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	try {
		const formData = await request.formData();
		const file = formData.get('file');

		if (!file || !file.name || file.size === 0) {
			return errorResponse('INVALID_INPUT', 'A file is required for upload.', 400);
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			return errorResponse('FILE_TOO_LARGE', 'File too large.', 413);
		}

		const imageId = crypto.randomUUID();
		// 我们将独立上传的图片统一放到一个 'uploads/' 目录下，与笔记附件分开
		const r2Key = `uploads/${imageId}`;

		// 将文件流上传到 R2
		await env.NOTES_R2_BUCKET.put(r2Key, file.stream(), {
			httpMetadata: { contentType: file.type },
		});

		// 返回一个可用于访问此图片的内部 URL
		// 这个 URL 对应我们下面创建的 handleServeStandaloneImage 函数的路由
		const imageUrl = `/api/images/${imageId}`;
		return jsonResponse({ success: true, url: imageUrl });

	} catch (e) {
		console.error("Standalone Image Upload Error:", e.message);
		return errorResponse('UPLOAD_FAILED', 'Upload failed', 500, e.message);
	}
}

export async function handleImgurProxyUpload(request, env) {
	try {
		const formData = await request.formData();
		const clientId = env.IMGUR_CLIENT_ID;
		if (!clientId) {
			return errorResponse('IMGUR_NOT_CONFIGURED', 'Imgur Client ID is not configured on server.', 500);
		}

		// Imgur 需要 'image' 字段
		const imageFile = formData.get('file');
		if (!imageFile || imageFile.size === 0) {
			return errorResponse('INVALID_INPUT', 'A file is required for upload.', 400);
		}
		if (imageFile.size > MAX_UPLOAD_BYTES) {
			return errorResponse('FILE_TOO_LARGE', 'File too large.', 413);
		}
		const imgurFormData = new FormData();
		imgurFormData.append('image', imageFile);

		const imgurResponse = await fetch('https://api.imgur.com/3/image', {
			method: 'POST',
			headers: {
				'Authorization': `Client-ID ${clientId}`,
			},
			body: imgurFormData,
		});

		if (!imgurResponse.ok) {
			const errorBody = await imgurResponse.json();
			throw new Error(`Imgur API responded with status ${imgurResponse.status}: ${errorBody.data.error}`);
		}

		const result = await imgurResponse.json();

		if (!result.success) {
			throw new Error('Imgur API returned a failure response.');
		}

		return jsonResponse({ success: true, url: result.data.link });

	} catch (e) {
		console.error("Imgur Proxy Error:", e.message);
		return errorResponse('IMGUR_UPLOAD_FAILED', 'Imgur upload failed via proxy', 500, e.message);
	}
}

export async function handleGetAllAttachments(request, env, session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	const db = env.DB;
	const url = new URL(request.url);
	const pageRaw = url.searchParams.get('page') || '1';
	const page = Number(pageRaw);
	if (!Number.isInteger(page) || page <= 0) {
		return errorResponse('INVALID_PAGE', 'Invalid page parameter', 400);
	}
	const limit = ATTACHMENTS_PER_PAGE;
	const offset = (page - 1) * limit;

	try {
		const accessWhere = session?.isAdmin ? '1=1' : "(n.owner_id = ? OR n.visibility IN ('users','public'))";
		// 使用 Common Table Expression (CTE) 和 UNION ALL 来构建一个高效的单一查询
		const query = `
            WITH combined_attachments AS (
                SELECT
                    n.id AS noteId, n.updated_at AS timestamp, 'image' AS type,
                    json_each.value AS url, NULL AS name, NULL AS size, NULL AS id
                FROM notes n, json_each(n.pics) AS json_each
                WHERE json_valid(n.pics) AND json_array_length(n.pics) > 0 AND ${accessWhere}

                UNION ALL

                SELECT
                    n.id AS noteId, n.updated_at AS timestamp, 'video' AS type,
                    json_each.value AS url, NULL AS name, NULL AS size, NULL AS id
                FROM notes n, json_each(n.videos) AS json_each
                WHERE json_valid(n.videos) AND json_array_length(n.videos) > 0 AND ${accessWhere}

                UNION ALL

                SELECT
                    n.id AS noteId, n.updated_at AS timestamp, 'file' AS type,
                    NULL AS url, json_extract(json_each.value, '$.name') AS name,
                    json_extract(json_each.value, '$.size') AS size,
                    json_extract(json_each.value, '$.id') AS id
                FROM notes n, json_each(n.files) AS json_each
                WHERE json_valid(n.files) AND json_array_length(n.files) > 0 AND ${accessWhere}
            )
            SELECT * FROM combined_attachments
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?;
        `;

		// 为了判断是否有更多页面，我们请求 limit + 1 条记录
		const stmt = db.prepare(query);
		const { results: attachmentsPlusOne } = await stmt.bind(
			...(session?.isAdmin ? [] : [session?.id || '']),
			...(session?.isAdmin ? [] : [session?.id || '']),
			...(session?.isAdmin ? [] : [session?.id || '']),
			limit + 1,
			offset
		).all();

		const hasMore = attachmentsPlusOne.length > limit;
		const attachments = attachmentsPlusOne.slice(0, limit);

		return jsonResponse({
			attachments: attachments,
			hasMore: hasMore
		});

	} catch (e) {
		console.error("Get All Attachments Error:", e.message);
		return errorResponse('DATABASE_ERROR', 'Database Error', 500, e.message);
	}
}

export async function handleServeStandaloneImage(imageId, env) {
	const r2Key = `uploads/${imageId}`;
	const object = await env.NOTES_R2_BUCKET.get(r2Key);

	if (object === null) {
		return errorResponse('FILE_NOT_FOUND', 'File not found', 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	// 设置长时间的浏览器缓存，因为这些图片内容是不可变的
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');

	return new Response(object.body, { headers });
}
