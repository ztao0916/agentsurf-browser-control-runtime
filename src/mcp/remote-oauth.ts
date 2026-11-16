import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import type { RemoteConfig } from './remote-config';

const ACCESS_TOKEN_PREFIX = 'as_at_';
const REFRESH_TOKEN_PREFIX = 'as_rt_';
const AUTH_CODE_PREFIX = 'as_code_';
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const AUTH_CODE_TTL_MS = 5 * 60_000;
const CSRF_TTL_MS = 10 * 60_000;
const MAX_AUTH_CODES = 128;
const MAX_CSRF_TOKENS = 256;
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_SCOPE = 'mcp:tools';

interface OAuthTokenPayload {
  typ: 'at' | 'rt';
  cid: string;
  sub: string;
  scp: string;
  iat: number;
  exp: number;
  jti: string;
}

interface AuthCodeRecord {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge?: string;
  expiresAt: number;
}

interface CsrfRecord {
  expiresAt: number;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeHashEqual(candidate: string, expectedHexHash: string): boolean {
  if (candidate.length > 4096) return false;
  try {
    const candidateBuf = Buffer.from(sha256Hex(candidate), 'hex');
    const expectedBuf = Buffer.from(expectedHexHash, 'hex');
    if (candidateBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(candidateBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  return constantTimeHashEqual(a, sha256Hex(b));
}

function deriveSigningKey(config: RemoteConfig): Buffer | null {
  if (!config.oauth) return null;
  return createHash('sha256')
    .update(`${config.token_hash}:${config.oauth.client_secret_hash}:agentsurf-oauth-v1`)
    .digest();
}

function signOAuthToken(
  typ: 'at' | 'rt',
  scope: string,
  ttlSeconds: number,
  config: RemoteConfig,
): string {
  const key = deriveSigningKey(config);
  if (!key || !config.oauth) {
    throw new Error('OAuth is not configured.');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: OAuthTokenPayload = {
    typ,
    cid: config.oauth.client_id,
    sub: config.principal,
    scp: scope,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomBytes(12).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = createHmac('sha256', key).update(payloadB64).digest('base64url');
  const prefix = typ === 'at' ? ACCESS_TOKEN_PREFIX : REFRESH_TOKEN_PREFIX;
  return `${prefix}${payloadB64}.${sigB64}`;
}

function verifySignedOAuthToken(
  token: string,
  expectedType: 'at' | 'rt',
  config: RemoteConfig,
): OAuthTokenPayload | null {
  if (!config.oauth || token.length > 4096) return null;
  const prefix = expectedType === 'at' ? ACCESS_TOKEN_PREFIX : REFRESH_TOKEN_PREFIX;
  if (!token.startsWith(prefix)) return null;
  const rest = token.slice(prefix.length);
  const dotIdx = rest.indexOf('.');
  if (dotIdx <= 0 || dotIdx === rest.length - 1 || rest.indexOf('.', dotIdx + 1) !== -1) {
    return null;
  }
  const payloadB64 = rest.slice(0, dotIdx);
  const sigB64 = rest.slice(dotIdx + 1);
  const key = deriveSigningKey(config);
  if (!key) return null;

  try {
    const expectedSig = createHmac('sha256', key).update(payloadB64).digest();
    const actualSig = Buffer.from(sigB64, 'base64url');
    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Partial<OAuthTokenPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      p.typ !== expectedType
      || typeof p.cid !== 'string'
      || !constantTimeStringEqual(p.cid, config.oauth.client_id)
      || p.sub !== config.principal
      || typeof p.scp !== 'string'
      || typeof p.exp !== 'number'
      || p.exp <= now
    ) {
      return null;
    }
    return p as OAuthTokenPayload;
  } catch {
    return null;
  }
}

export function verifyOAuthAccessToken(token: string, config: RemoteConfig): boolean {
  return verifySignedOAuthToken(token, 'at', config) !== null;
}

export function resolvePublicIssuer(req: http.IncomingMessage, config: RemoteConfig): string {
  const hostHeader = req.headers.host?.trim();
  if (hostHeader) {
    const isLoopback = hostHeader.startsWith('127.0.0.1') || hostHeader.startsWith('localhost') || hostHeader.startsWith('[::1]');
    if (isLoopback && config.public_url) {
      return config.public_url.replace(/\/+$/u, '');
    }
    const forwardedProto = req.headers['x-forwarded-proto'];
    const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    const forwarded = rawProto?.split(',')[0]?.trim().toLowerCase();
    const proto = forwarded === 'http' || forwarded === 'https'
      ? forwarded
      : isLoopback
        ? 'http'
        : 'https';
    return `${proto}://${hostHeader}`;
  }
  if (config.public_url) {
    return config.public_url.replace(/\/+$/u, '');
  }
  return `http://127.0.0.1:${config.port}`;
}

export class OAuthService {
  private readonly authCodes = new Map<string, AuthCodeRecord>();
  private readonly csrfTokens = new Map<string, CsrfRecord>();

  public constructor(private readonly getConfig: () => Promise<RemoteConfig>) {}

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;

    if (
      pathname === '/.well-known/oauth-protected-resource'
      || pathname.startsWith('/.well-known/oauth-protected-resource/')
    ) {
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET');
        return true;
      }
      const config = await this.getConfig();
      if (!config.oauth) {
        sendJson(res, 404, { error: 'OAuth is not configured on this server.' });
        return true;
      }
      const issuer = resolvePublicIssuer(req, config);
      sendJson(res, 200, {
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: [DEFAULT_SCOPE],
      });
      return true;
    }

    if (
      pathname === '/.well-known/oauth-authorization-server'
      || pathname.startsWith('/.well-known/oauth-authorization-server/')
      || pathname === '/.well-known/openid-configuration'
      || pathname.startsWith('/.well-known/openid-configuration/')
    ) {
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET');
        return true;
      }
      const config = await this.getConfig();
      if (!config.oauth) {
        sendJson(res, 404, { error: 'OAuth is not configured on this server.' });
        return true;
      }
      const issuer = resolvePublicIssuer(req, config);
      sendJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [DEFAULT_SCOPE],
      });
      return true;
    }

    if (pathname === '/oauth/authorize') {
      if (req.method === 'GET') {
        await this.handleAuthorizeGet(res, url);
        return true;
      }
      if (req.method === 'POST') {
        await this.handleAuthorizePost(req, res);
        return true;
      }
      sendMethodNotAllowed(res, 'GET, POST');
      return true;
    }

    if (pathname === '/oauth/token') {
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST');
        return true;
      }
      await this.handleTokenPost(req, res);
      return true;
    }

