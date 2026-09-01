import { expect, test } from "bun:test";
import appScript from "../../../src/visualization/assets/app.txt" with { type: "text" };

function loadClientHelpers(): {
	collectStoryLabels: (project: {
		children: Array<{ type: "story"; labels: string[] }>;
	}) => Array<[string, number]>;
	renderInspector: (node: Record<string, unknown>) => void;
	inspector: { innerHTML: string };
} {
	const exposed: Record<string, unknown> = {};
	const inspector = { innerHTML: "" };
	const testableScript = appScript.replace(
		"initialise().catch(showError);",
		"globalThis.collectStoryLabels = collectStoryLabels; globalThis.renderInspector = renderInspector; globalThis.inspector = inspector;",
	);
	const runClient = new Function("window", "document", "globalThis", testableScript);

	runClient(
		{ d3: undefined },
		{
			getElementById: (id: string) => (id === "inspector" ? inspector : {}),
		},
		exposed,
	);

	return exposed as ReturnType<typeof loadClientHelpers>;
}

test("keeps lowercase epic as a user-story category label", () => {
	const { collectStoryLabels } = loadClientHelpers();

	expect(
		collectStoryLabels({
			children: [{ type: "story", labels: ["epic", "security"] }],
		}),
	).toEqual([
		["epic", 1],
		["security", 1],
	]);
});

test("renders a readable, structured user-story inspector", () => {
	const { inspector, renderInspector } = loadClientHelpers();

	renderInspector({
		type: "story",
		id: "LOCAL-STORY-1",
		title: "As a user, I want precise proof",
		status: "in-progress",
		progress: { completedCriteria: 1, totalCriteria: 2 },
		criteria: [
			{ completed: true, text: "The result is recorded" },
			{ completed: false, text: "A < B remains escaped" },
		],
		labels: ["Feature"],
		linearUrl: null,
	});

	expect(inspector.innerHTML).toContain('class="inspector__header"');
	expect(inspector.innerHTML).toContain('class="inspector__summary"');
	expect(inspector.innerHTML).toContain('class="inspector__section-count">1/2');
	expect(inspector.innerHTML).toContain('<ol class="criteria-list">');
	expect(inspector.innerHTML).toContain('class="criterion__text"');
	expect(inspector.innerHTML).toContain("A &lt; B remains escaped");
	expect(inspector.innerHTML).toContain("<strong>50%</strong>");
});
