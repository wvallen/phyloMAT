/* phyloMAT Wow Tree (schematic fractal with scientific semantics)
   - Always starts full-tree
   - Sticky clade toggles (domain + euk subclades)
   - Species: highlight root->taxon path + rings
   - Time slider: landmark-based reveal (schematic mapping, accurate labels)
   - Layers: none | demo_struct | rainbow | mito
*/

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });
const viewEl = document.getElementById('view');

const hudWhere = document.getElementById('hudWhere');
const hudLayer = document.getElementById('hudLayer');
const hudZoom  = document.getElementById('hudZoom');

const header = document.getElementById('header');
const spinBtn = document.getElementById('spinBtn');

const modalBack = document.getElementById('modalBack');
const aboutBtn = document.getElementById('aboutBtn');
const closeModalBtn = document.getElementById('closeModal');

const taxaSelect = document.getElementById('taxaSelect');
const layerSel = document.getElementById('layer');
const search = document.getElementById('search');

let layerMode = layerSel?.value || "none";

// Optional new UI elements (added in index.html patch)
const modelSelect = document.getElementById('modelSelect');
const pathogenSelect = document.getElementById('pathogenSelect');
const exploreTour = document.getElementById('exploreTour');
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');


// -----------------------------
// State
// -----------------------------
let pulseEnabled = true;

// Sticky toggles
const activeClades = new Set();   // e.g., "Bacteria", "Archaea", "Eukaryota", "Metazoa", "Fungi", "Viridiplantae", "Mammalia"
let activeTaxonLabel = null;      // label object for selected species (taxon)
let selectedPathKeys = new Set(); // keys along root->taxon path

// Time reveal (0 oldest .. 5 present)
let timeLevel = 5;
let maxDepthAllowed = 11;

// Tree anchors for semantic partitioning
const anchors = {
  origin: {x:0,y:0},
  trunkEnd:{x:0,y:0},
  forkBase:{x:0,y:0},
  endB:{x:0,y:0},
  endA:{x:0,y:0},
  endE:{x:0,y:0}
};

// Parent tracking for path reconstruction
let parentOf = new Map(); // childKey -> {k: parentKey, _d: depth}


// -----------------------------
// UI wiring
// -----------------------------
spinBtn?.addEventListener('click', () => {
  const on = header.classList.toggle('spinOn');
  spinBtn.textContent = on ? 'Spin: ON' : 'Spin: OFF';
  spinBtn.setAttribute('aria-pressed', String(on));
});

aboutBtn?.addEventListener('click', () => { modalBack.style.display = 'flex'; });
closeModalBtn?.addEventListener('click', () => { modalBack.style.display = 'none'; });
modalBack?.addEventListener('click', (e) => { if (e.target === modalBack) modalBack.style.display = 'none'; });
window.addEventListener('keydown', (e) => { if(e.key === 'Escape') modalBack.style.display = 'none'; });

layerSel?.addEventListener('change', () => {
  layerMode = layerSel.value;
  hudLayer.textContent = `Layer: ${layerMode}`;
});

// Home: clears highlights and frames full tree
document.getElementById('homeBtn')?.addEventListener('click', () => {
  activeClades.clear();
  activeTaxonLabel = null;
  selectedPathKeys = new Set();
  frameFullTree();
  setHud("life");
});

// FlySelected becomes “Highlight species” (keeps whole-tree view)
document.getElementById('flySelected')?.addEventListener('click', () => {
  const t = TAXA.find(x => x.key === taxaSelect.value);
  if(!t) return;
  highlightTaxonByName(t.label);
});

// Pulse toggle (sticky)
const pulseBtn = document.getElementById('pulseSelected');
if(pulseBtn){
  pulseBtn.setAttribute('aria-pressed', String(true));
  pulseBtn.textContent = 'Pulse: ON';
  pulseBtn.addEventListener('click', () => {
    pulseEnabled = !pulseEnabled;
    pulseBtn.setAttribute('aria-pressed', String(pulseEnabled));
    pulseBtn.textContent = pulseEnabled ? 'Pulse: ON' : 'Pulse: OFF';
    if(!pulseEnabled) pulses = [];
  });
}

// Buttons (domains + subclades) become sticky highlight toggles, NOT fly
const CLADES = new Set(["Bacteria","Archaea","Eukaryota","Metazoa","Fungi","Viridiplantae","Mammalia","life"]);
document.querySelectorAll('[data-fly]').forEach(b => {
  b.addEventListener('click', () => {
    const name = b.getAttribute('data-fly');
    if(!name) return;

    if(name === "life"){
      activeClades.clear();
      activeTaxonLabel = null;
      selectedPathKeys = new Set();
      frameFullTree();
      setHud("life");
      return;
    }

    // sticky toggle
    if(activeClades.has(name)) activeClades.delete(name);
    else activeClades.add(name);

    // keep tree framed (no camera jump)
    setHud(activeClades.size ? Array.from(activeClades).join(", ") : "life");
  });
});

