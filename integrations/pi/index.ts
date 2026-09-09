import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getAgentDir,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { z } from "zod";
import { getDirectStatus } from "../../dist/direct-service.js";
import {
  type DirectBrokerElicitationRequest,
  type DirectBrokerElicitationResponse,
} from "../../dist/direct-broker.js";
import { ComputerUseCodeExecutor } from "../../dist/code-executor.js";
import { WindowsSessionExecutor } from "../../dist/windows-session.js";
import { WINDOWS_COMPUTER_USE_METHODS } from "../../dist/windows-tools.js";
import { getWindowsStatus, windowsPowerShell } from "../../dist/windows-runtime.js";
import { probeWindowsConnection } from "../../dist/windows-diagnostics.js";
import { type JsonObject } from "../../dist/tools.js";
import { makePrivateDirectory } from "../../dist/private-directory.js";

const jsonObjectSchema = z.record(z.string(), z.json());
const codeParameters = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: {
    code: {
      type: "string",
      description: "JavaScript body to execute. Use await sky.<method>(args), emit(value), emitImage(screenshot), and store for state shared across calls.",
    },
  },
} as const;

const codeDescription = `Run JavaScript that composes OpenAI's official signed macOS Computer Use methods in one call. No nested model is used.

Available globals:
- sky.list_apps() -> text app inventory
- sky.get_app_state({ app, disableDiff? }) -> { app, text, screenshot }
- sky.click({ app, element_index?, x?, y?, mouse_button?, click_count? })
- sky.perform_secondary_action({ app, element_index, action })
- sky.set_value({ app, element_index, value })
- sky.select_text({ app, element_index, text, prefix?, suffix?, selection? })
- sky.scroll({ app, element_index, direction, pages? })
- sky.drag({ app, from_x, from_y, to_x, to_y })
- sky.press_key({ app, key })
- sky.type_text({ app, text })
- emit(value) returns text or JSON to Pi
- emitImage(state.screenshot) returns a screenshot to Pi
- store is a persistent JSON object shared across calls

get_app_state may return an accessibility-tree diff after the first inspection. Pass disableDiff: true when you need a fresh full tree.

Example:
const state = await sky.get_app_state({ app: "TextEdit" });
emit(state.text);

Batch known actions sequentially, then inspect again before deciding the next step.`;

const windowsCodeDescription = `Compose the official Codex Windows Computer Use API. The official app must remain open with a working conversation. No nested model is used. Windows actions operate in the foreground.

- sky.list_apps() -> [{ id, displayName?, windows: Window[] }]
- sky.list_windows() -> Window[]
- sky.get_window({ id, app? }) -> Window
- sky.launch_app({ app })
- sky.activate_window({ window })
- sky.get_window_state({ window, include_screenshot?, include_text? }) -> { window, accessibility, screenshots }
- sky.click({ window, element_index?, x?, y?, screenshotId?, mouse_button?, click_count? })
- sky.perform_secondary_action({ window, element_index, action })
- sky.set_value({ window, element_index, value })
- sky.scroll({ window, x, y, scrollX, scrollY, screenshotId? })
- sky.drag({ window, from_x, from_y, to_x, to_y, screenshotId? })
- sky.press_key({ window, key })
- sky.type_text({ window, text })

Window is an unchanged official { app, id, title? } object; do not guess or rewrite it. Windows element_index is a number. Screenshots default to true, accessibility text to false; accessibility may be null even when requested. Screenshot metadata includes id, width/height and origin; its url is an opaque image handle in this adapter. sky.target is "windows". On this official build, element clicks may require screenshot-backed geometry: observe with include_screenshot:true before clicking; after a geometry error reobserve, never blindly replay input. Use the refreshed state.window. Global variables do not persist across batches; use JSON store.
Use emit(value) for text/JSON and emitImage(state.screenshots[0].url) for an image. Only emitted observations return to Pi. store is a persistent JSON object for returned windows and other state. A cancelled batch retains earlier emits and method history. Refresh state after actions before selecting new indexes or coordinates; do not reuse stale observations after failure. Official app approvals are forwarded, not bypassed. If the official service reports physical Escape or a user stop, stop issuing input; do not retry in a new session.
Text is limited to 50KB/2000 lines (full text saved when truncated); images are returned directly, never spilled to disk.`;

