import json
import sys
import qrcode
import qrcode.util as u
import qrcode.base as b

text = sys.argv[1] if len(sys.argv) > 1 else "CCCC"
version = int(sys.argv[2]) if len(sys.argv) > 2 else 4
out = sys.argv[3] if len(sys.argv) > 3 else "C:/syncserver/tests/ref-tmp.json"

qr = qrcode.QRCode(
    version=version,
    error_correction=qrcode.constants.ERROR_CORRECT_M,
    box_size=1,
    border=0,
    mask_pattern=0,
)
qr.add_data(text, optimize=0)
for d in qr.data_list:
    d.mode = u.MODE_8BIT_BYTE
qr.make(fit=False)

mat = [[bool(c) for c in row] for row in qr.get_matrix()]
words = list(qr.data_cache)

# Format bilgisinin gercekte hangi bitleri oldugunu iki kopyadan oku
n = len(mat)
FORMAT_TABLE = {
    21522: ("L", 0), 20773: ("L", 1), 24188: ("L", 2), 23371: ("L", 3),
    17913: ("L", 4), 16590: ("L", 5), 20375: ("L", 6), 19104: ("L", 7),
    30660: ("M", 0), 29427: ("M", 1), 32170: ("M", 2), 30877: ("M", 3),
    26159: ("M", 4), 25368: ("M", 5), 27713: ("M", 6), 26998: ("M", 7),
}

def read_vertical(mat, n):
    v = 0
    for i in range(15):
        if i < 6: b = mat[i][8]
        elif i < 8: b = mat[i + 1][8]
        else: b = mat[n - 15 + i][8]
        v |= (1 if b else 0) << i
    return v

def read_horizontal(mat, n):
    v = 0
    for i in range(15):
        if i < 8: b = mat[8][n - i - 1]
        elif i < 9: b = mat[8][8]
        else: b = mat[8][15 - i - 1]
        v |= (1 if b else 0) << i
    return v

fv = read_vertical(mat, n)
fh = read_horizontal(mat, n)
info = {
    "format_vertical": fv,
    "format_horizontal": fh,
    "format_vertical_decoded": FORMAT_TABLE.get(fv, ("BILINMIYOR", -1)),
    "format_horizontal_decoded": FORMAT_TABLE.get(fh, ("BILINMIYOR", -1)),
}

with open(out, "w") as f:
    json.dump({"size": n, "matrix": mat, "words": words, "text": text, "format": info}, f)
print("V%d size=%d" % (version, n))
print("format dikey   :", fv, FORMAT_TABLE.get(fv, "?"))
print("format yatay   :", fh, FORMAT_TABLE.get(fh, "?"))
