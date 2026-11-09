"""Builds extra cat animations from frames that already exist in the sprite sheets.

    python tools/make_extra_sprites.py

Reads the hand-drawn rows 0..65 from design/cats/<color>.aseprite (layer "Layer 1"),
builds new rows from them and writes them back as rows 66+ on a layer named "Generated".
Then exports assets/cats/<color>.png and design/cats/<color>_labeled.png, the same as
exporting from Aseprite. Safe to run again: the "Generated" layer is replaced each time.

Most new frames are made by copying, shifting and patching existing frames, plus a few
tiny effects (Zzz, hearts, "!", "…"). The "held by the scruff" body is drawn here
under the sitting head, with the tail and hind paws swinging.
The head turn (the cat follows the mouse cursor) is drawn by hand below as letter grids;
it also writes src/renderer/cat/head-spans.ts, where the head is, so the app can turn the head
while the tail keeps wagging.
Row order must match XBASE and the extra animations in src/renderer/cat/sprites.ts.
"""
import struct
import zlib
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SIZE = 64
COLS = 14
XROW = 66  # first generated row; rows above are hand-drawn
GEN_LAYER = 'Generated'

OUTLINE = (18, 14, 20, 255)
LIGHT = (211, 223, 225, 255)
ZINK = (52, 60, 104, 255)  # Zzz lines: dark slate, readable on light desktops
PINK = (202, 113, 159, 255)

# Small glyphs for effects. '#' is filled, the outline is added around it automatically.
GLYPHS = {
    'z1': ['####', '..#.', '.#..', '####'],
    'z2': ['#####', '...#.', '..#..', '.#...', '#####'],
    'z3': ['######', '....#.', '...#..', '..#...', '.#....', '######'],
    'heart1': ['#.#', '###', '.#.'],
    'heart2': ['##.##', '#####', '.###.', '..#..'],
    'bang': ['##', '##', '##', '..', '##'],
    'dot': ['##', '##'],
}


def frame(sheet, row, col):
    return sheet.crop((col * SIZE, row * SIZE, col * SIZE + SIZE, row * SIZE + SIZE))


def shifted(img, dx=0, dy=0):
    out = Image.new('RGBA', (SIZE, SIZE))
    out.alpha_composite(img, (max(dx, 0), max(dy, 0)), (max(-dx, 0), max(-dy, 0)))
    return out


def patch_diff(base, src, ref, dx=0, dy=0):
    """Apply the pixels where `src` differs from `ref` onto `base`, shifted by dx, dy,
    only where `base` matches `ref` (so a closed-eye patch lands on the same face)."""
    out = base.copy()
    b, s, r, o = base.load(), src.load(), ref.load(), out.load()
    for y in range(SIZE):
        for x in range(SIZE):
            if s[x, y] == r[x, y]:
                continue
            tx, ty = x + dx, y + dy
            if 0 <= tx < SIZE and 0 <= ty < SIZE and b[tx, ty] == r[x, y]:
                o[tx, ty] = s[x, y]
    return out


def glyph(img, name, x, y, fill, thin=False, edge=OUTLINE):
    """Draw a glyph with its top-left at x, y and a 1px `edge` outline.
    thin: no outline, only a 1px `edge` shadow down-right, so thin lines stay readable."""
    rows = GLYPHS[name]
    cells = {(x + i, y + j) for j, line in enumerate(rows) for i, ch in enumerate(line) if ch == '#'}
    px = img.load()
    around = [(1, 1)] if thin else [(ox, oy) for ox in (-1, 0, 1) for oy in (-1, 0, 1)]
    for cx, cy in cells:
        for ox, oy in around:
            p = (cx + ox, cy + oy)
            if p not in cells and 0 <= p[0] < SIZE and 0 <= p[1] < SIZE:
                px[p] = edge
    for p in cells:
        if 0 <= p[0] < SIZE and 0 <= p[1] < SIZE:
            px[p] = fill
    return img


