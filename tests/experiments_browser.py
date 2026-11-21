"""Run with browser_exec helpers after serving the repo on localhost.
Tests drive real documents/inputs; reports are emitted by the caller.
"""
import json
import time

BASE = 'http://127.0.0.1:8765'
IDS = ['liquid-identity', 'wet-ink', 'honey-plotter', 'singing-sand', 'pin-art']
ERROR_HOOK = """if (!window.__qa_errors) {
window.__qa_errors=[];
const oldError=console.error;
console.error=(...args)=>{window.__qa_errors.push(args.map(String).join(' '));oldError(...args)};
addEventListener('error',e=>window.__qa_errors.push(e.message||'resource error'));
addEventListener('unhandledrejection',e=>window.__qa_errors.push(String(e.reason)));
}"""

def shell_contract():
    goto_url(BASE + '/')
    wait_for_load()
    cdp('Page.bringToFront')
    result = js("""(async()=>{
      document.body.innerHTML='<header data-review-nav></header><main><h1>Test identity</h1><canvas id="experiment-canvas"></canvas></main>';
      const events=[];
      for(const name of ['motion','reset','play']) document.addEventListener('experiment:'+name,e=>events.push({name,enabled:e.detail?.enabled}));
      try {
        const {mountShell}=await import('/experiments/shared/shell.js');
        const app=mountShell({id:'liquid-identity',title:'Liquid Identity'});
        document.querySelector('#motion-toggle').click();
        const paused=!app.motion;
        document.querySelector('#motion-toggle').click();
        document.querySelector('#reset-experiment').click();
        document.querySelector('#play-experiment').click();
        app.markReady({rendering:'canvas2d'});
        return {loaded:true,paused,resumed:app.motion,ready:document.body.dataset.ready,
          choiceCount:document.querySelectorAll('#experiment-select option').length,
          ids:['motion-toggle','reset-experiment','play-experiment'].map(id=>!!document.getElementById(id)),
          names:events.map(e=>e.name)};
      } catch(error) {return {loaded:false,error:String(error)}}
    })()""")
    assert result.get('loaded'), 'Shared review shell is missing: ' + json.dumps(result)
    assert result['paused'] and result['resumed'], 'Motion toggle must update real application state'
    assert result['ready'] == 'true', 'Readiness must be set only by actual material initialization'
    assert result['choiceCount'] == 5 and all(result['ids'])
    assert result['names'] == ['motion', 'motion', 'reset', 'play'], result
    return result


def shell_reduced_motion_contract():
    cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'reduce'}])
    goto_url(BASE + '/experiments/')
    wait_for_load()
    cdp('Page.bringToFront')
    state = js("""(async()=>{
      document.body.innerHTML='<header data-review-nav></header><main><canvas id="experiment-canvas"></canvas></main>';
      sessionStorage.setItem('usman-experiments-motion','on');
      const {mountShell}=await import('/experiments/shared/shell.js');
      const shell=mountShell({id:'wet-ink',title:'Wet-ink Usman'});
      return {motion:shell.motion,pressed:document.getElementById('motion-toggle').getAttribute('aria-pressed'),
        label:document.getElementById('motion-toggle').textContent};
    })()""")
    assert not state['motion'] and state['pressed'] == 'false' and state['label'] == 'Resume motion', state
    cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'no-preference'}])
    return state


def mobile_control_contract():
    cdp('Emulation.setDeviceMetricsOverride',width=390,height=844,deviceScaleFactor=1,mobile=True)
    goto_url(BASE+'/experiments/')
    wait_for_load()
    cdp('Page.bringToFront')
    result=js("""(async()=>{
      const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='/experiments/shared/base.css';
      const loaded=new Promise(resolve=>sheet.onload=resolve);document.head.append(sheet);await loaded;
      document.body.innerHTML='<header data-review-nav></header><main><canvas id="experiment-canvas"></canvas></main>';
      const {mountShell}=await import('/experiments/shared/shell.js');mountShell({id:'wet-ink'});
      return [...document.querySelectorAll('.review-nav button,.review-nav a,.review-nav select')].map(e=>{
        const r=e.getBoundingClientRect();return {text:e.innerText||e.id,width:r.width,height:r.height,visible:r.width>0&&r.height>0};
      });
    })()""")
    small=[item for item in result if item['visible'] and (item['height']<44 or item['width']<44)]
    assert not small, 'Touch controls must be at least 44px in each dimension: '+json.dumps(small)
    return result


def page_ready(experiment_id, debug=True):
    query = '?debug' if debug else ''
    goto_url(BASE + '/experiments/' + experiment_id + '/' + query)
    wait_for_load()
    cdp('Page.bringToFront')
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if js("document.body.dataset.ready==='true'"):
            return
        errors = js('window.__qa_errors')
        if errors:
            raise AssertionError('Initialization errors: ' + json.dumps(errors))
        time.sleep(.15)
    raise AssertionError('Experiment never became ready: ' + experiment_id)


