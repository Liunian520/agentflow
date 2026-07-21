// Catch-all Pages Function for SPA routing on Cloudflare Pages
//
// Problem: When users directly visit /workflows, /agents, etc.,
// Cloudflare Pages tries to find a matching static file and returns 404.
// This Function intercepts all non-asset routes and returns index.html,
// letting the React Router handle routing client-side.
//
// _routes.json (in public/) excludes static assets from this Function,
// so CSS/JS/images are served normally by the asset server.

interface PagesFunctionEnv {
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

type PagesFunctionContext = {
  request: Request;
  env: PagesFunctionEnv;
  next: () => Promise<Response>;
};

export const onRequest = async (context: PagesFunctionContext): Promise<Response> => {
  const url = new URL(context.request.url);

  // Static assets with file extensions are served by the asset server,
  // but _routes.json may not catch all edge cases.
  // Explicitly skip paths that look like static files.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.match(/\.\w{1,12}$/)
  ) {
    return context.next();
  }

  // All other routes serve index.html (SPA fallback)
  const response = await context.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin)));

  return new Response(response.body, {
    status: response.status,
    headers: new Headers({
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    }),
  });
};
