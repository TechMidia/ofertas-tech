import 'dotenv/config';
import app from './server';
import { refreshMLToken } from './mlTokenRefresh';

const PORT = Number(process.env.AFFILIATE_LINK_BUILDER_PORT ?? 18790);

app.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    service: 'affiliate-link-builder',
    message: `Serviço iniciado na porta ${PORT}`,
    timestamp: new Date().toISOString(),
  }));
});

// Renova o token do ML a cada 5h (expira em 6h)
refreshMLToken();
setInterval(refreshMLToken, 5 * 60 * 60 * 1000);
