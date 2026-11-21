import test from 'node:test';
import assert from 'node:assert/strict';
import { InkField } from '../experiments/wet-ink/model.mjs';

const w=80,h=110;
const portrait=Float32Array.from({length:w*h},(_,i)=>{
 const x=i%w,y=Math.floor(i/w);
 return x>24&&x<56&&y>20&&y<66 ? .3+.6*((x+y)%7)/6 : .08+.8*(y>72);
});

test('authored resting impression seeds visible orange curls without losing facial texture',async()=>{
 const module=await import('../experiments/wet-ink/composition.mjs').catch(()=>({}));
 assert.equal(typeof module.seedImpression,'function','A deterministic authored ink baseline is missing');
 const original=portrait.slice();
 const a=module.seedImpression(w,h,portrait),b=module.seedImpression(w,h,portrait);
 assert.deepEqual(a,b,'reload must reproduce the same impression');
 assert.ok(a.orange.reduce((sum,v)=>sum+v,0)/a.orange.length>.035,'orange must occupy a meaningful part of the print');
 assert.ok(a.orange[Math.floor(h*.43)*w+Math.floor(w*.05)]>.1,'the temple pull is a continuous flowing stroke, not an isolated circular stamp');
 assert.ok(a.ink.some((v,i)=>Math.abs(v-portrait[i])>.05),'initial curl must actually transport image ink');
 for(let y=25;y<62;y++)for(let x=29;x<51;x++)assert.ok(Math.abs(a.ink[y*w+x]-portrait[y*w+x])<.01,'eyes, nose and mouth remain recognisable');
 assert.ok(a.ink.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 assert.ok(a.orange.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 assert.deepEqual(portrait,original,'source data stays intact');
});

test('reset and animated reform restore the seeded ink and orange baseline',async()=>{
 const {seedImpression}=await import('../experiments/wet-ink/composition.mjs');
 const baseline=seedImpression(w,h,portrait);
 const field=new InkField(w,h,baseline.ink,baseline.orange);
 assert.deepEqual(field.orange,baseline.orange,'constructor must retain authored orange');
 field.stir(40,55,9,-4,22);
 for(let i=0;i<20;i++)field.step(1/60);
 field.reform();for(let i=0;i<240;i++)field.step(1/60);
 assert.ok(field.snapshot().displacement<.00001);
 assert.ok(field.orange.every((v,i)=>Math.abs(v-baseline.orange[i])<.00001));
 field.reset();assert.deepEqual(field.ink,baseline.ink);assert.deepEqual(field.orange,baseline.orange);
 assert.equal(field.snapshot().energy,0);
 assert.equal(field.snapshot().orangeDisplacement,0);
});

test('full-bleed cover and inverse paper rotation keep pointer on the rendered ink',async()=>{
 const module=await import('../experiments/wet-ink/geometry.mjs').catch(()=>({}));
 assert.equal(typeof module.coverBox,'function','page-owned cover geometry is missing');
 const b=module.coverBox(500,610,264,365);
 assert.ok(b.w>=500&&b.h>=610);assert.ok(Math.abs(b.x*2+b.w-500)<1e-9);
 const angle=-2*Math.PI/180,w=440,h=610,rect={x:100,y:100,width:500,height:640};
 const local={x:90,y:400},dx=local.x-w/2,dy=local.y-h/2;
 const point=module.paperPoint(rect.x+rect.width/2+dx*Math.cos(angle)-dy*Math.sin(angle),rect.y+rect.height/2+dx*Math.sin(angle)+dy*Math.cos(angle),rect,w,h,angle);
 assert.ok(Math.abs(point.x-local.x)<1e-9&&Math.abs(point.y-local.y)<1e-9);
});