# ---------- Held by the scruff: the cat hangs from the hand, tail and hind paws swing ----------
# The head is the sitF head lifted by HANG_DY; the body below is drawn here in the letters of
# the head-turn grids (A outline, B fur, C shade, D light), so every colour of cat gets it.
HANG_DY = -10
HANG_SWING = [0, 1, 2, 1, 0, -1, -2, -1]  # like a pendulum; frame 4 also blinks


def body_cells(sw):
    """Letters of the hanging body for one swing step `sw` (-2..2), as {(x, y): letter}."""
    c = {}
    def span(y, x0, x1, ch='B'):
        for x in range(x0, x1 + 1): c[(x, y)] = ch
    # torso: shoulders, belly, round hips
    for y, (x0, x1) in {22: (26, 37), 23: (25, 38), 35: (25, 38), 36: (26, 37), 37: (28, 35)}.items(): span(y, x0, x1)
    for y in range(24, 35): span(y, 25 if y < 30 else 24, 38 if y < 30 else 39)
    # hind legs hang apart with the tail between them; the lower legs swing
    hs = round(sw * 0.5)
    for y in range(34, 42):
        d = hs if y >= 38 else 0
        span(y, 24 + d, 27 + d)
        span(y, 36 + d, 39 + d)
    for y in (42, 43):
        span(y, 23 + hs, 27 + hs, 'D')
        span(y, 36 + hs, 40 + hs, 'D')
    # tail: swings more towards the tip
    for y in range(36, 55):
        t = (y - 36) / 18
        cx = 31.5 + sw * 2 * t ** 1.3
        span(y, round(cx - 1), round(cx))
    # shade along the sides, like the hand-drawn frames
    for (x, y), ch in list(c.items()):
        if ch == 'B' and ((x - 1, y) not in c or (x + 1, y) not in c): c[(x, y)] = 'C'
    # light chest and belly
    for y in range(22, 27): span(y, 29, 34, 'D')
    for y in range(27, 32): span(y, 30, 33, 'D')
    # front paws dangle in front of the chest, light pads at the bottom
    for x0 in (26, 35):
        for y in range(25, 31): span(y, x0, x0 + 2)
        for y in (31, 32): span(y, x0, x0 + 2, 'D')
        span(33, x0, x0 + 2, 'A')
    for y in range(26, 33):
        c[(29, y)] = 'A'
        c[(34, y)] = 'A'
    return c


def hang_frame(face, col, sw):
    """The sitF head (and neck) lifted by HANG_DY, the body under it, outline around the body."""
    img = Image.new('RGBA', (SIZE, SIZE))
    o, f = img.load(), face.load()
    for y in range(16, 32):
        for x in range(18, 42 if y < 29 else 39):
            if f[x, y][3]:
                o[x, y + HANG_DY] = f[x, y]
    cells = body_cells(sw)
    for p, ch in cells.items():
        o[p] = col[ch]
    for (x, y) in list(cells):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < SIZE and 0 <= q[1] < SIZE and q not in cells and o[q][3] == 0:
                o[q] = col['A']
    return img

def hang_frames(sitF, closed):
    """One swing back and forth; `closed` is sitF with closed eyes for the blink."""
    px = sitF.load()
    col = {k: px[p] for k, p in LOOK_KEYS.items()}
    return [hang_frame(closed if i == 4 else sitF, col, sw) for i, sw in enumerate(HANG_SWING)]


