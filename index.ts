/**
 * pi-personal-ext
 * 
 * Your personal pi coding agent extension.
 * Add your custom tools, commands, and event handlers here.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // ============================================
  // Session Events
  // ============================================

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("pi-personal-ext loaded!", "info");
  });

  // ============================================
  // Your Custom Tools
  // ============================================

  // Example tool - delete or modify as needed
  // pi.registerTool({
  //   name: "my_tool",
  //   label: "My Tool",
  //   description: "What this tool does",
  //   parameters: Type.Object({
  //     input: Type.String({ description: "Something" }),
  //   }),
  //   async execute(_toolCallId, params) {
  //     return {
  //       content: [{ type: "text", text: `Result: ${params.input}` }],
  //       details: {},
  //     };
  //   },
  // });

  // ============================================
  // Your Custom Commands
  // ============================================

  // Example command - delete or modify as needed
  // pi.registerCommand("my-cmd", {
  //   description: "My custom command",
  //   handler: async (args, ctx) => {
  //     ctx.ui.notify(`Hello ${args || "world"}!`, "info");
  //   },
  // });

  // ============================================
  // Event Handlers
  // ============================================

  // Example: Block dangerous commands
  // pi.on("tool_call", async (event, ctx) => {
  //   if (event.toolName === "bash" && event.input.command?.includes("rm -rf /")) {
  //     return { block: true, reason: "That's too dangerous!" };
  //   }
  // });

  // Example: Add context before agent starts
  // pi.on("before_agent_start", async (event, ctx) => {
  //   return {
  //     message: {
  //       customType: "my-context",
  //       content: "Additional context for this session",
  //       display: true,
  //     },
  //   };
  // });
}
