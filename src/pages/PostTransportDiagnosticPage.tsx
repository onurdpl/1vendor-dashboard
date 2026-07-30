import { useRef, useState } from 'react';
import { runtimeConfig } from '../config/runtime';

const POST_TRANSPORT_PATH = '/auth/diagnostics/public-login-transport';
const SAME_ORIGIN_API_PATH = `/api${POST_TRANSPORT_PATH}`;
const REQUEST_TIMEOUT_MS = 5_000;
const RESPONSE_BODY_LIMIT = 4_096;

type DiagnosticPathMode = 'same_origin_api' | 'direct_backend';

type DiagnosticRequest = {
  pathMode: DiagnosticPathMode;
  label: string;
  targetUrl: string;
  credentials: RequestCredentials;
};

type DiagnosticResult = {
  flowId: string;
  targetUrl: string;
  method: 'POST';
  contentType: 'application/json';
  credentials: RequestCredentials;
  startedAt: string;
  fetchResolved: boolean;
  fetchRejected: boolean;
  httpStatus: number | null;
  responseBody: string | null;
  errorName: string | null;
  errorMessage: string | null;
  elapsedMs: number | null;
  timeoutFired: boolean;
};

function createDiagnosticId(prefix: 'auth' | 'req') {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12).padEnd(10, '0');

  return `${prefix}-${suffix}`;
}

function createInitialResult(flowId: string, request: DiagnosticRequest): DiagnosticResult {
  return {
    flowId,
    targetUrl: request.targetUrl,
    method: 'POST',
    contentType: 'application/json',
    credentials: request.credentials,
    startedAt: new Date().toISOString(),
    fetchResolved: false,
    fetchRejected: false,
    httpStatus: null,
    responseBody: null,
    errorName: null,
    errorMessage: null,
    elapsedMs: null,
    timeoutFired: false,
  };
}

function formatResponseBody(value: string) {
  return value.length <= RESPONSE_BODY_LIMIT
    ? value
    : `${value.slice(0, RESPONSE_BODY_LIMIT)}…`;
}

function getErrorDetail(error: unknown, key: 'name' | 'message', fallback: string) {
  if (error && typeof error === 'object' && key in error) {
    const value = Reflect.get(error, key);
    if (typeof value === 'string' && value) {
      return value;
    }
  }

  return fallback;
}

function logDiagnosticEvent(
  event: string,
  details: {
    flowId: string;
    pathMode: DiagnosticPathMode;
    targetUrl: string;
    durationMs?: number;
    httpStatus?: number | null;
    outcome?: string;
  },
) {
  console.info({
    event,
    stage: 'isolated_login_post_transport',
    method: 'POST',
    ...details,
  });
}

