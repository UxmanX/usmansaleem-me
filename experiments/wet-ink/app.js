import { mountShell, makeLoop, loadImage, downloadCanvas, seededRandom } from '../shared/shell.js';
import { InkField } from './model.mjs?v=material-2';
import { seedImpression } from './composition.mjs?v=material-2';
import { coverBox, paperPoint } from './geometry.mjs?v=material-2';
import { withDisabledButton } from './actions.mjs?v=material-2';

const shell=mountShell({id:'wet-ink',title:'Wet ink'}), canvas=document.getElementById('experiment-canvas'), ctx=canvas?canvas.getContext('2d',{alpha:false}):null;
const W=264,H=365, print=document.createElement('canvas');print.width=W;print.height=H;const pc=print.getContext('2d',{willReadFrequently:true});
let field,frame,grain,size,loop,ready=false,interactions=0,drag=null,visible=true,exports=0,artBox,curlIndex=0;

// Curated calligraphic sweeps pulling real portrait ink into marbled ribbons without blotting eyes
const DEMO_CURLS=[
 [[0.75,0.17],[0.87,0.28],[0.79,0.46]],
 [[0.18,0.76],[0.36,0.68],[0.22,0.52]],
 [[0.88,0.88],[0.68,0.74],[0.84,0.60]],
 [[0.36,0.16],[0.18,0.24],[0.26,0.42]],
];

function failPortrait(message){
 document.body.dataset.imageFailed='true';
 const span=document.querySelector('.portrait-message span');
 if(span)span.textContent=message;
 shell.setStatus('The portrait could not load. Please reload to try again; portfolio links are available.');
}

function fitPaper(){
 const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),dpr=Math.min(1.75,devicePixelRatio||1);
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
 return {width,height,dpr};
}

/** Deterministic multi-scale laid cotton-rag paper texture. */
function buildPaperGrain(w,h,seed){
 const random=seededRandom(seed),raw=new Float32Array(w*h),out=new Float32Array(w*h);
 for(let i=0;i<raw.length;i++)raw[i]=random()-0.5;
 for(let y=0;y<h;y++){
  const rowBias=(random()-0.5)*2.4,ym=y>0?y-1:0,yp=y+1<h?y+1:h-1;
  for(let x=0;x<w;x++){
   const xm=x>0?x-1:0,xp=x+1<w?x+1:w-1,i=y*w+x;
   const soft=(raw[ym*w+xm]+raw[ym*w+x]+raw[ym*w+xp]+raw[y*w+xm]+raw[i]+raw[y*w+xp]+raw[yp*w+xm]+raw[yp*w+x]+raw[yp*w+xp])/9;
   const laid=Math.sin(y*1.45+soft*3)*0.9;
   out[i]=247.5+soft*6.5+rowBias+laid+raw[i]*4.2;
  }
 }
 return out;
}

/** Faithful printmaker tone curve with gentle micro-contrast to preserve eye & hair detail. */
function buildPortraitSource(pixels,w,h){
 const lum=new Float32Array(w*h),source=new Float32Array(w*h);
 for(let i=0;i<lum.length;i++)lum[i]=(pixels[i*4]*0.2126+pixels[i*4+1]*0.7152+pixels[i*4+2]*0.0722)/255;
 for(let y=0;y<h;y++){
  const ym=y>0?y-1:0,yp=y+1<h?y+1:h-1,row=y*w;
  for(let x=0;x<w;x++){
   const xm=x>0?x-1:0,xp=x+1<w?x+1:w-1,i=row+x,c=lum[i];
   const blur=(lum[ym*w+xm]+2*lum[ym*w+x]+lum[ym*w+xp]+2*lum[row+xm]+4*c+2*lum[row+xp]+lum[yp*w+xm]+2*lum[yp*w+x]+lum[yp*w+xp])/16;
   const sharp=Math.max(0,Math.min(1,c+(c-blur)*0.34));
   const t=Math.max(0,Math.min(1,(0.86-sharp)/0.86));
   const tc=Math.max(0,Math.min(1,(t-0.02)/0.98));
   source[i]=1-Math.pow(1-tc,1.24);
  }
 }
 return source;
}

