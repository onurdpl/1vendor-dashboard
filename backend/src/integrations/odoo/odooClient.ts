export type OdooClientConfig = {
  url: string;
  db: string;
  username: string;
  apiKey: string;
};

export type OdooJsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

export type OdooJsonRpcResponse<T> = {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: OdooJsonRpcError;
};

export type OdooFieldDefinition = {
  type?: string;
  required?: boolean;
  readonly?: boolean;
  string?: string;
};

export type OdooFieldsGetResponse = Record<string, OdooFieldDefinition>;

export type OdooSearchReadRecord = {
  id?: number;
  name?: string;
  display_name?: string;
};

export class OdooClientError extends Error {
  constructor(
    message: string,
    readonly details?: { status?: number; model?: string; method?: string; odooMessage?: string },
  ) {
    super(message);
    this.name = 'OdooClientError';
  }
}

type JsonRpcPayload = {
  jsonrpc: '2.0';
  method: 'call';
  params: Record<string, unknown>;
  id: number;
};

export class OdooClient {
  private readonly endpoint: string;
  private requestId = 1;

  constructor(
    private readonly config: OdooClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = `${config.url.replace(/\/+$/, '')}/jsonrpc`;
  }

  async authenticate(): Promise<number> {
    const uid = await this.callRpc<number | false>({
      service: 'common',
      method: 'authenticate',
      args: [this.config.db, this.config.username, this.config.apiKey, {}],
    });

    if (typeof uid !== 'number' || uid <= 0) {
      throw new OdooClientError('Odoo authentication failed.');
    }

    return uid;
  }

  async version(): Promise<unknown> {
    return this.callRpc<unknown>({
      service: 'common',
      method: 'version',
      args: [],
    });
  }

  async modelCall<T>(uid: number, model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
    return this.callRpc<T>(
      {
        service: 'object',
        method: 'execute_kw',
        args: [this.config.db, uid, this.config.apiKey, model, method, args, kwargs],
      },
      { model, method },
    );
  }

  async fieldsGet(uid: number, model: string, fields?: string[]): Promise<OdooFieldsGetResponse> {
    const kwargs: Record<string, unknown> = {
      attributes: ['type', 'required', 'readonly', 'string'],
    };
    if (fields?.length) {
      kwargs.fields = fields;
    }

    return this.modelCall<OdooFieldsGetResponse>(uid, model, 'fields_get', [], kwargs);
  }

  async searchRead(
    uid: number,
    model: string,
    domain: unknown[] = [],
    fields: string[] = ['id', 'display_name', 'name'],
    limit = 3,
  ): Promise<OdooSearchReadRecord[]> {
    return this.modelCall<OdooSearchReadRecord[]>(uid, model, 'search_read', [domain], {
      fields,
      limit,
    });
  }

  private async callRpc<T>(params: Record<string, unknown>, context: { model?: string; method?: string } = {}): Promise<T> {
    const payload: JsonRpcPayload = {
      jsonrpc: '2.0',
      method: 'call',
      params,
      id: this.requestId++,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new OdooClientError('Odoo request failed before receiving a response.', {
        model: context.model,
        method: context.method,
        odooMessage: sanitizeOdooErrorMessage(error instanceof Error ? error.message : undefined),
      });
    }

    const body = await parseJsonRpcResponse<T>(response);
    if (!response.ok) {
      throw new OdooClientError('Odoo HTTP response was not successful.', {
        status: response.status,
        model: context.model,
        method: context.method,
      });
    }

    if (body.error) {
      throw new OdooClientError('Odoo JSON-RPC returned an error.', {
        status: response.status,
        model: context.model,
        method: context.method,
        odooMessage: sanitizeOdooErrorMessage(body.error.message),
      });
    }

    if (body.result === undefined) {
      throw new OdooClientError('Odoo JSON-RPC response did not include a result.', {
        status: response.status,
        model: context.model,
        method: context.method,
      });
    }

    return body.result;
  }
}

function sanitizeOdooErrorMessage(message: string | undefined) {
  if (!message) {
    return undefined;
  }

  return message
    .replace(/api[_-]?key[^\s,;)]*/gi, 'api_key=[redacted]')
    .replace(/password[^\s,;)]*/gi, 'password=[redacted]')
    .replace(/token[^\s,;)]*/gi, 'token=[redacted]');
}

async function parseJsonRpcResponse<T>(response: Response): Promise<OdooJsonRpcResponse<T>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as OdooJsonRpcResponse<T>;
  } catch {
    throw new OdooClientError('Odoo response was not valid JSON.', { status: response.status });
  }
}
