/**
 * km-monitor/src/extractor.ts
 *
 * Gold Extractor — uses an LLM to analyse a raw conversation and extract
 * high-quality, verified "gold" insights for the Knowledge Map.
 *
 * The extractor calls the OpenAI-compatible API (pre-configured in the
 * sandbox via `OPENAI_API_KEY`) with a structured extraction prompt and
 * parses the response into typed `GoldEntry` objects.
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

async function callLlm(messages: LlmMessage[]): Promise<string> {
  // Dynamically import to avoid hard dep at module load time.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const response = (await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
    temperature: 0.2,
    max_tokens: 2048,
  })) as LlmResponse;
  return response.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Extraction Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Knowledge Map curator. Your task is to read a conversation between a user and one or more AI assistants and extract high-quality, verified "gold" insights that are worth preserving in a long-term knowledge base.

For each insight you identify, output a JSON object with the following fields:
- "title": a concise, descriptive title (max 80 characters)
- "body": the full insight, written as a clear, self-contained statement (1–4 sentences)
- "confidence": a float in [0.0, 1.0] reflecting how certain you are this is accurate and useful
- "tags": an array of 2–5 lowercase keyword tags

Output a JSON array of such objects. If no insights are worth preserving, output an empty array [].
Do NOT include any text outside the JSON array.`;

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  entries: GoldEntry[];
  /** Number of raw candidates returned by the LLM before filtering. */
  rawCandidateCount: number;
  /** Entries rejected due to low confidence. */
  rejectedCount: number;
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
  const userPrompt = `Below is a conversation. Extract gold insights.\n\n---\n${record.content}\n---`;

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
    return { entries: [], rawCandidateCount: 0, rejectedCount: 0 };
  }

  // Parse the JSON array from the LLM response.
  let candidates: Array<{
    title: string;
    body: string;
    confidence: number;
    tags: string[];
  }> = [];

  try {
    // Strip potential markdown code fences.
    const cleaned = rawText.replace(/```(?:json)?/g, "").trim();
    candidates = JSON.parse(cleaned);
    if (!Array.isArray(candidates)) candidates = [];
  } catch {
    console.warn(
      `[km-monitor/extractor] Failed to parse LLM JSON for conversation ${record.id}. Raw:\n${rawText}`,
    );
    return { entries: [], rawCandidateCount: 0, rejectedCount: 0 };
  }

  const rawCandidateCount = candidates.length;
  const now = new Date().toISOString();

  const provenance: Provenance = {
    conversationId: record.id,
    source: record.source,
    originUrl: record.originUrl,
    extractedBy: "km-monitor/extractor@1.0.0",
    extractedAt: now,
  };

  const entries: GoldEntry[] = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    if (
      typeof candidate.confidence !== "number" ||
      candidate.confidence < confidenceThreshold
    ) {
      rejectedCount++;
      continue;
    }

    entries.push({
      id: randomUUID(),
      title: String(candidate.title ?? "").slice(0, 120),
      body: String(candidate.body ?? ""),
      confidence: Math.min(1, Math.max(0, candidate.confidence)),
      tags: Array.isArray(candidate.tags)
        ? candidate.tags.map(String).slice(0, 8)
        : [],
      provenance,
      addedAt: now,
    });
  }

  return { entries, rawCandidateCount, rejectedCount };
}
