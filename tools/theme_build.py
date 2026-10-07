# -*- coding: utf-8 -*-
"""
بناء طبقة الألوان في theme.css:
1) يحوّل كل لون ست‑عشري مكتوب داخل تصريح لون (background / color / border / outline)
   في صفحات الموقع إلى متغيّر بقيمة احتياطية مطابقة:  #fff  ←  var(--bg-ffffff,#fff)
   فيبقى الشكل الفاتح كما هو حرفيًا (المتغيّر غير معرَّف = القيمة الأصلية).
2) يولّد في theme.css قيم هذه المتغيّرات لـ: الياسمين الفاتح، والداكن للمظهرين.
التشغيل:  python3 theme_build.py <مجلد الموقع>     (آمن للتكرار)
"""
import re, sys, os, colorsys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
TARGETS = ['index.html','omr.html','worksheets.html','myday.html','circulars.html','duty.html','visits.html',
           'holidays.html','myschedule.html','timetable.html','student-worksheets.html','student-solve.html']

PROP = re.compile(r'(?<![\w-])(background-color|background|color|border-(?:top|bottom|left|right)-color|border-color|'
                  r'border-(?:top|bottom|left|right)|border|outline-color|outline)(\s*:\s*)([^;"\'`}\n<>{]*)', re.I)
HEX = re.compile(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])')
KIND = lambda p: 'bg' if p.lower().startswith('background') else ('fg' if p.lower() == 'color' else 'bd')

def norm(h):
    h = h.lower()
    return ''.join(c*2 for c in h) if len(h) == 3 else h

FOUND = {}   # (kind, hex6) -> count

def tokenize(text):
    def prop_sub(m):
        kind = KIND(m.group(1)); val = m.group(3)
        out = []; last = 0
        for h in HEX.finditer(val):
            before = val[:h.start()]
            if re.search(r'var\(--(?:bg|fg|bd)-[0-9a-f]{6},$', before):   # مُحوَّل سابقًا
                FOUND[(kind, norm(h.group(1)))] = FOUND.get((kind, norm(h.group(1))), 0) + 1
                continue
            hx = norm(h.group(1))
            FOUND[(kind, hx)] = FOUND.get((kind, hx), 0) + 1
            out.append(val[last:h.start()]); out.append('var(--%s-%s,%s)' % (kind, hx, h.group(0))); last = h.end()
        out.append(val[last:])
        return m.group(1) + m.group(2) + ''.join(out)
    return PROP.sub(prop_sub, text)

# ---------------- ألوان ----------------
def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def hexs(r, g, b): return '#%02x%02x%02x' % tuple(max(0, min(255, round(x*255))) for x in (r, g, b))
def hls(h): r, g, b = rgb(h); return colorsys.rgb_to_hls(r, g, b)
def from_hls(H, L, S): return hexs(*colorsys.hls_to_rgb(H % 1, max(0, min(1, L)), max(0, min(1, S))))
def lum(h):
    def c(x): return x/12.92 if x <= 0.03928 else ((x+0.055)/1.055)**2.4
    r, g, b = rgb(h); return 0.2126*c(r) + 0.7152*c(g) + 0.0722*c(b)
def contrast(a, b):
    la, lb = lum(a), lum(b); return (max(la, lb)+0.05)/(min(la, lb)+0.05)

# ألوان الأساس الصريحة: الأخضر المزرق ← أخضر الياسمين
JAS_ANCHORS = {
    '0f766e':'#3f6659', '0b5a54':'#325145', '0b7a63':'#3f6659', '0d9488':'#4a7a69', '0e9c8c':'#4a7a69',
    '23b1a4':'#6f9a88', '1fc3a6':'#6f9a88', '197a44':'#3f6659', 'e6f2f0':'#eff3e9', 'eef6f4':'#f1f5ec',
    'd5ece9':'#e8efe0', 'eef4f3':'#eff3e9', 'f4f7f6':'#f7f9f4', 'f6f8f7':'#f7f9f4', 'd8e2e0':'#e1e9da',
    'e6f3f1':'#edf2e6', 'e5f6f3':'#edf2e6', 'eef6f5':'#f0f4ec', 'f7fbfa':'#f8faf5', 'f7faf9':'#f8faf5',
    'f4f8f7':'#f6f8f2', 'eef2f1':'#eef2ea', 'e3ecea':'#e4ebdc', 'cfdcd9':'#d3ddcb', 'fcfdfd':'#fcfdfa',
    '15242b':'#23312b', '5b6f76':'#5f6e63',
}
TEAL_H = (160/360, 190/360)