# ---------- Head turn: the sitting cat follows the cursor with its head ----------
# Letter grids in the colours of the hand-drawn cat: A outline, B fur, C shade, D light patch,
# E inner ear, F eye highlight. Rows 16..29, columns 20..42 of the sitF frame; '.' is empty.
# L3: head in three-quarter view looking left (far ear edge-on, near ear shows its inside,
# muzzle near the left edge, far eye narrower). L2: half-way. L1 is the front face with eyes,
# nose and mouth moved 1px. Looking right is the mirror image. Outline and neck stay joined.
LOOK_X, LOOK_Y = 20, 16
LOOK_L3 = [
    '......A.........A......',
    '.....ACA.A.....ABA.....',
    '....ACCAADA...ABCA.....',
    '....ACCADDDAAABCECA....',
    '.....ACDDDDDBBCEECA....',
    '.....ABBDBDBBBEEECA....',
    '.....ACBBBBBBBBEECA....',
    '....ACBBBBBBBBBBBCA....',
    '...ACBBBBBBBBBBBBCA....',
    '.AAABAFBBBBAFBBBBBAAA..',
    'A..ABAAABBAAAABBBBA....',
    '..AABAACBBCAABBBBBAAA..',
    '.A.ACBBBABBBBBBBBCA....',
    '....ACBABABBBBBBBCA....',
]
LOOK_L2 = [
    '.....A...........A.....',
    '....ACA...A.....ABA....',
    '...ACCA..ADA...ABCA....',
    '...ACCAAADDDAAABCEEA...',
    '...ACCBBDDDDDBBCEEEA...',
    '...ACBBBBDBDBBBCEEEA...',
    '....ACBBBBBBBBBBCEA....',
    '...ACBBBBBBBBBBBBBCA...',
    '...ACBBBBBBBBBBBBBCA...',
    '.AAABBAFBBBBAFBBBBBAAA.',
    'A..ABBAAABBAAAABBBBA...',
    '..AABBAACBBCAABBBBBAAA.',
    '.A.ACBBBBABBBBBBBBCA...',
    '....ACBBABABBBBBBCA....',
]
# Where each letter's colour is in sitF (white and black cats have no light patch: D = B there).
LOOK_KEYS = {'A': (23, 19), 'B': (31, 24), 'C': (24, 23), 'D': (31, 20), 'E': (24, 19), 'F': (28, 25)}
LOOK_CUT = 29  # last head row; the neck below is the same in every frame


def flood(px, seed, ok):
    seen, q = set(), deque([seed])
    while q:
        x, y = q.popleft()
        if (x, y) in seen or not (0 <= x < SIZE and 0 <= y < SIZE) or px[x, y][3] == 0 or not ok(x, y):
            continue
        seen.add((x, y))
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return seen


def head_mask(img):
    """Head pixels with ears and whiskers above the neck: whatever is not joined to the body or tail."""
    px = img.load()
    head = flood(px, (31, 22), lambda x, y: y <= LOOK_CUT)
    body = flood(px, (31, 44), lambda x, y: (x, y) not in head)
    return {(x, y) for y in range(LOOK_CUT + 1) for x in range(42)
            if px[x, y][3] and (x, y) not in body}


def grid_cells(g):
    return {(LOOK_X + i, LOOK_Y + j): ch for j, row in enumerate(g) for i, ch in enumerate(row) if ch != '.'}


def cells_grid(c):
    rows = [['.'] * 23 for _ in range(14)]
    for (x, y), ch in c.items():
        rows[y - LOOK_Y][x - LOOK_X] = ch
    return [''.join(r) for r in rows]


def face_grid(sitF):
    """The front head of the ginger sitF frame as letters."""
    px = sitF.load()
    names = {px[p]: k for k, p in LOOK_KEYS.items()}
    return cells_grid({p: names[px[p]] for p in head_mask(sitF)})


def eye_cells(g):
    """Eyes: A, F (and the C inner corner) in rows 25..27 between the cheeks."""
    c, out = grid_cells(g), {}
    for y in range(25, 28):
        fur = sorted(x for (x, yy) in c if yy == y and c[(x, y)] in 'BC')
        for x in range(fur[0], fur[-1]):
            ch = c.get((x, y))
            if ch in ('A', 'F') or (ch == 'C' and y == 27):
                out[(x, y)] = ch
    return out


def mouth_cells(g):
    c, out = grid_cells(g), {}
    for y in (28, 29):
        fur = sorted(x for (x, yy) in c if yy == y and c[(x, y)] in 'BC')
        out.update({(x, y): 'A' for x in range(fur[0], fur[-1]) if c.get((x, y)) == 'A'})
    return out


def move_cells(g, feats, dx, dy):
    c = grid_cells(g)
    c.update({p: 'B' for p in feats})
    c.update({(x + dx, y + dy): ch for (x, y), ch in feats.items()})
    return cells_grid(c)


