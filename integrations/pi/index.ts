import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import WebSocket, { type RawData } from "ws";

interface BridgeConfig {
	port: number;
	token: string;
}

const REQUEST_TIMEOUT_MS = 40_000;

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "agentsurf",
		label: "AgentSurf",
		description: "Control the user's Chrome browser through AgentSurf. Call browser.list_tabs first, then use the returned tab_id with page and action tools.",
		promptSnippet: "Observe and control Chrome through AgentSurf browser tools",
		promptGuidelines: [
			"Use agentsurf for browser interaction. Call browser.list_tabs first, then browser.get_page_state or browser.get_interactives before acting.",
			"AgentSurf element actions must use element_id values returned by browser.get_interactives; never invent selectors or element IDs.",
		],
		parameters: Type.Object({
			tool: Type.String({ description: "AgentSurf tool name, for example browser.list_tabs or browser.click" }),
			args: Type.Record(Type.String(), Type.Unknown(), { description: "Arguments for the selected browser tool" }),
		}),
		async execute(_toolCallId, params, signal) {
			try {
				const response = await callAgentSurf(params.tool, params.args, signal);
				return {
					content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
					details: response,
				};
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text" as const, text: `AgentSurf error: ${message}` }],
					details: { ok: false, error: message },
				};
			}
		},
	});
}

async function callAgentSurf(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
	const config = await readConfig();
	const requestId = `pi_${crypto.randomUUID()}`;
	const socket = new WebSocket(`ws://127.0.0.1:${config.port}`);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => finish(new Error("AgentSurf request timed out.")), REQUEST_TIMEOUT_MS);
		const abort = () => finish(new Error("AgentSurf request was cancelled."));
		let finished = false;

		const finish = (error?: Error, result?: unknown) => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			socket.close();
			if (error !== undefined) reject(error);
			else resolve(result);
		};

		signal?.addEventListener("abort", abort, { once: true });
		socket.on("open", () => socket.send(JSON.stringify({ type: "auth", role: "agent", token: config.token })));
		socket.on("message", (data) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(rawDataToString(data)) as Record<string, unknown>;
			} catch {
				finish(new Error("AgentSurf returned an invalid response."));
				return;
			}
			if (message.type === "auth_result") {
				if (message.ok !== true) finish(new Error("AgentSurf authentication failed."));
				else socket.send(JSON.stringify({ protocol_version: "1", request_id: requestId, tool, args }));
				return;
			}
			if (message.request_id === requestId) finish(undefined, message);
		});
		socket.on("error", (error) => finish(new Error(`Cannot connect to AgentSurf: ${error.message}`)));
		socket.on("close", () => {
			if (!finished) finish(new Error("AgentSurf connection closed before a response was received."));
		});
	});
}

function rawDataToString(data: RawData): string {
	if (Buffer.isBuffer(data)) return data.toString("utf8");
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
	return Buffer.concat(data).toString("utf8");
}

async function readConfig(): Promise<BridgeConfig> {
	const base = process.platform === "darwin"
		? join(homedir(), "Library", "Application Support")
		: process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
	const path = join(base, "BrowserControlRuntime", "config.json");
	const value = JSON.parse(await readFile(path, "utf8")) as Partial<BridgeConfig>;
	if (!Number.isInteger(value.port) || typeof value.token !== "string") {
		throw new Error(`Invalid AgentSurf configuration: ${path}`);
	}
	return value as BridgeConfig;
}
