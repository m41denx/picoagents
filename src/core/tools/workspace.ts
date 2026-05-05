import { exec } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { allowShell } from "../config.ts";
import { safeResolveUnder, toPosix } from "../paths.ts";

/** Very small glob subset: `**`, `*`, path segments */
export function matchGlob(relPath: string, pattern: string): boolean {
  const norm = relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const patParts = pattern.split("/").filter(Boolean);
  const pathParts = norm.split("/").filter(Boolean);
  return globParts(pathParts, patParts, 0, 0);
}

function globParts(
  pathParts: string[],
  patParts: string[],
  i: number,
  j: number,
): boolean {
  if (j === patParts.length) return i === pathParts.length;
  const p = patParts[j]!;
  if (p === "**") {
    if (j === patParts.length - 1) return true;
    for (let k = i; k <= pathParts.length; k++) {
      if (globParts(pathParts, patParts, k, j + 1)) return true;
    }
    return false;
  }
  if (i >= pathParts.length) return false;
  if (!matchSegment(p, pathParts[i]!)) return false;
  return globParts(pathParts, patParts, i + 1, j + 1);
}

function matchSegment(pat: string, name: string): boolean {
  if (pat === "*") return true;
  if (!pat.includes("*")) return pat === name;
  const re = new RegExp(
    "^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$",
  );
  return re.test(name);
}

async function collectFiles(root: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    if (out.length >= maxFiles) return;
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= maxFiles) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".picoagent") continue;
        await walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

export function createWorkspaceTools(workspaceRoot: string) {
  const read_file = tool({
    description: "Read a UTF-8 text file under the workspace root",
    inputSchema: z.object({
      path: z.string().describe("Relative path from workspace root"),
    }),
    execute: async ({ path }) => {
      const abs = safeResolveUnder(workspaceRoot, path);
      const s = await stat(abs);
      if (!s.isFile()) throw new Error("Not a file");
      const max = 512 * 1024;
      if (s.size > max) throw new Error(`File too large (${s.size} bytes, max ${max})`);
      return { path: toPosix(path), content: await readFile(abs, "utf8") };
    },
  });

  const list_dir = tool({
    description: "List files and directories in a path under the workspace",
    inputSchema: z.object({
      path: z.string().describe("Relative directory from workspace root"),
    }),
    execute: async ({ path }) => {
      const abs = safeResolveUnder(workspaceRoot, path);
      const st = await stat(abs);
      if (!st.isDirectory()) throw new Error("Not a directory");
      const entries = await readdir(abs, { withFileTypes: true });
      return {
        path: toPosix(path),
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        })),
      };
    },
  });

  const glob_search = tool({
    description:
      "Find files matching a glob pattern relative to workspace (* and ** supported; skips node_modules/.git/.picoagent)",
    inputSchema: z.object({
      pattern: z.string().describe("Glob relative to workspace root, e.g. src/**/*.ts"),
    }),
    execute: async ({ pattern }) => {
      const files = await collectFiles(workspaceRoot, 8000);
      const matches = files
        .map((f) => toPosix(relative(workspaceRoot, f)))
        .filter((rel) => matchGlob(rel, pattern))
        .sort()
        .slice(0, 200);
      return { pattern, matches, truncated: matches.length >= 200 };
    },
  });

  const grep = tool({
    description:
      "Search for a regex in text files under the workspace (recursive, capped)",
    inputSchema: z.object({
      regex: z.string().describe("JavaScript regex pattern"),
      fileGlob: z
        .string()
        .optional()
        .describe("Optional glob for file path, e.g. **/*.ts"),
      maxMatches: z.number().optional().describe("Max matches (default 50)"),
    }),
    execute: async ({ regex, fileGlob, maxMatches }) => {
      const limit = maxMatches ?? 50;
      let re: RegExp;
      try {
        re = new RegExp(regex, "gi");
      } catch (e) {
        throw new Error(`Invalid regex: ${e}`);
      }
      const files = await collectFiles(workspaceRoot, 8000);
      const hits: { file: string; line: number; text: string }[] = [];
      for (const abs of files) {
        if (hits.length >= limit) break;
        const rel = toPosix(relative(workspaceRoot, abs));
        if (fileGlob && !matchGlob(rel, fileGlob)) continue;
        let content: string;
        try {
          content = await readFile(abs, "utf8");
        } catch {
          continue;
        }
        if (content.length > 2_000_000) continue;
        const lines = content.split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx++) {
          if (hits.length >= limit) break;
          const line = lines[idx]!;
          re.lastIndex = 0;
          if (re.test(line)) {
            hits.push({ file: rel, line: idx + 1, text: line.slice(0, 500) });
          }
        }
      }
      return { matches: hits, truncated: hits.length >= limit };
    },
  });

  const tools: Record<string, Tool> = {
    read_file,
    list_dir,
    glob_search,
    grep,
  };

  if (allowShell()) {
    tools["run_command"] = tool({
      description:
        "Run a shell command in the workspace root (only when PICOAGENT_ALLOW_SHELL=1).",
      inputSchema: z.object({
        command: z
          .string()
          .describe("Command with args, e.g. `bun test` (no newlines)"),
      }),
      execute: async ({ command }) => {
        const pexec = promisify(exec);
        const { stdout, stderr } = await pexec(command, {
          cwd: workspaceRoot,
          maxBuffer: 2 * 1024 * 1024,
        });
        return { stdout, stderr };
      },
    });
  }

  return tools;
}
