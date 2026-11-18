"""Walk-in input regressions using the browser_exec helpers (no dependencies).

Serve the repository over HTTP. In browser_exec, load this file with exec(),
then call run_cases(). Pass a case-name list to run just one regression.
The current tab must be /walk-in/?debug and ready before calling run_cases().
For touch cases, enable Emulation.setTouchEmulationEnabled (maxTouchPoints=5)
once on a fresh tab before running the suite; resetting it between gestures
can stall CDP touch delivery. Install a console-error hook before navigation.
Real pointer/keyboard gestures use CDP; wheel bursts are dispatched within one
JS task so their queued distance does not depend on the machine's frame rate.
"""
import json
import time


def pose(x=0, z=9.6, yaw=0, pitch=0):
    cdp('Page.bringToFront')
    cdp('Emulation.setFocusEmulationEnabled', enabled=True)
    values = json.dumps(dict(x=x, z=z, yaw=yaw, pitch=pitch))
    js("""(() => {
      const S=__walk,F=S.F,p=""" + values + """;
      S.freeApi.enterFree(); S.motion=true;
      F.walk=null; F.vel.set(0,0,0); F.keys.clear(); F.run=false;
      F.pos.set(p.x,1.62,p.z); F.yaw=p.yaw; F.pitch=p.pitch;
      F.look=true; S.dirty=true;
    })()""")
    time.sleep(0.35)  # a new input gesture, after any prior momentum timeout


def state():
    return js("""(() => {
      const S=__walk,F=S.F;
      let remaining=0,p=F.pos;
      for(const q of F.walk?.path||[]){remaining+=Math.hypot(q.x-p.x,q.z-p.z);p=q}
      return {pos:{x:F.pos.x,z:F.pos.z}, remaining, walking:!!F.walk,
        speed:F.vel.length(), yaw:F.yaw, pitch:F.pitch, free:S.freeApi.ex.on,
        fade:document.querySelector('.wk-fade').classList.contains('is-on'),
        errors:window.__qa_errors||[]};
    })()""")


def wheel_burst_is_bounded():
    pose()
    observed = js("""(() => {
      const c=document.querySelector('#wk-canvas');
      for(let i=0;i<16;i++)c.dispatchEvent(new WheelEvent('wheel',{
        deltaY:-120,deltaMode:0,bubbles:true,cancelable:true}));
      let remaining=0,p=__walk.F.pos;
      for(const q of __walk.F.walk?.path||[]){remaining+=Math.hypot(q.x-p.x,q.z-p.z);p=q}
      return {remaining,position:__walk.F.pos.clone()};
    })()""")
    assert 0 < observed['remaining'] <= 0.751, (
        'A wheel burst must queue at most 0.75 m, not a room-length journey: '
        + json.dumps(observed))
    return observed


def floor_tap_is_a_short_step():
    pose()
    observed = js("""(() => {
      const S=__walk,F=S.F;
      let candidate=null;
      for(let y=innerHeight*.48;y<innerHeight*.83&&!candidate;y+=24){
        for(let x=innerWidth*.2;x<innerWidth*.8;x+=36){
          if(document.elementFromPoint(x,y)?.id!=='wk-canvas')continue;
          const h=S.pick(x,y);
          if(h?.floor&&Math.hypot(h.p.x-F.pos.x,h.p.z-F.pos.z)>8){candidate={x,y,hit:h.p};break}
        }
      }
      if(!candidate)throw new Error('No distant floor found in the starting view');
      S.freeApi.tapAt(candidate.x,candidate.y);
      let remaining=0,p=F.pos;
      for(const q of F.walk?.path||[]){remaining+=Math.hypot(q.x-p.x,q.z-p.z);p=q}
      return {candidate,remaining,walking:!!F.walk,
        fade:document.querySelector('.wk-fade').classList.contains('is-on')};
    })()""")
    assert observed['walking'] and 0 < observed['remaining'] <= 2.401, (
        'A casual floor tap must take a nearby step (at most 2.4 m): '
        + json.dumps(observed))
    assert not observed['fade'], 'A floor tap must never teleport'
    return observed


def touching_the_scene_stops_travel():
    pose()
    js('__walk.freeApi.walkTo(0, -2.4)')
    time.sleep(0.12)
    box=js('({x:Math.round(innerWidth*.72),y:Math.round(innerHeight*.62)})')
    cdp('Input.dispatchMouseEvent', type='mousePressed', button='left', buttons=1, clickCount=1, **box)
    down=state()
    cdp('Input.dispatchMouseEvent', type='mouseReleased', button='left', buttons=0, clickCount=1, **box)
    time.sleep(0.15)
    released=state()
    assert not down['walking'] and down['speed'] == 0, (
        'Touching the scene should brake immediately: ' + json.dumps(down))
    assert not released['walking'] and not released['fade'], (
        'Releasing a stop gesture must not start another journey: ' + json.dumps(released))
    return {'down':down,'released':released}


def two_finger_gesture_never_walks():
    pose()
    xy=js('({x:Math.round(innerWidth*.58),y:Math.round(innerHeight*.67)})')
    points=[dict(x=xy['x'],y=xy['y'],id=21),dict(x=xy['x']+25,y=xy['y'],id=22)]
    before=state()
    cdp('Input.dispatchTouchEvent',type='touchStart',touchPoints=points)
    cdp('Input.dispatchTouchEvent',type='touchEnd',touchPoints=[])
    time.sleep(.12)
    after=state()
    assert not after['walking'] and not after['fade'], (
        'Lifting two fingers must not be interpreted as floor taps: ' + json.dumps(after))
    assert abs(after['pos']['z']-before['pos']['z']) < .001, json.dumps(after)
    return after


