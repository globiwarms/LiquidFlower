#!/usr/bin/env python3
"""Draws the LiquidFlower app icon (glass flower) -> icon.png + icon.ico."""
import math, os
from PIL import Image, ImageDraw

OUT_DIR = r"C:\Users\arsen\OneDrive\Desktop\Projects\LiquidFlower\src-tauri\icons"
S = 256

def build(size):
    # Hi-res canvas, downsample for smooth edges.
    k = 4
    W = size * k
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = W / 2
    r_ring = W * 0.245     # petal center distance
    r_petal = W * 0.165    # petal radius
    r_center = W * 0.105   # center circle radius
    rim_w = W // 90

    # 6 translucent glass petals
    for i in range(6):
        a = math.radians(-90 + i * 60)
        px = c + math.cos(a) * r_ring
        py = c + math.sin(a) * r_ring
        box = [px - r_petal, py - r_petal, px + r_petal, py + r_petal]
        d.ellipse(box, fill=(226, 238, 252, 78))
        d.ellipse(box, outline=(255, 255, 255, 215), width=rim_w)

    # overlaps read as thicker glass: re-stroke union seams subtly
    for i in range(6):
        a = math.radians(-90 + i * 60)
        px = c + math.cos(a) * r_ring
        py = c + math.sin(a) * r_ring
        box = [px - r_petal, py - r_petal, px + r_petal, py + r_petal]
        d.ellipse(box, outline=(255, 255, 255, 215), width=rim_w)

    # center
    d.ellipse([c - r_center, c - r_center, c + r_center, c + r_center],
              fill=(240, 247, 255, 235), outline=(255, 255, 255, 255), width=rim_w)

    return img.resize((size, size), Image.LANCZOS)

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    icon = build(S)
    icon.save(os.path.join(OUT_DIR, "icon.png"))
    icon.save(os.path.join(OUT_DIR, "icon.ico"), format="ICO",
              sizes=[(256, 256), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("OK:", OUT_DIR)

if __name__ == "__main__":
    main()
