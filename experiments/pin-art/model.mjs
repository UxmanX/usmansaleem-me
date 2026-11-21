const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class PinField {
 constructor(w,h,source){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||source.length!==w*h)throw new RangeError('Portrait grid does not match');
  this.w=w;this.h=h;this.source=Float32Array.from(source,v=>clamp(Number.isFinite(v)?v:0,0,1));this.z=this.source.slice();this.v=new Float32Array(w*h);
 }
 press(x,y,radius=12){
  if(![x,y,radius].every(Number.isFinite)||radius<=0)return;
  radius=clamp(radius,1,Math.max(this.w,this.h));
  for(let yy=Math.max(0,Math.floor(y-radius));yy<Math.min(this.h,y+radius);yy++)for(let xx=Math.max(0,Math.floor(x-radius));xx<Math.min(this.w,x+radius);xx++){
   const d=Math.hypot(xx-x,yy-y)/radius;if(d>=1)continue;const i=yy*this.w+xx,f=1-d*d;this.z[i]=Math.min(this.z[i],this.source[i]*(1-f)+0.025*f);this.v[i]=0;
  }
 }
 step(dt){
  if(!Number.isFinite(dt)||dt<=0)return;dt=clamp(dt,0,1/30);
  for(let i=0;i<this.z.length;i++){this.v[i]+=(68*(this.source[i]-this.z[i])-13*this.v[i])*dt;this.z[i]=clamp(this.z[i]+this.v[i]*dt,0,1);if(Math.abs(this.z[i]-this.source[i])<1e-7&&Math.abs(this.v[i])<1e-6){this.z[i]=this.source[i];this.v[i]=0;}}
 }
 reset(){this.z.set(this.source);this.v.fill(0);}
 snapshot(){let displacement=0,energy=0,maxDepression=0;for(let i=0;i<this.z.length;i++){const d=Math.abs(this.z[i]-this.source[i]);displacement+=d;energy+=this.v[i]**2+68*d*d;maxDepression=Math.max(maxDepression,this.source[i]-this.z[i]);}return {displacement:displacement/this.z.length,energy:energy/this.z.length,maxDepression,pins:this.z.length};}
}
