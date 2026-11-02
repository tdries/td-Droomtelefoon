#!/usr/bin/env python3
# Droomtelefoon voice server. GET /tts?engine=piper|qwen|omnivoice&text=...&g=f|m&slot=N
# Streams raw 16-bit mono PCM while the engine renders (header X-Sample-Rate), so the phone can start talking at the
# first chunk. Add &format=wav for one whole WAV (handy with curl). Engines load on first use; pass engine names on the
# command line to preload. VOICE_PORT (default 8792); server.js proxies /tts here.
import glob, io, json, os, re, sys, threading, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('VOICE_PORT', 8792))
LOCKS = {e: threading.Lock() for e in ('piper', 'qwen', 'omnivoice')}  # one line per engine at a time; the GPU engines are not reentrant
ENG = {}
SENT = re.compile(r'(?<=[.!?…])\s+')
QWEN_MODEL, OMNI_MODEL = 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit', 'mlx-community/OmniVoice-bf16'

def eng(name, loader):
    if name not in ENG:
        t = time.perf_counter(); ENG[name] = loader(); print(f'loaded {name} in {time.perf_counter() - t:.1f}s', flush=True)
    return ENG[name]

def load_model(repo):
    from mlx_audio.tts.utils import load_model as lm
    return lm(repo)

def sentences(text): return [p for p in (s.strip() for s in SENT.split(text)) if p] or [text]
def pcm(x): return (np.clip(np.asarray(x, dtype=np.float32).reshape(-1), -1, 1) * 32767).astype('<i2').tobytes()

# Each engine returns (voice label, generator of (float audio, sample rate)); the generator does the work lazily.
# ---- Piper: slot 0 is the Flemish voice (Nathalie / RDH), the rest are MLS speakers of the same gender; one chunk per sentence ----
def piper_load():
    from piper import PiperVoice
    esp = glob.glob(os.path.join(HERE, '.venv-voice', '**', 'espeak-ng-data'), recursive=True)
    kw = {'espeak_data_dir': esp[0]} if esp else {}
    voices = {n: PiperVoice.load(os.path.join(HERE, 'voices', 'piper', n + '.onnx'), **kw) for n in ('nl_BE-nathalie-medium', 'nl_BE-rdh-medium', 'nl_NL-mls-medium')}
    genders = json.load(open(os.path.join(HERE, 'voices', 'mls-genders.json')))
    pools = {g: [('nl_BE-nathalie-medium' if g == 'f' else 'nl_BE-rdh-medium', None)] + [('nl_NL-mls-medium', int(k)) for k, o in genders.items() if o['g'] == g] for g in 'fm'}
    return voices, pools

def piper(text, g, slot):
    from piper import SynthesisConfig
    voices, pools = eng('piper', piper_load)
    name, spk = pools[g][slot % len(pools[g])]
    cfg = SynthesisConfig(speaker_id=spk) if spk is not None else SynthesisConfig()
    return (f'{name}#{spk}' if spk is not None else name), ((c.audio_float_array, c.sample_rate) for c in voices[name].synthesize(text, cfg))

# ---- Qwen3-TTS (no official Dutch; preset speakers): native streaming, a chunk every ~0.3 s of speech ----
QWEN = {'f': ['Vivian', 'Serena'], 'm': ['Ryan', 'Aiden', 'Dylan', 'Eric', 'Uncle_Fu']}
def qwen(text, g, slot):
    m = eng('qwen', lambda: load_model(QWEN_MODEL)); spk = QWEN[g][slot % len(QWEN[g])]
    return spk, ((np.array(r.audio), r.sample_rate) for r in m.generate_custom_voice(text=text, speaker=spk, language='auto', stream=True, streaming_interval=0.32))

