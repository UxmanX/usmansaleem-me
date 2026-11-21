"""Liquid Identity lifecycle regressions (WebGL context loss, key/pointer ownership).

Run inside browser_exec after serving the repo on 127.0.0.1:8765:
    exec(open(r'<repo>/tests/liquid_lifecycle_browser.py').read()); print(run_all(OUT_DIR))
Each check returns a dict with 'ok' plus the measured values; run_all never raises.
"""
import json
import os
import shutil
import time

BASE = 'http://127.0.0.1:8765/experiments/liquid-identity/'
ERROR_HOOK = """if (!window.__qa_errors) {
window.__qa_errors=[];
const oldError=console.error;
console.error=(...args)=>{window.__qa_errors.push(args.map(String).join(' '));oldError(...args)};
addEventListener('error',e=>window.__qa_errors.push(e.message||'resource error'));
addEventListener('unhandledrejection',e=>window.__qa_errors.push(String(e.reason)));
}"""
STATE = """(()=>{const s=document.querySelector('.liquid-still');const c=document.getElementById('experiment-canvas');
const snap=window.__experiment?window.__experiment.snapshot():null;
return {ready:document.body.dataset.ready||null,renderer:document.body.dataset.renderer||null,
 stillDisplay:s?getComputedStyle(s).display:null,canvasIsOld:window.__oldCanvas?c===window.__oldCanvas:null,
 oldConnected:window.__oldCanvas?window.__oldCanvas.isConnected:null,fallbackAttr:c.dataset.fallback||null,
 status:(document.querySelector('[role=status],#experiment-status')||{}).textContent||null,
 debugHook:!!window.__experiment,errors:window.__qa_errors||[],
 snap:snap&&{ready:snap.ready,motion:snap.motion,rendering:snap.rendering,frames:snap.frames,
  interactions:snap.interactions,captured:snap.model.captured,viewWidth:snap.view.width,ink:snap.ink}}})()"""
LOSE = """(()=>{const c=document.getElementById('experiment-canvas');window.__oldCanvas=c;
const gl=c.getContext('webgl2');const ext=gl&&gl.getExtension('WEBGL_lose_context');
if(!ext) return 'no-webgl2';ext.loseContext();return 'lost'})()"""


def _setup(query='?debug', width=1280, height=800):
    cdp('Network.enable')
    cdp('Network.setCacheDisabled', cacheDisabled=True)
    cdp('Emulation.setFocusEmulationEnabled', enabled=True)
    cdp('Emulation.setDeviceMetricsOverride', width=width, height=height, deviceScaleFactor=1, mobile=False)
    cdp('Page.addScriptToEvaluateOnNewDocument', source=ERROR_HOOK)
    goto_url(BASE + query)
    wait_for_load()
    cdp('Page.bringToFront')
    for _ in range(40):
        if js('document.body.dataset.ready') == 'true':
            break
        time.sleep(0.1)
    time.sleep(0.3)


def _state():
    return js(STATE)


def _point(letter=None, fy=0.5):
    """Viewport point inside a letter box (model units → CSS px)."""
    return js("""(()=>{const s=window.__experiment.snapshot();const b=s.model.letterBoxes;
      const keys=Object.keys(b);const k=%s||keys[keys.length-1];const r=document.getElementById('experiment-canvas').getBoundingClientRect();
      const box=b[k];return {key:k,x:r.left+s.view.ox+(box.x+box.w*0.5)*s.view.scale,y:r.top+s.view.oy+(box.y+box.h*%s)*s.view.scale}})()"""
              % (json.dumps(letter), fy))


def _mouse(kind, x, y, buttons=1):
    cdp('Input.dispatchMouseEvent', type=kind, x=x, y=y, button='left', buttons=buttons, clickCount=1)


def _key(kind, key, code, vk):
    args = dict(type=kind, key=key, code=code, windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)
    if kind == 'keyDown' and key == 'Enter':
        args['text'] = '\r'
    cdp('Input.dispatchKeyEvent', **args)


def _drag(p, dx=60):
    _mouse('mousePressed', p['x'], p['y'])
    for i in range(1, 7):
        _mouse('mouseMoved', p['x'] + dx * i / 6, p['y'] + 4 * i / 6)
        time.sleep(0.03)
    _mouse('mouseReleased', p['x'] + dx, p['y'] + 4, buttons=0)


def _shot(out_dir, name):
    path = capture_screenshot()
    dest = os.path.join(out_dir, name)
    shutil.copyfile(str(path).strip(), dest)
    return dest


def keyup_does_not_cancel_pointer_drag(out_dir):
    _setup()
    js("document.getElementById('experiment-canvas').focus()")
    _key('rawKeyDown', 'ArrowRight', 'ArrowRight', 39)
    keyboard_captured = _state()['snap']['captured']
    p = _point()
    before = _state()['snap']['interactions']['drags']
    _mouse('mousePressed', p['x'], p['y'])
    for i in range(1, 4):
        _mouse('mouseMoved', p['x'] + 10 * i, p['y'])
        time.sleep(0.03)
    pointer_captured = _state()['snap']['captured']
    _key('keyUp', 'ArrowRight', 'ArrowRight', 39)
    after_keyup = _state()['snap']['captured']
    for i in range(4, 8):
        _mouse('mouseMoved', p['x'] + 10 * i, p['y'])
        time.sleep(0.03)
    still_dragging = _state()['snap']['captured']
    _mouse('mouseReleased', p['x'] + 70, p['y'], buttons=0)
    time.sleep(0.1)
    end = _state()
    result = {'letter': p['key'], 'keyboardCaptured': keyboard_captured, 'pointerCaptured': pointer_captured,
              'capturedAfterKeyup': after_keyup, 'capturedAfterMoreMoves': still_dragging,
              'drags': end['snap']['interactions']['drags'] - before, 'errors': end['errors']}
    result['ok'] = (pointer_captured > 0 and after_keyup > 0 and still_dragging > 0
                    and result['drags'] == 1 and not end['errors'])
    return result


