import { handleApiRequest } from './router.js';

export default {
	async fetch(request, env, ctx) {
		return handleApiRequest(request, env);
	},
};
