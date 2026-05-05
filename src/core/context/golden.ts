import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type GoldenState = {
  goal: string;
  summary: string;
  decisions: string[];
  facts: string[];
  openQuestions: string[];
  touchedPaths: string[];
  /** Rough token estimate for orchestrator history compaction */
  ephemeralTokens?: number;
};

const DEFAULT_GOLDEN: GoldenState = {
  goal: "",
  summary: "",
  decisions: [],
  facts: [],
  openQuestions: [],
  touchedPaths: [],
  ephemeralTokens: 0,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class GoldenStore {
  readonly dir: string;
  private state: GoldenState;

  private constructor(dir: string, state: GoldenState) {
    this.dir = dir;
    this.state = state;
  }

  static async load(projectRoot: string): Promise<GoldenStore> {
    const dir = join(projectRoot, ".picoagent");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "golden.json");
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as GoldenState;
      return new GoldenStore(dir, { ...DEFAULT_GOLDEN, ...parsed });
    } catch {
      return new GoldenStore(dir, { ...DEFAULT_GOLDEN });
    }
  }

  get(): GoldenState {
    return { ...this.state, decisions: [...this.state.decisions], facts: [...this.state.facts], openQuestions: [...this.state.openQuestions], touchedPaths: [...this.state.touchedPaths] };
  }

  patch(partial: Partial<GoldenState>): void {
    this.state = { ...this.state, ...partial };
    if (partial.decisions) this.state.decisions = [...partial.decisions];
    if (partial.facts) this.state.facts = [...partial.facts];
    if (partial.openQuestions) this.state.openQuestions = [...partial.openQuestions];
    if (partial.touchedPaths) this.state.touchedPaths = [...partial.touchedPaths];
  }

  excerptForPrompt(maxChars = 6000): string {
    const g = this.state;
    const parts = [
      `Goal: ${g.goal}`,
      `Summary: ${g.summary}`,
      g.facts.length ? `Facts:\n- ${g.facts.join("\n- ")}` : "",
      g.decisions.length ? `Decisions:\n- ${g.decisions.join("\n- ")}` : "",
      g.openQuestions.length ? `Open questions:\n- ${g.openQuestions.join("\n- ")}` : "",
    ];
    const text = parts.filter(Boolean).join("\n\n");
    return text.length > maxChars ? text.slice(0, maxChars) + "\n…" : text;
  }

  async save(): Promise<void> {
    const path = join(this.dir, "golden.json");
    await writeFile(path, JSON.stringify(this.state, null, 2), "utf8");
  }

  /**
   * Stub: if estimated tokens in `transcript` exceed budget, compress summary via LLM in a full implementation.
   */
  shouldCompact(transcript: string, budget = 12_000): boolean {
    return estimateTokens(transcript) > budget;
  }
}
