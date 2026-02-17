/**
 * Write-back linear_id and linear_url into existing markdown file content.
 *
 * This function takes the original file content and returns updated content
 * with linear_id and linear_url filled in for the specified stories.
 * It does NOT write to disk -- the caller handles that.
 *
 * Strategy:
 * - Split the content into story sections at H2 boundaries
 * - For each update, find the matching story by title
 * - If the story has a fenced YAML block, update linear_id and linear_url lines
 * - If the story has no YAML block, insert one after the H2 heading
 * - Reassemble the full content preserving everything else exactly
 */
export function writeBackIds(
	_filePath: string,
	content: string,
	updates: Array<{ title: string; linearId: string; linearUrl: string }>,
): string {
	if (updates.length === 0) {
		return content;
	}

	// Build a lookup map from title to update
	const updateMap = new Map<string, { linearId: string; linearUrl: string }>();
	for (const update of updates) {
		updateMap.set(update.title, {
			linearId: update.linearId,
			linearUrl: update.linearUrl,
		});
	}

	// Split at H2 boundaries while preserving the full structure.
	// We process line-by-line to preserve exact formatting.
	const lines = content.split("\n");
	const result: string[] = [];

	let currentTitle: string | null = null;
	let hasYamlBlock = false;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] as string;

		// Detect H2 heading
		if (line.startsWith("## ")) {
			// Before processing a new story, check if the previous story needed
			// a YAML block inserted (had no YAML block but had an update)
			if (currentTitle !== null && !hasYamlBlock && updateMap.has(currentTitle)) {
				// This case is handled by the lookahead below
			}

			currentTitle = line.replace(/^## /, "").trim();
			hasYamlBlock = false;

			result.push(line);
			i++;

			// If this story has an update and we need to check if it has a YAML block,
			// look ahead to see if there's a ```yaml block coming
			if (updateMap.has(currentTitle)) {
				// Look ahead past any blank lines to see if ```yaml comes next
				let lookAhead = i;
				while (lookAhead < lines.length && lines[lookAhead]?.trim() === "") {
					lookAhead++;
				}

				if (lookAhead < lines.length && lines[lookAhead]?.trim() === "```yaml") {
					// There IS a YAML block - process it normally
					hasYamlBlock = true;

					// Output any blank lines between H2 and ```yaml
					while (i < lookAhead) {
						result.push(lines[i] as string);
						i++;
					}

					// Now process the YAML block
					result.push(lines[i] as string); // ```yaml line
					i++;

					const update = updateMap.get(currentTitle) as {
						linearId: string;
						linearUrl: string;
					};
					let foundLinearId = false;
					let foundLinearUrl = false;

					// Process lines inside the YAML block until closing ```
					while (i < lines.length && lines[i]?.trim() !== "```") {
						const yamlLine = lines[i] as string;

						if (yamlLine.match(/^linear_id:/)) {
							result.push(`linear_id: ${update.linearId}`);
							foundLinearId = true;
						} else if (yamlLine.match(/^linear_url:/)) {
							result.push(`linear_url: ${update.linearUrl}`);
							foundLinearUrl = true;
						} else {
							result.push(yamlLine);
						}
						i++;
					}

					// If linear_id or linear_url weren't found in the YAML block, add them
					// (insert before the closing ```)
					if (!foundLinearId) {
						result.push(`linear_id: ${update.linearId}`);
					}
					if (!foundLinearUrl) {
						result.push(`linear_url: ${update.linearUrl}`);
					}

					// Output closing ```
					if (i < lines.length) {
						result.push(lines[i] as string);
						i++;
					}
				} else {
					// No YAML block - insert one after the H2 heading
					result.push("");
					const update = updateMap.get(currentTitle) as {
						linearId: string;
						linearUrl: string;
					};
					result.push("```yaml");
					result.push(`linear_id: ${update.linearId}`);
					result.push(`linear_url: ${update.linearUrl}`);
					result.push("```");
				}
			}

			continue;
		}

		// Default: output line as-is
		result.push(line);
		i++;
	}

	return result.join("\n");
}
