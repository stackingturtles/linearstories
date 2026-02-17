export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export class ParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ParseError";
	}
}

export class LinearApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LinearApiError";
	}
}

export class ResolverError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ResolverError";
	}
}
