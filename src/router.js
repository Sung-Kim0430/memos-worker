import { handleLogin, handleLogout, isSessionAuthenticated, handleRegister, handleUsersList, handleUserUpdate, handleUserDelete, validateCsrf } from './routes/auth.js';
import { handleDocsNodeCreate, handleDocsNodeDelete, handleDocsNodeGet, handleDocsNodeMove, handleDocsNodeRename, handleDocsNodeUpdate, handleDocsTree } from './routes/docs.js';
import { handleFileRequest } from './routes/files.js';
import { handleGetAllAttachments, handleImgurProxyUpload, handleServeStandaloneImage, handleStandaloneImageUpload } from './routes/media.js';
import { handleMergeNotes, handleNoteDetail, handleNotesList } from './routes/notes.js';
import { handleSearchRequest, handleTagsList } from './routes/search.js';
import { handleGetSettings, handleSetSettings } from './routes/settings.js';
import { handlePublicFileRequest, handlePublicNoteRequest, handlePublicRawNoteRequest, handleShareFileRequest, handleShareNoteRequest, handleUnshareNoteRequest } from './routes/share.js';
import { handleStatsRequest, handleTimelineRequest } from './routes/stats.js';
import { handleTelegramProxy, handleTelegramWebhook } from './routes/telegram.js';
import { errorResponse, jsonResponse } from './utils/response.js';

function redirectToSharePage(publicId, request) {
	const targetUrl = new URL('/share.html', request.url);
	targetUrl.searchParams.set('id', publicId);
	return Response.redirect(targetUrl.toString(), 302);
}

async function handlePublicRoutes(pathname, request, env, ctx) {
	const sharePageMatch = pathname.match(/^\/share\/([a-zA-Z0-9-]+)$/);
	if (sharePageMatch) {
		return redirectToSharePage(sharePageMatch[1], request);
	}

	const publicNoteMatch = pathname.match(/^\/api\/public\/note\/([a-zA-Z0-9-]+)$/);
	if (publicNoteMatch && request.method === 'GET') {
		return handlePublicNoteRequest(publicNoteMatch[1], env);
	}

	const publicRawNoteMatch = pathname.match(/^\/api\/public\/note\/raw\/([a-zA-Z0-9-]+)$/);
	if (publicRawNoteMatch && request.method === 'GET') {
		return handlePublicRawNoteRequest(publicRawNoteMatch[1], env);
	}

	const publicFileMatch = pathname.match(/^\/api\/public\/file\/([a-zA-Z0-9-]+)$/);
	if (publicFileMatch) {
		return handlePublicFileRequest(publicFileMatch[1], request, env);
	}

	const telegramMatch = pathname.match(/^\/api\/telegram_webhook\/([^\/]+)$/);
	if (request.method === 'POST' && telegramMatch) {
		return handleTelegramWebhook(request, env, telegramMatch[1], ctx);
	}

	if (request.method === 'POST' && pathname === '/api/login') {
		return handleLogin(request, env);
	}
	if (request.method === 'POST' && pathname === '/api/logout') {
		return handleLogout(request, env);
	}
	if (request.method === 'POST' && pathname === '/api/register') {
		return handleRegister(request, env, null);
	}

	return null;
}

