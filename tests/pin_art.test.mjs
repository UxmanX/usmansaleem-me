import test from 'node:test';
import assert from 'node:assert/strict';
import { PinField } from '../experiments/pin-art/model.mjs';

test('press depresses only local portrait relief and damped springs recover without nonfinite states',()=>{
 const w=31,h=39, source=Float32Array.from({length:w*h},(_,i)=>0.15+0.7*Math.sin((i%w)/w*Math.PI)*Math.sin(Math.floor(i/w)/h*Math.PI));
 const pins=new PinField(w,h,source);
 pins.press(15,19,5);
 assert.ok(pins.z[19*w+15]<source[19*w+15]-0.2,'press must change local depth, not a UI counter');
 assert.equal(pins.z[0],source[0],'outside the hand stays at portrait relief');
 assert.ok(pins.snapshot().displacement>0.01);
 for(let i=0;i<600;i++) pins.step(1/60);
 assert.ok(pins.snapshot().displacement<0.00001,'springs converge to the source portrait');
 assert.ok(pins.z.every(Number.isFinite));
 pins.press(-100,-100,4); pins.press(NaN,Infinity,0); pins.step(Infinity);
 assert.ok(pins.z.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 pins.press(15,19,5); pins.reset();
 assert.deepEqual(pins.z,source);
 assert.equal(pins.snapshot().energy,0);
});
