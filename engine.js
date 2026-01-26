// phyloMAT 2.0 — Clean Final Prototype v1.1
// Play: 3-voice decision field (density/pulse/jitter). Click selects; Travel commits; dblclick commits.
// Complete at MAX_STEPS (wall). Only then Overview reveals classic left→right phylo tree.
// Single loop, no duplicate handlers.

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

const TAU = Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
function ease(t){ return t*t*(3-2*t); }

function anchor(){
  return { x: W*0.50, y: H*0.78 };
}

// 3 voice hues (muted)
const hues = [205, 245, 285];

// ---------- run model ----------
const MAX_STEPS = 30;

let runID = 0;
let mode = "path";        // path | overview
let step = 0;
let complete = false;

let options = [];         // 3 options always
let selected = null;

let traveling = false;
let tMove = 0;
let moveDur = 0.6;
let fade = 0;

// record decisions: per step store chosen idx and the 3 option qualities
let decisions = []; // [{chosen:0|1|2, opts:[{density,jitter,pulse} x3]}]

// record ghosts for overview (optional)
let ghosts = [];    // [{x0,y0,x1,y1,a}]
let spine = [];     // [{x0,y0,x1,y1,w}] for overview styling

// ---------- option qualities ----------
function makeQualities(){
  const O = UI.slOpen.value/100;         // openness -> density
  const Hh = clamp(+UI.slHor.value/12,0,1); // horizon -> jitter
  const density = clamp(lerp(0.15, 0.95, 0.25 + 0.75*O) * rand(0.8, 1.15), 0, 1);
  const jitter  = clamp(lerp(0.05, 0.95, Hh) * rand(0.75,1.2), 0, 1);
  const pulse   = clamp(lerp(0.20, 0.95, 0.35 + 0.65*density) * rand(0.85,1.1), 0, 1);
  return { density, jitter, pulse };
}

function makeOption(idx){
  const q = makeQualities();
  return {
    idx,
    ...q,
    // position in a forward band
    x: 0, y: 0,
    // anim params
    phase: rand(0,TAU),
    phase2: rand(0,TAU),
    omega: lerp(0.6, 2.0, q.pulse),
    omega2: lerp(0.8, 3.0, q.jitter),
  };
}

function genField(){
  // Always 3 options (few voices model)
  const O = UI.slOpen.value/100;
  const bandDy = -lerp(190, 430, clamp(+UI.slHor.value/12,0,1));
  const spread = lerp(180, 260, O);

  const a = anchor();
  const cx = a.x;
  const cy = a.y;

  options = [makeOption(0), makeOption(1), makeOption(2)];

  // place them as a gentle arc band
  const centers = [-spread, 0, +spread];
  for(let i=0;i<3;i++){
    options[i].x = cx + centers[i] + rand(-30,30);
    options[i].y = cy + bandDy + rand(-25,25);
  }

  selected = null;
}

// ---------- UI sync ----------
function syncUI(){
  UI.lbOpen.textContent = (UI.slOpen.value/100).toFixed(2);
  UI.lbHor.textContent = UI.slHor.value;
  UI.lbSpeed.textContent = (UI.slSpeed.value/100).toFixed(2);

  UI.stRun.textContent = runID ? `run-${runID}` : "—";
  UI.stMode.textContent = mode;
  UI.stStep.textContent = String(step);
  UI.stOpt.textContent  = String(options.length);

  UI.btnTravel.disabled = !(mode==="path" && !complete && !traveling && selected !== null);
  UI.btnOverview.disabled = !complete;
}

// ---------- start/reset ----------
function startRun(){
  runID += 1;
  mode = "path";
  step = 0;
  complete = false;
  traveling = false;
  tMove = 0;
  fade = 0;

  decisions = [];
  ghosts = [];
  spine = [];

  genField();
  syncUI();
}

UI.btnStart.addEventListener("click", startRun);
UI.btnReset.addEventListener("click", startRun);