// Search: if matches a clade, toggle; else highlight taxon
search?.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter') return;
  const q = (search.value || '').trim();
  if(!q) return;

  const canon = normalizeCladeQuery(q);
  if(canon && canon !== "life"){
    if(activeClades.has(canon)) activeClades.delete(canon);
    else activeClades.add(canon);
    setHud(activeClades.size ? Array.from(activeClades).join(", ") : "life");
    return;
  }

  highlightTaxonByName(q);
});

// Model/Pathogen dropdowns (optional)
modelSelect?.addEventListener('change', () => {
  const v = modelSelect.value;
  if(v) highlightTaxonByName(v);
});
pathogenSelect?.addEventListener('change', () => {
  const v = pathogenSelect.value;
  if(v) highlightTaxonByName(v);
});

// Explore tours (optional)
exploreTour?.addEventListener('change', () => {
  runTour(exploreTour.value);
});

// Time slider (optional)
timeSlider?.addEventListener('input', () => {
  timeLevel = Number(timeSlider.value);
  applyTimeLevel(timeLevel);
});


// -----------------------------
// Taxa lists (upgrade in place)
// -----------------------------
const TAXA = [
  // Model systems
  { key:"ecoli", label:"Escherichia coli", clade:"Bacteria", demoCoverage:0.40, bucket:"model" },
  { key:"bsub",  label:"Bacillus subtilis", clade:"Bacteria", demoCoverage:0.34, bucket:"model" },
  { key:"scer",  label:"Saccharomyces cerevisiae", clade:"Fungi", demoCoverage:0.70, bucket:"model" },
  { key:"athal", label:"Arabidopsis thaliana", clade:"Viridiplantae", demoCoverage:0.46, bucket:"model" },
  { key:"cele",  label:"Caenorhabditis elegans", clade:"Metazoa", demoCoverage:0.55, bucket:"model" },
  { key:"dmel",  label:"Drosophila melanogaster", clade:"Metazoa", demoCoverage:0.62, bucket:"model" },
  { key:"mmus",  label:"Mus musculus", clade:"Mammalia", demoCoverage:0.88, bucket:"model" },
  { key:"hsap",  label:"Homo sapiens", clade:"Mammalia", demoCoverage:0.96, bucket:"model" },

  // Pathogens / notable
  { key:"mtb",   label:"Mycobacterium tuberculosis", clade:"Bacteria", demoCoverage:0.22, bucket:"pathogen" },
  { key:"hpyl",  label:"Helicobacter pylori", clade:"Bacteria", demoCoverage:0.18, bucket:"pathogen" },
  { key:"pfal",  label:"Plasmodium falciparum", clade:"Eukaryota", demoCoverage:0.28, bucket:"pathogen" },

  // Archaea icons
  { key:"mjann", label:"Methanocaldococcus jannaschii", clade:"Archaea", demoCoverage:0.12, bucket:"other" },
  { key:"afulg", label:"Archaeoglobus fulgidus", clade:"Archaea", demoCoverage:0.14, bucket:"other" },

  // Deep branches flavor
  { key:"tmar",  label:"Thermotoga maritima", clade:"Bacteria", demoCoverage:0.10, bucket:"other" },
];

// Populate original curated select (kept)
(function populateTaxa(){
  if(!taxaSelect) return;
  taxaSelect.innerHTML = '';
  for(const t of TAXA){
    const opt = document.createElement('option');
    opt.value = t.key;
    opt.textContent = t.label;
    taxaSelect.appendChild(opt);
  }
  taxaSelect.value = 'hsap';
})();

// Populate model/pathogen selects if present
(function populateBuckets(){
  if(modelSelect){
    modelSelect.innerHTML = `<option value="">Select model…</option>`;
    TAXA.filter(t => t.bucket === "model").forEach(t => {
      const o = document.createElement("option");
      o.value = t.label;
      o.textContent = t.label;
      modelSelect.appendChild(o);
    });
  }
  if(pathogenSelect){
    pathogenSelect.innerHTML = `<option value="">Select pathogen…</option>`;
    TAXA.filter(t => t.bucket === "pathogen").forEach(t => {
      const o = document.createElement("option");
      o.value = t.label;
      o.textContent = t.label;
      pathogenSelect.appendChild(o);
    });
  }
})();


// -----------------------------
// Camera
// -----------------------------
let cam = { x: 0, y: -320, z: 0.30 };
let targetCam = { ...cam };
let isDragging = false;
let last = { x:0, y:0 };

// pulses
let pulses = []; // {x,y,t0,soft}


