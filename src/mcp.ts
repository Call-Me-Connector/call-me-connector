import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { store, type CallRecord } from "./store.js";
import { placeCall } from "./twilio.js";

const DEFAULT_TIMEOUT_S = 150;
const MAX_TIMEOUT_S = 240;

/** E.164 sanity check: a plus sign followed by up to 15 digits. */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Decide which number to dial. By default the connector is locked to the single
 * number in USER_PHONE_NUMBER, ignoring any `to` the model supplies — this is
 * the guard that keeps the connector from being turned into a robo-dialer.
 */
function resolveTarget(to?: string): { number: string } | { error: string } {
  if (!to || !config.allowNumberOverride) {
    return { number: config.userPhoneNumber };
  }
  if (!E164.test(to)) {
    return { error: `"${to}" is not a valid E.164 phone number (e.g. +15551234567).` };
  }
  return { number: to };
}

function describeResult(rec: CallRecord): string {
  if (rec.transcript) {
    return (
      `The user answered and said:\n\n"${rec.transcript}"\n\n` +
      `Act on these spoken instructions. If anything is ambiguous, ask before doing something ` +
      `irreversible. (call_id: ${rec.id})`
    );
  }
  switch (rec.status) {
    case "no-answer":
      return `The user did not pick up (no answer). No instructions were captured. (call_id: ${rec.id})`;
    case "busy":
      return `The line was busy. No instructions were captured. (call_id: ${rec.id})`;
    case "failed":
      return `The call failed${rec.error ? `: ${rec.error}` : ""}. (call_id: ${rec.id})`;
    case "canceled":
      return `The call was canceled. (call_id: ${rec.id})`;
    case "completed":
      return `The call connected but no speech was recognized. (call_id: ${rec.id})`;
    default:
      return (
        `The call is still in progress and no reply has been captured yet ` +
        `(status: ${rec.status}). Call get_call_result with call_id ${rec.id} in a few ` +
        `seconds to retrieve the user's spoken instructions.`
      );
  }
}

function structured(rec: CallRecord) {
  return {
    call_id: rec.id,
    status: rec.status,
    answered: rec.transcript != null,
    transcript: rec.transcript ?? null,
    confidence: rec.confidence ?? null,
  };
}

/**
 * Build a fresh McpServer with the connector's tools registered. In the
 * stateless Streamable-HTTP setup we create one of these per request.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "call-me-connector", version: "1.0.0" },
    {
      instructions:
        "Use call_me to phone the user's cell phone when a task is finished or blocked. " +
        "It speaks your summary, next steps, and questions aloud, then returns what the user " +
        "says back so you can act on it.",
    }
  );

  server.registerTool(
    "call_me",
    {
      title: "Call my phone with an update",
      description:
        "Phone the user's personal cell phone to deliver a spoken status update and collect " +
        "their spoken instructions. Use this when a task is DONE, when you are BLOCKED and need " +
        "a decision, or whenever the user asked to be called. Provide a concise plain-language " +
        "`summary` of what happened, an optional `next_steps` description, and any `questions` " +
        "you need answered. By default this waits for the user to answer and returns exactly " +
        "what they said (transcribed) so you can carry out their instructions. Keep the summary " +
        "and questions short and conversational — they are read aloud over the phone.",
      inputSchema: {
        summary: z
          .string()
          .min(1)
          .describe("Plain-language summary of what was accomplished or why you're calling. Read aloud."),
        questions: z
          .array(z.string())
          .optional()
          .describe("Questions to ask the user, each read aloud in order."),
        next_steps: z
          .string()
          .optional()
          .describe("What you plan to do next, read aloud before the questions."),
        to: z
          .string()
          .optional()
          .describe(
            "Override phone number in E.164 format. Ignored unless the server has ALLOW_NUMBER_OVERRIDE enabled; otherwise the call always goes to the owner's configured number."
          ),
        conversational: z
          .boolean()
          .optional()
          .describe("Multi-turn mode: keep listening across several replies until the user says \"done\", capturing everything they say. Requires the Pro plan; on the Basic plan this is rejected."),
        wait_for_reply: z
          .boolean()
          .optional()
          .describe("Whether to block until the user replies (default true). Set false to place the call and return immediately with a call_id."),
        timeout_seconds: z
          .number()
          .optional()
          .describe(`How long to wait for a reply before returning a pending status (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}).`),
      },
    },
    async (input) => {
      const target = resolveTarget(input.to);
      if ("error" in target) {
        return { isError: true, content: [{ type: "text", text: target.error }] };
      }

      // Conversational (multi-turn) calls are a Pro-plan feature.
      const wantsConversation = input.conversational ?? false;
      if (wantsConversation && config.tier !== "pro") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Multi-turn conversation mode requires the Pro plan. This connector is on the " +
                "Basic plan, which supports one-shot calls only. Retry without `conversational`, " +
                "or upgrade to Pro to enable back-and-forth calls.",
            },
          ],
        };
      }

      const rec = store.create({
        summary: input.summary,
        questions: input.questions ?? [],
        nextSteps: input.next_steps,
        to: target.number,
        conversational: wantsConversation,
      });

      try {
        await placeCall(rec);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        store.update(rec.id, { status: "failed", error: message });
        return {
          isError: true,
          content: [{ type: "text", text: `Could not place the call: ${message}` }],
          structuredContent: structured(store.get(rec.id)!),
        };
      }

      const wait = input.wait_for_reply ?? true;
      if (!wait) {
        return {
          content: [
            {
              type: "text",
              text: `Calling ${target.number} now. Use get_call_result with call_id ${rec.id} to fetch the reply.`,
            },
          ],
          structuredContent: structured(rec),
        };
      }

      const timeoutMs =
        Math.min(Math.max(input.timeout_seconds ?? DEFAULT_TIMEOUT_S, 15), MAX_TIMEOUT_S) * 1000;
      const finished = (await store.waitForReply(rec.id, timeoutMs)) ?? rec;

      return {
        content: [{ type: "text", text: describeResult(finished) }],
        structuredContent: structured(finished),
      };
    }
  );

  server.registerTool(
    "get_call_result",
    {
      title: "Get the result of a phone call",
      description:
        "Fetch the current status and captured spoken reply for a call previously started with " +
        "call_me. Use this if call_me returned a pending status (the call outlived the request " +
        "window) or if you placed the call with wait_for_reply=false.",
      inputSchema: {
        call_id: z.string().describe("The call_id returned by call_me."),
      },
    },
    async ({ call_id }) => {
      const rec = store.get(call_id);
      if (!rec) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `No call found with call_id ${call_id}. It may have expired (records are kept for one hour).`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: describeResult(rec) }],
        structuredContent: structured(rec),
      };
    }
  );

  return server;
}
