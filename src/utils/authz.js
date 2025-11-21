import { errorResponse } from './response.js';

export function requireSession(session) {
	if (!session) {
		return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
	}
	return null;
}

export function requireAdmin(session) {
	const authError = requireSession(session);
	if (authError) {
		return authError;
	}
	if (!session.isAdmin) {
		return errorResponse('FORBIDDEN', 'Forbidden', 403);
	}
	return null;
}

export function canAccessNote(note, session) {
	if (!note) return false;
	if (session?.isAdmin) return true;
	if (note.owner_id && session?.id === note.owner_id) return true;
	if (note.visibility === 'users' && session) return true;
	if (note.visibility === 'public') return true;
	return false;
}

export function canModifyNote(note, session) {
	return !!(session?.isAdmin || (note?.owner_id && session?.id === note.owner_id));
}

export function buildAccessCondition(session, alias = 'n') {
	const prefix = alias ? `${alias}.` : '';
	if (session?.isAdmin) {
		return { clause: '1=1', bindings: [] };
	}
	return {
		clause: `(${prefix}owner_id = ? OR ${prefix}visibility IN ('users','public'))`,
		bindings: [session?.id || ''],
	};
}
