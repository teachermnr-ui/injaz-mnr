from PIL import Image, ImageDraw
GREEN=(63,102,89); SHADOW=(43,72,62); GOLD=(201,154,59); WHITE=(255,255,255)
S=4  # supersample
def draw_mark(d, ox, oy, k):
    # document shadow + document
    def R(x0,y0,x1,y1,r,fill): d.rounded_rectangle([ (ox+x0*k)*S,(oy+y0*k)*S,(ox+x1*k)*S,(oy+y1*k)*S ], radius=r*k*S, fill=fill)
    R(120,92,408,436,22,SHADOW)
    R(112,84,400,428,22,WHITE)
    R(164,146,348,160,3,GOLD)
    R(216,190,348,204,3,GOLD)
    pts=[(180,295),(236,352),(336,238)]
    P=[((ox+x*k)*S,(oy+y*k)*S) for x,y in pts]
    w=int(38*k*S)
    d.line(P, fill=GREEN, width=w, joint='curve')
    for x,y in P: d.ellipse([x-w/2,y-w/2,x+w/2,y+w/2], fill=GREEN)
def make(size, maskable=False, rgb=False):
    big=size*S
    im=Image.new('RGBA',(big,big),(0,0,0,0)); d=ImageDraw.Draw(im)
    k=size/512
    if maskable:
        d.rectangle([0,0,big,big], fill=GREEN)
        # mark scaled 0.8 around center
        kk=k*0.8; off=(512-512*0.8)/2*k
        draw_mark(d, off, off, kk)
    else:
        d.rounded_rectangle([0,0,big-1,big-1], radius=int(100*k*S), fill=GREEN)
        draw_mark(d, 0, 0, k)
    im=im.resize((size,size), Image.LANCZOS)
    if rgb:
        bg=Image.new('RGB',(size,size),GREEN); bg.paste(im,mask=im.split()[3]); im=bg
    return im
make(512).save('icons/icon-512.png')
make(192).save('icons/icon-192.png')
make(48).save('icons/favicon-48.png')
make(512, maskable=True).save('icons/maskable-512.png')
# apple: full square (iOS rounds corners itself)
im=make(180, maskable=True, rgb=True); im.save('icons/apple-touch-icon.png')
print('ok')