def eyes_closed(g):
    c, eyes = grid_cells(g), eye_cells(g)
    ys = sorted({y for _, y in eyes})
    for (x, y), ch in eyes.items():
        if y == ys[0] or (y == ys[-1] and ch != 'C'):
            c[(x, y)] = 'B'
    return cells_grid(c)


def mirrored(g):
    """Mirror around x = 31; eye highlights stay right of the pupil, as in every hand-drawn frame."""
    return [row[::-1].replace('FA', 'AF') for row in g]


def look_grids(ginger_sitF, up=False):
    front = face_grid(ginger_sitF)
    l1 = move_cells(front, {**eye_cells(front), **mouth_cells(front)}, -1, 0)
    left = [LOOK_L3, LOOK_L2, l1]
    grids = left + [front] + [mirrored(g) for g in reversed(left)]  # L3 L2 L1 F R1 R2 R3
    return [move_cells(g, eye_cells(g), 0, -1) for g in grids] if up else grids


def look_frames(sitF, ginger_sitF, up):
    """7 head positions with open eyes, then the same 7 blinking."""
    px = sitF.load()
    colours = {k: px[p] for k, p in LOOK_KEYS.items()}
    old = head_mask(sitF)
    body = {(x, y) for y in range(SIZE) for x in range(SIZE) if px[x, y][3]} - old
    grids = look_grids(ginger_sitF, up)
    frames = []
    for g in grids + [eyes_closed(g) for g in grids]:
        cells = grid_cells(g)
        assert not cells.keys() & body, 'head turn overlaps the body or tail'
        img = sitF.copy()
        o = img.load()
        for p in old:
            o[p] = (0, 0, 0, 0)
        for p, ch in cells.items():
            o[p] = colours[ch]
        frames.append(img)
    return frames


def spans(points):
    """[y, x1, x2] runs, row by row."""
    out = []
    for y in sorted({y for _, y in points}):
        xs = sorted(x for x, yy in points if yy == y)
        start = prev = xs[0]
        for x in xs[1:]:
            if x != prev + 1:
                out.append([y, start, prev])
                start = x
            prev = x
        out.append([y, start, prev])
    return out


def write_head_spans(ginger_sitF):
    front = head_mask(ginger_sitF)
    turned = set()
    for up in (False, True):
        for g in look_grids(ginger_sitF, up):
            turned |= grid_cells(g).keys()
    fmt = lambda runs: ', '.join(f'[{y}, {a}, {b}]' for y, a, b in runs)
    ts = ROOT / 'src' / 'renderer' / 'cat' / 'head-spans.ts'
    ts.write_text(
        '// Generated by tools/make_extra_sprites.py: do not edit by hand.\n'
        '// Where the head of the sitting cat is, as [y, x1, x2] runs inside a 64x64 frame.\n'
        '// FRONT_HEAD: the head in sitF and wagSitF. TURNED_HEAD: every pixel a head-turn frame can use.\n'
        'export type Span = [number, number, number];\n'
        f'export const FRONT_HEAD: Span[] = [{fmt(spans(front))}];\n'
        f'export const TURNED_HEAD: Span[] = [{fmt(spans(turned))}];\n',
        encoding='utf-8', newline='\n')


def zzz_chain(img, side):
    """Where z, zz, zzz go: from the head diagonally up over the cat's back, each letter
    a little above the cat under it and inside the frame. side: where the head is (L/R)."""
    x0, y0, x1, _ = img.getbbox()
    alpha = img.getchannel('A').load()
    col_top = lambda xa, xb: min([y for x in range(max(xa, 0), min(xb, SIZE)) for y in range(SIZE) if alpha[x, y]] or [SIZE])
    out = 1 if side == 'L' else -1  # drift away from the head, over the body
    ax = x0 + 18 if side == 'L' else x1 - 18
    chain, bottom = [], None
    for name_z, step in (('z1', 0), ('z2', 6), ('z3', 13)):
        w = len(GLYPHS[name_z][0])
        h = len(GLYPHS[name_z])
        x = ax + out * step - (w if out < 0 else 0)
        x = min(max(x, 1), SIZE - w - 2)
        top = col_top(x - 1, x + w + 2) - 3 - h  # clear of the cat under it
        if bottom is not None:
            top = min(top, bottom - h - 2)        # and above the previous letter
        top = max(top, 1)
        chain.append((name_z, x, top))
        bottom = top
    return chain


