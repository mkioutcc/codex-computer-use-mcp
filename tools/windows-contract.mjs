import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { z } from "zod";
import { WINDOWS_COMPUTER_USE_METHODS, WINDOWS_TOOL_SCHEMAS } from "../dist/windows-tools.js";
// Read the installed official docs, never import arbitrary official internal members into the tool surface.
const file = process.argv[2];
if (!file) throw new Error("Usage: node tools/windows-contract.mjs <official computer-use/docs/api.md>");
const text = await readFile(file, "utf8");
const body = text.split("interface Window2ComputerUseClient {")[1]?.split("}")[0];
assert.ok(body, "Official window2 interface not found; review updated documentation");
const methods = [...body.matchAll(/^  ([a-z_]+)\(/gm)].map(m=>m[1]);
assert.deepEqual([...methods].sort(), [...WINDOWS_COMPUTER_USE_METHODS].sort(), "Official methods changed");
for(const name of methods) assert.ok(WINDOWS_TOOL_SCHEMAS[name], `Missing schema: ${name}`);
for(const match of body.matchAll(/([a-z_]+)\(input: (\w+)\)/g)) {
 const [,name,input] = match;
 const definition = text.split(`type ${input} = {`)[1]?.split("};")[0];
 assert.ok(definition, `Missing official type ${input}`);
 const fields = [...definition.matchAll(/^  (\w+)(\?)?:/gm)];
 const schema = z.toJSONSchema(WINDOWS_TOOL_SCHEMAS[name]);
 assert.deepEqual(fields.map(f=>f[1]).sort(), Object.keys(schema.properties).sort(), `${name} fields changed`);
 for(const [,field,optional] of fields) assert.equal(!(schema.required ?? []).includes(field), Boolean(optional), `${name}.${field} optionality changed`);
}
console.log(JSON.stringify({ compatibleMethods: methods.length, missing: [], extra: [] }));
