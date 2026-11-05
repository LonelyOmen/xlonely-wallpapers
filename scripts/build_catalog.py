#!/usr/bin/env python3
"""Build lightweight previews and catalog.json for the wallpaper gallery."""
from pathlib import Path
import colorsys, json, re, shutil, subprocess
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'wallpapers'
PREVIEWS = ROOT / 'previews'
SEED_FILE = ROOT / 'scripts' / 'seed-metadata.json'
COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'black']
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
VIDEO_EXTS = {'.mp4', '.webm', '.mov', '.mkv', '.avi'}

def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=False)

def video_info(path):
    if not shutil.which('ffprobe'):
        return None, None
    r = run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,r_frame_rate','-of','json',str(path)])
    try:
        s = json.loads(r.stdout)['streams'][0]
        w,h = s.get('width'), s.get('height')
        rate=s.get('avg_frame_rate') or s.get('r_frame_rate') or '0/1'
        a,b=map(int,rate.split('/'))
        fps=round(a/b) if b else None
        return (f'{w}×{h}' if w and h else None), fps
    except Exception:
        return None, None

def dimensions(path):
    try:
        with Image.open(path) as im:
            return f'{im.width}×{im.height}'
    except Exception:
        return None

def make_preview(src, out, live=False):
    out.parent.mkdir(parents=True, exist_ok=True)
    if live:
        # Reuse an existing generated poster, otherwise extract one with ffmpeg.
        if out.exists(): return
        if shutil.which('ffmpeg'):
            r=run(['ffmpeg','-hide_banner','-loglevel','error','-ss','1','-i',str(src),'-frames:v','1','-vf','scale=480:300:force_original_aspect_ratio=decrease','-y',str(out)])
            if r.returncode == 0 and out.exists(): return
        placeholder(out)
        return
    try:
        with Image.open(src) as im:
            im.seek(0)
            im=ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((480,300),Image.Resampling.LANCZOS)
            im.save(out,format='WEBP',quality=76,method=5)
    except Exception:
        placeholder(out)

def placeholder(out):
    im=Image.new('RGB',(480,300),(30,27,43)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((190,105,290,195),radius=18,outline=(157,139,210),width=4)
    d.ellipse((211,125,229,143),fill=(157,139,210))
    d.polygon([(200,180),(230,148),(248,166),(262,153),(280,180)],fill=(115,99,162))
    im.save(out,format='WEBP',quality=72)

def detect_colors(preview):
    try:
        with Image.open(preview) as im:
            pixels=list(im.convert('RGB').resize((1,1)).getpixel((0,0)))
        r,g,b=(v/255 for v in pixels)
        mx,mn=max(r,g,b),min(r,g,b)
        if mx < .18: return ['black']
        if mx-mn < .13: return ['white'] if mx > .78 else ['black']
        h,s,v=colorsys.rgb_to_hsv(r,g,b)
        if v < .27: return ['black']
        hue=h*360
        if hue < 15 or hue >= 345: return ['red']
        if hue < 43: return ['orange']
        if hue < 68: return ['yellow']
        if hue < 160: return ['green']
        if hue < 255: return ['blue']
        if hue < 290: return ['purple']
        return ['pink']
    except Exception:
        return []

def animated_gif(path):
    if path.suffix.lower() != '.gif': return False
    try:
        with Image.open(path) as im: return getattr(im, 'n_frames', 1) > 1
    except Exception:
        return False

def nice_name(name):
    text=re.sub(r'[_-]+',' ',Path(name).stem)
    text=re.sub(r'\s+',' ',text).strip()
    return text[:1].upper()+text[1:] if text else name

def main():
    seeds=json.loads(SEED_FILE.read_text()) if SEED_FILE.exists() else {}
    catalog=[]
    for kind in ('still','live'):
        folder=ASSETS/kind
        outfolder=PREVIEWS/kind
        for src in sorted(folder.iterdir(),key=lambda p:p.name.casefold()):
            if not src.is_file() or src.suffix.lower() not in (IMAGE_EXTS|VIDEO_EXTS): continue
            is_video=kind=='live' or src.suffix.lower() in VIDEO_EXTS
            item_kind='live' if is_video or animated_gif(src) else kind
            preview_name=src.name+'.jpg' if is_video else src.stem+'.webp'
            preview=outfolder/preview_name
            make_preview(src,preview,live=is_video)
            seed=seeds.get(f'{kind}/{src.name}',{})
            info=seed.get('info','')
            dims, fps = video_info(src) if is_video else (dimensions(src),None)
            if not dims:
                m=re.search(r'(\d{3,5})[x×](\d{3,5})',info)
                dims=f'{m.group(1)}×{m.group(2)}' if m else None
            if not fps:
                m=re.search(r'(\d+)\s*FPS',info,re.I)
                fps=int(m.group(1)) if m else None
            colors=seed.get('colors') or ([seed['color']] if seed.get('color') else detect_colors(preview))
            colors=[c.lower() for c in colors if c.lower() in COLORS]
            catalog.append({'name':nice_name(src.name),'file':f'wallpapers/{kind}/{src.name}','preview':f'previews/{kind}/{preview_name}',
                'kind':item_kind,'format':src.suffix.lstrip('.').upper(),'resolution':dims,'fps':fps,'colors':colors,'bytes':src.stat().st_size})
    (ROOT/'catalog.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n')
    print(f'Catalogued {len(catalog)} wallpapers.')

if __name__=='__main__': main()
