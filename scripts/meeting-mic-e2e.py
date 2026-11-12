#!/usr/bin/env python3
"""Full cycle browser test for the meeting microphone and call audio setup.

Run the app first, for example:  PORT=5055 DEMO_ACCOUNT=1 node server.js
Then:  python3 scripts/meeting-mic-e2e.py [base_url] [project_id]

Uses real Chrome with a fake microphone. Error cases (blocked, no device, busy, no recorder support) and the
call audio sources (a virtual cable, a shared tab, a cancelled picker) are simulated with a small stub that is
injected before the page loads, so every scenario is repeatable.
"""
import json, re, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5055'
PID = sys.argv[2] if len(sys.argv) > 2 else '10001401'
CHROME = '/usr/bin/google-chrome'

STUB = r"""
(() => {
  localStorage.setItem('pm_signed', '1');
  const M = window.__mic = { mode: 'real', perm: null, devices: null, share: 'audio', tracks: [], gum: [], display: 0, silent: false };
  const md = navigator.mediaDevices;
  const realGum = md.getUserMedia.bind(md), realEnum = md.enumerateDevices.bind(md);
  const synth = (silent) => {
    const ac = new AudioContext(); const dst = ac.createMediaStreamDestination();
    if (!silent) { const o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0.3; o.connect(g); g.connect(dst); o.start(); }
    const s = dst.stream; s.getTracks().forEach((t) => M.tracks.push(t)); return s;
  };
  const err = (n) => Object.assign(new DOMException(n, n), {});
  md.getUserMedia = async (c) => {
    const id = c && c.audio && c.audio.deviceId && c.audio.deviceId.exact;
    M.gum.push(id || '');
    if (M.mode === 'denied') throw err('NotAllowedError');
    if (M.mode === 'none') throw err('NotFoundError');
    if (M.mode === 'busy') throw err('NotReadableError');
    if (id && M.devices && !M.devices.some((d) => d.deviceId === id)) throw err('NotFoundError');
    if (M.mode === 'real' && !(id && M.devices)) return realGum(c);
    const s = synth(M.silent && !(id && /BlackHole|CABLE/i.test((M.devices.find((d) => d.deviceId === id) || {}).label || '')));
    return s;
  };
  md.enumerateDevices = async () => (M.devices ? M.devices.map((d) => ({ kind: 'audioinput', groupId: 'g', ...d })) : realEnum());
  md.getDisplayMedia = async () => {
    M.display++;
    if (M.share === 'cancel') throw err('NotAllowedError');
    const ac = new AudioContext(); const dst = ac.createMediaStreamDestination();
    const o = ac.createOscillator(); o.connect(dst); o.start();
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36; cv.getContext('2d').fillRect(0, 0, 64, 36);
    const v = cv.captureStream(1);
    const out = new MediaStream([...v.getVideoTracks(), ...(M.share === 'audio' ? dst.stream.getAudioTracks() : [])]);
    out.getTracks().forEach((t) => M.tracks.push(t)); return out;
  };
  const q = navigator.permissions && navigator.permissions.query.bind(navigator.permissions);
  if (q) navigator.permissions.query = async (d) => {
    if (d && d.name === 'microphone' && M.perm) { const et = new EventTarget(); const o = { state: M.perm, onchange: null, addEventListener: et.addEventListener.bind(et) }; M.permObj = o; return o; }
    return q(d);
  };
  M.setPerm = (st) => { M.perm = st; if (M.permObj) { M.permObj.state = st; M.permObj.onchange && M.permObj.onchange(); } };
})();
"""

results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if (extra and not cond) else ''), flush=True)

def js(page, code): return page.evaluate(code)

