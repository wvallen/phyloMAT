// phyloMAT v1 engine
// Local-first: loads atlas.xml, renders to canvas, exports state.xml + prompt.txt + PNG.

const canvas = document.getElementById("atlas");
const ctx = canvas.getContext("2d");

const ui = {
  statNodes: document.getElementById("statNodes"),
  statEdges: document.getElementById("statEdges"),
  statClouds: document.getElementById("statClouds"),
  hoverLabel: document.getElementById("hoverLabel"),
  selLabel: document.getElementById("selLabel"),
  pinList: document.getElementById("pinList"),
  btnReset: document.getElementById("btnReset"),
  btnExportPNG: document.getElementById("btnExportPNG"),
  btnExportState: document.getElementById("btnExportState"),
  btnExportPrompt: document.getElementById("btnExportPrompt"),
};

const state = {
  camera: { x: 520, y: 330, zoom: 1.0 },
  drag: { active: false, sx: 0, sy: 0, cx: 0, cy: 0 },
  hoverId: null,
  selectedId: null,
  pinned: new Set(),
  layers: { clouds: true, edges: true, labels: true },
  focusNote: "Expand atlas around current pinned region."
};

let atlas = {
  nodes: new Map(),
  edges: [],
  clouds: [],
};

let anim = {
  t0: performance.now(),
  lock: 0.0, // 0 -> flowing, 1 -> locked
};

function download(filename, text) {
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function worldToScreen(wx, wy) {
  const { x, y, zoom } = state.camera;
  const sx = (wx - x) * zoom + canvas.width / 2;
  const sy = (wy - y) * zoom + canvas.height / 2;
  return { x: sx, y: sy };
}

function screenToWorld(sx, sy) {
  const { x, y, zoom } = state.camera;
  const wx = (sx - canvas.width / 2) / zoom + x;
  const wy = (sy - canvas.height / 2) / zoom + y;
  return { x: wx, y: wy };
}

function nodeRadius(n) {
  // Base size by tier + fog
  const tier = parseInt(n.tier || "3", 10);
  const base = tier === 1 ? 11 : tier === 2 ? 8 : 6;
  const fog = parseFloat(n.fog || "0.3");
  return base + fog * 6;
}

function confidenceAlpha(conf) {
  if (conf === "high") return 1.0;
  if (conf === "medium") return 0.85;
  return 0.7;
}

function parseAtlasXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const cloudEls = [...doc.querySelectorAll("clouds cloud")];
  const nodeEls = [...doc.querySelectorAll("nodes node")];
  const edgeEls = [...doc.querySelectorAll("edges edge")];

  const clouds = cloudEls.map(el => ({
    id: el.getAttribute("id"),
    label: el.getAttribute("label") || "",
    strength: parseFloat(el.getAttribute("strength") || "0.7"),
    x: parseFloat(el.getAttribute("x") || "0"),
    y: parseFloat(el.getAttribute("y") || "0"),
    r: parseFloat(el.getAttribute("r") || "200"),
    drift: parseFloat(el.getAttribute("drift") || "0.1"),
  }));

  const nodes = new Map();
  for (const el of nodeEls) {
    const n = {
      id: el.getAttribute("id"),
      label: el.getAttribute("label") || el.getAttribute("id"),
      kind: el.getAttribute("kind") || "taxon",
      confidence: el.getAttribute("confidence") || "medium",
      fog: el.getAttribute("fog") || "0.3",
      x: parseFloat(el.getAttribute("x") || "0"),
      y: parseFloat(el.getAttribute("y") || "0"),
      tier: el.getAttribute("tier") || "3",
      placement: el.getAttribute("placement") || "",
      // runtime fields
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
    };
    n.tx = n.x;
    n.ty = n.y;
    nodes.set(n.id, n);
  }

  const edges = edgeEls.map(el => ({
    from: el.getAttribute("from"),
    to: el.getAttribute("to"),
    type: el.getAttribute("type") || "taxonomy",
    w: parseFloat(el.getAttribute("w") || "0.6"),
  }));

  return { nodes, edges, clouds };
}

