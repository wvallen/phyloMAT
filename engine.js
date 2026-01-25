// phyloMAT 2.0 engine
// Full-screen canvas. Semantic zoom. Colored fog clouds. Optional proximity mesh.
// Local-first atlas.xml. Exports PNG + state.xml + prompt.txt.

const canvas = document.getElementById("atlas");
const ctx = canvas.getContext("2d", { alpha: false });

const UI = {
  gotoSelect: document.getElementById("gotoSelect"),
  btnGo: document.getElementById("btnGo"),
  btnReset: document.getElementById("btnReset"),
  btnPNG: document.getElementById("btnPNG"),
  btnState: document.getElementById("btnState"),
  btnPrompt: document.getElementById("btnPrompt"),

  togClouds: document.getElementById("togClouds"),
  togTaxEdges: document.getElementById("togTaxEdges"),
  togMesh: document.getElementById("togMesh"),
  togLabels: document.getElementById("togLabels"),

  slLabel: document.getElementById("slLabel"),
  slCloud: document.getElementById("slCloud"),
  slMesh: document.getElementById("slMesh"),
  slLock: document.getElementById("slLock"),

  statLoaded: document.getElementById("statLoaded"),
  statHover: document.getElementById("statHover"),
  statSel: document.getElementById("statSel"),
  statPins: document.getElementById("statPins"),
};

const state = {
  cam: { x: 520, y: 360, z: 0.85 },
  drag: { on: false, sx: 0, sy: 0, cx: 0, cy: 0 },
  hover: null,
  selected: null,
  pinned: new Set(),
  focusNote: "Extend atlas near current focus.",
  lock: 0, // 0..1
  lastT: performance.now(),
};

let atlas = {
  nodes: new Map(),
  edges: [],
  clouds: [],
  homes: new Map(), // id -> {x,y,zoom}
};

