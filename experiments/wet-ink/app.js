import { mountShell, makeLoop, loadImage, downloadCanvas, seededRandom } from '../shared/shell.js';
import { InkField } from './model.mjs';
import { seedImpression } from './composition.mjs';
import { coverBox, paperPoint } from './geometry.mjs';
import { withDisabledButton } from './actions.mjs';
const shell=mountShell({id:'wet-ink',title:'Wet ink'}), canvas=document.getElementById('experiment-canvas'), ctx=canvas.getContext('2d',{alpha:false});
const W=264,H=365, print=document.createElement('canvas');print.width=W;print.height=H;const pc=print.getContext('2d',{willReadFrequently:true});
let field,frame,grain,size,loop,ready=false,interactions=0,drag=null,visible=true,exports=0,artBox;
function fitPaper(){const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(1.75,devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);return {width,height,dpr};}
function render(){
 if(!field)return;const p=frame.data;
 for(let i=0;i<W*H;i++){const ink=Math.min(1,field.ink[i]*1.13),orange=Math.min(.95,field.orange[i]*1.7),paper=grain[i];p[i*4]=paper*(1-ink)*(1-orange)+24*ink*(1-orange)+238*orange;p[i*4+1]=(paper-3)*(1-ink)*(1-orange)+28*ink*(1-orange)+74*orange;p[i*4+2]=(paper-10)*(1-ink)*(1-orange)+27*ink*(1-orange)+26*orange;p[i*4+3]=255;}
 pc.putImageData(frame,0,0);ctx.setTransform(size.dpr,0,0,size.dpr,0,0);ctx.fillStyle='#f7f2e8';ctx.fillRect(0,0,size.width,size.height);ctx.imageSmoothingEnabled=true;artBox=coverBox(size.width,size.height,W,H);ctx.drawImage(print,artBox.x,artBox.y,artBox.w,artBox.h);
}
function wake(){if(shell.motion&&visible)loop.start();}
function tick(dt){field.step(dt);render();const s=field.snapshot();if(!drag&&((!field.recovering&&s.energy<.0001)||(field.recovering&&s.displacement<.000005&&s.orangeDisplacement<.000005)))loop.stop();}
function point(e){const transform=new DOMMatrix(getComputedStyle(canvas.parentElement).transform),angle=Math.atan2(transform.b,transform.a),p=paperPoint(e.clientX,e.clientY,canvas.getBoundingClientRect(),size.width,size.height,angle);return {x:(p.x-artBox.x)/artBox.w*W,y:(p.y-artBox.y)/artBox.h*H};}
function stir(x,y,dx,dy){field.stir(x,y,dx,dy,37);interactions++;if(!shell.motion){for(let i=0;i<12;i++)field.step(1/60);}else field.step(1/60);render();wake();}
function play(){if(!ready)return;stir(W*.51,H*.49,8,-5);shell.setStatus(shell.motion?'A fresh curl. Drag to make it your own.':'A still impression added. Resume motion to let it flow.');}
async function init(){try{
 const image=await loadImage('../../assets/headshot.jpg');
 // Provenance: supplied outdoor portrait. Crop is image-derived, never a geometric silhouette.
 pc.drawImage(image,260,590,1050,1450,0,0,W,H);const pixels=pc.getImageData(0,0,W,H).data,source=new Float32Array(W*H);grain=new Float32Array(W*H);const random=seededRandom(2941);
 for(let i=0;i<source.length;i++){const l=(pixels[i*4]*.2126+pixels[i*4+1]*.7152+pixels[i*4+2]*.0722)/255;source[i]=Math.max(0,Math.min(1,(.86-l)*1.45));grain[i]=246+random()*9;}
 const baseline=seedImpression(W,H,source);field=new InkField(W,H,baseline.ink,baseline.orange);frame=pc.createImageData(W,H);size=fitPaper();render();loop=makeLoop(tick,{enabled:false});ready=true;shell.markReady({rendering:'canvas2d'});
 new ResizeObserver(()=>{size=fitPaper();render();}).observe(canvas);
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible)loop.stop();else if(field.snapshot().energy>.0001||field.recovering)wake();}).observe(canvas);
 shell.onMotionChange(on=>{if(!on){drag=null;loop.stop();render();}else if(field.snapshot().energy>.0001||field.recovering)wake();});
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;canvas.setPointerCapture(e.pointerId);drag=point(e);stir(drag.x,drag.y,1,0);});
 canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);stir(p.x,p.y,p.x-drag.x,p.y-drag.y);drag=p;});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drag=null;});
 document.addEventListener('experiment:play',play);
 document.addEventListener('experiment:reset',()=>{drag=null;loop.stop();field.reset();render();});
 document.getElementById('reform-portrait').addEventListener('click',()=>{interactions++;drag=null;if(!shell.motion){field.reset();render();}else{field.reform();wake();}shell.setStatus('Returning to the original impression.');});
 document.getElementById('keep-impression').addEventListener('click',async e=>{const button=e.currentTarget;await withDisabledButton(button,async()=>{try{const keepsake=document.createElement('canvas');keepsake.width=792;keepsake.height=1200;const k=keepsake.getContext('2d');k.fillStyle='#f7f2e8';k.fillRect(0,0,792,1200);k.drawImage(print,32,32,728,1006);k.fillStyle='#181c1c';k.font='600 27px "Plus Jakarta Sans"';k.fillText('Usman Saleem',34,1091);k.font='16px "Plus Jakarta Sans"';k.fillText('An open impression · Mechanical engineer',34,1128);k.fillStyle='#ff541e';k.fillRect(34,1160,64,4);const blob=await downloadCanvas(keepsake,'usman-wet-ink-impression.png');exports++;shell.setStatus(`Your impression is ready as a PNG (${Math.round(blob.size/1024)} KB).`);}catch(error){shell.setStatus('The PNG could not be saved. Please try again.');console.error(error);}});});
 if(new URLSearchParams(location.search).has('debug'))window.__experiment={id:'wet-ink',snapshot:()=>({...field.snapshot(),motion:shell.motion,ready,interactions,exports,resolution:[W,H],running:loop.running})};
 }catch(error){document.body.dataset.imageFailed='true';document.querySelector('.portrait-message span').textContent='Portrait unavailable. Reload to try again.';shell.setStatus('The portrait could not load. Please reload to try again; portfolio links are available.');console.error(error);}}
init();
