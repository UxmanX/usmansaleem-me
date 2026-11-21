"""Real-browser picker regression; run with browser_exec helpers on localhost:8765."""
import time

BASE = 'http://127.0.0.1:8765'
IDS = ['liquid-identity', 'wet-ink', 'honey-plotter', 'singing-sand', 'pin-art']


def key(name, code, vk):
    for event_type in ('keyDown', 'keyUp'):
        kwargs = {'text': '\r', 'unmodifiedText': '\r'} if name == 'Enter' and event_type == 'keyDown' else {}
        cdp('Input.dispatchKeyEvent', type=event_type, key=name, code=code, windowsVirtualKeyCode=vk, **kwargs)


def picker_keyboard_contract():
    goto_url(BASE + '/experiments/liquid-identity/')
    wait_for_load()
    cdp('Page.bringToFront')
    time.sleep(.5)
    assert js("document.querySelector('#experiment-select') !== null"), 'Picker not mounted'
    original = js('location.href')
    js("document.querySelector('#experiment-select').focus()")
    key('ArrowDown', 'ArrowDown', 40)
    time.sleep(.7)
    actual = js('location.href')
    assert actual == original, 'ArrowDown navigated before explicit Open: ' + actual
    assert js("document.querySelector('#experiment-select').value") == IDS[1], 'ArrowDown did not choose next option'
    key('Tab', 'Tab', 9)
    assert js("document.activeElement.classList.contains('review-open')"), 'Tab must focus Open after the picker'
    key('Enter', 'Enter', 13)
    time.sleep(.7)
    assert js('location.pathname') == '/experiments/' + IDS[1] + '/', 'Open did not navigate to chosen route'
    return {'start': original, 'destination': js('location.href')}


def picker_routes_contract():
    results = []
    for experiment_id in IDS:
        goto_url(BASE + '/experiments/liquid-identity/')
        wait_for_load()
        cdp('Page.bringToFront')
        original = js('location.href')
        js("""(()=>{const s=document.querySelector('#experiment-select');
          s.value=%s;s.dispatchEvent(new Event('change',{bubbles:true}));})()""" % __import__('json').dumps(experiment_id))
        assert js('location.href') == original, 'Selection changed location: ' + experiment_id
        box = js("(()=>{const r=document.querySelector('.review-open').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
        click_at_xy(box['x'], box['y'])
        time.sleep(.5)
        path = js('location.pathname')
        assert path == '/experiments/' + experiment_id + '/', (experiment_id, path)
        links = js("""(()=>({next:document.querySelector('.review-next').getAttribute('href'),
          nextLabel:document.querySelector('.review-next').getAttribute('aria-label'),
          all:document.querySelector('.review-index').getAttribute('href'),
          options:[...document.querySelectorAll('#experiment-select option')].map(o=>o.value)}))()""")
        expected_next = IDS[(IDS.index(experiment_id) + 1) % len(IDS)]
        assert links['next'] == '../' + expected_next + '/' and links['nextLabel'].startswith('Next experiment:'), links
        assert links['all'] == '../' and links['options'] == IDS, links
        results.append({'route':path, **links})
    return results


def picker_mobile_contract(width, experiment_id):
    cdp('Emulation.setDeviceMetricsOverride', width=width, height=844, deviceScaleFactor=1, mobile=True)
    goto_url(BASE + '/experiments/' + experiment_id + '/')
    wait_for_load()
    cdp('Page.bringToFront')
    time.sleep(.3)
    state = js("""(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      selectTextFit:(()=>{const s=document.querySelector('#experiment-select'),style=getComputedStyle(s),
        ctx=document.createElement('canvas').getContext('2d');ctx.font=style.font;
        return ctx.measureText(s.selectedOptions[0].text).width <= s.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)})(),
      controls:[...document.querySelectorAll('.review-nav a,.review-nav button,.review-nav select')]
      .map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.innerText||e.id,
        x:r.x,right:r.right,width:r.width,height:r.height,visible:r.width>0&&r.height>0}})}))()""")
    assert state['scrollWidth'] <= state['width'], state
    assert state['selectTextFit'], 'Selected experiment title does not fit: ' + experiment_id
    bad = [c for c in state['controls'] if c['visible'] and (c['width'] < 44 or c['height'] < 44 or c['x'] < 0 or c['right'] > width)]
    assert not bad, bad
    return state
