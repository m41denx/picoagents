import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT = `# AGENT.md — picoagent session memory

## Goal

## Decisions

## Facts / assumptions

## Open questions

## Paths touched
`;

export async function readAgentMd(projectRoot: string): Promise<string> {
  const p = join(projectRoot, ".picoagent", "AGENT.md");
  try {
    return await readFile(p, "utf8");
  } catch {
    return DEFAULT;
  }
}

export async function appendAgentMdSection(
  projectRoot: string,
  section: string,
  body: string,
): Promise<void> {
  const dir = join(projectRoot, ".picoagent");
  await mkdir(dir, { recursive: true });
  const p = join(dir, "AGENT.md");
  let cur = DEFAULT;
  try {
    cur = await readFile(p, "utf8");
  } catch {
    /* use default */
  }
  const stamp = new Date().toISOString();
  const block = `\n\n### ${section} (${stamp})\n\n${body}\n`;
  await writeFile(p, cur + block, "utf8");
}
