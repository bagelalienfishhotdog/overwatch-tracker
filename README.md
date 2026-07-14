# OVERWATCH — Dynmap Player Tracker

A self-hosted tracking dashboard that polls a Dynmap `/up/world/<world>/` feed,
logs every player position to SQLite, and visualizes it on a tactical,
GEOINT-styled live map: heat map, movement trails, per-player stats, search,
time filters, and CSV/JSON export.

## Stack
Node.js + Express · SQLite (Node's built-in `node:sqlite`, no native build step) · Leaflet + Leaflet.heat · Axios · Socket.IO

> **Requires Node 22.5+** for the built-in SQLite module. Check with `node -v`;
> if you're below 22.5, update Node first (nodejs.org). This avoids the
> `better-sqlite3` native-compile step entirely, so no Visual Studio Build
> Tools / node-gyp are needed on Windows.

## Setup

```bash
npm install
cp .env.example .env      # on Windows cmd.exe, use: copy .env.example .env
# edit .env — set DYNMAP_URL to your server's Dynmap "up" endpoint
npm start
```

Then open **http://localhost:3000**.

## Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `DYNMAP_URL` | The Dynmap `up` feed to poll, e.g. `https://map.heartsofminecraft.net/up/world/earth/` | — |
| `POLL_INTERVAL_MS` | How often to poll | `3000` |
| `OFFLINE_AFTER_MISSED_POLLS` | Consecutive missed polls before a player is marked offline / session closed | `3` |
| `PORT` | Web server port | `3000` |
| `DB_PATH` | SQLite file location | `./db/tracker.db` |

## How it works

- **`tracker.js`** polls `DYNMAP_URL` on an interval, writes a `positions` row per
  online player per poll, upserts the `players` table, and opens/closes
  `sessions` rows to track visits and time online. It also emits a
  `players:update` Socket.IO event with the live snapshot.
- **`routes/api.js`** exposes REST endpoints for the frontend (see below).
- **`public/`** is the dashboard: Leaflet map in `CRS.Simple` mode (world
  `x`/`z` mapped directly to the plane — this is a Minecraft coordinate plane,
  not a lat/lng basemap, so it renders a tactical coordinate grid rather than
  Dynmap tile imagery). Live positions arrive over Socket.IO; heat map and
  trails are pulled from the REST API on a timer / on selection.

## REST API

| Endpoint | Description |
|---|---|
| `GET /api/players/live` | Players currently online, with last known position |
| `GET /api/players` | Every player ever tracked |
| `GET /api/players/search?q=` | Search by account/display name |
| `GET /api/players/:account/history?start&end` | Raw position history (ms epoch range) |
| `GET /api/players/:account/stats?start&end` | Distance traveled, time online, visit count |
| `GET /api/stats/overview` | Global counts (tracked, online, total fixes logged) |
| `GET /api/heatmap?start&end&world&account` | Point list for the heat map layer |
| `GET /api/export/csv?start&end&account` | CSV download of raw positions |
| `GET /api/export/json?start&end&account` | JSON download of raw positions |

## Notes / extending it

- **Real Dynmap terrain tiles**: the dashboard now overlays actual Dynmap
  tile imagery under the markers. It fetches your server's `/up/configuration`
  (server-side, via `/api/mapconfig`, to dodge CORS) to find the world's map
  name/prefix/image format, then requests tiles using Dynmap's standard
  128px-tile / `"z"`-prefixed zoom-out naming scheme. The one thing that
  varies between servers is **pixels-per-block** (Dynmap presets: 1, 2, 4, or
  16). It defaults to 2 (Dynmap's classic "flat/day" default) — if tiles
  come in blank or don't line up with player markers, use the **Tile scale**
  dropdown in the Layers panel to try the other presets. If none of them
  line up, open your browser's dev tools → Network tab on the live Dynmap
  page, filter for an image request under `/tiles/`, and send me that URL —
  I can hard-code the exact scheme from a real example instead of a preset.
- **Multiple worlds**: the schema already stores `world` per position; the
  `/api/heatmap` and export endpoints accept a `world` filter if your server
  tracks more than one map.
- **Distance stat**: `distance_blocks_2d` sums `x`/`z` movement between
  consecutive logged fixes (ignores vertical movement); `distance_blocks_3d`
  is also computed and available in the stats payload if you want to surface it.
