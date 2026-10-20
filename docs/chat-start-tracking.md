# Chat-start tracking

`chat_started` means the chat API accepted a nonblank first visitor message with a session ID. A welcome-chip selection counts as a message. Opening, automatically opening, minimizing, and restoring the widget do not count. A new conversation after **End chat** counts separately.

The server inserts a SHA-256 hash of the session ID and its first-message timestamp into a Redis sorted set. `ZADD NX` makes concurrent requests and retries count once. The set has no expiry. Session deletion does not remove its entries. Production, preview, and local development use separate keys.

| Environment | Redis key |
| --- | --- |
| Production | `analytics:chat-starts:production` |
| Preview | `analytics:chat-starts:preview` |
| Local development | `analytics:chat-starts:development` |

Read the production total with `ZCARD analytics:chat-starts:production`. Read a date range with `ZCOUNT analytics:chat-starts:production <start-ms> <end-ms>`. Timestamps use Unix milliseconds. No chat text, name, email, phone, or source URL is stored in these records.

The first insertion also schedules a Vercel Analytics `chat_started` event. Its response carries `X-Chat-Started: 1`. The iframe forwards that signal to its configured parent origin. Both launchers push `{ event: "chat_started" }` to the host page's data layer. New conversations in the same browser tab are supported.

## Connect Google Analytics

In the host website's Google Tag Manager container, create a **Custom Event** trigger for `chat_started`. Create a **Google Analytics: GA4 Event** tag with event name `chat_started`. Select the Google tag for the intended GA4 property and attach that trigger. Verify the event in Tag Assistant and GA4 DebugView before publishing the container.

The data-layer event alone does not create a GA4 tag. The chatbot deployment and the GTM container publication are separate operations. The currently inspected public container is `GTM-TXZ3P499`.

The verified Criminal Defence web stream uses measurement ID `G-G2FKLXHS72`, stream ID `15323708714`, and property ID `547028679`. The prepared tag is **GA4 - Chat started**, with a **Chat started** custom-event trigger for the exact event name `chat_started`.

GTM rejected the trigger save on 20 October 2026 with HTTP 400 and `errorCode: 3`, without an explanatory message. The tag and trigger were not saved or published. The editor remains a review preview, not a completed workspace change.

The live website loads `https://aquarius-chatbot-nine.vercel.app/embed.js`. Its production Vercel project is `prj_pGC9O4sl9KcrqghtzmyGNoeg0yH0` in team `team_ss8RnktQSjAFOgEWny1K5wJ5`. The original checkout's `.vercel/project.json` points to an older project in another team. Deploy this change to the live project.

## Limits

Counting starts when this code reaches production. There is no historical backfill. Resumed conversations with more than one visitor message are excluded. A conversation restored with only one visitor message can be counted on its next continuation after deployment.

If Redis is unavailable, the chat continues and that start can be missed. If the first response is lost, the Redis total remains correct, but the host-page event can be missed. Blocked browser analytics and Vercel Analytics failures do not remove Redis records. Redis persistence and backups still determine how durable these records are.

## Implementation choices

A browser-only flag cannot prevent duplicate counts across tabs and retries. A Redis insert followed by a separate counter increment can leave the counter wrong after a partial failure. A single sorted set stores the timestamp and supplies the total atomically.

The work uses one implementation owner because the API response header, iframe bridge, and two launcher consumers share one event contract. There are no independent code workstreams. Tests cover duplicate requests, a new conversation, empty messages, Redis failure, environment separation, and trusted host-page forwarding.
