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
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += chars[randomBytes[i] % chars.length];
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
    breadcrumbHTML += ` / <a href="/?code=${code}&path=${encodeURIComponent(currentPath)}">${escapeHtml(crumb)}</a>`;
  }

  let contentHTML = '';
  
  if (error) {
    contentHTML = `<div class="error">❌ ${escapeHtml(error)}</div>`;
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
    
    // Build table with line numbers
    const lines = fileContent.split('\n');
    const tableRows = lines.map((line, i) => 
      `<tr><td class="line-num">${i + 1}</td><td class="line-code"><code>${escapeHtml(line) || ' '}</code></td></tr>`
    ).join('');
    
    const safeFileName = escapeHtml(fileName || '');
    contentHTML = `
      <div class="file-view">
        <div class="file-header">
          <span>📄 ${safeFileName}</span>
          <div>
            <a href="/?code=${code}&path=${encodeURIComponent(path)}&raw=1" class="btn btn-secondary">Raw</a>
            <a href="/?code=${code}&path=${encodeURIComponent(path)}&download=1" class="btn">⬇️ Download</a>
          </div>
        </div>
        <div class="code-scroll">
          <table class="code-table"><tbody>${tableRows}</tbody></table>
        </div>
      </div>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
      <script>
        document.querySelectorAll('.line-code code').forEach(el => hljs.highlightElement(el));
      </script>`;
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
        <td><a href="/?code=${code}&path=${encodeURIComponent(filePath)}">${icon} ${escapeHtml(f.name)}</a></td>
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
      font-size: 13px;
      line-height: 1.6;
    }
    .code-scroll {
      overflow: auto;
      max-height: 75vh;
      background: #f8f9fa;
    }
    .code-table {
      border-collapse: collapse;
      font-family: monospace;
      font-size: 13px;
      line-height: 1.5;
      width: 100%;
    }
    .code-table td {
      padding: 0;
      border: none;
      vertical-align: top;
    }
    .line-num {
      text-align: right;
      padding: 0 12px 0 10px !important;
      color: #888;
      background: #f0f0f0;
      border-right: 1px solid #ddd;
      user-select: none;
      -webkit-user-select: none;
      white-space: nowrap;
      position: sticky;
      left: 0;
    }
    .line-code {
      padding-left: 12px !important;
      white-space: pre;
    }
    .line-code code {
      background: transparent !important;
      padding: 0 !important;
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

// Sanitize filename for Content-Disposition header (RFC 5987)
function sanitizeFilename(name: string): string {
  // Remove any path separators and null bytes
  const cleaned = name.replace(/[\/\\:\x00]/g, '_');
  // For ASCII-safe fallback, replace non-ASCII and problematic chars
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, '_').replace(/["]/g, "'");
  // URL-encode the original for UTF-8 filename*
  const encoded = encodeURIComponent(cleaned);
  // Return both forms for compatibility
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
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
    
    // Serve skill.md
    if (url.pathname === '/skill.md') {
      const skillUrl = 'https://raw.githubusercontent.com/c4pt0r/tnl/master/skill/SKILL.md';
      const resp = await fetch(skillUrl, { cf: { cacheTtl: 300 } });
      if (!resp.ok) {
        return new Response('Failed to fetch skill.md', { status: 502 });
      }
      return new Response(resp.body, {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }

    // Serve install.sh
    if (url.pathname === '/install.sh') {
      const installUrl = 'https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh';
      const resp = await fetch(installUrl, { cf: { cacheTtl: 300 } });
      if (!resp.ok) {
        return new Response('Failed to fetch install.sh', { status: 502 });
      }
      return new Response(resp.body, {
        headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' },
      });
    }

    // Landing page
    if (url.pathname === '/') {
      return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tnl</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
      max-width: 520px;
      margin: 0 auto;
      padding: 120px 24px 60px;
      background: #fff;
      color: #111;
      font-size: 14px;
      line-height: 1.6;
    }
    .title { font-size: 1.5em; font-weight: 700; letter-spacing: -0.01em; }
    .desc { color: #888; margin: 6px 0 0; }
    .sep { border: none; border-top: 1px solid #eee; margin: 28px 0; }
    .block { margin-bottom: 28px; }
    .label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
    .term {
      background: #f6f6f6;
      color: #333;
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
      border: 1px solid #eee;
    }
    .term .ps { color: #aaa; user-select: none; -webkit-user-select: none; }
    .term .cmd { color: #111; }
    .term .arg { color: #666; }
    .agent-box {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 16px;
    }
    .agent-box .agent-title { font-weight: 600; margin-bottom: 6px; }
    .agent-box .agent-desc { color: #666; margin-bottom: 14px; }
    .agent-box .agent-cmd {
      background: #f6f6f6;
      border: 1px solid #eee;
      border-radius: 4px;
      padding: 10px 14px;
      color: #333;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-all;
    }
    .foot { color: #bbb; font-size: 12px; }
    .foot a { color: #999; text-decoration: none; }
    .foot a:hover { color: #111; }
    .foot .dot { margin: 0 6px; }
  </style>
</head>
<body>
  <div class="block">
    <div class="title">tnl</div>
    <div class="desc">tunnel-based ephemeral file sharing</div>
  </div>
  <hr class="sep">
  <div class="block">
    <div class="label">Quick Start</div>
    <div class="term"><span class="ps">$ </span><span class="cmd">curl -fsSL</span> <span class="arg">tnl.db9.workers.dev/install.sh</span> <span class="cmd">| sh</span></div>
  </div>
  <div class="block">
    <div class="label">Share</div>
    <div class="term"><span class="ps">$ </span><span class="cmd">tnl share</span> <span class="arg">./project</span></div>
  </div>
  <hr class="sep">
  <div class="block">
    <div class="label">For AI Agents</div>
    <div class="agent-box">
      <div class="agent-title">Teach your agent to use tnl</div>
      <div class="agent-desc">Access local files without git push, zip, or SSH.</div>
      <div class="agent-cmd">Read https://tnl.db9.workers.dev/skill.md and follow the instructions to join tnl</div>
    </div>
  </div>
  <hr class="sep">
  <div class="foot">
    <a href="https://github.com/c4pt0r/tnl">github</a><span class="dot">&middot;</span><a href="https://github.com/c4pt0r/tnl/releases">releases</a>
  </div>
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
      const errorMsg = data.debug ? `${data.error} (debug: hasWs=${data.debug.hasWs}, readyState=${data.debug.readyState})` : data.error;
      return new Response(renderHTML(code, path, null, errorMsg, null, null), {
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
    const errorMsg = e instanceof Error ? `Error: ${e.message}` : 'Share not available or expired';
    console.error('Web UI error:', e);
    return new Response(renderHTML(code, path, null, errorMsg, null, null), {
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
  pendingChunks: Map<string, string[]> = new Map(); // accumulate chunks for web UI
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
    let download = url.searchParams.get('download') === '1';
    const raw = url.searchParams.get('raw') === '1';
    
    // Debug: log WebSocket state
    console.log('handleWebUIRequest - sharerWs:', this.sharerWs ? 'exists' : 'null', 
                'readyState:', this.sharerWs?.readyState, 
                'WebSocket.OPEN:', WebSocket.OPEN);
    
    if (!this.sharerWs || this.sharerWs.readyState !== WebSocket.OPEN) {
      return Response.json({ error: 'Share not available', debug: { hasWs: !!this.sharerWs, readyState: this.sharerWs?.readyState } });
    }
    
    const reqId = crypto.randomUUID();
    
    // First, stat to check if it's a file or directory
    const statResult = await this.sendRequest(reqId + '-stat', { op: 'stat', reqId: reqId + '-stat', path });

    if (statResult.error) {
      return Response.json({ error: statResult.error });
    }

    // Validate stat result
    if (!statResult.data) {
      return Response.json({ error: 'Invalid stat response from client' });
    }

    if (statResult.data.isDir) {
      // List directory
      const listResult = await this.sendRequest(reqId, { op: 'ls', reqId, path });
      if (listResult.error) {
        return Response.json({ error: listResult.error });
      }
      return Response.json({ files: listResult.data.files });
    } else {
      // It's a file - check if it's a text file
      const fileName = path.split('/').pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';

      // Define text file extensions
      const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss',
                        'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'rb', 'java', 'c', 'cpp',
                        'h', 'hpp', 'sh', 'bash', 'zsh', 'sql', 'log', 'conf', 'cfg', 'ini',
                        'env', 'Dockerfile', 'makefile', 'gradle', 'properties', 'gitignore'];

      const isTextFile = textExts.includes(ext) || fileName.toLowerCase() === 'dockerfile' || fileName.toLowerCase() === 'makefile';

      // For non-text files, force download instead of preview
      if (!isTextFile && !download && !raw) {
        download = true;
      }

      if (download || raw) {
        // Stream file download or raw view
        const readResult = await this.sendRequest(reqId, { op: 'cat', reqId, path, compress: false });
        if (readResult.error) {
          return Response.json({ error: readResult.error });
        }

        const content = this.base64ToArrayBuffer(readResult.content);

        if (raw) {
          // Raw text view
          const contentType = isTextFile ? 'text/plain; charset=utf-8' : 'application/octet-stream';
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
            'Content-Disposition': `attachment; ${sanitizeFilename(fileName)}`,
            'X-File-Download': '1',
          },
        });
      } else {
        // Preview file (text only, limit size)
        const readResult = await this.sendRequest(reqId, { op: 'cat', reqId, path, compress: false });
        if (readResult.error) {
          return Response.json({ error: readResult.error });
        }

        // Check if content exists
        if (!readResult.content) {
          return Response.json({ error: 'File content not received from client' });
        }
        
        const fileName = path.split('/').pop() || 'file';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        
        // Decode base64 to bytes
        let binaryStr: string;
        try {
          binaryStr = atob(readResult.content);
        } catch (e) {
          return Response.json({ error: 'Invalid file content encoding: ' + (e as Error).message });
        }
        
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        
        // Check if content looks like text (no null bytes, mostly printable)
        const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'sql', 'log', 'conf', 'cfg', 'ini', 'env', 'gitignore', 'dockerfile', 'makefile', 'csv', 'tsv'];
        const isTextExt = textExts.includes(ext) || ext === '';
        
        // Check for binary content (null bytes or too many non-printable chars)
        let nullCount = 0;
        let nonPrintable = 0;
        const checkLen = Math.min(bytes.length, 8000);
        for (let i = 0; i < checkLen; i++) {
          if (bytes[i] === 0) nullCount++;
          else if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32 && bytes[i] !== 27)) nonPrintable++;
        }
        const isBinary = nullCount > 0 || (checkLen > 0 && nonPrintable / checkLen > 0.1);
        
        if (isBinary && !isTextExt) {
          return Response.json({ 
            content: `[Binary file - ${formatSize(bytes.length)}]\n\nUse the Download button to view this file.`, 
            name: fileName,
            binary: true
          });
        }
        
        // Decode as UTF-8 text
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        } catch {
          return Response.json({ 
            content: `[Unable to decode file as text]\n\nUse the Download button to view this file.`, 
            name: fileName,
            binary: true
          });
        }
        
        const preview = content.length > 100000 ? content.slice(0, 100000) + '\n\n... (truncated)' : content;
        
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
    console.log('handleSharer called, setting sharerWs');
    (ws as any).accept();
    this.sharerWs = ws;
    console.log('sharerWs set, readyState:', ws.readyState);
    
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
          // Handle chunk for web UI - accumulate all chunks
          const pending = this.pendingRequests.get(msg.reqId);
          if (pending) {
            // Accumulate chunk data
            if (!this.pendingChunks.has(msg.reqId)) {
              this.pendingChunks.set(msg.reqId, []);
            }
            this.pendingChunks.get(msg.reqId)!.push(msg.data);
            
            if (msg.eof) {
              // Combine all chunks and resolve
              const allChunks = this.pendingChunks.get(msg.reqId)!;
              const fullContent = allChunks.join('');
              this.pendingChunks.delete(msg.reqId);
              this.pendingRequests.delete(msg.reqId);
              pending.resolve({ content: fullContent });
            }
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
    
    ws.addEventListener('close', (event) => {
      console.log('Sharer WebSocket closed, code:', (event as any).code, 'reason:', (event as any).reason);
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
