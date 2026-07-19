class RecruitmentWebClient {
  constructor(baseUrl, apiToken) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
  }

  async relayDiscordMessage(discordUserId, content, attachments = []) {
    const url = `${this.baseUrl}/api/bot/recruitment/chat/relay`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({ discordUserId, content, attachments }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Relay failed (${response.status}): ${body}`,
      );
    }

    return response.json();
  }
}

module.exports = {
  RecruitmentWebClient,
};
