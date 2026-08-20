import "server-only";

/**
 * Vercel functions do not provide durable application filesystem storage.
 * The explicit override covers other ephemeral runtimes without changing the
 * existing local or persistent-server behaviour.
 */
export function filesystemAvatarUploadsAvailable() {
  return (
    process.env.VERCEL !== "1" &&
    process.env.FILESYSTEM_AVATAR_UPLOADS_DISABLED !== "1"
  );
}

export function telegramLiveDeliveryAllowed() {
  return (
    Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()) &&
    process.env.TELEGRAM_OUTBOX_LIVE_SEND === "1"
  );
}
