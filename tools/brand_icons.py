# -*- coding: utf-8 -*-
"""يولّد brand.png (الدرع الشفاف) وأيقونات التطبيق من شعار «منجز المدرسي».
الاستخدام:  python3 brand_icons.py <شعار-شفاف.png> <مجلد-الموقع>"""
import sys, os
from PIL import Image, ImageDraw, ImageFilter
SRC, ROOT = sys.argv[1], sys.argv[2]
D1=(42,61,52); D0=(31,46,39)      # أخضر ياسميني داكن
im = Image.open(SRC).convert('RGBA')
bb = im.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
pad = 14
im = im.crop((max(bb[0]-pad,0), max(bb[1]-pad,0), min(bb[2]+pad,im.width), min(bb[3]+pad,im.height)))
# brand.png للشاشات
b = im.copy(); b.thumbnail((420,560), Image.LANCZOS); b.quantize(colors=200, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG).save(os.path.join(ROOT,'brand.png'), optimize=True)
def bg(size, round_=True):
    S=4; big=size*S
    g=Image.new('RGB',(big,big),D0)
    # توهّج خفيف في الأعلى
    px=Image.new('RGB',(big,big),D1); mask=Image.new('L',(big,big),0)
    ImageDraw.Draw(mask).ellipse([big*-.1,big*-.35,big*1.1,big*.75],fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(big*.18)); g.paste(px,mask=mask)
    g=g.convert('RGBA')
    if round_:
        m=Image.new('L',(big,big),0); ImageDraw.Draw(m).rounded_rectangle([0,0,big-1,big-1],radius=int(big*.2),fill=255)
        g.putalpha(m)
    return g
def icon(size, fill, round_=True):
    g=bg(size,round_); S=4; big=size*S
    h=int(big*fill); w=int(im.width*h/im.height)
    e=im.resize((w,h),Image.LANCZOS)
    g.alpha_composite(e,((big-w)//2,(big-h)//2+int(big*.01)))
    return g.resize((size,size),Image.LANCZOS)
ic=os.path.join(ROOT,'icons'); os.makedirs(ic,exist_ok=True)
icon(512,.80).save(ic+'/icon-512.png'); icon(192,.80).save(ic+'/icon-192.png')
icon(96,.80).save(ic+'/favicon-48.png') if False else icon(48,.84).save(ic+'/favicon-48.png')
icon(512,.58,round_=False).save(ic+'/maskable-512.png')          # منطقة آمنة ٨٠٪
a=icon(180,.62,round_=False).convert('RGB'); a.save(ic+'/apple-touch-icon.png')
# شارة الإشعارات (أحادية اللون بيضاء)
bd=Image.new('RGBA',(72,72),(0,0,0,0)); sh=im.getchannel('A').resize((int(72*.8*im.width/im.height),int(72*.8)),Image.LANCZOS)
wh=Image.new('RGBA',sh.size,(255,255,255,255)); wh.putalpha(sh); bd.alpha_composite(wh,((72-sh.width)//2,(72-sh.height)//2)); bd.save(ic+'/badge-72.png')
print('ok', b.size)
