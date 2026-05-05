#!/usr/bin/env bun
/**
 * Quick connectivity check against OPENAI_BASE_URL / PICOAGENT_MODEL (or subagent model).
 */
import { generateText } from "ai";
import { getLanguageModel } from "@/core/model/provider.ts";
import { getModelId } from "@/core/config.ts";

const model = getLanguageModel(getModelId("subagent"));

const r = await generateText({
  model,
  prompt: 'Reply with exactly: "picoagent-smoke-ok"',
});

const text = r.text.trim();
if (!text.includes("picoagent-smoke-ok")) {
  console.error("Unexpected response:", text);
  process.exit(1);
}
console.log("smoke ok:", text);
