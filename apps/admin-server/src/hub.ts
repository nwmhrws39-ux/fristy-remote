import { DurableObject } from 'cloudflare:workers';

/*
 * LiveHub: one Durable Object that holds a WebSocket per running app.
 * It never sends any data – only the word "refresh" – and the app then does
 * its normal check-in. Uses WebSocket hibernation, so idle connections cost
 * nothing, and answers the apps' "ping" keep-alives without waking up.
 */
export class LiveHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/connect') {
      const installId = url.searchParams.get('installId') ?? '';
      const pair = new WebSocketPair();
      // tagged with the install id so single installs can be pinged
      this.ctx.acceptWebSocket(pair[1], [installId]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/broadcast' && req.method === 'POST') {
      const { target } = (await req.json()) as { target?: string };
      const sockets = target ? this.ctx.getWebSockets(target) : this.ctx.getWebSockets();
      let sent = 0;
      for (const ws of sockets) {
        try {
          ws.send('refresh');
          sent++;
        } catch {
          /* closed */
        }
      }
      return Response.json({ sent });
    }
    if (url.pathname === '/count') return Response.json({ connected: this.ctx.getWebSockets().length });
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(): Promise<void> {
    /* apps only send keep-alives, answered by the auto-response */
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }
}
