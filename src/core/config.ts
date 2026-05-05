function envInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function envString(name: string, defaultValue: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : defaultValue;
}

/** Default 3 — local LM Studio friendly */
export function getMaxParallel(): number {
  return envInt("PICOAGENT_MAX_PARALLEL", 3);
}

export function getOpenAICompatConfig() {
  return {
    apiKey: envString("OPENAI_API_KEY", "lm-studio"),
    baseURL: envString("OPENAI_BASE_URL", "http://127.0.0.1:1234/v1"),
  };
}

export function getModelId(role: "planner" | "orchestrator" | "subagent"): string {
  const k =
    role === "planner"
      ? "PICOAGENT_MODEL_PLANNER"
      : role === "orchestrator"
        ? "PICOAGENT_MODEL_ORCHESTRATOR"
        : "PICOAGENT_MODEL_SUBAGENT";
  const fallback = envString("PICOAGENT_MODEL", "gpt-4o-mini");
  return envString(k, fallback);
}

export function allowShell(): boolean {
  return process.env["PICOAGENT_ALLOW_SHELL"] === "1";
}

export function maxSkillBodyChars(): number {
  return envInt("PICOAGENT_SKILL_BODY_MAX_CHARS", 1_000_000);
}
