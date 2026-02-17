import { describe, expect, test } from "bun:test";
import { buildIssueFilter } from "../../../src/linear/filters.ts";

const PROJECT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

describe("buildIssueFilter", () => {
	test("with projectId only", () => {
		const filter = buildIssueFilter({ projectId: PROJECT_ID });
		expect(filter).toEqual({
			project: { id: { eq: PROJECT_ID } },
		});
	});

	test("with issue identifiers", () => {
		const filter = buildIssueFilter({
			identifiers: ["ENG-42", "ENG-43"],
		});
		expect(filter).toEqual({
			identifier: { in: ["ENG-42", "ENG-43"] },
		});
	});

	test("with status name", () => {
		const filter = buildIssueFilter({ statusName: "In Progress" });
		expect(filter).toEqual({
			state: { name: { eqIgnoreCase: "In Progress" } },
		});
	});

	test("with assignee email", () => {
		const filter = buildIssueFilter({ assigneeEmail: "jane@co.com" });
		expect(filter).toEqual({
			assignee: { email: { eq: "jane@co.com" } },
		});
	});

	test("with creator email", () => {
		const filter = buildIssueFilter({ creatorEmail: "bob@co.com" });
		expect(filter).toEqual({
			creator: { email: { eq: "bob@co.com" } },
		});
	});

	test("combines multiple filters", () => {
		const filter = buildIssueFilter({
			projectId: PROJECT_ID,
			statusName: "Backlog",
			assigneeEmail: "jane@co.com",
		});

		expect(filter).toEqual({
			project: { id: { eq: PROJECT_ID } },
			state: { name: { eqIgnoreCase: "Backlog" } },
			assignee: { email: { eq: "jane@co.com" } },
		});
	});

	test("with no filters returns empty object", () => {
		const filter = buildIssueFilter({});
		expect(filter).toEqual({});
	});

	test("combines all filters together", () => {
		const filter = buildIssueFilter({
			projectId: PROJECT_ID,
			identifiers: ["ENG-42"],
			statusName: "Todo",
			assigneeEmail: "jane@co.com",
			creatorEmail: "bob@co.com",
		});

		expect(filter).toEqual({
			project: { id: { eq: PROJECT_ID } },
			identifier: { in: ["ENG-42"] },
			state: { name: { eqIgnoreCase: "Todo" } },
			assignee: { email: { eq: "jane@co.com" } },
			creator: { email: { eq: "bob@co.com" } },
		});
	});
});
