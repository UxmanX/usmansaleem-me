import { mountShell, fitCanvas, makeLoop, loadImage, clamp } from '../shared/shell.js';
import { PinField } from './model.mjs';
const shell=mountShell({id:'pin-art',title:'Pin art'}),canvas=document.getElementById('experiment-canvas'),ctx=canvas.getContext('2d',{alpha:false}),W=89,H=116;
let pins,luma,size,loop,ready=false,interactions=0,depth=.7,pressing=null,visible=true,geo,normal;
const caps=[];
function buildCaps(){for(let i=0;i<48;i++){const c=document.createElement('canvas');c.width=18;c.height=18;const x=c.getContext('2d'),level=27+i*4.5,g=x.createRadialGradient(6,5,0,10,11,9);g.addColorStop(0,`rgb(${Math.min(255,level+63)},${Math.min(255,level+66)},${Math.min(255,level+66)})`);g.addColorStop(.3,`rgb(${level+24},${level+28},${level+28})`);g.addColorStop(.66,`rgb(${level},${level+5},${level+6})`);g.addColorStop(1,`rgb(${Math.max(12,level-37)},${Math.max(15,level-32)},${Math.max(16,level-31)})`);x.fillStyle=g;x.beginPath();x.ellipse(9,9,7.4,6.5,0,0,Math.PI*2);x.fill();x.strokeStyle='rgba(232,239,234,.25)';x.lineWidth=.7;x.stroke();caps.push(c);}}
function polygon(points,fill){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();}
function project(x,y,z=0){const {left,top,bw,bh,shear,drop,lift}=geo;return [left+x*bw+shear*(1-y),top+y*bh+drop*x-z*lift];}
function render(){if(!pins)return;ctx.setTransform(size.dpr,0,0,size.dpr,0,0);ctx.fillStyle='#ff541e';ctx.fillRect(0,0,size.width,size.height);
 const bw=Math.min(size.width*.79,size.height*.76),bh=bw*1.17,left=(size.width-bw)/2-12,top=(size.height-bh)/2+12;geo={bw,bh,left,top,shear:bw*.072,drop:bh*.048,lift:bw*.09*depth};
 const a=project(-.027,-.022),b=project(1.025,-.022),c=project(1.025,1.025),d=project(-.027,1.025),thick=Math.max(9,bw*.029);
 ctx.save();ctx.shadowColor='rgba(54,22,13,.32)';ctx.shadowBlur=24;ctx.shadowOffsetX=9;ctx.shadowOffsetY=20;polygon([a,b,c,d],'#202727');ctx.restore();
 polygon([b,c,[c[0]+3,c[1]+thick],[b[0]+3,b[1]+thick]],'#3d4745');polygon([d,c,[c[0]+3,c[1]+thick],[d[0]+3,d[1]+thick]],'#56605c');
 const plate=ctx.createLinearGradient(left,top,left+bw,top+bh);plate.addColorStop(0,'#5b6560');plate.addColorStop(.4,'#343e3b');plate.addColorStop(1,'#151e1c');polygon([a,b,c,d],plate);
 const step=bw/(W-1),r=step*.445;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,z=pins.z[i],base=project(x/(W-1),y/(H-1),0),p=project(x/(W-1),y/(H-1),z);ctx.strokeStyle='rgba(10,18,17,.78)';ctx.lineWidth=r*1.05;ctx.beginPath();ctx.moveTo(base[0]+r*.28,base[1]+r*.35);ctx.lineTo(p[0]+r*.28,p[1]+r*.4);ctx.stroke();ctx.strokeStyle='#6b7873';ctx.lineWidth=Math.max(.35,r*.22);ctx.beginPath();ctx.moveTo(base[0]-r*.38,base[1]);ctx.lineTo(p[0]-r*.38,p[1]);ctx.stroke();
  const depression=Math.max(0,pins.source[i]-z),tone=clamp(luma[i]*.82+normal[i]*.13+z*.07-depression*.85,0,1);ctx.drawImage(caps[Math.min(47,Math.floor(tone*47))],p[0]-r,p[1]-r,r*2,r*2);
 }
 for(const [x,y] of [a,b,c,d]){ctx.fillStyle='#9da7a0';ctx.beginPath();ctx.arc(x+(x<left+bw/2?4:-4),y+(y<top+bh/2?4:-4),2.4,0,Math.PI*2);ctx.fill();}
}
function wake(){if(shell.motion&&visible)loop.start();}
function tick(dt){if(pressing)pins.press(pressing.x,pressing.y,13);else pins.step(dt);render();if(!pressing&&pins.snapshot().energy<1e-8)loop.stop();}
function point(e){const r=canvas.getBoundingClientRect(),px=(e.clientX-r.left)*size.width/r.width,py=(e.clientY-r.top)*size.height/r.height,{left,top,bw,bh,shear,drop}=geo;const yy=(py-top-drop*(px-left-shear)/bw)/(bh+drop*shear/bw);return {x:(px-left-shear*(1-yy))/bw*(W-1),y:yy*(H-1)};}
function press(x,y){pins.press(x,y,13);interactions++;render();wake();}
function play(){if(!ready)return;press(W*.52,H*.48);shell.setStatus(shell.motion?'Pins pressed. The springs bring the face back.':'Pins pressed in a still pose. Reset or resume motion to recover.');}
async function init(){try{const image=await loadImage('../../assets/headshot.jpg'),p=document.createElement('canvas');p.width=W;p.height=H;const c=p.getContext('2d',{willReadFrequently:true});
 // Same supplied portrait as wet ink; no generated face or approximate subject mask.
 c.drawImage(image,260,590,1050,1450,0,0,W,H);const pixels=c.getImageData(0,0,W,H).data;luma=new Float32Array(W*H);normal=new Float32Array(W*H);const heights=new Float32Array(W*H);
 for(let i=0;i<luma.length;i++){const l=(pixels[i*4]*.2126+pixels[i*4+1]*.7152+pixels[i*4+2]*.0722)/255;luma[i]=clamp((l-.15)*1.48,.035,.98);heights[i]=.12+.83*(1-luma[i]);}
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,gx=heights[y*W+Math.min(W-1,x+1)]-heights[y*W+Math.max(0,x-1)],gy=heights[Math.min(H-1,y+1)*W+x]-heights[Math.max(0,y-1)*W+x];normal[i]=clamp(.5-gx*2.4-gy*1.9,0,1);}
 pins=new PinField(W,H,heights);buildCaps();size=fitCanvas(canvas,1.75);render();loop=makeLoop(tick,{enabled:false});ready=true;shell.markReady({rendering:'canvas2d'});
 new ResizeObserver(()=>{size=fitCanvas(canvas,1.75);render();}).observe(canvas);new IntersectionObserver(e=>{visible=e[0].isIntersecting;if(!visible)loop.stop();else if(pins.snapshot().energy>1e-8)wake();}).observe(canvas);
 shell.onMotionChange(on=>{if(!on){pressing=null;loop.stop();render();}else if(pins.snapshot().energy>1e-8)wake();});
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;canvas.setPointerCapture(e.pointerId);pressing=point(e);press(pressing.x,pressing.y);});canvas.addEventListener('pointermove',e=>{if(!pressing)return;pressing=point(e);press(pressing.x,pressing.y);});for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{pressing=null;wake();});
 document.addEventListener('experiment:play',play);document.addEventListener('experiment:reset',()=>{pressing=null;loop.stop();pins.reset();render();});document.getElementById('relief-depth').addEventListener('input',e=>{depth=Number(e.target.value)/100;document.getElementById('depth-value').textContent=`${e.target.value}%`;interactions++;render();});
 if(new URLSearchParams(location.search).has('debug'))window.__experiment={id:'pin-art',snapshot:()=>({...pins.snapshot(),depth,motion:shell.motion,ready,interactions,pressed:!!pressing,running:loop.running})};
 }catch(error){document.body.dataset.imageFailed='true';document.querySelector('.portrait-message span').textContent='Portrait unavailable. Reload to try again.';shell.setStatus('The portrait could not load. Please reload to try again; portfolio links are available.');console.error(error);}}
init();