// -----------------------------
// Tree data
// -----------------------------
let segments = []; // {x1,y1,x2,y2, depth, clade, sub, coverage, k1, k2}
let labels   = []; // {x,y,text, kind, coverage, bucket?}

const cladeCoverage = {
  life: 0.35,
  Bacteria: 0.20,
  Archaea: 0.12,
  Eukaryota: 0.55,
  Fungi: 0.60,
  Viridiplantae: 0.38,
  Metazoa: 0.58,
  Mammalia: 0.72,
};


// -----------------------------
// Seeded RNG
// -----------------------------
let seed = 1337;
function rand(){
  seed ^= seed << 13; seed |= 0;
  seed ^= seed >>> 17; seed |= 0;
  seed ^= seed << 5; seed |= 0;
  return ((seed >>> 0) / 4294967296);
}
function randf(a,b){ return a + (b-a)*rand(); }
function randn(){
  let u=0, v=0;
  while(u===0) u = rand();
  while(v===0) v = rand();
  return Math.sqrt(-2.0*Math.log(u))*Math.cos(2.0*Math.PI*v);
}


// -----------------------------
// Helpers
// -----------------------------
function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function lerpPt(p,q,t){ return { x: lerp(p.x,q.x,t), y: lerp(p.y,q.y,t) }; }

function ptKey(x,y){
  const q = (n) => Math.round(n * 10) / 10;
  return `${q(x)},${q(y)}`;
}

function addSeg(x1,y1,x2,y2,depth,clade,coverage){
  const k1 = ptKey(x1,y1);
  const k2 = ptKey(x2,y2);
  segments.push({ x1,y1,x2,y2, depth, clade, sub:null, coverage, k1, k2 });

  const prev = parentOf.get(k2);
  if(!prev || depth < prev._d){
    parentOf.set(k2, { k: k1, _d: depth });
  }
}

function computePathKeys(x,y){
  const start = ptKey(x,y);
  const out = new Set();
  let cur = start;
  let guard = 0;
  while(cur && guard++ < 5000){
    out.add(cur);
    const rec = parentOf.get(cur);
    cur = rec ? rec.k : null;
  }
  return out;
}

function setHud(label){
  hudWhere.textContent = `Tree: ${label || "life"}`;
}


// -----------------------------
// Build tree + semantic subclades
// -----------------------------
function buildTree(){
  segments = [];
  labels = [];
  parentOf = new Map();
  selectedPathKeys = new Set();
  activeTaxonLabel = null;

  // world geometry
  const trunkLen = 980;
  const origin = { x: 0, y: 360 };
  const trunkEnd = { x: 0, y: origin.y - trunkLen };

  anchors.origin = origin;
  anchors.trunkEnd = trunkEnd;

  addSeg(origin.x, origin.y, trunkEnd.x, trunkEnd.y, 0, "life", cladeCoverage.life);

  const forks = [
    { name:"Bacteria",  ang: -Math.PI/2 + 0.62, len: 860 },
    { name:"Archaea",   ang: -Math.PI/2,        len: 760 },
    { name:"Eukaryota", ang: -Math.PI/2 - 0.62, len: 930 },
  ];

  const forkBase = lerpPt(origin, trunkEnd, 0.78);
  anchors.forkBase = forkBase;

  let endB=null, endA=null, endE=null;

  for(const f of forks){
    const end = { x: forkBase.x + Math.cos(f.ang)*f.len, y: forkBase.y + Math.sin(f.ang)*f.len };
    addSeg(forkBase.x, forkBase.y, end.x, end.y, 1, f.name, cladeCoverage[f.name] ?? 0.3);
    branch(end.x, end.y, f.ang, f.len*0.92, 2, f.name);
    if(f.name==="Bacteria") endB=end;
    if(f.name==="Archaea") endA=end;
    if(f.name==="Eukaryota") endE=end;
  }

  anchors.endB = endB;
  anchors.endA = endA;
  anchors.endE = endE;

  // High labels (quiet)
  labels.push({ x: trunkEnd.x, y: trunkEnd.y, text:"life", kind:"clade", coverage: cladeCoverage.life });
  labels.push({ x: forkBase.x + 55, y: forkBase.y - 30, text:"Bacteria", kind:"clade", coverage: cladeCoverage.Bacteria });
  labels.push({ x: forkBase.x + 15, y: forkBase.y - 62, text:"Archaea", kind:"clade", coverage: cladeCoverage.Archaea });
  labels.push({ x: forkBase.x - 95, y: forkBase.y - 30, text:"Eukaryota", kind:"clade", coverage: cladeCoverage.Eukaryota });

  pinTaxa();
  tagEukSubclades(); // assigns segments[].sub for Eukaryota into Fungi/Plants/Metazoa/Mammalia regions

  // Start framed, no highlights
  frameFullTree();
}

