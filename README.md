# Spatial Content Generator (Spatail)

Local studio for designing tabletop spatial experiences: OpenAI concepts → approve → auto isolate objects → Meshy 3D → asset library.

## Quick start

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

Open **Keys** in the status bar and paste your OpenAI and Meshy API keys (stored server-side in `data/secrets.json`, gitignored).

## Share with a co-founder / use in another app

See **[INTEGRATION.md](./INTEGRATION.md)** — run this as a service and call the HTTP API (or iframe the studio). Example client: `examples/integrate.mjs`.

## Milestone path

1. Load the Newton sample brief + round coffee-table stage (cylinder height cage).
2. **Generate 3 concepts** (OpenAI). Optionally **Provide my own rendering**.
3. **Approve & place** — reuses library assets; Meshy only builds what’s missing.
4. Watch the progress panel in the viewport while assets build.
5. Assets appear in Library; reuse on a new scene without regenerating.

## Scripts

- `npm run dev` — server + web
- `npm test` — job fingerprint / mutex tests (no paid APIs)
- `npm run build` — production build
