/**
 * km-monitor/src/extractor.ts  — v1.2.0
 *
 * Gold Extractor — uses an LLM to identify high-quality, verified insights
 * ("gold") from raw LLM conversation transcripts and formats them as
 * typed GoldEntry objects with full provenance metadata.
 *
 * Changes in v1.2.0:
 *   - `extractGoldEntries()` now accepts an optional `batchId` parameter
 *     and stamps it into each entry's Provenance for batch-level traceability.
 *   - Added retry logic (up to 2 attempts) for transient LLM API errors.
 *   - Improved JSON fence stripping to handle more LLM output formats.
 *   - Extractor version bumped to 1.2.0 in `extractedBy` field.
 */
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { ConversationRecord, GoldEntry, Provenance } from "./types.js";

// ---------------------------------------------------------------------------
// LLM client
// ---------------------------------------------------------------------------

function getExtractionModel(): string {
  return process.env.KM_MONITOR_EXTRACTION_MODEL ?? "gpt-4.1-mini";
}

const client = new OpenAI();

async function callLlm(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  retries = 2,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: getExtractionModel(),
        messages,
        temperature: 0.1,
        max_tokens: 4096,
      });
      return response.choices[0]?.message?.content ?? "";
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = 1000 * (attempt + 1);
        console.warn(
          `[km-monitor/extractor] LLM call failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms…`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Knowledge Map curator. Your task is to read a conversation transcript from an AI assistant interface and extract high-quality, verified "gold" insights that are worth preserving in a long-term knowledge base.

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
 * @param record               - The conversation to analyse.
 * @param confidenceThreshold  - Minimum confidence score to accept an entry (default 0.6).
 * @param batchId              - Optional batch ID for batch-level traceability.
 */
export async function extractGoldEntries(
  record: ConversationRecord,
  confidenceThreshold = 0.6,
  batchId?: string,
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
      .replace(/^```(?:json|JSON)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    candidates = JSON.parse(cleaned);
    if (!Array.isArray(candidates)) candidates = [];
  } catch {
    console.warn(
      `[km-monitor/extractor] Failed to parse LLM JSON for conversation ${record.id}. Raw:\n${rawText.slice(0, 300)}`,
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

    const provenance: Provenance = {
      conversationId: record.id,
      source: record.source,
      originUrl: record.originUrl,
      extractedBy: "km-monitor/extractor@1.2.0",
      extractedAt: now,
      extractionModel: model,
      rawConfidence,
      batchId,
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
