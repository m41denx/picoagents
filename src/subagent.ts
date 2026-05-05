import type { Tool } from "ai";

/** Convenience re-export for `.picoagent/agents` definitions */
export { tool } from "ai";

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

  /** True when `.withDefaultTools()` was used — same workspace bundle as `generalist`. */
  get includeDefaultWorkspaceTools(): boolean {
    return this._includeDefaultWorkspaceTools;
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
