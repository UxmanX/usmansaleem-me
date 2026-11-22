"""Focused Liquid gestures. Run with browser_exec helpers; BASE is a full route."""
import base64
import hashlib
import json
import os
import shutil
import time

BASE = 'http://127.0.0.1:8777/experiments/liquid-identity/'

def state():
    return js('window.__experiment.snapshot()')

def stage_hash():
    image = js("document.getElementById('experiment-canvas').toDataURL('image/png')")
    return hashlib.sha256(base64.b64decode(image.split(',', 1)[1])).hexdigest()

def mouse(kind, p, buttons=1):
    cdp('Input.dispatchMouseEvent', type=kind, x=p['x'], y=p['y'], button='left', buttons=buttons, clickCount=1)

def point(letter, fy):
    return js("""(()=>{const s=window.__experiment.snapshot(),b=s.model.letterBoxes[%s];
      const r=document.getElementById('experiment-canvas').getBoundingClientRect();
      return {x:r.left+s.view.ox+(b.x+b.w*.5)*s.view.scale,
      y:r.top+s.view.oy+(b.y+b.h*%s)*s.view.scale,scale:s.view.scale}})()""" % (json.dumps(letter), fy))

def setup(reduced=False):
    cdp('Network.enable')
    cdp('Network.setCacheDisabled', cacheDisabled=True)
    cdp('Emulation.setFocusEmulationEnabled', enabled=True)
    cdp('Emulation.setDeviceMetricsOverride', width=1280, height=1000, deviceScaleFactor=1, mobile=False)
    cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'reduce' if reduced else 'no-preference'}])
    goto_url(BASE + '?debug')
    wait_for_load()
    cdp('Page.bringToFront')
    for _ in range(60):
        if js("document.body.dataset.ready === 'true'"):
            break
        time.sleep(.1)
    assert js("document.body.dataset.ready === 'true'"), 'route must initialize'
    if state()['motion']:
        js("document.getElementById('motion-toggle').click()")
    js("document.getElementById('reset-experiment').click()")
    js("document.getElementById('experiment-canvas').focus({preventScroll:true})")
    time.sleep(.25)

def paused_pinch_release(out_dir, reduced=False):
    setup(reduced)
    start = point('U', .93)
    mouse('mousePressed', start)
    for i in range(1, 11):
        end = {'x':start['x'], 'y':start['y'] + .05*i*start['scale']}
        mouse('mouseMoved', end)
    before = state()
    assert before['model']['snapped'], 'real CDP pull must pinch off'
    before_hash = stage_hash()
    mouse('mouseReleased', end, buttons=0)
    after = state()
    released_hash = stage_hash()
    time.sleep(.7)
    idle = state()
    idle_hash = stage_hash()
    os.makedirs(out_dir, exist_ok=True)
    shot = os.path.join(out_dir, 'pinch-release-%s.png' % ('reduced' if reduced else 'paused'))
    shutil.copyfile(str(capture_screenshot()).strip(), shot)
    result = {'reduced':reduced, 'before':before, 'after':after, 'idle':idle,
              'hashBefore':before_hash, 'hashReleased':released_hash, 'hashIdle':idle_hash, 'shot':shot}
    result['ok'] = (after['model']['finite'] and after['model']['captured']==0
                    and after['model']['maxDisplacement'] != before['model']['maxDisplacement']
                    and released_hash != before_hash and released_hash == idle_hash
                    and after['frames'] == idle['frames'] and not idle['motion'])
    return result

def keyboard_to_pointer_takeover(out_dir):
    setup()
    key = dict(key='ArrowDown', code='ArrowDown', windowsVirtualKeyCode=40, nativeVirtualKeyCode=40)
    for _ in range(4):
        cdp('Input.dispatchKeyEvent', type='rawKeyDown', **key)
    keyboard = state()
    p = point('S', .5)
    expected = js("""(async()=>{const {createLiquidModel}=await import('./liquid-model.js');
      const m=createLiquidModel({seed:17});m.settle();const b=m.letterBoxes.S;
      m.pointerDown(b.x+b.w*.5,b.y+b.h*.5);return m.metrics().captured})()""")
    mouse('mousePressed', p)
    pointer = state()
    cdp('Input.dispatchKeyEvent', type='keyUp', **key)
    after_keyup = state()
    end = {'x':p['x']+.08*p['scale'],'y':p['y']}
    mouse('mouseMoved', end)
    moved = state()
    mouse('mouseReleased', end, buttons=0)
    released = state()
    result = {'keyboardCaptured':keyboard['model']['captured'], 'expectedLocalS':expected,
              'pointerCaptured':pointer['model']['captured'],
              'capturedAfterKeyup':after_keyup['model']['captured'],
              'moved':moved, 'released':released}
    result['ok'] = (result['keyboardCaptured']>0 and result['pointerCaptured']==expected
                    and result['capturedAfterKeyup']==expected and moved['model']['captured']>0
                    and not moved['model']['snapped'] and released['model']['captured']==0
                    and released['model']['finite'] and not released['motion'])
    return result

def run_all(out_dir, tag):
    results = {}
    for name, reduced in [('paused',False),('reduced',True)]:
        try:
            results[name] = paused_pinch_release(out_dir, reduced)
        except Exception as error:
            results[name] = {'ok':False,'exception':repr(error)}
    try:
        results['takeover'] = keyboard_to_pointer_takeover(out_dir)
    except Exception as error:
        results['takeover'] = {'ok':False,'exception':repr(error)}
    cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'no-preference'}])
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'gesture-%s.json' % tag), 'w') as f:
        json.dump(results,f,indent=2)
    return results
