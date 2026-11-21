/** Full-bleed centred crop in the untransformed CSS canvas dimensions. */
export function coverBox(width,height,w,h){
 const scale=Math.max(width/w,height/h);
 return {x:(width-w*scale)/2,y:(height-h*scale)/2,w:w*scale,h:h*scale};
}
/** Undo the paper's centre-origin rotation, not its axis-aligned bounding box. */
export function paperPoint(clientX,clientY,rect,width,height,angle){
 const dx=clientX-(rect.x+rect.width/2),dy=clientY-(rect.y+rect.height/2),c=Math.cos(angle),s=Math.sin(angle);
 return {x:width/2+dx*c+dy*s,y:height/2-dx*s+dy*c};
}
