// Gateway mínimo — repassa chamadas para a API pública do Deepseek
// Roda na porta 18789, mesma interface do gateway OpenClaw
// Não requer dependências externas — usa apenas módulos nativos do Node.js

const http  = require('http');
const https = require('https');
const path  = require('path');

// Carrega .env manualmente (sem dependência do dotenv)
const envPath = path.resolve(__dirname, '../.env');
try {
  require('fs').readFileSync(envPath, 'utf-8')
    .split('\n')
    .forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && v.length && !process.env[k.trim()]) {
        process.env[k.trim()] = v.join('=').trim();
      }
    });
} catch {}

const PORT        = 18789;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const UPSTREAM    = 'api.deepseek.com';

if (!DEEPSEEK_API_KEY) {
  console.error('[deepseek-proxy] DEEPSEEK_API_KEY não definida no .env — proxy iniciado mas chamadas falharão');
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const options = {
      hostname: UPSTREAM,
      port: 443,
      path: req.url,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const proxy = https.request(options, (upstream) => {
      res.writeHead(upstream.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      upstream.pipe(res);
    });

    proxy.on('error', (err) => {
      console.error('[deepseek-proxy] Erro:', err.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
    });

    proxy.write(body);
    proxy.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({
    level: 'info',
    service: 'deepseek-proxy',
    message: `Proxy Deepseek rodando em localhost:${PORT}`,
    upstream: `https://${UPSTREAM}`,
    timestamp: new Date().toISOString(),
  }));
});