function branch(x, y, ang, len, depth, clade){
  if(depth > 11 || len < 42) return;

  const spread = 0.62 / (1 + depth*0.12);
  const jitter = 0.10;

  const ang1 = ang + spread + (randn()*jitter);
  const ang2 = ang - spread + (randn()*jitter);

  const k = 0.78 + randf(-0.04, 0.04);
  const len1 = len * k;
  const len2 = len * k * (0.96 + randf(-0.03, 0.03));

  const midPull = 0.14;

  const cx1 = x + Math.cos(ang)*len*0.45 + Math.cos(ang + Math.PI/2)*len*midPull*(0.6+randf(-0.2,0.2));
  const cy1 = y + Math.sin(ang)*len*0.45 + Math.sin(ang + Math.PI/2)*len*midPull*(0.6+randf(-0.2,0.2));
  const x1  = x + Math.cos(ang1)*len1;
  const y1  = y + Math.sin(ang1)*len1;

  addSeg(x, y, cx1, cy1, depth, clade, cladeCoverage[clade] ?? 0.3);
  addSeg(cx1, cy1, x1, y1, depth, clade, cladeCoverage[clade] ?? 0.3);

  const cx2 = x + Math.cos(ang)*len*0.45 + Math.cos(ang - Math.PI/2)*len*midPull*(0.6+randf(-0.2,0.2));
  const cy2 = y + Math.sin(ang)*len*0.45 + Math.sin(ang - Math.PI/2)*len*midPull*(0.6+randf(-0.2,0.2));
  const x2  = x + Math.cos(ang2)*len2;
  const y2  = y + Math.sin(ang2)*len2;

  addSeg(x, y, cx2, cy2, depth, clade, cladeCoverage[clade] ?? 0.3);
  addSeg(cx2, cy2, x2, y2, depth, clade, cladeCoverage[clade] ?? 0.3);

  branch(x1, y1, ang1, len1, depth+1, clade);
  branch(x2, y2, ang2, len2, depth+1, clade);
}

function pinTaxa(){
  // Pick fringe endpoints within each domain canopy
  const candidates = segments
    .filter(s => s.depth >= 7)
    .map(s => ({ x:s.x2, y:s.y2, clade:s.clade, depth:s.depth }));

  function choose(clade, n, dir){
    const pool = candidates.filter(c => c.clade === clade);
    pool.sort((a,b) => (b.x*dir.x + b.y*dir.y) - (a.x*dir.x + a.y*dir.y));
    return pool.slice(0, n);
  }

  const dirs = {
    Bacteria:  { x:  1,  y: -0.1 },
    Archaea:   { x:  0.2,y: -1   },
    Eukaryota: { x: -1,  y: -0.1 },
  };

  const pickB = choose("Bacteria", 7, dirs.Bacteria);
  const pickA = choose("Archaea",  3, dirs.Archaea);
  const pickE = choose("Eukaryota", 10, dirs.Eukaryota);

  // Map taxa to points (deterministic ordering)
  const mapping = new Map();
  const byClade = {
    Bacteria: TAXA.filter(t=>t.clade==="Bacteria"),
    Archaea: TAXA.filter(t=>t.clade==="Archaea"),
    Eukaryota: TAXA.filter(t=>["Eukaryota","Fungi","Viridiplantae","Metazoa","Mammalia"].includes(t.clade))
  };

  // assign bacteria
  byClade.Bacteria.forEach((t,i)=> { if(pickB[i]) mapping.set(t.key, pickB[i]); });
  byClade.Archaea.forEach((t,i)=> { if(pickA[i]) mapping.set(t.key, pickA[i]); });
  byClade.Eukaryota.forEach((t,i)=> { if(pickE[i]) mapping.set(t.key, pickE[i]); });

  for(const t of TAXA){
    const p = mapping.get(t.key);
    if(!p) continue;
    labels.push({ x:p.x, y:p.y, text:t.label, kind:"taxon", coverage:t.demoCoverage, bucket:t.bucket });
  }

  // Add clade anchors inside euk canopy (these help click + semantics)
  const eukSegs = segments.filter(s => s.clade === "Eukaryota" && s.depth >= 4 && s.depth <= 6);
  if(eukSegs.length){
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.20)].x2, y: eukSegs[Math.floor(eukSegs.length*0.20)].y2, text:"Fungi", kind:"clade", coverage: cladeCoverage.Fungi });
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.52)].x2, y: eukSegs[Math.floor(eukSegs.length*0.52)].y2, text:"Viridiplantae", kind:"clade", coverage: cladeCoverage.Viridiplantae });
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.70)].x2, y: eukSegs[Math.floor(eukSegs.length*0.70)].y2, text:"Metazoa", kind:"clade", coverage: cladeCoverage.Metazoa });
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.82)].x2, y: eukSegs[Math.floor(eukSegs.length*0.82)].y2, text:"Mammalia", kind:"clade", coverage: cladeCoverage.Mammalia });
  }
}

