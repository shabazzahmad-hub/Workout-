"""Make the spoken audio for one lesson page, and write its timing map into the page.

Run after tts_setup.sh, with the Python it installed:

    TTS=$(bash legal-curriculum/tools/tts_setup.sh)
    "$TTS/venv/bin/python" -I legal-curriculum/tools/make_audio.py --tts-home "$TTS" \
        legal-curriculum/lessons/NN-slug.html

It writes legal-curriculum/lessons/NN-slug.mp3 beside the page. Publish that file with the page,
under the name lesson.mp3 (the page's <audio> element points there).

The page reads the same blocks in the same order: the <h1> in <header>, then every h2, p, li and
summary inside <article id="lesson"> that is not inside another of those, skipping text inside
class="tag" and blocks left with no text. The timing map holds the start second of each block, so
the page can highlight what is being read. If the two lists ever disagree in length, the page
plays the audio without highlighting rather than highlighting the wrong line.
"""
import argparse, html, json, os, re, subprocess, sys, tempfile
from html.parser import HTMLParser

import numpy as np

BLOCKS = {"h2", "p", "li", "summary"}
VOID = {"br", "img", "hr", "meta", "link", "input", "source", "wbr"}
PAUSE = {"h1": 0.9, "h2": 0.7, "p": 0.45, "li": 0.35, "summary": 0.4}


class Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # open tags: (tag, is_tag_span)
        self.in_header = 0
        self.in_article = 0
        self.cur = None          # [tag, depth, parts]
        self.out = []

    def _tagged(self):
        return any(t for _, t in self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in VOID:
            return
        cls = (a.get("class") or "").split()
        self.stack.append((tag, "tag" in cls))
        if tag == "header":
            self.in_header += 1
        if tag == "article" and a.get("id") == "lesson":
            self.in_article = len(self.stack)
        if self.cur is None:
            if (tag == "h1" and self.in_header) or (tag in BLOCKS and self.in_article):
                self.cur = [tag, len(self.stack), []]

    def handle_endtag(self, tag):
        if tag in VOID or not self.stack:
            return
        depth = len(self.stack)
        if self.cur is not None and depth == self.cur[1]:
            text = re.sub(r"\s+", " ", "".join(self.cur[2])).strip()
            if text:
                self.out.append((self.cur[0], text))
            self.cur = None
        if self.in_article and depth == self.in_article:
            self.in_article = 0
        if tag == "header":
            self.in_header -= 1
        self.stack.pop()

    def handle_data(self, data):
        if self.cur is not None and not self._tagged():
            self.cur[2].append(data)


def spoken(tag, text):
    """Text as it should be said. The highlighted block keeps its printed text."""
    if tag == "summary" and "model answer" in text.lower():
        return "Model answer."
    t = text.replace("·", ",").replace("…", "...").replace("→", " to ")
    t = re.sub(r"\[([^\]]+)\]", r", \1,", t)          # bracketed tags read as an aside
    t = re.sub(r"(?<=\d),(?=\d{3}\b)", "", t)          # 400,000 -> 400000
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--tts-home", required=True)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--bitrate", default="48k")
    a = ap.parse_args()

    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(a.tts_home, "model.onnx"), os.path.join(a.tts_home, "voices.npz"))

    page = open(a.page, encoding="utf-8").read()
    p = Blocks()
    p.feed(page)
    if not p.out:
        sys.exit("no readable blocks found in " + a.page)

    sr = 24000
    pieces, starts, t = [], [], 0.0
    for tag, text in p.out:
        audio, rate = k.create(spoken(tag, text), voice=a.voice, speed=a.speed, lang="en-us")
        assert rate == sr
        starts.append(round(t, 2))
        gap = np.zeros(int(sr * PAUSE.get(tag, 0.4)), dtype=np.float32)
        pieces += [audio.astype(np.float32), gap]
        t += (len(audio) + len(gap)) / sr
    wave = np.concatenate(pieces)
    peak = float(np.abs(wave).max()) or 1.0
    wave = (wave / peak * 0.89).astype("<f4")

    mp3 = os.path.splitext(a.page)[0] + ".mp3"
    with tempfile.NamedTemporaryFile(suffix=".f32") as raw:
        raw.write(wave.tobytes())
        raw.flush()
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1",
                        "-i", raw.name, "-codec:a", "libmp3lame", "-b:a", a.bitrate, mp3], check=True)

    amap = json.dumps({"voice": a.voice, "seconds": round(t, 1), "blocks": len(starts), "starts": starts})
    tag = '<script type="application/json" id="audio-map">' + amap + "</script>"
    new, n = re.subn(r'<script type="application/json" id="audio-map">.*?</script>', lambda _: tag, page, flags=re.S)
    if n != 1:
        sys.exit('the page has no <script type="application/json" id="audio-map"> placeholder')
    open(a.page, "w", encoding="utf-8").write(new)
    print(f"{mp3}: {t/60:.1f} min, {len(starts)} blocks, {os.path.getsize(mp3)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