def context_loss_recovers(out_dir, paused=False):
    _setup()
    # The shell remembers the motion toggle per session, so set the wanted state explicitly.
    if _state()['snap']['motion'] == paused:
        js("document.getElementById('motion-toggle').click()")
    before = _state()
    lost = js(LOSE)
    time.sleep(0.6)
    after = _state()
    shot = _shot(out_dir, 'context-loss-%s.png' % ('paused' if paused else 'motion'))
    f0 = after['snap']['frames']
    time.sleep(0.5)
    idle_frames = _state()['snap']['frames'] - f0
    # Enter (shared play), drag, Reset and resize on whatever canvas is now mounted.
    js("document.getElementById('experiment-canvas').focus()")
    plays0 = _state()['snap']['interactions']['plays']
    _key('keyDown', 'Enter', 'Enter', 13)
    _key('keyUp', 'Enter', 'Enter', 13)
    time.sleep(0.1)
    plays = _state()['snap']['interactions']['plays'] - plays0
    drags0 = _state()['snap']['interactions']['drags']
    _drag(_point())
    time.sleep(0.1)
    drags = _state()['snap']['interactions']['drags'] - drags0
    resets0 = _state()['snap']['interactions']['resets']
    js("document.getElementById('reset-experiment').click()")
    time.sleep(0.2)
    resets = _state()['snap']['interactions']['resets'] - resets0
    w0 = _state()['snap']['viewWidth']
    cdp('Emulation.setDeviceMetricsOverride', width=760, height=800, deviceScaleFactor=1, mobile=False)
    time.sleep(0.6)
    resized = _state()
    shot2 = _shot(out_dir, 'context-loss-%s-resized.png' % ('paused' if paused else 'motion'))
    cdp('Emulation.setDeviceMetricsOverride', width=1280, height=800, deviceScaleFactor=1, mobile=False)
    result = {'paused': paused, 'lost': lost, 'before': {k: before[k] for k in ('ready', 'renderer')},
              'after': {k: after[k] for k in ('ready', 'renderer', 'stillDisplay', 'canvasIsOld', 'oldConnected', 'fallbackAttr')},
              'snapRendering': after['snap']['rendering'], 'motion': after['snap']['motion'], 'ink': after['snap']['ink'],
              'framesWhileIdle': idle_frames, 'enterPlays': plays, 'drags': drags, 'resets': resets,
              'viewWidth': [w0, resized['snap']['viewWidth']], 'resizedReady': resized['ready'],
              'resizedInk': resized['snap']['ink'], 'errors': resized['errors'], 'shots': [shot, shot2]}
    result['ok'] = (lost == 'lost' and after['ready'] == 'true' and after['renderer'] == 'canvas2d'
                    and after['snap']['rendering'] == 'canvas2d' and after['canvasIsOld'] is False
                    and after['stillDisplay'] == 'none' and plays == 1 and drags == 1 and resets == 1
                    and resized['snap']['viewWidth'] != w0 and resized['ready'] == 'true'
                    and after['snap']['motion'] == (not paused) and (idle_frames == 0 if paused else idle_frames > 0)
                    and not resized['errors'])
    return result


def context_loss_without_canvas_keeps_still(out_dir):
    _setup()
    js("""(()=>{const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){
      return t==='2d'?null:g.call(this,t,...a)}})()""")
    lost = js(LOSE)
    time.sleep(0.6)
    after = _state()
    shot = _shot(out_dir, 'context-loss-no-canvas2d.png')
    result = {'lost': lost, 'ready': after['ready'], 'stillDisplay': after['stillDisplay'], 'status': after['status'],
              'errors': after['errors'], 'shot': shot}
    # One logged startup-style error is expected here; nothing uncaught.
    result['ok'] = (lost == 'lost' and after['ready'] is None and after['stillDisplay'] != 'none'
                    and all('could not' in e for e in after['errors']))
    return result


def ordinary_page_context_loss(out_dir):
    _setup(query='')
    lost = js(LOSE)
    time.sleep(0.6)
    after = _state()
    result = {'lost': lost, 'ready': after['ready'], 'renderer': after['renderer'], 'stillDisplay': after['stillDisplay'],
              'debugHook': after['debugHook'], 'errors': after['errors']}
    result['ok'] = (after['ready'] == 'true' and after['renderer'] == 'canvas2d' and after['stillDisplay'] == 'none'
                    and not after['debugHook'] and not after['errors'])
    return result


def run_all(out_dir, tag='run'):
    os.makedirs(out_dir, exist_ok=True)
    results = {}
    for name, fn in [('keyup_pointer', keyup_does_not_cancel_pointer_drag),
                     ('context_loss_motion', context_loss_recovers),
                     ('context_loss_paused', lambda d: context_loss_recovers(d, paused=True)),
                     ('context_loss_no_canvas2d', context_loss_without_canvas_keeps_still),
                     ('ordinary_context_loss', ordinary_page_context_loss)]:
        try:
            results[name] = fn(out_dir)
        except Exception as error:  # report, don't hide
            results[name] = {'ok': False, 'exception': repr(error)}
    with open(os.path.join(out_dir, 'results-%s.json' % tag), 'w') as fh:
        json.dump(results, fh, indent=1, default=str)
    return results
