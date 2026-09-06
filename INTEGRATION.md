# Use Spatail from another app

This project is an **HTTP API** (`:8787`) plus an optional studio UI (`:5173`).
Your co-founder’s app should talk to the **API**, not import the React UI as a library.

## 1. Give him the project

- Zip this folder **or** put it on GitHub / Cursor and invite him.
- Do **not** share `data/secrets.json` (API keys). He adds his own keys (or you share keys out-of-band).

```bash
npm install
npm run dev
```

- Studio UI: http://localhost:5173  
- API base: http://localhost:8787  

Health check: `GET http://localhost:8787/api/health` → `{ "ok": true }`

CORS is already open (`cors()`), so a local web app can call the API.

## 2. Typical flow his app should call

### A. Fast path — layout + reuse library (no Meshy rebuild)

```http
POST /api/scenes
Content-Type: application/json

{ "name": "My scene", "description": "…" }
```

```http
POST /api/scenes/:id/layout-from-image
Content-Type: multipart/form-data

image=<png/jpg of the approved rendering>
```

Response is a full scene JSON: objects with `transform`, `glbUrl` (when a library asset matched), statuses.

### B. Full path — concepts → approve → build missing 3D

1. `POST /api/scenes`
2. `POST /api/scenes/:id/concepts/generate` (needs OpenAI key on server)
3. `POST /api/scenes/:id/concepts/:conceptId/approve` (reuses library; Meshy only for missing)
4. Poll `GET /api/scenes/:id` until `progress.active === 0`
5. Read each object’s `glbUrl` and `transform`

### C. Pull finished assets

```http
GET /api/library
GET /api/library/:assetId
```

GLB files are served under `/files/...` (paths appear as `glbUrl` on scene objects / library entries).

## 3. Minimal client (Node / browser)

See `examples/integrate.mjs`. Run against a live server:

```bash
node examples/integrate.mjs path/to/rendering.png
```

## 4. Embed the studio UI (optional)

If he just needs the tool as a panel:

```html
<iframe src="http://localhost:5173" style="width:100%;height:100%;border:0"></iframe>
```

For production, host the built web + API on a shared machine/URL and point the iframe / `API_BASE` there.

## 5. Keys

```http
POST /api/settings
{ "openaiApiKey": "…", "meshyApiKey": "…" }
```

Keys stay on the **server** in `data/secrets.json` (gitignored).

## 6. What to hand him

| Item | Why |
|------|-----|
| This repo / zip | Run API + studio |
| OpenAI + Meshy keys (or ask him to add his) | Generation |
| Example: `examples/integrate.mjs` | Copy into his app |
| This file | Contract for API calls |
