// phyloMAT Path Mode v1
// Embodied camera + forward decision field

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
  x: 0,
  y: 0,
  vx: 0,
  vy: 0
};

// universe bounds (soft)
const BOX = {
  minX: -1200,
  maxX:  1200,
  minY: -2600,
  maxY:   200
};

// screen anchor for “you”
function selfAnchor(){
  return { x: W/2, y: H*0.78 };
}

// options in front of camera
let options = [];

// ---------- Math ----------
const rand = (a,b)=>a+Math.random()*(b-a);
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function unit(v){
  const d=Math.hypot(v.x,v.y)||1;
  return {x:v.x/d,y:v.y/d};
}

// inward bias near box edges
function inwardBias(pos){
  let bx = 0, by = 0;
  if(pos.x < BOX.minX+200) bx += 1;
  if(pos.x > BOX.maxX-200) bx -= 1;
  if(pos.y < BOX.minY+200) by += 1;
  if(pos.y > BOX.maxY-200) by -= 1;
  return unit({x:bx,y:by});
}

// ---------- Option generation ----------
function spawnOptions(count){
  options = [];

  const openness = slOpen.value/100;
  const horizon  = slHor.value;
  const spread   = lerp(0.25, 1.1, openness);

  const bias = inwardBias(camera);

  for(let i=0;i<count;i++){
    const a = rand(-spread, spread);
    const d = rand(260, 420) * horizon;

    const dir = unit({
      x: Math.sin(a) + bias.x*0.6,
      y: -Math.cos(a) + bias.y*0.6
    });

    options.push({
      dir,
      dist: d,
      r: rand(18,28),
      pulse: Math.random()*6.28,
      drift: rand(0.6,1.0)
    });
  }

  stOpt.textContent = options.length;
}

// ---------- Movement ----------
function commitDirection(dir){
  const speed = slSpeed.value/100;
  camera.vx = dir.x * speed * 420;
  camera.vy = dir.y * speed * 420;
  moving = true;
}

canvas.addEventListener("dblclick", (ev)=>{
  if(moving) return;

  const a = selfAnchor();
  const mx = ev.clientX - a.x;
  const my = ev.clientY - a.y;

  const dir = unit({x:mx, y:my||-1});
  commitDirection(dir);
});

// ---------- Update ----------
function update(){
  if(moving){
    camera.x += camera.vx * 0.016;
    camera.y += camera.vy * 0.016;

    camera.vx *= 0.92;
    camera.vy *= 0.92;

    if(Math.hypot(camera.vx,camera.vy) < 6){
      moving = false;
      step++;
      stStep.textContent = step;

      if(step === 1) {
        spawnOptions(3);
      } else {
        spawnOptions(
          Math.max(1, Math.floor(lerp(2, 30, slOpen.value/100)))
        );
      }
    }
  }
}

// ---------- Draw ----------
function drawOptions(t){
  const a = selfAnchor();

  for(const o of options){
    o.pulse += 0.02*o.drift;

    const wx = camera.x + o.dir.x * o.dist;
    const wy = camera.y + o.dir.y * o.dist;

    const sx = a.x + (wx - camera.x);
    const sy = a.y + (wy - camera.y);

    const loom = clamp(1 - o.dist/1200, 0, 1);
    const r = o.r * (1.4 + loom*3.2);

    // tether
    ctx.strokeStyle = `rgba(0,0,0,${0.06+0.14*loom})`;
    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(sx,sy);
    ctx.stroke();

    // node
    ctx.beginPath();
    ctx.fillStyle = `rgba(90,130,190,${0.42+0.45*loom})`;
    ctx.arc(
      sx,
      sy,
      r*(1+0.18*Math.sin(o.pulse)),
      0,Math.PI*2
    );
    ctx.fill();
  }
}

// ---------- Render ----------
function frame(t){
  ctx.clearRect(0,0,W,H);

  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,W,H);

  drawOptions(t);
  update();

  requestAnimationFrame(frame);
}

// ---------- Init ----------
spawnOptions(3);
requestAnimationFrame(frame);