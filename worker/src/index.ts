/**
 * TNL - Tunnel File Sharing Worker
 * 
 * Cloudflare Worker that relays WebSocket messages between
 * sharers (User A) and accessors (User B)
 */

interface Env {
  SHARES: DurableObjectNamespace;
  PUBLIC_URL?: string;  // e.g., "https://tnl.example.workers.dev"
}

// Generate random share code
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, env, url);
    }
    
    // HTTP endpoints
    if (url.pathname === '/') {
      return new Response('TNL - Tunnel File Sharing\n\nUsage: tnl share <path>', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

async function handleWebSocket(request: Request, env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const isSharer = url.pathname === '/ws/share' || !code;
  
  // Get public URL from env or derive from request
  const publicUrl = env.PUBLIC_URL || `https://${url.hostname}`;
  
  if (isSharer) {
    // Sharer: generate a new code and create DO with that code as ID
    const shareCode = generateCode();
    const id = env.SHARES.idFromName(shareCode);
    const stub = env.SHARES.get(id);
    
    // Pass the share code and public URL to the DO
    const newUrl = new URL(request.url);
    newUrl.searchParams.set('newShareCode', shareCode);
    newUrl.searchParams.set('publicUrl', publicUrl);
    return stub.fetch(new Request(newUrl, request));
  } else {
    // Accessor: lookup DO by share code
    const id = env.SHARES.idFromName(code);
    const stub = env.SHARES.get(id);
    return stub.fetch(request);
  }
}

// Durable Object for managing a single share
export class ShareDO {
  state: DurableObjectState;
  sharerWs: WebSocket | null = null;
  accessorWs: Map<string, WebSocket> = new Map();
  shareCode: string | null = null;
  publicUrl: string = '';
  mode: string = 'ro';
  pendingRequests: Map<string, WebSocket> = new Map();
  
  constructor(state: DurableObjectState) {
    this.state = state;
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const newShareCode = url.searchParams.get('newShareCode');
    const publicUrl = url.searchParams.get('publicUrl') || `https://${url.hostname}`;
    
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    if (newShareCode) {
      // This is a sharer registering
      this.shareCode = newShareCode;
      this.publicUrl = publicUrl;
      this.handleSharer(server);
    } else if (code) {
      // This is an accessor connecting
      this.handleAccessor(server);
    } else {
      return new Response('Invalid request', { status: 400 });
    }
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  
  handleSharer(ws: WebSocket) {
    (ws as any).accept();
    this.sharerWs = ws;
    
    ws.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        
        if (msg.op === 'register') {
          this.mode = msg.mode || 'ro';
          
          // Send back share code
          ws.send(JSON.stringify({
            op: 'registered',
            shareCode: this.shareCode,
            publicUrl: `${this.publicUrl}/?code=${this.shareCode}`,
          }));
        } else if (msg.op === 'result' || msg.op === 'error' || msg.op === 'chunk') {
          // Response from sharer, forward to accessor
          const accessorWs = this.pendingRequests.get(msg.reqId);
          if (accessorWs && accessorWs.readyState === WebSocket.OPEN) {
            accessorWs.send(JSON.stringify(msg));
            
            // Clean up on final response
            if (msg.op !== 'chunk' || msg.eof) {
              this.pendingRequests.delete(msg.reqId);
            }
          }
        }
      } catch (e) {
        console.error('Error handling sharer message:', e);
      }
    });
    
    ws.addEventListener('close', () => {
      this.sharerWs = null;
      // Close all accessor connections
      for (const [, accessorWs] of this.accessorWs) {
        accessorWs.close(1000, 'Sharer disconnected');
      }
      this.accessorWs.clear();
    });
  }
  
  handleAccessor(ws: WebSocket) {
    (ws as any).accept();
    
    const accessorId = crypto.randomUUID();
    this.accessorWs.set(accessorId, ws);
    
    ws.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        
        // Check if sharer is connected
        if (!this.sharerWs || this.sharerWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            op: 'error',
            reqId: msg.reqId,
            error: 'Share not available',
          }));
          return;
        }
        
        // Check write permission for rm
        if (msg.op === 'rm' && this.mode === 'ro') {
          ws.send(JSON.stringify({
            op: 'error',
            reqId: msg.reqId,
            error: 'Read-only share',
          }));
          return;
        }
        
        // Store pending request
        this.pendingRequests.set(msg.reqId, ws);
        
        // Forward to sharer
        this.sharerWs.send(JSON.stringify(msg));
      } catch (e) {
        console.error('Error handling accessor message:', e);
      }
    });
    
    ws.addEventListener('close', () => {
      this.accessorWs.delete(accessorId);
    });
  }
}
