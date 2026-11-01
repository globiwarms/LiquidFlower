#!/usr/bin/env python3
"""Builds app icon assets from the user's LiquidFlower logo (Downloads/LiquidFlower.png)."""
import os
from PIL import Image

SRC = r"C:\Users\arsen\Downloads\LiquidFlower.png"
OUT_DIR = r"C:\Users\arsen\OneDrive\Desktop\Projects\LiquidFlower\src-tauri\icons"
UI_APPICON = r"C:\Users\arsen\OneDrive\Desktop\Projects\LiquidFlower\ui\shared\appicon.png"

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    img = Image.open(SRC).convert("RGBA")

    # Trim transparent margins, keep a small breathing pad (~7%).
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    side = max(img.size)
    pad = int(side * 0.07)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.paste(img, (pad + (side - img.size[0]) // 2, pad + (side - img.size[1]) // 2), img)

    icon = canvas.resize((256, 256), Image.LANCZOS)
    icon.save(os.path.join(OUT_DIR, "icon.png"))
    icon.save(os.path.join(OUT_DIR, "icon.ico"), format="ICO",
              sizes=[(256, 256), (64, 64), (48, 48), (32, 32), (16, 16)])
    icon.save(UI_APPICON)
    print("OK:", OUT_DIR, "and", UI_APPICON)

if __name__ == "__main__":
    main()
