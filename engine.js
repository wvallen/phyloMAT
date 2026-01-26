// phyloMAT 2.0 — Layered Stream Engine v1
// 30-layer finite universe, first split into 3 streams, always moving forward.
// Double-click applies lateral inertia (steering). No node selection.
// Ends at a wall (layer 30). Bloom-forward motion, no snapping.

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

// ---- constants ----
const TOTAL_LAYERS = 30;

// z-axis: nodes spawn at zFar and move toward zNear
const zNear = 0;
const zFar  = 1;

// projection: bigger when closer
function projScale(z){
  // z in [0..1], 0 near, 1 far
  const t = 1 - z; // near -> 1
  return 0.45 + 1.55 * t; // scale range
}

// anchor for "you"
function anchor(){
  return { x: W*0.50, y: H*0.78 };
}

// stream centers (3 planes)
function streamCenters(){
  const sep = Math.min(260, W*0.18);
  return [
    -sep,
     0,
     sep
  ];
}

// muted rainbow palette for 3 streams
const streamHue = [205, 250, 285]; // blue/teal/purple

// ---- state ----
let layer = 0;               // 0..TOTAL_LAYERS
let alive = true;            // false when wall reached
let chosenStream = 1;        // 0,1,2 (your lineage)
let playerX = 0;             // lateral offset from center
let playerVX = 0;            // inertia
let phaseT = 0;              // global breath phase

// nodes in current layer for each stream
let layerNodes = [];         // [{stream,z,x,y, size, pulse, orbitPhase, orbitR, omega, tension}...]

// ---- helpers ----
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp  = (a,b,t)=>a+(b-a)*t;
const rand  = (a,b)=>a+Math.random()*(b-a);

// make one layer of nodes (3 streams)
function makeLayerNodes(){
  const centers = streamCenters();
  const openness = slOpen.value/100;

  // per-layer: exactly one node per stream (legible decision)
  layerNodes = [];
  for(let s=0;s<3;s++){
    const baseX = centers[s];
    const baseY = -Math.min(220, H*0.22) - rand(0, 60); // in front of you

    const energy = clamp(0.35 + 0.65*Math.random(), 0, 1);

    layerNodes.push({
      stream: s,
      z: zFar,                            // start far, move toward near
      x: baseX,
      y: baseY,
      size: lerp(14, 20, energy),
      pulse: Math.random()*Math.PI*2,
      orbitPhase: Math.random()*Math.PI*2,
      orbitR: lerp(4, 12, energy),        // subtle orbit
      omega: lerp(0.012, 0.028, energy),
      tension: lerp(0.25, 1.0, energy),   // line tautness
      energy
    });
  }

  stOpt.textContent = "3";
}

// initialize
makeLayerNodes();
stStep.textContent = "0";

// ---- steering: double-click adds lateral impulse ----
canvas.addEventListener("dblclick", (ev)=>{
  if(!alive) return;

  const a = anchor();
  const dx = ev.clientX - a.x; // screen-space
  const impulse = clamp(dx / (W*0.35), -1, 1); // normalize

  // inertia strength scales with Speed slider (more speed, more “force”)
  const speed = slSpeed.value/100;
  playerVX += impulse * (28 + 55*speed);
});

