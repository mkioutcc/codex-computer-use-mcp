import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import adapter from "../integrations/pi/index.ts";
import { uniqueElementIndex, onlyWindow, waitForObservation } from "./helpers/windows-observation.ts";

const windowSchema = z.object({ app: z.string(), id: z.number(), title: z.string().optional() }).catchall(z.json());
const observationSchema = z.object({ title: z.string(), tree: z.string(), focus: z.string(), documentText: z.string(), screenshots: z.array(z.object({ id: z.string(), width: z.number().positive(), height: z.number().positive(), originX: z.number(), originY: z.number(), zIndex: z.number() })) });

// Explicit opt-in: registered Pi tool + real official runtime, not a desktop fixture.
test("live Windows Pi: discovery, screenshot, new editor tab and exact text readback", { skip: process.env.COMPUTER_USE_LIVE_UI !== "1" || process.platform !== "win32", timeout: 180_000 }, async () => {
	let tool: any;
	const handlers = new Map<string, any>();
	// SAFETY: only ExtensionAPI registration is captured; executor, worker and official UI are real.
	adapter({ registerTool(value: any) { tool = value; }, registerCommand() {}, on(name: string, handler: any) { handlers.set(name, handler); } } as any);
	let counter = 0;
	const call = async (code: string) => {
		const result = await tool.execute(`live-${++counter}`, { code }, undefined, undefined, { hasUI: false });
		const patch = handlers.get("tool_result")?.({ toolName: "computer_use", ...result, isError: false });
		assert.notEqual(patch?.isError, true, result.details.error);
		assert.equal(result.details.ok, true);
		return result;
	};
	const textValue = (result: any) => JSON.parse(result.content.find((b: any) => b.type === "text").text);
	const observe = async () => {
		const result = await call('const s=await sky.get_window_state({window:store.window,include_text:true,include_screenshot:true}); store.window=s.window; emit({title:s.window.title ?? "",tree:s.accessibility?.tree ?? "",focus:s.accessibility?.focused_element ?? "",documentText:s.accessibility?.document_text ?? "",screenshots:s.screenshots.map(({url,...metadata})=>metadata)}); for(const shot of s.screenshots) emitImage(shot.url);');
		return { result, state: observationSchema.parse(textValue(result)) };
	};
	const clickIndex = (index: number) => call(`await sky.click({window:store.window,element_index:${index}});`);
	try {
		const inventory = await call('emit((await sky.list_apps()).filter(a=>a.displayName==="Notepad++").flatMap(a=>a.windows));');
		const target = onlyWindow(z.array(windowSchema).parse(textValue(inventory)));
		await call(`store.window=${JSON.stringify(target)};`);
		await observe();
		await call('await sky.activate_window({window:store.window});');
		const before = await waitForObservation(observe, o => o.state.tree.startsWith(`Window: "${o.state.title}"`), { stableKey: o => String(uniqueElementIndex(o.state.tree, /功能表項目 檔案\(F\)|MenuItem File/i)) });
		assert.ok(before.result.content.some((b: any) => b.type === "image" && b.data.length > 0));
		if (!before.state.tree.split("\n").some(l => l.endsWith("ID: 41001"))) {
			await clickIndex(uniqueElementIndex(before.state.tree, /功能表項目 檔案\(F\)|MenuItem File/i));
		}
		const menu = await waitForObservation(observe, o => o.state.tree.split("\n").some(l => l.endsWith("ID: 41001")), { stableKey: o => String(uniqueElementIndex(o.state.tree, /ID: 41001$/)) });
		await clickIndex(uniqueElementIndex(menu.state.tree, /ID: 41001$/));
		const fresh = await waitForObservation(observe, o =>
			o.state.title !== before.state.title && /^(新文件|new |無標題|Untitled)/i.test(o.state.title) &&
			o.state.tree.startsWith(`Window: "${o.state.title}"`) &&
			/長度：0\b|length\s*:\s*0\b/i.test(o.state.tree) && /^\d+ (窗格|pane)\s*$/i.test(o.state.focus));
		assert.equal(fresh.state.documentText, "");
		const marker = `Pi CU live acceptance ${randomUUID()}`;
		await call(`await sky.type_text({window:store.window,text:${JSON.stringify(marker)}});`);
		// Do not accept a title/header containing the marker as document readback.
		const after = await waitForObservation(observe, o => o.state.documentText === marker ||
			(/^\d+ (窗格|pane) /i.test(o.state.focus) && o.state.focus.endsWith(marker)));
		assert.ok(after.result.content.some((b: any) => b.type === "image" && b.data.length > 0));
		if (process.env.COMPUTER_USE_LIVE_DIALOG === "1") {
			await call('store.editor=store.window; await sky.press_key({window:store.window,key:"Control_L+f"});');
			const windowsResult = await call('emit(await sky.list_windows());');
			const windows = z.array(windowSchema).parse(textValue(windowsResult));
			const dialogs = windows.filter(w => w.app === target.app && w.id !== target.id && /^(搜尋|尋找|Find)$/i.test(w.title ?? ""));
			// The official API may expose owned transient UI in the owner's state, not as a separate Window.
			const dialog = onlyWindow(dialogs.length ? dialogs : windows.filter(w => w.app === target.app && w.id === target.id));
			await call(`store.window=${JSON.stringify(dialog)};`);
			const closePattern = /(?:按鈕|Button) (?:關閉|Close) ID: 2$/i;
			const dialogState = await waitForObservation(observe, o => /(?:對話|Dialog) (?:尋找|Find)/i.test(o.state.tree) && o.state.tree.split("\n").some(l => closePattern.test(l)), { stableKey: o => String(uniqueElementIndex(o.state.tree, closePattern)) });
			const images = dialogState.result.content.filter((b: any) => b.type === "image");
			assert.equal(images.length, dialogState.state.screenshots.length);
			assert.ok(images.every((b: any) => b.data.length > 0));
			assert.equal(new Set(dialogState.state.screenshots.map(s => s.id)).size, images.length);
			if (dialog.id === target.id) assert.ok(images.length >= 2, "Owned dialog must include its additional screenshot");
			// Use the dialog's standard dismissal key; never replay a click that only activated transient UI.
			await call('await sky.press_key({window:store.window,key:"Escape"});');
			await call('store.window=await sky.get_window({id:store.editor.id,app:store.editor.app});');
			await waitForObservation(observe, o => !/(?:對話|Dialog) (?:尋找|Find)/i.test(o.state.tree) && (o.state.documentText === marker || (/^\d+ (窗格|pane) /i.test(o.state.focus) && o.state.focus.endsWith(marker))));
		}
		// Leave the newly-created unsaved test tab for inspection. Never save or close existing documents.
	} finally { await handlers.get("session_shutdown")(); }
});
