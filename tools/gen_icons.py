#!/usr/bin/env python3
"""Generates ui/shared/icons.js from the bundled lucide icon set."""
import os, re, json, sys

SRC = r"C:\Users\arsen\.zcode\skills\lucide-icons\references\icons"
OUT = r"C:\Users\arsen\OneDrive\Desktop\Projects\LiquidFlower\ui\shared\icons.js"

ICONS = [
    # petal actions
    "mic", "mic-off", "volume-1", "volume-2", "volume-x", "play", "pause",
    "skip-forward", "skip-back", "shuffle", "repeat", "moon-star", "power",
    "link", "external-link", "app-window", "minimize", "picture-in-picture-2",
    # general picker set
    "camera", "image", "folder", "folder-open", "file", "terminal", "code",
    "gamepad-2", "monitor", "smartphone", "mail", "message-circle", "calendar",
    "clock", "calculator", "search", "settings", "user", "wifi", "bluetooth",
    "battery-charging", "sun", "cloud", "zap", "star", "heart", "bell",
    "bookmark", "download", "upload", "trash-2", "pencil", "plus", "check",
    "x", "layers", "layout-grid", "palette", "gem", "sparkles",
    "wand-sparkles", "flower-2", "keyboard", "mouse-pointer-click", "cpu",
    "globe", "music-4", "headphones", "house", "send", "refresh-cw", "eye",
    "lock",
]

def inner_svg(path):
    with open(path, "r", encoding="utf-8") as f:
        s = f.read()
    m = re.search(r"<svg[^>]*>(.*)</svg>", s, re.S)
    if not m:
        return None
    inner = m.group(1).strip()
    # normalize whitespace
    inner = re.sub(r"\s+", " ", inner)
    return inner

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = {}
    missing = []
    for name in ICONS:
        p = os.path.join(SRC, name + ".svg")
        if not os.path.exists(p):
            missing.append(name)
            continue
        inner = inner_svg(p)
        if inner:
            data[name] = inner
    if missing:
        print("MISSING:", ", ".join(missing))
        if len(missing) > 3:
            sys.exit(1)
    js = (
        "// Generated from the Lucide icon set (ISC license) - lucide.dev\n"
        "const LUCIDE = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
        "function lucideIcon(name, size = 24, color = 'currentColor', stroke = 2) {\n"
        "  const body = LUCIDE[name] || LUCIDE['sparkles'] || '';\n"
        "  return `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${size}\" height=\"${size}\" viewBox=\"0 0 24 24\" "
        "fill=\"none\" stroke=\"${color}\" stroke-width=\"${stroke}\" stroke-linecap=\"round\" "
        "stroke-linejoin=\"round\">${body}</svg>`;\n"
        "}\n"
        "if (typeof window !== 'undefined') window.LUCIDE = LUCIDE, window.lucideIcon = lucideIcon;\n"
    )
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"OK: {len(data)} icons -> {OUT}")

if __name__ == "__main__":
    main()
