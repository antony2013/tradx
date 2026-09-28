import { HistoricalError } from '../historical/errors';

export type UpstoxGetConfig = {
  baseUrl: string;
  accessToken: string;
  requestTimeoutMs: number;
};

async function safeUpstreamMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };
    const first = body.errors?.[0]?.message;
    if (typeof first === 'string' && first.length > 0) {
      return first.slice(0, 200);
    }
  } catch {
    // fall through to status-only message
  }
  return `request rejected with ${response.status}`;
}

/** Shared Upstox v2 GET with auth/timeout/error mapping. No token in logs. */
export async function upstoxGet(
  config: UpstoxGetConfig,
  path: string,
  errorContext: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    throw new HistoricalError(
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      isTimeout ? `${errorContext} timed out` : `${errorContext} failed`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new HistoricalError(
      'AUTHENTICATION_ERROR',
      'Upstox authentication failed; a valid access token is required',
    );
  }
  if (response.status === 429) {
    throw new HistoricalError('RATE_LIMITED', 'Upstox rate limit exceeded');
  }
  if (response.status === 400 || response.status === 404) {
    throw new HistoricalError(
      'INVALID_REQUEST',
      `${errorContext} rejected: ${await safeUpstreamMessage(response)}`,
    );
  }
  if (!response.ok) {
    throw new HistoricalError(
      'UPSTREAM_ERROR',
      `${errorContext} responded with ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    status?: string;
    data?: unknown;
  };
  if (body.status !== 'success' || body.data === undefined) {
    throw new HistoricalError(
      'INVALID_RESPONSE',
      `Unexpected ${errorContext} response shape`,
    );
  }
  return body.data;
}
