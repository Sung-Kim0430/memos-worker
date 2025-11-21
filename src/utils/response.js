export function jsonResponse(data, status = 200, headers = new Headers()) {
	headers.set('Content-Type', 'application/json');
	headers.set('X-Content-Type-Options', 'nosniff');
	return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export function errorResponse(code, message, status = 400, details, headers = new Headers()) {
	const payload = {
		success: false,
		error: { code, message },
	};
	const shouldExposeDetails = globalThis.__DEBUG_ERRORS__ === true;
	if (details && shouldExposeDetails) {
		payload.details = details;
	}
	return jsonResponse(payload, status, headers);
}
