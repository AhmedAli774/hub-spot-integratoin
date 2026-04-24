/**
 * Dev proxy — unifies Vite (5173) and Astro (4321) behind a single port (5175).
 * ngrok → 5175 → /api/* goes to Astro, everything else goes to Vite.
 * Also proxies WebSocket upgrades so Vite HMR works through ngrok.
 */
import http from 'http';
import net from 'net';

const PROXY_PORT = 5175;
const VITE_PORT  = 5173;
const ASTRO_PORT = 4321;

function targetPort(url) {
  return (url ?? '').startsWith('/api/') ? ASTRO_PORT : VITE_PORT;
}

const server = http.createServer((req, res) => {
  const port = targetPort(req.url);
  const opts = {
    hostname: '127.0.0.1',
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${port}` },
  };

  const upstream = http.request(opts, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res, { end: true });
  });

  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Dev server not reachable');
  });

  req.pipe(upstream, { end: true });
});

// WebSocket proxy — needed for Vite HMR
server.on('upgrade', (req, clientSocket, head) => {
  const port = targetPort(req.url);
  const serverSocket = net.createConnection(port, '127.0.0.1');

  serverSocket.on('connect', () => {
    let rawHeaders = `${req.method} ${req.url} HTTP/1.1\r\nHost: localhost:${port}\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() !== 'host') rawHeaders += `${k}: ${v}\r\n`;
    }
    serverSocket.write(rawHeaders + '\r\n');
    if (head?.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => serverSocket.destroy());
});

server.listen(PROXY_PORT, () => {
  console.log(`\nDev proxy ready on :${PROXY_PORT}`);
  console.log(`  /api/* → :${ASTRO_PORT}  (Astro API routes)`);
  console.log(`  rest   → :${VITE_PORT}   (Vite dashboard bundle)\n`);
});