function resize() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function download(name, text){
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function escapeXML(s){
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hash01(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function worldToScreen(wx, wy){
  const {x,y,z} = state.cam;
  return {
    x: (wx - x) * z + window.innerWidth/2,
    y: (wy - y) * z + window.innerHeight/2
  };
}

function screenToWorld(sx, sy){
  const {x,y,z} = state.cam;
  return {
    x: (sx - window.innerWidth/2)/z + x,
    y: (sy - window.innerHeight/2)/z + y
  };
}

function confAlpha(c){
  if (c === "high") return 1.0;
  if (c === "medium") return 0.85;
  return 0.7;
}

function nodeBaseRadius(n){
  const tier = parseInt(n.tier || "3", 10);
  const fog = parseFloat(n.fog || "0.3");
  const base = tier === 1 ? 11 : tier === 2 ? 8 : 6;
  return base + fog*6;
}

function parseColor(s){
  // "r,g,b"
  const parts = (s || "0,0,0").split(",").map(x => parseInt(x.trim(),10));
  return { r: parts[0]||0, g: parts[1]||0, b: parts[2]||0 };
}

function parseAtlasXML(xmlText){
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");

  // homes
  for (const h of [...doc.querySelectorAll("meta home")]){
    atlas.homes.set(h.getAttribute("id"), {
      x: parseFloat(h.getAttribute("x")||"0"),
      y: parseFloat(h.getAttribute("y")||"0"),
      zoom: parseFloat(h.getAttribute("zoom")||"1"),
    });
  }

  // clouds
  atlas.clouds = [...doc.querySelectorAll("clouds cloud")].map(el => ({
    id: el.getAttribute("id"),
    label: el.getAttribute("label") || "",
    strength: parseFloat(el.getAttribute("strength") || "0.7"),
    x: parseFloat(el.getAttribute("x") || "0"),
    y: parseFloat(el.getAttribute("y") || "0"),
    r: parseFloat(el.getAttribute("r") || "220"),
    drift: parseFloat(el.getAttribute("drift") || "0.1"),
    color: parseColor(el.getAttribute("color") || "0,0,0"),
  }));

  // nodes
  atlas.nodes = new Map();
  for (const el of [...doc.querySelectorAll("nodes node")]){
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
      vx: 0, vy: 0,
      tx: 0, ty: 0,
    };
    n.tx = n.x; n.ty = n.y;
    atlas.nodes.set(n.id, n);
  }

  // edges
  atlas.edges = [...doc.querySelectorAll("edges edge")].map(el => ({
    from: el.getAttribute("from"),
    to: el.getAttribute("to"),
    type: el.getAttribute("type") || "taxonomy",
    w: parseFloat(el.getAttribute("w") || "0.5"),
  }));
}

function setHUD(){
  UI.statLoaded.textContent = `${atlas.nodes.size} nodes, ${atlas.edges.length} edges, ${atlas.clouds.length} clouds`;
  UI.statHover.textContent = state.hover ? atlas.nodes.get(state.hover)?.label || state.hover : "—";
  UI.statSel.textContent = state.selected ? atlas.nodes.get(state.selected)?.label || state.selected : "—";
  UI.statPins.textContent = state.pinned.size ? [...state.pinned].join(", ") : "—";
}

function pickNodeAtScreen(sx, sy){
  const w = screenToWorld(sx, sy);
  let best = null;
  let bestD = Infinity;

  for (const n of atlas.nodes.values()){
    const dx = w.x - n.x;
    const dy = w.y - n.y;
    const d = Math.sqrt(dx*dx + dy*dy);

    const rWorld = (nodeBaseRadius(n) * 1.4) / state.cam.z;
    if (d < rWorld && d < bestD){
      best = n; bestD = d;
    }
  }
  return best;
}

function goTo(id){
  const home = atlas.homes.get(id);
  if (home){
    state.cam.x = home.x;
    state.cam.y = home.y;
    state.cam.z = home.zoom;
    state.lock = 0;
    return;
  }
  const n = atlas.nodes.get(id);
  if (n){
    state.cam.x = n.x;
    state.cam.y = n.y;
    state.cam.z = 1.25;
    state.lock = 0;
  }
}

function reset(){
  goTo("tri");
}

function exportPNG(){
  // Canvas is full screen; browser can export exact pixels.
  const a = document.createElement("a");
  a.download = "phylomat2_view.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function exportStateXML(){
  const pins = [...state.pinned].join(",");
  const xml =
`<phyloMATState version="2.0">
  <camera x="${state.cam.x.toFixed(3)}" y="${state.cam.y.toFixed(3)}" zoom="${state.cam.z.toFixed(5)}"/>
  <selection selected="${state.selected || ""}" hover="${state.hover || ""}"/>
  <pinned>${escapeXML(pins)}</pinned>
  <layers clouds="${UI.togClouds.checked}" taxonomy="${UI.togTaxEdges.checked}" mesh="${UI.togMesh.checked}" labels="${UI.togLabels.checked}"/>
  <sliders label="${UI.slLabel.value}" cloud="${UI.slCloud.value}" mesh="${UI.slMesh.value}" lock="${UI.slLock.value}"/>
  <note>${escapeXML(state.focusNote)}</note>
</phyloMATState>`;
  download("state.xml", xml);
}

function localSliceXML(){
  const ids = new Set(state.pinned);
  if (state.selected) ids.add(state.selected);

  if (ids.size === 0){
    ["bacteria","archaea","eukaryota","sar","opisthokonta","archaeplastida"].forEach(x => ids.add(x));
  }

  // one-hop neighbors
  for (const e of atlas.edges){
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

function exportPromptTXT(){
  const ctxXML = localSliceXML();
  const prompt =
`phyloMAT atlas expansion

Context:
Causal taxonomy atlas organized by constraint and adjacency.
Time implicit.
Uncertainty as fog.

Task:
Extend the atlas near the focus region using the local context.
Propose taxa or grouping nodes and minimal edges.

Rules:
- keep time implicit
- prefer higher taxonomic levels when resolution is uncertain
- express uncertainty using confidence and fog attributes
- keep labels concise and technical
- output XML only

Output:
Return <patch> containing <node> and <edge> additions.
Coordinates optional.

LOCAL CONTEXT:
${ctxXML}
`;
  download("prompt.txt", prompt);
}

function applyDynamics(dt, t){
  // “Flow → lock” controlled by slider
  const lockRate = parseFloat(UI.slLock.value) / 1000; // 0.01..0.2ish
  state.lock = clamp(state.lock + dt * lockRate, 0, 1);

  // Semantic zoom: as z increases, space feels deeper.
  // We modulate spring length + repulsion with zoom.
  const z = state.cam.z;
  const zoomGain = clamp((z - 0.7) / 1.2, 0, 1); // 0..1

  const settle = state.lock;
  const damp = 0.72*(1-settle) + 0.92*settle;

  // mild repulsion increases with zoom (prevents “single chain” feel when zoomed in)
  const repulse = 0.008 + 0.020*zoomGain;

  // edge springs
  for (const e of atlas.edges){
    if (e.type === "taxonomy" && !UI.togTaxEdges.checked) continue;
    const a = atlas.nodes.get(e.from);
    const b = atlas.nodes.get(e.to);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1e-3, Math.sqrt(dx*dx + dy*dy));

    // spring target expands with zoom to create “going deeper expands space”
    const baseLen = (e.type === "taxonomy") ? 110 : 140;
    const target = baseLen * (1 + 0.45*zoomGain);

    const k = 0.0009 * (0.6 + 0.8*e.w);
    const force = (dist - target) * k;

    const fx = (dx/dist) * force;
    const fy = (dy/dist) * force;

    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // repulsion (O(n^2), fine for your curated atlas)
  const arr = [...atlas.nodes.values()];
  for (let i=0;i<arr.length;i++){
    for (let j=i+1;j<arr.length;j++){
      const a = arr[i], b = arr[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx*dx + dy*dy + 25;
      const inv = 1 / d2;
      const f = repulse * inv;

      a.vx -= dx * f;
      a.vy -= dy * f;
      b.vx += dx * f;
      b.vy += dy * f;
    }
  }

  // pull nodes toward their editorial targets (keeps the atlas “authored”)
  for (const n of atlas.nodes.values()){
    const fog = parseFloat(n.fog || "0.3");
    const stable = 0.015 + 0.03*settle;
    const wobble = (1-settle)*0.5 + 0.12;

    const phase = hash01(n.id)*6.283;
    const breath = 0.7 + 0.3*Math.sin(t*0.0013 + phase);
    const tx = n.tx + wobble*breath*Math.sin(t*0.0006 + phase) * 10;
    const ty = n.ty + wobble*breath*Math.cos(t*0.00055 + phase) * 10;

    n.vx += (tx - n.x) * stable;
    n.vy += (ty - n.y) * stable;

    // fog reduces mobility slightly
    const scale = 1.0 - 0.25*fog;
    n.vx *= damp * scale;
    n.vy *= damp * scale;

    n.x += n.vx * dt * 60;
    n.y += n.vy * dt * 60;
  }
}

function drawClouds(t){
  if (!UI.togClouds.checked) return;

  const cloudOpacity = parseFloat(UI.slCloud.value) / 100; // 0..1

  for (const c of atlas.clouds){
    const drift = c.drift || 0.1;
    const px = c.x + Math.sin(t*0.00022 + hash01(c.id)*7) * 14 * drift;
    const py = c.y + Math.cos(t*0.00018 + hash01(c.id)*7) * 12 * drift;

    const p = worldToScreen(px, py);
    const r = c.r * state.cam.z;

    const a0 = (0.05 + 0.09*c.strength) * cloudOpacity * (0.75 + 0.25*Math.sin(t*0.00035 + hash01(c.id)*5));
    const {r:cr,g:cg,b:cb} = c.color;

    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a0})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fill();

    // faint label
    ctx.fillStyle = `rgba(0,0,0,${0.28*cloudOpacity})`;
    ctx.font = `12px "Courier New"`;
    ctx.fillText(c.label, p.x - r*0.30, p.y + r*0.58);
  }
}

function drawEdges(t){
  // taxonomy edges
  if (UI.togTaxEdges.checked){
    for (const e of atlas.edges){
      if (e.type !== "taxonomy") continue;
      const a = atlas.nodes.get(e.from), b = atlas.nodes.get(e.to);
      if (!a || !b) continue;

      const pa = worldToScreen(a.x,a.y), pb = worldToScreen(b.x,b.y);
      const hot = (state.selected && (e.from===state.selected || e.to===state.selected)) ||
                  (state.hover && (e.from===state.hover || e.to===state.hover));

      const alpha = hot ? 0.45 : 0.22;
      ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
      ctx.lineWidth = hot ? 1.2 : 1.0;

      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  // proximity mesh (adds complexity when zoomed in)
  if (UI.togMesh.checked){
    const z = state.cam.z;
    const zoomGain = clamp((z - 0.8) / 1.4, 0, 1);
    const density = parseFloat(UI.slMesh.value) / 100; // 0..1
    const maxLinks = Math.floor(40 + density*260); // total mesh edges per frame cap
    if (density <= 0) return;

    // mesh radius shrinks with zoom, encouraging local connectivity
    const R = (280 - 120*zoomGain) * (1.0 - 0.35*(1-density)); // world units
    const R2 = R*R;

    const nodes = [...atlas.nodes.values()];
    let drawn = 0;

    for (let i=0;i<nodes.length && drawn<maxLinks;i++){
      const a = nodes[i];
      for (let j=i+1;j<nodes.length && drawn<maxLinks;j++){
        const b = nodes[j];
        const dx = b.x-a.x, dy = b.y-a.y;
        const d2 = dx*dx + dy*dy;
        if (d2 > R2) continue;

        // skip if already taxonomy-connected
        // (cheap check: ignore if ids share direct edge either direction)
        // keep it lightweight
        const pa = worldToScreen(a.x,a.y), pb = worldToScreen(b.x,b.y);
        const d = Math.sqrt(d2);

        const alpha = 0.05 + 0.10 * density * (1 - d/R);
        ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
        ctx.lineWidth = 1.0;

        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        drawn++;
      }
    }
  }
}

function drawNodes(t){
  const labelSize = parseInt(UI.slLabel.value, 10);
  const z = state.cam.z;

  for (const n of atlas.nodes.values()){
    const p = worldToScreen(n.x,n.y);

    const baseR = nodeBaseRadius(n);
    const pulse = 0.7 + 0.3*Math.sin(t*0.004 + hash01(n.id)*6.283);
    const r = baseR * (0.9 + 0.15*pulse);

    const isPinned = state.pinned.has(n.id);
    const isSel = state.selected === n.id;
    const isHover = state.hover === n.id;

    const a = confAlpha(n.confidence) * (isPinned || isSel || isHover ? 1.0 : 0.88);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fill();

    if (isPinned || isSel){
      ctx.strokeStyle = `rgba(0,0,0,${0.22 + 0.18*pulse})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6 + 2*pulse, 0, Math.PI*2);
      ctx.stroke();
    }

    if (UI.togLabels.checked){
      const tier = parseInt(n.tier || "3", 10);
      const show =
        (tier===1) ||
        (tier===2 && z>0.55) ||
        (tier===3 && (z>0.95 || isPinned || isSel || isHover));

      if (show){
        const label = n.placement ? `${n.label} · ${n.placement}` : n.label;
        const size = tier===1 ? labelSize+4 : tier===2 ? labelSize+1 : labelSize;
        ctx.font = `${size}px "Courier New"`;
        ctx.fillStyle = `rgba(0,0,0,${(isPinned||isSel||isHover) ? 0.86 : 0.56})`;
        ctx.fillText(label, p.x + r + 10, p.y + 5);
      }
    }
  }
}

function render(t){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  drawClouds(t);
  drawEdges(t);
  drawNodes(t);
}

function tick(t){
  const dt = clamp((t - state.lastT)/1000, 0, 0.05);
  state.lastT = t;

  applyDynamics(dt, t);
  setHUD();
  render(t);

  requestAnimationFrame(tick);
}

async function boot(){
  resize();

  const res = await fetch("./atlas.xml", { cache: "no-store" });
  const txt = await res.text();
  parseAtlasXML(txt);

  // start at overview
  reset();

  // controls
  UI.btnReset.addEventListener("click", reset);
  UI.btnPNG.addEventListener("click", exportPNG);
  UI.btnState.addEventListener("click", exportStateXML);
  UI.btnPrompt.addEventListener("click", exportPromptTXT);

  UI.btnGo.addEventListener("click", () => goTo(UI.gotoSelect.value));
  UI.gotoSelect.addEventListener("change", () => { /* no auto-jump */ });

  // mouse
  canvas.addEventListener("mousemove", (ev) => {
    const sx = ev.clientX, sy = ev.clientY;

    if (state.drag.on){
      const dx = (sx - state.drag.sx)/state.cam.z;
      const dy = (sy - state.drag.sy)/state.cam.z;
           state.cam.x = state.drag.cx - dx;
      state.cam.y = state.drag.cy - dy;
      return;
    }

    const n = pickNodeAtScreen(sx, sy);
    state.hover = n ? n.id : null;
  });

  canvas.addEventListener("mousedown", (ev) => {
    const sx = ev.clientX, sy = ev.clientY;

    state.drag.on = true;
    state.drag.sx = sx;
    state.drag.sy = sy;
    state.drag.cx = state.cam.x;
    state.drag.cy = state.cam.y;
  });

  window.addEventListener("mouseup", () => {
    state.drag.on = false;
  });

  // zoom
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();

    const sx = ev.clientX, sy = ev.clientY;
    const before = screenToWorld(sx, sy);

    const factor = ev.deltaY < 0 ? 1.09 : 0.91;
    state.cam.z = clamp(state.cam.z * factor, 0.18, 5.2);

    const after = screenToWorld(sx, sy);
    state.cam.x += (before.x - after.x);
    state.cam.y += (before.y - after.y);

    state.lock = 0;
  }, { passive: false });

  // click: select, shift-click: pin
  canvas.addEventListener("click", (ev) => {
    const sx = ev.clientX, sy = ev.clientY;
    const n = pickNodeAtScreen(sx, sy);
    if (!n) return;

    state.selected = n.id;

    if (ev.shiftKey) {
      if (state.pinned.has(n.id)) state.pinned.delete(n.id);
      else state.pinned.add(n.id);
    }
  });

  // keyboard helpers
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      state.selected = null;
      state.hover = null;
    }
    if (ev.key === "0") {
      reset();
    }
  });

  // toggles and sliders trigger a gentle reflow
  const nudge = () => { state.lock = 0; };

  UI.togClouds.addEventListener("change", nudge);
  UI.togTaxEdges.addEventListener("change", nudge);
  UI.togMesh.addEventListener("change", nudge);
  UI.togLabels.addEventListener("change", nudge);

  UI.slLabel.addEventListener("input", () => {});
  UI.slCloud.addEventListener("input", () => {});
  UI.slMesh.addEventListener("input", () => { state.lock = 0; });
  UI.slLock.addEventListener("input", () => { state.lock = 0; });

  // populate dropdown from homes + common taxa (if present)
  (function fillGoto() {
    const opts = [];
    for (const [id] of atlas.homes.entries()) opts.push(id);

    // useful defaults if homes omitted
    const defaults = ["tri", "human", "t_thermophila", "e_coli", "bacteria", "archaea", "eukaryota"];
    for (const id of defaults) {
      if (atlas.homes.has(id) || atlas.nodes.has(id)) {
        if (!opts.includes(id)) opts.push(id);
      }
    }

    // stable ordering: keep tri first, then rest
    opts.sort((a, b) => {
      if (a === "tri") return -1;
      if (b === "tri") return 1;
      return a.localeCompare(b);
    });

    UI.gotoSelect.innerHTML = "";
    for (const id of opts) {
      const label = atlas.nodes.get(id)?.label || id;
      const o = document.createElement("option");
      o.value = id;
      o.textContent = label;
      UI.gotoSelect.appendChild(o);
    }

    // prefer tri view in selector if present
    if (opts.includes("tri")) UI.gotoSelect.value = "tri";
  })();

  // initial UI defaults if elements exist
  if (UI.togClouds) UI.togClouds.checked = UI.togClouds.checked ?? true;
  if (UI.togTaxEdges) UI.togTaxEdges.checked = UI.togTaxEdges.checked ?? true;
  if (UI.togMesh) UI.togMesh.checked = UI.togMesh.checked ?? true;
  if (UI.togLabels) UI.togLabels.checked = UI.togLabels.checked ?? true;

  // start animation
  requestAnimationFrame(tick);
}

boot().catch(err => {
  console.error(err);
  alert("phyloMAT 2.0: atlas failed to load. Serve from a web server so atlas.xml can be fetched.");
});