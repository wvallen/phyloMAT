// phyloMAT 2.0 NEW ENGINE
// Explore-mode traversal with unfolding neighborhood, semantic zoom (detail level),
// screen-space styling, comfortable camera easing, visible colored fog clouds.

const canvas = document.getElementById("atlas");
const ctx = canvas.getContext("2d", { alpha: false });

const UI = {
  btnHome: document.getElementById("btnHome"),
  btnBack: document.getElementById("btnBack"),
  btnReset: document.getElementById("btnReset"),
  btnPNG: document.getElementById("btnPNG"),
  btnState: document.getElementById("btnState"),
  btnPrompt: document.getElementById("btnPrompt"),

  slDetail: document.getElementById("slDetail"),
  detailLabel: document.getElementById("detailLabel"),

  togClouds: document.getElementById("togClouds"),
  togLabels: document.getElementById("togLabels"),
  togContext: document.getElementById("togContext"),

  statLoaded: document.getElementById("statLoaded"),
  statFocus: document.getElementById("statFocus"),
  statHover: document.getElementById("statHover"),
  statPins: document.getElementById("statPins"),
  crumbs: document.getElementById("crumbs"),
  details: document.getElementById("details"),
};

const state = {
  // camera is expressed as "center + scale" where scale maps world->screen
  cam: { x: 520, y: 360, z: 1.0 },
  camTarget: { x: 520, y: 360, z: 1.0 },
  lastT: performance.now(),

  hover: null,
  focus: "tri",         // current “room”
  history: ["tri"],     // breadcrumb stack
  pinned: new Set(),

  detail: 2,            // 1..5 (semantic zoom)
  focusNote: "Extend atlas near current focus.",
};

let atlas = {
  nodes: new Map(),
  edges: [],
  clouds: [],
  homes: new Map(), // view homes: tri, human, etc.
};

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function ease(a,b,t){ return a + (b-a)*t; }

