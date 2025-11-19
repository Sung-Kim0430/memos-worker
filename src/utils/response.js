export function jsonResponse(data, status = 200, headers = new Headers()) {
	headers.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(data, null, 2), { status, headers });
}
