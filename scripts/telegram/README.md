# Telegram outbox

The outbox reads `Notification` rows with `channel=telegram` and moves them through:

`queued -> sending -> sent | waiting | error | uncertain`

- `waiting`: the CRM client does not have `telegramChatId` yet.
- `error`: Telegram explicitly rejected the request; requeue is an explicit operation.
- `uncertain`: the network answer was lost or a `sending` worker became stale. The message might already be in Telegram, so it is never retried automatically.
- abandoned `sending` rows are detected by `updatedAt` and quarantined as `uncertain`.

## Safe preview

```sh
node --import tsx scripts/telegram/outbox.ts --limit=25
```

Preview is the default. It is read-only and never calls Telegram.

## Queue an existing notification

```sh
node --import tsx scripts/telegram/queue.ts 123
```

The conditional state transition makes repeating the same command harmless.

## Live worker

Live delivery stays blocked unless all three conditions are true:

1. `TELEGRAM_BOT_TOKEN` belongs to Anya's bot.
2. `TELEGRAM_OUTBOX_LIVE_SEND=1` is present in the worker environment.
3. the worker is started with `--live`.

```sh
node --import tsx scripts/telegram/outbox.ts --live --limit=25
```

Do not enable this while testing. The automated test injects a mock sender and clears both live-delivery environment variables.

## Concurrency and delivery boundary

The conditional `updateMany(status=queued -> sending)` is the database claim. Two worker processes cannot claim the same row at the same time. The included disposable-database test starts two processes and verifies one claim and one mock delivery:

```sh
node --import tsx scripts/telegram/test-outbox.ts
```

Telegram `sendMessage` has no idempotency key. As with most external message APIs, a process crash after Telegram accepts a message but before the CRM records `sent` leaves a narrow ambiguity window. To favour “no duplicates”, this worker quarantines ambiguous deliveries as `uncertain` instead of retrying. A person can compare the CRM audit with Telegram and then explicitly requeue only a confirmed missing message. Normal concurrent work is protected; automatic exactly-once delivery across a network cannot be honestly guaranteed without support from the receiving API.

`prepareTelegramCommandReply(chatId, command)` prepares a client-safe CRM answer for a future webhook. It does not poll Telegram or send messages. It exposes only the matched client's events, goals, and published materials; owner notes, payments, attention items, and other clients are excluded.
