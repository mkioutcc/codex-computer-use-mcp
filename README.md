# Codex Computer Use MCP

Expose OpenAI's official signed macOS and Windows Computer Use tools directly to Pi and MCP clients. The calling agent chooses each method and its arguments. This package runs no nested model and generates no action plan.

OpenAI does not produce or endorse this independent project. It relies on an experimental app-server API and installed ChatGPT components that may change.

## Requirements

### macOS

- macOS with an unlocked user session
- Node.js 22 or newer
- the official ChatGPT macOS app at `/Applications/ChatGPT.app`
- the Computer Use component installed by ChatGPT under `~/.codex/computer-use/`
- Pi 0.80.7 or newer when using the Pi integration

macOS Screen Recording, Accessibility and TCC controls still apply.

### Windows

- Windows with an unlocked, interactive desktop; Node.js 22+ and Pi 0.80.7+ for the Pi integration.
- The official Codex Windows app (`OpenAI.Codex`), kept running with a working conversation. Its displayed name may be ChatGPT in newer builds.
- The app must have deployed its runtime under `%LOCALAPPDATA%\OpenAI\Codex\` and generated its `unified-computer-use` configuration under the OS user's `.codex/plugins/cache/openai-bundled/` directory.

Windows support is in this source checkout; do not assume the upstream npm release includes it. To use this fork locally:

```powershell
npm ci
npm run build
pi install C:\path\to\codex-computer-use-mcp
```

Then `/reload` Pi and run `/computer-use-status`. `runtimeVerified` checks installed files and configuration, not whether the app's live pipe is currently reachable. If startup fails, open a new working conversation in the official app and retry. The adapter never copies binaries out of WindowsApps, changes the app's ACL, or substitutes a desktop automation engine.

Windows calls use the app's official app-server → Node REPL → `@oai/sky` → app-provided native pipe. Actions operate in the foreground and can interrupt your use of that desktop. Official app permissions, confirmations and physical Escape interruption still apply. App updates may require reopening the app and reloading Pi.

## Pi

Install from npm:

```bash
pi install npm:codex-computer-use-mcp
```

The extension registers and activates one composable tool:

```text
computer_use({ code: string })
```

The code runs with `sky`, `emit`, `emitImage` and a persistent `store` object. `sky` exposes all ten official Computer Use methods, so known sequential actions can run without a model round-trip between each action:

```js
const state = await sky.get_app_state({ app: "TextEdit" });
emit(state.text);

await sky.click({ app: "TextEdit", element_index: "7" });
await sky.type_text({ app: "TextEdit", text: "hello" });
const next = await sky.get_app_state({ app: "TextEdit" });
emit(next.text);
```

The example above is for macOS. Windows exposes its official window2 API instead:

```js
const apps = await sky.list_apps(); // Structured app objects, not text.
emit(apps);
// Choose a returned Window, then retain it explicitly:
// store.window = apps[...].windows[...];
const state = await sky.get_window_state({
  window: store.window,
  include_screenshot: true,
  include_text: true,
});
store.window = state.window; // Keep the refreshed official selector unchanged.
emit(state.accessibility); // May be null; inspect the screenshot instead.
for (const screenshot of state.screenshots) emitImage(screenshot.url);
```

Run discovery and observation before choosing the next action. Windows methods are `list_apps`, `list_windows`, `get_window`, `launch_app`, `get_window_state`, `activate_window`, `click`, `perform_secondary_action`, `set_value`, `scroll`, `drag`, `press_key`, and `type_text`. Input actions take an unchanged official `{ app, id, title? }` Window; `element_index` is a number. Screenshot IDs and metadata are preserved, while `screenshot.url` is an opaque handle accepted by `emitImage`. Do not print image handles as screenshots or reuse stale element indexes after a state change. `store` holds JSON values between code calls; the official session closes when the agent settles or the Pi session shuts down.

Only values passed to `emit(...)` or `emitImage(...)` are returned to Pi. On macOS, `list_apps` returns the official text inventory produced by the app-server transport; unlike native `@oai/sky`, that transport does not provide the structured app array. `get_app_state` may return an accessibility-tree diff after the first inspection; pass `disableDiff: true` to request a fresh full tree. Screenshot payloads remain in the parent process and cross the code-worker boundary only as small opaque handles. Code runs in a worker so an unbounded loop can be terminated without freezing Pi; time spent inside an official Computer Use call does not count toward the code execution slice. If a later action fails, Pi still receives earlier emitted observations and the attempted method sequence.

Use `/computer-use-status` to inspect the installed component and transport status.

To run a source checkout:

```bash
npm ci
npm run build
pi -ne -e /absolute/path/to/codex-computer-use-mcp/integrations/pi/index.ts
```

## MCP

Running the package binary starts a stdio MCP server with the platform's official methods (ten on macOS, thirteen on Windows) and `computer_use_status`:

```bash
npx codex-computer-use-mcp
```

Example Pi MCP configuration:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": ["codex-computer-use-mcp"],
      "lifecycle": "lazy",
      "requestTimeoutMs": 180000,
      "directTools": false
    }
  }
}
```

