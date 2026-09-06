import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Viewport } from "./Viewport";
import { exportScenePackage } from "./export";

export function App() {
  const boot = useStore((s) => s.boot);
  const scene = useStore((s) => s.scene);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const busy = useStore((s) => s.busy);
  const error = useStore((s) => s.error);
  const settings = useStore((s) => s.settings);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const setSelectedObject = useStore((s) => s.setSelectedObject);
  const hiddenObjectIds = useStore((s) => s.hiddenObjectIds);
  const toggleObjectVisible = useStore((s) => s.toggleObjectVisible);
  const setAllObjectsVisible = useStore((s) => s.setAllObjectsVisible);
  const captureRef = useRef<(() => Promise<Blob | null>) | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!scene) {
    return (
      <div className="boot-screen">
        <img src="/spatail-mark.png" alt="Spatail" />
        <p>{busy || "Loading studio…"}</p>
        {error ? <p className="err">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <aside className="rail">
        <h2>Workflow</h2>
        <Step n={1} id="brief" label="Brief & stage" blurb="Description + table volume" />
        <Step n={2} id="concepts" label="Concepts" blurb="OpenAI or your rendering" />
        <Step n={3} id="assemble" label="Assemble" blurb="Named objects + Meshy" />
        <Step n={4} id="library" label="Library" blurb="Browse, reuse, download" />
        <h2 style={{ marginTop: 18 }}>Scene graph</h2>
        {scene.objects.length > 0 ? (
          <div className="actions" style={{ marginTop: 6, marginBottom: 4 }}>
            <button type="button" className="btn" onClick={() => setAllObjectsVisible(true)}>
              Show all
            </button>
            <button type="button" className="btn" onClick={() => setAllObjectsVisible(false)}>
              Hide all
            </button>
          </div>
        ) : null}
        <ul className="obj-list">
          {scene.objects.length === 0 ? (
            <li style={{ color: "var(--mute)" }}>Approve a concept to populate</li>
          ) : (
            scene.objects.map((o) => {
              const hidden = hiddenObjectIds.includes(o.id);
              return (
                <li key={o.id} className={hidden ? "hidden-obj" : ""}>
                  <button
                    type="button"
                    className="vis-toggle"
                    title={hidden ? "Show" : "Hide"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleObjectVisible(o.id);
                    }}
                  >
                    {hidden ? "○" : "●"}
                  </button>
                  <button
                    type="button"
                    className={`sel-obj ${selectedObjectId === o.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedObject(o.id);
                      setTab("assemble");
                    }}
                  >
                    {o.name}
                  </button>
                  <span className={`st ${o.status}`}>{o.status}</span>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <main className="stage">
        <div className="stage-overlay">
          <span className="badge">
            {scene.stage.shape === "circle" ? "Round table" : "Stage"}{" "}
            {scene.stage.size.width.toFixed(2)}
            {scene.stage.shape === "circle"
              ? "m ⌀"
              : `×${scene.stage.size.depth.toFixed(2)}m`}{" "}
            · {scene.stage.size.height.toFixed(2)}m tall
          </span>
          {!scene.approvedConceptId ? (
            <span className="badge mock">Meshy gated until approve</span>
          ) : scene.progress && scene.progress.active > 0 ? (
            <span className="badge mock">{scene.progress.label}</span>
          ) : (
            <span className="badge pass">Concept approved</span>
          )}
        </div>
        {scene.progress && (scene.progress.active > 0 || scene.progress.total > 0) ? (
          <div className="progress-panel">
            <h3>Build progress</h3>
            <div className="progress-bar">
              <span style={{ width: `${scene.progress.percent}%` }} />
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-dim)" }}>
              {scene.progress.label ||
                `${scene.progress.ready}/${scene.progress.total} ready`}
              {scene.progress.active > 0 ? " — working, not stuck" : ""}
            </p>
            <ul>
              {scene.objects
                .filter((o) => o.role !== "foundation" && o.status !== "procedural")
                .map((o) => (
                  <li key={o.id}>
                    <span>{o.name}</span>
                    <span
                      className={
                        o.status === "ready"
                          ? "ok"
                          : o.status === "failed"
                            ? "bad"
                            : "spin"
                      }
                    >
                      {o.status}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <Viewport
          scene={scene}
          selectedObjectId={selectedObjectId}
          hiddenObjectIds={new Set(hiddenObjectIds)}
          onSelect={setSelectedObject}
          captureRef={captureRef}
        />
      </main>

      <aside className="side">
        {tab === "brief" && <BriefPanel captureRef={captureRef} />}
        {tab === "concepts" && <ConceptsPanel captureRef={captureRef} />}
        {tab === "assemble" && <AssemblePanel />}
        {tab === "library" && <LibraryPanel />}
      </aside>

      <footer className="status">
        <span>{settings?.openaiConfigured ? `OpenAI ${settings.openaiHint}` : "OpenAI missing"}</span>
        <span>·</span>
        <span>{settings?.meshyConfigured ? `Meshy ${settings.meshyHint}` : "Meshy missing"}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {busy ? <span className="busy">{busy}</span> : null}
        {error ? <span className="err">{error}</span> : null}
        <button type="button" className="btn-ghost" onClick={() => setShowSettings(true)}>
          Keys
        </button>
      </footer>

      {showSettings ? <SettingsModal /> : null}
    </div>
  );
}

function Step({
  n,
  id,
  label,
  blurb,
}: {
  n: number;
  id: "brief" | "concepts" | "assemble" | "library";
  label: string;
  blurb: string;
}) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  return (
    <button type="button" className={`step ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
      <span className="num">{n}</span>
      <span>
        {label}
        <small>{blurb}</small>
      </span>
    </button>
  );
}

function TopBar() {
  const scene = useStore((s) => s.scene)!;
  const setName = useStore((s) => s.setName);
  const newScene = useStore((s) => s.newScene);
  const busy = useStore((s) => s.busy);

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src="/spatail-mark.png" alt="Spatail" />
        <div className="brand-copy">
          <strong>Spatail</strong>
          <span>Content generator</span>
        </div>
      </div>
      <input
        className="project-name"
        value={scene.name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Scene name"
      />
      <div className="spacer" />
      <button type="button" className="btn" disabled={!!busy} onClick={() => newScene()}>
        New scene
      </button>
      <button
        type="button"
        className="btn-apple"
        onClick={() => exportScenePackage(scene)}
      >
        Export GLB + layout
      </button>
    </header>
  );
}

function BriefPanel({
  captureRef,
}: {
  captureRef: React.MutableRefObject<(() => Promise<Blob | null>) | null>;
}) {
  const scene = useStore((s) => s.scene)!;
  const setDescription = useStore((s) => s.setDescription);
  const patchStage = useStore((s) => s.patchStage);
  const saveBrief = useStore((s) => s.saveBrief);
  const generateConcepts = useStore((s) => s.generateConcepts);
  const busy = useStore((s) => s.busy);

  return (
    <>
      <h2>Brief & stage</h2>
      <div className="field">
        <label>Experience description</label>
        <textarea
          value={scene.description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Stage name</label>
        <input
          value={scene.stage.name}
          onChange={(e) => patchStage({ name: e.target.value })}
        />
      </div>
      <div className="row3">
        <div className="field">
          <label>Table diameter (m)</label>
          <input
            type="number"
            step="0.01"
            value={scene.stage.size.width}
            onChange={(e) =>
              patchStage({
                shape: "circle",
                size: {
                  ...scene.stage.size,
                  width: Number(e.target.value),
                  depth: Number(e.target.value),
                },
              })
            }
          />
        </div>
        <div className="field">
          <label>Allowed height (m)</label>
          <input
            type="number"
            step="0.01"
            value={scene.stage.size.height}
            onChange={(e) =>
              patchStage({
                size: { ...scene.stage.size, height: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className="field">
          <label>Table height (m)</label>
          <input
            type="number"
            step="0.01"
            value={scene.stage.tableHeight}
            onChange={(e) => patchStage({ tableHeight: Number(e.target.value) })}
          />
        </div>
      </div>
      <p style={{ color: "var(--mute)", fontSize: 12 }}>
        Placeholder stage is a round coffee table. The translucent cylinder is allowed content height.
        Grass is fitted to the disk (procedural — not Meshy). After you approve a concept, all objects
        isolate and Meshy automatically — watch the progress panel.
      </p>
      <div className="actions">
        <button type="button" className="btn" disabled={!!busy} onClick={() => saveBrief()}>
          Save
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!!busy}
          onClick={async () => {
            await saveBrief();
            const blob = captureRef.current ? await captureRef.current() : null;
            await generateConcepts(blob);
          }}
        >
          Generate 3 concepts
        </button>
      </div>
    </>
  );
}

function ConceptsPanel({
  captureRef,
}: {
  captureRef: React.MutableRefObject<(() => Promise<Blob | null>) | null>;
}) {
  const scene = useStore((s) => s.scene)!;
  const selectedConceptId = useStore((s) => s.selectedConceptId);
  const setSelectedConcept = useStore((s) => s.setSelectedConcept);
  const regenerate = useStore((s) => s.regenerate);
  const refine = useStore((s) => s.refine);
  const refineText = useStore((s) => s.refineText);
  const setRefineText = useStore((s) => s.setRefineText);
  const approve = useStore((s) => s.approve);
  const uploadRendering = useStore((s) => s.uploadRendering);
  const generateConcepts = useStore((s) => s.generateConcepts);
  const busy = useStore((s) => s.busy);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = scene.concepts.find((c) => c.id === selectedConceptId) ?? scene.concepts[0];

  return (
    <>
      <h2>Concepts</h2>
      <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={async () => {
            const blob = captureRef.current ? await captureRef.current() : null;
            await generateConcepts(blob);
          }}
        >
          Generate / refresh 3
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
        >
          Provide my own rendering
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadRendering(f);
          }}
        />
      </div>

      <div className="concepts">
        {scene.concepts.length === 0 ? (
          <p style={{ color: "var(--mute)" }}>
            No concepts yet. Generate three with OpenAI, or upload your own rendering.
          </p>
        ) : (
          scene.concepts.map((c) => (
            <div
              key={c.id}
              className={`concept-card ${selected?.id === c.id ? "sel" : ""}`}
              onClick={() => setSelectedConcept(c.id)}
              onKeyDown={() => undefined}
              role="button"
              tabIndex={0}
            >
              {c.imageUrl ? <img src={c.imageUrl} alt={c.title} /> : <div style={{ height: 120 }} />}
              <div className="meta">
                <span className={`tag ${c.source === "user" ? "yours" : ""}`}>
                  {c.source === "user" ? "Yours" : "OpenAI"}
                </span>
                <h3>{c.title}</h3>
                <p>{c.summary}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {selected ? (
        <>
          <h2 style={{ marginTop: 16 }}>Selected</h2>
          <p style={{ color: "var(--text-dim)", marginTop: 0 }}>{selected.title}</p>
          <ul className="obj-list">
            {selected.objects.map((o, i) => (
              <li key={`${o.name}-${i}`}>
                <span>
                  {o.name}
                  {o.procedural || o.role === "foundation" ? " · procedural" : ""}
                </span>
                <span className="st">{o.role}</span>
              </li>
            ))}
          </ul>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Refine instruction</label>
            <input
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="e.g. warmer evening light, denser foliage"
            />
          </div>
          <div className="actions">
            {selected.source !== "user" ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() => refine(selected.id)}
                >
                  Refine
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() => regenerate(selected.id)}
                >
                  Regenerate
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn-apple"
              disabled={!!busy}
              onClick={() => approve(selected.id)}
            >
              Approve & place
            </button>
          </div>
          <p style={{ color: "var(--mute)", fontSize: 11, marginTop: 10 }}>
            Approving measures layout from the image and reuses matching library assets.
            Meshy only builds objects that are not already in the library. Or use Assemble →
            Import layout image to place without rebuilding.
          </p>
        </>
      ) : null}
    </>
  );
}

function AssemblePanel() {
  const scene = useStore((s) => s.scene)!;
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const setSelectedObject = useStore((s) => s.setSelectedObject);
  const generateObject = useStore((s) => s.generateObject);
  const relayout = useStore((s) => s.relayout);
  const importLayoutImage = useStore((s) => s.importLayoutImage);
  const toggleObjectVisible = useStore((s) => s.toggleObjectVisible);
  const hiddenObjectIds = useStore((s) => s.hiddenObjectIds);
  const busy = useStore((s) => s.busy);
  const selected = scene.objects.find((o) => o.id === selectedObjectId);
  const approvedImage =
    scene.concepts.find((c) => c.id === scene.approvedConceptId)?.imageUrl ?? null;
  const layoutFileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <h2>Assemble</h2>
      <p style={{ color: "var(--mute)" }}>
        Import your rendering to place existing library assets on the table — no rebuild.
        Only objects missing from the library need Meshy.
      </p>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn-apple"
          disabled={!!busy}
          onClick={() => layoutFileRef.current?.click()}
        >
          Import layout image (reuse library)
        </button>
        <input
          ref={layoutFileRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importLayoutImage(f);
            e.target.value = "";
          }}
        />
        {scene.approvedConceptId ? (
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => relayout()}
          >
            Re-measure & rescale
          </button>
        ) : null}
      </div>
      {approvedImage ? (
        <div style={{ marginBottom: 12 }}>
          <img
            src={approvedImage}
            alt="Layout reference"
            style={{
              width: "100%",
              maxHeight: 140,
              objectFit: "cover",
              border: "1px solid var(--line)",
            }}
          />
        </div>
      ) : null}
      {scene.progress ? (
        <p style={{ color: "var(--text-dim)" }}>
          {scene.progress.label ||
            `${scene.progress.ready}/${scene.progress.total} ready`}{" "}
          ({scene.progress.percent}%)
        </p>
      ) : null}
      <ul className="obj-list">
        {scene.objects.map((o) => {
          const hidden = hiddenObjectIds.includes(o.id);
          return (
            <li key={o.id} className={hidden ? "hidden-obj" : ""}>
              <button
                type="button"
                className="vis-toggle"
                title={hidden ? "Show in viewport" : "Hide in viewport"}
                onClick={() => toggleObjectVisible(o.id)}
              >
                {hidden ? "○" : "●"}
              </button>
              <button
                type="button"
                className={`sel-obj ${selectedObjectId === o.id ? "active" : ""}`}
                onClick={() => setSelectedObject(o.id)}
              >
                {o.name}
              </button>
              <span className={`st ${o.status}`}>{o.status}</span>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => toggleObjectVisible(selected.id)}
          >
            {hiddenObjectIds.includes(selected.id) ? "Show object" : "Hide object"}
          </button>
          {selected.status === "procedural" || selected.role === "foundation" ? (
            <span className="badge pass">Procedural · not Meshy</span>
          ) : selected.glbUrl ? (
            <span className="badge pass">Library / ready</span>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={!!busy || !scene.approvedConceptId}
              onClick={() => generateObject(selected.id)}
            >
              Build this one with Meshy
            </button>
          )}
          {selected.glbUrl ? (
            <a className="btn" href={selected.glbUrl} download>
              Download GLB
            </a>
          ) : null}
        </div>
      ) : null}
      {scene.styleFamily ? (
        <div style={{ marginTop: 16 }}>
          <h2>Style family</h2>
          <p style={{ margin: 0 }}>{scene.styleFamily.name}</p>
          <p style={{ color: "var(--mute)", fontSize: 12 }}>{scene.styleFamily.artDirection}</p>
        </div>
      ) : null}
    </>
  );
}

function LibraryPanel() {
  const library = useStore((s) => s.library);
  const libraryQuery = useStore((s) => s.libraryQuery);
  const setLibraryQuery = useStore((s) => s.setLibraryQuery);
  const refreshLibrary = useStore((s) => s.refreshLibrary);
  const placeFromLibrary = useStore((s) => s.placeFromLibrary);
  const busy = useStore((s) => s.busy);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    void refreshLibrary();
  }, [libraryQuery, refreshLibrary]);

  return (
    <>
      <h2>Asset library</h2>
      <div className="field">
        <label>Search</label>
        <input
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          placeholder="tree, newton…"
        />
      </div>
      <div className="library-grid">
        {library.length === 0 ? (
          <p style={{ color: "var(--mute)" }}>No assets yet. Generate one after approval.</p>
        ) : (
          library.map((a) => (
            <div key={a.id} className="lib-card">
              {a.thumbnailUrl || a.referenceImageUrl ? (
                <img
                  src={a.thumbnailUrl || a.referenceImageUrl || ""}
                  alt={a.name}
                  onClick={() => setPreview(a.referenceImageUrl || a.thumbnailUrl)}
                />
              ) : (
                <div />
              )}
              <div>
                <h3>{a.name}</h3>
                <p>
                  v{a.currentVersion} · {a.styleFamilyId}
                </p>
                <div className="actions" style={{ marginTop: 0 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busy}
                    onClick={() => placeFromLibrary(a.id)}
                  >
                    Reuse in scene
                  </button>
                  {a.glbUrl ? (
                    <a className="btn" href={a.glbUrl} download={`${a.name}.glb`}>
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {preview ? (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <img src={preview} alt="preview" style={{ width: "100%" }} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function SettingsModal() {
  const settings = useStore((s) => s.settings);
  const saveKeys = useStore((s) => s.saveKeys);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const [openai, setOpenai] = useState("");
  const [meshy, setMeshy] = useState("");

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>API keys</h2>
        <p>
          Keys stay on the server in <code>data/secrets.json</code>. OpenAI handles planning +
          images; Meshy builds 3D after approve.
        </p>
        <div className="field">
          <label>
            OpenAI {settings?.openaiConfigured ? `(set ${settings.openaiHint})` : "(required)"}
          </label>
          <input
            type="password"
            value={openai}
            onChange={(e) => setOpenai(e.target.value)}
            placeholder="Paste OpenAI API key"
          />
        </div>
        <div className="field">
          <label>
            Meshy {settings?.meshyConfigured ? `(set ${settings.meshyHint})` : "(3D after approve)"}
          </label>
          <input
            type="password"
            value={meshy}
            onChange={(e) => setMeshy(e.target.value)}
            placeholder="Paste Meshy API key"
          />
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => saveKeys(openai || undefined, meshy || undefined)}
          >
            Save
          </button>
          <button type="button" className="btn" onClick={() => setShowSettings(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