UI.btnPNG.addEventListener("click", ()=>{
  const a = document.createElement("a");
  a.download = `phylomat_${runID||"run"}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
});

UI.btnOverview.addEventListener("click", ()=>{
  if(!complete) return;
  mode = "overview";
  syncUI();
});

function returnToPath(){
  mode = "path";
  syncUI();
}
UI.btnReturn.addEventListener("click", returnToPath);
UI.btnReturn2.addEventListener("click", returnToPath);

// sliders regenerate field when idle
["slOpen","slHor"].forEach(id=>{
  UI[id].addEventListener("input", ()=>{
    if(mode==="path" && !traveling && !complete){
      genField();
      syncUI();
    }
  });
});
UI.slSpeed.addEventListener("input", syncUI);

// ---------- selection + commit ----------
function pick(mx,my){
  let best=null, bestD=Infinity;
  for(const o of options){
    const dx = mx - o.x;
    const dy = my - o.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < bestD){ bestD=d2; best=o; }
  }
  if(best && bestD < 80*80) return best;
  return null;
}

canvas.addEventListener("click", (ev)=>{
  if(mode!=="path" || traveling || complete) return;
  selected = pick(ev.clientX, ev.clientY);
  syncUI();
});

canvas.addEventListener("dblclick", (ev)=>{
  if(mode!=="path" || traveling || complete) return;
  const o = pick(ev.clientX, ev.clientY);
  if(o) selected = o;
  if(selected) beginCommit(selected);
});

UI.btnTravel.addEventListener("click", ()=>{
  if(mode==="path" && selected && !traveling && !complete){
    beginCommit(selected);
  }
});

function beginCommit(choice){
  traveling = true;
  tMove = 0;
  fade = 0;

  const sp = UI.slSpeed.value/100;
  moveDur = clamp(0.95 - 0.55*sp, 0.20, 0.95);

  // record this step
  decisions.push({
    chosen: choice.idx,
    opts: options.map(o=>({density:o.density, jitter:o.jitter, pulse:o.pulse}))
  });

  // ghost segments in overview: represent “paths not taken” as faint
  if(UI.togGhost.checked){
    const a = anchor();
    for(const o of options){
      if(o.idx === choice.idx) continue;
      ghosts.push({ x0:a.x, y0:a.y, x1:o.x, y1:o.y, a:0.10 });
    }
  }

  step += 1;

  // end condition: wall is step count
  if(step >= MAX_STEPS){
    complete = true;
  }

  // next field prepared now (but tree hidden until complete)
  // we keep field visible even if complete; tree revealed in Overview only
  genField();
  selected = null;

  syncUI();
}

// ---------- draw: path ----------
function drawPath(){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  const a = anchor();

  // you
  ctx.fillStyle = "rgba(0,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(a.x, a.y, 6.2, 0, TAU);
  ctx.fill();

  // field always visible (even if complete); overview button is the reveal
  const fieldAlpha = traveling ? 0.35 : 1.0;

  for(const o of options){
    // animate qualities
    o.phase += 0.02*o.omega;
    o.phase2 += 0.02*o.omega2;

    const densityCount = Math.floor(lerp(8, 30, o.density));
    const jitterAmp = lerp(2, 20, o.jitter);
    const pulse = 0.85 + 0.15*Math.sin(o.phase);

    // tension derived from qualities
    const tension = clamp(0.15 + 0.55*o.density + 0.35*o.pulse - 0.45*o.jitter, 0, 1);
    const sag = (1 - tension) * 70;

    // tether
    ctx.strokeStyle = `rgba(0,0,0,${fieldAlpha*(0.03 + 0.14*tension)})`;
    ctx.lineWidth = 0.8 + 2.0*tension;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x+o.x)/2, (a.y+o.y)/2 + sag, o.x, o.y);
    ctx.stroke();

    // cloud points (no random color meaning)
    for(let i=0;i<densityCount;i++){
      const ang = (i/densityCount)*TAU + o.phase2*0.6;
      const rr = lerp(6, 18, o.density) + Math.sin(o.phase + i)*2;
      const px = o.x + Math.cos(ang)*rr + (Math.random()-0.5)*jitterAmp*0.15;
      const py = o.y + Math.sin(ang)*rr*0.7 + (Math.random()-0.5)*jitterAmp*0.15;

      const r = lerp(1.4, 2.8, o.density) * (0.9 + 0.2*Math.sin(o.phase + i));
      ctx.fillStyle = `rgba(90,120,170,${fieldAlpha*(0.06 + 0.12*tension)*pulse})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    }

    // core (muted hue per voice, but meaning is in qualities)
    const hue = hues[o.idx];
    const sat = 28 + 34*o.density;
    const lit = 60;

    const coreR = lerp(5.5, 7.5, o.density) * (1 + 0.10*Math.sin(o.phase));

    ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${fieldAlpha*(0.10 + 0.18*tension)})`;
    ctx.beginPath();
    ctx.arc(o.x, o.y, coreR*1.7, 0, TAU);
    ctx.fill();

    ctx.fillStyle = `hsla(${hue},${sat}%,${lit-8}%,${fieldAlpha*(0.40 + 0.38*tension)})`;
    ctx.beginPath();
    ctx.arc(o.x, o.y, coreR, 0, TAU);
    ctx.fill();

    // selection ring
    if(selected && selected.idx === o.idx){
      ctx.strokeStyle = `rgba(0,0,0,${fieldAlpha*0.35})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(o.x, o.y, coreR*1.35, 0, TAU);
      ctx.stroke();
    }
  }

  // subtle completion hint
  if(complete){
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("complete — Overview reveals tree", 18, H-18);
  }
}