function setStats() {
  ui.statNodes.textContent = String(atlas.nodes.size);
  ui.statEdges.textContent = String(atlas.edges.length);
  ui.statClouds.textContent = String(atlas.clouds.length);
}

function resetView() {
  state.camera = { x: 520, y: 330, zoom: 0.9 };
  anim.lock = 0.0;
}

function exportPNG() {
  const link = document.createElement("a");
  link.download = "phylomat_view.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function exportStateXML() {
  const pinned = [...state.pinned].join(",");
  const xml =
`<phyloMATState version="1.0">
  <camera x="${state.camera.x.toFixed(3)}" y="${state.camera.y.toFixed(3)}" zoom="${state.camera.zoom.toFixed(5)}" />
  <selection selected="${state.selectedId || ""}" hover="${state.hoverId || ""}" />
  <pinned>${pinned}</pinned>
  <layers clouds="${state.layers.clouds}" edges="${state.layers.edges}" labels="${state.layers.labels}" />
  <note>${escapeXML(state.focusNote)}</note>
</phyloMATState>`;
  download("state.xml", xml);
}

function escapeXML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function localSliceXML() {
  // Minimal local excerpt around pinned + selected
  const ids = new Set(state.pinned);
  if (state.selectedId) ids.add(state.selectedId);
  if (ids.size === 0) {
    // fallback: include tier 1 + plates
    ["bacteria","archaea","eukaryota","sar","opisthokonta","archaeplastida"].forEach(id => ids.add(id));
  }

  // add neighbors (one-hop) to help LLM
  for (const e of atlas.edges) {
    if (ids.has(e.from)) ids.add(e.to);
    if (ids.has(e.to)) ids.add(e.from);
  }

  const nodes = [...ids].map(id => atlas.nodes.get(id)).filter(Boolean);
  const edges = atlas.edges.filter(e => ids.has(e.from) && ids.has(e.to));

  const nodeXML = nodes.map(n =>
    `  <node id="${n.id}" label="${escapeXML(n.label)}" kind="${n.kind}" confidence="${n.confidence}" fog="${n.fog}" x="${n.x.toFixed(2)}" y="${n.y.toFixed(2)}" />`
  ).join("\n");

  const edgeXML = edges.map(e =>
    `  <edge from="${e.from}" to="${e.to}" type="${e.type}" w="${e.w.toFixed(2)}" />`
  ).join("\n");

  return `<localContext>
<focusNote>${escapeXML(state.focusNote)}</focusNote>
<pinned>${escapeXML([...state.pinned].join(","))}</pinned>
<nodes>
${nodeXML}
</nodes>
<edges>
${edgeXML}
</edges>
</localContext>`;
}

function exportPromptTXT() {
  const ctxXML = localSliceXML();

  const prompt =
`phyloMAT atlas expansion

Context:
Causal taxonomy atlas organized by constraint and adjacency.
Time implicit.
Uncertainty as fog.

Task:
Extend the atlas near the focus region using the local context.
Propose additional taxa or grouping nodes and minimal edges.

Rules:
- keep time implicit
- prefer higher taxonomic levels when resolution is uncertain
- express uncertainty using confidence and fog radius (fog attribute)
- keep labels concise and technical
- output XML only

Output:
Return <patch> containing <node> and <edge> additions.
Coordinates are optional.

LOCAL CONTEXT:
${ctxXML}
`;

  download("prompt.txt", prompt);
}

