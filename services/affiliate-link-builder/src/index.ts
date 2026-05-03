import 'dotenv/config';
import app from './server';

const PORT = Number(process.env.AFFILIATE_LINK_BUILDER_PORT ?? 18790);

app.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    service: 'affiliate-link-builder',
    message: `Serviço iniciado na porta ${PORT}`,
    timestamp: new Date().toISOString(),
  }));
});
