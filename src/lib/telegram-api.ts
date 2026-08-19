type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

export class TelegramDeliveryError extends Error {
  constructor(message: string, public readonly uncertain: boolean) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

export function telegramDeliveryIsUncertain(error: unknown) {
  // Unknown sender/network failures are treated conservatively: automatic
  // retry could duplicate a message Telegram already accepted.
  return !(error instanceof TelegramDeliveryError) || error.uncertain;
}

function telegramToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("Telegram-бот пока не подключён");
  return token;
}

export function telegramIsConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export async function telegramApi<T>(method: string, payload: Record<string, unknown>) {
  const token = telegramToken();
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new TelegramDeliveryError(`Нет подтверждённого ответа Telegram API: ${method}`, true);
  }
  let data: TelegramResponse<T>;
  try {
    data = (await response.json()) as TelegramResponse<T>;
  } catch {
    throw new TelegramDeliveryError(`Не удалось проверить ответ Telegram API: ${method}`, true);
  }
  if (!response.ok || !data.ok) {
    throw new TelegramDeliveryError(data.description || `Telegram API отклонил запрос: ${method}`, false);
  }
  if (data.result === undefined) {
    throw new TelegramDeliveryError(`Telegram API не подтвердил результат: ${method}`, true);
  }
  return data.result;
}

export async function sendTelegramMessage(chatId: string, text: string) {
  return telegramApi<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function downloadTelegramFile(fileId: string) {
  const file = await telegramApi<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram не вернул путь к фотографии");
  const response = await fetch(`https://api.telegram.org/file/bot${telegramToken()}/${file.file_path}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить фотографию из Telegram");
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "image/jpeg" };
}
