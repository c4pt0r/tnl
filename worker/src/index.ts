/**
 * TNL - Tunnel File Sharing Worker
 * 
 * Cloudflare Worker that relays WebSocket messages between
 * sharers (User A) and accessors (User B)
 */

interface Env {
  SHARES: DurableObjectNamespace;
  PUBLIC_URL?: string;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// HTML template for web file explorer
function renderHTML(code: string, path: string, files: any[] | null, error: string | null, fileContent: string | null, fileName: string | null): string {
  const breadcrumbs = path.split('/').filter(p => p);
  let breadcrumbHTML = `<a href="/?code=${code}&path=/">🏠 root</a>`;
  let currentPath = '';
  for (const crumb of breadcrumbs) {
    currentPath += '/' + crumb;
    breadcrumbHTML += ` / <a href="/?code=${code}&path=${encodeURIComponent(currentPath)}">${crumb}</a>`;
  }

  let contentHTML = '';
  
  if (error) {
    contentHTML = `<div class="error">❌ ${error}</div>`;
  } else if (fileContent !== null) {
    const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
    const langMap: {[key: string]: string} = {
      'js': 'javascript', 'ts': 'typescript', 'jsx': 'javascript', 'tsx': 'typescript',
      'py': 'python', 'go': 'go', 'rs': 'rust', 'rb': 'ruby',
      'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
      'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
      'json': 'json', 'yaml': 'yaml', 'yml': 'yaml', 'toml': 'toml',
      'xml': 'xml', 'html': 'html', 'css': 'css', 'scss': 'scss',
      'md': 'markdown', 'sql': 'sql', 'dockerfile': 'dockerfile',
    };
    const lang = langMap[ext] || 'plaintext';
    
    contentHTML = `
      <div class="file-view">
        <div class="file-header">
          <span>📄 ${fileName}</span>
          <div>
            <a href="/?code=${code}&path=${encodeURIComponent(path)}&raw=1" class="btn btn-secondary">Raw</a>
            <a href="/?code=${code}&path=${encodeURIComponent(path)}&download=1" class="btn">⬇️ Download</a>
          </div>
        </div>
        <pre><code class="language-${lang}">${escapeHtml(fileContent)}</code></pre>
      </div>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
      <script>hljs.highlightAll();</script>`;
  } else if (files) {
    contentHTML = `<table>
      <tr><th>Name</th><th>Size</th><th>Modified</th></tr>`;
    
    // Add parent directory link
    if (path !== '/' && path !== '') {
      const parentPath = '/' + breadcrumbs.slice(0, -1).join('/');
      contentHTML += `<tr><td><a href="/?code=${code}&path=${encodeURIComponent(parentPath)}">📁 ..</a></td><td>-</td><td>-</td></tr>`;
    }
    
    for (const f of files) {
      const icon = f.isDir ? '📁' : '📄';
      const filePath = path === '/' ? '/' + f.name : path + '/' + f.name;
      const size = f.isDir ? '-' : formatSize(f.size);
      const date = new Date(f.modTime * 1000).toLocaleString();
      contentHTML += `<tr>
        <td><a href="/?code=${code}&path=${encodeURIComponent(filePath)}">${icon} ${f.name}</a></td>
        <td>${size}</td>
        <td>${date}</td>
      </tr>`;
    }
    contentHTML += '</table>';
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tnl - ${code}</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px; 
      margin: 0 auto; 
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 20px; }
    .breadcrumb { 
      background: #fff; 
      padding: 10px 15px; 
      border-radius: 8px;
      margin-bottom: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .breadcrumb a { color: #0066cc; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    table { 
      width: 100%; 
      background: #fff; 
      border-collapse: collapse;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    th { background: #f8f9fa; text-align: left; padding: 12px 15px; }
    td { padding: 10px 15px; border-top: 1px solid #eee; }
    td a { color: #333; text-decoration: none; }
    td a:hover { color: #0066cc; }
    tr:hover { background: #f8f9fa; }
    .error { 
      background: #fee; 
      color: #c00; 
      padding: 15px; 
      border-radius: 8px;
    }
    .file-view {
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .file-header {
      background: #f8f9fa;
      padding: 12px 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #eee;
    }
    .file-view pre {
      margin: 0;
      padding: 0;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.6;
      max-height: 75vh;
      overflow-y: auto;
    }
    .file-view pre code {
      display: block;
      padding: 15px;
    }
    .file-view pre code.hljs {
      background: #f8f9fa;
    }
    .btn-secondary {
      background: #6c757d;
      margin-right: 8px;
    }
    .btn-secondary:hover { background: #545b62; }
    .btn {
      background: #0066cc;
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      text-decoration: none;
      font-size: 14px;
    }
    .btn:hover { background: #0052a3; }
    .cli-hint {
      margin-top: 20px;
      padding: 15px;
      background: #fff;
      border-radius: 8px;
      font-size: 13px;
      color: #666;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .cli-hint code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <h1>📂 tnl</h1>
  <p class="subtitle">Share code: <strong>${code}</strong></p>
  <div class="breadcrumb">${breadcrumbHTML}</div>
  ${contentHTML}
  <div class="cli-hint">
    💡 CLI: <code>tnl cp ${code}:${path} ./local</code> or <code>tnl cp -r ${code}:/ ./backup</code>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, env, url);
    }
    
    // Web UI
    const code = url.searchParams.get('code');
    if (code) {
      return handleWebUI(request, env, url, code);
    }
    
    // Landing page
    if (url.pathname === '/') {
      return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tnl - Tunnel File Sharing</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      max-width: 600px; 
      margin: 100px auto; 
      padding: 20px;
      text-align: center;
    }
    h1 { font-size: 3em; margin-bottom: 0; }
    .subtitle { color: #666; font-size: 1.2em; }
    code { background: #f0f0f0; padding: 10px 15px; border-radius: 5px; display: inline-block; margin: 10px 0; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>📂 tnl</h1>
  <p class="subtitle">Tunnel-based ephemeral file sharing</p>
  <p>Share files instantly from your terminal:</p>
  <code>tnl share ./mydir</code>
  <p style="margin-top: 30px;">
    <a href="https://github.com/c4pt0r/tnl">GitHub</a> · 
    <a href="https://github.com/c4pt0r/tnl/releases">Download CLI</a>
  </p>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

async function handleWebUI(request: Request, env: Env, url: URL, code: string): Promise<Response> {
  const path = url.searchParams.get('path') || '/';
  const download = url.searchParams.get('download') === '1';
  const raw = url.searchParams.get('raw') === '1';
  
  // Connect to DO
  const id = env.SHARES.idFromName(code);
  const stub = env.SHARES.get(id);
  
  // Create a one-shot WebSocket connection to query files
  try {
    const result = await stub.fetch(new Request(`http://internal/?code=${code}&webui=1&path=${encodeURIComponent(path)}&download=${download ? '1' : '0'}&raw=${raw ? '1' : '0'}`));
    
    if (result.headers.get('X-File-Download')) {
      return result; // Pass through file download
    }
    
    const data = await result.json() as any;
    
    if (data.error) {
      return new Response(renderHTML(code, path, null, data.error, null, null), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    
    if (data.content !== undefined) {
      // File content
      return new Response(renderHTML(code, path, null, null, data.content, data.name), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    
    // Directory listing
    return new Response(renderHTML(code, path, data.files, null, null, null), {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (e) {
    return new Response(renderHTML(code, path, null, 'Share not available or expired', null, null), {
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

async function handleWebSocket(request: Request, env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const isSharer = url.pathname === '/ws/share' || !code;
  
  const publicUrl = env.PUBLIC_URL || `https://${url.hostname}`;
  
  if (isSharer) {
    const shareCode = generateCode();
    const id = env.SHARES.idFromName(shareCode);
    const stub = env.SHARES.get(id);
    
    const newUrl = new URL(request.url);
    newUrl.searchParams.set('newShareCode', shareCode);
    newUrl.searchParams.set('publicUrl', publicUrl);
    return stub.fetch(new Request(newUrl, request));
  } else {
    const id = env.SHARES.idFromName(code);
    const stub = env.SHARES.get(id);
    return stub.fetch(request);
  }
}

export class ShareDO {
  state: DurableObjectState;
  sharerWs: WebSocket | null = null;
  accessorWs: Map<string, WebSocket> = new Map();
  shareCode: string | null = null;
  publicUrl: string = '';
  mode: string = 'ro';
  pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();
  wsRequests: Map<string, WebSocket> = new Map();
  
  constructor(state: DurableObjectState) {
    this.state = state;
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const newShareCode = url.searchParams.get('newShareCode');
    const publicUrl = url.searchParams.get('publicUrl') || `https://${url.hostname}`;
    const webui = url.searchParams.get('webui') === '1';
    
    // Web UI request (HTTP, not WebSocket)
    if (webui) {
      return this.handleWebUIRequest(url);
    }
    
    // WebSocket handling
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    if (newShareCode) {
      this.shareCode = newShareCode;
      this.publicUrl = publicUrl;
      this.handleSharer(server);
    } else if (code) {
      this.handleAccessor(server);
    } else {
      return new Response('Invalid request', { status: 400 });
    }
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  
  async handleWebUIRequest(url: URL): Promise<Response> {
    const path = url.searchParams.get('path') || '/';
    const download = url.searchParams.get('download') === '1';
    const raw = url.searchParams.get('raw') === '1';
    
    if (!this.sharerWs || this.sharerWs.readyState !== WebSocket.OPEN) {
      return Response.json({ error: 'Share not available' });
    }
    
    const reqId = crypto.randomUUID();
    
    // First, stat to check if it's a file or directory
    const statResult = await this.sendRequest(reqId + '-stat', { op: 'stat', reqId: reqId + '-stat', path });
    
    if (statResult.error) {
      return Response.json({ error: statResult.error });
    }
    
    if (statResult.data.isDir) {
      // List directory
      const listResult = await this.sendRequest(reqId, { op: 'ls', reqId, path });
      if (listResult.error) {
        return Response.json({ error: listResult.error });
      }
      return Response.json({ files: listResult.data.files });
    } else {
      // It's a file
      if (download || raw) {
        // Stream file download or raw view
        const readResult = await this.sendRequest(reqId, { op: 'cat', reqId, path, compress: false });
        if (readResult.error) {
          return Response.json({ error: readResult.error });
        }
        
        const content = this.base64ToArrayBuffer(readResult.content);
        const fileName = path.split('/').pop() || 'file';
        
        if (raw) {
          // Raw text view
          const ext = fileName.split('.').pop()?.toLowerCase() || '';
          const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'sql', 'log', 'conf', 'cfg', 'ini', 'env'];
          const contentType = textExts.includes(ext) ? 'text/plain; charset=utf-8' : 'application/octet-stream';
          return new Response(content, {
            headers: {
              'Content-Type': contentType,
              'X-File-Download': '1',
            },
          });
        }
        
        return new Response(content, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'X-File-Download': '1',
          },
        });
      } else {
        // Preview file (text only, limit size)
        const readResult = await this.sendRequest(reqId, { op: 'cat', reqId, path, compress: false });
        if (readResult.error) {
          return Response.json({ error: readResult.error });
        }
        
        const content = atob(readResult.content);
        const preview = content.length > 100000 ? content.slice(0, 100000) + '\n\n... (truncated)' : content;
        const fileName = path.split('/').pop() || 'file';
        
        return Response.json({ content: preview, name: fileName });
      }
    }
  }
  
  base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  sendRequest(reqId: string, msg: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject });
      this.sharerWs!.send(JSON.stringify(msg));
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
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
          ws.send(JSON.stringify({
            op: 'registered',
            shareCode: this.shareCode,
            publicUrl: `${this.publicUrl}/?code=${this.shareCode}`,
          }));
        } else if (msg.op === 'result' || msg.op === 'error') {
          // Response from sharer
          const pending = this.pendingRequests.get(msg.reqId);
          if (pending) {
            this.pendingRequests.delete(msg.reqId);
            if (msg.op === 'error') {
              pending.resolve({ error: msg.error });
            } else {
              pending.resolve(msg);
            }
          }
          
          // Also forward to WebSocket accessor if any
          const accessorWs = this.wsRequests.get(msg.reqId);
          if (accessorWs && accessorWs.readyState === WebSocket.OPEN) {
            accessorWs.send(JSON.stringify(msg));
            if (msg.op !== 'chunk' || msg.eof) {
              this.wsRequests.delete(msg.reqId);
            }
          }
        } else if (msg.op === 'chunk') {
          // Handle chunk for web UI
          const pending = this.pendingRequests.get(msg.reqId);
          if (pending && msg.eof) {
            this.pendingRequests.delete(msg.reqId);
            pending.resolve({ content: msg.data });
          }
          
          // Forward to WebSocket accessor
          const accessorWs = this.wsRequests.get(msg.reqId);
          if (accessorWs && accessorWs.readyState === WebSocket.OPEN) {
            accessorWs.send(JSON.stringify(msg));
            if (msg.eof) {
              this.wsRequests.delete(msg.reqId);
            }
          }
        }
      } catch (e) {
        console.error('Error handling sharer message:', e);
      }
    });
    
    ws.addEventListener('close', () => {
      this.sharerWs = null;
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
        
        if (!this.sharerWs || this.sharerWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            op: 'error',
            reqId: msg.reqId,
            error: 'Share not available',
          }));
          return;
        }
        
        if (msg.op === 'rm' && this.mode === 'ro') {
          ws.send(JSON.stringify({
            op: 'error',
            reqId: msg.reqId,
            error: 'Read-only share',
          }));
          return;
        }
        
        this.wsRequests.set(msg.reqId, ws);
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
