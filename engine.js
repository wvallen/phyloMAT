// phyloMAT 2.0 — prototype engine
// Decision topology explorer
// Canvas-only, deterministic per run

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

let W, H, DPR;

function resize(){
  DPR = Math.max(1, window.devicePixelRatio || 1);
  W = canvas.width = Math.floor(window.innerWidth * DPR);
  H = canvas.height = Math.floor(window.innerHeight * DPR);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize", resize);
resize();

/* ------------------ UI ------------------ */

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

/* ------------------ Random (deterministic) ------------------ */

let seed = 1;
function rand(){
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967295;
}
function randN(){
  return Math.sqrt(-2*Math.log(Math.max(1e-6, rand()))) *
         Math.cos(2*Math.PI*rand());
}

/* ------------------ Universe ------------------ */

const universe = {
  x0: 80,
  y0: 80,
  x1: () => window.innerWidth - 80,
  y1: () => window.innerHeight - 80
};

/* ------------------ State ------------------ */

let state;

function reset(){
  seed = Math.floor(Math.random()*1e9);
  state = {
    agent: {
      x: window.innerWidth/2,
      y: window.innerHeight - 120,
      dx: 0,
      dy: -1
    },
    step: 0,
    path: [],
    ghosts: [],
    options: [],
    selected: null,
    cam: {
      x: window.innerWidth/2,
      y: window.innerHeight/2,
      z: 1,
      tx: 0,
      ty: 0
    },
    mode: "path",
    running: false
  };
  generateOptions();
  updateUI();
}

reset();

/* ------------------ Decision Field ------------------ */

function generateOptions(){
  const openness = UI.slOpen.value / 100;
  const horizon = parseInt(UI.slHor.value,10);
  const Nmin = 2;
  const Nmax = 30;

  const N = Math.floor(Nmin + openness * (Nmax - Nmin));
  const spread = Math.PI * openness;

  const opts = [];

  for(let i=0;i<N;i++){
    const a = Math.atan2(state.agent.dy, state.agent.dx);
    const theta = a + randN()*spread*0.35;
    const d = horizon * 40;
    const x = state.agent.x + Math.cos(theta)*d;
    const y = state.agent.y + Math.sin(theta)*d;

    opts.push({
      x,y,
      dx: Math.cos(theta),
      dy: Math.sin(theta),
      w: Math.max(0.1, 1 - Math.abs(theta-a)/spread),
      pulse: rand()*Math.PI*2
    });
  }

  state.options = opts;
  state.selected = null;
  UI.btnTravel.disabled = true;
}

/* ------------------ Interaction ------------------ */

canvas.addEventListener("click", e=>{
  if(state.mode!=="path") return;
  const mx = e.clientX;
  const my = e.clientY;

  let best = null;
  let bestD = 1e9;
  for(const o of state.options){
    const dx = o.x - mx;
    const dy = o.y - my;
    const d = Math.hypot(dx,dy);
    if(d<28 && d<bestD){
      best = o;
      bestD = d;
    }
  }
  if(best){
    state.selected = best;
    UI.btnTravel.disabled = false;
  }
});

canvas.addEventListener("dblclick", ()=>{
  if(state.selected) commit();
});

UI.btnTravel.onclick = ()=>commit();

function commit(){
  const sel = state.selected;
  if(!sel) return;

  // record path
  state.path.push({
    x0: state.agent.x,
    y0: state.agent.y,
    x1: sel.x,
    y1: sel.y
  });

  // rejected futures become ghosts
  for(const o of state.options){
    if(o!==sel){
      state.ghosts.push({
        x: state.agent.x,
        y: state.agent.y,
        dx: o.dx,
        dy: o.dy,
        life: 1
      });
    }
  }

  // move agent
  state.agent.x = sel.x;
  state.agent.y = sel.y;
  state.agent.dx = sel.dx;
  state.agent.dy = sel.dy;

  state.step++;
  generateOptions();
  updateUI();
}

/* ------------------ Camera ------------------ */

function updateCamera(dt){
  const speed = UI.slSpeed.value / 100;
  state.cam.tx = state.agent.x;
  state.cam.ty = state.agent.y - 120;

  state.cam.x += (state.cam.tx - state.cam.x) * dt * 2 * speed;
  state.cam.y += (state.cam.ty - state.cam.y) * dt * 2 * speed;
}

/* ------------------ Drawing ------------------ */

function draw(){
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.save();
  ctx.translate(
    window.innerWidth/2 - state.cam.x,
    window.innerHeight/2 - state.cam.y
  );

  // ghosts
  for(const g of state.ghosts){
    g.x += g.dx * 0.4;
    g.y += g.dy * 0.4;
    g.life *= 0.997;

    ctx.strokeStyle = `rgba(120,120,120,${0.08*g.life})`;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x - g.dx*20, g.y - g.dy*20);
    ctx.stroke();
  }

  // tree
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.2;
  for(const s of state.path){
    ctx.beginPath();
    ctx.moveTo(s.x0,s.y0);
    ctx.lineTo(s.x1,s.y1);
    ctx.stroke();
  }

  // options
  for(const o of state.options){
    o.pulse += 0.03;
    const r = 10 + 6*Math.sin(o.pulse);

    ctx.fillStyle = (o===state.selected)
      ? "rgba(80,160,220,0.9)"
      : "rgba(120,120,120,0.65)";

    ctx.beginPath();
    ctx.arc(o.x,o.y,r,0,Math.PI*2);
    ctx.fill();
  }

  // agent
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(state.agent.x,state.agent.y,6,0,Math.PI*2);
  ctx.fill();

  ctx.restore();
}

/* ------------------ Loop ------------------ */

let last = performance.now();
function loop(t){
  const dt = Math.min(0.05,(t-last)/1000);
  last = t;
  updateCamera(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ------------------ UI ------------------ */

function updateUI(){
  UI.lbOpen.textContent = (UI.slOpen.value/100).toFixed(2);
  UI.lbHor.textContent = UI.slHor.value;
  UI.lbSpeed.textContent = (UI.slSpeed.value/100).toFixed(2);
  UI.stStep.textContent = state.step;
  UI.stOpt.textContent = state.options.length;
  UI.stMode.textContent = state.mode;
}

UI.slOpen.oninput = ()=>{ updateUI(); generateOptions(); };
UI.slHor.oninput = ()=>{ updateUI(); generateOptions(); };
UI.slSpeed.oninput = updateUI;

UI.btnReset.onclick = reset;
UI.btnPNG.onclick = ()=>{
  const a=document.createElement("a");
  a.download="phylomat_run.png";
  a.href=canvas.toDataURL();
  a.click();
};