// Partition eukaryota canopy into subclade regions (schematic but consistent)
function tagEukSubclades(){
  const base = anchors.forkBase;
  const endE = anchors.endE;
  if(!endE) return;

  // direction vector from forkBase->endE defines euk “spine”
  const vx = endE.x - base.x;
  const vy = endE.y - base.y;
  const spineAng = Math.atan2(vy, vx);

  for(const s of segments){
    if(s.clade !== "Eukaryota") continue;

    // Use angle around spine + position along canopy to assign subclade
    const dx = s.x2 - endE.x;
    const dy = s.y2 - endE.y;
    const ang = Math.atan2(dy, dx);

    // normalize angle difference
    let d = ang - spineAng;
    while(d < -Math.PI) d += 2*Math.PI;
    while(d >  Math.PI) d -= 2*Math.PI;

    // Partition into three broad sectors:
    // (These are not “true topology,” but they enforce correct containment)
    // left sector => Viridiplantae, middle => Fungi, right => Metazoa
    if(d < -0.60) s.sub = "Viridiplantae";
    else if(d > 0.60) s.sub = "Metazoa";
    else s.sub = "Fungi";

    // Mammalia subset within Metazoa: deeper + within a narrower band
    if(s.sub === "Metazoa" && s.depth >= 7){
      if(d > 0.90) s.sub = "Mammalia";
    }
  }
}


// -----------------------------
// Time slider (landmarks) – accurate labels, schematic mapping
// -----------------------------
const TIME_PRESETS = [
  { label: "Early life (~3.8–3.5 Ga)", depth: 2 },
  { label: "Great Oxidation (~2.4 Ga)", depth: 4 },
  { label: "Early eukaryotes (LECA window ~2.0–1.6 Ga)", depth: 6 },
  { label: "Animals (~800–600 Ma)", depth: 8 },
  { label: "Mammals (~200 Ma)", depth: 10 },
  { label: "Present", depth: 11 },
];

function applyTimeLevel(level){
  timeLevel = clamp(level, 0, 5);
  maxDepthAllowed = TIME_PRESETS[timeLevel].depth;
  if(timeLabel) timeLabel.textContent = TIME_PRESETS[timeLevel].label;
}

function runTour(name){
  if(!name) return;
  // clear current clades but keep current taxon highlight unless tour says otherwise
  activeClades.clear();
  activeTaxonLabel = null;
  selectedPathKeys = new Set();

  if(name === "endosymbiosis"){
    activeClades.add("Eukaryota");
    layerMode = "mito";
    if(layerSel) layerSel.value = "mito";
    hudLayer.textContent = `Layer: mito`;
    applyTimeLevel(2); // LECA window
    setHud("Endosymbiosis");
  } else if(name === "multicellularity"){
    activeClades.add("Eukaryota");
    activeClades.add("Metazoa");
    activeClades.add("Fungi");
    activeClades.add("Viridiplantae");
    layerMode = "rainbow";
    if(layerSel) layerSel.value = "rainbow";
    hudLayer.textContent = `Layer: rainbow`;
    applyTimeLevel(3);
    setHud("Multicellularity");
  } else if(name === "models"){
    layerMode = "none";
    if(layerSel) layerSel.value = "none";
    hudLayer.textContent = `Layer: none`;
    applyTimeLevel(5);
    // pulse through a few
    highlightTaxonByName("Escherichia coli");
    setTimeout(()=>highlightTaxonByName("Saccharomyces cerevisiae"), 700);
    setTimeout(()=>highlightTaxonByName("Drosophila melanogaster"), 1400);
    setTimeout(()=>highlightTaxonByName("Mus musculus"), 2100);
    setTimeout(()=>highlightTaxonByName("Homo sapiens"), 2800);
    setHud("Model systems");
  } else if(name === "pathogens"){
    layerMode = "demo_struct";
    if(layerSel) layerSel.value = "demo_struct";
    hudLayer.textContent = `Layer: demo_struct`;
    applyTimeLevel(5);
    highlightTaxonByName("Mycobacterium tuberculosis");
    setTimeout(()=>highlightTaxonByName("Helicobacter pylori"), 900);
    setTimeout(()=>highlightTaxonByName("Plasmodium falciparum"), 1800);
    setHud("Pathogens");
  } else if(name === "domains"){
    activeClades.add("Bacteria");
    activeClades.add("Archaea");
    activeClades.add("Eukaryota");
    layerMode = "rainbow";
    if(layerSel) layerSel.value = "rainbow";
    hudLayer.textContent = `Layer: rainbow`;
    applyTimeLevel(5);
    setHud("Domains");
  }

  // keep camera framed
  frameFullTree();
}