def small_touch_drag_is_not_a_tap():
    pose()
    xy=js('({x:Math.round(innerWidth*.58),y:Math.round(innerHeight*.67)})')
    stamp=time.time()
    cdp('Input.dispatchTouchEvent',type='touchStart',touchPoints=[dict(**xy,id=1)],timestamp=stamp)
    cdp('Input.dispatchTouchEvent',type='touchMove',touchPoints=[dict(x=xy['x']+7,y=xy['y'],id=1)],timestamp=stamp+.08)
    cdp('Input.dispatchTouchEvent',type='touchEnd',touchPoints=[],timestamp=stamp+.12)
    time.sleep(.12)
    after=state()
    assert not after['walking'] and not after['fade'], (
        'A small intentional touch drag must not start walking: ' + json.dumps(after))
    return after


def blur_cancels_pending_tap():
    pose()
    xy=js('({x:Math.round(innerWidth*.58),y:Math.round(innerHeight*.67)})')
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='left',buttons=1,clickCount=1,**xy)
    js("window.dispatchEvent(new Event('blur'))")
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='left',buttons=0,clickCount=1,**xy)
    time.sleep(.12)
    after=state()
    assert not after['walking'] and not after['fade'], (
        'A gesture interrupted by focus loss must not navigate on release: '+json.dumps(after))
    return after


def release_far_from_press_is_not_a_tap():
    pose()
    xy=js('({x:Math.round(innerWidth*.58),y:Math.round(innerHeight*.67)})')
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='left',buttons=1,clickCount=1,**xy)
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='left',buttons=0,clickCount=1,x=xy['x']+35,y=xy['y'])
    time.sleep(.12)
    after=state()
    assert not after['walking'] and not after['fade'], (
        'The final release position must be included in tap detection: '+json.dumps(after))
    return after


def stop_gesture_discards_wheel_tail():
    pose()
    js("document.querySelector('#wk-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true}))")
    xy=js('({x:Math.round(innerWidth*.58),y:Math.round(innerHeight*.67)})')
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='left',buttons=1,clickCount=1,**xy)
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='left',buttons=0,clickCount=1,**xy)
    js("document.querySelector('#wk-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-30,bubbles:true,cancelable:true}))")
    after=state()
    assert not after['walking'], 'Old wheel momentum restarted a stopped camera: '+json.dumps(after)
    return after


def space_stops_travel_without_leaving():
    pose()
    js("document.activeElement?.blur();__walk.freeApi.walkTo(0,-2.4)")
    cdp('Input.dispatchKeyEvent',type='keyDown',key=' ',code='Space',windowsVirtualKeyCode=32)
    cdp('Input.dispatchKeyEvent',type='keyUp',key=' ',code='Space',windowsVirtualKeyCode=32)
    after=state()
    assert not after['walking'] and after['speed']==0 and after['free'], (
        'Space should stop travel without changing modes: '+json.dumps(after))
    return after


def travelling_shows_how_to_stop():
    pose()
    js('__walk.freeApi.walkTo(0,-2.4)')
    time.sleep(.12)
    text=js("document.querySelector('[data-free-help]').textContent")
    assert 'stop' in text.lower(), 'Movement needs a visible stop instruction: '+text
    return {'help':text}


def stopped_camera_ignores_reversed_wheel_tail():
    pose()
    js("document.querySelector('#wk-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true}))")
    xy=js('({x:Math.round(innerWidth*.58),y:Math.round(innerHeight*.67)})')
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='left',buttons=1,clickCount=1,**xy)
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='left',buttons=0,clickCount=1,**xy)
    js("document.querySelector('#wk-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:30,bubbles:true,cancelable:true}))")
    after=state()
    assert not after['walking'], 'A reversed wheel tail bypassed click-to-stop: '+json.dumps(after)
    return after


CASES = {
    'stopped_camera_ignores_reversed_wheel_tail': stopped_camera_ignores_reversed_wheel_tail,
    'wheel_burst_is_bounded': wheel_burst_is_bounded,
    'floor_tap_is_a_short_step': floor_tap_is_a_short_step,
    'touching_the_scene_stops_travel': touching_the_scene_stops_travel,
    'two_finger_gesture_never_walks': two_finger_gesture_never_walks,
    'small_touch_drag_is_not_a_tap': small_touch_drag_is_not_a_tap,
    'blur_cancels_pending_tap': blur_cancels_pending_tap,
    'release_far_from_press_is_not_a_tap': release_far_from_press_is_not_a_tap,
    'stop_gesture_discards_wheel_tail': stop_gesture_discards_wheel_tail,
    'space_stops_travel_without_leaving': space_stops_travel_without_leaving,
    'travelling_shows_how_to_stop': travelling_shows_how_to_stop,
}


def run_cases(names=None):
    results=[]
    for name in names or CASES:
        try:
            data=CASES[name]()
            results.append({'case':name,'passed':True,'observed':data})
        except Exception as exc:
            results.append({'case':name,'passed':False,'error':str(exc)})
    print(json.dumps(results,indent=2))
    failures=[r for r in results if not r['passed']]
    assert not failures, f'{len(failures)} input regression(s) failed'
    return results