    return false;
  }

  private async handleAuthorizeGet(res: http.ServerResponse, url: URL): Promise<void> {
    const config = await this.getConfig();
    const params = {
      responseType: url.searchParams.get('response_type') ?? '',
      clientId: url.searchParams.get('client_id') ?? '',
      redirectUri: url.searchParams.get('redirect_uri') ?? '',
      state: url.searchParams.get('state') ?? '',
      scope: url.searchParams.get('scope') ?? DEFAULT_SCOPE,
      codeChallenge: url.searchParams.get('code_challenge') ?? '',
      codeChallengeMethod: url.searchParams.get('code_challenge_method') ?? '',
    };

    const validationError = this.validateAuthorizeParams(config, params);
    if (validationError !== null) {
      sendHtml(res, 400, renderErrorPage('Invalid Authorization Request', validationError));
      return;
    }

    const csrfToken = this.issueCsrfToken();
    sendHtml(res, 200, renderAuthorizePage({
      ...params,
      csrfToken,
      accessMode: config.access_mode,
    }));
  }

  private async handleAuthorizePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let rawBody: string;
    try {
      rawBody = await readRequestBody(req, MAX_BODY_BYTES);
    } catch {
      sendHtml(res, 413, renderErrorPage('Payload Too Large', 'Request body exceeded maximum allowed size.'));
      return;
    }

    const form = new URLSearchParams(rawBody);
    const config = await this.getConfig();
    const params = {
      responseType: form.get('response_type') ?? '',
      clientId: form.get('client_id') ?? '',
      redirectUri: form.get('redirect_uri') ?? '',
      state: form.get('state') ?? '',
      scope: form.get('scope') || DEFAULT_SCOPE,
      codeChallenge: form.get('code_challenge') ?? '',
      codeChallengeMethod: form.get('code_challenge_method') ?? '',
    };

    const validationError = this.validateAuthorizeParams(config, params);
    if (validationError !== null) {
      sendHtml(res, 400, renderErrorPage('Invalid Authorization Request', validationError));
      return;
    }

    const csrfToken = form.get('csrf_token') ?? '';
    if (!this.consumeCsrfToken(csrfToken)) {
      const nextCsrf = this.issueCsrfToken();
      sendHtml(res, 400, renderAuthorizePage({
        ...params,
        csrfToken: nextCsrf,
        accessMode: config.access_mode,
        errorMessage: 'Session expired. Please submit the form again.',
      }));
      return;
    }

    const decision = form.get('decision') ?? 'allow';
    if (decision === 'deny') {
      const target = new URL(params.redirectUri);
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('error_description', 'User denied the authorization request.');
      if (params.state) target.searchParams.set('state', params.state);
      sendRedirect(res, target.toString());
      return;
    }

    const pairingToken = (form.get('pairing_token') ?? '').trim();
    if (!pairingToken || !constantTimeHashEqual(pairingToken, config.token_hash)) {
      const nextCsrf = this.issueCsrfToken();
      sendHtml(res, 401, renderAuthorizePage({
        ...params,
        csrfToken: nextCsrf,
        accessMode: config.access_mode,
        errorMessage: 'Invalid Pairing Token. Please check your Bearer Token and try again.',
      }));
      return;
    }

    const code = this.issueAuthCode({
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scope: params.scope,
      ...(params.codeChallenge ? { codeChallenge: params.codeChallenge } : {}),
    });

    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code);
    if (params.state) target.searchParams.set('state', params.state);
    sendRedirect(res, target.toString());
  }

  private async handleTokenPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const config = await this.getConfig();
    if (!config.oauth) {
      sendOAuthJsonError(res, 400, 'invalid_request', 'OAuth is not configured on this server.');
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readRequestBody(req, MAX_BODY_BYTES);
    } catch {
      sendOAuthJsonError(res, 413, 'invalid_request', 'Request body too large.');
      return;
    }

    const params = parseTokenBody(req.headers['content-type'], rawBody);
    if (!params) {
      sendOAuthJsonError(res, 400, 'invalid_request', 'Malformed token request body.');
      return;
    }

    const creds = extractClientCredentials(req.headers['authorization'], params);
    if (!creds) {
      sendOAuthJsonError(res, 401, 'invalid_client', 'Client authentication is required.', true);
      return;
    }
    if (
      !constantTimeStringEqual(creds.clientId, config.oauth.client_id)
      || !constantTimeHashEqual(creds.clientSecret, config.oauth.client_secret_hash)
    ) {
      sendOAuthJsonError(res, 401, 'invalid_client', 'Invalid client_id or client_secret.', creds.usedBasicAuth);
      return;
    }

    const grantType = params.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = params.get('code') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';

      const record = this.consumeAuthCode(code);
      if (!record) {
        sendOAuthJsonError(res, 400, 'invalid_grant', 'Authorization code is invalid or expired.');
        return;
      }
      if (!constantTimeStringEqual(record.clientId, creds.clientId) || record.redirectUri !== redirectUri) {
        sendOAuthJsonError(res, 400, 'invalid_grant', 'Authorization code does not match client or redirect_uri.');
        return;
      }
      if (record.codeChallenge) {
        if (!isValidPkceVerifier(codeVerifier)) {
          sendOAuthJsonError(res, 400, 'invalid_grant', 'Valid PKCE code_verifier is required.');
          return;
        }
        const computedChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
        if (!constantTimeStringEqual(computedChallenge, record.codeChallenge)) {
          sendOAuthJsonError(res, 400, 'invalid_grant', 'PKCE code_verifier verification failed.');
          return;
        }
      }

      const accessToken = signOAuthToken('at', record.scope, ACCESS_TOKEN_TTL_SECONDS, config);
      const refreshToken = signOAuthToken('rt', record.scope, REFRESH_TOKEN_TTL_SECONDS, config);
      sendJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: record.scope,
      }, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
      return;
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.get('refresh_token') ?? '';
      const payload = verifySignedOAuthToken(refreshToken, 'rt', config);
      if (!payload) {
        sendOAuthJsonError(res, 400, 'invalid_grant', 'Refresh token is invalid or expired.');
        return;
      }
      const accessToken = signOAuthToken('at', payload.scp, ACCESS_TOKEN_TTL_SECONDS, config);
      const nextRefreshToken = signOAuthToken('rt', payload.scp, REFRESH_TOKEN_TTL_SECONDS, config);
      sendJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: nextRefreshToken,
        scope: payload.scp,
      }, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
      return;
    }

    sendOAuthJsonError(res, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token grants are supported.');
  }

  private validateAuthorizeParams(
    config: RemoteConfig,
    params: {
      responseType: string;
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      codeChallengeMethod: string;
    },
  ): string | null {
    if (!config.oauth) {
      return 'OAuth is not configured on this gateway. Run <code>agentsurf-mcp init-oauth</code> on the server first.';
    }
    if (params.responseType !== 'code') {
      return 'Unsupported response_type. Only <code>response_type=code</code> is supported.';
    }
    if (!params.clientId || !constantTimeStringEqual(params.clientId, config.oauth.client_id)) {
      return 'Invalid or mismatched <code>client_id</code>. Please verify your OAuth Client ID.';
    }
    if (!params.redirectUri) {
      return 'Missing <code>redirect_uri</code> parameter.';
    }
    try {
      new URL(params.redirectUri);
    } catch {
      return '<code>redirect_uri</code> is not a valid URL.';
    }
    if (!config.oauth.redirect_uris.includes(params.redirectUri)) {
      return `Redirect URI is not allowlisted: <code>${escapeHtml(params.redirectUri)}</code><br><br>`
        + `Run this command on your gateway server, then refresh this page:<br>`
        + `<code>node /root/standalone-gateway.js add-oauth-redirect --uri "${escapeHtml(params.redirectUri)}"</code>`;
    }
    if (params.codeChallenge && params.codeChallengeMethod !== 'S256') {
      return 'Unsupported PKCE <code>code_challenge_method</code>. Only <code>S256</code> is supported.';
    }
    return null;
  }

  private issueCsrfToken(): string {
    const now = Date.now();
    for (const [key, entry] of this.csrfTokens.entries()) {
      if (entry.expiresAt <= now) this.csrfTokens.delete(key);
    }
    while (this.csrfTokens.size >= MAX_CSRF_TOKENS) {
      const oldest = this.csrfTokens.keys().next().value;
      if (!oldest) break;
      this.csrfTokens.delete(oldest);
    }
    const token = randomBytes(24).toString('base64url');
    this.csrfTokens.set(token, { expiresAt: now + CSRF_TTL_MS });
    return token;
  }

  private consumeCsrfToken(token: string): boolean {
    if (!token) return false;
    const entry = this.csrfTokens.get(token);
    this.csrfTokens.delete(token);
    return entry !== undefined && entry.expiresAt > Date.now();
  }

  private issueAuthCode(record: Omit<AuthCodeRecord, 'expiresAt'>): string {
    const now = Date.now();
    for (const [key, entry] of this.authCodes.entries()) {
      if (entry.expiresAt <= now) this.authCodes.delete(key);
    }
    while (this.authCodes.size >= MAX_AUTH_CODES) {
      const oldest = this.authCodes.keys().next().value;
      if (!oldest) break;
      this.authCodes.delete(oldest);
    }
    const code = `${AUTH_CODE_PREFIX}${randomBytes(24).toString('base64url')}`;
    this.authCodes.set(code, { ...record, expiresAt: now + AUTH_CODE_TTL_MS });
    return code;
  }

  private consumeAuthCode(code: string): AuthCodeRecord | null {
    if (!code) return null;
    const entry = this.authCodes.get(code);
    this.authCodes.delete(code);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry;
  }
}

