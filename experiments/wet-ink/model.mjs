const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class InkField {
 constructor(w,h,source,orangeSource=new Float32Array(w*h)){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||source.length!==w*h)throw new RangeError('Image grid does not match');
  this.w=w;this.h=h;const n=w*h;
  this.source=Float32Array.from(source,v=>clamp(Number.isFinite(v)?v:0,0,1));
  if(orangeSource.length!==n)throw new RangeError('Orange grid does not match');
  this.orangeSource=Float32Array.from(orangeSource,v=>clamp(Number.isFinite(v)?v:0,0,1));
  this.ink=this.source.slice();this.orange=this.orangeSource.slice();
  this.u=new Float32Array(n);this.v=new Float32Array(n);
  this.a=new Float32Array(n);this.b=new Float32Array(n);
  this.hatInk=new Float32Array(n);this.hatOrange=new Float32Array(n);
  this.uNext=new Float32Array(n);this.vNext=new Float32Array(n);
  this.fx=new Float32Array(n);this.fy=new Float32Array(n);
  this.fxNext=new Float32Array(n);this.fyNext=new Float32Array(n);
  this.wet=new Float32Array(n);this.wetNext=new Float32Array(n);
  this.recovering=false;this.recoveryTime=0;this.lastAngle=null;
 }
 sample(field,x,y){
  const w=this.w,h=this.h;
  if(x<0)x=0;else if(x>w-1)x=w-1;
  if(y<0)y=0;else if(y>h-1)y=h-1;
  const x0=x|0,y0=y|0,x1=x0+1<w?x0+1:w-1,y1=y0+1<h?y0+1:h-1,tx=x-x0,ty=y-y0;
  const r0=y0*w,r1=y1*w;
  return (field[r0+x0]*(1-tx)+field[r0+x1]*tx)*(1-ty)+(field[r1+x0]*(1-tx)+field[r1+x1]*tx)*ty;
 }
 /**
  * Wet-ink stylus wake and suminagashi ink-drop bloom.
  * Moving drags inject a divergence-free dipole streamfunction
  * psi(s,n) = A*n*(1-d^2)^3 aligned with the stroke vector so floating ink
  * parts smoothly and curls into counter-rotating marbling eddies.
  * Near-stationary touches (|d| < 0.45) bloom radially without bullseye rings.
  */
 stir(x,y,dx=1,dy=0,radius=24,pigmentScale=1){
  if(![x,y,dx,dy,radius,pigmentScale].every(Number.isFinite)||radius<=0)return;
  this.recovering=false;this.recoveryTime=0;
  const w=this.w,h=this.h;
  radius=clamp(radius,2,Math.max(w,h));
  dx=clamp(dx,-22,22);dy=clamp(dy,-22,22);
  pigmentScale=clamp(pigmentScale,0,2);
  const speed=Math.hypot(dx,dy),isDrop=speed<0.45;
  let tx=1,ty=0,nx=0,ny=1,swirlBias=0;
  if(!isDrop){
   tx=dx/speed;ty=dy/speed;nx=-ty;ny=tx;
   const angle=Math.atan2(ty,tx);
   if(this.lastAngle!==null){
    let delta=angle-this.lastAngle;
    while(delta>Math.PI)delta-=Math.PI*2;
    while(delta<-Math.PI)delta+=Math.PI*2;
    swirlBias=clamp(delta*0.42,-0.5,0.5);
   }
   this.lastAngle=angle;
  }else{
   this.lastAngle=null;
  }
  const effRadius=isDrop?radius*0.76:radius*clamp(1.06-speed*0.014,0.72,1.06);
  const invR=1/effRadius;
  const minY=Math.max(0,Math.floor(y-effRadius)),maxY=Math.min(h,Math.ceil(y+effRadius));
  const minX=Math.max(0,Math.floor(x-effRadius)),maxX=Math.min(w,Math.ceil(x+effRadius));
  const amp=isDrop?effRadius*1.25:(12+speed*4.5)*clamp(effRadius/18,0.65,1.45);
  const swirlAmp=swirlBias*amp*0.5;
  for(let yy=minY;yy<maxY;yy++){
   const ry=(yy-y)*invR,row=yy*w;
   for(let xx=minX;xx<maxX;xx++){
    const rx=(xx-x)*invR,d2=rx*rx+ry*ry;
    if(d2>=1)continue;
    const i=row+xx,oneMinus=1-d2,f=oneMinus*oneMinus;
    if(isDrop){
     const radial=amp*f;
     this.u[i]=clamp(this.u[i]+rx*radial,-120,120);
     this.v[i]=clamp(this.v[i]+ry*radial,-120,120);
     if(pigmentScale>0){
      const drop=Math.exp(-d2*3.8)*0.56*pigmentScale;
      if(drop>0.002){
       this.orange[i]=clamp(this.orange[i]+drop*(1-this.orange[i]*0.42),0,1);
       this.ink[i]*=1-drop*0.26;
      }
     }
    }else{
     const s=rx*tx+ry*ty,n=rx*nx+ry*ny;
     const vs=amp*f*(1-s*s-7*n*n);
     const vn=amp*f*(6*s*n);
     const ux=vs*tx+vn*nx-ry*swirlAmp*f;
     const uy=vs*ty+vn*ny+rx*swirlAmp*f;
     this.u[i]=clamp(this.u[i]+ux,-120,120);
     this.v[i]=clamp(this.v[i]+uy,-120,120);
     if(pigmentScale>0){
      const ribbon=Math.exp(-(s*s*2.1+n*n*6.2));
      const veins=0.80+0.20*Math.cos(n*10.5);
      const dep=ribbon*veins*(0.42+Math.min(0.14,speed*0.011))*pigmentScale;
      if(dep>0.002){
       this.orange[i]=clamp(this.orange[i]+dep*(1-this.orange[i]*0.38),0,1);
       this.ink[i]*=1-dep*0.22;
      }
     }
    }
    const wLift=f*0.92;
    if(wLift>this.wet[i])this.wet[i]=wLift;
   }
  }
 }
 endStroke(){this.lastAngle=null;}
 step(dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  dt=clamp(dt,0,1/30);
  const w=this.w,h=this.h,wMax=w-1,hMax=h-1;
  if(this.recovering){
   this.recoveryTime+=dt;
   const pullFade=clamp(1-this.recoveryTime/0.85,0,1);
   const pullStep=Math.min(0.30,3.4*dt)*pullFade,flowDecay=Math.exp(-3.2*dt);
   const invW=1/w,invH=1/h;
   const ink=this.ink,orange=this.orange,src=this.source,oSrc=this.orangeSource;
   const a=this.a,b=this.b,fx=this.fx,fy=this.fy,wet=this.wet;
   for(let y=0;y<h;y++){
    const row=y*w,yn=y*invH-0.42;
    for(let x=0;x<w;x++){
     const i=row+x,dfx=fx[i],dfy=fy[i],di=ink[i]-src[i],dor=orange[i]-oSrc[i];
     if(dfx===0&&dfy===0&&di===0&&dor===0&&wet[i]===0){a[i]=src[i];b[i]=oSrc[i];continue;}
     let curInk=ink[i],curOrange=orange[i];
     if(pullStep>0&&(dfx!==0||dfy!==0)){
      let sx=x+dfx*pullStep,sy=y+dfy*pullStep;
      if(sx<0)sx=0;else if(sx>wMax)sx=wMax;
      if(sy<0)sy=0;else if(sy>hMax)sy=hMax;
      const x0=sx|0,y0=sy|0,x1=x0<wMax?x0+1:wMax,y1=y0<hMax?y0+1:hMax;
      const tx=sx-x0,ty=sy-y0,itx=1-tx,ity=1-ty;
      const w00=itx*ity,w10=tx*ity,w01=itx*ty,w11=tx*ty;
      const i00=y0*w+x0,i10=y0*w+x1,i01=y1*w+x0,i11=y1*w+x1;
      curInk=ink[i00]*w00+ink[i10]*w10+ink[i01]*w01+ink[i11]*w11;
      curOrange=orange[i00]*w00+orange[i10]*w10+orange[i01]*w01+orange[i11]*w11;
      const nfx=dfx*flowDecay,nfy=dfy*flowDecay;
      fx[i]=Math.abs(nfx)<1e-3?0:nfx;
      fy[i]=Math.abs(nfy)<1e-3?0:nfy;
     }else if(dfx!==0||dfy!==0){
      fx[i]=0;fy[i]=0;
     }
     const xn=(x*invW-0.5)*1.1,dist=Math.hypot(xn,yn);
     const wave=clamp((this.recoveryTime-dist*0.34)/0.44,0,1);
     const rate=1.4+6.8*wave*wave,mix=1-Math.exp(-rate*dt);
     let ni=curInk+(src[i]-curInk)*mix,no=curOrange+(oSrc[i]-curOrange)*mix;
     if(Math.abs(ni-src[i])<1e-6)ni=src[i];
     if(Math.abs(no-oSrc[i])<1e-6)no=oSrc[i];
     a[i]=clamp(ni,0,1);b[i]=clamp(no,0,1);
     const rem=Math.abs(a[i]-src[i])+Math.abs(b[i]-oSrc[i]);
     wet[i]=rem<1e-5?0:Math.min(0.85,rem*3.4);
    }
   }
   [this.ink,this.a]=[this.a,this.ink];[this.orange,this.b]=[this.b,this.orange];
   return;
  }
  const u=this.u,v=this.v,ink=this.ink,orange=this.orange;
  const hatInk=this.hatInk,hatOrange=this.hatOrange,a=this.a,b=this.b;
  const uNext=this.uNext,vNext=this.vNext,fx=this.fx,fy=this.fy,fxNext=this.fxNext,fyNext=this.fyNext;
  const wet=this.wet,wetNext=this.wetNext;
  const damp=Math.exp(-1.95*dt),wetDecay=Math.exp(-1.65*dt);
  let activeMinY=h,activeMaxY=-1;
  for(let y=0;y<h;y++){
   const row=y*w;let rowActive=false;
   for(let x=0;x<w;x++){
    const i=row+x,ux=u[i],vy=v[i];
    if(ux===0&&vy===0){
     hatInk[i]=ink[i];hatOrange[i]=orange[i];
     uNext[i]=0;vNext[i]=0;fxNext[i]=fx[i];fyNext[i]=fy[i];
     const wn=wet[i]*wetDecay;wetNext[i]=wn<0.004?0:wn;
     continue;
    }
    rowActive=true;
    let bx=x-ux*dt,by=y-vy*dt;
    if(bx<0)bx=0;else if(bx>wMax)bx=wMax;
    if(by<0)by=0;else if(by>hMax)by=hMax;
    const x0=bx|0,y0=by|0,x1=x0<wMax?x0+1:wMax,y1=y0<hMax?y0+1:hMax;
    const tx=bx-x0,ty=by-y0,itx=1-tx,ity=1-ty;
    const w00=itx*ity,w10=tx*ity,w01=itx*ty,w11=tx*ty;
    const i00=y0*w+x0,i10=y0*w+x1,i01=y1*w+x0,i11=y1*w+x1;
    hatInk[i]=ink[i00]*w00+ink[i10]*w10+ink[i01]*w01+ink[i11]*w11;
    hatOrange[i]=orange[i00]*w00+orange[i10]*w10+orange[i01]*w01+orange[i11]*w11;
    let vx=x-ux*dt*0.65,vy2=y-vy*dt*0.65;
    if(vx<0)vx=0;else if(vx>wMax)vx=wMax;
    if(vy2<0)vy2=0;else if(vy2>hMax)vy2=hMax;
    const vx0=vx|0,vy0=vy2|0,vx1=vx0<wMax?vx0+1:wMax,vy1=vy0<hMax?vy0+1:hMax;
    const vtx=vx-vx0,vty=vy2-vy0,vitx=1-vtx,vity=1-vty;
    const vw00=vitx*vity,vw10=vtx*vity,vw01=vitx*vty,vw11=vtx*vty;
    const vi00=vy0*w+vx0,vi10=vy0*w+vx1,vi01=vy1*w+vx0,vi11=vy1*w+vx1;
    let nu=(u[vi00]*vw00+u[vi10]*vw10+u[vi01]*vw01+u[vi11]*vw11)*damp;
    let nv=(v[vi00]*vw00+v[vi10]*vw10+v[vi01]*vw01+v[vi11]*vw11)*damp;
    if(Math.abs(nu)+Math.abs(nv)<0.0025){nu=0;nv=0;}
    uNext[i]=nu;vNext[i]=nv;
    const nfx=fx[i00]*w00+fx[i10]*w10+fx[i01]*w01+fx[i11]*w11+ux*dt;
    const nfy=fy[i00]*w00+fy[i10]*w10+fy[i01]*w01+fy[i11]*w11+vy*dt;
    fxNext[i]=clamp(nfx,-44,44);fyNext[i]=clamp(nfy,-44,44);
    const advWet=(wet[i00]*w00+wet[i10]*w10+wet[i01]*w01+wet[i11]*w11)*wetDecay;
    const flowWet=Math.min(0.88,Math.hypot(ux,vy)*0.03);
    const wVal=advWet>flowWet?advWet:flowWet;
    wetNext[i]=wVal<0.004?0:wVal;
   }
   if(rowActive){if(y<activeMinY)activeMinY=y;activeMaxY=y;}
  }
  a.set(ink);b.set(orange);
  for(let y=activeMinY;y<=activeMaxY;y++){
   const row=y*w;
   for(let x=0;x<w;x++){
    const i=row+x,ux=u[i],vy=v[i];
    if(ux===0&&vy===0)continue;
    let px=x+ux*dt,py=y+vy*dt;
    if(px<0)px=0;else if(px>wMax)px=wMax;
    if(py<0)py=0;else if(py>hMax)py=hMax;
    const rx0=px|0,ry0=py|0,rx1=rx0<wMax?rx0+1:wMax,ry1=ry0<hMax?ry0+1:hMax;
    const rtx=px-rx0,rty=py-ry0,ritx=1-rtx,rity=1-rty;
    const rw00=ritx*rity,rw10=rtx*rity,rw01=ritx*rty,rw11=rtx*rty;
    const ri00=ry0*w+rx0,ri10=ry0*w+rx1,ri01=ry1*w+rx0,ri11=ry1*w+rx1;
    const revInk=hatInk[ri00]*rw00+hatInk[ri10]*rw10+hatInk[ri01]*rw01+hatInk[ri11]*rw11;
    const revOr=hatOrange[ri00]*rw00+hatOrange[ri10]*rw10+hatOrange[ri01]*rw01+hatOrange[ri11]*rw11;
    const valInk=hatInk[i]+0.5*(ink[i]-revInk);
    const valOr=hatOrange[i]+0.5*(orange[i]-revOr);
    let bx=x-ux*dt,by=y-vy*dt;
    if(bx<0)bx=0;else if(bx>wMax)bx=wMax;
    if(by<0)by=0;else if(by>hMax)by=hMax;
    const bx0=bx|0,by0=by|0,bx1=bx0<wMax?bx0+1:wMax,by1=by0<hMax?by0+1:hMax;
    const bi00=by0*w+bx0,bi10=by0*w+bx1,bi01=by1*w+bx0,bi11=by1*w+bx1;
    const k0=ink[bi00],k1=ink[bi10],k2=ink[bi01],k3=ink[bi11];
    let kLo=k0<k1?k0:k1;if(k2<kLo)kLo=k2;if(k3<kLo)kLo=k3;
    let kHi=k0>k1?k0:k1;if(k2>kHi)kHi=k2;if(k3>kHi)kHi=k3;
    a[i]=valInk<kLo?kLo:valInk>kHi?kHi:valInk;
    const o0=orange[bi00],o1=orange[bi10],o2=orange[bi01],o3=orange[bi11];
    let oLo=o0<o1?o0:o1;if(o2<oLo)oLo=o2;if(o3<oLo)oLo=o3;
    let oHi=o0>o1?o0:o1;if(o2>oHi)oHi=o2;if(o3>oHi)oHi=o3;
    b[i]=valOr<oLo?oLo:valOr>oHi?oHi:valOr;
   }
  }
  [this.ink,this.a]=[this.a,this.ink];[this.orange,this.b]=[this.b,this.orange];
  [this.u,this.uNext]=[this.uNext,this.u];[this.v,this.vNext]=[this.vNext,this.v];
  [this.fx,this.fxNext]=[this.fxNext,this.fx];[this.fy,this.fyNext]=[this.fyNext,this.fy];
  [this.wet,this.wetNext]=[this.wetNext,this.wet];
 }
 reform(){this.recovering=true;this.recoveryTime=0;this.u.fill(0);this.v.fill(0);this.lastAngle=null;}
 reset(){this.ink.set(this.source);this.orange.set(this.orangeSource);this.u.fill(0);this.v.fill(0);this.fx.fill(0);this.fy.fill(0);this.wet.fill(0);this.recovering=false;this.recoveryTime=0;this.lastAngle=null;}
 snapshot(){
  let displacement=0,energy=0,orange=0,orangeDisplacement=0,wetness=0;
  const len=this.ink.length;
  for(let i=0;i<len;i++){
   displacement+=Math.abs(this.ink[i]-this.source[i]);
   energy+=this.u[i]*this.u[i]+this.v[i]*this.v[i];
   orange+=this.orange[i];
   orangeDisplacement+=Math.abs(this.orange[i]-this.orangeSource[i]);
   wetness+=this.wet[i];
  }
  return {displacement:displacement/len,energy:energy/len,orange:orange/len,orangeDisplacement:orangeDisplacement/len,wetness:wetness/len,recovering:this.recovering};
 }
}
