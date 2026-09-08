# Repository guidance

This package is a thin transport adapter to OpenAI's official signed macOS and Windows Computer Use tools. The calling agent selects each official method and its arguments. Codex and the operating system remain authoritative for tool behaviour, app access and platform permissions.

## Scope

- Preserve all ten official macOS methods and no-permissions behaviour. Windows exposes its official window2 methods without rewriting app or window selectors. MCP exposes typed tools; Pi exposes the platform's methods through one composable `computer_use({ code })` tool.
- Do not add wrapper permission prompts, app or intent allowlists, action gates, risk classifiers, content inspection, alternate modes or model-driven planning.
- Do not reintroduce app rewriting, same-app locking or focus telemetry.
- Add adapter logic only for transport compatibility, zero-model-turn execution, retained official sessions, process lifecycle, packaging or a concrete user-visible bug.
- Keep macOS signature and Team ID verification, isolated temporary state, model-turn rejection and process cleanup. Windows uses the app-deployed, Authenticode-verified runtime and the app-generated native-pipe configuration; verify Sky files against the app-bundled component and retain the official app's permissions. Own adapter child processes with a kill-on-close Windows Job Object, not by terminating the user's app.
- Run model-authored Pi code outside Pi's main thread with real cancellation, and preserve emitted observations plus completed-call history when a batch stops partway through.
- Preserve compatible additional tool arguments and pass app selectors through unchanged.

## Review

Review the exact production path and report material, reachable regressions. Do not block focused work on speculative hardening or malformed input that the official producer cannot emit.

A request to review does not authorize posting to GitHub. Show the user the exact proposed review, comment or issue text and get approval before posting it.

## Verification

```bash
npm ci
npm run check
npm run check:pi
npm test
npm run build
```

Use benign applications for live acceptance.