def build(sheet, ginger):
    f = lambda r, c: frame(sheet, r, c)
    sitF, standF, wagB = f(0, 0), f(1, 0), [f(20, c) for c in range(5)]
    closedSit = f(43, 6)  # last yawn frame: sitF with eyes closed
    blink = lambda img, dx=0, dy=0: patch_diff(img, closedSit, sitF, dx, dy)
    top = sitF.getbbox()[1]

    rows = []  # (name, label for *_labeled.png, base row for feet, frames)

    # Blinking. The sitting tail-wag frames share the sitF face.
    rows.append(('blinkSitF', 'Blink (sit, front)', 0, [sitF, blink(sitF)]))
    wag = [f(19, c) for c in range(5)]
    rows.append(('wagBlinkSitF', 'Tail wag + blink (sit, front)', 19, wag + [blink(w) for w in wag]))
    # sleep frame 0 is the same pose with eyes closed
    rows.append(('blinkLieL', 'Blink (lie, front, left)', 6, [f(6, 0), f(44, 0)]))
    rows.append(('blinkLieR', 'Blink (lie, front, right)', 6, [f(6, 1), f(45, 0)]))
    # standing face sits 10px lower
    rows.append(('blinkStandF', 'Blink (stand, front)', 1, [standF, blink(standF, 0, 10)]))

    # Ear twitch: the tip of the left ear folds down for a moment.
    ear = sitF.copy()
    px = ear.load()
    for x in range(20, 28):
        for y in (top, top + 1):
            px[x, y] = (0, 0, 0, 0)
        if px[x, top + 2][3]:
            px[x, top + 2] = OUTLINE
    rows.append(('earTwitchF', 'Ear twitch (sit, front)', 0, [sitF, ear]))

    # Happy hop: the sitting cat bounces up and lands.
    rows.append(('hopF', 'Happy hop (front)', 0, [shifted(sitF, 0, -d) for d in (0, 3, 6, 8, 6, 3)]))

    # Purring with hearts: eyes closed, hearts rise above the head.
    content = blink(sitF)
    hearts = []
    for i in range(4):
        img = content.copy()
        glyph(img, 'heart2', 40, top - 4 - i * 3, PINK)
        if i >= 1:
            glyph(img, 'heart1', 24, top - 2 - (i - 1) * 3, PINK)
        hearts.append(img)
    rows.append(('heartsSitF', 'Purr with hearts (front)', 0, hearts))

    # Surprise: a quick hop with "!" above.
    sTop = standF.getbbox()[1]
    surprise = []
    for d in (0, 4, 2, 0):
        img = shifted(standF, 0, -d)
        glyph(img, 'bang', 44, max(1, sTop + 4 - d), LIGHT)
        surprise.append(img)
    rows.append(('surpriseF', 'Surprise ! (front)', 1, surprise))

    # Thinking: the cat faces the screen and "…" appears dot by dot.
    think = []
    for i in range(8):
        img = wagB[i % 5].copy()
        for k in range(min(i % 4, 3)):
            glyph(img, 'dot', 26 + k * 5, 8, LIGHT)
        think.append(img)
    rows.append(('thinkB', 'Thinking ... (back)', 20, think))

    # Sleeping with Zzz drifting up from the head. Same breathing as the original rows.
    sleeps = [('sleep1', 44, 'Sleep 1'), ('sleepBack', 46, 'Sleep on back'), ('sleep2', 48, 'Sleep 2'),
              ('sleep3', 50, 'Sleep 3'), ('sleep4', 52, 'Sleep 4'), ('sleep5', 54, 'Sleep 5')]
    for name, r, label in sleeps:
        for side, rr in (('L', r), ('R', r + 1)):
            a, b = f(rr, 0), f(rr, 1)
            chain = zzz_chain(a, side)
            frames = []
            for i in range(8):
                img = (a if i % 2 == 0 else b).copy()
                stage = i % 4  # 0: no z yet, then z, zz, zzz
                for name_z, zx, zy in chain[:stage]:
                    glyph(img, name_z, zx, zy, ZINK, thin=True, edge=LIGHT)
                frames.append(img)
            side_label = 'left' if side == 'L' else 'right'
            rows.append((f'{name}Z{side}', f'{label} + Zzz ({side_label})', rr, frames))

    # Held by the scruff while being dragged (base None: the frame sets its own bottom, see sprites.ts).
    rows.append(('scruffF', 'Held by the scruff, swinging (front)', None, hang_frames(sitF, blink(sitF))))

    # Following the cursor: head turned L3..R3, then the same blinking (lookUpSitF: eyes raised).
    gsit = frame(ginger, 0, 0)
    rows.append(('lookSitF', 'Head turn, looking around (sit, front)', 0, look_frames(sitF, gsit, up=False)))
    rows.append(('lookUpSitF', 'Head turn, looking up (sit, front)', 0, look_frames(sitF, gsit, up=True)))
    return rows


