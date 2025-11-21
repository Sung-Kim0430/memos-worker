import { handleApiRequest } from './router.js';

export default {
	async fetch(request, env, ctx) {
		globalThis.__DEBUG_ERRORS__ = env?.DEBUG_ERRORS === 'true';
		const { pathname } = new URL(request.url);

		// API 和 share 相关的动态路由交给业务路由处理
		if (pathname.startsWith('/api') || pathname.startsWith('/share/')) {
			return handleApiRequest(request, env, ctx);
		}

		// 其余走静态资源（当作 Pages 站点），保证前端页面能正常访问
		if (env.ASSETS?.fetch) {
			return env.ASSETS.fetch(request);
		}

		// 当缺少 ASSETS 绑定时，仍提供明确错误提示
		return new Response('ASSETS binding is not configured.', { status: 500 });
	},
};
