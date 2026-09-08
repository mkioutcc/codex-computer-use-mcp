import { z } from "zod";

/** Official Windows window2 API shipped with @oai/sky. macOS keeps its own ten methods. */
export const WINDOWS_COMPUTER_USE_METHODS = [
	"list_apps", "list_windows", "get_window", "launch_app", "get_window_state",
	"activate_window", "click", "perform_secondary_action", "set_value",
	"scroll", "drag", "press_key", "type_text",
] as const;

export type WindowsMethod = typeof WINDOWS_COMPUTER_USE_METHODS[number];

const app = z.string();
const window = z.object({ app, id: z.number().int(), title: z.string().optional() }).catchall(z.json());
const element_index = z.number().int();
const screenshotId = z.string().optional();

export const WINDOWS_TOOL_SCHEMAS = {
	list_apps: z.object({}).catchall(z.json()),
	list_windows: z.object({}).catchall(z.json()),
	get_window: z.object({ id: z.number().int(), app: app.optional() }).catchall(z.json()),
	launch_app: z.object({ app }).catchall(z.json()),
	activate_window: z.object({ window }).catchall(z.json()),
	get_window_state: z.object({ window, include_screenshot: z.boolean().optional(), include_text: z.boolean().optional() }).catchall(z.json()),
	click: z.object({ window, element_index: element_index.optional(), x: z.number().optional(), y: z.number().optional(), screenshotId, click_count: z.number().int().optional(), mouse_button: z.enum(["left", "right", "middle", "l", "r", "m"]).optional() }).catchall(z.json()),
	perform_secondary_action: z.object({ window, element_index, action: z.string() }).catchall(z.json()),
	set_value: z.object({ window, element_index, value: z.string() }).catchall(z.json()),
	scroll: z.object({ window, x: z.number(), y: z.number(), scrollX: z.number(), scrollY: z.number(), screenshotId }).catchall(z.json()),
	drag: z.object({ window, from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number(), screenshotId }).catchall(z.json()),
	press_key: z.object({ window, key: z.string() }).catchall(z.json()),
	type_text: z.object({ window, text: z.string() }).catchall(z.json()),
} satisfies Record<WindowsMethod, z.ZodType>;

const descriptions = {
	list_apps: "List official Windows app identifiers and their open windows.",
	list_windows: "List open Windows windows that can be targeted.",
	get_window: "Rehydrate an open window by its official identifier.",
	launch_app: "Launch a Windows app by its unchanged official identifier or executable path.",
	activate_window: "Bring an official Window to the foreground.",
	get_window_state: "Capture official window state. Screenshots default to true, accessibility text to false. Accessibility may be null.",
	click: "Click an observed element index or window-relative screenshot coordinates.",
	perform_secondary_action: "Invoke a secondary accessibility action exposed by the latest window state.",
	set_value: "Replace the value of an observed editable element.",
	scroll: "Scroll at a window-relative point using scrollX and scrollY deltas.",
	drag: "Drag between two window-relative points.",
	press_key: "Press an X keysym-style key or chord in the selected window.",
	type_text: "Type literal text into the selected window's current focus.",
} satisfies Record<WindowsMethod, string>;

export const WINDOWS_TOOL_DEFINITIONS = WINDOWS_COMPUTER_USE_METHODS.map((name) => {
	const { $schema: _schema, ...inputSchema } = z.toJSONSchema(WINDOWS_TOOL_SCHEMAS[name]);
	const readOnlyHint = ["list_apps", "list_windows", "get_window", "get_window_state"].includes(name);
	return { name, description: descriptions[name], inputSchema, annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false } };
});

const methodNames = new Set<string>(WINDOWS_COMPUTER_USE_METHODS);
export function isWindowsMethod(value: string): value is WindowsMethod { return methodNames.has(value); }