async function handleAuthenticatedRoutes(pathname, request, env, session) {
	if (request.method === 'POST' && pathname === '/api/notes/merge') {
		return handleMergeNotes(request, env, session);
	}

	const shareNoteMatch = pathname.match(/^\/api\/notes\/(\d+)\/share$/);
	if (shareNoteMatch) {
		const [, noteId] = shareNoteMatch;
		if (request.method === 'POST') {
			return handleShareNoteRequest(noteId, request, env, session);
		}
		if (request.method === 'DELETE') {
			return handleUnshareNoteRequest(noteId, env, session);
		}
	}

	const shareFileMatch = pathname.match(/^\/api\/notes\/(\d+)\/files\/([a-zA-Z0-9-]+)\/share$/);
	if (shareFileMatch && request.method === 'POST') {
		const [, noteId, fileId] = shareFileMatch;
		return handleShareFileRequest(noteId, fileId, request, env, session);
	}

	if (pathname.startsWith('/api/docs')) {
		if (pathname === '/api/docs/tree' && request.method === 'GET') {
			return handleDocsTree(request, env, session);
		}
		if (pathname === '/api/docs/node' && request.method === 'POST') {
			return handleDocsNodeCreate(request, env, session);
		}

		const renameMatch = pathname.match(/^\/api\/docs\/node\/([a-zA-Z0-9-]+)\/rename$/);
		if (renameMatch && request.method === 'POST') {
			const nodeId = renameMatch[1];
			return handleDocsNodeRename(request, nodeId, env, session);
		}

		const nodeDetailMatch = pathname.match(/^\/api\/docs\/node\/([a-zA-Z0-9-]+)$/);
		if (nodeDetailMatch) {
			const nodeId = nodeDetailMatch[1];
			if (request.method === 'GET') {
				return handleDocsNodeGet(request, nodeId, env, session);
			}
			if (request.method === 'PUT') {
				return handleDocsNodeUpdate(request, nodeId, env, session);
			}
			if (request.method === 'DELETE') {
				return handleDocsNodeDelete(request, nodeId, env, session);
			}
			if (request.method === 'PATCH') {
				return handleDocsNodeMove(request, nodeId, env, session);
			}
		}
	}

	if (pathname === '/api/settings') {
		if (request.method === 'GET') {
			return handleGetSettings(request, env, session);
		}
		if (request.method === 'PUT') {
			return handleSetSettings(request, env, session);
		}
	}

	if (request.method === 'POST' && pathname === '/api/upload/image') {
		return handleStandaloneImageUpload(request, env, session);
	}
	const imageMatch = pathname.match(/^\/api\/images\/([a-zA-Z0-9-]+)$/);
	if (imageMatch) {
		const imageId = imageMatch[1];
		return handleServeStandaloneImage(imageId, env);
	}

	if (request.method === 'GET' && pathname === '/api/attachments') {
		return handleGetAllAttachments(request, env, session);
	}
	if (request.method === 'POST' && pathname === '/api/proxy/upload/imgur') {
		return handleImgurProxyUpload(request, env);
	}
	if (pathname === '/api/stats') {
		return handleStatsRequest(request, env, session);
	}
	if (pathname === '/api/tags') {
		return handleTagsList(request, env, session);
	}
	const fileMatch = pathname.match(/^\/api\/files\/(\d+)\/([a-zA-Z0-9-]+)$/);
	if (fileMatch) {
		const [, noteId, fileId] = fileMatch;
		return handleFileRequest(noteId, fileId, request, env, session);
	}
	const tgProxyMatch = pathname.match(/^\/api\/tg-media-proxy\/([^\/]+)$/);
	if (tgProxyMatch) {
		return handleTelegramProxy(request, env, session);
	}
	if (pathname === '/api/notes/timeline') {
		return handleTimelineRequest(request, env, session);
	}
	if (pathname === '/api/search') {
		return handleSearchRequest(request, env, session);
	}
	const noteDetailMatch = pathname.match(/^\/api\/notes\/(\d+)$/);
	if (noteDetailMatch) {
		const noteId = noteDetailMatch[1];
		return handleNoteDetail(request, noteId, env, session);
	}
	if (pathname === '/api/notes') {
		return handleNotesList(request, env, session);
	}

	if (pathname === '/api/users') {
		if (request.method === 'GET') {
			return handleUsersList(env, session);
		}
		if (request.method === 'POST') {
			return handleRegister(request, env, session);
		}
	}

	const userUpdateMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9-]+)$/);
	if (userUpdateMatch) {
		const targetUserId = userUpdateMatch[1];
		if (request.method === 'PUT') {
			return handleUserUpdate(request, env, targetUserId, session);
		}
		if (request.method === 'DELETE') {
			return handleUserDelete(env, targetUserId, session);
		}
	}

	return null;
}

export async function handleApiRequest(request, env, ctx) {
	const { pathname } = new URL(request.url);

	const publicResponse = await handlePublicRoutes(pathname, request, env, ctx);
	if (publicResponse) {
		return publicResponse;
	}

	const session = await isSessionAuthenticated(request, env, ctx);
	if (!session) {
		return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
	}

	const csrfError = validateCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	const authedResponse = await handleAuthenticatedRoutes(pathname, request, env, session);
	if (authedResponse) {
		return authedResponse;
	}

	return errorResponse('NOT_FOUND', 'Not Found', 404);
}
