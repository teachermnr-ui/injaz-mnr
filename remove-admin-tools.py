# -*- coding: utf-8 -*-
"""
إزالة كل إضافات «الأدوات الإدارية» (ومنها بناء الجدول المدرسي) من الملفات، وإرجاعها كما كانت قبل الإضافة.

الاستخدام:  python remove-admin-tools.py  <مجلد الملفات>
- يحذف كل ما بين علامتي البداية والنهاية (يشمل العلامتين):
      /* [ADMIN-TOOLS:BEGIN] */ … /* [ADMIN-TOOLS:END] */        (JS / CSS / القواعد)
      <!-- [ADMIN-TOOLS:BEGIN] --> … <!-- [ADMIN-TOOLS:END] -->  (HTML)
- كل سطر معدَّل مسبوق بسطر:
      /* [ADMIN-TOOLS:MOD] ORIG: <الأصل> */    أو    <!-- [ADMIN-TOOLS:MOD] ORIG: <الأصل> -->
  يُعاد إلى أصله (بنفس المسافة البادئة).
- لا يحذف ملفات. الملفات المستقلة (timetable.html، timetable-engine.js) تُحذف يدويًا حسب ADMIN-TOOLS-LOG.md.
"""
import re, sys, os

PAIRS = [
    ('/* [ADMIN-TOOLS:BEGIN] */', '/* [ADMIN-TOOLS:END] */'),
    ('<!-- [ADMIN-TOOLS:BEGIN] -->', '<!-- [ADMIN-TOOLS:END] -->'),
]
MOD_JS = re.compile(r'^([ \t]*)/\* \[ADMIN-TOOLS:MOD\] ORIG: (.*) \*/\n.*\n', re.M)
MOD_HTML = re.compile(r'^([ \t]*)<!-- \[ADMIN-TOOLS:MOD\] ORIG: (.*) -->\n.*\n', re.M)
TARGETS = ['index.html', 'omr.html', 'worksheets.html', 'firestore.rules', 'index.js',
           'student-worksheets.html', 'student-solve.html']

def strip(text):
    for begin, end in PAIRS:
        while begin in text:
            i = text.index(begin)
            # من بداية السطر الذي يحوي علامة البداية
            ls = text.rfind('\n', 0, i) + 1
            if text[ls:i].strip() == '':
                i = ls
            j = text.index(end, i) + len(end)
            if j < len(text) and text[j] == '\n':
                j += 1
            text = text[:i] + text[j:]
    text = MOD_JS.sub(lambda m: m.group(1) + m.group(2) + '\n', text)
    text = MOD_HTML.sub(lambda m: m.group(1) + m.group(2) + '\n', text)
    return text

def main(folder):
    for name in TARGETS:
        p = os.path.join(folder, name)
        if not os.path.exists(p):
            continue
        src = open(p, encoding='utf-8').read()
        if 'ADMIN-TOOLS' not in src:
            continue
        out = strip(src)
        assert 'ADMIN-TOOLS' not in out, 'بقيت علامة غير مكتملة في ' + name
        open(p, 'w', encoding='utf-8').write(out)
        print('نُظِّف:', name)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
