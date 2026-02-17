export interface UserStory {
	/** Story title extracted from H2 heading */
	title: string;
	/** Linear issue ID (e.g., "ENG-42"), null if not yet imported */
	linearId: string | null;
	/** Linear issue URL, null if not yet imported */
	linearUrl: string | null;
	/** Priority level: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low */
	priority: number | null;
	/** Label names to apply */
	labels: string[];
	/** Story point estimate */
	estimate: number | null;
	/** Assignee email or display name */
	assignee: string | null;
	/** Workflow status name (e.g., "Backlog", "Todo", "In Progress", "Done") */
	status: string | null;
	/** Full markdown body including description and acceptance criteria */
	body: string;
	/** Project name (from file frontmatter or per-story override) */
	project: string | null;
	/** Team name (from file frontmatter or per-story override) */
	team: string | null;
}

export interface FileFrontmatter {
	project?: string;
	team?: string;
}

export interface ParsedFile {
	frontmatter: FileFrontmatter;
	stories: UserStory[];
	/** Original file path for write-back */
	filePath: string;
}

export interface CliConfig {
	apiKey?: string;
	defaultTeam?: string;
	defaultProject?: string;
	defaultLabels?: string[];
}

export interface ResolvedConfig {
	apiKey: string;
	defaultTeam: string | null;
	defaultProject: string | null;
	defaultLabels: string[];
}

export interface ExportFilters {
	project?: string;
	issues?: string[];
	status?: string;
	assignee?: string;
	creator?: string;
}

export interface LinearIssueData {
	id: string;
	identifier: string;
	url: string;
	title: string;
	description: string | undefined;
	priority: number;
	estimate: number | undefined;
	state: { name: string } | undefined;
	assignee: { email: string; displayName: string } | undefined;
	labels: { nodes: Array<{ name: string }> };
	project: { name: string } | undefined;
	team: { name: string; key: string };
}

export interface ImportResult {
	story: UserStory;
	action: "created" | "updated" | "failed" | "skipped";
	linearId?: string;
	linearUrl?: string;
	error?: string;
}

export interface ImportSummary {
	total: number;
	created: number;
	updated: number;
	failed: number;
	skipped: number;
	results: ImportResult[];
}
