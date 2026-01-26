// phyloMAT 2.0 — Final Prototype v1
// Click selects; Travel commits; double-click commits.
// Overview renders the whole run as an artifact (chosen + ghost branches).
// Universe is the canvas rectangle; box constraint can end the run naturally.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

// ---------- sizing ----------
let W=0, H=0, DPR=1;
function resize(){
  DPR = Math.max(1, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize", resize);
resize();

// ---------- UI ----------
const UI = {
  btnStart: document.getElementById("btnStart"),
  btnTravel: document.getElementById("btnTravel"),
  btnOverview: document.getElementById("btnOverview"),
  btnReturn: document.getElementById("btnReturn"),
  btnReturn2: document.getElementById("btnReturn2"),
  btnReset: document.getElementById("btnReset"),
  btnPNG: document.getElementById("btnPNG"),

  slOpen: document.getElementById("slOpen"),
  slHor: document.getElementById("slHor"),
  slSpeed: document.getElementById("slSpeed"),

  lbOpen: document.getElementById("lbOpen"),
  lbHor: document.getElementById("lbHor"),
  lbSpeed: document.getElementById("lbSpeed"),

  togBox: document.getElementById("togBox"),
  togGhost: document.getElementById("togGhost"),

  stRun: document.getElementById("stRun"),
  stMode: document.getElementById("stMode"),
  stStep: document.getElementById("stStep"),
  stOpt: document.getElementById("stOpt"),
};

// ---------- helpers ----------
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp  = (a,b,t)=>a+(b-a)*t;
const rand  = (a,b)=>a+Math.random()*(b-a);
const TAU = Math.PI*2;

function easeSmooth(t){ return t*t*(3-2*t); } // smoothstep

function anchor(){
  return { x: W*0.50, y: H*0.78 };
}

// muted “rainbow families” (three roots)
const baseHues = [205, 245, 285];

// ---------- run state ----------
let runID = 0;

let mode = "path";          // "path" | "overview"
let alive = true;

let step = 0;               // committed steps

// world position of the current "you" node inside the universe rectangle
let youWorld = { x: W*0.5, y: H*0.80 };

// history: chosen spine segments
// segment: {x0,y0,x1,y1,hue}
let spine = [];

// ghosts: each step’s unchosen alternatives (segments from you to each unchosen option)
// segment: {x0,y0,x1,y1,a}  (alpha strength)
let ghosts = [];

// current horizon options (world coords)
let horizonA = []; // current
let horizonB = []; // next (during travel)

let selected = null;

// travel tween
let traveling = false;
let tMove = 0;
let moveDur = 0.55; // seconds (from speed slider)
let fromPos = {x:0,y:0};
let toPos   = {x:0,y:0};
let fade = 0; // crossfade A->B during travel

// overview camera (simple zoom-out)
let overview = {
  z: 1,        // 1 = normal, smaller = zoom out
  tz: 1,
  cx: 0, cy: 0 // center
};

// ---------- UI sync ----------
function syncUI(){
  const open = UI.slOpen.value/100;
  UI.lbOpen.textContent = open.toFixed(2);
  UI.lbHor.textContent = UI.slHor.value;
  UI.lbSpeed.textContent = (UI.slSpeed.value/100).toFixed(2);

  UI.stRun.textContent = runID ? `run-${runID}` : "—";
  UI.stMode.textContent = mode;
  UI.stStep.textContent = String(step);
  UI.stOpt.textContent  = String(horizonA.length);

  // travel enabled only when selection exists and not moving and alive and in path
  UI.btnTravel.disabled = !(mode==="path" && alive && !traveling && !!selected);

  // overview/return label-ish behavior
  // buttons exist; wiring below
}

// ---------- option node ----------
function makeNode(stream, x, y){
  const energy = clamp(0.25 + 0.75*Math.random(), 0, 1);
  return {
    stream,
    x, y,
    energy,
    size: lerp(9, 14, 0.3 + 0.7*energy),
    hue: (baseHues[stream] + rand(-18,18) + 360) % 360,
    sat: lerp(28, 62, energy),
    lit: lerp(58, 64, 0.5+0.5*energy),
    phase: Math.random()*TAU,
    omega: lerp(0.010, 0.028, energy),
    orbitR: lerp(3, 10, energy),
    pulse: Math.random()*TAU,
    pulseW: lerp(0.010, 0.026, energy),
  };
}

// ---------- horizon generation (ahead of you, cloud-like) ----------
function generateHorizon(count){
  const open = UI.slOpen.value/100;
  const hor  = +UI.slHor.value;

  // “future band” in front of you (upward on screen)
  const bandDy = -lerp(170, 420, clamp(hor/12,0,1));
  const spreadX = lerp(180, 460, open);
  const spreadY = lerp(35, 130, open);

  // stream centers (3 families)
  const centers = [
    -lerp(180, 260, open),
     0,
     lerp(180, 260, open)
  ];

  const nodes = [];

  // first decision: exactly 3, one per stream
  if(count === 3){
    for(let s=0;s<3;s++){
      const x = youWorld.x + centers[s] + rand(-35,35);
      const y = youWorld.y + bandDy + rand(-25,25);
      nodes.push(makeNode(s, x, y));
    }
    return nodes.filter(n => insideUniverse(n.x, n.y));
  }

  // later: cloud clusters per stream
  const perStream = Math.max(1, Math.round(count/3));
  for(let s=0;s<3;s++){
    for(let i=0;i<perStream;i++){
      const x = youWorld.x + centers[s] + rand(-spreadX*0.35, spreadX*0.35);
      const y = youWorld.y + bandDy + rand(-spreadY, spreadY);
      nodes.push(makeNode(s, x, y));
    }
  }

  // trim and clip to universe
  const clipped = nodes.filter(n => insideUniverse(n.x, n.y));
  while(clipped.length > count) clipped.pop();
  return clipped;
}

function insideUniverse(x,y){
  if(!UI.togBox.checked) return true;
  // Universe is the full rectangle, but we keep a small padding so nodes don’t spawn under UI chrome.
  const pad = 12;
  return (x >= pad && x <= W-pad && y >= pad && y <= H-pad);
}

// ---------- field reset ----------
function resetField(newRun=true){
  if(newRun){
    runID += 1;
    UI.stRun.textContent = `run-${runID}`;
  }

  mode = "path";
  alive = true;

  step = 0;
  youWorld = { x: W*0.5, y: H*0.80 };
  spine = [];
  ghosts = [];

  traveling = false;
  tMove = 0;
  fade = 0;

  overview.z = 1;
  overview.tz = 1;
  overview.cx = W*0.5;
  overview.cy = H*0.5;

  selected = null;

  horizonA = generateHorizon(3); // first decision always 3
  horizonB = [];

  // If box constraint yields 0 options at start (rare, but possible with UI overlap), mark wall.
  if(UI.togBox.checked && horizonA.length === 0){
    alive = false;
    UI.stMode.textContent = "wall";
  }

  syncUI();
}

// ---------- picking ----------
function pickNode(mx, my, nodes){
  // screen coords -> test against nodes in screen coords (world == screen here in path mode)
  let best=null, bestD=Infinity;
  for(const n of nodes){
    const dx = mx - n.x;
    const dy = my - n.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < bestD){ bestD=d2; best=n; }
  }
  if(best && bestD < 60*60) return best;
  return null;
}

// ---------- selection ----------
canvas.addEventListener("click", (ev)=>{
  if(mode !== "path" || traveling || !alive) return;
  const n = pickNode(ev.clientX, ev.clientY, horizonA);
  selected = n;
  syncUI();
});

// double-click commits immediately
canvas.addEventListener("dblclick", (ev)=>{
  if(mode !== "path" || traveling || !alive) return;
  const n = pickNode(ev.clientX, ev.clientY, horizonA);
  if(n){ selected = n; }
  if(selected) beginTravel(selected);
});

// ---------- travel ----------
function beginTravel(node){
  if(traveling || !alive) return;

  // travel duration controlled by Speed slider: faster slider -> shorter duration
  const sp = UI.slSpeed.value/100;
  moveDur = clamp(0.95 - 0.55*sp, 0.18, 0.95);

  traveling = true;
  tMove = 0;
  fade = 0;

  fromPos = { x: youWorld.x, y: youWorld.y };
  // Move to the chosen node position in the universe
  toPos = { x: node.x, y: node.y };

  // Record chosen spine segment (for overview)
  spine.push({
    x0: fromPos.x, y0: fromPos.y,
    x1: toPos.x,   y1: toPos.y,
    hue: node.hue
  });

  // Record ghost alternatives (unchosen)
  if(UI.togGhost.checked){
    for(const o of horizonA){
      if(o === node) continue;
      ghosts.push({
        x0: fromPos.x, y0: fromPos.y,
        x1: o.x, y1: o.y,
        a: 0.22
      });
    }
  }

  // next step increment
  step += 1;

  // prepare next horizon for crossfade
  const open = UI.slOpen.value/100;
  const nextCount = (step === 1) ? 3 : Math.max(2, Math.floor(lerp(4, 24, open)));
  horizonB = generateHorizon(nextCount);

  // Wall: if box constraint and no future nodes can be spawned, the run ends at the wall.
  if(UI.togBox.checked && horizonB.length === 0){
    alive = false;
    // still allow travel animation to complete, then we will show wall state
  }

  selected = null;
  syncUI();
}

// Travel button commits selection
UI.btnTravel.addEventListener("click", ()=>{
  if(mode === "path" && selected && !traveling && alive) beginTravel(selected);
});

// ---------- overview / return ----------
function enterOverview(){
  mode = "overview";
  // compute bounds of all segments for framing
  const bounds = computeBounds();
  // target zoom so bounds fit in viewport
  const pad = 60;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const zx = (W - pad*2) / bw;
  const zy = (H - pad*2) / bh;
  overview.tz = clamp(Math.min(zx, zy), 0.15, 1.0);
  overview.cx = (bounds.minX + bounds.maxX) * 0.5;
  overview.cy = (bounds.minY + bounds.maxY) * 0.5;
  syncUI();
}
function returnToPath(){
  mode = "path";
  overview.tz = 1;
  syncUI();
}

UI.btnOverview.addEventListener("click", ()=> enterOverview());
UI.btnReturn.addEventListener("click", ()=> returnToPath());
UI.btnReturn2.addEventListener("click", ()=> returnToPath());

// ---------- start/reset/png ----------
UI.btnStart.addEventListener("click", ()=> resetField(true));
UI.btnReset.addEventListener("click", ()=> resetField(true));
UI.btnPNG.addEventListener("click", ()=>{
  const a = document.createElement("a");
  a.download = `phylomat2_${runID||"run"}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
});

// sliders should affect the universe live
UI.slOpen.addEventListener("input", ()=>{
  // re-generate current horizon (preserve count)
  const count = (step === 0) ? 3 : Math.max(2, Math.floor(lerp(4, 24, UI.slOpen.value/100)));
  horizonA = generateHorizon(count);
  selected = null;
  syncUI();
});
UI.slHor.addEventListener("input", ()=>{
  const count = horizonA.length || 3;
  horizonA = generateHorizon(count);
  selected = null;
  syncUI();
});
UI.slSpeed.addEventListener("input", ()=> syncUI());

// ---------- drawing ----------
function drawHorizon(nodes, alpha){
  if(alpha <= 0) return;

  const a = anchor();
  const youX = youWorld.x;
  const youY = youWorld.y;

  for(const n of nodes){
    // animate orbit + pulse
    n.phase += n.omega;
    n.pulse += n.pulseW;

    const ox = Math.cos(n.phase)*n.orbitR;
    const oy = Math.sin(n.phase)*n.orbitR*0.60;

    const x = n.x + ox;
    const y = n.y + oy;

    const pulse = 0.88 + 0.12*Math.sin(n.pulse);

    const tension = clamp(0.15 + 0.85*n.energy, 0, 1);
    const sag = (1 - tension) * 75;

    const cx = (youX + x)/2;
    const cy = (youY + y)/2 + sag;

    ctx.strokeStyle = `rgba(0,0,0,${alpha*(0.03 + 0.16*tension)})`;
    ctx.lineWidth = (0.8 + 2.0*tension);
    ctx.beginPath();
    ctx.moveTo(youX, youY);
    ctx.quadraticCurveTo(cx, cy, x, y);
    ctx.stroke();

    const r = n.size * pulse;

    // halo (less balloon)
    ctx.fillStyle = `hsla(${n.hue},${n.sat}%,${n.lit}%,${alpha*(0.06 + 0.12*tension)})`;
    ctx.beginPath();
    ctx.arc(x, y, r*1.7, 0, TAU);
    ctx.fill();

    // core
    ctx.fillStyle = `hsla(${n.hue},${n.sat}%,${n.lit-7}%,${alpha*(0.42 + 0.35*tension)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    // edge
    ctx.strokeStyle = `rgba(0,0,0,${alpha*(0.06 + 0.18*tension)})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();

    // selection hint
    if(mode==="path" && selected === n){
      ctx.strokeStyle = `rgba(0,0,0,${alpha*0.35})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(x, y, r*1.15, 0, TAU);
      ctx.stroke();
    }
  }

  // draw you node
  ctx.fillStyle = "rgba(0,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(youX, youY, 6.2, 0, TAU);
  ctx.fill();
}

function drawOverview(){
  // white background
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  // ease zoom
  overview.z += (overview.tz - overview.z) * 0.08;

  // transform so (overview.cx, overview.cy) becomes center
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.scale(overview.z, overview.z);
  ctx.translate(-overview.cx, -overview.cy);

  // ghosts
  if(UI.togGhost.checked){
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1.0;
    for(const g of ghosts){
      ctx.beginPath();
      ctx.moveTo(g.x0, g.y0);
      ctx.lineTo(g.x1, g.y1);
      ctx.stroke();
    }
  }

  // chosen spine
  ctx.lineCap = "round";
  for(let i=0;i<spine.length;i++){
    const s = spine[i];
    // gentle taper
    const t = i / Math.max(1, spine.length-1);
    const w = lerp(2.6, 1.0, t);
    ctx.lineWidth = w;

    // muted color on chosen spine
    ctx.strokeStyle = `hsla(${s.hue},55%,45%,0.45)`;
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  }

  // nodes on spine (subtle)
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for(const s of spine){
    ctx.beginPath();
    ctx.arc(s.x1, s.y1, 2.2, 0, TAU);
    ctx.fill();
  }

  ctx.restore();

  // small “wall” stamp if dead
  if(!alive){
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("wall", 18, H-18);
  }
}

function computeBounds(){
  // bounds across spine + ghosts + current you
  let minX = youWorld.x, maxX = youWorld.x;
  let minY = youWorld.y, maxY = youWorld.y;

  const add = (x,y)=>{
    minX = Math.min(minX,x); maxX = Math.max(maxX,x);
    minY = Math.min(minY,y); maxY = Math.max(maxY,y);
  };

  for(const s of spine){
    add(s.x0,s.y0); add(s.x1,s.y1);
  }
  for(const g of ghosts){
    add(g.x0,g.y0); add(g.x1,g.y1);
  }

  // if no segments yet, show whole universe comfortably
  if(spine.length === 0){
    minX = 0; minY = 0; maxX = W; maxY = H;
  }
  return {minX,maxX,minY,maxY};
}

// ---------- loop ----------
let last = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t-last)/1000);
  last = t;

  // travel animation
  if(traveling){
    tMove += dt / moveDur;
    const tt = clamp(tMove, 0, 1);
    const s = easeSmooth(tt);

    youWorld.x = lerp(fromPos.x, toPos.x, s);
    youWorld.y = lerp(fromPos.y, toPos.y, s);

    // crossfade in the next horizon
    fade = clamp((tt - 0.55) / 0.45, 0, 1);

    // when done, promote B->A
    if(tt >= 1){
      traveling = false;
      horizonA = horizonB;
      horizonB = [];
      fade = 0;

      // if box constraint forced wall, stop (options will be 0)
      if(!alive){
        horizonA = [];
        stMode.textContent = "wall";
        stOpt.textContent = "0";
      }
    }
  }

  // draw
  ctx.clearRect(0,0,W,H);

  if(mode === "overview"){
    drawOverview();
  } else {
    // path mode
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,W,H);

    // current horizon
    drawHorizon(horizonA, traveling ? (1 - fade) : 1);

    // next horizon during travel
    if(horizonB.length){
      drawHorizon(horizonB, fade);
    }

    // small wall hint (no text) when dead
    if(!alive && !traveling){
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.font = '14px "Courier New", monospace';
      ctx.fillText("wall", youWorld.x + 12, youWorld.y + 5);
    }
  }

  syncUI();
  requestAnimationFrame(loop);
}

// ---------- start ----------
resetField(false);
requestAnimationFrame(loop);