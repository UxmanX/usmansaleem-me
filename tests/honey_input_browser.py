"""Honey input lifecycle regressions; execute with browser_exec helpers.
BASE may be overridden by the caller for live verification.
"""
import json
import time
BASE='http://127.0.0.1:8777'

def load_honey():
    goto_url(BASE+'/experiments/honey-plotter/?debug')
    wait_for_load()
    cdp('Page.bringToFront')
    cdp('Emulation.setFocusEmulationEnabled',enabled=True)
    deadline=time.monotonic()+12
    while time.monotonic()<deadline and not js("document.body.dataset.ready==='true'"):
        time.sleep(.1)
    assert js("document.body.dataset.ready==='true'")
    if js("document.body.dataset.motion==='on'"):
        js("document.getElementById('motion-toggle').click()")
    js("document.getElementById('reset-experiment').click()")

def honey_state():
    value=js('window.__experiment.snapshot()')
    value.pop('samples',None)
    return value

def honey_point(x=.18,y=.12):
    return js("""(()=>{const r=document.getElementById('experiment-canvas').getBoundingClientRect();
      return {x:r.x+r.width*%s,y:r.y+r.height*%s}})()""" % (x,y))

def key(kind,key,code,vk):
    cdp('Input.dispatchKeyEvent',type=kind,key=key,code=code,windowsVirtualKeyCode=vk)

def keyboard_release_preserves_pointer():
    load_honey()
    js("document.getElementById('experiment-canvas').focus({preventScroll:true})")
    key('keyDown','ArrowRight','ArrowRight',39)
    p=honey_point(.25,.12)
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='left',buttons=1,clickCount=1,**p)
    before=honey_state()
    key('keyUp','ArrowRight','ArrowRight',39)
    after=honey_state()
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='left',buttons=0,clickCount=1,**p)
    assert before['grabbed'] and after['grabbed'], 'Old keyboard keyup cancelled pointer drag: '+json.dumps({'before':before,'after':after})
    assert not honey_state()['grabbed']
    return {'before':before,'after_keyup':after}

def blur_releases_keyboard():
    load_honey()
    js("document.getElementById('experiment-canvas').focus({preventScroll:true})")
    key('keyDown','ArrowRight','ArrowRight',39)
    held=honey_state()
    key('keyDown','Tab','Tab',9)
    key('keyUp','Tab','Tab',9)
    key('keyUp','ArrowRight','ArrowRight',39)
    after=honey_state()
    assert held['grabbed'] and not after['grabbed'], 'Keyboard grip stuck after focus leaves canvas: '+json.dumps(after)
    return {'held':held,'after_blur':after}

def right_button_does_not_grab():
    load_honey()
    p=honey_point()
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='right',buttons=2,clickCount=1,**p)
    state=honey_state()
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='right',buttons=0,clickCount=1,**p)
    key('keyDown','Escape','Escape',27);key('keyUp','Escape','Escape',27)
    assert not state['grabbed'], 'Secondary mouse button unexpectedly grabs the material'
    return state

def unrelated_pointer_cannot_release():
    load_honey()
    result=js("""(()=>{const c=document.getElementById('experiment-canvas'),r=c.getBoundingClientRect(),x=r.x+r.width*.18,y=r.y+30;
      const e=(type,id)=>c.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,bubbles:true}));
      e('pointerdown',31);const initial=__experiment.snapshot().grabbed;
      e('pointerup',32);const foreign=__experiment.snapshot().grabbed;
      e('pointerup',31);return {initial,foreign,released:!__experiment.snapshot().grabbed};})()""")
    assert result['initial'] and result['foreign'] and result['released'],result
    return result
