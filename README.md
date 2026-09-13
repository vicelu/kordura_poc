# Kordura — grid interface (POC)

Web interface for the Kordura sensor grid in Župski zaljev (activity 1.7 in `project.md`): grid overview, per-node detail with historical charts, and an alert workflow that feeds lab verdicts back into model evaluation.

All data is **simulated** by a physically based model of the pilot site (see `server/sim/`), so the interface can be developed before hardware is in the water.

## Run

Requires Node 20+.

```sh
npm install
npm run dev        # API on :8787, web on http://localhost:5173
```

Production build, served by the API process:

```sh
npm run build
npm start          # http://localhost:8787
```

Static demo (no server; the simulation runs in the browser, routes use `#/…`):

```sh
npm run build:demo # set BASE_PATH=/repo-name/ when hosting under a sub-path
```

Pushing to `main` deploys this build to GitHub Pages via `.github/workflows/pages.yml` (enable it under Settings → Pages → Source: GitHub Actions). In the demo, alert acknowledgements and verdicts are kept per browser tab.

## What's inside

| Path | Contents |
| --- | --- |
| `shared/types.ts` | API contract shared by server and web |
| `server/sim/site.ts` | Nodes, landmarks and the scenario (rain, bura/jugo, contamination episodes, maintenance, outages) |
| `server/sim/environment.ts` | Rain, wind, tide, solar and Zavrelje hydro-plant schedule on a 5-minute grid |
| `server/sim/generate.ts` | Per-node water properties (mixing of marine, karst-freshwater and runoff end-members, organic load, biofouling drift), adaptive 15/5-min sampling, LoRa packet loss, power budget |
| `server/sim/seawater.ts` | PSS-78 salinity ↔ conductivity, O₂ solubility |
| `server/sim/detect.ts` | Self-gating robust baselines, multi-parameter signatures, risk index, alerts |
| `server/sim/lab.ts` | Reference, orientation and official (IZOR-style) samples, assessed against NN 73/08 limits |
| `server/store.ts` | In-memory dataset and all queries; data is only visible up to the wall clock |
| `web/src/pages` | Overview, node detail, alerts |

## API

`GET /api/grid` · `GET /api/nodes/:id?from&to` · `GET /api/nodes/:id/lab` · `GET /api/nodes/:id/ts?days` · `GET /api/nodes/:id/export.csv?from&to&params` · `GET /api/environment?from&to` · `GET /api/compare?param&from&to` · `GET /api/alerts` · `POST /api/alerts/:id/ack` · `POST /api/alerts/:id/verdict`

Alert acknowledgements and verdicts are kept in memory and reset when the server restarts. To connect real nodes, replace `Store`'s dataset with an ingest-backed store that keeps the same response shapes.
