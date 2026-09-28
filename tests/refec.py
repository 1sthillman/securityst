import qrcode.base as b
import qrcode.util as u

data = [64, 84, 134, 86, 198, 198, 240, 236, 17, 236, 17, 236, 17, 236, 17, 236]
ecCount = 10

# LUT'tan al (yoksa üret) — python'un create_bytes yolu
rsPoly = b.Polynomial(u.LUT.rsPoly_LUT[ecCount], 0)
print("rsPoly:", list(rsPoly))

raw = b.Polynomial(data, len(rsPoly) - 1)
print("raw:", list(raw), "len:", len(raw))

mod = raw % rsPoly
print("mod:", list(mod), "len:", len(mod))

mod_offset = len(mod) - ecCount
ec = []
for i in range(ecCount):
    idx = i + mod_offset
    ec.append(mod[idx] if idx >= 0 else 0)
print("EC:", ec)
