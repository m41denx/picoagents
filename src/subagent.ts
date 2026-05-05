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