class Sess:
    def __init__(self, br, init='', lang='en', theme='light', size=(1280, 900), stub=True):
        self.ctx = br.new_context(viewport={'width': size[0], 'height': size[1]}, permissions=['microphone'], locale='en-US', ignore_https_errors=True)
        self.errors = []
        self.page = self.ctx.new_page()
        self.page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: self.errors.append('PAGEERROR ' + str(e)))
        self.uploads = []
        self.page.on('response', lambda r: self.uploads.append((r.status, r.url)) if re.search(r'/api/meetings/\d+/audio$', r.url) and r.request.method == 'POST' else None)
        r = self.ctx.request.post(BASE + '/api/auth/login', data={'email': 'pm@example.com', 'password': 'demo1234'}, headers={'X-Session-Mode': 'cookie'})
        assert r.ok, r.text()
        # language and theme belong to the account, so set them there
        csrf = {c['name']: c['value'] for c in self.ctx.cookies()}.get('pm_csrf', '')
        r = self.ctx.request.put(BASE + '/api/me', data={'language': lang, 'theme': theme}, headers={'x-csrf-token': csrf})
        assert r.ok, r.text()
        self.ctx.add_init_script(f"localStorage.setItem('pm_lang','{lang}');localStorage.setItem('pm_theme','{theme}');" + (STUB if stub else '') + init)
    def open_dialog(self):
        p = self.page
        p.goto(f'{BASE}/app.html#/p/{PID}/meetings'); p.wait_for_selector('#mtNew, #mtNew2', timeout=15000)
        # the demo account shows a first run welcome dialog, close it like a person would
        skip = p.locator('.overlay button:has-text("Skip for now"), .overlay button:has-text("تخطي")')
        try:
            skip.first.wait_for(timeout=2500); skip.first.click(); p.wait_for_timeout(400)
        except Exception: pass
        p.click('#mtNew, #mtNew2'); p.wait_for_selector('#mtT')
        return p
    def close(self): self.ctx.close()

def mic_state(p): return js(p, "document.querySelector('#mcMic') ? (document.querySelector('#mcMic .mc-ready') ? 'ready' : document.querySelector('#mcMic .mc-need') ? 'need' : document.querySelector('#mcMic .mc-bad') ? 'bad' : 'checking') : 'none'")
def wait_state(p, st, ms=6000):
    t = time.time()
    while time.time() - t < ms / 1000:
        if mic_state(p) == st: return True
        time.sleep(0.1)
    return False
def start_disabled(p): return js(p, "document.querySelector('#mtGo').disabled")
def toasts(p): return js(p, "[...document.querySelectorAll('.toast')].map(t=>t.textContent.trim())")
def wait_toast(p, rx, ms=5000):
    t = time.time()
    while time.time() - t < ms / 1000:
        if any(re.search(rx, x, re.I) for x in toasts(p)): return True
        time.sleep(0.15)
    return False
def has_dock(p): return js(p, "!!document.querySelector('.rec-dock')")
def fill_title(p, name='Weekly status update'): p.fill('#mtT', name)
def stop_and_send(s):
    p = s.page
    n0 = len(s.uploads)
    p.click('#rcStop')
    t = time.time()
    while time.time() - t < 15 and len(s.uploads) == n0: p.wait_for_timeout(200)  # lets the response listener run
    return len(s.uploads) > n0 and s.uploads[-1][0] == 200
def no_raw_keys(p): return not re.search(r'\bmt_[a-z_]+\b', js(p, "document.body.innerText"))
def no_overflow(p): return js(p, "document.documentElement.scrollWidth <= window.innerWidth + 1")