function parseTokenBody(contentType: string | undefined, rawBody: string): URLSearchParams | null {
  const normalizedType = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalizedType === 'application/json') {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') params.set(key, value);
      }
      return params;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(rawBody);
}

function extractClientCredentials(
  authHeader: string | undefined,
  params: URLSearchParams,
): { clientId: string; clientSecret: string; usedBasicAuth: boolean } | null {
  let basicId: string | undefined;
  let basicSecret: string | undefined;

  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return null;
    basicId = safeDecodeComponent(decoded.slice(0, sep));
    basicSecret = safeDecodeComponent(decoded.slice(sep + 1));
  }

  const bodyId = params.get('client_id') ?? undefined;
  const bodySecret = params.get('client_secret') ?? undefined;

  if (basicId !== undefined && bodyId !== undefined && basicId !== bodyId) return null;
  if (basicSecret !== undefined && bodySecret !== undefined && basicSecret !== bodySecret) return null;

  const clientId = basicId ?? bodyId;
  const clientSecret = basicSecret ?? bodySecret;
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    usedBasicAuth: basicId !== undefined,
  };
}

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  } catch {
    return value;
  }
}

function isValidPkceVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/u.test(verifier);
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sendOAuthJsonError(
  res: http.ServerResponse,
  status: number,
  error: string,
  description: string,
  withBasicChallenge = false,
): void {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  };
  if (withBasicChallenge) {
    headers['WWW-Authenticate'] = 'Basic realm="agentsurf-oauth"';
  }
  sendJson(res, status, { error, error_description: description }, headers);
}