function pickNodeAtScreen(sx, sy) {
  const w = screenToWorld(sx, sy);

  let best = null;
  let bestD = Infinity;

  for (const n of atlas.nodes.values()) {
    const dx = w.x - n.x;
    const dy = w.y - n.y;
    const r = nodeRadius(n) / state.camera.zoom; // world-space approx
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < r * 1.2 && d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function applyFlowAndLock(dt, t) {
  // Flow: slight attraction to targets + edge springs, then damping, then lock.
  // Coordinates are editorial targets (tx, ty). Motion provides “intelligence feel”.

  const lockSpeed = 0.18; // seconds scale
  anim.lock = clamp(anim.lock + dt * lockSpeed, 0, 1);

  const settle = anim.lock; // 0..1
  const springK = 0.08 * (1 - settle) + 0.18 * settle;
  const damp = 0.78 * (1 - settle) + 0.92 * settle;

  // edge springs (mild)
  for (const e of atlas.edges) {
    const a = atlas.nodes.get(e.from);
    const b = atlas.nodes.get(e.to);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1e-3, Math.sqrt(dx*dx + dy*dy));
    const desired = e.type === "taxonomy" ? 70 : 95;
    const force = (dist - desired) * 0.0009 * (e.w || 0.6);

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // target attraction + breathing (tiny)
  for (const n of atlas.nodes.values()) {
    const breath = 0.8 + 0.2 * Math.sin(t * 0.001 + hash01(n.id) * 6.283);
    const fog = parseFloat(n.fog || "0.3");
    const wobble = (1 - settle) * 0.25 + settle * 0.06;

    const tx = n.tx + wobble * breath * (Math.sin(t*0.0007 + hash01(n.id)*10) * 8);
    const ty = n.ty + wobble * breath * (Math.cos(t*0.0006 + hash01(n.id)*10) * 8);

    n.vx += (tx - n.x) * springK * 0.02;
    n.vy += (ty - n.y) * springK * 0.02;

    // foggy nodes move slightly less
    const scale = 1.0 - fog * 0.35;
    n.vx *= damp * scale;
    n.vy *= damp * scale;

    n.x += n.vx * dt * 60;
    n.y += n.vy * dt * 60;
  }
}

function hash01(s) {
  // stable 0..1 hash
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function draw(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Clouds (fog)
  if (state.layers.clouds) {
    for (const c of atlas.clouds) {
      const drift = c.drift || 0.1;
      const bx = c.x + Math.sin(t*0.0002 + hash01(c.id)*7) * 12 * drift;
      const by = c.y + Math.cos(t*0.00018 + hash01(c.id)*7) * 10 * drift;
      const p = worldToScreen(bx, by);

      const r = c.r * state.camera.zoom;
      const alpha = 0.10 + 0.08 * c.strength * (0.6 + 0.4 * Math.sin(t*0.00035 + hash01(c.id)*5));

      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0.0, `rgba(0,0,0,${alpha})`);
      grd.addColorStop(1.0, `rgba(0,0,0,0)`);

      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fill();

      // label (faint)
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = "12px Courier New";
      ctx.fillText(c.label, p.x - r*0.25, p.y + r*0.55);
    }
  }

  // Edges
  if (state.layers.edges) {
    for (const e of atlas.edges) {
      const a = atlas.nodes.get(e.from);
      const b = atlas.nodes.get(e.to);
      if (!a || !b) continue;

      const pa = worldToScreen(a.x, a.y);
      const pb = worldToScreen(b.x, b.y);

      const isHot = (state.selectedId && (e.from === state.selectedId || e.to === state.selectedId)) ||
                    (state.hoverId && (e.from === state.hoverId || e.to === state.hoverId)) ||
                    (state.pinned.has(e.from) && state.pinned.has(e.to));

      const baseA = e.type === "taxonomy" ? 0.22 : e.type === "causal" ? 0.22 : 0.14;
      const a2 = isHot ? 0.55 : baseA;
      ctx.strokeStyle = `rgba(0,0,0,${a2})`;
      ctx.lineWidth = isHot ? 1.25 : 1.0;

      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  // Nodes
  for (const n of atlas.nodes.values()) {
    const p = worldToScreen(n.x, n.y);
    const r = nodeRadius(n) * state.camera.zoom;

    const isPinned = state.pinned.has(n.id);
    const isSel = state.selectedId === n.id;
    const isHover = state.hoverId === n.id;

    const alpha = confidenceAlpha(n.confidence) * (isPinned || isSel || isHover ? 1.0 : 0.85);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fill();

    // halo for pinned/selected
    if (isPinned || isSel) {
      const pulse = 0.6 + 0.4 * Math.sin(t*0.004 + hash01(n.id)*6.283);
      ctx.strokeStyle = `rgba(0,0,0,${0.25 + 0.25*pulse})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5 + pulse*2, 0, Math.PI*2);
      ctx.stroke();
    }

    // Labels by tier/zoom
    if (state.layers.labels) {
      const tier = parseInt(n.tier || "3", 10);
      const z = state.camera.zoom;

      const show =
        (tier === 1) ||
        (tier === 2 && z > 0.55) ||
        (tier === 3 && (z > 0.85 || isPinned || isSel || isHover));

      if (show) {
        const label = n.label + (n.placement ? ` · ${n.placement}` : "");
        ctx.font = tier === 1 ? "16px Courier New" : tier === 2 ? "13px Courier New" : "12px Courier New";
        const a3 = tier === 1 ? 0.65 : 0.55;
        ctx.fillStyle = `rgba(0,0,0,${isPinned || isSel || isHover ? 0.85 : a3})`;
        ctx.fillText(label, p.x + r + 8, p.y + 4);
      }
    }
  }
}

function updateHUD() {
  const h = atlas.nodes.get(state.hoverId);
  ui.hoverLabel.textContent = h ? h.label : "—";
  const s = atlas.nodes.get(state.selectedId);
  ui.selLabel.textContent = s ? s.label : "—";
  ui.pinList.textContent = state.pinned.size ? [...state.pinned].join(", ") : "—";
}

function tick(now) {
  const dt = clamp((now - anim.t0) / 1000, 0, 0.05);
  anim.t0 = now;

  applyFlowAndLock(dt, now);
  draw(now);
  updateHUD();

  requestAnimationFrame(tick);
}

async function boot() {
  const res = await fetch("./atlas.xml", { cache: "no-store" });
  const xmlText = await res.text();
  atlas = parseAtlasXML(xmlText);
  setStats();

  resetView();

  // UI bindings
  ui.btnReset.addEventListener("click", () => resetView());
  ui.btnExportPNG.addEventListener("click", () => exportPNG());
  ui.btnExportState.addEventListener("click", () => exportStateXML());
  ui.btnExportPrompt.addEventListener("click", () => exportPromptTXT());

  // Pointer events
  canvas.addEventListener("mousemove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    if (state.drag.active) {
      const dx = (sx - state.drag.sx) / state.camera.zoom;
      const dy = (sy - state.drag.sy) / state.camera.zoom;
      state.camera.x = state.drag.cx - dx;
      state.camera.y = state.drag.cy - dy;
      return;
    }

    const n = pickNodeAtScreen(sx, sy);
    state.hoverId = n ? n.id : null;
  });

  canvas.addEventListener("mousedown", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    state.drag.active = true;
    state.drag.sx = sx;
    state.drag.sy = sy;
    state.drag.cx = state.camera.x;
    state.drag.cy = state.camera.y;
  });

  window.addEventListener("mouseup", () => {
    state.drag.active = false;
  });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    const before = screenToWorld(sx, sy);
    const factor = ev.deltaY < 0 ? 1.08 : 0.92;
    state.camera.zoom = clamp(state.camera.zoom * factor, 0.25, 3.2);
    const after = screenToWorld(sx, sy);

    // keep cursor point stable
    state.camera.x += (before.x - after.x);
    state.camera.y += (before.y - after.y);
  }, { passive: false });

  canvas.addEventListener("click", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const n = pickNodeAtScreen(sx, sy);
    if (!n) return;

    state.selectedId = n.id;
    ui.selLabel.textContent = n.label;

    if (ev.shiftKey) {
      if (state.pinned.has(n.id)) state.pinned.delete(n.id);
      else state.pinned.add(n.id);
    }
  });

  requestAnimationFrame((t) => {
    anim.t0 = t;
    tick(t);
  });
}

boot().catch(err => {
  console.error(err);
  alert("phyloMAT: atlas failed to load. Serve via a local web server so fetch() can read atlas.xml.");
});