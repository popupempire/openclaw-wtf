/**
 * km-monitor/src/extractor.ts
 *
 * Gold Extractor — uses an LLM to analyse a raw conversation and extract
 * high-quality, verified "gold" insights for the Knowledge Map.
 *
 * The extractor calls the OpenAI-compatible API (pre-configured in the
 * sandbox via `OPENAI_API_KEY`) with a structured extraction prompt and
 * parses the response into typed `GoldEntry` objects.
 *
 * Enhanced in v1.1.0:
 *   - Refined SYSTEM_PROMPT to emphasise factual accuracy, verifiability,
 *     and relevance — ensuring only genuine "gold" enters the KM.
 *   - Added `extractionModel` and `rawConfidence` to Provenance for full
 *     traceability of the extraction pipeline step.
 *   - Each GoldEntry now receives its own unique Provenance object (not shared).
 *   - Added `KM_MONITOR_EXTRACTION_MODEL` env var to override the model.
 *   - Improved JSON parsing with a more robust regex-based fence stripper.
 */

import { randomUUID } from "node:crypto";
import type { ConversationRecord, GoldEntry, Provenance } from "./types.js";

// ---------------------------------------------------------------------------
// LLM Client (OpenAI-compatible)
// ---------------------------------------------------------------------------

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmChoice {
  message: { content: string };
}

interface LlmResponse {
  choices: LlmChoice[];
}

/** Resolve the extraction model name from env or use the default. */
function getExtractionModel(): string {
  return process.env.KM_MONITOR_EXTRACTION_MODEL ?? "gpt-4.1-mini";
}

async function callLlm(messages: LlmMessage[]): Promise<string> {
  // Dynamically import to avoid hard dep at module load time.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const model = getExtractionModel();
  const response = (await client.chat.completions.create({
    model,
    messages,
    temperature: 0.1, // Lower temperature for more deterministic, factual extraction
    max_tokens: 4096,
  })) as LlmResponse;
  return response.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Extraction Prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for the gold extractor.
 *
 * Design principles:
 *   1. Emphasise factual accuracy and verifiability — only extract claims
 *      that are clearly supported by the conversation content.
 *   2. Require self-contained statements — each insight must be understandable
 *      without reference to the original conversation.
 *   3. Demand high specificity — prefer precise, actionable insights over
 *      vague generalisations.
 *   4. Enforce strict JSON output — no prose outside the array.
 */
const SYSTEM_PROMPT = `You are a Knowledge Map curator for a multi-LLM intelligence system. Your task is to read a conversation between a user and one or more AI assistants and extract high-quality, verified "gold" insights that are worth preserving in a long-term knowledge base.

SELECTION CRITERIA — only extract an insight if ALL of the following are true:
1. It is factually accurate and verifiable based on the conversation content.
2. It is specific and actionable, not a vague generalisation.
3. It is self-contained: a reader can understand it without seeing the original conversation.
4. It adds genuine value that would not be obvious to a domain expert.
5. It is relevant to a technical, scientific, procedural, or strategic domain.

DO NOT extract:
- Conversational pleasantries or meta-commentary about the conversation itself.
- Opinions or preferences without factual grounding.
- Redundant restatements of common knowledge.
- Partial or ambiguous claims that cannot be verified.

For each qualifying insight, output a JSON object with the following fields:
- "title": a concise, descriptive title (max 80 characters, no trailing punctuation)
- "body": the full insight, written as a clear, self-contained statement (2–5 sentences). Include the key evidence or reasoning from the conversation.
- "confidence": a float in [0.0, 1.0] reflecting how certain you are this is accurate, useful, and well-supported by the conversation. Use 0.9+ only for clearly established facts.
- "tags": an array of 2–6 lowercase keyword tags (prefer specific domain terms over generic ones)

Output a JSON array of such objects. If no insights meet the criteria, output an empty array [].
Do NOT include any text, explanation, or markdown outside the JSON array.`;

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  entries: GoldEntry[];
  /** Number of raw candidates returned by the LLM before filtering. */
  rawCandidateCount: number;
  /** Entries rejected due to low confidence. */
  rejectedCount: number;
  /** The extraction model used. */
  model: string;
}

/**
 * Extract gold entries from a single conversation record.
 *
 * @param record - The conversation to analyse.
 * @param confidenceThreshold - Minimum confidence score to accept an entry (default 0.6).
 */
export async function extractGoldEntries(
  record: ConversationRecord,
  confidenceThreshold = 0.6,
): Promise<ExtractionResult> {
  const model = getExtractionModel();
  const sourceLabel = record.source ?? "unknown";
  const userPrompt = [
    `Source: ${sourceLabel}`,
    record.originUrl ? `URL: ${record.originUrl}` : null,
    ``,
    `Below is the conversation. Extract gold insights following the criteria above.`,
    ``,
    `---`,
    record.content,
    `---`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  let rawText: string;
  try {
    rawText = await callLlm([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
  } catch (err) {
    console.error(
      `[km-monitor/extractor] LLM call failed for conversation ${record.id}:`,
      err,
    );
    return { entries: [], rawCandidateCount: 0, rejectedCount: 0, model };
  }

  // Parse the JSON array from the LLM response.
  // Strip markdown code fences (```json ... ``` or ``` ... ```) if present.
  let candidates: Array<{
    title: string;
    body: string;
    confidence: number;
    tags: string[];
  }> = [];

  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    candidates = JSON.parse(cleaned);
    if (!Array.isArray(candidates)) candidates = [];
  } catch {
    console.warn(
      `[km-monitor/extractor] Failed to parse LLM JSON for conversation ${record.id}. Raw:\n${rawText}`,
    );
    return { entries: [], rawCandidateCount: 0, rejectedCount: 0, model };
  }

  const rawCandidateCount = candidates.length;
  const now = new Date().toISOString();
  const entries: GoldEntry[] = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    const rawConfidence =
      typeof candidate.confidence === "number" ? candidate.confidence : -1;

    if (rawConfidence < confidenceThreshold) {
      rejectedCount++;
      continue;
    }

    // Each entry gets its own Provenance object with per-entry rawConfidence.
    const provenance: Provenance = {
      conversationId: record.id,
      source: record.source,
      originUrl: record.originUrl,
      extractedBy: "km-monitor/extractor@1.1.0",
      extractedAt: now,
      extractionModel: model,
      rawConfidence,
    };

    entries.push({
      id: randomUUID(),
      title: String(candidate.title ?? "").slice(0, 120).trimEnd(),
      body: String(candidate.body ?? ""),
      confidence: Math.min(1, Math.max(0, rawConfidence)),
      tags: Array.isArray(candidate.tags)
        ? candidate.tags.map(String).slice(0, 8)
        : [],
      provenance,
      addedAt: now,
    });
  }

  return { entries, rawCandidateCount, rejectedCount, model };
}
