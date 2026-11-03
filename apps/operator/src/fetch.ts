// A fetch-style entry for the operator (Request -> Response), for runtimes without node:http servers such as
// Cloudflare Workers. It runs the same Operator.handle that startOperator serves: the adapter carries
// the request in as the few IncomingMessage fields the handler reads and streams its response back out, so a
// Worker node and a `pnpm sim` node answer alike. Behaviour is unchanged for node:http callers.
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Operator } from './server.js';

const encoder = new TextEncoder();
const bytesOf = (chunk: unknown): Uint8Array => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk)));

/** The ServerResponse surface Operator.handle uses, answering with a streamed web Response. */
class FetchResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  private readonly headers: Record<string, string> = {};
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  readonly socket = {
    // A dropped connection (the operator's dropResponses test mode): answer nothing useful.
    destroy: () => {
      if (!this.headersSent) this.resolve(new Response(null, { status: 502 }));
      this.closed();
    },
  };

  constructor(private readonly resolve: (r: Response) => void) {
    super();
  }

  setHeader(name: string, value: string | number): this {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  writeHead(status: number, headers: Record<string, string> = {}): this {
    if (this.headersSent) return this;
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    this.headersSent = true;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => void (this.controller = c),
      cancel: () => this.closed(),
    });
    this.resolve(new Response(status === 204 || status === 304 ? null : body, { status, headers: this.headers }));
    return this;
  }

  write(chunk: unknown): boolean {
    if (this.writableEnded) return false;
    if (!this.headersSent) this.writeHead(this.statusCode);
    this.controller?.enqueue(bytesOf(chunk));
    return true;
  }

  end(chunk?: unknown): this {
    if (this.writableEnded) return this;
    if (!this.headersSent) this.writeHead(this.statusCode);
    if (chunk !== undefined) this.controller?.enqueue(bytesOf(chunk));
    try {
      this.controller?.close();
    } catch {
      // already closed by the client
    }
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }

  private closed(): void {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit('close');
  }
}

/**
 * Wraps an operator as `(request, client) => Promise<Response>`. `client` is the caller's address as the
 * runtime knows it (a Worker passes cf-connecting-ip); it keys the per-client read and write throttles.
 */
export function fetchHandler(operator: Pick<Operator, 'handle'>): (request: Request, client?: string) => Promise<Response> {
  return (request, client = 'unknown') =>
    new Promise<Response>((resolve) => {
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => void (headers[k] = v));
      const req = {
        url: `${url.pathname}${url.search}`,
        method: request.method,
        headers,
        socket: { remoteAddress: client },
        async *[Symbol.asyncIterator]() {
          if (!request.body) return;
          for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) yield Buffer.from(chunk);
        },
      };
      operator.handle(req as unknown as IncomingMessage, new FetchResponse(resolve) as unknown as ServerResponse);
    });
}