# ---------- .aseprite read/write: one frame, RGBA, compressed cels (Aseprite ase-file-specs.md) ----------

def read_ase(path):
    d = path.read_bytes()
    w, h = struct.unpack_from('<HH', d, 8)
    nchunks = struct.unpack_from('<I', d, 128 + 12)[0] or struct.unpack_from('<H', d, 128 + 6)[0]
    chunks, p = [], 128 + 16
    for _ in range(nchunks):
        size, ctype = struct.unpack_from('<IH', d, p)
        chunks.append([ctype, d[p + 6:p + size]])
        p += size
    return {'head': bytearray(d[:128]), 'frame': bytearray(d[128:144]), 'w': w, 'h': h, 'chunks': chunks}


def write_ase(path, ase):
    body = b''.join(struct.pack('<IH', len(c) + 6, t) + c for t, c in ase['chunks'])
    frame, head = ase['frame'], ase['head']
    struct.pack_into('<I', frame, 0, 16 + len(body))
    struct.pack_into('<H', frame, 6, min(len(ase['chunks']), 0xFFFF))
    struct.pack_into('<I', frame, 12, len(ase['chunks']))
    struct.pack_into('<I', head, 0, 128 + 16 + len(body))
    struct.pack_into('<H', head, 10, ase['h'])
    path.write_bytes(bytes(head) + bytes(frame) + body)


def layer_names(ase):
    out = []
    for t, c in ase['chunks']:
        if t == 0x2004:
            n = struct.unpack_from('<H', c, 16)[0]
            out.append(c[18:18 + n].decode('utf8'))
    return out


def cel_chunk(layer, x, y, img):
    w, h = img.size
    head = struct.pack('<HhhBHh5xHH', layer, x, y, 255, 2, 0, w, h)
    return [0x2005, head + zlib.compress(img.tobytes(), 9)]


def cel_image(chunk):
    x, y = struct.unpack_from('<hh', chunk, 2)
    w, h = struct.unpack_from('<HH', chunk, 16)
    return x, y, Image.frombytes('RGBA', (w, h), zlib.decompress(chunk[20:]))


def find_cel(ase, layer):
    for i, (t, c) in enumerate(ase['chunks']):
        if t == 0x2005 and struct.unpack_from('<H', c, 0)[0] == layer:
            return i
    return None


def grid(w, h, color):
    """The 64px guide grid on the bottom layer, same pattern as the original."""
    img = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(img)
    for k in range(SIZE, max(w, h) + 1, SIZE):
        for v in (k - 1, k):
            d.line([(v, 0), (v, h - 1)], fill=color)
            d.line([(0, v), (w - 1, v)], fill=color)
    return img


