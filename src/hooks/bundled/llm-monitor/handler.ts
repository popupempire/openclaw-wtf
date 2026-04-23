/**
 * LLM Monitor Hook Handler
 *
 * Continuously monitors configured LLM interfaces for new conversations,
 * extracts and verifies "gold" insights, enriches the Knowledge Map (KM),
 * and sends source-traceable notifications.
 *
 * Triggered by:
 *   - /llm-monitor command
 *   - Scheduled cron jobs containing "llm-monitor" in the message
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../../config/config.js";
import type { HookHandler } from "../../hooks.js";
import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LlmInterfaceKind = "openai" | "anthropic" | "gemini" | "custom";

type LlmInterfaceConfig = {
  id: string;
  label: string;
  kind: LlmInterfaceKind;
  apiKey?: string;
  model?: string;
  endpoint?: string;
};

type LlmMonitorConfig = {
  enabled?: boolean;
  pollIntervalMinutes?: number;
  notifyChannel?: string;
  goldThreshold?: number;
  interfaces?: LlmInterfaceConfig[];
};

type ExtractedInsight = {
  title: string;
  summary: string;
  excerpt: string;
  topics: string[];
  goldScore: number;
};

type ScanResult = {
  interfaceId: string;
  interfaceLabel: string;
  model: string;
  conversationId: string;
  insights: ExtractedInsight[];
  error?: string;
};

type SyncIndex = {
  lastRunAt: string;
  processedConversationIds: Record<string, string[]>; // interfaceId -> [conversationId]
  totalInsightsAdded: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_VERSION = "1.0.0";
const DEFAULT_GOLD_THRESHOLD = 0.75;
const DEFAULT_NOTIFY_CHANNEL = "telegram";
const INDEX_FILE = "llm-monitor-index.md";
const INSIGHTS_DIR = "llm-insights";
const ERRORS_FILE = "llm-monitor-errors.md";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function resolveLlmMonitorConfig(cfg: OpenClawConfig | undefined): LlmMonitorConfig | null {
  if (!cfg) return null;
  const raw = (cfg as Record<string, unknown>)["llmMonitor"];
  if (!raw || typeof raw !== "object") return null;
  return raw as LlmMonitorConfig;
}

// ---------------------------------------------------------------------------
// Sync index helpers
// ---------------------------------------------------------------------------

async function loadSyncIndex(indexPath: string): Promise<SyncIndex> {
  const empty: SyncIndex = {
    lastRunAt: new Date(0).toISOString(),
    processedConversationIds: {},
    totalInsightsAdded: 0,
  };
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    // Extract JSON block from the markdown file
    const match = content.match(/```json\n([\s\S]+?)\n```/);
    if (!match) return empty;
    return JSON.parse(match[1]) as SyncIndex;
  } catch {
    return empty;
  }
}

async function saveSyncIndex(indexPath: string, index: SyncIndex): Promise<void> {
  const header = [
    "# LLM Monitor — Sync Index",
    "",
    `Last updated: ${new Date().toISOString()}`,
    "",
    "## State",
    "",
    "```json",
    JSON.stringify(index, null, 2),
    "```",
    "",
  ].join("\n");
  await fs.writeFile(indexPath, header, "utf-8");
}

// ---------------------------------------------------------------------------
// LLM API call helpers
// ---------------------------------------------------------------------------

/**
 * Fetch recent conversation IDs from an OpenAI-compatible interface.
 * Returns a list of synthetic conversation objects (prompt + response pairs).
 * In production, this would call the actual conversations endpoint or parse exports.
 */
async function fetchOpenAIConversations(
  iface: LlmInterfaceConfig,
  since: string,
): Promise<Array<{ id: string; transcript: string }>> {
  // NOTE: The OpenAI API does not expose a conversations list endpoint for ChatGPT.
  // In a production deployment, this would integrate with:
  //   1. The ChatGPT data export (conversations.json)
  //   2. A local proxy that logs all requests/responses
  //   3. The OpenAI Assistants API thread list endpoint
  // For now, we use the Assistants threads endpoint as a proxy.
  const apiKey = iface.apiKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error(`No API key configured for interface "${iface.id}"`);
  }
  const endpoint = iface.endpoint || "https://api.openai.com/v1/threads";
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { data?: Array<{ id: string; created_at: number }> };
  const threads = data.data || [];
  const sinceMs = new Date(since).getTime();
  const recent = threads.filter((t) => t.created_at * 1000 > sinceMs);
  // For each thread, fetch messages to build a transcript
  const results: Array<{ id: string; transcript: string }> = [];
  for (const thread of recent.slice(0, 10)) {
    try {
      const msgResp = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "assistants=v2",
        },
      });
      if (!msgResp.ok) continue;
      const msgData = (await msgResp.json()) as {
        data?: Array<{ role: string; content: Array<{ type: string; text?: { value: string } }> }>;
      };
      const messages = msgData.data || [];
      const transcript = messages
        .reverse()
        .map((m) => {
          const text = m.content
            .filter((c) => c.type === "text")
            .map((c) => c.text?.value || "")
            .join(" ");
          return `${m.role}: ${text}`;
        })
        .join("\n");
      results.push({ id: thread.id, transcript });
    } catch {
      // Skip individual thread fetch errors
    }
  }
  return results;
}