## Behaviour

The adapter has one mode. Pi exposes the platform's official methods through the single `computer_use` code tool; MCP exposes the same methods as typed tools. Both are available without wrapper permission prompts. It adds no app allowlist, action gate, intent classifier, selector rewrite or focus policy. App-server uses Codex Full access. The adapter forwards any elicitation that the official host still emits.

macOS production calls require verified OpenAI-signed app-server and Computer Use binaries with Team ID `2DC432GLL2`. Windows verifies OpenAI Authenticode signatures and compares the deployed Sky package against the app-bundled component before loading it. The official app must keep hosting its native pipe; only adapter-owned child processes are terminated during cleanup. The adapter uses an isolated, credential-free app-server context. It rejects any model-turn activity. macOS calls after `get_app_state`, and Windows calls from the first request, reuse the signed session, preserving official state. Windows serializes concurrent callers and closes its process tree through a kill-on-close Job Object, including when the Pi process exits. Cancelling a Windows code batch retains prior emitted observations and the attempted method sequence; an interrupted action must be re-observed before retrying.

Audit records contain bounded metadata. They exclude arguments, app content, screenshots, prompts and credentials. MCP and CLI state defaults to `~/.direct-computer-use`. Pi state defaults to `direct-computer-use` under the Pi agent directory. Set `CODEX_COMPUTER_USE_HOME` to override either default.

Pi limits returned text to 50KB or 2,000 lines. When text exceeds that limit, the complete text is written to a mode-0600 file in a private directory under the OS temporary directory. On Windows, newly created adapter state and text-spill directories use a user-only inheritable DACL instead of relying on POSIX mode bits. Images are returned directly and are never spilled to disk.

## Windows diagnostics and live acceptance

- `/computer-use-status` verifies runtime files/configuration only. `connectionReady: null` means no live probe was attempted.
- `/computer-use-status --probe`, CLI `node dist/mcp-server.js --probe`, or MCP `computer_use_status({probe:true})` also open the production transport and call `list_windows`, then close the diagnostic session. The result includes only reachability, count and timing, never window titles. CLI probe exits nonzero on failure. Probe status comes from that connection's own verification, not a separate preflight: one verification per new connection, with no cached trust. `probeMs` includes verification and the first call; `verificationMs` is a subset, not an additional cost. Cleanup completes before the probe returns.
- Status includes package version, loaded runtime source/implementation fingerprint, broker/plugin versions and verification phase timings. `powerShellTimingsMs` separates discovery/signature work inside the combined process; those values are subsets of `timingsMs.discoveryAndAuthenticode`, not additional time. Live probes also report `sessionTimingsMs`: verification, private directory, launcher/initialize, thread start, REPL setup, first call and cleanup. The fingerprint identifies loaded resolver code, not the whole package or an integrity certificate. If a rebuild/reload still shows old behavior, fully exit Pi and start again.
- Pi's native `tool_result` middleware marks stopped batches as errors while retaining earlier observations/images. Wrappers that invoke `execute` directly without Pi result middleware must inspect `details.ok` and `details.error`.
- PowerShell runtime errors are rendered as bounded UTF-8 messages rather than Base64 command dumps.