function render(){
 if(!field||!ctx||!pc)return;
 const p=frame.data,inkArr=field.ink,orArr=field.orange,wetArr=field.wet;
 for(let y=0;y<H;y++){
  const row=y*W,ym=y>0?(y-1)*W:row,yp=y+1<H?(y+1)*W:row;
  for(let x=0;x<W;x++){
   const i=row+x,xm=x>0?x-1:x,xp=x+1<W?x+1:x;
   const paper=grain[i],wet=wetArr[i];
   const ink=inkArr[i],orRaw=orArr[i];
   // Subtle capillary pigment concentration along crisp wet/marbled ribbon boundaries
   const edge=Math.abs(orArr[row+xp]-orArr[row+xm])+Math.abs(orArr[yp+x]-orArr[ym+x]);
   const k=Math.min(1,ink*(1.03+wet*0.05));
   const o=Math.min(1,orRaw*1.38+edge*0.09*Math.min(1,orRaw*3));
   // Warm archival cotton rag + carbon sumi ink + translucent-lacquer signal vermilion
   const invK=1-k;
   let r=paper*invK+23*k;
   let g=(paper-5)*invK+27*k;
   let b=(paper-14)*invK+27*k;
   if(o>0.001){
    const invO=1-o;
    const orR=244-36*k,orG=74-22*k,orB=24-8*k;
    r=r*invO+orR*o;
    g=g*invO+orG*o;
    b=b*invO+orB*o;
   }
   // Glossy wet-ink meniscus glint that settles smoothly to matte paper as flow dries
   if(wet>0.015){
    const hL=wetArr[row+xm]*(0.5+0.5*orArr[row+xm]+0.35*inkArr[row+xm]);
    const hR=wetArr[row+xp]*(0.5+0.5*orArr[row+xp]+0.35*inkArr[row+xp]);
    const hU=wetArr[ym+x]*(0.5+0.5*orArr[ym+x]+0.35*inkArr[ym+x]);
    const hD=wetArr[yp+x]*(0.5+0.5*orArr[yp+x]+0.35*inkArr[yp+x]);
    const slope=(hL-hR)*0.65+(hU-hD)*0.75;
    const sheen=slope>0?Math.min(34,slope*48*wet):-Math.min(12,-slope*18*wet);
    r+=sheen;g+=sheen*0.96;b+=sheen*0.88;
   }
   const pi=i*4;
   p[pi]=r<0?0:r>255?255:r;
   p[pi+1]=g<0?0:g>255?255:g;
   p[pi+2]=b<0?0:b>255?255:b;
   p[pi+3]=255;
  }
 }
 pc.putImageData(frame,0,0);
 ctx.setTransform(size.dpr,0,0,size.dpr,0,0);
 ctx.fillStyle='#f7f2e8';
 ctx.fillRect(0,0,size.width,size.height);
 ctx.imageSmoothingEnabled=true;
 artBox=coverBox(size.width,size.height,W,H);
 ctx.drawImage(print,artBox.x,artBox.y,artBox.w,artBox.h);
}

function hasActivity(s){
 return (!field.recovering&&(s.energy>=0.0001||s.wetness>=0.004))||(field.recovering&&(s.displacement>=0.000005||s.orangeDisplacement>=0.000005||s.wetness>=0.004));
}

function wake(){if(shell.motion&&visible)loop.start();}

function tick(dt){
 field.step(dt);
 render();
 if(!drag&&!hasActivity(field.snapshot()))loop.stop();
}

function point(e){
 const transform=new DOMMatrix(getComputedStyle(canvas.parentElement).transform),angle=Math.atan2(transform.b,transform.a);
 const p=paperPoint(e.clientX,e.clientY,canvas.getBoundingClientRect(),size.width,size.height,angle);
 return {x:(p.x-artBox.x)/artBox.w*W,y:(p.y-artBox.y)/artBox.h*H};
}

function clearHold(){
 if(drag&&drag.holdTimer){clearInterval(drag.holdTimer);drag.holdTimer=null;}
}

function releaseDrag(){
 if(!drag)return;
 clearHold();
 drag=null;
 if(field)field.endStroke();
}

function stirStep(x,y,dx,dy,radius=34,pigmentScale=1){
 field.stir(x,y,dx,dy,radius,pigmentScale);
 interactions++;
 if(!shell.motion){for(let i=0;i<10;i++)field.step(1/60);}
 else field.step(1/60);
 render();
 wake();
}

function strokeSegment(x0,y0,x1,y1){
 const dx=x1-x0,dy=y1-y0,dist=Math.hypot(dx,dy);
 if(dist<0.6)return;
 const sub=Math.min(8,Math.max(1,Math.ceil(dist/6.5)));
 const sx=dx/sub,sy=dy/sub;
 const pigmentScale=Math.min(1.05,0.48+dist*0.035);
 for(let j=1;j<=sub;j++){
  const t=j/sub;
  field.stir(x0+dx*t,y0+dy*t,sx*1.15,sy*1.15,34,pigmentScale/Math.sqrt(sub));
 }
 interactions++;
 if(!shell.motion){for(let i=0;i<10;i++)field.step(1/60);}
 else field.step(1/60);
 render();
 wake();
}

function play(){
 if(!ready)return;
 releaseDrag();
 const [p0,p1,p2]=DEMO_CURLS[curlIndex%DEMO_CURLS.length];
 curlIndex++;
 field.endStroke();
 let prevX=W*p0[0],prevY=H*p0[1];
 const segs=8;
 for(let j=1;j<=segs;j++){
  const t=j/segs,mt=1-t;
  const x=W*(mt*mt*p0[0]+2*mt*t*p1[0]+t*t*p2[0]);
  const y=H*(mt*mt*p0[1]+2*mt*t*p1[1]+t*t*p2[1]);
  field.stir(x,y,(x-prevX)*0.72,(y-prevY)*0.72,33*(0.85+0.25*Math.sin(t*Math.PI)),0.68);
  field.step(1/60);
  prevX=x;prevY=y;
 }
 field.endStroke();
 interactions++;
 if(!shell.motion){for(let i=0;i<14;i++)field.step(1/60);}
 render();
 wake();
 shell.setStatus(shell.motion?'A fresh curl swept across the ink. Drag or press and hold to make it your own.':'A still impression added. Resume motion to let it flow.');
}

