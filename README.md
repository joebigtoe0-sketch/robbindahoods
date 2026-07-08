# Robbin da Hood

Rob the rich · grow the green · feed the hood. Isometric browser game with accounts, cloud saves and a global leaderboard.

No token gate. Register with username + password, log in, play. Optionally add a wallet address in Profile — it shows next to your name on the leaderboard.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

The SQLite database is created automatically at `data/robhood.db` (override with `DATABASE_PATH`).

## Deploy to Railway

1. Push this folder to a GitHub repo (or `railway init` inside it).
2. Create a Railway service from the repo — the `Dockerfile` + `railway.toml` are picked up automatically.
3. Add a **volume** mounted at `/data` (that's where the SQLite db lives — without it, accounts reset on redeploy).
4. Railway injects `PORT` automatically. No other env vars needed.

Any other Docker host works the same way: build the image, mount a volume at `/data`, expose the port.

## Game tuning

All balance knobs live at the top of [public/game.js](public/game.js):

| Knob | Value |
|---|---|
| Cycle length | 60 min |
| Grow time per pot | 8 min |
| House price | 2,500g |
| House upgrades (lv 2→5) | 4k / 10k / 22k / 45k g |
| Seed cost | 60g |
| Cycle reward | 1g per point |
| Street pickups | max 2 on map, 8 min respawn, low-value items only |
| Item drop chance | 4% mug / 8% heist |

## API

- `POST /api/register`, `POST /api/login`, `POST /api/logout` — session token auth
- `GET/POST /api/wallet` — profile wallet address
- `GET/PUT /api/state` — cloud save
- `POST /api/provide`, `POST /api/cycle` — scoring
- `GET /api/leaderboard` — top 50 by all-time hood points (username + wallet shown)
