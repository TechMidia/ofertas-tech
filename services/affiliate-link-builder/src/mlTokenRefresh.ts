import axios from 'axios';
import fs from 'fs';
import path from 'path';

const ENV_PATH = path.resolve(__dirname, '../../../.env');

export async function refreshMLToken(): Promise<void> {
  const refreshToken = process.env.ML_REFRESH_TOKEN;
  const appId       = process.env.ML_APP_ID;
  const secret      = process.env.ML_CLIENT_SECRET;

  if (!refreshToken || !appId || !secret) {
    console.log(JSON.stringify({ level: 'warn', event: 'ml_refresh_skipped', reason: 'credenciais ausentes' }));
    return;
  }

  try {
    const res = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     appId,
        client_secret: secret,
        refresh_token: refreshToken,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );

    const { access_token, refresh_token } = res.data as {
      access_token: string;
      refresh_token: string;
    };

    // Atualiza as variáveis de processo imediatamente
    process.env.ML_ACCESS_TOKEN  = access_token;
    process.env.ML_REFRESH_TOKEN = refresh_token;

    // Persiste no .env para sobreviver a reinicializações
    if (fs.existsSync(ENV_PATH)) {
      let env = fs.readFileSync(ENV_PATH, 'utf-8');
      env = env.replace(/^ML_ACCESS_TOKEN=.*/m,  `ML_ACCESS_TOKEN=${access_token}`);
      env = env.replace(/^ML_REFRESH_TOKEN=.*/m, `ML_REFRESH_TOKEN=${refresh_token}`);
      fs.writeFileSync(ENV_PATH, env);
    }

    console.log(JSON.stringify({ level: 'info', event: 'ml_token_refreshed' }));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'ml_token_refresh_error', err: String(err) }));
  }
}