interface PiContentResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  fullOutputPath?: string;
}

export async function toPiContent(content: JsonObject[]): Promise<PiContentResult> {
  const textBlocks = content.filter((block) => block.type !== "image").map((block) => String(block.text ?? ""));
  const fullText = textBlocks.join("\n\n");
  const aggregate = truncateHead(fullText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!aggregate.truncated) {
    return {
      content: content.map((block) => block.type === "image"
        ? { type: "image", data: String(block.data), mimeType: String(block.mimeType) }
        : { type: "text", text: String(block.text ?? "") }),
    };
  }

  const tempDir = await makePrivateDirectory(path.join(tmpdir(), "pi-computer-use-"));
  const fullOutputPath = path.join(tempDir, "output.txt");
  await writeFile(fullOutputPath, fullText, { encoding: "utf8", mode: 0o600 });
  const suffix = `\n\n[Official Computer Use text truncated: showing ${aggregate.outputLines} of ${aggregate.totalLines} lines (${formatSize(aggregate.outputBytes)} of ${formatSize(aggregate.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
  const result: PiContentResult = { content: [], fullOutputPath };
  let textIndex = 0;
  let textOffset = 0;
  let noticeAdded = false;
  for (const block of content) {
    if (block.type === "image") {
      result.content.push({ type: "image", data: String(block.data), mimeType: String(block.mimeType) });
      continue;
    }
    const blockText = String(block.text ?? "");
    const start = textOffset + (textIndex > 0 ? 2 : 0);
    const end = start + blockText.length;
    const retained = aggregate.content.length > start
      ? blockText.slice(0, Math.min(end, aggregate.content.length) - start)
      : "";
    const cutoffHere: boolean = !noticeAdded && aggregate.content.length < end;
    if (retained || cutoffHere) {
      result.content.push({ type: "text", text: `${retained}${cutoffHere ? suffix : ""}` });
      noticeAdded ||= cutoffHere;
    }
    textOffset = end;
    textIndex += 1;
  }
  return result;
}

interface PiElicitationContext {
  hasUI: boolean;
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
}

export async function handleOfficialElicitation(
  request: DirectBrokerElicitationRequest,
  ctx: PiElicitationContext,
  openUrl: (url: string) => Promise<boolean>,
): Promise<DirectBrokerElicitationResponse> {
  if (!ctx.hasUI) return { action: "cancel" };
  const message = request.message ?? "Official Computer Use requests input";

  if (request.mode === "url") {
    if (!request.url) return { action: "cancel" };
    const choice = await ctx.ui.select(`${message}\n${request.url}`, ["Open URL", "Decline", "Cancel"]);
    if (choice === "Decline") return { action: "decline" };
    if (choice !== "Open URL") return { action: "cancel" };
    if (!await openUrl(request.url)) {
      ctx.ui.notify("Could not open the official Computer Use URL.", "error");
      return { action: "cancel" };
    }
    return { action: "accept" };
  }

  if (request.mode !== undefined && request.mode !== "form" && request.mode !== "openai/form") {
    ctx.ui.notify(`Official Computer Use sent an unsupported elicitation mode: ${request.mode}`, "warning");
    return { action: "cancel" };
  }
  const openAiForm = request.mode === "openai/form";
  if (request.requestedSchema === undefined || (!openAiForm && !jsonObjectSchema.safeParse(request.requestedSchema).success)) {
    return { action: "cancel" };
  }
  const choice = await ctx.ui.select(message, ["Respond", "Decline", "Cancel"]);
  if (choice === "Decline") return { action: "decline" };
  if (choice !== "Respond") return { action: "cancel" };
  const title = `${message}\nSchema: ${JSON.stringify(request.requestedSchema)}`;
  let prefill = "{}";
  while (true) {
    const edited = await ctx.ui.editor(title, prefill);
    if (edited === undefined) return { action: "cancel" };
    prefill = edited;
    try {
      const parsed = JSON.parse(edited);
      const content = openAiForm ? parsed : jsonObjectSchema.parse(parsed);
      return { action: "accept", content };
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : "Response must be valid JSON", "error");
    }
  }
}

export default function directComputerUse(pi: ExtensionAPI) {
  const stateRoot = process.env.CODEX_COMPUTER_USE_HOME || path.join(getAgentDir(), "direct-computer-use");
  const windows = process.platform === "win32";
  const codeExecutor = windows
    ? new ComputerUseCodeExecutor(new WindowsSessionExecutor(), 5000, WINDOWS_COMPUTER_USE_METHODS)
    : new ComputerUseCodeExecutor();

  pi.registerCommand("computer-use-status", {
    description: "Show Computer Use status",
    handler: async (args, ctx) => {
      const result = windows ? await getWindowsStatus() : getDirectStatus(stateRoot);
      if (args.trim() === "--probe" && windows && result.runtimeVerified === true) Object.assign(result, await probeWindowsConnection(undefined, ctx.signal));
      ctx.ui.notify(JSON.stringify({ ...result, extensionSource: import.meta.url }, null, 2), result.connectionReady === false || result.runtimeVerified === false ? "error" : "info");
    },
  });

  pi.registerTool({
    name: "computer_use",
    label: "Computer Use",
    description: windows ? windowsCodeDescription : codeDescription,
    promptSnippet: `Run composable JavaScript against OpenAI's official signed ${windows ? "Windows" : "macOS"} Computer Use surface`,
    promptGuidelines: [
      `Use computer_use for ${windows ? "Windows" : "macOS"} app UI work, composing known sequential actions in one JavaScript call and emitting only the state needed for the next decision.`,
    ],
    // SAFETY: Pi accepts this standard JSON Schema object as a custom-tool parameter schema.
    parameters: codeParameters as any,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { code } = z.object({ code: z.string() }).parse(params);
      const result = await codeExecutor.execute(code, {
        stateRoot,
        signal,
        supportsOpenAiFormElicitation: true,
        onElicitation: (request) => handleOfficialElicitation(
          request,
          ctx,
          async (url) => windows
            ? (await pi.exec(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$ErrorActionPreference='Stop'; Start-Process -FilePath '${url.replaceAll("'", "''")}'`, "utf16le").toString("base64")], { signal, timeout: 15_000 })).code === 0
            : (await pi.exec("/usr/bin/open", ["--", url], { signal, timeout: 15_000 })).code === 0,
        ),
      });
      const rendered = await toPiContent(result.content);
      const details: JsonObject = { calls: result.calls, ok: !result.error };
      if (result.error) details.error = result.error;
      if (rendered.fullOutputPath) details.fullOutputPath = rendered.fullOutputPath;
      return { content: rendered.content, details };
    },
    renderCall(args, theme) {
      const parsed = z.object({ code: z.string() }).safeParse(args);
      const firstLine = parsed.success
        ? parsed.data.code.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 100)
        : undefined;
      const label = theme.fg("toolTitle", theme.bold("computer_use"));
      return new Text(firstLine ? `${label} ${theme.fg("dim", firstLine)}` : label, 0, 0);
    },
  });

  // Pi's result middleware sets the error flag without discarding earlier images or observations.
  pi.on("tool_result", (event) => {
    const details = jsonObjectSchema.safeParse(event.details);
    if (event.toolName === "computer_use" && details.success && details.data.ok === false) {
      return { isError: true };
    }
  });
  pi.on("session_start", () => pi.setActiveTools([...new Set([...pi.getActiveTools(), "computer_use"])]));
  pi.on("agent_settled", () => codeExecutor.close());
  pi.on("session_shutdown", () => codeExecutor.close());
}