// ---------- draw: overview (classic phylo) ----------
function drawOverview(){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  // classic phylo silhouette: left->right, branching each step into 3 (one continues)
  const leaves = 2*MAX_STEPS + 1;
  const topPad=60, botPad=60, leftPad=80, rightPad=80;

  const ys = [];
  for(let i=0;i<leaves;i++){
    ys.push(lerp(topPad, H-botPad, i/(leaves-1)));
  }

  let yIndex = 0;
  function allocTriplet(){
    const y0 = ys[yIndex++], y1 = ys[yIndex++], y2 = ys[yIndex++];
    return [y0,y1,y2];
  }

  const x0 = leftPad;
  const xStep = (W - leftPad - rightPad) / MAX_STEPS;

  // build all branches
  const segs = [];
  let curX = x0;
  let curY = (ys[0] + ys[ys.length-1]) * 0.5;
  yIndex = 0;

  for(let k=0;k<MAX_STEPS;k++){
    const dec = decisions[k] || { chosen: 1, opts:[
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4}
    ]};

    const [yL,yC,yR] = allocTriplet();
    const nextX = x0 + (k+1)*xStep;

    function params(opt){
      const d=opt.density, j=opt.jitter, p=opt.pulse;
      const w = 3.2 + 4.5*d + 1.2*p;        // thicker overall
      const wig = 10 + 55*j;                 // curvature from jitter
      const a = 0.10 + 0.45*(0.55*d + 0.45*p);
      return {w, wig, a};
    }

    const p0=params(dec.opts[0]), p1=params(dec.opts[1]), p2=params(dec.opts[2]);
    segs.push(curve(curX,curY,nextX,yL,p0));
    segs.push(curve(curX,curY,nextX,yC,p1));
    segs.push(curve(curX,curY,nextX,yR,p2));

    curY = (dec.chosen===0)?yL:((dec.chosen===1)?yC:yR);
    curX = nextX;
  }

  // draw faint background branches
  ctx.lineCap = "round";
  for(const s of segs){
    ctx.strokeStyle = `rgba(0,0,0,${s.a})`;
    ctx.lineWidth = s.w * 0.55; // background thinner but still present
    ctx.beginPath();
    ctx.moveTo(s.x0,s.y0);
    ctx.bezierCurveTo(s.cx1,s.cy1,s.cx2,s.cy2,s.x1,s.y1);
    ctx.stroke();
  }

  // draw chosen path thicker and darker
  let px = x0;
  let py = (ys[0] + ys[ys.length-1]) * 0.5;
  yIndex = 0;
  for(let k=0;k<MAX_STEPS;k++){
    const dec = decisions[k] || { chosen: 1, opts:[
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4},
      {density:0.4,jitter:0.3,pulse:0.4}
    ]};
    const [yL,yC,yR] = allocTriplet();
    const nx = x0 + (k+1)*xStep;
    const ny = (dec.chosen===0)?yL:((dec.chosen===1)?yC:yR);

    const opt = dec.opts[dec.chosen];
    const w = 4.0 + 5.0*opt.density + 1.6*opt.pulse;
    const wig = 10 + 50*opt.jitter;

    const seg = curve(px,py,nx,ny,{w,wig,a:1});
    ctx.strokeStyle = "rgba(0,0,0,0.80)";
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(seg.x0,seg.y0);
    ctx.bezierCurveTo(seg.cx1,seg.cy1,seg.cx2,seg.cy2,seg.x1,seg.y1);
    ctx.stroke();

    px=nx; py=ny;
  }

  // draw ghosts lightly (optional)
  if(UI.togGhost.checked && ghosts.length){
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1.0;
    for(const g of ghosts){
      ctx.beginPath();
      ctx.moveTo(g.x0, g.y0);
      ctx.lineTo(g.x1, g.y1);
      ctx.stroke();
    }
  }

  // wall line at far right
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W-rightPad, topPad);
  ctx.lineTo(W-rightPad, H-botPad);
  ctx.stroke();
}

function curve(x0,y0,x1,y1,p){
  const dx=x1-x0, dy=y1-y0;
  const wig = p.wig || 20;
  const cx1 = x0 + dx*0.35;
  const cy1 = y0 + dy*0.15 + rand(-wig, wig);
  const cx2 = x0 + dx*0.70;
  const cy2 = y0 + dy*0.85 + rand(-wig, wig);
  return {x0,y0,x1,y1,cx1,cy1,cx2,cy2,w:p.w,a:p.a};
}

// ---------- loop ----------
let last = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t-last)/1000);
  last = t;

  if(traveling){
    tMove += dt / moveDur;
    const tt = clamp(tMove, 0, 1);
    fade = clamp((tt - 0.35)/0.65, 0, 1);
    if(tt >= 1){
      traveling = false;
      fade = 0;
      syncUI();
    }
  }

  if(mode === "overview") drawOverview();
  else drawPath();

  syncUI();
  requestAnimationFrame(loop);
}

// ---------- init ----------
startRun();
requestAnimationFrame(loop);