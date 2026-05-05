import type { Tool } from "ai";

/** Convenience re-export for `.picoagent/agents` definitions */
export { tool } from "ai";
export { createDeveloperWorkspaceTools } from "./core/tools/developer-write.ts";
export { createResearcherTools } from "./core/tools/researcher-tools.ts";
export type { ResearcherToolOptions } from "./core/tools/researcher-tools.ts";

export type SubAgentMeta = {
  /** Stable key; if omitted, derived from `.picoagent/agents` filename */
  id?: string;
  name: string;
  description: string;
};

/**
 * Fluent builder for custom subagents placed under `.picoagent/agents/*.ts`.
 */
export class SubAgent {
  readonly meta: SubAgentMeta;
  private _systemPrompt = "You are a helpful specialist subagent.";
  private readonly _tools = new Map<string, Tool>();
  private readonly _skillRefs = new Set<string>();
  /** Merge read/search workspace tools (same set as built-in `generalist`) at run time */
  private _includeDefaultWorkspaceTools = false;
  /** Merge `ensure_dir` + `write_file` under workspace (no shell). */
  private _includeDeveloperWriteTools = false;
  /** Merge SerpAPI DuckDuckGo search + raw `fetch_web_page` (axios). */
  private _includeResearcherTools = false;

  constructor(meta: SubAgentMeta) {
    this.meta = meta;
  }

  withSystemPrompt(prompt: string): this {
    this._systemPrompt = prompt;
    return this;
  }

  /** Reference a skill file basename, e.g. `patterns.mdc` */
  withSkill(skillFileName: string): this {
    this._skillRefs.add(skillFileName);
    return this;
  }

  withTool(name: string, t: Tool): this {
    this._tools.set(name, t);
    return this;
  }

  /**
   * Include the default workspace toolset (`read_file`, `list_dir`, `glob_search`, `grep`, optional `run_command` when `PICOAGENT_ALLOW_SHELL=1`), merged before your custom tools.
   * Built-in **generalist** always has these; custom agents opt in here.
   */
  withDefaultTools(): this {
    this._includeDefaultWorkspaceTools = true;
    return this;
  }

  /**
   * Opt in to safe workspace writes: `ensure_dir`, `write_file` (paths resolved under workspace root).
   */
  withDeveloperWriteTools(): this {
    this._includeDeveloperWriteTools = true;
    return this;
  }

  /**
   * Opt in to web research tools: SerpAPI DuckDuckGo JSON + raw page fetch. Requires `SERPAPI_API_KEY`.
   */
  withResearcherTools(): this {
    this._includeResearcherTools = true;
    return this;
  }

  /** True when `.withDefaultTools()` was used — same workspace bundle as `generalist`. */
  get includeDefaultWorkspaceTools(): boolean {
    return this._includeDefaultWorkspaceTools;
  }

  get includeDeveloperWriteTools(): boolean {
    return this._includeDeveloperWriteTools;
  }

  get includeResearcherTools(): boolean {
    return this._includeResearcherTools;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  get tools(): Record<string, Tool> {
    return Object.fromEntries(this._tools);
  }

  get skillRefs(): ReadonlySet<string> {
    return this._skillRefs;
  }
}
