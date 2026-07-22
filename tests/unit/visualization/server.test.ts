import { afterEach, describe, expect, test } from "bun:test";
import { parseMarkdownFile } from "../../../src/markdown/parser.ts";
import { buildProjectGraph } from "../../../src/visualization/graph.ts";
import { startVisualizationServer } from "../../../src/visualization/server.ts";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

describe("visualization server", () => {
	test("serves embedded UI assets and parsed graph data", async () => {
		const parsed = parseMarkdownFile(
			`---
project: Local atlas
---
## As a user, I want a visual map

Labels: [Feature, Search]

### Acceptance Criteria

- [ ] The map is visible
`,
			"stories.md",
		);
		const graph = buildProjectGraph(parsed);
		const running = startVisualizationServer({ graph, port: 0 });
		servers.push(running.server);

		const [index, script, stylesheet, data, missing] = await Promise.all([
			fetch(`${running.url}/`),
			fetch(`${running.url}/app.js`),
			fetch(`${running.url}/styles.css`),
			fetch(`${running.url}/data/project-graph.json`),
			fetch(`${running.url}/private-file`),
		]);

		expect(index.status).toBe(200);
		expect(index.headers.get("content-type")).toContain("text/html");
		const html = await index.text();
		expect(html).toContain("LinearStories atlas");
		expect(html).toContain('id="labelFilters"');
		expect(html).toContain('class="legend legend--footer"');
		const javascript = await script.text();
		expect(javascript).toContain("registerHierarchy");
		expect(javascript).toContain("configureLabelFilters");
		expect(javascript).toContain("hiddenLabels");
		expect(javascript).toContain('criterion.completed ? "is-complete" : "is-not-started"');
		const css = await stylesheet.text();
		expect(css).toContain("--paper:");
		expect(css).toContain("--not-started: #777a73");
		expect(css).toContain('.node[data-status="not-started"] .node__body');
		expect(css).toContain(".criterion-tick {\n\tstroke: var(--not-started)");
		expect(css).toContain(".criterion.is-not-started .criterion__dash");
		expect(css).toContain('.story-filter[aria-pressed="false"]');
		expect(css).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
		expect(css).toContain("grid-template-rows: auto minmax(720px, 1fr)");
		expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)");
		expect(await data.json()).toEqual(graph);
		expect(missing.status).toBe(404);
		expect(index.headers.get("content-security-policy")).toContain("default-src 'self'");
	});
});
