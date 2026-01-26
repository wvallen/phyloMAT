// phyloMAT 2.0 — Layered Stream Engine v1.2
// always flows forward; clicks add inertia; 3 streams with cloud-like clusters
// line tension varies (taut vs limp) + slack curvature; finite wall at TOTAL_LAYERS

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

// ---- UI (sliders only, engine-first) ----
const slOpen  = document.getElementById("slOpen");
const slHor   = document.getElementById("slHor");
const slSpeed = document.getElementById("slSpeed");
const stStep  = document.getElementById("stStep");
const stOpt   = document.getElementById("stOpt");
const stMode  = document.getElementById("stMode");
stMode.textContent = "path";

// ---- constants ----
const TOTAL_LAYERS = 30;

function anchor(){
  return { x: W*0.50, y: H*0.78 };
}

// three stream “mean” hues (muted rainbow)
const streamHue = [205, 245, 285]; // blue / teal / purple

// ---- state ----
let layer = 0;
let alive = true;

let chosenStream = 1;  // 0..2 based on inertia
let playerX = 0;       // lateral offset
let vX = 0;            // lateral inertia

// forward drift (continuous)
let z = 1.0;           // 1 far → 0 near (arrival)
let zVel = 0.0;        // controlled by speed slider + flow

let nodes = [];        // current layer nodes
let phaseT = 0;

// ---- helpers ----
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp  = (a,b,t)=>a+(b-a)*t;
const rand  = (a,b)=>a+Math.random()*(b-a);

// projection scaling: near nodes loom
function scaleForZ(z){
  const t = 1 - z;
  return 0.55 + 1.55*t; // near ~2.1
}

// how many nodes per stream in this layer (cloud size)
function cloudCountForStream(open){
  // keep it simple: 2–6 nodes per stream depending on openness
  return Math.max(2, Math.min(6, Math.round(2 + open*4)));
}

function streamCenters(){
  const sep = Math.min(280, W*0.20);
  return [-sep, 0, +sep];
}

// ---- layer generation ----
function makeLayer(){
  nodes = [];
  const open = slOpen.value/100;
  const horizon = +slHor.value;

  const centers = streamCenters();

  // base distance of this layer in front of you
  const baseR = lerp(260, 520, clamp(horizon/12,0,1));

  // stream “cloud” parameters (spread grows with openness)
  const cloudX = lerp(22, 75, open);
  const cloudY = lerp(12, 46, open);

  // First layer: exactly 3 total nodes (one per stream)
  const perStream = (layer === 0) ? 1 : cloudCountForStream(open);

  for(let s=0;s<3;s++){
    const meanX = centers[s];

    for(let i=0;i<perStream;i++){
      const energy = clamp(0.25 + 0.75*Math.random(), 0, 1);

      // node “latency”: how limp or taut the tether is
      // lower energy tends to be limper
      const tension = clamp(lerp(0.15, 1.0, energy), 0, 1);

      // place on a forward arc, then jitter into a cloud
      const spreadAng = lerp(Math.PI/14, Math.PI/6.5, open);
      const ang = rand(-spreadAng, spreadAng);

      const r = baseR * rand(0.90, 1.08);

      // base arc point (relative, before cloud jitter)
      let x = Math.sin(ang) * r;
      let y = -Math.cos(ang) * r;

      // shift cloud toward stream mean, then add cloud jitter
      x += meanX + rand(-cloudX, cloudX);
      y += rand(-cloudY, cloudY);

      // orbit parameters (subtle)
      const orbitR = lerp(2.5, 10.0, energy) * (0.8 + 0.4*Math.random());
      const omega  = lerp(0.004, 0.016, energy) * (0.8 + 0.4*Math.random());
      const phase  = Math.random()*Math.PI*2;

      // visual size: less balloon, more “alive point”
      const size = lerp(7.5, 12.5, 0.35 + 0.65*energy);

      const hue = (streamHue[s] + rand(-16,16) + 360) % 360;
      const sat = lerp(28, 62, energy);      // muted
      const lit = lerp(58, 64, 0.5+0.5*energy);

      nodes.push({
        stream:s,
        x, y,
        size,
        energy,
        tension,
        hue, sat, lit,
        orbitR, omega, phase,
        pulse: Math.random()*Math.PI*2,
        pulseW: lerp(0.006, 0.020, energy),
      });
    }
  }

  stOpt.textContent = String(nodes.length);
}