Windows `sky.target` is `"windows"`. `store` accepts JSON, not persistent Node objects. On the tested official build, text-only accessibility followed by element clicks can report missing coordinate geometry. Request a fresh screenshot-backed state before clicking; refresh again after an error rather than blindly replaying input. After an action the accessibility snapshot can lag the updated window title: reobserve before typing, verify the editable focus, and check actual document text rather than title alone. Duplicate accessibility lines with the same `element_index` represent one target, not two; different matching indexes remain ambiguous. When relevant indexes change between observations, reobserve until they settle instead of retaining an older index. An owned dialog may appear inside the owner's accessibility tree and additional screenshots rather than in `list_windows`; never invent another Window ID. Inspect all screenshots. If foreground capture shows the wrong app, explicitly activate the returned target, then observe again. A locked/black desktop or activation failure requires restoring the interactive desktop, not another input engine. These are caller instructions, not selector rewriting or action gates.

The runtime compares all deployed Sky files on every new connection with eight bounded readers. Authenticode is still checked each time; there is no cached trust. Benchmark just the comparison, with alternating serial/bounded order:

```powershell
node tools/windows-benchmark.mjs "<app resources>/cua_node/bin/node_modules/@oai/sky"
npm run check:windows:contract -- "<app resources>/plugins/openai-bundled/plugins/computer-use/docs/api.md"
```

App discovery and the five Authenticode checks share one PowerShell process. Every new connection still checks all signatures, canonical/deployment paths and every Sky file before executing the verified broker. To measure ordinary startup versus warm calls, or isolate one versus two verification processes (alternating order, read-only):

```powershell
npm run build
node tools/windows-startup-benchmark.mjs
node tools/windows-verification-benchmark.mjs
```

These use fresh adapter sessions, not a cold OS disk cache. See [startup/stability measurements](docs/research/windows-startup-and-observation-validation.md).

For an alternating comparison of the previous double-verification flow and the current probe (fresh connections, no desktop input), run `node tools/windows-probe-benchmark.mjs` after building. This measures the diagnostic probe, not a speedup of every ordinary UI call.

Contract checking compares official method names, argument field names and required/optional fields. It does not prove all UI behavior or every future type semantic.

True UI acceptance is **opt-in**, separate from `npm test`. Keep the official app running and exactly one Notepad++ window open, on an unlocked desktop. Do not use the keyboard/mouse while it runs:

```powershell
npm run test:windows:live
# Also open/observe/dismiss the Find dialog and verify owned-window screenshot mapping:
node tools/windows-live.mjs --ui --dialog
```

The test captures the registered Pi tool (no model call), uses the real official runtime, creates a **new unsaved tab**, confirms blank editable focus, types a unique marker, checks its full accessibility readback and actual image blocks, then closes adapter processes. Existing documents are not saved or edited; the new test tab is left unsaved for inspection. The optional dialog case dismisses Find with Escape; it does not retry an ineffective close-button click. Observation helpers are test-only: bounded snapshot waits, same-index deduplication, and two stable relevant indexes before selecting a control. An official refusal/user-input interruption fails the test rather than replaying inputs. The capture harness is not proof that a separately running Pi process has reloaded new code. Other apps, languages, multi-monitor/DPI, drag and physical Escape remain separate acceptance cases.

## Development

```bash
npm ci
npm run check
npm run check:pi
npm test
npm run build
```

The test suite runs shared and Windows tests on Windows; macOS process-group and signed-live tests remain macOS-only. Native Windows acceptance requires the official app and is performed separately from deterministic protocol-fixture tests.

## License

MIT for this adapter. Official Codex components are proprietary and are not redistributed by this package.
