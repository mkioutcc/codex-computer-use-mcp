import assert from "node:assert/strict";
import test from "node:test";
import { ComputerUseCodeExecutor } from "../src/code-executor.ts";
import { WINDOWS_COMPUTER_USE_METHODS } from "../src/windows-tools.ts";

test("Windows screenshots cross the code worker only as opaque handles with official metadata", async () => {
	const executor = new ComputerUseCodeExecutor({
		async execute() {
			return { isError: false, content: [{ type: "image", data: "image-payload", mimeType: "image/png" }], structuredContent: { window: { app: "notepad", id: 123 }, accessibility: null, screenshots: [{ id: "official-shot", width: 400, height: 300, zIndex: 0 }] } };
		},
		async close() {},
	}, 5000, WINDOWS_COMPUTER_USE_METHODS);
	try {
		const result = await executor.execute(`const s=await sky.get_window_state({window:{app:"notepad",id:123}}); emit(s.screenshots[0].id); emitImage(s.screenshots[0].url);`, {});
		assert.equal(result.error, undefined);
		assert.deepEqual(result.content, [{ type: "text", text: "official-shot" }, { type: "image", data: "image-payload", mimeType: "image/png" }]);
	} finally { await executor.close(); }
});

test("multiple screenshot regions preserve order, negative origins and logical coordinates", async () => {
	const window = { app: "official-app", id: 42, title: "modal" };
	const screenshots = [
		{ id: "main", width: 1515, height: 859, originX: -1920, originY: 0, zIndex: 0 },
		{ id: "popup", width: 500, height: 400, originX: -1600, originY: 100, zIndex: 1 },
	];
	const images = [{ type: "image", data: "main-pixels", mimeType: "image/png" }, { type: "image", data: "popup-pixels", mimeType: "image/jpeg" }];
	const executor = new ComputerUseCodeExecutor({
		async execute(method, args) {
			if (method === "get_window_state") return { isError: false, content: images, structuredContent: { window, accessibility: null, screenshots } };
			assert.equal(method, "click");
			assert.deepEqual(args, { window, screenshotId: "popup", x: 20, y: 30 });
			return { isError: false, content: [] };
		},
		async close() {},
	}, 5000, WINDOWS_COMPUTER_USE_METHODS);
	try {
		const result = await executor.execute(`const s=await sky.get_window_state({window:${JSON.stringify(window)}}); emit(s.screenshots.map(({url,...metadata})=>metadata)); for(const shot of s.screenshots) emitImage(shot.url); await sky.click({window:s.window,screenshotId:s.screenshots[1].id,x:20,y:30});`, {});
		assert.equal(result.error, undefined);
		assert.deepEqual(JSON.parse(String(result.content[0].text)), screenshots);
		assert.deepEqual(result.content.slice(1), images);
	} finally { await executor.close(); }
});

test("Windows cancellation preserves earlier emits and history and closes the official session", async () => {
	const controller = new AbortController();
	let closed = false;
	const executor = new ComputerUseCodeExecutor({
		async execute() { setTimeout(() => controller.abort(), 80); return { isError: false, content: [], structuredContent: [] }; },
		async close() { closed = true; },
	}, 5000, WINDOWS_COMPUTER_USE_METHODS);
	const result = await executor.execute(`await sky.list_apps();emit("observed");while(true){}`, { signal: controller.signal });
	assert.match(result.error ?? "", /cancelled/);
	assert.equal(result.content[0].text, "observed");
	assert.deepEqual(result.calls, ["list_apps"]);
	assert.equal(closed, true);
});

test("Windows worker exposes official target without exposing extra callable methods", async () => {
	const executor = new ComputerUseCodeExecutor({ async execute() { throw new Error("no call expected"); }, async close() {} }, 5000, WINDOWS_COMPUTER_USE_METHODS);
	try {
		const result = await executor.execute('emit(sky.target); emit(Object.keys(sky).filter(k=>typeof sky[k]==="function"));', {});
		assert.equal(result.error, undefined);
		assert.equal(result.content[0].text, "windows");
		assert.deepEqual(JSON.parse(String(result.content[1].text)), [...WINDOWS_COMPUTER_USE_METHODS]);
	} finally { await executor.close(); }
});
// The external official session boundary supplies JSON and image observations.
test("Windows code keeps official window selectors and structured app inventory", async () => {
	const window = { app: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App", id: 123, title: "Untitled" };
	const executor = new ComputerUseCodeExecutor({
		async execute(method, args) {
			if (method === "list_apps") return { isError: false, content: [], structuredContent: [{ id: window.app, windows: [window] }] };
			assert.deepEqual(args, { window });
			return { isError: false, content: [], structuredContent: { window, accessibility: { tree: "Empty editor" }, screenshots: [] } };
		},
		async close() {},
	}, 5000, WINDOWS_COMPUTER_USE_METHODS);
	try {
		const result = await executor.execute(`store.window=(await sky.list_apps())[0].windows[0]; emit((await sky.get_window_state({window:store.window})).accessibility.tree);`, {});
		assert.equal(result.error, undefined);
		assert.deepEqual(result.content, [{ type: "text", text: "Empty editor" }]);
		assert.deepEqual(result.calls, ["list_apps", "get_window_state"]);
		assert.deepEqual(executor.store.window, window);
	} finally { await executor.close(); }
});
