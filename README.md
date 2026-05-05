# picoagents

A **Bun** + **Vercel AI SDK** harness for a **planner → plan approval → orchestrator** loop. The orchestrator spawns **named subagents** in parallel (configurable concurrency), merges results, and tracks work against a small **session store** under `.picoagent/`.

Use it with a local **OpenAI-compatible** server (e.g. **LM Studio** on `http://127.0.0.1:1234/v1`) or any compatible cloud endpoint.

## Requirements

- [Bun](https://bun.sh) 1.x (required to run the CLI and install dependencies)
- A running chat model exposed at `OPENAI_BASE_URL` (see below)

## Install & run

**From npm** [picoagents](https://www.npmjs.com/package/picoagents):

```bash
bun install -g picoagents
picoagents --goal "Your high-level task here"
```

Or with Bun:

```bash
bun add -g picoagents
picoagents --goal "…"
```

**From a clone of this repository:**

```bash
bun install
```

Run the CLI (from the project you want to “work in” — that directory becomes the **project root** for `.picoagent/` and skills):

```bash
# Interactive TUI (default when stdout/stdin are a TTY)
bun run src/cli.ts --goal "Your high-level task here"

# Shorthand: first non-flag argument is the goal
bun run src/cli.ts "Summarize the repo and list next steps"
```

After a global install, the command is `picoagents`:

```bash
picoagents --goal "…"
```

### Headless (CI / scripts)

When stdin/stdout are **not** a TTY, the TUI is disabled. You must either auto-approve the plan or skip planning:

```bash
bun run src/cli.ts --headless --yes --goal "…"           # run planner, auto-approve
bun run src/cli.ts --headless --oneshot --goal "…"     # skip planner, single-phase plan
```

## CLI flags


| Flag                   | Meaning                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `--goal <text>`        | User goal (optional if you pass the goal as a positional argument)                       |
| `--project-root <dir>` | Project root; defaults to current working directory. Hosts `.picoagent/`.                |
| `--workspace <dir>`    | Files the **generalist** can read/grep; defaults to `--project-root`.                    |
| `-y`, `--yes`          | Approve the planner output without prompting (required for headless unless `--oneshot`). |
| `--oneshot`            | Skip the planner LLM and use a single-task plan; goes straight to the orchestrator.      |
| `--headless`           | Disable Ink TUI even if a TTY is present.                                                |
| `--enable-developer-agent` | Enable bundled built-in `developer` agent for this run. |
| `--enable-research-agent`  | Enable bundled built-in `researcher` agent for this run. |
| `--smoke`              | Connectivity check only (see below).                                                     |
| `-h`, `--help`         | Help text.                                                                               |


## Environment variables


| Variable                         | Purpose                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENAI_BASE_URL`                | OpenAI-compatible API base URL. Default: `http://127.0.0.1:1234/v1` (LM Studio style).                                                                 |
| `OPENAI_API_KEY`                 | Sent as the Bearer token; local servers often accept any placeholder (default `lm-studio`).                                                            |
| `PICOAGENT_MODEL`                | Default chat model id for **all** roles unless overridden below.                                                                                       |
| `PICOAGENT_MODEL_PLANNER`        | Planner model id override.                                                                                                                             |
| `PICOAGENT_MODEL_ORCHESTRATOR`   | Orchestrator model id override.                                                                                                                        |
| `PICOAGENT_MODEL_SUBAGENT`       | Subagent model id override.                                                                                                                            |
| `PICOAGENT_MAX_PARALLEL`         | Max concurrent subagent runs in one batch (default **3**).                                                                                             |
| `PICOAGENT_ALLOW_SHELL`          | Set to `1` to expose `run_command` for the built-in **generalist** (runs under `--workspace`). **High risk** — only when you trust the model and task. |
| `PICOAGENT_SKILL_BODY_MAX_CHARS` | Upper bound on skill body returned by `readSkill` (default large).                                                                                     |
| `SERPAPI_API_KEY`                | Required for the **researcher** subagent’s `duckduckgo_search` tool (SerpAPI DuckDuckGo JSON). |


Example for LM Studio:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:1234/v1
export OPENAI_API_KEY=lm-studio
export PICOAGENT_MODEL=your-loaded-model-id
```

## Smoke test

Verifies the API and model return text:

```bash
bun run src/cli.ts --smoke
# or: bun run smoke
```

## Project layout: `.picoagent/`

At `--project-root` (default: current directory):


| Path                               | Role                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `.picoagent/sessions/<uuid>/...`   | Per-run artifacts (`plan.json`, `golden.json`) for observability.   |
| `.picoagent/AGENT.md`              | Optional durable notes (append-only if used by orchestrator tools). |
| `.picoagent/agents/*.ts`           | **Custom subagents** (see below). |
| `.picoagent/skills/*.mdc`          | **Skills** (see below).                                              |
| `.picoagent/package.json`          | Local workspace deps for agent/skill code (auto-created if missing). |
| `.picoagent/node_modules/`         | Local deps installed by bootstrap (`bun install` in `.picoagent`).   |
| `.picoagent/.gitignore`            | Auto-managed ignore entries for `sessions` and `node_modules`.       |

### `.picoagent` workspace bootstrap

On each session boot, picoagents initializes `.picoagent` as a lightweight local workspace:

1. Ensures `.picoagent/.gitignore` contains:
   - `sessions`
   - `node_modules`
2. Creates `.picoagent/package.json` **only if missing** (never overwrites user-managed dependencies).
3. Runs `bun install` with cwd=`.picoagent`.

This lets agent files import workspace-local dependencies without polluting the project root dependency tree.


## Custom subagents

### Bundled built-in agents (feature-gated)

| Agent id       | Role |
| -------------- | ---- |
| `developer`    | Read/search workspace **and** write UTF-8 files via `write_file` / `ensure_dir` (no shell). |
| `researcher`   | SerpAPI **DuckDuckGo** JSON search (`organic_results`, `search_assist`) plus raw `fetch_web_page`. Needs `SERPAPI_API_KEY`. |

Enable them explicitly per run:

- `--enable-developer-agent`
- `--enable-research-agent`

When enabled, built-in ids (`developer` / `researcher`) override any custom agent with the same id. When not enabled, custom agents with those ids run normally.

For custom agents, tool bundles stay reusable from code via:

- `SubAgent.withDeveloperWriteTools()`
- `SubAgent.withResearcherTools()`

1. Add files under `.picoagent/agents/` (`.ts` / `.tsx`). The loader walks this tree; **each file** must export a `SubAgent` as `**export default`** or `**export const subagent**`.
2. The **filename stem** (e.g. `google-enthusiast.ts` → `google-enthusiast`) becomes the default **agent id** unless you set `meta.id` on `SubAgent`.
3. Do not use the id `**generalist`** (reserved). Build with the `SubAgent` class and `tool` from the package entry point. Example (aligned with the architecture plan: a search-focused specialist):

```ts
import { SubAgent, tool } from "picoagents"; // or a relative path to `src/subagent.ts` in this repo
import { z } from "zod";

const searchTool = tool({
  description: "Searches Google and returns top 20 results",
  inputSchema: z.object({ query: z.string().describe("Search query") }),
  execute: async ({ query }) => {
    /* call your search API / fetch wrapper */
    return { results: [] as string[], query };
  },
});

