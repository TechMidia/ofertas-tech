import axios from 'axios';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID ?? '';
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

export interface SendResult {
  message_id: number;
}

// Envia foto com caption (Markdown V2)
export async function sendPhoto(imageUrl: string, caption: string): Promise<SendResult> {
  const response = await axios.post(`${BASE_URL}/sendPhoto`, {
    chat_id: CHANNEL_ID,
    photo: imageUrl,
    caption,
    parse_mode: 'MarkdownV2',
  }, { timeout: 15000 });

  return { message_id: response.data.result.message_id as number };
}

// Fallback: envia só texto quando não há imagem
export async function sendMessage(text: string): Promise<SendResult> {
  const response = await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: CHANNEL_ID,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: false,
  }, { timeout: 15000 });

  return { message_id: response.data.result.message_id as number };
}

// Atualiza views de um post (via getUpdates ou Telegram Analytics)
export async function getMessageViews(messageId: number): Promise<number | null> {
  try {
    const response = await axios.get(`${BASE_URL}/forwardMessage`, {
      params: { chat_id: CHANNEL_ID, from_chat_id: CHANNEL_ID, message_id: messageId },
      timeout: 5000,
    });
    return response.data?.result?.views ?? null;
  } catch {
    return null;
  }
}