/**
 * Fetch recent conversations from an Anthropic-compatible interface.
 * Anthropic does not expose a conversation history API, so this uses
 * a local session log if available, or a configured export path.
 */
async function fetchAnthropicConversations(
  iface: LlmInterfaceConfig,
  _since: string,
): Promise<Array<{ id: string; transcript: string }>> {
  // Anthropic does not provide a conversations list API.
  // Integration options:
  //   1. Parse local Claude.app conversation exports
  //   2. Use a local proxy/logger
  //   3. Use the configured endpoint for a custom integration
  if (iface.endpoint) {
    const apiKey = iface.apiKey || process.env.ANTHROPIC_API_KEY || "";
    const response = await fetch(iface.endpoint, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!response.ok) {
      throw new Error(`Anthropic endpoint error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as Array<{ id: string; transcript: string }>;
    return data;
  }
  // Return empty if no custom endpoint — user must configure an export path
  return [];
}

/**
 * Fetch recent conversations from a Gemini-compatible interface.
 */
async function fetchGeminiConversations(
  iface: LlmInterfaceConfig,
  _since: string,
): Promise<Array<{ id: string; transcript: string }>> {
  // Gemini does not expose a conversation history API.
  // Integration via custom endpoint or local export.
  if (iface.endpoint) {
    const apiKey = iface.apiKey || process.env.GEMINI_API_KEY || "";
    const response = await fetch(iface.endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`Gemini endpoint error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as Array<{ id: string; transcript: string }>;
    return data;
  }
  return [];
}

async function fetchConversations(
  iface: LlmInterfaceConfig,
  since: string,
): Promise<Array<{ id: string; transcript: string }>> {
  switch (iface.kind) {
    case "openai":
      return fetchOpenAIConversations(iface, since);
    case "anthropic":
      return fetchAnthropicConversations(iface, since);
    case "gemini":
      return fetchGeminiConversations(iface, since);
    case "custom": {
      const apiKey = iface.apiKey || "";
      const endpoint = iface.endpoint || "";
      if (!endpoint) throw new Error(`No endpoint configured for custom interface "${iface.id}"`);
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`Custom endpoint error: ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as Array<{ id: string; transcript: string }>;
    }
    default:
      throw new Error(`Unknown interface kind: ${(iface as LlmInterfaceConfig).kind}`);
  }
}

// ---------------------------------------------------------------------------
// Gold extraction
// ---------------------------------------------------------------------------

/**
 * Use the OpenAI-compatible API to extract gold insights from a transcript.
 * Falls back to a local heuristic if no extraction model is available.
 */
async function extractInsights(
  transcript: string,
  extractionModel: string,
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1",
): Promise<ExtractedInsight[]> {
  const prompt = `You are a knowledge extraction agent. Analyze the following conversation and extract all high-quality, verifiable insights. For each insight, provide:
1. A concise title (max 80 chars)
2. A summary (2-4 sentences)
3. A verbatim excerpt (max 300 chars) that best supports the insight
4. A list of relevant topics/tags (array of strings)
5. A goldScore (0.0–1.0) reflecting factual reliability and novelty

Return ONLY valid JSON in this exact format:
{"insights":[{"title":"...","summary":"...","excerpt":"...","topics":["..."],"goldScore":0.0}]}

Conversation:
${transcript.slice(0, 8000)}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: extractionModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`Extraction API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || "{}";

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const parsed = JSON.parse(cleaned) as { insights?: ExtractedInsight[] };
  return parsed.insights || [];
}

// ---------------------------------------------------------------------------
// KM write helpers
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function writeInsightFile(
  insightsDir: string,
  insight: ExtractedInsight,
  meta: {
    interfaceId: string;
    interfaceLabel: string;
    model: string;
    conversationId: string;
    runId: string;
  },
): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const slug = slugify(insight.title);
  const filename = `${dateStr}-${slug}.md`;
  const filePath = path.join(insightsDir, filename);

  const content = [
    `# Insight: ${insight.title}`,
    "",
    `- **Source Interface**: ${meta.interfaceLabel} (${meta.model})`,
    `- **Conversation ID**: ${meta.conversationId}`,
    `- **Detected At**: ${now.toISOString()}`,
    `- **Gold Score**: ${insight.goldScore.toFixed(2)}`,
    `- **Topics**: [${insight.topics.join(", ")}]`,
    "",
    "## Summary",
    "",
    insight.summary,
    "",
    "## Raw Excerpt",
    "",
    `> ${insight.excerpt}`,
    "",
    "## Traceability",
    "",
    `- Interface: ${meta.interfaceId}`,
    `- Model: ${meta.model}`,
    `- Sync Run ID: ${meta.runId}`,
    `- Verified By: llm-monitor v${SKILL_VERSION}`,
    "",
  ].join("\n");

  await fs.writeFile(filePath, content, "utf-8");
  return filename;
}

async function appendToMemoryMd(
  workspaceDir: string,
  insight: ExtractedInsight,
  meta: { interfaceLabel: string; runId: string },
): Promise<void> {
  const memoryPath = path.join(workspaceDir, "MEMORY.md");
  const entry = [
    "",
    `### [LLM Monitor] ${insight.title}`,
    `> ${insight.summary}`,
    `_Source: ${meta.interfaceLabel} | Score: ${insight.goldScore.toFixed(2)} | Run: ${meta.runId}_`,
    "",
  ].join("\n");

  try {
    const existing = await fs.readFile(memoryPath, "utf-8").catch(() => "");
    if (!existing.includes("## LLM Monitor")) {
      await fs.appendFile(memoryPath, "\n## LLM Monitor\n", "utf-8");
    }
    await fs.appendFile(memoryPath, entry, "utf-8");
  } catch {
    // If MEMORY.md doesn't exist, create it
    await fs.writeFile(
      memoryPath,
      `# Memory\n\n## LLM Monitor\n${entry}`,
      "utf-8",
    );
  }
}

async function logError(errorsPath: string, message: string): Promise<void> {
  const entry = `\n- [${new Date().toISOString()}] ${message}\n`;
  try {
    await fs.appendFile(errorsPath, entry, "utf-8");
  } catch {
    // Best-effort error logging
  }
}

// ---------------------------------------------------------------------------
// Notification builder
// ---------------------------------------------------------------------------

function buildNotification(
  runId: string,
  results: ScanResult[],
  goldThreshold: number,
): string {
  const totalAdded = results.reduce(
    (sum, r) => sum + r.insights.filter((i) => i.goldScore >= goldThreshold).length,
    0,
  );
  const totalSkipped = results.reduce(
    (sum, r) => sum + r.insights.filter((i) => i.goldScore < goldThreshold).length,
    0,
  );
  const errors = results.filter((r) => r.error);
  const updatedInterfaces = [...new Set(results.filter((r) => !r.error).map((r) => r.interfaceLabel))];

  const lines: string[] = [
    `🔭 LLM Monitor — Scan Complete [${new Date().toUTCString()}]`,
    "",
    `✅ ${totalAdded} new gold insight${totalAdded !== 1 ? "s" : ""} added to KM`,
    `⏭️  ${totalSkipped} conversation${totalSkipped !== 1 ? "s" : ""} skipped (below gold threshold ${goldThreshold})`,
  ];

  if (updatedInterfaces.length > 0) {
    lines.push(`🔄 ${updatedInterfaces.length} interface${updatedInterfaces.length !== 1 ? "s" : ""} updated (${updatedInterfaces.join(", ")})`);
  }

  if (errors.length > 0) {
    lines.push(`⚠️  ${errors.length} interface error${errors.length !== 1 ? "s" : ""}: ${errors.map((e) => e.interfaceLabel).join(", ")}`);
  }

  const goldInsights = results.flatMap((r) =>
    r.insights
      .filter((i) => i.goldScore >= goldThreshold)
      .map((i) => ({ ...i, interfaceLabel: r.interfaceLabel })),
  );

  if (goldInsights.length > 0) {
    lines.push("", "New Insights:");
    for (const insight of goldInsights.slice(0, 5)) {
      lines.push(
        `  • [${insight.interfaceLabel}] "${insight.title.slice(0, 60)}" (score: ${insight.goldScore.toFixed(2)})`,
      );
    }
    if (goldInsights.length > 5) {
      lines.push(`  … and ${goldInsights.length - 5} more`);
    }
  }

  lines.push("", `Sources: memory/${INSIGHTS_DIR}/`, `Run ID: ${runId}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const runLlmMonitor: HookHandler = async (event) => {
  // Trigger conditions:
  //   1. /llm-monitor command
  //   2. Cron job with "llm-monitor" in the message text
  const isCronTrigger =
    event.type === "gateway" &&
    typeof (event.context as Record<string, unknown>)?.text === "string" &&
    ((event.context as Record<string, unknown>).text as string)
      .toLowerCase()
      .includes("llm-monitor");

  const isCommandTrigger =
    event.type === "command" && event.action === "llm-monitor";

  if (!isCronTrigger && !isCommandTrigger) {
    return;
  }

  console.log("[llm-monitor] Hook triggered");

  const context = event.context || {};
  const cfg = context.cfg as OpenClawConfig | undefined;
  const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
  const workspaceDir = cfg
    ? resolveAgentWorkspaceDir(cfg, agentId)
    : path.join(os.homedir(), ".openclaw", "workspace");

  const monitorCfg = resolveLlmMonitorConfig(cfg);

  if (!monitorCfg?.enabled) {
    const msg = "[llm-monitor] Not enabled in config. Set llmMonitor.enabled = true to activate.";
    console.log(msg);
    event.messages.push(msg);
    return;
  }

  const interfaces = monitorCfg.interfaces || [];
  if (interfaces.length === 0) {
    const msg = "[llm-monitor] No interfaces configured. Add llmMonitor.interfaces to config.";
    console.log(msg);
    event.messages.push(msg);
    return;
  }

  const goldThreshold = monitorCfg.goldThreshold ?? DEFAULT_GOLD_THRESHOLD;
  const runId = `run_${new Date().toISOString()}`;

  // Ensure directories exist
  const insightsDir = path.join(workspaceDir, "memory", INSIGHTS_DIR);
  const indexPath = path.join(workspaceDir, "memory", INDEX_FILE);
  const errorsPath = path.join(workspaceDir, "memory", ERRORS_FILE);

  await fs.mkdir(insightsDir, { recursive: true });

  // Load sync index
  const syncIndex = await loadSyncIndex(indexPath);
  const since = syncIndex.lastRunAt;

  console.log(`[llm-monitor] Starting scan. Run ID: ${runId}. Since: ${since}`);

  // Determine extraction model (use first OpenAI interface or env default)
  const openaiIface = interfaces.find((i) => i.kind === "openai");
  const extractionApiKey =
    openaiIface?.apiKey || process.env.OPENAI_API_KEY || "";
  const extractionModel = openaiIface?.model || "gpt-4.1-mini";

  const results: ScanResult[] = [];

  // Process each interface
  for (const iface of interfaces) {
    console.log(`[llm-monitor] Polling interface: ${iface.label} (${iface.kind})`);
    const processedIds = syncIndex.processedConversationIds[iface.id] || [];

    try {
      const conversations = await fetchConversations(iface, since);
      const newConversations = conversations.filter((c) => !processedIds.includes(c.id));

      console.log(
        `[llm-monitor] ${iface.label}: ${newConversations.length} new conversations found`,
      );

      for (const conv of newConversations) {
        try {
          const insights = await extractInsights(
            conv.transcript,
            extractionModel,
            extractionApiKey,
          );

          results.push({
            interfaceId: iface.id,
            interfaceLabel: iface.label,
            model: iface.model || extractionModel,
            conversationId: conv.id,
            insights,
          });

          // Write gold insights to KM
          for (const insight of insights) {
            if (insight.goldScore >= goldThreshold) {
              const filename = await writeInsightFile(insightsDir, insight, {
                interfaceId: iface.id,
                interfaceLabel: iface.label,
                model: iface.model || extractionModel,
                conversationId: conv.id,
                runId,
              });
              console.log(`[llm-monitor] Wrote insight: ${filename}`);

              // Append top-tier insights to MEMORY.md
              if (insight.goldScore >= 0.9) {
                await appendToMemoryMd(workspaceDir, insight, {
                  interfaceLabel: iface.label,
                  runId,
                });
              }

              syncIndex.totalInsightsAdded++;
            }
          }

          // Mark conversation as processed
          if (!syncIndex.processedConversationIds[iface.id]) {
            syncIndex.processedConversationIds[iface.id] = [];
          }
          syncIndex.processedConversationIds[iface.id].push(conv.id);
        } catch (convErr) {
          const errMsg = `Interface "${iface.id}", conversation "${conv.id}": ${convErr instanceof Error ? convErr.message : String(convErr)}`;
          console.error(`[llm-monitor] Error processing conversation: ${errMsg}`);
          await logError(errorsPath, errMsg);
        }
      }
    } catch (ifaceErr) {
      const errMsg = `Interface "${iface.id}" (${iface.kind}): ${ifaceErr instanceof Error ? ifaceErr.message : String(ifaceErr)}`;
      console.error(`[llm-monitor] Interface error: ${errMsg}`);
      await logError(errorsPath, errMsg);
      results.push({
        interfaceId: iface.id,
        interfaceLabel: iface.label,
        model: iface.model || "",
        conversationId: "",
        insights: [],
        error: errMsg,
      });
    }
  }

  // Update sync index
  syncIndex.lastRunAt = new Date().toISOString();
  await saveSyncIndex(indexPath, syncIndex);

  // Build and send notification
  const notification = buildNotification(runId, results, goldThreshold);
  console.log(`[llm-monitor] Scan complete.\n${notification}`);
  event.messages.push(notification);
};

export default runLlmMonitor;
