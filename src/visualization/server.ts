import appScript from "./assets/app.txt" with { type: "text" };
import indexHtml from "./assets/index.txt" with { type: "text" };
import styles from "./assets/styles.css" with { type: "text" };
import type { ProjectGraph } from "./graph.ts";

const SECURITY_HEADERS = {
	"Content-Security-Policy": [
		"default-src 'self'",
		"script-src 'self' https://cdn.jsdelivr.net",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src https://fonts.gstatic.com",
		"connect-src 'self'",
		"img-src 'self' data:",
		"object-src 'none'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	].join("; "),
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

export interface VisualizationServerOptions {
	graph: ProjectGraph;
	hostname?: string;
	port?: number;
}

export interface VisualizationServer {
	server: ReturnType<typeof Bun.serve>;
	url: string;
}

export function createVisualizationHandler(graph: ProjectGraph) {
	const graphJson = JSON.stringify(graph);

	return (request: Request): Response => {
		const { pathname } = new URL(request.url);
		switch (pathname) {
			case "/":
			case "/index.html":
				return assetResponse(indexHtml, "text/html; charset=utf-8");
			case "/app.js":
				return assetResponse(appScript, "text/javascript; charset=utf-8");
			case "/styles.css":
				return assetResponse(styles, "text/css; charset=utf-8");
			case "/data/project-graph.json":
				return assetResponse(graphJson, "application/json; charset=utf-8");
			case "/healthz":
				return new Response("ok", { headers: SECURITY_HEADERS });
			case "/favicon.ico":
				return new Response(null, { status: 204, headers: SECURITY_HEADERS });
			default:
				return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
		}
	};
}

export function startVisualizationServer({
	graph,
	hostname = "127.0.0.1",
	port = 4173,
}: VisualizationServerOptions): VisualizationServer {
	const server = Bun.serve({
		hostname,
		port,
		fetch: createVisualizationHandler(graph),
	});

	return {
		server,
		url: `http://${hostname}:${server.port}`,
	};
}

export function openBrowser(url: string): void {
	const command = browserCommand(url);
	Bun.spawn(command, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
}

function browserCommand(url: string): string[] {
	switch (process.platform) {
		case "darwin":
			return ["open", url];
		case "win32":
			return ["cmd", "/c", "start", "", url];
		default:
			return ["xdg-open", url];
	}
}

function assetResponse(body: string, contentType: string): Response {
	return new Response(body, {
		headers: {
			...SECURITY_HEADERS,
			"Cache-Control": "no-store",
			"Content-Type": contentType,
		},
	});
}