def inspect_page(experiment_id):
    state = js("""(()=>{
      const canvas=document.getElementById('experiment-canvas'),r=canvas?.getBoundingClientRect();
      return {id:document.body.dataset.experiment,ready:document.body.dataset.ready,
        renderer:document.body.dataset.renderer,motion:document.body.dataset.motion,
        name:document.body.innerText.includes('Usman Saleem'),main:!!document.querySelector('main'),
        h1:document.querySelectorAll('h1').length,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        stage:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,
        canvas:canvas?{width:canvas.width,height:canvas.height}:null,
        controls:['motion-toggle','reset-experiment','play-experiment'].map(id=>!!document.getElementById(id)),
        links:[...document.querySelectorAll('a')].map(a=>a.href),
        debug:window.__experiment?.id,snapshot:window.__experiment?.snapshot?.(),
        errors:window.__qa_errors,
        noindex:document.querySelector('meta[name=robots]')?.content};
    })()""")
    assert state['ready'] == 'true' and state['id'] == experiment_id, state
    assert state['main'] and state['h1'] == 1 and state['name'], state
    assert state['scrollWidth'] <= state['width'], 'Horizontal overflow: ' + json.dumps(state)
    assert state['stage'] and state['stage']['width'] >= 160 and state['stage']['height'] >= 140, state
    assert state['canvas']['width'] > 0 and all(state['controls']), state
    assert 'noindex' in state.get('noindex', ''), state
    assert any('Usman_Saleem_MEng_Resume.pdf' in url for url in state['links']), state
    assert isinstance(state['errors'], list) and not state['errors'], state
    return state


def click_control(control_id):
    box = js("""(()=>{const e=document.getElementById(""" + json.dumps(control_id) + """);
      if(!e)return null;const r=e.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0&&r.height>0};})()""")
    assert box and box['visible'], 'Missing or hidden control: ' + control_id
    click_at_xy(box['x'], box['y'])


def stage_hash():
    import base64
    import hashlib
    # captureBeyondViewport changes scrollbar layout in CDP and triggers ResizeObserver.
    # Hash the actual material bitmap instead; do not perturb the view being measured.
    encoded = js("document.getElementById('experiment-canvas').toDataURL('image/png')")
    return hashlib.sha256(base64.b64decode(encoded.split(',', 1)[1])).hexdigest()


def paused_keyboard_interaction(experiment_id):
    if js("document.body.dataset.motion==='on'"):
        click_control('motion-toggle')
    time.sleep(.15)
    assert js("document.body.dataset.motion==='off'")
    before = stage_hash()
    time.sleep(.2)
    stable = stage_hash()
    assert before == stable, 'Paused animation keeps moving: ' + experiment_id
    js("document.getElementById('experiment-canvas').focus({preventScroll:true})")
    cdp('Input.dispatchKeyEvent', type='keyDown', key='Enter', code='Enter', windowsVirtualKeyCode=13)
    cdp('Input.dispatchKeyEvent', type='keyUp', key='Enter', code='Enter', windowsVirtualKeyCode=13)
    time.sleep(.15)
    changed = stage_hash()
    assert changed != before, 'Keyboard interaction does not change the visible material: ' + experiment_id
    assert js("document.body.dataset.motion==='off'"), 'Keyboard action silently enabled animation'
    state = inspect_page(experiment_id)
    return {'before':before,'after':changed,'snapshot':state.get('snapshot')}


def material_action_targets():
    controls = js("""(()=>[...document.querySelectorAll('main a,main button,footer a,main input[type=range]')]
      .filter(e=>e.getClientRects().length && !e.closest('[data-review-nav]'))
      .map(e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {text:(e.textContent||e.getAttribute('aria-label')||e.id).trim(),width:r.width,height:r.height,font:parseFloat(c.fontSize)}}))()""")
    bad = [c for c in controls if c['height'] < 44 or c['font'] < 12]
    assert not bad, 'Material phone actions are too small: ' + json.dumps(bad)
    return controls


def gallery_contract():
    goto_url(BASE + '/experiments/')
    wait_for_load()
    cdp('Page.bringToFront')
    result = js("""(()=>({
      title:document.title,
      entries:[...document.querySelectorAll('[data-experiment-link]')].map(a=>({
        id:a.dataset.experimentLink,href:new URL(a.href).pathname,text:a.innerText.trim()})),
      main:!!document.querySelector('main'),
      headings:document.querySelectorAll('h1').length,
      noindex:document.querySelector('meta[name=robots]')?.content,
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth
    }))()""")
    assert [entry['id'] for entry in result['entries']] == IDS, 'Gallery must link exactly the five requested prototypes: ' + json.dumps(result)
    assert all(entry['href'] == '/experiments/' + entry['id'] + '/' for entry in result['entries'])
    assert result['main'] and result['headings'] == 1
    assert 'noindex' in result.get('noindex', '')
    assert result['scrollWidth'] <= result['width'], 'Gallery must fit the viewport'
    return result