def jasmine(hx):
    if hx in JAS_ANCHORS: return JAS_ANCHORS[hx]
    H, L, S = hls(hx)
    if TEAL_H[0] <= H <= TEAL_H[1] and S > 0.12:
        return from_hls(152/360, L, max(0.12, S*0.38) if L > 0.85 else S*0.38)
    return '#' + hx

SURF = {
    'base':    {'bg':'#0b1416', 's1':'#13201f', 's2':'#1a2b2a', 's3':'#22302e', 'ink':'#e6eeed', 'muted':'#97aaa8', 'line':'#26383a'},
    'jasmine': {'bg':'#0f1411', 's1':'#161d18', 's2':'#1d2620', 's3':'#252f28', 'ink':'#e7ede5', 'muted':'#9aa79d', 'line':'#2a352e'},
}

def dark(hx, kind, th):
    sf = SURF[th]
    src = jasmine(hx)[1:] if th == 'jasmine' else hx
    H, L, S = hls(src)
    if kind == 'bg':
        if L >= 0.80:
            if S < 0.14 or L >= 0.985:
                return sf['s1'] if L >= 0.97 else (sf['s2'] if L >= 0.90 else sf['s3'])
            return from_hls(H, 0.17, min(S, 0.55)*0.55)
        if L <= 0.12: return sf['s2']           # خلفيات شبه سوداء (تنبيهات منبثقة) تبقى داكنة مميَّزة
        return '#' + src
    if kind == 'fg':
        if L >= 0.88: return '#' + src         # نص أبيض فوق أزرار ملوّنة
        if L < 0.55:
            if S < 0.16: return sf['ink'] if L < 0.30 else sf['muted']
            out = from_hls(H, 0.72, min(1, S*0.9))
            return out
        return '#' + src
    # bd
    if L >= 0.75:
        return sf['line'] if S < 0.16 else from_hls(H, 0.27, min(S, 0.5)*0.6)
    if L < 0.30 and S < 0.2: return '#55666a' if th == 'base' else '#56635a'
    return '#' + src

def css_block(sel, pairs):
    if not pairs: return ''
    body = '\n'.join('  %s:%s;' % (k, v) for k, v in pairs)
    return '%s{\n%s\n}\n' % (sel, body)

def main():
    for name in TARGETS:
        p = os.path.join(ROOT, name)
        if not os.path.exists(p): continue
        src = open(p, encoding='utf-8').read()
        out = tokenize(src)
        if out != src:
            open(p, 'w', encoding='utf-8').write(out)
        print('%-24s %d' % (name, sum(1 for _ in re.finditer(r'var\(--(?:bg|fg|bd)-[0-9a-f]{6},', out))))
    keys = sorted(FOUND)
    jl = [('--%s-%s' % (k, h), jasmine(h)) for k, h in keys if jasmine(h) != '#'+h]
    bd = [('--%s-%s' % (k, h), dark(h, k, 'base')) for k, h in keys if dark(h, k, 'base') != '#'+h]
    jd = [('--%s-%s' % (k, h), dark(h, k, 'jasmine')) for k, h in keys if dark(h, k, 'jasmine') != '#'+h]
    allv = sorted(set(['--%s-%s' % (k, h) for k, h in keys]))
    gen = ['/* ===== [GENERATED] ألوان الصفحات المحوَّلة — يولّدها tools/theme_build.py ولا تُعدَّل يدويًا ===== */\n']
    gen.append(css_block('html.t-jasmine', jl))
    gen.append('@media screen{\n')
    gen.append(css_block('html.t-base.dark', bd))
    gen.append(css_block('html.t-jasmine.dark', jd))
    # مناطق «ورق» تبقى فاتحة دائمًا (معاينة الطباعة/بطاقة الإجابة)
    gen.append(css_block('html.dark :is(#sheetHost, .ij-paper, .pagewrap, img, canvas)', [(v, 'initial') for v in allv] + [
        ('--surface','#fff'),('--white','#fff'),('--ink','#15242b'),('--muted','#5b6f76'),('--line','#d8e2e0'),
        ('--surface-2','#eef4f3'),('--paper','#fff'),('--bg','#fff'),('color-scheme','light')]))
    gen.append('}\n/* ===== [/GENERATED] ===== */\n')
    tp = os.path.join(ROOT, 'theme.css')
    css = open(tp, encoding='utf-8').read()
    a = css.index('/* ===== [GENERATED]'); b = css.index('/* ===== [/GENERATED] ===== */') + len('/* ===== [/GENERATED] ===== */\n')
    css = css[:a] + ''.join(gen) + css[b:]
    open(tp, 'w', encoding='utf-8').write(css)
    print('tokens:', len(keys), 'jasmine:', len(jl), 'base-dark:', len(bd), 'jas-dark:', len(jd))

if __name__ == '__main__':
    main()
