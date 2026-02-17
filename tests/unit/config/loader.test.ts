import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../src/config/loader.ts";
import { ConfigError } from "../../../src/errors.ts";
import type { ResolvedConfig } from "../../../src/types.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../fixtures/configs");

describe("loadConfig", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		// Clone env so we can safely mutate it per test
		process.env = { ...originalEnv };
		// Remove LINEAR_API_KEY so it doesn't leak between tests
		delete process.env.LINEAR_API_KEY;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	// ------------------------------------------------------------------
	// Explicit path (--config flag)
	// ------------------------------------------------------------------

	test("loads config from explicit path (--config flag)", async () => {
		const configPath = join(FIXTURES_DIR, "valid.json");
		const config = await loadConfig({ configPath });

		expect(config.apiKey).toBe("lin_api_test1234567890abcdef");
		expect(config.defaultTeam).toBe("Engineering");
		expect(config.defaultProject).toBe("Q1 2026 Release");
		expect(config.defaultLabels).toEqual(["User Story"]);
	});

	test("throws ConfigError when explicit path doesn't exist", async () => {
		const bogusPath = join(FIXTURES_DIR, "nonexistent.json");
		expect(loadConfig({ configPath: bogusPath })).rejects.toThrow(ConfigError);
	});

	// ------------------------------------------------------------------
	// Discovery: .linearrc.json in cwd
	// ------------------------------------------------------------------

	test("discovers .linearrc.json in current working directory", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "linearstories-test-"));
		try {
			const rcPath = join(tempDir, ".linearrc.json");
			writeFileSync(rcPath, JSON.stringify({ apiKey: "lin_api_from_cwd_rc" }));

			const config = await loadConfig({ cwd: tempDir });
			expect(config.apiKey).toBe("lin_api_from_cwd_rc");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ------------------------------------------------------------------
	// Fallback: ~/.config/linearstories/config.json
	// ------------------------------------------------------------------

	test("falls back to ~/.config/linearstories/config.json", async () => {
		// We simulate by pointing HOME to a temp dir with the expected structure
		const tempHome = mkdtempSync(join(tmpdir(), "linearstories-home-"));
		try {
			const configDir = join(tempHome, ".config", "linearstories");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(
				join(configDir, "config.json"),
				JSON.stringify({ apiKey: "lin_api_from_home" }),
			);

			// Point HOME / XDG to our temp dir, and use a cwd with no .linearrc.json
			const emptyCwd = mkdtempSync(join(tmpdir(), "linearstories-empty-"));
			process.env.HOME = tempHome;

			const config = await loadConfig({ cwd: emptyCwd });
			expect(config.apiKey).toBe("lin_api_from_home");

			rmSync(emptyCwd, { recursive: true, force: true });
		} finally {
			rmSync(tempHome, { recursive: true, force: true });
		}
	});

	// ------------------------------------------------------------------
	// Parsing
	// ------------------------------------------------------------------

	test("parses all JSON fields correctly", async () => {
		const configPath = join(FIXTURES_DIR, "valid.json");
		const config = await loadConfig({ configPath });

		// Verify shape matches ResolvedConfig
		expect(config).toEqual({
			apiKey: "lin_api_test1234567890abcdef",
			defaultTeam: "Engineering",
			defaultProject: "Q1 2026 Release",
			defaultLabels: ["User Story"],
		} satisfies ResolvedConfig);
	});

	// ------------------------------------------------------------------
	// Env var override
	// ------------------------------------------------------------------

	test("LINEAR_API_KEY env var overrides apiKey in config", async () => {
		process.env.LINEAR_API_KEY = "lin_api_from_env";
		const configPath = join(FIXTURES_DIR, "valid.json");

		const config = await loadConfig({ configPath });
		expect(config.apiKey).toBe("lin_api_from_env");
	});

	// ------------------------------------------------------------------
	// Missing API key
	// ------------------------------------------------------------------

	test("throws ConfigError when no API key from any source", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "linearstories-nokey-"));
		try {
			// Config file with no apiKey, and no env var
			const rcPath = join(tempDir, ".linearrc.json");
			writeFileSync(rcPath, JSON.stringify({ defaultTeam: "Design" }));

			expect(loadConfig({ configPath: rcPath })).rejects.toThrow(ConfigError);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ------------------------------------------------------------------
	// Malformed JSON
	// ------------------------------------------------------------------

	test("throws ConfigError on malformed JSON", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "linearstories-bad-json-"));
		try {
			const badPath = join(tempDir, "bad.json");
			writeFileSync(badPath, "{ this is not valid json }}}");

			expect(loadConfig({ configPath: badPath })).rejects.toThrow(ConfigError);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ------------------------------------------------------------------
	// Defaults for optional fields
	// ------------------------------------------------------------------

	test("returns defaults for missing optional fields", async () => {
		const configPath = join(FIXTURES_DIR, "minimal.json");
		const config = await loadConfig({ configPath });

		expect(config.apiKey).toBe("lin_api_minimalkey1234567890");
		expect(config.defaultTeam).toBeNull();
		expect(config.defaultProject).toBeNull();
		expect(config.defaultLabels).toEqual([]);
	});
});
