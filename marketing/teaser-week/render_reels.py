import subprocess, os, sys
SRC = "/root/.claude/uploads/3997fc4f-62f7-5e1d-8be2-32a1f1cec15b/73eff2d3-night-shift-teaser-9x16.mp4"
OUT = "/home/user/signal/marketing/teaser-week/videos"
TMP = os.path.dirname(os.path.abspath(__file__))
BOLD = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
SEMI = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"

# segments: (src_start, src_end, speed)
REELS = {
  "A-pipeline-at-zero": {
    "segs": [(0, 12.0, 1.0)],
    "top": [(0, 99, "Your pipeline when you stop\nprospecting for a month")],
    "bottom": [],
  },
  "B-night-shift": {
    "segs": [(15.0, 40.3, 1.0)],
    "top": [(0, 99, "I stopped prospecting.\nThis does it while I sleep.")],
    "bottom": [(0, 7.6, "Finds a company hiring\nfor AP automation"),
               (7.6, 13.0, "Checks their stack.\nStill on spreadsheets."),
               (13.0, 17.0, "Finds the founder.\nVerifies the contact."),
               (17.0, 19.6, "Scores the lead: 94/100"),
               (19.6, 25.3, "Drafts the first email.\nDone before 7am.")],
  },
  "C-score-94": {
    "segs": [(28.0, 40.3, 1.0)],
    "top": [(0, 99, "This company scored 94/100.\nIt has no idea yet.")],
    "bottom": [(4.0, 6.6, "Fit 98. Intent 95."),
               (6.6, 12.3, "First email drafted\nbefore they open Slack.")],
  },
}
END = (42.4, 49.6)  # coming soon card

def esc_path(p): return p.replace(":", "\\:")

def tf(name, text):
    p = os.path.join(TMP, name + ".txt")
    open(p, "w").write(text)
    return esc_path(p)

def build(key, cfg, theme):
    parts, labels = [], []
    segs = cfg["segs"] + [(END[0], END[1], 1.0)]
    for i, (a, b, s) in enumerate(segs):
        parts.append(f"[0:v]trim={a}:{b},setpts=(PTS-STARTPTS)/{s}[v{i}]")
        parts.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,atempo={s}[a{i}]")
        labels.append(f"[v{i}][a{i}]")
    parts.append("".join(labels) + f"concat=n={len(segs)}:v=1:a=1[vc][ac]")
    body_len = sum((b - a) / s for a, b, s in cfg["segs"])
    total = body_len + (END[1] - END[0])
    dark = theme == "dark"
    fg = "white" if dark else "0x111111"
    accent = "0x2ECC71" if dark else "0x16A34A"
    v = "[vc]"
    chain = []
    if dark:
        chain.append("negate,hue=h=180:s=1.15")
    n = 0
    for (a, b, t) in cfg["top"]:
        b = min(b, body_len)
        chain.append(f"drawtext=fontfile={BOLD}:textfile={tf(f'{key}_top{n}', t)}:fontsize=54:fontcolor={fg}:line_spacing=12:x=(w-text_w)/2:y=150:enable='between(t,{a},{b})'"); n += 1
    for (a, b, t) in cfg["bottom"]:
        chain.append(f"drawtext=fontfile={BOLD}:textfile={tf(f'{key}_bot{n}', t)}:fontsize=58:fontcolor={fg}:line_spacing=12:box=1:boxcolor={'black@0.55' if dark else 'white@0.85'}:boxborderw=28:x=(w-text_w)/2:y=1440:enable='between(t,{a},{b})'"); n += 1
    # end card CTA
    chain.append(f"drawtext=fontfile={BOLD}:textfile={tf(f'{key}_cta1', 'Comment RADAR')}:fontsize=96:fontcolor={accent}:x=(w-text_w)/2:y=420:enable='gte(t,{body_len})'")
    chain.append(f"drawtext=fontfile={SEMI}:textfile={tf(f'{key}_cta2', 'and I will send you early access first.\nRevealing Monday.')}:fontsize=50:fontcolor={fg}:line_spacing=16:x=(w-text_w)/2:y=580:enable='gte(t,{body_len})'")
    chain.append(f"fade=t=out:st={total-0.5}:d=0.5:color={'black' if dark else 'white'}")
    parts.append(v + ",".join(chain) + "[vo]")
    parts.append(f"[ac]afade=t=in:d=0.2,afade=t=out:st={total-0.6}:d=0.6[ao]")
    out = os.path.join(OUT, f"{key}-9x16-{theme}.mp4")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", SRC, "-filter_complex", ";".join(parts),
           "-map", "[vo]", "-map", "[ao]", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    return out, total

for key, cfg in REELS.items():
    for theme in ("light", "dark"):
        out, total = build(key, cfg, theme)
        print(f"{os.path.basename(out)}  {total:.1f}s")

# 4:5 feed versions of B (LinkedIn / X / IG feed)
for theme, bg in (("light", "0xF9F9F6"), ("dark", "0x060606")):
    src = os.path.join(OUT, f"B-night-shift-9x16-{theme}.mp4")
    out = os.path.join(OUT, f"B-night-shift-4x5-{theme}.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf",
        f"scale=-2:1350,pad=1080:1350:(ow-iw)/2:0:color={bg}", "-c:v", "libx264", "-crf", "19",
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out], check=True)
    print(os.path.basename(out))