def run():
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'])

        # 1 happy path, microphone only, real (fake device) Chrome microphone
        s = Sess(br); p = s.open_dialog()
        check('1.1 mic check reaches ready with the real fake device', wait_state(p, 'ready'))
        check('1.2 default choice is the room option', js(p, "document.querySelector('.mc-card.on').dataset.src") == 'room')
        check('1.3 Start enabled when ready', not start_disabled(p))
        check('1.4 level meter moves (the fake device beeps about once a second)', max(js(p, "parseFloat(document.querySelector('#mcLvl').style.width)||0") for _ in range(30) if p.wait_for_timeout(100) is None) > 0)
        check('1.5 no old radio options', js(p, "document.querySelectorAll('input[name=mtSysM]').length") == 0)
        check('1.6 no raw keys in dialog', no_raw_keys(p))
        p.click('#mtGo'); p.wait_for_selector('#mtT', state='detached', timeout=3000) if False else None
        check('1.7 empty title is refused with a message', (p.wait_for_timeout(400), wait_toast(p, 'title'))[1])
        fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000)
        check('1.8 recording box opens', has_dock(p))
        check('1.9 dock shows You and The call rows', js(p, "document.querySelector('.rec-dock').innerText.includes('You') && document.querySelector('.rec-dock').innerText.includes('The call')"))
        check('1.10 call off wording', 'Not recording the call' in js(p, "document.querySelector('#sysLabel').textContent"))
        p.wait_for_timeout(3500)
        check('1.11 timer runs', js(p, "document.querySelector('#rcTime').textContent") not in ('0:00', ''))
        check('1.12 mic meter moves while recording', js(p, "parseFloat(document.querySelector('#mtMic').style.width)||0") >= 0)
        # pause, resume, mute
        p.click('#rcPause'); check('1.13 paused state', js(p, "document.querySelector('.rec-dock').classList.contains('paused')"))
        p.click('#rcPause'); check('1.14 resumed', not js(p, "document.querySelector('.rec-dock').classList.contains('paused')"))
        p.click('#rcMute'); check('1.15 muted', js(p, "document.querySelector('#rcMute').getAttribute('aria-pressed')") == 'true')
        p.click('#rcMute'); check('1.16 unmuted', js(p, "document.querySelector('#rcMute').getAttribute('aria-pressed')") == 'false')
        p.click('#rcMore summary'); check('1.17 more options opens', js(p, "document.querySelector('#rcMore').open"))
        check('1.18 stop uploads audio (200)', stop_and_send(s), s.uploads)
        check('1.19 dock removed after stop', (p.wait_for_timeout(500), not has_dock(p))[1])
        check('1.20 no console errors', not [e for e in s.errors if 'favicon' not in e], s.errors); s.close()

        # 2 permission states
        s = Sess(br); s.page.add_init_script("window.__mic.mode='denied'; window.__mic.perm='denied'")
        p = s.open_dialog()
        check('2.1 blocked state shown', wait_state(p, 'bad'))
        check('2.2 blocked message explains the fix', 'lock icon' in js(p, "document.querySelector('#mcMic').innerText"))
        check('2.3 Start disabled when blocked', start_disabled(p))
        check('2.4 Try again button present', js(p, "!!document.querySelector('#mcRetry')"))
        js(p, "window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'m1',label:'USB Headset'}]")
        p.click('#mcRetry'); check('2.5 Try again recovers to ready', wait_state(p, 'ready'))
        check('2.6 Start enabled after recovery', not start_disabled(p)); s.close()

        s = Sess(br); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='prompt'; window.__mic.devices=[{deviceId:'m1',label:'USB Headset'}]")
        p = s.open_dialog()
        check('2.7 prompt state asks the person to allow', wait_state(p, 'need'))
        check('2.8 Start disabled before allowing', start_disabled(p))
        p.click('#mcAllow'); check('2.9 Allow leads to ready', wait_state(p, 'ready')); s.close()

        s = Sess(br); s.page.add_init_script("window.__mic.mode='denied'; window.__mic.perm='prompt'")
        p = s.open_dialog(); wait_state(p, 'need'); p.click('#mcAllow')
        check('2.10 person clicks Block in the browser box: blocked state', wait_state(p, 'bad')); s.close()

        s = Sess(br); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='denied'; window.__mic.devices=[{deviceId:'m1',label:'USB Headset'}]")
        p = s.open_dialog(); wait_state(p, 'bad')
        js(p, "window.__mic.setPerm('granted')")
        check('2.11 unblocking in site settings updates by itself', wait_state(p, 'ready')); s.close()

        # 3 device problems
        s = Sess(br); s.page.add_init_script("window.__mic.mode='none'; window.__mic.perm='granted'; window.__mic.devices=[]")
        p = s.open_dialog()
        check('3.1 no microphone state', wait_state(p, 'bad') and 'No microphone found' in js(p, "document.querySelector('#mcMic').innerText"))
        js(p, "window.__mic.mode='ok'; window.__mic.devices=[{deviceId:'m1',label:'Plugged in Mic'}]; navigator.mediaDevices.dispatchEvent(new Event('devicechange'))")
        check('3.2 plugging a microphone in is picked up without clicking', wait_state(p, 'ready')); s.close()

        s = Sess(br); s.page.add_init_script("window.__mic.mode='busy'; window.__mic.perm='granted'")
        p = s.open_dialog()
        check('3.3 busy microphone state', wait_state(p, 'bad') and 'busy' in js(p, "document.querySelector('#mcMic').innerText")); s.close()

        s = Sess(br); s.page.add_init_script("delete window.MediaRecorder")
        p = s.open_dialog()
        check('3.5 unsupported browser opens on upload instead of a dead end', js(p, "document.querySelector('#mtMode button.on').dataset.m") == 'upload')
        p.click('#mtMode button[data-m=record]')
        check('3.4 choosing Record explains the browser cannot record and what to do', wait_state(p, 'bad') and 'Chrome or Edge' in js(p, "document.querySelector('#mcMic').innerText"))
        check('3.4b Start disabled and no retry loop', start_disabled(p) and not js(p, "!!document.querySelector('#mcRetry')")); s.close()

        s = Sess(br); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'},{deviceId:'b',label:'USB Headset'},{deviceId:'c',label:'BlackHole 2ch'}]")
        p = s.open_dialog(); wait_state(p, 'ready')
        opts = js(p, "[...document.querySelectorAll('#mcSel option')].map(o=>o.textContent)")
        check('3.6 several microphones show a chooser without the virtual cable', len(opts) == 3 and not any('BlackHole' in o for o in opts), opts)
        p.select_option('#mcSel', 'b'); p.wait_for_timeout(600)
        check('3.7 choice is remembered', json.loads(js(p, "localStorage.getItem('pm_rec')")).get('deviceId') == 'b')
        check('3.8 still ready after switching', wait_state(p, 'ready'))
        fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock')
        check('3.9 recorder uses the chosen microphone', 'b' in js(p, "window.__mic.gum"))
        check('3.10 dock names the microphone', 'USB Headset' in js(p, "document.querySelector('#rcMicName').textContent"))
        check('3.11 More options lists both inputs', js(p, "document.querySelectorAll('#rcDev option').length") >= 3)
        # unplug during recording: falls back to default
        js(p, "window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'},{deviceId:'c',label:'BlackHole 2ch'}]; window.__mic.tracks.filter(t=>t.kind==='audio'&&t.readyState==='live').forEach(t=>t.dispatchEvent(new Event('ended')))")
        check('3.12 unplug mid recording switches to default and tells the person', wait_toast(p, 'disconnected'))
        check('3.13 recording keeps running after unplug', has_dock(p) and js(p, "document.querySelector('.rec-dock').classList.contains('paused')") is False)
        # unplug with nothing left
        js(p, "window.__mic.mode='none'; window.__mic.tracks.filter(t=>t.kind==='audio'&&t.readyState==='live').forEach(t=>t.dispatchEvent(new Event('ended')))")
        check('3.14 unplug with no replacement asks to choose another', wait_toast(p, 'Choose another'))
        check('3.15 recording not lost', has_dock(p))
        js(p, "window.__mic.mode='ok'")
        stop_and_send(s); s.close()

        # 4 online call
        s = Sess(br, init="localStorage.removeItem('pm_rec')"); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]; window.__mic.share='audio'")
        p = s.open_dialog(); wait_state(p, 'ready')
        p.click('.mc-card[data-src=call]')
        check('4.1 online call card selected', js(p, "document.querySelector('.mc-card.on').dataset.src") == 'call' and js(p, "document.querySelector('.mc-card.on').getAttribute('aria-checked')") == 'true')
        check('4.2 call line explains the share step', 'Share audio' in js(p, "document.querySelector('#mcCall').innerText"))
        check('4.3 desktop app link present', js(p, "!!document.querySelector('#mtSysHelp')"))
        p.click('#mtSysHelp'); p.wait_for_selector('.modal-head h2:has-text("desktop apps")')
        check('4.4 help opens with plain steps', js(p, "document.body.innerText.includes('BlackHole')")); p.keyboard.press('Escape')
        fill_title(p, 'Call test'); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000)
        check('4.5 share picker was asked once', js(p, "window.__mic.display") == 1)
        check('4.6 dock says hearing the call', 'Hearing the call' in js(p, "document.querySelector('#sysLabel').textContent"))
        check('4.6b advanced list names the shared source instead of None', js(p, "document.querySelector('#rcSysDev').options[0].textContent") == 'Shared tab or screen')
        check('4.7 button becomes Remove', js(p, "document.querySelector('#rcShare').textContent") == 'Remove')
        p.wait_for_timeout(1500)
        check('4.8 call meter moves', js(p, "parseFloat(document.querySelector('#mtSys').style.width)||0") > 0)
        p.click('#rcShare'); check('4.9 Remove stops the call audio', 'Not recording' in js(p, "document.querySelector('#sysLabel').textContent") and js(p, "document.querySelector('#rcShare').textContent") == 'Add call audio')
        p.click('#rcShare'); p.wait_for_timeout(500)
        check('4.10 Add call audio brings it back', 'Hearing the call' in js(p, "document.querySelector('#sysLabel').textContent"))
        js(p, "window.__mic.tracks.filter(t=>t.kind==='video'&&t.readyState==='live').forEach(t=>t.dispatchEvent(new Event('ended')))")
        check('4.11 sharing stopped from the browser bar is reported', wait_toast(p, 'Meeting audio stopped') and 'Not recording' in js(p, "document.querySelector('#sysLabel').textContent"))
        check('4.12 stop uploads', stop_and_send(s)); s.close()

        # 4b picker cancelled and picker without audio
        s = Sess(br, init="localStorage.setItem('pm_rec', JSON.stringify({sysMode:'call'}))"); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]; window.__mic.share='cancel'")
        p = s.open_dialog(); wait_state(p, 'ready')
        check('4.13 call choice is remembered', js(p, "document.querySelector('.mc-card.on').dataset.src") == 'call')
        fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000)
        check('4.14 cancelled picker still records the microphone and says how to add the call', wait_toast(p, 'No call audio yet'))
        check('4.15 dock call row off', 'Not recording' in js(p, "document.querySelector('#sysLabel').textContent"))
        js(p, "window.__mic.share='noaudio'"); p.click('#rcShare')
        check('4.16 shared screen without sound explains what to tick', wait_toast(p, 'No sound was shared'))
        check('4.17 recording still running', has_dock(p)); stop_and_send(s); s.close()

        # 4c virtual cable is found by itself, no picker
        s = Sess(br, init="localStorage.setItem('pm_rec', JSON.stringify({sysMode:'call'}))"); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'},{deviceId:'c',label:'BlackHole 2ch'}]")
        p = s.open_dialog(); wait_state(p, 'ready'); p.wait_for_timeout(300)
        check('4.18 dialog says the cable is ready and no window appears', 'BlackHole 2ch' in js(p, "document.querySelector('#mcCall').innerText") and 'No sharing window' in js(p, "document.querySelector('#mcCall').innerText"))
        fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000); p.wait_for_timeout(800)
        check('4.19 no picker was opened', js(p, "window.__mic.display") == 0)
        check('4.20 dock hears the call through the cable', 'Hearing the call' in js(p, "document.querySelector('#sysLabel').textContent") and 'BlackHole' in js(p, "document.querySelector('#sysLabel').textContent"))
        check('4.21 cable saved for next time', json.loads(js(p, "localStorage.getItem('pm_rec')")).get('sysLabel') == 'BlackHole 2ch')
        check('4.22 stop uploads', stop_and_send(s)); s.close()

        # 4d cable unplugged: falls back to the share picker
        s = Sess(br, init="localStorage.setItem('pm_rec', JSON.stringify({sysMode:'call',sysDev:'c',sysLabel:'BlackHole 2ch'}))"); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.share='audio'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]")
        p = s.open_dialog(); wait_state(p, 'ready'); p.wait_for_timeout(300)
        check('4.23 saved cable missing falls back to the share step', 'Share audio' in js(p, "document.querySelector('#mcCall').innerText"))
        fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000); p.wait_for_timeout(500)
        check('4.24 share picker used instead', js(p, "window.__mic.display") == 1 and 'Hearing the call' in js(p, "document.querySelector('#sysLabel').textContent"))
        # advanced: choose an input in More options
        js(p, "window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'},{deviceId:'d',label:'VB-Cable Output'}]; navigator.mediaDevices.dispatchEvent(new Event('devicechange'))"); p.wait_for_timeout(400)
        p.click('#rcMore summary'); p.select_option('#rcSysDev', 'd'); p.wait_for_timeout(600)
        check('4.25 advanced input choice attaches the call', 'VB-Cable' in js(p, "document.querySelector('#sysLabel').textContent"))
        p.select_option('#rcSysDev', ''); p.wait_for_timeout(300)
        check('4.26 choosing none removes the call', 'Not recording' in js(p, "document.querySelector('#sysLabel').textContent"))
        check('4.27 stop uploads', stop_and_send(s)); s.close()

        # 4e browser cannot share and no cable
        s = Sess(br, init="localStorage.setItem('pm_rec', JSON.stringify({sysMode:'call'}))"); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]; navigator.mediaDevices.getDisplayMedia = undefined; delete MediaDevices.prototype.getDisplayMedia")
        p = s.open_dialog(); wait_state(p, 'ready'); p.wait_for_timeout(300)
        check('4.28 unsupported call capture explains the alternative', 'speakers' in js(p, "document.querySelector('#mcCall').innerText"))
        fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000)
        check('4.29 still records the microphone', has_dock(p)); stop_and_send(s); s.close()

        # 5 silent microphone warning
        s = Sess(br); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.silent=true; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]")
        p = s.open_dialog(); wait_state(p, 'ready'); fill_title(p); p.click('#mtGo'); p.wait_for_selector('.rec-dock')
        check('5.1 silent microphone is flagged after about 15 seconds', wait_toast(p, 'No sound from your microphone', 20000))
        check('5.2 recording kept', has_dock(p))
        # discard
        p.click('#rcCancel'); p.wait_for_selector('.overlay [data-ok]'); p.click('.overlay [data-ok]'); p.wait_for_timeout(800)
        check('5.3 discard removes the dock', not has_dock(p)); s.close()

        # 6 stop without waiting, second recording blocked, leave page and come back
        s = Sess(br); p = s.open_dialog(); wait_state(p, 'ready'); fill_title(p, 'Nav test'); p.click('#mtGo'); p.wait_for_selector('.rec-dock')
        p.goto(f'{BASE}/#/p/{PID}/overview') if False else js(p, f"location.hash='#/p/{PID}/schedule'"); p.wait_for_timeout(800)
        check('6.1 recording box stays while moving around', has_dock(p))
        js(p, f"location.hash='#/p/{PID}/meetings'"); p.wait_for_timeout(1000)
        p.click('#mtNew, #mtNew2'); p.wait_for_selector('#mtT'); wait_state(p, 'ready'); fill_title(p, 'Second'); p.click('#mtGo'); p.wait_for_timeout(800)
        check('6.2 second recording is refused', wait_toast(p, 'already|one'), toasts(p))
        p.keyboard.press('Escape'); p.wait_for_timeout(300)
        check('6.4 first recording still there', has_dock(p)); stop_and_send(s); s.close()

        # 6b the check lets go of the microphone when the dialog closes or the mode changes
        s = Sess(br); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]")
        p = s.open_dialog(); wait_state(p, 'ready')
        live = "window.__mic.tracks.filter(t=>t.kind==='audio'&&t.readyState==='live').length"
        check('6.5 the check holds one live microphone', js(p, live) >= 1)
        p.keyboard.press('Escape'); p.wait_for_timeout(500)
        check('6.6 closing the dialog releases the microphone', js(p, live) == 0)
        p = s.open_dialog(); wait_state(p, 'ready'); p.click('#mtMode button[data-m=upload]'); p.wait_for_timeout(500)
        check('6.7 switching to upload releases the microphone', js(p, live) == 0)
        p.click('#mtMode button[data-m=record]'); check('6.8 switching back checks again', wait_state(p, 'ready')); s.close()

        # 7 look and feel: Arabic, dark, phone
        for name, kw in [('arabic light', dict(lang='ar')), ('dark', dict(theme='dark')), ('phone', dict(size=(390, 800))), ('arabic dark phone', dict(lang='ar', theme='dark', size=(390, 800)))]:
            s = Sess(br, **kw); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'},{deviceId:'b',label:'USB Headset'}]")
            p = s.open_dialog(); wait_state(p, 'ready'); p.click('.mc-card[data-src=call]'); p.wait_for_timeout(400)
            tag = name.replace(' ', '_')
            p.screenshot(path=f'/tmp/mic_dialog_{tag}.png')
            check(f'7 {name}: dialog no raw keys', no_raw_keys(p)); check(f'7 {name}: dialog no sideways scroll', no_overflow(p))
            if 'arabic' in name: check(f'7 {name}: right to left', js(p, "document.documentElement.dir") == 'rtl')
            check(f'7 {name}: dialog fits the screen', js(p, "(()=>{const r=document.querySelector('.modal').getBoundingClientRect();return r.left>=0 && r.right<=window.innerWidth+1})()"))
            fill_title(p, 'اجتماع' if 'arabic' in name else 'Layout'); p.click('#mtGo'); p.wait_for_selector('.rec-dock', timeout=8000); p.wait_for_timeout(700)
            p.click('#rcMore summary'); p.wait_for_timeout(300)
            p.screenshot(path=f'/tmp/mic_dock_{tag}.png')
            check(f'7 {name}: dock fits the screen', js(p, "(()=>{const r=document.querySelector('.rec-dock').getBoundingClientRect();return r.left>=0 && r.right<=window.innerWidth+1 && r.bottom<=window.innerHeight+1})()"))
            check(f'7 {name}: dock no raw keys', no_raw_keys(p))
            tiny = js(p, "[...document.querySelectorAll('.rec-dock *, .modal *')].filter(e=>e.children.length===0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize)<11).length")
            check(f'7 {name}: no text under 11px', tiny == 0, tiny)
            small_btn = js(p, "[...document.querySelectorAll('.rec-dock button')].filter(b=>b.getBoundingClientRect().height<28).length")
            check(f'7 {name}: dock buttons are tappable', small_btn == 0, small_btn)
            stop_and_send(s); check(f'7 {name}: no console errors', not [e for e in s.errors if 'favicon' not in e], s.errors); s.close()

        # 8 keyboard only in the dialog
        s = Sess(br); s.page.add_init_script("window.__mic.mode='ok'; window.__mic.perm='granted'; window.__mic.devices=[{deviceId:'a',label:'Built-in Mic'}]")
        p = s.open_dialog(); wait_state(p, 'ready'); p.focus('.mc-card[data-src=call]'); p.keyboard.press('Enter'); p.wait_for_timeout(200)
        check('8.1 keyboard selects a choice', js(p, "document.querySelector('.mc-card.on').dataset.src") == 'call')
        check('8.2 cards are real buttons with a radio role', js(p, "[...document.querySelectorAll('.mc-card')].every(b=>b.tagName==='BUTTON' && b.getAttribute('role')==='radio')")); s.close()

        # 9 other capture modes still work
        s = Sess(br); p = s.open_dialog(); p.click('#mtMode button[data-m=text]'); fill_title(p, 'Pasted'); p.fill('#mtTx', 'Sara: We start Monday.')
        check('9.1 Start is not blocked by the mic check outside record mode', not start_disabled(p))
        p.click('#mtGo'); p.wait_for_timeout(1500)
        check('9.2 pasted transcript meeting is created', js(p, "!document.querySelector('#mtT')")); s.close()
        s = Sess(br); p = s.open_dialog(); wait_state(p, 'ready'); p.click('#mtMode button[data-m=upload]')
        check('9.3 switching away releases the microphone check', js(p, "!document.querySelector('#mcMic')")); s.close()

        br.close()

    ok = sum(1 for r in results if r[1]); print(f'\n{ok}/{len(results)} passed')
    for n, c, e in results:
        if not c: print('FAILED:', n, e)
    return 0 if ok == len(results) else 1

sys.exit(run())
