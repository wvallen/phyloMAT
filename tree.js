/* Fractal Tree Explorer (fast, elegant, non-cartoon)
   - Canvas pan/zoom
   - Fly to labels
   - Curated taxa pinned to canopy
   - Demo coverage overlay (placeholder)
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

let layerMode = layerSel.value;

// ---- UI wiring
spinBtn.addEventListener('click', () => {
  const on = header.classList.toggle('spinOn');
  spinBtn.textContent = on ? 'Spin: ON' : 'Spin: OFF';
  spinBtn.setAttribute('aria-pressed', String(on));
});

aboutBtn.addEventListener('click', () => { modalBack.style.display = 'flex'; });
closeModalBtn.addEventListener('click', () => { modalBack.style.display = 'none'; });
modalBack.addEventListener('click', (e) => { if (e.target === modalBack) modalBack.style.display = 'none'; });
window.addEventListener('keydown', (e) => { if(e.key === 'Escape') modalBack.style.display = 'none'; });

layerSel.addEventListener('change', () => {
  layerMode = layerSel.value;
  hudLayer.textContent = `Layer: ${layerMode}`;
});

document.getElementById('homeBtn').addEventListener('click', () => flyToLabel('life'));
document.getElementById('flySelected').addEventListener('click', () => {
  const t = TAXA.find(x => x.key === taxaSelect.value);
  if(t) flyToLabel(t.label);
});
document.getElementById('pulseSelected').addEventListener('click', () => {
  const t = TAXA.find(x => x.key === taxaSelect.value);
  if(!t) return;
  const L = labels.find(n => n.text === t.label);
  if(L) pulseAt(L.x, L.y, true);
});

document.querySelectorAll('[data-fly]').forEach(b => {
  b.addEventListener('click', () => flyToLabel(b.getAttribute('data-fly')));
});

search.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter') return;
  const q = (search.value || '').trim();
  if(q) flyToLabel(q);
});

// ---- Taxa (curated)
const TAXA = [
  { key:"hsap", label:"Homo sapiens", clade:"Mammalia",   demoCoverage:0.96 },
  { key:"mmus", label:"Mus musculus", clade:"Mammalia",   demoCoverage:0.88 },
  { key:"dmel", label:"Drosophila melanogaster", clade:"Metazoa", demoCoverage:0.62 },
  { key:"cele", label:"Caenorhabditis elegans", clade:"Metazoa",  demoCoverage:0.55 },
  { key:"athal", label:"Arabidopsis thaliana", clade:"Viridiplantae", demoCoverage:0.46 },
  { key:"scer", label:"Saccharomyces cerevisiae", clade:"Fungi", demoCoverage:0.70 },
  { key:"pfal", label:"Plasmodium falciparum", clade:"Eukaryota", demoCoverage:0.28 },

  { key:"ecoli", label:"Escherichia coli K-12", clade:"Bacteria", demoCoverage:0.40 },
  { key:"bsub",  label:"Bacillus subtilis",     clade:"Bacteria", demoCoverage:0.34 },
  { key:"mtb",   label:"Mycobacterium tuberculosis", clade:"Bacteria", demoCoverage:0.22 },
  { key:"hpyl",  label:"Helicobacter pylori 26695",  clade:"Bacteria", demoCoverage:0.18 },
  { key:"tmar",  label:"Thermotoga maritima",   clade:"Bacteria", demoCoverage:0.10 },

  { key:"mjann", label:"Methanocaldococcus jannaschii", clade:"Archaea", demoCoverage:0.12 },
  { key:"afulg", label:"Archaeoglobus fulgidus",        clade:"Archaea", demoCoverage:0.14 },
];

(function populateTaxa(){
  taxaSelect.innerHTML = '';
  for(const t of TAXA){
    const opt = document.createElement('option');
    opt.value = t.key;
    opt.textContent = t.label;
    taxaSelect.appendChild(opt);
  }
  taxaSelect.value = 'hsap';
})();

// ---- Camera
let cam = { x: 0, y: -320, z: 0.35 };
let targetCam = { ...cam };
let isDragging = false;
let last = { x:0, y:0 };

// pulses
let pulses = []; // {x,y,t0,soft}

// ---- Data
let segments = []; // {x1,y1,x2,y2, depth, clade, coverage}
let labels   = []; // {x,y,text, kind, coverage}

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

// ---- Seeded RNG
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

// ---- Helpers
function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function lerpPt(p,q,t){ return { x: lerp(p.x,q.x,t), y: lerp(p.y,q.y,t) }; }
function addSeg(x1,y1,x2,y2,depth,clade,coverage){
  segments.push({ x1,y1,x2,y2, depth, clade, coverage });
}

// ---- Build fractal phylogeny-like tree
function buildTree(){
  segments = [];
  labels = [];

  const trunkLen = 900;
  const origin = { x: 0, y: 320 };
  const trunkEnd = { x: 0, y: origin.y - trunkLen };

  addSeg(origin.x, origin.y, trunkEnd.x, trunkEnd.y, 0, "life", cladeCoverage.life);

  const forks = [
    { name:"Bacteria",  ang: -Math.PI/2 + 0.60, len: 760 },
    { name:"Archaea",   ang: -Math.PI/2,        len: 640 },
    { name:"Eukaryota", ang: -Math.PI/2 - 0.60, len: 820 },
  ];

  const forkBase = lerpPt(origin, trunkEnd, 0.78);
  for(const f of forks){
    const end = { x: forkBase.x + Math.cos(f.ang)*f.len, y: forkBase.y + Math.sin(f.ang)*f.len };
    addSeg(forkBase.x, forkBase.y, end.x, end.y, 1, f.name, cladeCoverage[f.name] ?? 0.3);
    branch(end.x, end.y, f.ang, f.len*0.92, 2, f.name);
  }

  labels.push({ x: trunkEnd.x, y: trunkEnd.y, text:"life", kind:"clade", coverage: cladeCoverage.life });
  labels.push({ x: forkBase.x + 40, y: forkBase.y - 30, text:"Bacteria", kind:"clade", coverage: cladeCoverage.Bacteria });
  labels.push({ x: forkBase.x + 10, y: forkBase.y - 60, text:"Archaea", kind:"clade", coverage: cladeCoverage.Archaea });
  labels.push({ x: forkBase.x - 80, y: forkBase.y - 30, text:"Eukaryota", kind:"clade", coverage: cladeCoverage.Eukaryota });

  pinTaxa();
}

function branch(x, y, ang, len, depth, clade){
  if(depth > 11 || len < 40) return;

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

  const pickB = choose("Bacteria", 6, dirs.Bacteria);
  const pickA = choose("Archaea",  2, dirs.Archaea);
  const pickE = choose("Eukaryota", 7, dirs.Eukaryota);

  const mapping = {
    ecoli: pickB[0], bsub: pickB[1], mtb: pickB[2], hpyl: pickB[3], tmar: pickB[4],
    mjann: pickA[0], afulg: pickA[1],
    scer: pickE[0], pfal: pickE[1], athal: pickE[2], cele: pickE[3], dmel: pickE[4], mmus: pickE[5], hsap: pickE[6],
  };

  for(const t of TAXA){
    const p = mapping[t.key];
    if(!p) continue;
    labels.push({ x:p.x, y:p.y, text:t.label, kind:"taxon", coverage:t.demoCoverage });
  }

  const eukSegs = segments.filter(s => s.clade === "Eukaryota" && s.depth >= 4 && s.depth <= 6);
  if(eukSegs.length){
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.20)].x2, y: eukSegs[Math.floor(eukSegs.length*0.20)].y2, text:"Fungi", kind:"clade", coverage: cladeCoverage.Fungi });
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.52)].x2, y: eukSegs[Math.floor(eukSegs.length*0.52)].y2, text:"Viridiplantae", kind:"clade", coverage: cladeCoverage.Viridiplantae });
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.70)].x2, y: eukSegs[Math.floor(eukSegs.length*0.70)].y2, text:"Metazoa", kind:"clade", coverage: cladeCoverage.Metazoa });
    labels.push({ x: eukSegs[Math.floor(eukSegs.length*0.82)].x2, y: eukSegs[Math.floor(eukSegs.length*0.82)].y2, text:"Mammalia", kind:"clade", coverage: cladeCoverage.Mammalia });
  }
}

// ---- Coordinate transforms
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

// ---- Interactions
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
  const my = e.clientY - r.top;

  const zoomFactor = Math.exp((-e.deltaY) * 0.0012);

  const wxBefore = screenToWorldX(mx);
  const wyBefore = screenToWorldY(my);

  targetCam.z = clamp(targetCam.z * zoomFactor, 0.08, 2.6);

  const wxAfter = screenToWorldX(mx);
  const wyAfter = screenToWorldY(my);

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
  if(n) flyToLabel(n.text);
  else pulseAt(wx, wy, false);
});

// ---- Fly + pulse
function startFly(x,y,z,name){
  targetCam.x = x;
  targetCam.y = y;
  targetCam.z = z;
  hudWhere.textContent = `Tree: ${name}`;
  pulseAt(x,y,true);
}
function flyToLabel(name){
  const q = (name || '').trim();
  if(!q) return;

  if(q.toLowerCase() === 'life'){
    startFly(0, -320, 0.35, 'life');
    return;
  }

  let L = labels.find(x => x.text.toLowerCase() === q.toLowerCase());
  if(!L){
    const ql = q.toLowerCase();
    L = labels.find(x => x.text.toLowerCase().includes(ql));
  }
  if(!L){
    const map = { animals:'Metazoa', plants:'Viridiplantae', mammals:'Mammalia' };
    const alt = map[q.toLowerCase()];
    if(alt) return flyToLabel(alt);
    pulseAt(cam.x, cam.y, false);
    return;
  }

  const z = (L.kind === 'taxon') ? 1.4 : 0.85;
  startFly(L.x, L.y, z, L.text);
}

function pulseAt(x,y,soft){
  pulses.push({ x, y, t0: performance.now(), soft });
  if(pulses.length > 10) pulses.shift();
}

// ---- Color helpers for overlay
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
  if(v <= 0.5){
    const t = v/0.5;
    return lerpColor(hexToRgb(getCss('--hot')), hexToRgb(getCss('--warn')), t);
  }else{
    const t = (v-0.5)/0.5;
    return lerpColor(hexToRgb(getCss('--warn')), hexToRgb(getCss('--good')), t);
  }
}

// ---- Resize
function resize(){
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const r = viewEl.getBoundingClientRect();
  canvas.width = Math.floor(r.width * dpr);
  canvas.height = Math.floor(r.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', resize);

// ---- Render loop
function draw(){
  const r = viewEl.getBoundingClientRect();

  // smooth camera
  cam.x = lerp(cam.x, targetCam.x, 0.08);
  cam.y = lerp(cam.y, targetCam.y, 0.08);
  cam.z = lerp(cam.z, targetCam.z, 0.08);

  hudZoom.textContent = `Zoom: ${cam.z.toFixed(2)}`;

  // background
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // branches
  for(const s of segments){
    const p1 = worldToScreen(s.x1, s.y1);
    const p2 = worldToScreen(s.x2, s.y2);

    // cull
    if((p1.x < -60 && p2.x < -60) || (p1.x > r.width+60 && p2.x > r.width+60) ||
       (p1.y < -60 && p2.y < -60) || (p1.y > r.height+60 && p2.y > r.height+60)) continue;

    const baseW = Math.max(0.6, 3.2 - s.depth*0.22);
    const w = baseW * Math.pow(1/cam.z, 0.15);

    let stroke = 'rgba(210,225,255,0.18)';
    if(layerMode === 'demo_struct'){
      const cov = (s.coverage ?? 0.3);
      const col = colorForCoverage(cov);
      stroke = (s.depth < 3)
        ? 'rgba(210,225,255,0.16)'
        : col.replace('rgb','rgba').replace(')', `,${0.10 + 0.10*Math.min(1,cam.z/1.2)})`);
    }

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  // labels
  for(const L of labels){
    const p = worldToScreen(L.x, L.y);
    if(p.x < -120 || p.x > r.width+120 || p.y < -120 || p.y > r.height+120) continue;

    const isTaxon = (L.kind === 'taxon');
    const show = isTaxon ? (cam.z > 0.35) : (cam.z > 0.20);
    if(!show) continue;

    const alpha = isTaxon ? clamp((cam.z - 0.25)/1.2, 0.0, 1.0) : clamp((cam.z - 0.12)/0.9, 0.0, 0.7);

    ctx.beginPath();
    ctx.arc(p.x, p.y, isTaxon ? 2.6 : 2.0, 0, Math.PI*2);
    ctx.fillStyle = `rgba(233,233,233,${0.55*alpha})`;
    ctx.fill();

    ctx.font = `12px ${getCss('--mono')}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(233,233,233,${0.70*alpha})`;
    ctx.fillText(L.text, p.x + 8, p.y);

    if(layerMode === 'demo_struct' && isTaxon){
      const cov = clamp(L.coverage ?? 0.3, 0, 1);
      const col = colorForCoverage(cov);
      const wtxt = ctx.measureText(L.text).width;
      ctx.fillStyle = col;
      ctx.fillRect(p.x + 8 + wtxt + 8, p.y - 4, 10, 8);
    }
  }

  // pulses
  const now = performance.now();
  pulses = pulses.filter(P => now - P.t0 < 1100);
  for(const P of pulses){
    const p = worldToScreen(P.x, P.y);
    const t = (now - P.t0) / 1100;
    const k = P.soft ? 0.7 : 1.0;
    const rad = (18 + 120*t) * k;
    const a = (1 - t);

    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(106,169,255,${0.22*a})`;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, rad*0.45, 0, Math.PI*2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(106,169,255,${0.18*a})`;
    ctx.stroke();
  }

  requestAnimationFrame(draw);
}

// ---- init
resize();
hudLayer.textContent = `Layer: ${layerMode}`;
hudWhere.textContent = `Tree: life`;

buildTree();
pulseAt(0, -320, true);
draw();