// -----------------------------
// Highlighting logic
// -----------------------------
function normalizeCladeQuery(q){
  const s = q.trim().toLowerCase();
  const map = {
    bacteria:"Bacteria",
    archaea:"Archaea",
    eukaryota:"Eukaryota",
    eukarya:"Eukaryota",
    animals:"Metazoa",
    metazoa:"Metazoa",
    fungi:"Fungi",
    plants:"Viridiplantae",
    viridiplantae:"Viridiplantae",
    mammals:"Mammalia",
    mammalia:"Mammalia",
    life:"life"
  };
  return map[s] || null;
}

function highlightTaxonByName(name){
  let L = labels.find(x => x.kind === "taxon" && x.text.toLowerCase() === name.toLowerCase());
  if(!L){
    const ql = name.toLowerCase();
    L = labels.find(x => x.kind === "taxon" && x.text.toLowerCase().includes(ql));
  }
  if(!L){
    // no match; small pulse at center
    if(pulseEnabled) pulseAt(cam.x, cam.y, false);
    return;
  }

  activeTaxonLabel = L;
  selectedPathKeys = computePathKeys(L.x, L.y);

  // also automatically light the correct clade stack for comprehension
  const inferred = inferCladeStackForTaxon(L);
  inferred.forEach(c => activeClades.add(c));

  setHud(L.text);
  if(pulseEnabled) pulseAt(L.x, L.y, true);
}

// ensures mammals ⊂ animals ⊂ eukaryota always reads right
function inferCladeStackForTaxon(L){
  const out = [];
  // Find by nearest segments? We use taxon string heuristics + existing canonical mapping from TAXA
  const t = TAXA.find(x => x.label === L.text);
  if(!t) return out;

  if(t.clade === "Bacteria") out.push("Bacteria");
  else if(t.clade === "Archaea") out.push("Archaea");
  else {
    out.push("Eukaryota");
    if(t.clade === "Fungi") out.push("Fungi");
    if(t.clade === "Viridiplantae") out.push("Viridiplantae");
    if(t.clade === "Metazoa") out.push("Metazoa");
    if(t.clade === "Mammalia") { out.push("Metazoa"); out.push("Mammalia"); }
    if(t.clade === "Eukaryota") out.push("Eukaryota");
  }
  return out;
}


// -----------------------------
// Canvas coordinate transforms
// -----------------------------
function worldToScreen(x,y){
  const r = viewEl.getBoundingClientRect();
  const cx = r.width/2, cy = r.height/2;
  return { x: (x - cam.x)*cam.z + cx, y: (y - cam.y)*cam.z + cy };
}
function screenToWorldX(sx){
  const r = viewEl.getBoundingClientRect();
  const cx = r.width/2;
  return cam.x + (sx - cx)/cam.z;
}
function screenToWorldY(sy){
  const r = viewEl.getBoundingClientRect();
  const cy = r.height/2;
  return cam.y + (sy - cy)/cam.z;
}
function nearestLabel(wx, wy){
  let best=null, bestD=Infinity;
  for(const L of labels){
    const dx=L.x-wx, dy=L.y-wy;
    const d=dx*dx+dy*dy;
    if(d<bestD){ bestD=d; best=L; }
  }
  const thresh = (140 / cam.z);
  return (best && bestD < thresh*thresh) ? best : null;
}


// -----------------------------
// Interactions: pan/zoom + dblclick highlight
// -----------------------------
viewEl.addEventListener('mousedown', (e) => {
  isDragging = true;
  last.x = e.clientX; last.y = e.clientY;
});
window.addEventListener('mouseup', () => { isDragging = false; });
window.addEventListener('mousemove', (e) => {
  if(!isDragging) return;
  const dx = e.clientX - last.x;
  const dy = e.clientY - last.y;
  last.x = e.clientX; last.y = e.clientY;
  targetCam.x -= dx / targetCam.z;
  targetCam.y -= dy / targetCam.z;
});

viewEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = viewEl.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientX; // not used for y calc? fix:
  const my2 = e.clientY - r.top;

  const zoomFactor = Math.exp((-e.deltaY) * 0.0012);

  const wxBefore = screenToWorldX(mx);
  const wyBefore = screenToWorldY(my2);

  targetCam.z = clamp(targetCam.z * zoomFactor, 0.08, 2.6);

  const wxAfter = screenToWorldX(mx);
  const wyAfter = screenToWorldY(my2);

  targetCam.x += (wxBefore - wxAfter);
  targetCam.y += (wyBefore - wyAfter);
}, { passive:false });

