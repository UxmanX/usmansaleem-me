import test from 'node:test';
import assert from 'node:assert/strict';
import { InkField } from '../experiments/wet-ink/model.mjs';
import { withDisabledButton } from '../experiments/wet-ink/actions.mjs';

test('save button is restored after asynchronous export, including rejection',async()=>{
 const button={disabled:false};let resolve;
 const saved=withDisabledButton(button,()=>new Promise(r=>{resolve=r;}));
 assert.equal(button.disabled,true);
 resolve('png');assert.equal(await saved,'png');assert.equal(button.disabled,false);
 await assert.rejects(withDisabledButton(button,async()=>{throw new Error('export failed');}),/export failed/);
 assert.equal(button.disabled,false);
});

test('curl transport smears real scalar image texture locally, stays finite, and authored recovery returns it', () => {
  const w=48,h=64, source=Float32Array.from({length:w*h},(_,i)=>((i%w)>18 && (i%w)<30 && Math.floor(i/w)>18 && Math.floor(i/w)<48)?0.92:0.07);
  const ink=new InkField(w,h,source);
  ink.stir(24,32,6,-3,14);
  assert.ok(ink.orange[32*w+24]>.25,'fresh pigment must read as orange, not a faint tint');
  for(let i=0;i<30;i++) ink.step(1/60);
  const s=ink.snapshot();
  assert.ok(s.displacement>0.003,`texture must actually advect, got ${s.displacement}`);
  assert.ok(s.energy>0,'local vortex carries kinetic energy');
  assert.ok(s.orange>0,'gesture deposits a second pigment');
  assert.ok(ink.ink.every(Number.isFinite));
  assert.ok(ink.ink.every(v=>v>=0 && v<=1));
  assert.ok(Math.abs(ink.ink[0]-source[0])<0.001,'distant paper is not a rigid portrait tile');
  ink.reform();
  for(let i=0;i<300;i++) ink.step(1/60);
  assert.ok(ink.snapshot().displacement<0.00001,'reform recovers the supplied source');
  assert.equal(ink.snapshot().energy,0);
  ink.reset();
  assert.deepEqual(ink.ink,source);
  ink.stir(NaN,Infinity,1,1); ink.step(Infinity);
  assert.ok(ink.ink.every(Number.isFinite),'bad pointer/time inputs cannot poison texture');
});
