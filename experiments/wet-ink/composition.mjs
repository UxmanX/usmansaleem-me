import { InkField } from './model.mjs?v=material-2';

/** Three fixed wet marbling pulls through the source photograph: temple, lapel, hem.
 * Drawn as continuous Bezier stylus strokes with clamped MacCormack advection so the
 * resting authored impression reads as crisp marbled ribbons framing an intact portrait.
 * Reset and reform restore both the returned ink and orange baselines.
 */
export function seedImpression(w,h,source){
 const field=new InkField(w,h,source);
 // Quadratic Bezier marbling strokes: [start, control, end, radiusScale, pigmentScale]
 const strokes=[
  [[0.02,0.08],[0.15,0.27],[0.03,0.47],0.135,0.82],
  [[0.99,0.50],[0.79,0.75],[0.97,1.02],0.155,0.88],
  [[-0.02,0.98],[0.29,0.82],[0.54,1.03],0.155,0.86],
 ];
 const steps=10;
 for(const [p0,p1,p2,rScale,pScale] of strokes){
  field.endStroke();
  let prevX=w*p0[0],prevY=h*p0[1];
  for(let j=1;j<=steps;j++){
   const t=j/steps,mt=1-t;
   const x=w*(mt*mt*p0[0]+2*mt*t*p1[0]+t*t*p2[0]);
   const y=h*(mt*mt*p0[1]+2*mt*t*p1[1]+t*t*p2[1]);
   const dx=(x-prevX)*(1.35*80/w),dy=(y-prevY)*(1.35*80/w);
   const radius=w*(rScale*(0.82+0.30*Math.sin(t*Math.PI)));
   field.stir(x,y,dx,dy,radius,pScale);
   if(j===5||j===10)field.step(1/60);
   prevX=x;prevY=y;
  }
  const midX=w*(0.25*p0[0]+0.5*p1[0]+0.25*p2[0]),midY=h*(0.25*p0[1]+0.5*p1[1]+0.25*p2[1]);
  field.stir(midX,midY,(p2[0]-p0[0])*11,(p2[1]-p0[1])*11,w*rScale*0.9,0);
 }
 // Let the freshly marbled dipole wakes fold crisply without diffusing
 for(let i=0;i<18;i++)field.step(1/60);
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 for(let y=0;y<h;y++){
  const yn=y/h,dy=(yn-0.41)/0.23,dy4=dy*dy*dy*dy,row=y*w;
  for(let x=0;x<w;x++){
   const i=row+x,dx=(x/w-0.52)/0.24,dx2=dx*dx;
   // Organic rounded face protection: 1.0 across eyes, nose and mouth without hard box seams
   const r=Math.sqrt(Math.sqrt(dx2*dx2+dy4));
   const face=smooth((1.24-r)/0.34);
   if(face>0){
    field.ink[i]+=(source[i]-field.ink[i])*face;
    field.orange[i]*=1-face;
   }
  }
 }
 return {ink:field.ink.slice(),orange:field.orange.slice()};
}
