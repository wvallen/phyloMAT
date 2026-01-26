// phyloMAT 2.0 — Decision Field → Hidden Tree → Classic Phylo Artifact
// Play: only next decision field (qualities: density/pulse/jitter).
// Complete at MAX_STEPS (wall). Then Overview reveals a left→right phylo tree.
// Colors are muted; meaning comes from density/pulse/jitter; final tree lines are thicker.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

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

// ---- UI ----
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

  stRun: document.getElementById("stRun"),
  stMode: document.getElementById("stMode"),
  stStep: document.getElementById("stStep"),
  stOpt: document.getElementById("stOpt"),
};

// ---- helpers ----
const TAU = Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
function ease(t){ return t*t*(3-2*t); }

function anchor(){
  return { x: W*0.50, y: H*0.78 };
}

// ---- run config ----
const MAX_STEPS = 30;

// ---- state ----
let runID = 0;
let mode = "path";         // path | overview
let step = 0;
let complete = false;

let options = [];
let selected = null;

let traveling = false;
let tMove = 0;
let moveDur = 0.55;
let fade = 0;

let optA = [];
let optB = [];

let decisions = []; // history: for each step: chosen idx + qualities for each option

// ---- option model ----
// Each option has qualities:
// density ∈ [0,1]  (cluster count / “richness”)
// jitter  ∈ [0,1]  (motion instability)
// pulse   ∈ [0,1]  (breathing strength)
// During play, render as a cloud cluster with those traits.
function makeOption(idx){
  const O = UI.slOpen.value/100;
  const J = clamp((+UI.slHor.value)/12, 0, 1); // horizon → jitter range

  // density: openness biases high densities
  const density = clamp(lerp(0.15, 0.95, 0.25 + 0.75*O) * rand(0.75, 1.15), 0, 1);

  // jitter: horizon biases instability
  const jitter = clamp(lerp(0.05, 0.95, J) * rand(0.7, 1.2), 0, 1);

  // pulse: tied to density a bit (richer futures “breathe” more)
  const pulse = clamp(lerp(0.20, 0.95, 0.35 + 0.65*density) * rand(0.8, 1.1), 0, 1);

  // cluster geometry (3 anchors in an arc)
  const spread = lerp(190, 320, O);
  const arcY = -lerp(190, 430, clamp((+UI.slHor.value)/12, 0, 1));
  const x = (idx-1) * spread + rand(-28, 28);
  const y = arcY + rand(-22, 22);

  return {
    idx,
    x, y,
    density, jitter, pulse,
    phase: rand(0, TAU),
    phase2: rand(0, TAU),
  };
}

function genDecisionField(first=false){
  // First step: exactly 3 options
  const count = 3;
  const field = [];
  for(let i=0;i<count;i++){
    field.push(makeOption(i));
  }
  return field;
}

// ---- UI sync ----
function syncUI(){
  UI.lbOpen.textContent = (UI.slOpen.value/100).toFixed(2);
  UI.lbHor.textContent = UI.slHor.value;
  UI.lbSpeed.textContent = (UI.slSpeed.value/100).toFixed(2);

  UI.stRun.textContent = runID ? `run-${runID}` : "—";
  UI.stMode.textContent = mode;
  UI.stStep.textContent = String(step);
  UI.stOpt.textContent = String(optA.length || 0);

  // overview only meaningful after completion
  UI.btnOverview.disabled = !complete;

  // travel enabled if selection exists and in path mode and not moving and not complete
  UI.btnTravel.disabled = !(mode==="path" && !complete && !traveling && selected !== null);
}

// ---- start/reset ----
function startRun(){
  runID += 1;
  mode = "path";
  step = 0;
  complete = false;

  decisions = [];
  selected = null;
  traveling = false;
  tMove = 0;
  fade = 0;

  optA = genDecisionField(true);
  optB = [];
  syncUI();
}

// Reset = start new run
UI.btnStart.addEventListener("click", startRun);
UI.btnReset.addEventListener("click", startRun);

