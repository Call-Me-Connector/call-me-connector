import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { store, type CallRecord } from "./store.js";
import { placeCall } from "./twilio.js";
import { findById, isSubscribed } from "./users.js";
import { callsThisMonth, recordCall } from "./usage.js";

const DEFAULT_TIMEOUT_S = 150;
const MAX_TIMEOUT_S = 240;

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
 * Build a fresh McpServer bound to ONE authenticated user. In the stateless
 * Streamable-HTTP setup we create one of these per request, stamped with the
 * user id from the verified access token — so call_me only ever rings that
 * user's own verified number.
 */
export function createMcpServer(userId: string): McpServer {
  const server = new McpServer(
    { name: "call-me-connector", version: "1.0.0" },
    {
      instructions:
        "Use call_me to phone the user when a task is finished or you're blocked. Report what " +
        "you did (or where you got stuck) in `summary`; it's spoken aloud, then the user's spoken " +
        "reply comes back so you can act on it. It always calls the signed-in user's own verified number.",
    }
  );

  server.registerTool(
    "call_me",
    {
      title: "Call me with an update",
      annotations: {
        title: "Call me with an update",
        readOnlyHint: false, // it places a phone call — a real-world side effect
        destructiveHint: false, // doesn't delete or overwrite anything
        idempotentHint: false, // each call is a distinct phone call
        openWorldHint: true, // interacts with the external world (telephony)
      },
      description:
        "Phone the signed-in user to tell them what you did (or where you got stuck) and collect " +
        "their spoken instructions to get back on track. Use this when a task is DONE, when you are " +
        "BLOCKED and need a decision, or whenever they asked to be called. Put a concise, " +
        "conversational recap in `summary` (e.g. \"I finished the report but got stuck on the budget " +
        "tab\"), plus optional `next_steps` and `questions`. By default it waits and returns exactly " +
        "what the user says so you can carry out their instructions. It always calls their own " +
        "verified number — you cannot specify a different one.",
      inputSchema: {
        summary: z
          .string()
          .min(1)
          .describe("What you accomplished or where you got stuck / why you're calling. Read aloud."),
        questions: z
          .array(z.string())
          .optional()
          .describe("Questions to ask the user, each read aloud in order."),
        next_steps: z
          .string()
          .optional()
          .describe("What you plan to do next, read aloud before the questions."),
        conversational: z
          .boolean()
          .optional()
          .describe("Multi-turn mode: keep listening across several replies until the user says \"done\". Requires the Pro plan; rejected on Basic."),
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
      const user = await findById(userId);
      if (!user) {
        return { isError: true, content: [{ type: "text", text: "Your account could not be found. Please reconnect the connector." }] };
      }
      if (!user.phone_verified || !user.phone_e164) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "No verified phone number is on file for this account, so there's nothing to call. " +
                "Ask the user to reconnect the connector and complete phone verification.",
            },
          ],
        };
      }

      // Paywall — only enforced once Stripe billing is configured.
      if (config.billingEnabled && !isSubscribed(user)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "This account doesn't have an active subscription, so calls are paused. " +
                `Ask the user to subscribe (Basic $6/mo or Pro $9/mo) at ${config.publicUrl}/account to start receiving calls.`,
            },
          ],
        };
      }

      // Fair-use monthly cap (protects margin from heavy telephony usage).
      const cap = user.tier === "pro" ? config.callCaps.pro : config.callCaps.basic;
      const used = await callsThisMonth(userId);
      if (used >= cap) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `This account has reached its monthly fair-use limit of ${cap} calls on the ${user.tier} plan ` +
                `(resets on the 1st). Tell the user, and suggest upgrading to Pro if they need more.`,
            },
          ],
        };
      }

      // Conversational (multi-turn) calls are a Pro-plan feature.
      const wantsConversation = input.conversational ?? false;
      if (wantsConversation && user.tier !== "pro") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Multi-turn conversation mode requires the Pro plan. This account is on Basic " +
                "(one-shot calls only). Retry without `conversational`, or upgrade to Pro.",
            },
          ],
        };
      }

      const rec = store.create({
        userId,
        summary: input.summary,
        questions: input.questions ?? [],
        nextSteps: input.next_steps,
        to: user.phone_e164,
        conversational: wantsConversation,
      });

      try {
        await placeCall(rec);
        await recordCall(userId); // count toward the monthly fair-use cap
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
          content: [{ type: "text", text: `Calling you now. Use get_call_result with call_id ${rec.id} to fetch the reply.` }],
          structuredContent: structured(rec),
        };
      }

      const timeoutMs = Math.min(Math.max(input.timeout_seconds ?? DEFAULT_TIMEOUT_S, 15), MAX_TIMEOUT_S) * 1000;
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
      annotations: {
        title: "Get the result of a phone call",
        readOnlyHint: true, // only reads a prior call's status/transcript
        openWorldHint: false,
      },
      description:
        "Fetch the current status and captured spoken reply for a call previously started with " +
        "call_me. Use this if call_me returned a pending status or if you used wait_for_reply=false.",
      inputSchema: {
        call_id: z.string().describe("The call_id returned by call_me."),
      },
    },
    async ({ call_id }) => {
      const rec = store.get(call_id);
      // Ownership check: a user can only read their own calls.
      if (!rec || rec.userId !== userId) {
        return {
          isError: true,
          content: [{ type: "text", text: `No call found with call_id ${call_id}. It may have expired (records are kept for one hour).` }],
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
