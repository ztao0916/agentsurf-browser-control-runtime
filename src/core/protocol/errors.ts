export type ToolErrorCode =
  | 'invalid_request'
  | 'invalid_url'
  | 'tab_not_found'
  | 'tab_in_use'
  | 'session_not_found'
  | 'permission_denied'
  | 'unsupported_page'
  | 'element_not_found'
  | 'stale_element'
  | 'element_not_visible'
  | 'element_disabled'
  | 'element_not_clickable'
  | 'element_not_editable'
  | 'navigation_timeout'
  | 'screenshot_unavailable'
  | 'authentication_failed'
  | 'bridge_unavailable'
  | 'request_timeout'
  | 'transport_disconnected'
  | 'debugger_unavailable'
  | 'cdp_error'
  | 'download_failed'
  | 'file_upload_failed'
  | 'internal_error';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class ToolFailure extends Error {
  public readonly toolError: ToolError;

  public constructor(error: ToolError) {
    super(error.message);
    this.name = 'ToolFailure';
    this.toolError = error;
  }
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): ToolError {
  return details === undefined ? { code, message, retryable } : { code, message, retryable, details };
}

export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolFailure) {
    return error.toolError;
  }

  if (error instanceof Error) {
    return createToolError('internal_error', error.message, false);
  }

  return createToolError('internal_error', 'An unknown browser runtime error occurred.', false);
}
