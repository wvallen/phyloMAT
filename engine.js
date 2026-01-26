// phyloMAT 2.0 — Click-Driven Bloom v1.3
// Click a choice -> camera travels -> next options bloom smoothly.
// No constant forward drift. First horizon has exactly 3.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

let W, H, DPR;
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
const slOpen  = document.getElementById("slOpen");
const slHor   = document.getElementById("slHor");
const slSpeed = document.getElementById("slSpeed");

const stStep = document.getElementById("stStep");
const stOpt  = document.getElementById("stOpt");
const stMode = document.getElementById("stMode");
stMode.textContent = "path";

// ---- helpers ----
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp  = (a,b,t)=>a+(b-a)*t;
const rand  = (a,b)=>a+Math.random()*(b-a);
const TAU = Math.PI*2;

function anchor(){
  return { x: W*0.50, y: H*0.78 };
}

// muted stream hues (three “families”)
const baseHues = [205, 245, 285];

// ---- state ----
let step = 0;
stStep.textContent = "0";

let you = { x: 0, y: 0 }; // world coords in screen space for now (centered)
let traveling = false;
let tMove = 0;            // 0..1
let moveDur = 0.65;       // seconds, controlled by speed slider
let from = {x:0,y:0};
let to   = {x:0,y:0};

let horizonA = []; // current visible options
let horizonB = []; // next options to crossfade in
let fade = 0;      // 0 shows A, 1 shows B

// ---- option node ----
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
    omega: lerp(0.012, 0.030, energy),
    orbitR: lerp(3, 10, energy),
    pulse: Math.random()*TAU,
    pulseW: lerp(0.012, 0.030, energy),
  };
}

// ---- horizon generator (clouds ahead, not stems) ----
function generateHorizon(count){
  const open = slOpen.value/100;
  const hor  = +slHor.value;

  // place horizon in a “choice band” ahead of you
  // not radial sprouting: this is a forward field
  const bandY = -lerp(180, 420, clamp(hor/12,0,1)); // upscreen = future
  const spreadX = lerp(180, 420, open);
  const spreadY = lerp(40, 120, open);

  // first decision: 3 choices, one per stream, spaced cleanly
  const centers = [
    -lerp(180, 260, open),
    0,
    lerp(180, 260, open)
  ];

  const nodes = [];
  if(count === 3){
    for(let s=0;s<3;s++){
      const x = centers[s] + rand(-35,35);
      const y = bandY + rand(-25,25);
      nodes.push(makeNode(s, x, y));
    }
    return nodes;
  }

  // later: make “clouds ahead” by sampling around stream centers
  const perStream = Math.max(1, Math.round(count/3));
  for(let s=0;s<3;s++){
    for(let i=0;i<perStream;i++){
      const x = centers[s] + rand(-spreadX*0.35, spreadX*0.35);
      const y = bandY + rand(-spreadY, spreadY);
      nodes.push(makeNode(s, x, y));
    }
  }

  // trim to exact count
  while(nodes.length > count) nodes.pop();
  return nodes;
}

// ---- init horizons ----
function resetField(){
  you = { x: 0, y: 0 };
  step = 0;
  stStep.textContent = "0";
  traveling = false;
  fade = 0;
  horizonA = generateHorizon(3);
  horizonB = [];
  stOpt.textContent = String(horizonA.length);
}
resetField();

// ---- picking ----
function pickNode(mx, my, nodes){
  const a = anchor();
  // convert to local coords relative to you anchor
  const lx = mx - a.x - you.x;
  const ly = my - a.y - you.y;

  let best = null;
  let bestD = Infinity;

  for(const n of nodes){
    const dx = lx - n.x;
    const dy = ly - n.y;
    const d2 = dx*dx + dy*dy;
    if(d2 < bestD){
      bestD = d2;
      best = n;
    }
  }
  // threshold
  if(best && bestD < 55*55) return best;
  return null;
}