function resize(){
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", resize);

function parseColor(s){
  const parts = (s || "0,0,0").split(",").map(x => parseInt(x.trim(),10));
  return { r: parts[0]||0, g: parts[1]||0, b: parts[2]||0 };
}
function escapeXML(s){
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function download(name, text){
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function worldToScreen(wx, wy){
  const {x,y,z} = state.cam;
  return {
    x: (wx - x) * z + window.innerWidth/2,
    y: (wy - y) * z + window.innerHeight/2,
  };
}
function screenToWorld(sx, sy){
  const {x,y,z} = state.cam;
  return {
    x: (sx - window.innerWidth/2)/z + x,
    y: (sy - window.innerHeight/2)/z + y,
  };
}

function parseAtlasXML(xmlText){
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");

  for (const h of [...doc.querySelectorAll("meta home")]){
    atlas.homes.set(h.getAttribute("id"), {
      x: parseFloat(h.getAttribute("x")||"0"),
      y: parseFloat(h.getAttribute("y")||"0"),
      zoom: parseFloat(h.getAttribute("zoom")||"1"),
    });
  }

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

  atlas.nodes = new Map();
  for (const el of [...doc.querySelectorAll("nodes node")]){
    const n = {
      id: el.getAttribute("id"),
      label: el.getAttribute("label") || el.getAttribute("id"),
      kind: el.getAttribute("kind") || "taxon",
      confidence: el.getAttribute("confidence") || "medium",
      fog: parseFloat(el.getAttribute("fog") || "0.3"),
      x: parseFloat(el.getAttribute("x") || "0"),
      y: parseFloat(el.getAttribute("y") || "0"),
      tier: parseInt(el.getAttribute("tier") || "3", 10),
      placement: el.getAttribute("placement") || "",
    };
    atlas.nodes.set(n.id, n);
  }

  atlas.edges = [...doc.querySelectorAll("edges edge")].map(el => ({
    from: el.getAttribute("from"),
    to: el.getAttribute("to"),
    type: el.getAttribute("type") || "taxonomy",
    w: parseFloat(el.getAttribute("w") || "0.5"),
  }));
}

function setHUD(){
  UI.statLoaded.textContent = `${atlas.nodes.size} nodes, ${atlas.edges.length} edges, ${atlas.clouds.length} clouds`;
  UI.statFocus.textContent = atlas.nodes.get(state.focus)?.label || state.focus;
  UI.statHover.textContent = state.hover ? (atlas.nodes.get(state.hover)?.label || state.hover) : "—";
  UI.statPins.textContent = state.pinned.size ? [...state.pinned].join(", ") : "—";

  UI.crumbs.textContent = state.history
    .map(id => atlas.nodes.get(id)?.label || id)
    .join("  >  ");

  // detail panel
  const n = atlas.nodes.get(state.focus);
  if (!n) { UI.details.textContent = "Click a node."; return; }

  const children = neighborsOf(state.focus, "down")
    .map(id => atlas.nodes.get(id))
    .filter(Boolean)
    .map(m => `  - ${m.label}${m.placement ? " · " + m.placement : ""}`)
    .join("\n");

  const parents = neighborsOf(state.focus, "up")
    .map(id => atlas.nodes.get(id))
    .filter(Boolean)
    .map(m => `  - ${m.label}`)
    .join("\n");

  const ctxEdges = neighborsOf(state.focus, "context")
    .map(id => atlas.nodes.get(id))
    .filter(Boolean)
    .map(m => `  - ${m.label}`)
    .join("\n");

  UI.details.textContent =
`id: ${n.id}
kind: ${n.kind}
tier: ${n.tier}
confidence: ${n.confidence}
fog: ${n.fog.toFixed(2)}
x,y: ${n.x.toFixed(1)}, ${n.y.toFixed(1)}
${n.placement ? "placement: " + n.placement : ""}

parents:
${parents || "  —"}

children:
${children || "  —"}

context:
${ctxEdges || "  —"}
`;
}

function confAlpha(c){
  if (c === "high") return 1.0;
  if (c === "medium") return 0.85;
  return 0.7;
}

/**
 * Explore graph neighborhood around focus
 * - direction "down": taxonomy edges from focus outward
 * - direction "up": taxonomy edges into focus
 * - direction "context": context/association edges adjacent to focus
 */
function neighborsOf(id, mode){
  const out = new Set();
  for (const e of atlas.edges){
    if (mode === "down"){
      if (e.type === "taxonomy" && e.from === id) out.add(e.to);
    } else if (mode === "up"){
      if (e.type === "taxonomy" && e.to === id) out.add(e.from);
    } else if (mode === "context"){
      if ((e.type === "context" || e.type === "association") && (e.from === id)) out.add(e.to);
      if ((e.type === "context" || e.type === "association") && (e.to === id)) out.add(e.from);
    }
  }
  return [...out];
}

/**
 * Determine which nodes are currently "visible" given focus + detail
 * detail levels:
 * 1: focus + its parents/children (taxonomy only)
 * 2: + one-hop context/association
 * 3: + second hop taxonomy children
 * 4: + second hop context/association
 * 5: show everything (map mode)
 */
function visibleNodeIds(){
  if (state.detail >= 5) return new Set([...atlas.nodes.keys()]);

  const vis = new Set([state.focus]);

  // always include immediate taxonomy up/down
  for (const id of neighborsOf(state.focus, "up")) vis.add(id);
  for (const id of neighborsOf(state.focus, "down")) vis.add(id);

  if (state.detail >= 2){
    for (const id of neighborsOf(state.focus, "context")) vis.add(id);
  }

  if (state.detail >= 3){
    // second hop taxonomy children
    for (const c of neighborsOf(state.focus, "down")){
      for (const cc of neighborsOf(c, "down")) vis.add(cc);
    }
  }

  if (state.detail >= 4){
    // second hop context
    for (const c of neighborsOf(state.focus, "context")){
      for (const cc of neighborsOf(c, "context")) vis.add(cc);
    }
  }

  // pinned nodes always visible
  for (const p of state.pinned) vis.add(p);

  return vis;
}

/**
 * Comfortable screen-space sizing:
 * - node radius capped in pixels
 * - edge widths in pixels
 */
function nodeRadiusPx(n){
  // tiers act as a gentle cue, not a size explosion
  const base = n.tier === 1 ? 7 : (n.tier === 2 ? 5 : 4);
  const fogBonus = n.fog * 2.0; // tiny
  const hoverBonus = (state.hover === n.id) ? 1.5 : 0;
  const focusBonus = (state.focus === n.id) ? 2.0 : 0;
  const pinBonus = state.pinned.has(n.id) ? 1.5 : 0;

  return clamp(base + fogBonus + hoverBonus + focusBonus + pinBonus, 3.0, 10.0);
}

function edgeWidthPx(type, hot){
  if (type === "taxonomy") return hot ? 2.2 : 1.6;
  // context/association
  return hot ? 1.4 : 1.0;
}

function enterNode(id){
  if (!atlas.nodes.has(id) && !atlas.homes.has(id)) return;

  // if a home view exists, use it; else use node coordinate
  const home = atlas.homes.get(id);
  if (home){
    state.camTarget.x = home.x;
    state.camTarget.y = home.y;
    state.camTarget.z = home.zoom;
  } else {
    const n = atlas.nodes.get(id);
    state.camTarget.x = n.x;
    state.camTarget.y = n.y;
    // semantic zoom target based on detail level
    state.camTarget.z = 1.2 + 0.35*(state.detail-2);
  }

  // update focus and breadcrumb trail
  state.focus = id;
  if (state.history[state.history.length - 1] !== id) state.history.push(id);
}

function back(){
  if (state.history.length <= 1) return;
  state.history.pop();
  const id = state.history[state.history.length - 1];
  state.focus = id;

  const home = atlas.homes.get(id);
  if (home){
    state.camTarget = { x: home.x, y: home.y, z: home.zoom };
  } else {
    const n = atlas.nodes.get(id);
    if (n) state.camTarget = { x: n.x, y: n.y, z: 1.2 + 0.35*(state.detail-2) };
  }
}

function reset(){
  state.history = ["tri"];
  enterNode("tri");
}

function pickNodeAtScreen(sx, sy, vis){
  const w = screenToWorld(sx, sy);
  let best = null;
  let bestD = Infinity;

  for (const id of vis){
    const n = atlas.nodes.get(id);
    if (!n) continue;
    const dx = w.x - n.x;
    const dy = w.y - n.y;
    const d = Math.sqrt(dx*dx + dy*dy);

    // Convert radius from px to world units: px / z
    const rWorld = nodeRadiusPx(n) / Math.max(0.0001, state.cam.z);
    if (d < rWorld * 1.25 && d < bestD){
      best = n;
      bestD = d;
    }
  }
  return best;
}

function exportPNG(){
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
  <focus id="${escapeXML(state.focus)}"/>
  <detail>${state.detail}</detail>
  <history>${escapeXML(state.history.join(","))}</history>
  <pinned>${escapeXML(pins)}</pinned>
  <layers clouds="${UI.togClouds.checked}" labels="${UI.togLabels.checked}" context="${UI.togContext.checked}"/>
  <note>${escapeXML(state.focusNote)}</note>
</phyloMATState>`;
  download("state.xml", xml);
}

function localSliceXML(){
  const vis = visibleNodeIds();
  const nodes = [...vis].map(id => atlas.nodes.get(id)).filter(Boolean);

  const edges = atlas.edges.filter(e => vis.has(e.from) && vis.has(e.to));

  const nodeXML = nodes.map(n =>
    `  <node id="${n.id}" label="${escapeXML(n.label)}" kind="${n.kind}" confidence="${n.confidence}" fog="${n.fog}" x="${n.x.toFixed(2)}" y="${n.y.toFixed(2)}" />`
  ).join("\n");

  const edgeXML = edges.map(e =>
    `  <edge from="${e.from}" to="${e.to}" type="${e.type}" w="${e.w.toFixed(2)}" />`
  ).join("\n");

  return `<localContext>
<focus>${escapeXML(state.focus)}</focus>
<detail>${state.detail}</detail>
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

/**
 * Draw clouds as visible colored fog with gentle grain.
 * Grain is cheap: a few random specks each frame with stable seeded positions per cloud.
 */
function drawClouds(t){
  if (!UI.togClouds.checked) return;

  for (const c of atlas.clouds){
    const {r:cr,g:cg,b:cb} = c.color;
    const drift = c.drift || 0.1;

    const px = c.x + Math.sin(t*0.00022 + c.x*0.001) * 12 * drift;
    const py = c.y + Math.cos(t*0.00018 + c.y*0.001) * 10 * drift;

    const p = worldToScreen(px, py);
    const R = c.r * state.cam.z;

    // Stronger baseline so it registers
    const alpha = 0.10 + 0.12 * c.strength;

    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI*2);
    ctx.fill();

    // subtle grain so fog reads
    const specks = 40; // cheap
    for (let i=0;i<specks;i++){
      const a = (i+1) * 12.9898 + (c.x*0.01);
      const rx = (Math.sin(a) * 43758.5453) % 1;
      const ry = (Math.sin(a*1.7) * 24634.6345) % 1;

      const ang = (rx<0? -rx: rx) * Math.PI*2;
      const rad = Math.sqrt(ry<0? -ry: ry) * R * 0.95;

      const sx = p.x + Math.cos(ang) * rad;
      const sy = p.y + Math.sin(ang) * rad;

      ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.03})`;
      ctx.fillRect(sx, sy, 1, 1);
    }

    if (UI.togLabels.checked && state.detail <= 2){
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = `12px "Courier New"`;
      ctx.fillText(c.label, p.x - R*0.25, p.y + R*0.58);
    }
  }
}

function drawEdges(vis){
  // draw only edges between visible nodes, with focus neighborhood emphasized
  for (const e of atlas.edges){
    if (!vis.has(e.from) || !vis.has(e.to)) continue;

    const a = atlas.nodes.get(e.from);
    const b = atlas.nodes.get(e.to);
    if (!a || !b) continue;

    // in explore mode, keep context edges optional
    if ((e.type === "context" || e.type === "association") && !UI.togContext.checked) continue;

    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);

    const hot = (e.from === state.focus || e.to === state.focus);
    const type = e.type;

    // alpha logic: taxonomy stronger, context lighter
    let alpha = 0.0;
    if (type === "taxonomy") alpha = hot ? 0.55 : 0.25;
    else alpha = hot ? 0.22 : 0.10;

    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = edgeWidthPx(type, hot);

    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
}

function drawNodes(vis){
  for (const id of vis){
    const n = atlas.nodes.get(id);
    if (!n) continue;

    const p = worldToScreen(n.x, n.y);
    const r = nodeRadiusPx(n);

    const isFocus = (id === state.focus);
    const isHover = (id === state.hover);
    const isPinned = state.pinned.has(id);

    const baseA = confAlpha(n.confidence) * 0.92;
    const a = (isFocus || isHover || isPinned) ? 1.0 : baseA;

    // fill
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fill();

    // crisp outline helps against fog
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.stroke();

    // focus halo
    if (isFocus || isPinned){
      ctx.strokeStyle = `rgba(0,0,0,${isFocus ? 0.55 : 0.35})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + (isFocus?6:4), 0, Math.PI*2);
      ctx.stroke();
    }

    // labels by detail + tier
    if (!UI.togLabels.checked) continue;

    const show =
      (state.detail <= 2 && n.tier <= 2) ||
      (state.detail >= 3) ||
      isFocus || isHover || isPinned;

    if (!show) continue;

    const label = n.placement ? `${n.label} · ${n.placement}` : n.label;
    const fontSize = (n.tier === 1) ? 16 : (n.tier === 2 ? 13 : 12);

    ctx.font = `${fontSize}px "Courier New"`;
    ctx.fillStyle = `rgba(0,0,0,${isFocus||isHover||isPinned ? 0.90 : 0.60})`;
    ctx.fillText(label, p.x + r + 10, p.y + 4);
  }
}