// ---- update ----
function update(dt){
  if(!alive) return;

  phaseT += dt;

  // inertia decay
  playerVX *= 0.92;
  playerX  += playerVX * dt;

  // soft clamp player within a lane envelope
  playerX = clamp(playerX, -W*0.35, W*0.35);

  // forward motion: nodes move toward you continuously
  const speed = slSpeed.value/100;
  const flow = (0.20 + 0.55*speed) * dt; // how fast z advances

  for(const n of layerNodes){
    n.z = Math.max(zNear, n.z - flow);
    n.pulse += dt * (0.9 + 1.6*n.energy);
    n.orbitPhase += n.omega;

    // slight orbit
    const ox = Math.cos(n.orbitPhase) * n.orbitR;
    const oy = Math.sin(n.orbitPhase) * n.orbitR * 0.55;
    n._ox = ox;
    n._oy = oy;
  }

  // when layer hits you (z near), advance
  const arrived = layerNodes.some(n => n.z <= zNear + 0.0001);
  if(arrived){
    layer += 1;
    stStep.textContent = String(layer);

    // choose stream based on which stream node is closest to your lateral position
    // (decision emerges from inertia, not from selecting a node)
    const centers = streamCenters();
    const px = playerX;
    let bestS = 1;
    let bestD = Infinity;
    for(let s=0;s<3;s++){
      const d = Math.abs(px - centers[s]);
      if(d < bestD){ bestD = d; bestS = s; }
    }
    chosenStream = bestS;

    // wall reached
    if(layer >= TOTAL_LAYERS){
      alive = false;
      stMode.textContent = "wall";
      stOpt.textContent = "0";
      return;
    }

    // “bloom forward”: regenerate next layer immediately (no snap pause)
    makeLayerNodes();
  }
}

// ---- draw ----
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  const a = anchor();
  const centers = streamCenters();

  // you node (moves laterally with inertia)
  const youX = a.x + playerX;
  const youY = a.y;

  // draw faint wall indicator when near end
  const remaining = TOTAL_LAYERS - layer;
  if(remaining <= 6){
    const alpha = clamp((6-remaining)/6, 0, 1) * 0.10;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, W, 8);
  }

  // tethers + nodes
  for(const n of layerNodes){
    const s = projScale(n.z);
    const x = youX + (n.x - playerX) * 0.55 + n._ox;  // separated, but still feels forward
    const y = youY + (n.y) * s + n._oy;

    const loom = s; // near -> larger
    const pulse = 0.85 + 0.15*Math.sin(n.pulse);

    // tension: chosen stream tauter; others limp slightly
    const chosenBoost = (n.stream === chosenStream) ? 1.0 : 0.55;
    const tension = clamp(n.tension * chosenBoost, 0, 1);

    // line thickness/alpha = topology tension signal
    ctx.strokeStyle = `rgba(0,0,0,${0.05 + 0.22*tension})`;
    ctx.lineWidth = 0.8 + 2.2*tension;

    ctx.beginPath();
    ctx.moveTo(youX, youY);
    ctx.lineTo(x, y);
    ctx.stroke();

    // node color: muted rainbow by stream, with slight per-node drift
    const hue = (streamHue[n.stream] + (n.energy-0.5)*18 + 360) % 360;
    const sat = lerp(35, 70, n.energy);
    const light = lerp(58, 64, 0.5 + 0.5*n.energy);

    // halo
    ctx.beginPath();
    ctx.fillStyle = `hsla(${hue},${sat}%,${light}%,${0.10 + 0.16*tension})`;
    ctx.arc(x, y, (n.size*loom)*2.1, 0, Math.PI*2);
    ctx.fill();

    // core
    ctx.beginPath();
    ctx.fillStyle = `hsla(${hue},${sat}%,${light-6}%,${0.45 + 0.40*tension})`;
    ctx.arc(x, y, n.size*loom*pulse, 0, Math.PI*2);
    ctx.fill();

    // crisp edge to avoid balloon look
    ctx.strokeStyle = `rgba(0,0,0,${0.08 + 0.22*tension})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(x, y, n.size*loom*pulse, 0, Math.PI*2);
    ctx.stroke();
  }

  // draw you
  ctx.fillStyle = "rgba(0,0,0,0.96)";
  ctx.beginPath();
  ctx.arc(youX, youY, 6.2, 0, Math.PI*2);
  ctx.fill();

  // if wall reached, render a quiet stop state
  if(!alive){
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("wall", youX + 12, youY + 5);
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
requestAnimationFrame(loop);