// ---- click causes motion (no travel button needed for prototype) ----
canvas.addEventListener("click", (ev)=>{
  if(traveling) return;

  const node = pickNode(ev.clientX, ev.clientY, horizonA);
  if(!node) return;

  // speed slider controls move duration (higher speed -> shorter duration)
  const sp = slSpeed.value/100; // ~0.3..2.2 range mapped by your slider UI
  moveDur = clamp(0.95 - 0.55*sp, 0.20, 0.95);

  // start travel toward chosen node (local coords)
  from = { x: you.x, y: you.y };
  to   = { x: you.x + node.x, y: you.y + node.y };

  traveling = true;
  tMove = 0;

  // prepare next horizon immediately so it can bloom in during travel end
  step += 1;
  stStep.textContent = String(step);

  const open = slOpen.value/100;
  const nextCount = (step === 1)
    ? 3
    : Math.max(2, Math.floor(lerp(4, 24, open)));

  horizonB = generateHorizon(nextCount);
  stOpt.textContent = String(nextCount);
  fade = 0;
});

// ---- update + draw ----
let last = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t-last)/1000);
  last = t;

  // animate horizon nodes (orbits + pulse)
  for(const n of horizonA){
    n.phase += n.omega;
    n.pulse += n.pulseW;
  }
  for(const n of horizonB){
    n.phase += n.omega;
    n.pulse += n.pulseW;
  }

  if(traveling){
    tMove += dt / moveDur;
    const tt = clamp(tMove, 0, 1);

    // smoothstep easing
    const s = tt*tt*(3 - 2*tt);

    // move “you” toward chosen direction
    you.x = lerp(from.x, to.x, s);
    you.y = lerp(from.y, to.y, s);

    // crossfade into new horizon near the end
    fade = clamp((tt - 0.55) / 0.45, 0, 1);

    if(tt >= 1){
      traveling = false;

      // lock new horizon as current
      horizonA = horizonB;
      horizonB = [];
      fade = 0;

      // reset you to origin (so field stays in front), but keep accumulated drift as implicit history
      // this preserves “movement happened” without letting it fly off screen.
      you.x = 0;
      you.y = 0;
    }
  }

  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- render ----
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  const a = anchor();
  const youX = a.x;
  const youY = a.y;

  // draw you
  ctx.fillStyle = "rgba(0,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(youX, youY, 6.2, 0, TAU);
  ctx.fill();

  // draw current horizon (A) and next horizon (B) with crossfade
  drawHorizon(horizonA, 1 - fade, youX, youY, traveling ? 0.75 : 1.0);
  if(horizonB.length){
    drawHorizon(horizonB, fade, youX, youY, 1.0);
  }
}

function drawHorizon(nodes, alpha, youX, youY, lineScale){
  if(alpha <= 0) return;

  for(const n of nodes){
    const ox = Math.cos(n.phase)*n.orbitR;
    const oy = Math.sin(n.phase)*n.orbitR*0.60;

    const x = youX + n.x + ox;
    const y = youY + n.y + oy;

    const pulse = 0.88 + 0.12*Math.sin(n.pulse);

    // tension signal: make some lines taut and some limp
    // use energy as proxy; low energy = limp
    const tension = clamp(0.15 + 0.85*n.energy, 0, 1);
    const sag = (1 - tension) * 85;

    const cx = (youX + x)/2;
    const cy = (youY + y)/2 + sag;

    ctx.strokeStyle = `rgba(0,0,0,${alpha*(0.03 + 0.16*tension)})`;
    ctx.lineWidth = lineScale*(0.8 + 2.0*tension);
    ctx.beginPath();
    ctx.moveTo(youX, youY);
    ctx.quadraticCurveTo(cx, cy, x, y);
    ctx.stroke();

    // node (less balloon)
    const r = n.size * pulse;

    // halo
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
  }
}

// ---- live slider effects (affect the universe immediately) ----
slOpen.addEventListener("input", ()=>{
  // regenerate current horizon with new openness, preserve 3 on step 0
  const count = (step === 0) ? 3 : horizonA.length;
  horizonA = generateHorizon(count);
  stOpt.textContent = String(horizonA.length);
});

slHor.addEventListener("input", ()=>{
  const count = (step === 0) ? 3 : horizonA.length;
  horizonA = generateHorizon(count);
});

slSpeed.addEventListener("input", ()=>{ /* duration changes on next click */ });

// optional: start button can reset field later; for now engine runs