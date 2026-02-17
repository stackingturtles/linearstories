import { describe, expect, test } from "bun:test";
import { ConfigError, LinearApiError, ParseError, ResolverError } from "../../src/errors.ts";
import type { UserStory } from "../../src/types.ts";

describe("smoke test", () => {
	test("bun:test works", () => {
		expect(1 + 1).toBe(2);
	});

	test("types are importable", () => {
		const story: UserStory = {
			title: "Test story",
			linearId: null,
			linearUrl: null,
			priority: null,
			labels: [],
			estimate: null,
			assignee: null,
			status: null,
			body: "Test body",
			project: null,
			team: null,
		};
		expect(story.title).toBe("Test story");
	});

	test("error classes work correctly", () => {
		const configErr = new ConfigError("bad config");
		expect(configErr).toBeInstanceOf(Error);
		expect(configErr).toBeInstanceOf(ConfigError);
		expect(configErr.name).toBe("ConfigError");
		expect(configErr.message).toBe("bad config");

		const parseErr = new ParseError("bad parse");
		expect(parseErr).toBeInstanceOf(ParseError);
		expect(parseErr.name).toBe("ParseError");

		const apiErr = new LinearApiError("api failed");
		expect(apiErr).toBeInstanceOf(LinearApiError);
		expect(apiErr.name).toBe("LinearApiError");

		const resolverErr = new ResolverError("not found");
		expect(resolverErr).toBeInstanceOf(ResolverError);
		expect(resolverErr.name).toBe("ResolverError");
	});
});
