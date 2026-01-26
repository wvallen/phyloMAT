// phyloMAT Path Mode v0
// First-person decision field
// No overview, no tree, no export

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

let W, H, DPR;
function resize(){
  DPR = Math.max(1, window.devicePixelRatio || 1);
  W = canvas.width = window.innerWidth * DPR;
  H = canvas.height = window.innerHeight * DPR;
  canvas.style.width = window.innerWidth+"px";
  canvas.style.height = window.innerHeight+"px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize", resize);
resize();

// ---------- UI ----------
const slOpen = document.getElementById("slOpen");
const slHor  = document.getElementById("slHor");
const slSpeed= document.getElementById("slSpeed");

const stStep = document.getElementById("stStep");
const stOpt  = document.getElementById("stOpt");
const stMode = document.getElementById("stMode");

stMode.textContent = "path";

// ---------- State ----------
let step = 0;
let moving = false;

const camera = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0
};

// universe box
const BOX = {
  w: 2000,
  h: 3000
};

// options in front of camera
let options = [];

// ---------- Math helpers ----------
const rand = (a,b)=>a+Math.random()*(b-a);
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function unit(v){
  const d=Math.hypot(v.x,v.y)||1;
  return {x:v.x/d,y:v.y/d};
}

// ---------- Option generation ----------
function spawnOptions(count){
  options = [];
  const openness = slOpen.value/100;
  const horizon  = slHor.value;
  const spread   = lerp(0.15, 0.9, openness);

  for(let i=0;i<count;i++){
    const a = rand(-spread, spread);
    const d = rand(180, 260) * horizon;
    options.push({
      ang: a,
      dist: d,
      r: rand(10,18),
      pulse: Math.random()*6.28,
      drift: rand(0.4,0.9)
    });
  }
  stOpt.textContent = options.length;
}

// ---------- Movement ----------
function commitDirection(dir){
  const speed = slSpeed.value/100;
  camera.vx = dir.x * speed * 220;
  camera.vy = dir.y * speed * 220;
  moving = true;
}

canvas.addEventListener("dblclick", (ev)=>{
  if(moving) return;

  const mx = ev.clientX - window.innerWidth/2;
  const my = ev.clientY - window.innerHeight*0.65;

  const dir = unit({x:mx,y:my||-1});
  commitDirection(dir);
});

// ---------- Draw ----------
function drawOptions(t){
  for(const o of options){
    o.pulse += 0.02*o.drift;

    const px = W/2 + Math.sin(o.ang)*o.dist;
    const py = H*0.65 - Math.cos(o.ang)*o.dist;

    const loom = clamp(1 - o.dist/900, 0, 1);
    const r = o.r * (1.2 + loom*2.4);

    ctx.beginPath();
    ctx.fillStyle = `rgba(80,120,180,${0.45+0.4*loom})`;
    ctx.arc(px,py,r*(1+0.15*Math.sin(o.pulse)),0,Math.PI*2);
    ctx.fill();

    // tether line
    ctx.strokeStyle = `rgba(0,0,0,${0.08+0.12*loom})`;
    ctx.beginPath();
    ctx.moveTo(W/2,H*0.65);
    ctx.lineTo(px,py);
    ctx.stroke();
  }
}

// ---------- Update ----------
function update(){
  if(moving){
    camera.x += camera.vx*0.016;
    camera.y += camera.vy*0.016;

    camera.vx *= 0.94;
    camera.vy *= 0.94;

    if(Math.hypot(camera.vx,camera.vy)<1){
      moving=false;
      step++;
      stStep.textContent = step;

      // first step: exactly 3
      if(step===1) spawnOptions(3);
      else spawnOptions(
        Math.max(1, Math.floor(lerp(2, 28, slOpen.value/100)))
      );
    }
  }
}

// ---------- Render loop ----------
function frame(t){
  ctx.clearRect(0,0,W,H);

  // soft background
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,W,H);

  drawOptions(t);
  update();

  requestAnimationFrame(frame);
}

// ---------- Init ----------
spawnOptions(3);
requestAnimationFrame(frame);