def hand_drawn(ase):
    """Rows 0..XROW-1 from the art layer, as a sheet image."""
    art = layer_names(ase).index('Layer 1')
    x, y, img = cel_image(ase['chunks'][find_cel(ase, art)][1])
    sheet = Image.new('RGBA', (COLS * SIZE, XROW * SIZE))
    sheet.alpha_composite(img, (x, y))
    return sheet


def rows_image(rows):
    img = Image.new('RGBA', (COLS * SIZE, len(rows) * SIZE))
    for i, (_, _, _, frames) in enumerate(rows):
        assert len(frames) <= COLS
        for c, f in enumerate(frames):
            img.alpha_composite(f, (c * SIZE, i * SIZE))
    return img


def update_ase(path, ase, gen):
    names = layer_names(ase)
    new_h = XROW * SIZE + gen.height

    # bottom guide-grid layer: grow it so it covers the new rows
    gi = find_cel(ase, 0)
    gx, gy, gimg = cel_image(ase['chunks'][gi][1])
    color = next(c for _, c in gimg.getcolors(16) if c[3])
    ase['chunks'][gi] = cel_chunk(0, gx, gy, grid(gimg.width, max(gimg.height, new_h + 392), color))

    # "Generated" layer on top, holding rows XROW+
    if GEN_LAYER in names:
        li = names.index(GEN_LAYER)
    else:
        li = len(names)
        tmpl = next(c for t, c in ase['chunks'] if t == 0x2004)
        name = GEN_LAYER.encode('utf8')
        last = max(i for i, (t, _) in enumerate(ase['chunks']) if t == 0x2004)
        ase['chunks'].insert(last + 1, [0x2004, tmpl[:16] + struct.pack('<H', len(name)) + name])
    cel = cel_chunk(li, 0, XROW * SIZE, gen)
    old = find_cel(ase, li)
    if old is None:
        ase['chunks'].append(cel)
    else:
        ase['chunks'][old] = cel
    ase['h'] = new_h
    write_ase(path, ase)


def export_labeled(path, gen, rows):
    """design/cats/<color>_labeled.png: white row labels on the left, then the sheet."""
    old = Image.open(path).convert('RGBA')
    pad = old.width - COLS * SIZE
    out = Image.new('RGBA', (old.width, XROW * SIZE + gen.height))
    out.alpha_composite(old.crop((0, 0, old.width, XROW * SIZE)), (0, 0))
    out.alpha_composite(gen, (pad, XROW * SIZE))
    try:
        font = ImageFont.truetype('segoeui.ttf', 16)
    except OSError:
        font = ImageFont.load_default()
    d = ImageDraw.Draw(out)
    for i, (_, label, _, _) in enumerate(rows):
        d.text((80, (XROW + i) * SIZE + SIZE // 2), label, fill=(255, 255, 255, 255), font=font, anchor='lm')
    out.save(path, optimize=True)


def main():
    ginger = hand_drawn(read_ase(ROOT / 'design' / 'cats' / 'ginger.aseprite'))
    for color in ('ginger', 'white', 'black'):
        ase_path = ROOT / 'design' / 'cats' / f'{color}.aseprite'
        ase = read_ase(ase_path)
        sheet = hand_drawn(ase)
        rows = build(sheet, ginger)
        gen = rows_image(rows)
        update_ase(ase_path, ase, gen)
        png = Image.new('RGBA', (COLS * SIZE, XROW * SIZE + gen.height))
        png.alpha_composite(sheet, (0, 0))
        png.alpha_composite(gen, (0, XROW * SIZE))
        png.save(ROOT / 'assets' / 'cats' / f'{color}.png', optimize=True)
        export_labeled(ROOT / 'design' / 'cats' / f'{color}_labeled.png', gen, rows)
    write_head_spans(frame(ginger, 0, 0))
    for i, (name, _, base, frames) in enumerate(rows):
        feet = frames[0].getbbox()[3]
        print(f'row {XROW + i:2d} {name:14s} base={base} feet={feet} frames={len(frames)}')


if __name__ == '__main__':
    main()
