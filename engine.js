// phyloMAT 2.0 — Path Engine v0.4
// Fixes DPR centering + adds orbit/pulse + line tension (taut vs limp)
// Engine-first: runs immediately, buttons can be wired later.
// First horizon has exactly 3 options.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

let W = 0, H = 0, DPR = 1;

function resize(){
  DPR = Math.max(1, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS pixels
}
window.addEventListener("resize", resize);
resize();

// ---------- UI (sliders only; buttons ignored for now) ----------
const slOpen  = document.getElementById("slOpen");
const slHor   = document.getElementById("slHor");
const slSpeed = document.getElementById("slSpeed");

const stStep = document.getElementById("stStep");
const stOpt  = document.getElementById("stOpt");
const stMode = document.getElementById("stMode");
stMode.textContent = "path";

// ---------- State ----------
let step = 0;
let moving = false;

// The “you” anchor is always screen-centered (lower-mid feels good)
function selfAnchor(){
  return { x: W * 0.50, y: H * 0.72 };
}

// A simple “position along the run” scalar so we can evolve hue + behavior
let progress = 0;

// current decision horizon nodes
let nodes = [];

// ---------- helpers ----------
const rand = (a,b)=>a + Math.random()*(b-a);
const lerp = (a,b,t)=>a + (b-a)*t;
const clamp = (v,a,b)=>Math.max(a, Math.min(b, v));

function mutedRainbowHue(t){
  // t in [0,1], returns hue degrees with muted spectrum preference
  // biased toward blue/purple/teal, avoids harsh green/yellow spikes
  const h = 180 + 120*t; // 180..300
  return h;
}

// ---------- Horizon generation (arc + clustered groups) ----------
function spawnHorizon(count){
  nodes = [];

  const openness = slOpen.value/100;
  const horizon = +slHor.value;

  // arc spread and depth
  const spread = lerp(Math.PI/10, Math.PI/2.0, openness);     // forward fan width
  const baseR  = lerp(240, 420, clamp(horizon/12, 0, 1));     // how far out the horizon sits

  // optional clustering: 1–3 clusters depending on openness
  const clusters = Math.max(1, Math.round(lerp(1, 3, openness)));
  const clusterCenters = [];
  for(let c=0;c<clusters;c++){
    clusterCenters.push(rand(-spread*0.45, spread*0.45));
  }

  for(let i=0;i<count;i++){
    // choose a cluster center, then sample around it
    const c = clusterCenters[Math.floor(rand(0, clusterCenters.length))];
    const ang = c + rand(-spread*0.18, spread*0.18);

    // energy controls “tautness” and orbit coherence
    const energy = clamp(0.25 + 0.75*Math.random(), 0, 1);

    // orbit params (this is the future projection signature)
    const orbitR = lerp(4, 16, energy) * (0.9 + 0.2*Math.random());
    const omega  = lerp(0.006, 0.020, energy) * (0.8 + 0.4*Math.random());
    const phase  = Math.random() * Math.PI * 2;

    // node size: less balloon, more “living point”
    const size = lerp(10, 18, 0.35 + 0.65*energy);

    // color: muted rainbow drift across run + local variance by energy
    const hue = mutedRainbowHue((progress % 1));
    const hueJitter = lerp(-18, 18, Math.random());
    const sat = lerp(35, 70, energy);        // muted → alive
    const light = lerp(55, 62, 0.5 + 0.5*energy);

    nodes.push({
      ang,
      r: baseR * rand(0.92, 1.08),
      size,
      energy,
      orbitR,
      omega,
      phase,
      hue: (hue + hueJitter + 360) % 360,
      sat,
      light,
      // pulse states
      pulsePhase: Math.random() * Math.PI * 2,
      pulseW: lerp(0.008, 0.030, energy),
    });
  }

  stOpt.textContent = String(nodes.length);
}

// ---------- Motion (direction commit, no selection) ----------
canvas.addEventListener("dblclick", (ev)=>{
  if(moving) return;

  // double-click chooses direction, not a node
  const a = selfAnchor();
  const mx = ev.clientX - a.x;
  const my = ev.clientY - a.y;

  // if click is very close to self, assume forward
  const dirMag = Math.hypot(mx, my);
  const dx = dirMag < 6 ? 0 : mx / dirMag;
  const dy = dirMag < 6 ? -1 : my / dirMag;

  // travel impulse
  const speed = slSpeed.value/100;
  vy = -speed * 320 * 0.016;  // integrate per frame (scaled below)
  vx = speed * 140 * dx * 0.016;

  moving = true;
});

let vx = 0, vy = 0;

function update(){
  const speed = slSpeed.value/100;

  // advance world “progress” slowly even at rest
  progress += 0.0008 + 0.0016*speed;

  if(moving){
    // camera movement is abstracted: we just “step” and re-roll horizon after easing
    vx *= 0.93;
    vy *= 0.93;

    if(Math.hypot(vx,vy) < 0.0025){
      moving = false;
      step++;
      stStep.textContent = String(step);

      // first step is exactly 3
      if(step === 1){
        spawnHorizon(3);
      } else {
        const openness = slOpen.value/100;
        const target = Math.floor(lerp(2, 26, openness));
        spawnHorizon(Math.max(1, target));
      }
    }
  }
}

// ---------- Rendering ----------
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  const a = selfAnchor();

  // draw “you”
  ctx.fillStyle = "rgba(0,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(a.x, a.y, 6, 0, Math.PI*2);
  ctx.fill();

  // draw horizon nodes
  for(const n of nodes){
    // orbital motion: orbit is part of the future projection
    n.phase += n.omega;

    // pulse: energy drives pulse tightness
    n.pulsePhase += n.pulseW;
    const pulse = 0.85 + 0.15*Math.sin(n.pulsePhase);

    const ox = Math.cos(n.phase) * n.orbitR;
    const oy = Math.sin(n.phase) * n.orbitR * 0.65;

    // position on forward arc (in screen coords)
    const x = a.x + Math.sin(n.ang) * n.r + ox;
    const y = a.y - Math.cos(n.ang) * n.r + oy;

    // “loom”: nearer horizon feels more present
    const loom = clamp(1 - n.r/900, 0, 1);

    // tension on the tether:
    // taut when energy is high and horizon distance is moderate;
    // limp when energy is low or far out.
    const tension = clamp(0.10 + 0.80*(n.energy) * (0.6 + 0.4*loom), 0, 1);

    // tether line (taut vs limp)
    const lineAlpha = 0.03 + 0.18*tension;
    const lineW = 0.8 + 2.0*tension;
    ctx.strokeStyle = `rgba(0,0,0,${lineAlpha})`;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    // node glow (muted rainbow)
    const r = n.size * (0.95 + 0.35*loom) * pulse;

    // soft halo
    ctx.beginPath();
    ctx.fillStyle = `hsla(${n.hue},${n.sat}%,${n.light}%,${0.10 + 0.12*tension})`;
    ctx.arc(x, y, r*2.2, 0, Math.PI*2);
    ctx.fill();

    // core
    ctx.beginPath();
    ctx.fillStyle = `hsla(${n.hue},${n.sat}%,${n.light-6}%,${0.55 + 0.30*tension})`;
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fill();

    // crisp edge to avoid balloon look
    ctx.strokeStyle = `rgba(0,0,0,${0.10 + 0.25*tension})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.stroke();
  }
}

// ---------- Loop ----------
function frame(){
  update();
  draw();
  requestAnimationFrame(frame);
}

// ---------- Init ----------
spawnHorizon(3);
stStep.textContent = "0";
stOpt.textContent = String(nodes.length);
requestAnimationFrame(frame);