viewEl.addEventListener('dblclick', (e) => {
  const r = viewEl.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const wx = screenToWorldX(mx);
  const wy = screenToWorldY(my);
  const n = nearestLabel(wx, wy);
  if(n){
    if(n.kind === "taxon") highlightTaxonByName(n.text);
    else {
      // clade toggle on double click clade label
      const canon = normalizeCladeQuery(n.text);
      if(canon && canon !== "life"){
        if(activeClades.has(canon)) activeClades.delete(canon);
        else activeClades.add(canon);
        setHud(activeClades.size ? Array.from(activeClades).join(", ") : "life");
      }
    }
  } else {
    if(pulseEnabled) pulseAt(wx, wy, false);
  }
});


// -----------------------------
// Pulses
// -----------------------------
function pulseAt(x,y,soft){
  pulses.push({ x, y, t0: performance.now(), soft });
  if(pulses.length > 10) pulses.shift();
}


// -----------------------------
// Color helpers
// -----------------------------
function getCss(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function hexToRgb(h){
  const x = h.replace('#','').trim();
  const n = parseInt(x, 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function lerpColor(a,b,t){
  const r = Math.round(lerp(a.r,b.r,t));
  const g = Math.round(lerp(a.g,b.g,t));
  const b2= Math.round(lerp(a.b,b.b,t));
  return `rgb(${r},${g},${b2})`;
}
function colorForCoverage(v){
  // uses CSS vars you already have (hot/warn/good)
  if(v <= 0.5){
    const t = v/0.5;
    return lerpColor(hexToRgb(getCss('--hot') || "#d45a5a"), hexToRgb(getCss('--warn') || "#d7a23a"), t);
  }else{
    const t = (v-0.5)/0.5;
    return lerpColor(hexToRgb(getCss('--warn') || "#d7a23a"), hexToRgb(getCss('--good') || "#2fa86f"), t);
  }
}


// -----------------------------
// Resize + framing full tree
// -----------------------------
function resize(){
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const r = viewEl.getBoundingClientRect();
  canvas.width = Math.floor(r.width * dpr);
  canvas.height = Math.floor(r.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', () => { resize(); frameFullTree(true); });

function computeBounds(){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const s of segments){
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  return {minX,minY,maxX,maxY};
}

function frameFullTree(immediate=false){
  if(!segments.length) return;
  const b = computeBounds();
  const r = viewEl.getBoundingClientRect();

  const pad = 120; // generous breathing room
  const w = (b.maxX - b.minX) + pad*2;
  const h = (b.maxY - b.minY) + pad*2;

  const cx = (b.minX + b.maxX)/2;
  const cy = (b.minY + b.maxY)/2;

  // choose scale so full bounds fit viewport
  const sx = r.width / w;
  const sy = r.height / h;
  const z = Math.min(sx, sy);

  if(immediate){
    cam = { x: cx, y: cy, z };
    targetCam = { ...cam };
  } else {
    targetCam.x = cx;
    targetCam.y = cy;
    targetCam.z = z;
  }
}


// -----------------------------
// Render loop
// -----------------------------
function draw(){
  const r = viewEl.getBoundingClientRect();

  // smooth camera
  cam.x = lerp(cam.x, targetCam.x, 0.08);
  cam.y = lerp(cam.y, targetCam.y, 0.08);
  cam.z = lerp(cam.z, targetCam.z, 0.08);
  hudZoom.textContent = `Zoom: ${cam.z.toFixed(2)}`;

  // background (white)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // time mask
  const depthCut = maxDepthAllowed;

  // base contrast scales with zoom (subtle)
  const baseAlpha = clamp(0.20 + 0.10*Math.min(1, cam.z/1.2), 0.18, 0.32);
  const baseStroke = `rgba(20,28,40,${baseAlpha})`;

  const now = performance.now();
  const breathe = 0.55 + 0.45*Math.sin(now*0.0012);

  // Draw branches with weighted highlight
  for(const s of segments){
    if(s.depth > depthCut) continue;

    const p1 = worldToScreen(s.x1, s.y1);
    const p2 = worldToScreen(s.x2, s.y2);

    if((p1.x < -80 && p2.x < -80) || (p1.x > r.width+80 && p2.x > r.width+80) ||
       (p1.y < -80 && p2.y < -80) || (p1.y > r.height+80 && p2.y > r.height+80)) continue;

    // base width
    const baseW = Math.max(0.55, 3.0 - s.depth*0.20);
    let w = baseW * Math.pow(1/cam.z, 0.12);

    // layer color
    let stroke = baseStroke;

    if(layerMode === 'demo_struct'){
      const cov = (s.coverage ?? 0.3);
      const col = colorForCoverage(cov);
      stroke = col.replace('rgb','rgba').replace(')',`,${0.22})`);
    } else if(layerMode === 'rainbow'){
      const baseHue =
        (s.clade === 'Eukaryota') ? 120 :
        (s.clade === 'Bacteria')  ? 210 :
        (s.clade === 'Archaea')   ? 170 : 260;
      const hue = (baseHue + s.depth*16) % 360;
      stroke = `hsla(${hue}, 45%, 45%, 0.20)`;
    } else if(layerMode === 'mito'){
      // euk branches get subtle green wash
      const isEuk = (s.clade === 'Eukaryota');
      stroke = isEuk ? 'rgba(47,168,111,0.24)' : baseStroke;
    }

    // highlight weighting
    let weight = 0;

    // domain clades
    if(activeClades.has(s.clade)) weight += 1;

    // euk subclades (schematic region tags)
    if(s.clade === "Eukaryota"){
      if(activeClades.has("Metazoa") && (s.sub === "Metazoa" || s.sub === "Mammalia")) weight += 1;
      if(activeClades.has("Mammalia") && (s.sub === "Mammalia")) weight += 1;
      if(activeClades.has("Fungi") && (s.sub === "Fungi")) weight += 1;
      if(activeClades.has("Viridiplantae") && (s.sub === "Viridiplantae")) weight += 1;
      if(activeClades.has("Eukaryota")) weight += 0.4; // keep euk canopy softly lit
    }

    // trunk-to-split path should light when any clade is active
    if(activeClades.size && s.clade === "life") weight += 0.8;

    // selected taxon path overrides
    const onPath = activeTaxonLabel && (selectedPathKeys.has(s.k2) || selectedPathKeys.has(s.k1));
    if(onPath) weight += 2.0;

    if(weight > 0){
      const a = clamp(0.18 + 0.10*weight + 0.08*breathe*(onPath?1:0), 0.22, 0.85);
      stroke = `rgba(47,107,255,${a})`;
      w *= (1.0 + 0.35*weight + (onPath ? 0.18*breathe : 0));
    }

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  // Labels (only when zoomed in enough; always readable)
  for(const L of labels){
    const p = worldToScreen(L.x, L.y);
    if(p.x < -120 || p.x > r.width+120 || p.y < -120 || p.y > r.height+120) continue;

    const isTaxon = (L.kind === 'taxon');
    const show = isTaxon ? (cam.z > 0.22) : (cam.z > 0.16);
    if(!show) continue;

    // fade in with zoom
    const alpha = isTaxon
      ? clamp((cam.z - 0.16)/1.0, 0.0, 1.0)
      : clamp((cam.z - 0.10)/0.8, 0.0, 0.65);

    // dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, isTaxon ? 2.6 : 2.0, 0, Math.PI*2);
    ctx.fillStyle = `rgba(10,14,18,${0.45*alpha})`;
    ctx.fill();

    // text
    ctx.font = `12px ${getCss('--mono') || 'ui-monospace'}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(10,14,18,${0.65*alpha})`;
    ctx.fillText(L.text, p.x + 8, p.y);
  }

  // Pulses
  if(!pulseEnabled) pulses = [];

  const now2 = performance.now();
  pulses = pulses.filter(P => now2 - P.t0 < 1100);
  for(const P of pulses){
    const p = worldToScreen(P.x, P.y);
    const t = (now2 - P.t0) / 1100;
    const k = P.soft ? 0.7 : 1.0;
    const rad = (18 + 120*t) * k;
    const a = (1 - t);

    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(47,107,255,${0.18*a})`;
    ctx.stroke();
  }

  // Selected organism rings (slow, gently irregular)
  if(activeTaxonLabel && pulseEnabled){
    const p = worldToScreen(activeTaxonLabel.x, activeTaxonLabel.y);
    const base = 16 + 10*Math.sin(now2*0.00037 + 1.7);
    const drift = 0.5 + 0.5*Math.sin(now2*0.00023 + 3.1);

    for(let i=0;i<3;i++){
      const tt = now2*0.00015 + i*1.9;
      const rad = base + i*22 + 14*Math.sin(tt + i*0.6)*drift;
      const a = 0.10 + 0.06*Math.sin(tt*1.7 + i);

      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(47,107,255,${a})`;
      ctx.stroke();
    }
  }

  requestAnimationFrame(draw);
}


// -----------------------------
// Init
// -----------------------------
function applyDefaultUI(){
  hudLayer.textContent = `Layer: ${layerMode}`;
  setHud("life");

  // If time slider exists, initialize label and depth
  if(timeSlider){
    timeSlider.min = "0";
    timeSlider.max = "5";
    timeSlider.step = "1";
    timeSlider.value = String(timeLevel);
    applyTimeLevel(timeLevel);
  } else {
    maxDepthAllowed = 11;
  }

  // If explore tours exists
  if(exploreTour){
    // no auto-run
    exploreTour.value = "";
  }
}

resize();
applyDefaultUI();
buildTree();
frameFullTree(true);
draw();