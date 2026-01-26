// phyloMAT 2.0 — Path Engine v0.3
// Decision horizon with forward arc, orbital futures, color/aliveness

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

let W, H, DPR;
function resize(){
  DPR = Math.max(1, window.devicePixelRatio || 1);
  W = canvas.width = window.innerWidth * DPR;
  H = canvas.height = window.innerHeight * DPR;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize", resize);
resize();

// ---------- UI ----------
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

const camera = {
  y: 0,
  vy: 0
};

// decision horizon
let horizon = [];

// ---------- Math helpers ----------
const rand = (a,b)=>a+Math.random()*(b-a);
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ---------- Horizon generation ----------
function spawnHorizon(count){
  horizon = [];

  const openness = slOpen.value/100;
  const spread = lerp(Math.PI/10, Math.PI/2.4, openness);
  const baseR = lerp(220, 360, slHor.value/12);

  for(let i=0;i<count;i++){
    const t = count===1 ? 0 : (i/(count-1)-0.5)*2;
    const ang = t * spread;

    horizon.push({
      ang,
      r: baseR * rand(0.9,1.1),
      size: rand(12,18),
      phase: Math.random()*Math.PI*2,
      orbit: rand(6,14),
      hue: rand(190,280),
      energy: rand(0.4,1)
    });
  }

  stOpt.textContent = horizon.length;
}

// ---------- Interaction ----------
canvas.addEventListener("dblclick", ()=>{
  if(moving) return;
  moving = true;
  const speed = slSpeed.value/100;
  camera.vy = -speed * 260;
});

// ---------- Update ----------
function update(){
  if(moving){
    camera.y += camera.vy * 0.016;
    camera.vy *= 0.92;

    if(Math.abs(camera.vy) < 1){
      moving = false;
      camera.vy = 0;
      step++;
      stStep.textContent = step;

      if(step === 1) spawnHorizon(3);
      else spawnHorizon(Math.max(1, Math.floor(lerp(2,24, slOpen.value/100))));
    }
  }
}

// ---------- Draw ----------
function drawHorizon(){
  const cx = W/2;
  const cy = H*0.65;

  // origin node
  ctx.beginPath();
  ctx.fillStyle = "#111";
  ctx.arc(cx, cy, 6, 0, Math.PI*2);
  ctx.fill();

  for(const n of horizon){
    n.phase += 0.015;
    const ox = Math.cos(n.phase) * n.orbit;
    const oy = Math.sin(n.phase) * n.orbit * 0.6;

    const x = cx + Math.sin(n.ang) * n.r + ox;
    const y = cy - Math.cos(n.ang) * n.r + oy;

    // tether
    ctx.strokeStyle = `rgba(0,0,0,0.06)`;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(x,y);
    ctx.stroke();

    // node
    ctx.beginPath();
    ctx.fillStyle = `hsla(${n.hue},70%,60%,0.85)`;
    ctx.arc(x,y,n.size*(0.9+0.15*Math.sin(n.phase)),0,Math.PI*2);
    ctx.fill();
  }
}

// ---------- Loop ----------
function frame(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,W,H);

  drawHorizon();
  update();

  requestAnimationFrame(frame);
}

// ---------- Init ----------
spawnHorizon(3);
requestAnimationFrame(frame);