# ---- OmniVoice: a diffusion model, so it streams per sentence. Sentence 1 is designed from the slot's description,
# the following sentences clone sentence 1 so the character keeps one voice within the line ----
OMNI = {'f': ['female, high pitch', 'female, young adult', 'female, low pitch', 'female, elderly'], 'm': ['male, low pitch', 'male, young adult', 'male, high pitch', 'male, elderly']}
def omnivoice(text, g, slot, steps=32):
    import mlx.core as mx
    m = eng('omnivoice', lambda: load_model(OMNI_MODEL)); instruct = OMNI[g][slot % len(OMNI[g])]
    def gen():
        ref = None
        for s in sentences(text):
            mx.random.seed(1000 * (g == 'f') + slot)
            try: res = list(m.generate(text=s, language='dutch', num_steps=steps, ref_audio=ref[0], ref_text=ref[1])) if ref else None
            except Exception as e: print(f'omnivoice self-clone failed, falling back to design: {e}', flush=True); res = None
            if res is None: res = list(m.generate(text=s, language='dutch', num_steps=steps, instruct=instruct))
            for r in res:
                a = np.array(r.audio); yield a, r.sample_rate
                if ref is None: ref = (a, s)
    return instruct, gen()

ENGINES = {'piper': piper, 'qwen': qwen, 'omnivoice': omnivoice}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, status, body, ctype='text/plain', extra={}):
        self.send_response(status); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        for k, v in extra.items(): self.send_header(k, str(v))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == '/health': return self.reply(200, json.dumps({'loaded': list(ENG)}).encode(), 'application/json')
        if u.path not in ('/tts', '/warm'): return self.reply(404, b'not found')
        engine = q.get('engine', 'piper'); fn = ENGINES.get(engine)
        if not fn: return self.reply(400, b'onbekende engine')
        text, g, slot = q.get('text', '').strip() or ('Hallo.' if u.path == '/warm' else ''), ('f' if q.get('g') == 'f' else 'm'), int(q.get('slot', 0) or 0)
        if not text: return self.reply(400, b'text ontbreekt')
        kw = {'steps': int(q['steps'])} if fn is omnivoice and q.get('steps') else {}
        t0 = time.perf_counter()
        with LOCKS[engine]:
            try: voice, gen = fn(text, g, slot, **kw); a0, sr = next(gen)
            except Exception as e:
                print(f'{engine} failed: {type(e).__name__}: {e}', flush=True); return self.reply(500, f'{type(e).__name__}: {e}'.encode())
            first = round((time.perf_counter() - t0) * 1000); n = len(a0)
            if u.path == '/warm' or q.get('format') == 'wav':
                parts = [a0] + [a for a, _ in gen]; audio = np.concatenate(parts); ms = round((time.perf_counter() - t0) * 1000)
                b = io.BytesIO()
                with wave.open(b, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(sr)); w.writeframes(pcm(audio))
                print(f'{engine} {voice} first {first} ms, all {ms} ms for {len(audio) / sr:.1f}s "{text[:40]}"', flush=True)
                return self.reply(200, b.getvalue(), 'audio/wav', {'X-Synth-Ms': ms, 'X-First-Ms': first, 'X-Voice': voice, 'X-Sample-Rate': int(sr), 'Cache-Control': 'no-store'})
            self.send_response(200)
            for k, v in {'Content-Type': 'audio/pcm', 'X-Sample-Rate': int(sr), 'X-Voice': voice, 'X-First-Ms': first, 'Cache-Control': 'no-store', 'Connection': 'close'}.items(): self.send_header(k, str(v))
            self.end_headers()
            try:
                self.wfile.write(pcm(a0)); self.wfile.flush()
                for a, _ in gen: self.wfile.write(pcm(a)); self.wfile.flush(); n += len(a)
            except (BrokenPipeError, ConnectionResetError): print(f'{engine}: client hung up', flush=True)
            except Exception as e: print(f'{engine} failed mid-stream: {type(e).__name__}: {e}', flush=True)
        print(f'{engine} {voice} first {first} ms, all {round((time.perf_counter() - t0) * 1000)} ms for {n / sr:.1f}s "{text[:40]}"', flush=True)

if __name__ == '__main__':
    for e in sys.argv[1:]: eng(e, {'piper': piper_load, 'qwen': lambda: load_model(QWEN_MODEL), 'omnivoice': lambda: load_model(OMNI_MODEL)}[e])
    print(f'voice server on http://127.0.0.1:{PORT}  (GET /tts?engine=piper|qwen|omnivoice&text=...&g=f|m&slot=0[&format=wav])', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
