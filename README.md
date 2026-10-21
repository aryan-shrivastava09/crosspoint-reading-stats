# CrossPoint Reading Stats

On-device reading statistics for CrossPoint 2.0 using the stock SD-card plugin API and a free Cloudflare Workers backend.

## What it tracks
- Active reading time (today / week / lifetime)
- Session count and average session length
- 7-day activity bars
- Reading streak
- Per-book progress and reading time

CrossPoint emits `reader.session` summaries. The plugin POSTs those summaries to the Worker and opens the Worker's compact catalog on the reader under **Home → Plugins → Reading Stats**.

## Architecture
`Xteink X3 → reader.session → Cloudflare Worker → D1 database → on-device catalog`

## Install
1. Deploy the Worker and create/bind a D1 database as described below.
2. Copy `plugin/reading-stats` to `/plugins/reading-stats` on the X3 SD card.
3. Edit `plugin/reading-stats/config.json` and set `server` to your Worker URL and `device_key` to a long private random string.
4. On CrossPoint enable **Settings → Connectivity → Plugins**.
5. Restart the X3. Event subscriptions are rebuilt at boot.
6. Open **Home → Plugins → Reading Stats**.

## Cloudflare setup
Install Wrangler, authenticate, then from `worker/` create a D1 database named `crosspoint-reading-stats`. Put its database id into `wrangler.toml`, apply `schema.sql`, and deploy.

```bash
npm install
npx wrangler login
npx wrangler d1 create crosspoint-reading-stats
# paste database_id into wrangler.toml
npx wrangler d1 execute crosspoint-reading-stats --remote --file=schema.sql
npx wrangler deploy
```

Cloudflare will print your permanent `https://...workers.dev` URL. Put that URL in the plugin's `config.json`.

## Privacy
The backend stores the SD book path, document hash, active session timestamps/duration and progress. The `device_key` partitions your data and acts as a simple bearer secret. Use a long unguessable value and do not publish your filled-in `config.json`.

## CrossPoint behaviour
`reader.session` counts successful ordinary forward turns only. A displayed page contributes after 2 seconds and each dwell is capped at 30 minutes. Sessions require at least 10 active seconds. Delivery is at-least-once, so the Worker deduplicates on CrossPoint's event id. With `connect: true`, queued sessions can be delivered during sleep entry when battery/network conditions permit.