// PNG export
UI.btnPNG.addEventListener("click", ()=>{
  const a = document.createElement("a");
  a.download = `phylomat_${runID || "run"}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
});

// Return buttons (from overview)
function returnToPath(){
  mode = "path";
  syncUI();
}
UI.btnReturn.addEventListener("click", returnToPath);
UI.btnReturn2.addEventListener("click", returnToPath);

// Overview
UI.btnOverview.addEventListener("click", ()=>{
  if(!complete) return;
  mode = "overview";
  syncUI();
});

// sliders affect next field immediately (and the feel)
["slOpen","slHor","slSpeed"].forEach(id=>{
  UI[id].addEventListener("input", ()=>{
    // keep current field, but re-generate it when not traveling so it reflects the new universe
    if(mode==="path" && !traveling && !complete){
      optA = genDecisionField(step===0);
      selected = null;
    }
    syncUI();
  });
});

// ---- picking and commit ----
function pickOption(mx,my){
  const a = anchor();
  const lx = mx - (a.x);
  const ly = my - (a.y);

  // choose closest option center (in local coords)
  let best = null;
  let bestD = Infinity;
  for(const o of optA){
    const dx = lx - o.x;
    const dy = ly - o.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < bestD){ bestD = d2; best = o; }
  }
  // threshold based on density/pulse (intuitive selection)
  if(best && bestD < 85*85) return best;
  return null;
}

canvas.addEventListener("click", (ev)=>{
  if(mode!=="path" || traveling || complete) return;
  selected = pickOption(ev.clientX, ev.clientY);
  syncUI();
});

canvas.addEventListener("dblclick", (ev)=>{
  if(mode!=="path" || traveling || complete) return;
  const o = pickOption(ev.clientX, ev.clientY);
  if(o) selected = o;
  if(selected) beginTravel(selected);
});

// Travel button
UI.btnTravel.addEventListener("click", ()=>{
  if(mode==="path" && selected && !traveling && !complete){
    beginTravel(selected);
  }
});

function beginTravel(choice){
  traveling = true;
  tMove = 0;
  fade = 0;

  // speed controls duration (higher speed -> shorter)
  const sp = UI.slSpeed.value/100;
  moveDur = clamp(0.95 - 0.55*sp, 0.20, 0.95);

  // record decision: store all 3 options qualities and chosen index
  const snapshot = optA.map(o=>({
    density:o.density, jitter:o.jitter, pulse:o.pulse
  }));
  decisions.push({ chosen: choice.idx, opts: snapshot });

  step += 1;

  // next field: still 3 choices each step (simple game)
  // later you can increase with openness; keep 3 for now to maintain “voices”
  optB = genDecisionField(false);

  selected = null;
  syncUI();
}

// ---- animation tick ----
let last = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t-last)/1000);
  last = t;

  // animate phases for alive breathing
  for(const o of optA){
    o.phase += dt * (0.8 + 2.2*o.pulse);
    o.phase2 += dt * (0.6 + 3.2*o.jitter);
  }
  for(const o of optB){
    o.phase += dt * (0.8 + 2.2*o.pulse);
    o.phase2 += dt * (0.6 + 3.2*o.jitter);
  }

  if(traveling){
    tMove += dt / moveDur;
    const tt = clamp(tMove, 0, 1);
    const s = ease(tt);

    // bloom transition: fade A out, B in
    fade = clamp((tt - 0.35) / 0.65, 0, 1);

    // after travel completes, switch fields
    if(tt >= 1){
      traveling = false;
      optA = optB;
      optB = [];
      fade = 0;

      // completion at wall
      if(step >= MAX_STEPS){
        complete = true;
        // hide the field by leaving optA empty (tree is hidden until complete)
        optA = [];
        optB = [];
      }
      syncUI();
    }
  }

  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- drawing (PATH MODE) ----
function drawPath(){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  const a = anchor();

  // draw “you”
  ctx.fillStyle = "rgba(0,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(a.x, a.y, 6.2, 0, TAU);
  ctx.fill();

  // if complete, keep it quiet
  if(complete){
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("complete", 18, H-18);
    return;
  }

  // draw current and next field with crossfade
  drawField(optA, 1 - (traveling ? fade : 0), a.x, a.y);
  if(optB.length){
    drawField(optB, (traveling ? fade : 0), a.x, a.y);
  }
}

function drawField(field, alpha, ax, ay){
  if(alpha <= 0) return;

  for(const o of field){
    // qualities → visuals
    const densityCount = Math.floor(lerp(6, 30, o.density));
    const jitterAmp = lerp(2, 22, o.jitter);
    const pulseAmp  = lerp(0.06, 0.20, o.pulse);

    // center of this option
    const cx = ax + o.x;
    const cy = ay + o.y;

    // line tension is an indicator: high pulse+density taut, high jitter limp
    const tension = clamp(0.15 + 0.55*o.density + 0.35*o.pulse - 0.45*o.jitter, 0, 1);
    const sag = (1 - tension) * 70;

    // tether (curved for limp)
    ctx.strokeStyle = `rgba(0,0,0,${alpha*(0.03 + 0.14*tension)})`;
    ctx.lineWidth = 0.8 + 2.0*tension;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax+cx)/2, (ay+cy)/2 + sag, cx, cy);
    ctx.stroke();

    // option “cloud” = multiple small points (density)
    // points orbit + jitter; pulse modulates alpha
    const pulse = 0.85 + 0.15*Math.sin(o.phase);
    const glowA = alpha*(0.08 + 0.12*tension)*pulse;

    // muted grey-blue palette (not random color meaning)
    const base = `rgba(90,120,170,`;

    // selection ring (subtle)
    // selection computed by click; we identify by idx
    // draw later after cloud

    for(let i=0;i<densityCount;i++){
      const ang = (i/densityCount)*TAU + o.phase2*0.6;
      const rr = lerp(6, 18, o.density) + Math.sin(o.phase + i)*3;
      const px = cx + Math.cos(ang)*rr + rand(-jitterAmp,jitterAmp)*0.06;
      const py = cy + Math.sin(ang)*rr*0.7 + rand(-jitterAmp,jitterAmp)*0.06;

      const r = lerp(1.4, 2.8, o.density) * (0.9 + 0.2*Math.sin(o.phase + i));
      ctx.fillStyle = base + `${glowA})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    }

    // core node (small, not balloon)
    const coreR = lerp(5.0, 7.2, 0.4 + 0.6*o.density) * (1 + pulseAmp*Math.sin(o.phase));
    ctx.fillStyle = `rgba(0,0,0,${alpha*(0.10 + 0.20*tension)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR*1.7, 0, TAU);
    ctx.fill();

    ctx.fillStyle = `rgba(60,80,120,${alpha*(0.35 + 0.35*tension)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, TAU);
    ctx.fill();

    // selected highlight
    if(selected && selected.idx === o.idx){
      ctx.strokeStyle = `rgba(0,0,0,${alpha*0.35})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR*1.35, 0, TAU);
      ctx.stroke();
    }
  }
}

// ---- drawing (OVERVIEW) ----
// Classic phylo tree: left→right; branching at each step (3 children; one continues, two terminate).
// The tree is hidden during play and shown only when complete.
function drawOverview(){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  if(!complete){
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("complete the run to reveal the tree", 18, H-18);
    return;
  }

  // Build leaf list: each step adds 2 terminal branches plus 1 continuing, so leaves = 2*MAX_STEPS + 1
  const leaves = 2*MAX_STEPS + 1;
  const topPad = 60, botPad = 60, leftPad = 80, rightPad = 80;

  // y positions evenly spaced
  const ys = [];
  for(let i=0;i<leaves;i++){
    ys.push(lerp(topPad, H-botPad, i/(leaves-1)));
  }

  // We traverse decisions and assign y positions:
  // continuing path always takes the next available “middle” y in the remaining block.
  // terminal branches take adjacent y slots.
  let yIndex = 0;
  function allocTriplet(){
    // allocate 3 leaves: left terminal, continuing, right terminal
    const y0 = ys[yIndex++]; // terminal
    const y1 = ys[yIndex++]; // continuing
    const y2 = ys[yIndex++]; // terminal
    return [y0,y1,y2];
  }

  // Root at x = leftPad
  const x0 = leftPad;
  const xStep = (W - leftPad - rightPad) / MAX_STEPS;

  // segments to draw as curves: {x0,y0,x1,y1,w,a}
  const segs = [];

  // Start with one “current” node at root y = center of leaf range
  // We build forward: at each step create three children; choose one continues.
  let curX = x0;
  let curY = (ys[0] + ys[ys.length-1]) * 0.5;

  // Reset y allocation
  yIndex = 0;

  for(let k=0;k<MAX_STEPS;k++){
    const dec = decisions[k] || { chosen: 1, opts: [
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4}
    ]};

    const [yL, yC, yR] = allocTriplet();
    const nextX = x0 + (k+1)*xStep;

    // map option qualities into branch “character”
    function branchParams(opt){
      const d = opt.density, j = opt.jitter, p = opt.pulse;
      const w = 2.2 + 2.6*d + 0.6*p;     // thicker for dense/pulsed
      const wiggle = 6 + 40*j;           // more jitter → more curvature
      const alpha = 0.12 + 0.38*(d*0.6 + p*0.4); // more visible if dense/pulsed
      return { w, wiggle, alpha };
    }

    const p0 = branchParams(dec.opts[0]);
    const p1 = branchParams(dec.opts[1]);
    const p2 = branchParams(dec.opts[2]);

    // Two terminal branches + one continuing
    segs.push(curveSeg(curX, curY, nextX, yL, p0));
    segs.push(curveSeg(curX, curY, nextX, yC, p1));
    segs.push(curveSeg(curX, curY, nextX, yR, p2));

    // chosen continues: map chosen index to which of the three y's becomes next curY
    const nextY = (dec.chosen === 0) ? yL : (dec.chosen === 1 ? yC : yR);
    curX = nextX;
    curY = nextY;
  }

  // draw faint background branches first
  for(const s of segs){
    ctx.strokeStyle = `rgba(0,0,0,${s.a*0.65})`;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(s.x0,s.y0);
    ctx.bezierCurveTo(s.cx1,s.cy1,s.cx2,s.cy2,s.x1,s.y1);
    ctx.stroke();
  }

  // overlay chosen path thicker + darker
  // reconstruct chosen path segments
  let px = x0;
  let py = (ys[0] + ys[ys.length-1]) * 0.5;
  yIndex = 0;
  for(let k=0;k<MAX_STEPS;k++){
    const dec = decisions[k] || { chosen: 1, opts: [
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4}
    ]};

    const [yL, yC, yR] = allocTriplet();
    const nx = x0 + (k+1)*xStep;

    const opt = dec.opts[dec.chosen];
    const w = 3.4 + 3.2*opt.density + 0.8*opt.pulse;
    const wiggle = 6 + 35*opt.jitter;

    const nextY = (dec.chosen === 0) ? yL : (dec.chosen === 1 ? yC : yR);

    const seg = curveSeg(px, py, nx, nextY, {w, wiggle, alpha:1});
    ctx.strokeStyle = `rgba(0,0,0,0.70)`;
    ctx.lineWidth = seg.w;
    ctx.beginPath();
    ctx.moveTo(seg.x0,seg.y0);
    ctx.bezierCurveTo(seg.cx1,seg.cy1,seg.cx2,seg.cy2,seg.x1,seg.y1);
    ctx.stroke();

    px = nx;
    py = nextY;
  }

  // “wall” at far right
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W-rightPad, topPad);
  ctx.lineTo(W-rightPad, H-botPad);
  ctx.stroke();
}

function curveSeg(x0,y0,x1,y1, p){
  const w = p.w;
  const a = p.alpha ?? 1;
  const wiggle = p.wiggle ?? 12;

  // control points: curve depends on wiggle; keep it stable and organic
  const dx = x1-x0;
  const dy = y1-y0;

  const cx1 = x0 + dx*0.35;
  const cy1 = y0 + dy*0.15 + rand(-wiggle, wiggle);

  const cx2 = x0 + dx*0.70;
  const cy2 = y0 + dy*0.85 + rand(-wiggle, wiggle);

  return {x0,y0,x1,y1,cx1,cy1,cx2,cy2,w,a};
}

// ---- master draw ----
function draw(){
  if(mode === "overview"){
    drawOverview();
  } else {
    drawPath();
  }
}

// ---- loop ----
function loop(t){
  draw();
  syncUI();
  requestAnimationFrame(loop);
}

// ---- init ----
startRun(); // auto-start so you always see the field
function startRun(){
  runID += 1;
  mode = "path";
  step = 0;
  complete = false;
  traveling = false;
  tMove = 0;
  fade = 0;
  decisions = [];
  selected = null;
  youWorld = { x: W*0.5, y: H*0.80 };
  optA = generateHorizon(3);
  optB = [];
  syncUI();
}
function generateHorizon(count){
  // use current youWorld for positioning
  return generateHorizonAt(count);
}
function generateHorizonAt(count){
  const open = UI.slOpen.value/100;
  const hor  = +UI.slHor.value;

  const bandDy = -lerp(190, 430, clamp(hor/12,0,1));
  const spreadX = lerp(170, 430, open);
  const spreadY = lerp(30, 120, open);

  const centers = [
    -lerp(180, 260, open),
     0,
     lerp(180, 260, open)
  ];

  const nodes = [];
  if(count === 3){
    for(let s=0;s<3;s++){
      nodes.push(makeOptionNode(s, youWorld.x + centers[s] + rand(-30,30), youWorld.y + bandDy + rand(-25,25)));
    }
    return nodes;
  }

  const perStream = Math.max(1, Math.round(count/3));
  for(let s=0;s<3;s++){
    for(let i=0;i<perStream;i++){
      nodes.push(makeOptionNode(s,
        youWorld.x + centers[s] + rand(-spreadX*0.35, spreadX*0.35),
        youWorld.y + bandDy + rand(-spreadY, spreadY)
      ));
    }
  }
  while(nodes.length > count) nodes.pop();
  return nodes;
}
function makeOptionNode(idx, x, y){
  const o = makeOption(idx);
  // place its center in world coords
  o.x = x; o.y = y;
  return o;
}
function makeOption(idx){
  const O = UI.slOpen.value/100;
  const J = clamp((+UI.slHor.value)/12, 0, 1);
  const density = clamp(lerp(0.15, 0.95, 0.25 + 0.75*O) * rand(0.75, 1.15), 0, 1);
  const jitter  = clamp(lerp(0.05, 0.95, J) * rand(0.7, 1.2), 0, 1);
  const pulse   = clamp(lerp(0.20, 0.95, 0.35 + 0.65*density) * rand(0.8, 1.1), 0, 1);

  return {
    idx,
    x: 0, y: 0,
    density, jitter, pulse,
    phase: rand(0, TAU),
    phase2: rand(0, TAU)
  };
}

// override earlier resetField so Start button works as well
UI.btnStart.onclick = ()=> startRun();
UI.btnReset.onclick = ()=> startRun();

// wire Travel to commit
UI.btnTravel.onclick = ()=>{
  if(mode==="path" && selected && !traveling && !complete) beginTravel(selected);
};

// override click-driven travel animation in this “final prototype”
function beginTravel(choice){
  traveling = true;
  tMove = 0;
  fade = 0;

  const sp = UI.slSpeed.value/100;
  moveDur = clamp(0.95 - 0.55*sp, 0.20, 0.95);

  // record decision snapshot
  const snapshot = optA.map(o=>({density:o.density, jitter:o.jitter, pulse:o.pulse}));
  decisions.push({ chosen: choice.idx, opts: snapshot });

  // next step
  step += 1;

  // next horizon always 3 voices for this simplified “few voices” model
  optB = generateHorizonAt(3);

  // completion
  if(step >= MAX_STEPS){
    complete = true;
    // tree hidden until complete: wipe fields after travel ends
  }

  selected = null;
  syncUI();

  // Travel tween: we slide the whole field slightly to simulate movement, then swap
  // (kept subtle and non-directional)
}

// travel update integrated into loop: we need to advance travel state & crossfade
let lastT = performance.now();
function loop2(t){
  const dt = Math.min(0.05, (t-lastT)/1000);
  lastT = t;

  // animate option phases
  for(const o of optA){ o.phase += dt*(0.8 + 2.0*o.pulse); o.phase2 += dt*(0.6 + 3.0*o.jitter); }
  for(const o of optB){ o.phase += dt*(0.8 + 2.0*o.pulse); o.phase2 += dt*(0.6 + 3.0*o.jitter); }

  if(traveling){
    tMove += dt / moveDur;
    const tt = clamp(tMove, 0, 1);
    const s = ease(tt);

    fade = clamp((tt - 0.35)/0.65, 0, 1);

    // subtle “movement” feel: push current horizon downward a bit and blur it via alpha
    // (non-directional, avoids the creeping-wall directional issue)
    const push = lerp(0, 55, s);
    for(const o of optA){ o.y += push*dt*2; }

    if(tt >= 1){
      traveling = false;
      optA = optB;
      optB = [];
      fade = 0;

      if(complete){
        // hide field once complete
        optA = [];
        optB = [];
      }
      syncUI();
    }
  }

  draw();
  syncUI();
  requestAnimationFrame(loop2);
}
requestAnimationFrame(loop2);