function sendMethodNotAllowed(res: http.ServerResponse, allow: string): void {
  res.writeHead(405, {
    Allow: allow,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
}

function sendRedirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  });
  res.end(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderErrorPage(title: string, detailHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentSurf OAuth</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px 16px; display: flex; justify-content: center; }
    .card { max-width: 520px; width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 8px 24px rgba(15,23,42,.06); }
    h1 { font-size: 18px; margin: 0 0 12px; color: #b91c1c; }
    p { font-size: 14px; line-height: 1.6; margin: 0; word-break: break-all; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${detailHtml}</p>
  </div>
</body>
</html>`;
}

function renderAuthorizePage(input: {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  csrfToken: string;
  accessMode: 'read-only' | 'interactive';
  errorMessage?: string;
}): string {
  const modeLabel = input.accessMode === 'interactive' ? 'interactive (read + write)' : 'read-only';
  const errorBanner = input.errorMessage
    ? `<div class="error">${escapeHtml(input.errorMessage)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize AgentSurf Connection</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px 16px; display: flex; justify-content: center; }
    .card { max-width: 460px; width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 10px 28px rgba(15,23,42,.08); }
    h1 { font-size: 18px; margin: 0 0 8px; }
    .sub { font-size: 13px; color: #475569; margin: 0 0 16px; line-height: 1.5; }
    .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 16px; font-size: 12px; line-height: 1.6; }
    .meta div { word-break: break-all; margin-bottom: 4px; }
    .meta div:last-child { margin-bottom: 0; }
    .label { color: #64748b; font-weight: 600; }
    .error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    input[type="password"] { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; margin-bottom: 16px; }
    .actions { display: flex; gap: 10px; }
    button { flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid #cbd5e1; font-size: 14px; font-weight: 600; cursor: pointer; background: #fff; color: #334155; }
    button.primary { background: #0f172a; border-color: #0f172a; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize MCP Client Access</h1>
    <p class="sub">Enter your gateway <strong>Pairing Token (Bearer Token)</strong> to approve this connection.</p>
    ${errorBanner}
    <div class="meta">
      <div><span class="label">Client ID: </span>${escapeHtml(input.clientId)}</div>
      <div><span class="label">Redirect URI: </span>${escapeHtml(input.redirectUri)}</div>
      <div><span class="label">Scope: </span>${escapeHtml(input.scope)}</div>
      <div><span class="label">Access Mode: </span>${escapeHtml(modeLabel)}</div>
    </div>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="response_type" value="${escapeHtml(input.responseType)}" />
      <input type="hidden" name="client_id" value="${escapeHtml(input.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(input.state)}" />
      <input type="hidden" name="scope" value="${escapeHtml(input.scope)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(input.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(input.codeChallengeMethod)}" />
      <input type="hidden" name="csrf_token" value="${escapeHtml(input.csrfToken)}" />
      <label for="pairing_token">AgentSurf Pairing Token (Bearer Token)</label>
      <input id="pairing_token" name="pairing_token" type="password" autocomplete="current-password" placeholder="Paste your gateway Bearer Token" autofocus />
      <div class="actions">
        <button type="submit" name="decision" value="deny">Deny</button>
        <button type="submit" name="decision" value="allow" class="primary">Authorize</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}
