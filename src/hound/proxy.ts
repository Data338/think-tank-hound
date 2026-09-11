import { FastMCP } from "fastmcp";
import { z } from "zod";
import type { HoundClientLike } from "./client.js";

/**
 * Serialize an MCP CallToolResult into the JSON-string envelope this
 * server uses for research tools (same contract the Exa tools had).
 */
function serializeResult(res: unknown): string {
  if (res && typeof res === "object" && "content" in res) {
    const blocks = (res as { content: unknown }).content;
    if (Array.isArray(blocks)) {
      const texts = blocks
        .filter((b): b is { type: string; text: string } =>
          !!b && typeof b === "object" && (b as { type: unknown }).type === "text")
        .map((b) => b.text);
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return JSON.stringify(res);
}

function err(message: string): string {
  return JSON.stringify({ error: message });
}

/**
 * Research tools backed by the owned Hound child (replaces Exa).
 * P0 surface mirrors exa_search/exa_answer: search + fetch only.
 * Screenshot/crawl stay in the production Hound install.
 */
export function registerHoundTools(server: FastMCP, client: HoundClientLike): void {
  server.addTool({
    name: "hound_search",
    description:
      "Search the web via the embedded Hound engine (keyless multi-engine, no API key). Returns URLs + snippets; follow up with hound_fetch for full content.",
    parameters: z.object({
      query: z.string().min(1).describe("The search query to execute"),
      focus: z.string().optional().describe("Focus filter: only matching blocks returned (saves context)"),
      site: z.string().optional().describe("Restrict to one domain, e.g. 'github.com'"),
      freshness: z.enum(["day", "week", "month", "year"]).optional().describe("Time filter for results"),
      max_results: z.number().min(1).max(50).default(6).describe("Number of results (1-50)"),
    }),
    execute: async (params) => {
      try {
        const options: Record<string, unknown> = { max_results: params.max_results };
        if (params.freshness) options.freshness = params.freshness;
        if (params.site) options.site = params.site;
        const args: Record<string, unknown> = { query: params.query, options };
        if (params.focus) args.focus = params.focus;
        return serializeResult(await client.callTool("mcp_smart_search", args));
      } catch (error) {
        return err(`hound_search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  server.addTool({
    name: "hound_fetch",
    description:
      "Fetch page/URL content via the embedded Hound engine (anti-bot bypass). Use after hound_search. Pass focus to extract only relevant blocks.",
    parameters: z.object({
      url: z.string().optional().describe("Single URL to fetch"),
      urls: z.array(z.string()).optional().describe("Multiple URLs (parallel fetch)"),
      focus: z.string().optional().describe("Query-focused extraction: only relevant blocks returned"),
      pages: z.string().optional().describe("PDF only: page spec like '1-5'"),
      max_content_chars: z.number().min(500).optional().describe("Max chars of extracted content"),
    }).refine((p) => p.url || (p.urls && p.urls.length > 0), {
      message: "Either url or non-empty urls is required",
    }),
    execute: async (params) => {
      try {
        const args: Record<string, unknown> = {};
        if (params.url) args.url = params.url;
        if (params.urls) args.urls = params.urls;
        if (params.focus) args.focus = params.focus;
        if (params.pages) args.pages = params.pages;
        if (params.max_content_chars) args.max_content_chars = params.max_content_chars;
        return serializeResult(await client.callTool("mcp_smart_fetch", args));
      } catch (error) {
        return err(`hound_fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
}