function render(t){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

  drawClouds(t);

  const vis = visibleNodeIds();

  // fade background nodes if detail small (explore feeling)
  // implemented by drawing only vis; everything else is “there” conceptually but not rendered.

  drawEdges(vis);
  drawNodes(vis);
}

function stepCamera(dt){
  // camera easing for comfort
  const kPos = 1 - Math.pow(0.001, dt);  // time-based smoothing
  const kZoom = 1 - Math.pow(0.002, dt);

  state.cam.x = ease(state.cam.x, state.camTarget.x, kPos);
  state.cam.y = ease(state.cam.y, state.camTarget.y, kPos);
  state.cam.z = ease(state.cam.z, state.camTarget.z, kZoom);
}

function tick(t){
  const dt = clamp((t - state.lastT)/1000, 0, 0.05);
  state.lastT = t;

  stepCamera(dt);
  setHUD();
  render(t);

  requestAnimationFrame(tick);
}

async function boot(){
  resize();

  const res = await fetch("./atlas.xml", { cache: "no-store" });
  const xml = await res.text();
  parseAtlasXML(xml);

  // seed camera from tri home
  const tri = atlas.homes.get("tri") || { x: 520, y: 360, zoom: 0.85 };
  state.cam = { x: tri.x, y: tri.y, z: tri.zoom };
  state.camTarget = { x: tri.x, y: tri.y, z: tri.zoom };

  // init detail
  state.detail = parseInt(UI.slDetail.value, 10);
  UI.detailLabel.textContent = String(state.detail);

  // enter tri
  state.focus = "tri";
  state.history = ["tri"];

  // UX bindings
  UI.btnHome.addEventListener("click", () => reset());
  UI.btnReset.addEventListener("click", () => reset());
  UI.btnBack.addEventListener("click", () => back());
  UI.btnPNG.addEventListener("click", exportPNG);
  UI.btnState.addEventListener("click", exportStateXML);
  UI.btnPrompt.addEventListener("click", exportPromptTXT);

  UI.slDetail.addEventListener("input", () => {
    state.detail = parseInt(UI.slDetail.value, 10);
    UI.detailLabel.textContent = String(state.detail);

    // semantic zoom adjusts target zoom gently, not instantly
    const n = atlas.nodes.get(state.focus);
    if (n){
      state.camTarget.z = 1.05 + 0.35*(state.detail-2);
    } else {
      const home = atlas.homes.get(state.focus);
      if (home) state.camTarget.z = home.zoom;
    }
  });

  // pointer: hover + click-to-enter
  canvas.addEventListener("mousemove", (ev) => {
    const vis = visibleNodeIds();
    const n = pickNodeAtScreen(ev.clientX, ev.clientY, vis);
    state.hover = n ? n.id : null;
  });

  canvas.addEventListener("click", (ev) => {
    const vis = visibleNodeIds();
    const n = pickNodeAtScreen(ev.clientX, ev.clientY, vis);
    if (!n) return;

    if (ev.shiftKey){
      if (state.pinned.has(n.id)) state.pinned.delete(n.id);
      else state.pinned.add(n.id);
      return;
    }

    enterNode(n.id);
  });

  // wheel changes semantic detail by default (comfortable)
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const dir = ev.deltaY < 0 ? 1 : -1;
    const next = clamp(state.detail + dir, 1, 5);
    state.detail = next;
    UI.slDetail.value = String(next);
    UI.detailLabel.textContent = String(next);

    // update zoom target to match detail
    const n = atlas.nodes.get(state.focus);
    if (n){
      state.camTarget.z = 1.05 + 0.35*(state.detail-2);
    }
  }, { passive: false });

  // keyboard
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") state.hover = null;
    if (ev.key === "Backspace") back();
    if (ev.key === "0") reset();
  });

  requestAnimationFrame(tick);
}

boot().catch(err => {
  console.error(err);
  alert("phyloMAT 2.0: failed to load atlas.xml. Serve via a web server.");
});