export function PostTransportDiagnosticPage() {
  const [activePathMode, setActivePathMode] = useState<DiagnosticPathMode | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const requestActiveRef = useRef(false);

  const sameOriginRequest: DiagnosticRequest = {
    pathMode: 'same_origin_api',
    label: 'Same-origin JSON POST',
    targetUrl: new URL(SAME_ORIGIN_API_PATH, window.location.origin).toString(),
    credentials: 'include',
  };
  const directBackendRequest = runtimeConfig.diagnosticBackendOrigin
    ? {
        pathMode: 'direct_backend' as const,
        label: 'Direct-backend JSON POST',
        targetUrl: `${runtimeConfig.diagnosticBackendOrigin}${POST_TRANSPORT_PATH}`,
        credentials: 'omit' as const,
      }
    : null;

  async function runDiagnostic(request: DiagnosticRequest) {
    if (requestActiveRef.current) {
      return;
    }

    requestActiveRef.current = true;
    const flowId = createDiagnosticId('auth');
    const requestId = createDiagnosticId('req');
    const controller = new window.AbortController();
    const startedAtMs = Date.now();
    let timeoutFired = false;

    setActivePathMode(request.pathMode);
    setResult(createInitialResult(flowId, request));
    logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_BUTTON_CLICKED', {
      flowId,
      pathMode: request.pathMode,
      targetUrl: request.targetUrl,
      outcome: 'started',
    });

    const timeoutId = window.setTimeout(() => {
      timeoutFired = true;
      logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_TIMEOUT_TRIGGERED', {
        flowId,
        pathMode: request.pathMode,
        targetUrl: request.targetUrl,
        durationMs: Date.now() - startedAtMs,
        outcome: 'timeout',
      });
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_FETCH_CALL_ENTERED', {
        flowId,
        pathMode: request.pathMode,
        targetUrl: request.targetUrl,
        outcome: 'started',
      });
      const fetchPromise = window.fetch(request.targetUrl, {
        method: 'POST',
        credentials: request.credentials,
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Flow-Id': flowId,
          'X-Auth-Request-Id': requestId,
        },
        body: JSON.stringify({ probe: 'login-post-transport' }),
        signal: controller.signal,
      });
      logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_FETCH_PROMISE_CREATED', {
        flowId,
        pathMode: request.pathMode,
        targetUrl: request.targetUrl,
        outcome: 'pending',
      });

      const response = await fetchPromise;
      const responseBody = formatResponseBody(await response.text());
      const elapsedMs = Date.now() - startedAtMs;
      setResult((current) => current?.flowId === flowId
        ? {
            ...current,
            fetchResolved: true,
            httpStatus: response.status,
            responseBody,
            elapsedMs,
            timeoutFired,
          }
        : current);
      logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_FETCH_RESOLVED', {
        flowId,
        pathMode: request.pathMode,
        targetUrl: request.targetUrl,
        durationMs: elapsedMs,
        httpStatus: response.status,
        outcome: response.ok ? 'success' : 'http_error',
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAtMs;
      const errorName = getErrorDetail(error, 'name', 'UnknownError');
      const errorMessage = getErrorDetail(error, 'message', String(error));
      setResult((current) => current?.flowId === flowId
        ? {
            ...current,
            fetchRejected: true,
            errorName,
            errorMessage,
            elapsedMs,
            timeoutFired,
          }
        : current);
      logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_FETCH_REJECTED', {
        flowId,
        pathMode: request.pathMode,
        targetUrl: request.targetUrl,
        durationMs: elapsedMs,
        httpStatus: null,
        outcome: timeoutFired ? 'timeout' : 'network_error',
      });
    } finally {
      window.clearTimeout(timeoutId);
      requestActiveRef.current = false;
      setActivePathMode(null);
      logDiagnosticEvent('ISOLATED_POST_DIAGNOSTIC_CLEANUP_COMPLETED', {
        flowId,
        pathMode: request.pathMode,
        targetUrl: request.targetUrl,
        durationMs: Date.now() - startedAtMs,
        outcome: 'complete',
      });
    }
  }

  return (
    <main className="post-transport-diagnostic-page">
      <section className="post-transport-diagnostic-panel" aria-labelledby="post-transport-diagnostic-title">
        <p className="eyebrow">Temporary transport diagnostic</p>
        <h1 id="post-transport-diagnostic-title">Isolated login POST transport</h1>
        <p className="page-description">
          Each button sends one credential-free JSON POST. No login state, auth hook, readiness request, or navigation runs.
        </p>

        <div className="post-transport-diagnostic-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={activePathMode !== null}
            onClick={() => void runDiagnostic(sameOriginRequest)}
          >
            {sameOriginRequest.label}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={activePathMode !== null || !directBackendRequest}
            onClick={() => directBackendRequest && void runDiagnostic(directBackendRequest)}
          >
            Direct-backend JSON POST
          </button>
        </div>

        {!directBackendRequest ? (
          <p className="post-transport-diagnostic-notice" role="status">
            Direct backend diagnostic origin is not configured in this build.
          </p>
        ) : null}

        <dl className="post-transport-diagnostic-contract">
          <div>
            <dt>Same-origin target</dt>
            <dd>{sameOriginRequest.targetUrl}</dd>
          </div>
          <div>
            <dt>Direct-backend target</dt>
            <dd>{directBackendRequest?.targetUrl ?? 'Not configured'}</dd>
          </div>
          <div>
            <dt>Timeout</dt>
            <dd>{REQUEST_TIMEOUT_MS} ms per request</dd>
          </div>
        </dl>

        <section className="post-transport-diagnostic-result" aria-live="polite">
          <h2>Latest result</h2>
          {result ? (
            <dl>
              <div><dt>Diagnostic flow ID</dt><dd>{result.flowId}</dd></div>
              <div><dt>Exact target URL</dt><dd>{result.targetUrl}</dd></div>
              <div><dt>HTTP method</dt><dd>{result.method}</dd></div>
              <div><dt>Request Content-Type</dt><dd>{result.contentType}</dd></div>
              <div><dt>Credentials mode</dt><dd>{result.credentials}</dd></div>
              <div><dt>Start timestamp</dt><dd>{result.startedAt}</dd></div>
              <div><dt>Fetch resolved</dt><dd>{result.fetchResolved ? 'Yes' : 'No'}</dd></div>
              <div><dt>Fetch rejected</dt><dd>{result.fetchRejected ? 'Yes' : 'No'}</dd></div>
              <div><dt>HTTP status</dt><dd>{result.httpStatus ?? 'Not available'}</dd></div>
              <div><dt>Response body</dt><dd>{result.responseBody ?? 'Not available'}</dd></div>
              <div><dt>Error name</dt><dd>{result.errorName ?? 'Not available'}</dd></div>
              <div><dt>Error message</dt><dd>{result.errorMessage ?? 'Not available'}</dd></div>
              <div><dt>Elapsed</dt><dd>{result.elapsedMs === null ? 'Pending' : `${result.elapsedMs} ms`}</dd></div>
              <div><dt>Local timeout fired</dt><dd>{result.timeoutFired ? 'Yes' : 'No'}</dd></div>
            </dl>
          ) : (
            <p>No diagnostic request has run.</p>
          )}
        </section>
      </section>
    </main>
  );
}