// ---- steering: click or dblclick adds lateral impulse ----
function steerFromEvent(ev, strength){
  if(!alive) return;
  const a = anchor();
  const dx = ev.clientX - a.x;
  const impulse = clamp(dx / (W*0.36), -1, 1);
  const speed = slSpeed.value/100;
  vX += impulse * strength * (0.8 + 0.6*speed);
}

canvas.addEventListener("click", (ev)=> steerFromEvent(ev, 18));
canvas.addEventListener("dblclick", (ev)=> steerFromEvent(ev, 36));

// ---- update ----
function update(dt){
  if(!alive) return;

  phaseT += dt;

  const open = slOpen.value/100;
  const speed = slSpeed.value/100;

  // continuous forward flow (always moving toward next layer)
  const baseFlow = lerp(0.12, 0.28, speed);         // base flow
  const openFlow = lerp(0.00, 0.06, open);          // slightly faster when open
  zVel = (baseFlow + openFlow);

  z = Math.max(0, z - zVel*dt);

  // lateral inertia
  vX *= 0.92;
  playerX += vX * dt;

  // soft clamp
  playerX = clamp(playerX, -W*0.34, W*0.34);

  // choose stream by proximity to centers (decision emerges from inertia)
  const centers = streamCenters();
  let bestS = 1, bestD = Infinity;
  for(let s=0;s<3;s++){
    const d = Math.abs(playerX - centers[s]);
    if(d < bestD){ bestD = d; bestS = s; }
  }
  chosenStream = bestS;

  // node internal motion
  for(const n of nodes){
    n.phase += n.omega;
    n.pulse += n.pulseW;
  }

  // arrival at next layer (when z hits 0)
  if(z <= 0.0001){
    layer += 1;
    stStep.textContent = String(layer);

    if(layer >= TOTAL_LAYERS){
      alive = false;
      stMode.textContent = "wall";
      stOpt.textContent = "0";
      return;
    }

    // bloom forward: reset z and spawn next layer immediately
    z = 1.0;
    makeLayer();
  }
}

// ---- draw ----
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  const a = anchor();
  const youX = a.x + playerX;
  const youY = a.y;

  // you
  ctx.fillStyle = "rgba(0,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(youX, youY, 6.2, 0, Math.PI*2);
  ctx.fill();

  if(!alive){
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("wall", youX + 12, youY + 5);
    return;
  }

  const s = scaleForZ(z);
  const loom = s;

  // draw nodes + lines
  for(const n of nodes){
    // orbit offsets
    const ox = Math.cos(n.phase) * n.orbitR;
    const oy = Math.sin(n.phase) * n.orbitR * 0.60;

    // node position in front, cloud-like (not rigid)
    const x = youX + (n.x - playerX)*0.55 + ox;
    const y = youY + (n.y)*s + oy;

    // pulse
    const pulse = 0.88 + 0.12*Math.sin(n.pulse);

    // tension modulation: chosen stream tends to feel tauter, others looser
    const chosenBoost = (n.stream === chosenStream) ? 1.0 : 0.55;
    const tension = clamp(n.tension * chosenBoost, 0, 1);

    // line: taut vs limp
    // limp lines sag via a control point; taut lines are nearly straight
    const sag = (1 - tension) * 90; // px sag amount
    const cx = (youX + x)/2;
    const cy = (youY + y)/2 + sag;

    const alpha = 0.04 + 0.18*tension;
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = 0.8 + 2.0*tension;

    ctx.beginPath();
    ctx.moveTo(youX, youY);
    // quadratic curve gives “limp” feel when sag>0
    ctx.quadraticCurveTo(cx, cy, x, y);
    ctx.stroke();

    // color (muted)
    const hue = n.hue;
    const sat = n.sat;
    const lit = n.lit;

    // less balloon: smaller halo, more core definition
    const baseR = n.size * loom * pulse;

    // halo
    ctx.beginPath();
    ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${0.07 + 0.10*tension})`;
    ctx.arc(x, y, baseR*1.7, 0, Math.PI*2);
    ctx.fill();

    // core
    ctx.beginPath();
    ctx.fillStyle = `hsla(${hue},${sat}%,${lit-7}%,${0.45 + 0.35*tension})`;
    ctx.arc(x, y, baseR, 0, Math.PI*2);
    ctx.fill();

    // edge
    ctx.strokeStyle = `rgba(0,0,0,${0.08 + 0.18*tension})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(x, y, baseR, 0, Math.PI*2);
    ctx.stroke();
  }
}

// ---- loop ----
let last = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t-last)/1000);
  last = t;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

// ---- init ----
stStep.textContent = "0";
stOpt.textContent = "0";
makeLayer();
requestAnimationFrame(loop);