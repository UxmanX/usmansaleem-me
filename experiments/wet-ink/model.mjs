const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class InkField {
 constructor(w,h,source,orangeSource=new Float32Array(w*h)){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||source.length!==w*h)throw new RangeError('Image grid does not match');
  this.w=w;this.h=h;this.source=Float32Array.from(source,v=>clamp(Number.isFinite(v)?v:0,0,1));
  if(orangeSource.length!==w*h)throw new RangeError('Orange grid does not match');
  this.orangeSource=Float32Array.from(orangeSource,v=>clamp(Number.isFinite(v)?v:0,0,1));
  this.ink=this.source.slice();this.orange=this.orangeSource.slice();this.u=new Float32Array(w*h);this.v=new Float32Array(w*h);this.a=new Float32Array(w*h);this.b=new Float32Array(w*h);this.recovering=false;
 }
 sample(field,x,y){x=clamp(x,0,this.w-1);y=clamp(y,0,this.h-1);const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,this.w-1),y1=Math.min(y0+1,this.h-1),tx=x-x0,ty=y-y0;return (field[y0*this.w+x0]*(1-tx)+field[y0*this.w+x1]*tx)*(1-ty)+(field[y1*this.w+x0]*(1-tx)+field[y1*this.w+x1]*tx)*ty;}
 stir(x,y,dx=1,dy=0,radius=24){
  if(![x,y,dx,dy,radius].every(Number.isFinite)||radius<=0)return;
  this.recovering=false;radius=clamp(radius,2,Math.max(this.w,this.h));dx=clamp(dx,-18,18);dy=clamp(dy,-18,18);
  for(let yy=Math.max(0,Math.floor(y-radius));yy<Math.min(this.h,y+radius);yy++)for(let xx=Math.max(0,Math.floor(x-radius));xx<Math.min(this.w,x+radius);xx++){
   const rx=(xx-x)/radius,ry=(yy-y)/radius,d=Math.hypot(rx,ry);if(d>=1)continue;const i=yy*this.w+xx,f=(1-d*d)**2,curl=1.4+Math.hypot(dx,dy)*0.20;
   this.u[i]=clamp(this.u[i]+f*(dx*2.1-ry*curl*radius),-100,100);this.v[i]=clamp(this.v[i]+f*(dy*2.1+rx*curl*radius),-100,100);
   this.orange[i]=clamp(this.orange[i]+f*0.52*(0.55+0.45*Math.sin(d*27)),0,1);
  }
 }
 step(dt){
  if(!Number.isFinite(dt)||dt<=0)return;dt=clamp(dt,0,1/30);
  if(this.recovering){const mix=1-Math.exp(-6*dt);for(let i=0;i<this.ink.length;i++){this.ink[i]+=(this.source[i]-this.ink[i])*mix;this.orange[i]+=(this.orangeSource[i]-this.orange[i])*mix;if(Math.abs(this.ink[i]-this.source[i])<1e-7)this.ink[i]=this.source[i];}return;}
  const damp=Math.exp(-2.3*dt);
  for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++){const i=y*this.w+x,bx=x-this.u[i]*dt,by=y-this.v[i]*dt;this.a[i]=this.sample(this.ink,bx,by);this.b[i]=this.sample(this.orange,bx,by);this.u[i]*=damp;this.v[i]*=damp;if(Math.abs(this.u[i])+Math.abs(this.v[i])<0.002){this.u[i]=0;this.v[i]=0;}}
  [this.ink,this.a]=[this.a,this.ink];[this.orange,this.b]=[this.b,this.orange];
 }
 reform(){this.recovering=true;this.u.fill(0);this.v.fill(0);}
 reset(){this.ink.set(this.source);this.orange.set(this.orangeSource);this.u.fill(0);this.v.fill(0);this.recovering=false;}
 snapshot(){let displacement=0,energy=0,orange=0,orangeDisplacement=0;for(let i=0;i<this.ink.length;i++){displacement+=Math.abs(this.ink[i]-this.source[i]);energy+=this.u[i]**2+this.v[i]**2;orange+=this.orange[i];orangeDisplacement+=Math.abs(this.orange[i]-this.orangeSource[i]);}return {displacement:displacement/this.ink.length,energy:energy/this.ink.length,orange:orange/this.ink.length,orangeDisplacement:orangeDisplacement/this.ink.length,recovering:this.recovering};}
}
