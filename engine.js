// phyloMAT 2.0 — decision topology engine
// Canvas-first generative growth. No terminal condition.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

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
  stOpt: document.getElementById("stOpt")
};

let W = 0, H = 0, DPR = 1;

function resize(){
  DPR = Math.max(1, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W+"px";
  canvas.style.height = H+"px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize", resize);
resize();

// -----------------------------
// Math helpers
// -----------------------------
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a=1)=>Math.random()*a;
const lerp = (a,b,t)=>a+(b-a)*t;
const TAU = Math.PI*2;

// -----------------------------
// Run state
// -----------------------------
let runID = 0;
let mode = "idle"; // idle | path | overview
let step = 0;

let openness = 0.55;
let horizon = 6;
let speed = 120;

let cam = { x:0, y:0, z:1, tx:0, ty:0, tz:1 };

let trunk = [];       // committed segments
let ghosts = [];      // faded alternatives
let options = [];     // current option field
let selected = null;

// bounding box for growth
function boxForce(p){
  if(!UI.togBox.checked) return {x:0,y:0};
  const pad = 80;
  let fx=0, fy=0;
  if(p.x < pad) fx += (pad - p.x)*0.002;
  if(p.x > W-pad) fx -= (p.x - (W-pad))*0.002;
  if(p.y < pad) fy += (pad - p.y)*0.002;
  if(p.y > H-pad) fy -= (p.y - (H-pad))*0.002;
  return {x:fx,y:fy};
}

// -----------------------------
// Option generation
// -----------------------------
function generateOptions(){
  options = [];
  selected = null;
  UI.btnTravel.disabled = true;

  const base = trunk.length
    ? trunk[trunk.length-1]
    : {x:80,y:H/2, ang:0};

  const count = Math.round(
    clamp(2 + openness*24 - trunk.length*0.05, 1, horizon*4)
  );

  for(let i=0;i<count;i++){
    const spread = lerp(0.2,1.2,openness);
    const ang = base.ang + rand(spread) - spread/2;
    const len = lerp(18,42,Math.random());
    const jitter = rand(0.8);

    options.push({
      x: base.x + Math.cos(ang)*len,
      y: base.y + Math.sin(ang)*len,
      ang,
      len,
      attract: Math.random(),
      pulse: Math.random()*TAU,
      jitter
    });
  }

  UI.stOpt.textContent = options.length;
}

// -----------------------------
// Commit step
// -----------------------------
function commit(){
  if(!selected) return;

  const prev = trunk.length
    ? trunk[trunk.length-1]
    : {x:80,y:H/2, ang:0};

  const seg = {
    x: selected.x,
    y: selected.y,
    px: prev.x,
    py: prev.y,
    ang: selected.ang,
    w: clamp(2.5 - step*0.01, 0.8, 3.5)
  };

  trunk.push(seg);

  if(UI.togGhost.checked){
    for(const o of options){
      if(o!==selected){
        ghosts.push({
          x:o.x, y:o.y, px:prev.x, py:prev.y,
          life:1
        });
      }
    }
  }

  step++;
  generateOptions();

  cam.tx = seg.x;
  cam.ty = seg.y;
  cam.tz = 1.0;

  UI.stStep.textContent = step;
}

// -----------------------------
// Rendering
// -----------------------------
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,W,H);

  ctx.save();
  ctx.translate(W/2-cam.x*cam.z, H/2-cam.y*cam.z);
  ctx.scale(cam.z, cam.z);

  // ghosts
  if(UI.togGhost.checked){
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.lineWidth = 1;
    for(const g of ghosts){
      ctx.beginPath();
      ctx.moveTo(g.px,g.py);
      ctx.lineTo(g.x,g.y);
      ctx.stroke();
    }
  }

  // trunk
  ctx.strokeStyle = "#000";
  for(const s of trunk){
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(s.px,s.py);
    ctx.lineTo(s.x,s.y);
    ctx.stroke();
  }

  // options
  for(const o of options){
    const pulse = 0.6 + 0.4*Math.sin(o.pulse);
    ctx.fillStyle = o===selected
      ? "rgba(0,0,0,0.9)"
      : `rgba(0,0,0,${0.35+0.35*o.attract*pulse})`;
    ctx.beginPath();
    ctx.arc(o.x,o.y,4+3*o.attract,0,TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    const last = trunk.length
      ? trunk[trunk.length-1]
      : {x:80,y:H/2};
    ctx.beginPath();
    ctx.moveTo(last.x,last.y);
    ctx.lineTo(o.x,o.y);
    ctx.stroke();
  }

  ctx.restore();
}

// -----------------------------
// Animation loop
// -----------------------------
let lastT = performance.now();
function tick(t){
  const dt = (t-lastT)/1000;
  lastT = t;

  const sp = speed/120;
  cam.x = lerp(cam.x, cam.tx, dt*2*sp);
  cam.y = lerp(cam.y, cam.ty, dt*2*sp);
  cam.z = lerp(cam.z, cam.tz, dt*2*sp);

  for(const o of options){
    o.pulse += dt*2;
    const f = boxForce(o);
    o.x += f.x*40;
    o.y += f.y*40;
  }

  draw();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// -----------------------------
// Interaction
// -----------------------------
canvas.addEventListener("click",(e)=>{
  if(mode!=="path") return;

  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX-rect.left - (W/2-cam.x*cam.z))/cam.z;
  const my = (e.clientY-rect.top  - (H/2-cam.y*cam.z))/cam.z;

  for(const o of options){
    const dx = mx-o.x, dy = my-o.y;
    if(dx*dx+dy*dy < 100){
      selected = o;
      UI.btnTravel.disabled = false;
      return;
    }
  }
});

UI.btnTravel.onclick = commit;
UI.btnStart.onclick = ()=>{
  mode="path";
  trunk=[];
  ghosts=[];
  step=0;
  cam={x:80,y:H/2,z:1,tx:80,ty:H/2,tz:1};
  generateOptions();
  UI.stRun.textContent = `run-${++runID}`;
  UI.stMode.textContent = "path";
  UI.stStep.textContent = "0";
};

UI.btnOverview.onclick = ()=>{
  mode="overview";
  cam.tx = W/2;
  cam.ty = H/2;
  cam.tz = 0.45;
  UI.stMode.textContent = "overview";
};

UI.btnReturn.onclick =
UI.btnReturn2.onclick = ()=>{
  mode="path";
  const last = trunk.length
    ? trunk[trunk.length-1]
    : {x:80,y:H/2};
  cam.tx = last.x;
  cam.ty = last.y;
  cam.tz = 1.0;
  UI.stMode.textContent = "path";
};

UI.btnReset.onclick = ()=>location.reload();
UI.btnPNG.onclick = ()=>{
  const a=document.createElement("a");
  a.download="phylomat_run.png";
  a.href=canvas.toDataURL("image/png");
  a.click();
};

// sliders
function sync(){
  openness = UI.slOpen.value/100;
  horizon = +UI.slHor.value;
  speed = +UI.slSpeed.value;
  UI.lbOpen.textContent = openness.toFixed(2);
  UI.lbHor.textContent = horizon;
  UI.lbSpeed.textContent = (speed/100).toFixed(2);
}
["slOpen","slHor","slSpeed"].forEach(id=>{
  UI[id].addEventListener("input",sync);
});
sync();