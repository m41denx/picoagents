import { resolve } from "node:path";

export type CliArgs = {
  projectRoot: string;
  workspaceRoot?: string;
  goal?: string;
  yes: boolean;
  oneshot: boolean;
  headless: boolean;
  verbose: boolean;
  infinite: boolean;
  enableDeveloperAgent: boolean;
  enableResearchAgent: boolean;
  smoke: boolean;
  help: boolean;
};

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    projectRoot: process.cwd(),
    yes: false,
    oneshot: false,
    headless: false,
    verbose: false,
    infinite: false,
    enableDeveloperAgent: false,
    enableResearchAgent: false,
    smoke: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--oneshot") out.oneshot = true;
    else if (a === "--headless") out.headless = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--infinite") out.infinite = true;
    else if (a === "--enable-developer-agent") out.enableDeveloperAgent = true;
    else if (a === "--enable-research-agent") out.enableResearchAgent = true;
    else if (a === "--smoke") out.smoke = true;
    else if (a === "--project-root" && argv[i + 1]) {
      out.projectRoot = resolve(argv[++i]!);
    } else if (a === "--workspace" && argv[i + 1]) {
      out.workspaceRoot = resolve(argv[++i]!);
    } else if (a === "--goal" && argv[i + 1]) {
      out.goal = argv[++i];
    } else if (!a.startsWith("-") && !out.goal) {
      out.goal = a;
    }
  }
  return out;
}

export function printHelp(): void {
  console.log(`picoagents — Bun + AI SDK subagent harness

Usage:
  picoagents [--project-root <dir>] [--workspace <dir>] [--goal <text>] [--yes] [--oneshot] [--headless] [--verbose] [--infinite] [--enable-developer-agent] [--enable-research-agent]
  picoagents --smoke

Flags:
  --oneshot   Skip planner; single-task plan and go straight to orchestrator
  --verbose   Full step traces on stderr ([picoagents:…]); TUI shows untrimmed output
  --infinite  Loop iterations until Ctrl+C (1st graceful, 2nd force)
  --enable-developer-agent  Enable bundled built-in "developer" agent
  --enable-research-agent   Enable bundled built-in "researcher" agent
  --enable-developer-agent  Enable bundled built-in "developer" agent
  --enable-research-agent   Enable bundled built-in "researcher" agent

Environment:
  OPENAI_BASE_URL             OpenAI-compatible API base (default LM Studio)
  OPENAI_API_KEY              API key (dummy ok for local)
  PICOAGENT_MODEL             Default model id for all roles
  PICOAGENT_MODEL_PLANNER     Planner model id (optional override)
  PICOAGENT_MODEL_ORCHESTRATOR
  PICOAGENT_MODEL_SUBAGENT
  PICOAGENT_MAX_PARALLEL      Subagent concurrency (default 3)
  PICOAGENT_ALLOW_SHELL=1     Enable run_command for the built-in generalist
  PICOAGENT_SKILL_BODY_MAX_CHARS  Max skill body size from readSkill
  PICOAGENT_VERBOSE=1           Same as --verbose (step traces on stderr)
`);
}