async function init(){
 if(!canvas||!ctx||!pc){failPortrait('Canvas unavailable in this browser.');return;}
 try{
  const image=await loadImage('../../assets/headshot.jpg');
  // Provenance: supplied outdoor portrait. Crop is image-derived, never a geometric silhouette.
  pc.drawImage(image,260,590,1050,1450,0,0,W,H);
  const pixels=pc.getImageData(0,0,W,H).data;
  const source=buildPortraitSource(pixels,W,H);
  grain=buildPaperGrain(W,H,2941);
  const baseline=seedImpression(W,H,source);
  field=new InkField(W,H,baseline.ink,baseline.orange);
  frame=pc.createImageData(W,H);
  size=fitPaper();
  render();
  loop=makeLoop(tick,{enabled:false});
  ready=true;
  shell.markReady({rendering:'canvas2d'});

  new ResizeObserver(()=>{size=fitPaper();render();}).observe(canvas);
  new IntersectionObserver(entries=>{
   visible=entries[0].isIntersecting;
   if(!visible){releaseDrag();loop.stop();}
   else if(hasActivity(field.snapshot()))wake();
  }).observe(canvas);
  shell.onMotionChange(on=>{
   if(!on){releaseDrag();loop.stop();render();}
   else if(hasActivity(field.snapshot()))wake();
  });

  canvas.addEventListener('pointerdown',e=>{
   if(e.button!==0||drag)return;
   if(canvas.setPointerCapture){try{canvas.setPointerCapture(e.pointerId);}catch{}}
   const p=point(e);
   drag={id:e.pointerId,x:p.x,y:p.y,pulses:0,holdTimer:null};
   field.endStroke();
   // Clean suminagashi ink drop on initial touch; holding gently widens the bloom
   stirStep(p.x,p.y,0,0,30,0.72);
   if(shell.motion){
    drag.holdTimer=setInterval(()=>{
     if(!drag||!shell.motion||drag.pulses>=5){clearHold();return;}
     drag.pulses++;
     stirStep(drag.x,drag.y,0,0,30+drag.pulses*3,0.42);
    },110);
   }
  });
  canvas.addEventListener('pointermove',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const p=point(e);
   if(Math.hypot(p.x-drag.x,p.y-drag.y)>=1.2){
    clearHold();
    strokeSegment(drag.x,drag.y,p.x,p.y);
    drag.x=p.x;drag.y=p.y;
   }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture']){
   canvas.addEventListener(name,e=>{if(drag&&(e.pointerId===undefined||e.pointerId===drag.id))releaseDrag();});
  }
  window.addEventListener('blur',releaseDrag);

  document.addEventListener('experiment:play',play);
  document.addEventListener('experiment:reset',()=>{releaseDrag();loop.stop();field.reset();render();});
  document.getElementById('reform-portrait').addEventListener('click',()=>{
   interactions++;
   releaseDrag();
   if(!shell.motion){field.reset();render();}
   else{field.reform();wake();}
   shell.setStatus('Drawing the ink back to the original impression.');
  });
  document.getElementById('keep-impression').addEventListener('click',async e=>{
   const button=e.currentTarget;
   await withDisabledButton(button,async()=>{
    try{
     const keepsake=document.createElement('canvas');keepsake.width=792;keepsake.height=1200;
     const k=keepsake.getContext('2d');
     if(!k)throw new Error('Export canvas unavailable');
     k.fillStyle='#f7f2e8';k.fillRect(0,0,792,1200);
     k.drawImage(print,32,32,728,1006);
     k.fillStyle='#181c1c';k.font='600 27px "Plus Jakarta Sans"';k.fillText('Usman Saleem',34,1091);
     k.font='16px "Plus Jakarta Sans"';k.fillText('An open impression · Mechanical engineer',34,1128);
     k.fillStyle='#ff541e';k.fillRect(34,1160,64,4);
     const blob=await downloadCanvas(keepsake,'usman-wet-ink-impression.png');
     exports++;
     shell.setStatus(`Your impression is ready as a PNG (${Math.round(blob.size/1024)} KB).`);
    }catch(error){
     shell.setStatus('The PNG could not be saved. Please try again.');
     console.error(error);
    }
   });
  });
  if(new URLSearchParams(location.search).has('debug')){
   window.__experiment={id:'wet-ink',snapshot:()=>({...field.snapshot(),motion:shell.motion,ready,interactions,exports,resolution:[W,H],running:loop.running})};
  }
 }catch(error){
  failPortrait('Portrait unavailable. Reload to try again.');
  console.error(error);
 }
}
init();
