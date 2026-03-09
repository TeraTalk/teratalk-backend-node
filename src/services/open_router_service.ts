/**
 * Open Router chat completion service for the voice agent.
 * Sends user transcript + system prompt and returns a short AI reply.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_SYSTEM_PROMPT =
  'You are a friendly assistant for Teratalk, a speech therapy app. Reply in 1–2 short, clear sentences. Be encouraging and concise. Reply as if replying to a 5 year old child.';

export class OpenRouterService {
  private static getApiKey(): string {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key || key.trim() === '') {
      throw new Error('OPENROUTER_API_KEY is not set');
    }
    return key.trim();
  }

  private static getModel(): string {
    return process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo';
  }

  /**
   * Send transcript to Open Router and return the assistant's short text reply.
   */
  static async chat(
    userMessage: string,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT
  ): Promise<string> {
    const apiKey = this.getApiKey();
    const model = this.getModel();

    const body = {
      model,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userMessage },
      ],
      max_tokens: 150,
    };

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Open Router request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content =
      data.choices?.[0]?.message?.content?.trim() ??
      '';

    return content;
  }
}
