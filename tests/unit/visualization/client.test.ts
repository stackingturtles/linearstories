import { expect, test } from "bun:test";
import appScript from "../../../src/visualization/assets/app.txt" with { type: "text" };

function loadClientHelpers(): {
	collectStoryLabels: (project: {
		children: Array<{ type: "story"; labels: string[] }>;
	}) => Array<[string, number]>;
} {
	const exposed: Record<string, unknown> = {};
	const testableScript = appScript.replace(
		"initialise().catch(showError);",
		"globalThis.collectStoryLabels = collectStoryLabels;",
	);
	const runClient = new Function("window", "document", "globalThis", testableScript);

	runClient(
		{ d3: undefined },
		{
			getElementById: () => ({}),
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
