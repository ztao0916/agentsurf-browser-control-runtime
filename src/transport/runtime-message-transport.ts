import type { ToolRequest, ToolResponse } from '../core/protocol/tool-contract';

export type RuntimeMessageHandler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => unknown;

export function sendToolRequest(request: ToolRequest): Promise<ToolResponse> {
  return chrome.runtime.sendMessage(request);
}

export function sendRuntimeMessage(message: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

export function sendPageAgentRequest(tabId: number, request: unknown, frameId = 0): Promise<unknown> {
  // Always target one frame explicitly: content scripts run in every frame, so a broadcast would
  // race several Page Agents for the same response.
  return chrome.tabs.sendMessage(tabId, request, { frameId });
}

export function registerRuntimeMessageHandler(handler: RuntimeMessageHandler): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    Promise.resolve(handler(message, sender))
      .then((response) => sendResponse(response))
      .catch((error: unknown) => sendResponse(error));
    return true;
  });
}
