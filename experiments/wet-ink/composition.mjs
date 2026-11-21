import { InkField } from './model.mjs';

/** Three fixed wet pulls through the source photograph: temple, lapel, hem.
 * They are a resting authored impression, not an autoplay gesture. Preserve the
 * central facial detail; reset/reform use the returned ink AND orange baseline.
 */
export function seedImpression(w,h,source){
 const field=new InkField(w,h,source);
 // Continuous pigment pulls follow the face's outer contour and the jacket.
 // Deposit ribbons, then advect both pigments together; never overlay rings.
 const paths=[[[.02,.08],[.12,.27],[.04,.46]],[[.98,.51],[.82,.76],[.97,1.02]],[[-.02,.98],[.3,.83],[.53,1.03]]];
 const pigment=new Float32Array(w*h);
 for(const path of paths)for(let segment=0;segment<2;segment++){
  const a=path[segment],b=path[segment+1];
  for(let j=0;j<10;j++){
   const t=j/9,x=w*(a[0]+(b[0]-a[0])*t),y=h*(a[1]+(b[1]-a[1])*t),radius=w*(.085+.025*Math.sin(t*Math.PI));
   field.stir(x,y,(b[0]-a[0])*24,(b[1]-a[1])*24,radius*2);
   for(let yy=Math.max(0,Math.floor(y-radius*2));yy<Math.min(h,y+radius*2);yy++)for(let xx=Math.max(0,Math.floor(x-radius*2));xx<Math.min(w,x+radius*2);xx++){
    const i=yy*w+xx,d=((xx-x)**2+(yy-y)**2)/(radius*radius);
    pigment[i]=Math.max(pigment[i],.62*Math.exp(-d*1.8));
   }
  }
 }
 field.orange.set(pigment);
 for(let i=0;i<48;i++)field.step(1/60);
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,face=smooth((x/w-.24)/.1)*smooth((.76-x/w)/.1)*smooth((y/h-.16)/.07)*smooth((.65-y/h)/.07);
  field.ink[i]+=(source[i]-field.ink[i])*face;
  field.orange[i]*=1-face;
 }
 return {ink:field.ink.slice(),orange:field.orange.slice()};
}
