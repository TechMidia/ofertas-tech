// Bloco de patrocínio (v2) — resolve para vazio se nenhuma campanha ativa
export interface SponsoredCampaign {
  id: number;
  content: string;
}

export function renderSponsoredBlock(campaign: SponsoredCampaign | null): string {
  if (!campaign) return '';

  // Escapa conteúdo do patrocinador para MarkdownV2
  const escapedContent = campaign.content.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

  return [
    '',
    '━━━━━━━━━━━━━━━━━',
    '📢 *Patrocínio*',
    escapedContent,
    '━━━━━━━━━━━━━━━━━',
  ].join('\n');
}