const readWebsiteTool = tool({
  description: "Fetch and return plain text from a URL",
  inputSchema: z.object({ url: z.string().url() }),
  execute: async ({ url }) => {
    /* fetch + extract text */
    return { url, text: "" };
  },
});

const googleAgent = new SubAgent({
  id: "google-enthusiast", // optional; else derived from filename
  name: "Google enthusiast",
  description: "Searches the web for information and validates sources",
})
  .withSystemPrompt("You are a search-focused assistant. Prefer credible sources and cite URLs.")
  .withSkill("server-patterns.mdc") // only when that skill has alwaysApply: false
  .withDefaultTools() // optional: same workspace read/search tools as built-in generalist
  .withTool("search", searchTool)
  .withTool("read_website", readWebsiteTool);

export default googleAgent;
```

1. **Dependencies** (e.g. `axios`): install them in **this** project’s `package.json` and import from your agent file. Put **shared helpers** in e.g. `.picoagent/lib/` and import from the agent file—**do not** put non-agent `.ts` files under `agents/` or the loader will try to register them as agents.
2. **Tools**: Every subagent gets **`readSkill`** plus any tools from **`.withTool()`**. The built-in **`generalist`** always receives the default workspace set (**`read_file`**, **`list_dir`**, **`glob_search`**, **`grep`**, and optional **`run_command`** when `PICOAGENT_ALLOW_SHELL=1`). Custom agents can opt into that same set with **`.withDefaultTools()`** (merged before your custom tools; a custom tool with the same name overrides).

## Skills (`.mdc`)

Skills live in `.picoagent/skills/` as `NAME.mdc`.

Each file must start with YAML frontmatter between `---` lines, followed by the **body** (loaded lazily via `readSkill`):

```md
---
description: Conventions for HTTP handlers and error responses in this codebase
alwaysApply: false
---

# Server patterns

When implementing or reviewing route handlers:

1. **Status codes** — Use `4xx` for client mistakes, `5xx` only for unexpected server faults. Never swallow errors without logging.
2. **Timeouts** — Outbound HTTP calls should use an explicit timeout and cancel signal where the runtime supports it.
3. **Validation** — Validate inputs at the boundary (schema or equivalent); fail fast with a stable error shape `{ error: string, code?: string }`.
4. **Idempotency** — For mutating operations that may be retried, document whether the handler is safe to retry.

Subagents should call `readSkill` with the skill name when this guidance applies.
```

- `**description**` (required): Short text for the “available skills” list.
- `**alwaysApply**` (required boolean): If `true`, every subagent sees this skill in its menu; if `false`, only agents that **reference** it via `.withSkill("server-patterns.mdc")` see it.

Bodies can be long; subagents load full text **on demand** via the built-in `**readSkill`** tool (not injected wholesale into every prompt).

## Flow summary

1. **Planner** turns your goal into a structured plan (phases + tasks), unless `--oneshot`.
2. **Interactive TUI**: you approve or reject the plan (`y` / `n` / `q`).
3. **Orchestrator** runs with tools to manage tasks and `**spawn_subagents`** (parallelism capped by `PICOAGENT_MAX_PARALLEL`).
4. **Subagents** run with their tools + skill menu + `**readSkill`**.

## Troubleshooting

- **Planner fails with “no structured output”**: Some local stacks only populate a reasoning/thinking stream. The planner prompt asks the model to fill normal structured output; if it still fails, try another model or adjust server settings so assistant/content is populated.
- **Smoke fails**: Ensure LM Studio (or your server) is listening on `OPENAI_BASE_URL` and the model id matches `PICOAGENT_MODEL` / `PICOAGENT_MODEL_SUBAGENT`.

## Library usage

The package exports `**SubAgent`** and `**tool**` from `picoagents` (see `package.json` `"exports"`). For programmatic use you can import `runPicoagentSession` from `./core/session.ts` in this repo or embed the core in your own binary.

## Author & source

- **Author:** [M41den](https://github.com/m41denx)
- **Repository:** [github.com/m41denx/picoagents](https://github.com/m41denx/picoagents)

## License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See the `[LICENSE](LICENSE)` file in the repository for the full text.