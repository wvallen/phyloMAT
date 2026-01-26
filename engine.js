// phyloMAT 2.0 — decision field engine
// camera-forward, irreversible, field-based

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let W, H, DPR;

function resize(){
  DPR = window.devicePixelRatio || 1;
  W = canvas.clientWidth = window.innerWidth;
  H = canvas.clientHeight = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resize);
resize();

// ---- UI ----
const ui = {
  start: document.getElementById('btnStart'),
  travel: document.getElementById('btnTravel'),
  overview: document.getElementById('btnOverview'),
  reset: document.getElementById('btnReset'),
  openness: document.getElementById('slOpen'),
  horizon: document.getElementById('slHor'),
  speed: document.getElementById('slSpeed'),
  box: document.getElementById('togBox'),
};

// ---- RNG ----
let seed = Math.floor(Math.random()*1e9);
function rand(){ seed = (seed*1664525+1013904223)%4294967296; return seed/4294967296; }

// ---- State ----
let running = false;
let step = 0;
let mode = 'path';

const universe = {
  minX: 0.1,
  maxX: 0.9,
  minY: 0.05,
  maxY: 0.95
};

let you = { x: 0.5, y: 0.85, vx: 0, vy: -1 };
let spine = [];
let options = [];

// ---- Option generation ----
function spawnOptions(){
  options = [];
  const open = ui.openness.value/100;
  const horizon = parseInt(ui.horizon.value,10);

  const count = step === 0 ? 3 : Math.max(1, Math.round(horizon * (0.4 + open)));

  const baseAngle = Math.atan2(you.vy, you.vx);
  const spread = Math.PI * (0.15 + 0.6*open);

  for(let i=0;i<count;i++){
    const a = baseAngle + (rand()-0.5)*spread;
    const r = 0.18 + rand()*0.22;
    options.push({
      x: you.x + Math.cos(a)*r,
      y: you.y + Math.sin(a)*r,
      a,
      r: 6 + rand()*10,
      pulse: rand()*Math.PI*2
    });
  }
}

// ---- Commit movement ----
function commitDirection(dx,dy){
  const m = Math.hypot(dx,dy) || 1;
  you.vx = dx/m;
  you.vy = dy/m;
  ui.travel.disabled = false;
}

function travel(){
  spine.push({x:you.x,y:you.y});
  you.x += you.vx*0.18;
  you.y += you.vy*0.18;
  step++;

  if(ui.box.checked){
    you.x = Math.max(universe.minX, Math.min(universe.maxX, you.x));
    you.y = Math.max(universe.minY, Math.min(universe.maxY, you.y));
  }

  spawnOptions();
}

// ---- Input ----
canvas.addEventListener('dblclick', e=>{
  if(!running) return;
  const nx = e.clientX/W - you.x;
  const ny = e.clientY/H - you.y;
  commitDirection(nx,ny);
  travel();
});

ui.start.onclick = ()=>{
  running = true;
  step = 0;
  spine = [];
  you = { x:0.5, y:0.85, vx:0, vy:-1 };
  spawnOptions();
};

ui.travel.onclick = travel;
ui.reset.onclick = ()=>{
  running = false;
  step = 0;
  spine = [];
  options = [];
};

// ---- Draw ----
function draw(){
  ctx.clearRect(0,0,W,H);

  // spine
  if(spine.length>1){
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    spine.forEach((p,i)=>{
      if(i===0) ctx.moveTo(p.x*W,p.y*H);
      else ctx.lineTo(p.x*W,p.y*H);
    });
    ctx.lineTo(you.x*W,you.y*H);
    ctx.stroke();
  }

  // options
  options.forEach(o=>{
    o.pulse += 0.04;
    const pr = o.r + Math.sin(o.pulse)*2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(o.x*W,o.y*H,pr,0,Math.PI*2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.moveTo(you.x*W,you.y*H);
    ctx.lineTo(o.x*W,o.y*H);
    ctx.stroke();
  });

  // you
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(you.x*W,you.y*H,5,0,Math.PI*2);
  ctx.fill();

  requestAnimationFrame(draw);
}

draw();