from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app-store-screenshots" / "ipad-12-9-2048x2732"
W, H = 2048, 2732

COLORS = {
    "ink": "#24160f",
    "wine": "#8f1d2c",
    "gold": "#d5a84f",
    "cream": "#fff8e8",
    "paper": "#f3ead5",
    "sand": "#e7d7b5",
    "green": "#15803d",
    "brown": "#6f5639",
    "black": "#110d0b",
}


def font(size, bold=False):
    name = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)


F = {
    "hero": font(94, True),
    "title": font(68, True),
    "subtitle": font(42),
    "label": font(30, True),
    "body": font(38),
    "small": font(26, True),
    "money": font(86, True),
    "button": font(34, True),
}


def rounded(draw, box, fill, outline=None, width=1, radius=32):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, fill=COLORS["ink"], fnt=None, anchor=None):
    draw.text(xy, value, fill=fill, font=fnt or F["body"], anchor=anchor)


def center_text(draw, y, value, fill=COLORS["ink"], fnt=None):
    draw.text((W // 2, y), value, fill=fill, font=fnt or F["body"], anchor="ma", align="center")


def paste_cover(base, path, alpha=0.28):
    img = Image.open(path).convert("RGB")
    scale = max(W / img.width, H / img.height)
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    left = (img.width - W) // 2
    top = (img.height - H) // 2
    img = img.crop((left, top, left + W, top + H))
    dark = Image.new("RGB", (W, H), COLORS["black"])
    base.paste(Image.blend(img, dark, 1 - alpha))


def make_base(bg=None):
    im = Image.new("RGB", (W, H), COLORS["paper"])
    draw = ImageDraw.Draw(im)
    for y in range(H):
      t = y / H
      r = int(243 * (1 - t) + 42 * t)
      g = int(234 * (1 - t) + 33 * t)
      b = int(213 * (1 - t) + 24 * t)
      draw.line((0, y, W, y), fill=(r, g, b))
    if bg and bg.exists():
        paste_cover(im, bg)
    return im


def tablet_shell(draw):
    rounded(draw, (150, 190, 1898, 2542), COLORS["cream"], COLORS["gold"], 7, 72)
    rounded(draw, (218, 280, 1830, 2452), COLORS["paper"], COLORS["ink"], 4, 42)
    draw.ellipse((985, 228, 1063, 306), fill=COLORS["ink"])


def logo(draw, x, y, size=150):
    rounded(draw, (x, y, x + size, y + size), COLORS["wine"], COLORS["gold"], 5, size // 2)
    text(draw, (x + size / 2, y + size / 2 - 22), "FIC", COLORS["cream"], font(size // 3, True), "ma")
    draw.line((x + 26, y + size - 40, x + size - 26, y + 40), fill=COLORS["gold"], width=9)


def app_frame(title, subtitle=None, bg=None):
    im = make_base(bg)
    draw = ImageDraw.Draw(im)
    tablet_shell(draw)
    logo(draw, 310, 380, 145)
    text(draw, (500, 390), title, COLORS["ink"], F["title"])
    if subtitle:
        text(draw, (500, 470), subtitle, COLORS["brown"], F["subtitle"])
    return im, draw


def balance_card(draw, x, y, w, label, amount, hint=None):
    rounded(draw, (x, y, x + w, y + 270), COLORS["ink"], COLORS["gold"], 4, 30)
    text(draw, (x + 55, y + 48), label.upper(), COLORS["gold"], F["label"])
    text(draw, (x + 55, y + 102), amount, COLORS["cream"], F["money"])
    if hint:
        text(draw, (x + 55, y + 205), hint, COLORS["sand"], F["body"])


def pill(draw, box, label, active=False):
    fill = COLORS["wine"] if active else "#f9efd9"
    color = COLORS["cream"] if active else COLORS["ink"]
    rounded(draw, box, fill, COLORS["gold"], 3, 24)
    draw.text(((box[0] + box[2]) // 2, (box[1] + box[3]) // 2 - 20), label, fill=color, font=F["button"], anchor="ma")


def qr_pattern(draw, x, y, size):
    rounded(draw, (x, y, x + size, y + size), COLORS["cream"], COLORS["ink"], 5, 22)
    cell = size // 17
    for px, py in [(1, 1), (11, 1), (1, 11)]:
        draw.rectangle((x + px * cell, y + py * cell, x + (px + 5) * cell, y + (py + 5) * cell), fill=COLORS["ink"])
        draw.rectangle((x + (px + 1) * cell, y + (py + 1) * cell, x + (px + 4) * cell, y + (py + 4) * cell), fill=COLORS["cream"])
        draw.rectangle((x + (px + 2) * cell, y + (py + 2) * cell, x + (px + 3) * cell, y + (py + 3) * cell), fill=COLORS["ink"])
    for row in range(17):
        for col in range(17):
            if (row * 7 + col * 5 + row * col) % 6 in (0, 1):
                draw.rectangle((x + col * cell, y + row * cell, x + (col + 1) * cell, y + (row + 1) * cell), fill=COLORS["ink"])


def login_screen():
    im = make_base(ROOT / "images" / "Cervantes.jpg")
    draw = ImageDraw.Draw(im)
    center_text(draw, 270, "Pagos FIC 2026", COLORS["cream"], F["hero"])
    center_text(draw, 370, "Credencial, pagos y beneficios para iPad", COLORS["sand"], F["subtitle"])
    rounded(draw, (330, 690, 1718, 1620), "#192342", COLORS["gold"], 4, 38)
    logo(draw, 894, 780, 260)
    center_text(draw, 1115, "Inicio de sesión seguro", COLORS["cream"], F["title"])
    for i, label in enumerate(["Usuario", "Contrasenia"]):
        y = 1245 + i * 130
        rounded(draw, (470, y, 1578, y + 86), "#2a355f", COLORS["gold"], 2, 18)
        text(draw, (510, y + 24), label, COLORS["sand"], F["body"])
    rounded(draw, (470, 1510, 1578, 1610), COLORS["wine"], None, 1, 22)
    center_text(draw, 1540, "ADENTRARSE", COLORS["cream"], F["button"])
    return im


def client_qr_screen():
    im, draw = app_frame("Credencial FIC", "QR listo para pagar", ROOT / "images" / "Quijote3.jpg")
    balance_card(draw, 320, 690, 640, "Saldo disponible", "$1,250.00")
    rounded(draw, (1080, 680, 1698, 1298), "#f6e8c8", COLORS["gold"], 5, 32)
    qr_pattern(draw, 1175, 775, 428)
    rounded(draw, (320, 1080, 960, 1380), "#f9efd9", COLORS["gold"], 3, 28)
    text(draw, (370, 1140), "Maria Gonzalez", COLORS["ink"], F["title"])
    text(draw, (370, 1225), "Cliente activo", COLORS["brown"], F["body"])
    center_text(draw, 1660, "Acceso rapido desde una pantalla amplia", COLORS["ink"], F["title"])
    return im


def client_balances_screen():
    im, draw = app_frame("Mis saldos", "Alimentos y hospedaje", ROOT / "images" / "Quijote4.jpg")
    balance_card(draw, 320, 690, 640, "Saldo disponible", "$840.00", "Consumos FIC")
    balance_card(draw, 1080, 690, 640, "Saldo hospedaje", "$3,600.00", "Tarifa noche: $900.00")
    rounded(draw, (320, 1100, 1728, 1450), "#f9efd9", COLORS["gold"], 4, 30)
    text(draw, (380, 1170), "Beneficios activos", COLORS["wine"], F["title"])
    text(draw, (380, 1265), "Alimentos activo  |  Hospedaje activo", COLORS["ink"], F["body"])
    return im


def establishments_screen():
    im, draw = app_frame("Establecimientos", "Consulta puntos autorizados")
    items = [("Cafe Cervantino", "Zona centro"), ("Restaurante FIC", "Teatro principal"), ("Tienda oficial", "Explanada")]
    for i, (name, location) in enumerate(items):
        x = 320 + (i % 2) * 720
        y = 700 + (i // 2) * 300
        rounded(draw, (x, y, x + 650, y + 230), "#f9efd9", COLORS["gold"], 3, 26)
        text(draw, (x + 50, y + 50), name, COLORS["ink"], F["title"])
        text(draw, (x + 50, y + 132), location, COLORS["brown"], F["body"])
        pill(draw, (x + 420, y + 132, x + 590, y + 200), "Mapa", True)
    center_text(draw, 1550, "Mas espacio para comparar establecimientos", COLORS["ink"], F["title"])
    return im


def payment_request_screen():
    im, draw = app_frame("Solicitud de pago", "Aceptar o rechazar")
    rounded(draw, (360, 700, 1688, 1430), COLORS["ink"], COLORS["gold"], 5, 34)
    text(draw, (430, 780), "Cafe Cervantino", COLORS["cream"], F["title"])
    text(draw, (430, 870), "Consumo en establecimiento", COLORS["sand"], F["body"])
    text(draw, (430, 1040), "Total", COLORS["sand"], F["body"])
    text(draw, (430, 1110), "$287.50", COLORS["cream"], F["money"])
    pill(draw, (430, 1280, 940, 1375), "Rechazar", False)
    pill(draw, (1040, 1280, 1550, 1375), "Aprobar", True)
    return im


def provider_charge_screen():
    im, draw = app_frame("Nuevo cobro", "Propina por porcentaje")
    rounded(draw, (320, 700, 1728, 840), "#f9efd9", COLORS["gold"], 3, 24)
    text(draw, (380, 735), "Cliente: Maria Gonzalez", COLORS["ink"], F["title"])
    rounded(draw, (320, 930, 1728, 1070), "#f9efd9", COLORS["gold"], 3, 24)
    text(draw, (380, 965), "Monto: $250.00", COLORS["ink"], F["title"])
    for i, label in enumerate(["0%", "5%", "10%", "15%"]):
        pill(draw, (320 + i * 355, 1170, 625 + i * 355, 1260), label, label == "15%")
    text(draw, (320, 1350), "Propina calculada: $37.50", COLORS["ink"], F["body"])
    balance_card(draw, 320, 1480, 1408, "Total a cobrar", "$287.50")
    return im


def provider_success_screen():
    im, draw = app_frame("Pago realizado", "Confirmacion inmediata")
    rounded(draw, (520, 720, 1528, 1500), "#dcfce7", "#15803d", 6, 42)
    draw.ellipse((868, 850, 1180, 1162), fill=COLORS["green"])
    draw.line((940, 1010, 1025, 1100, 1130, 930), fill=COLORS["cream"], width=30)
    center_text(draw, 1250, "Pago aprobado", COLORS["ink"], F["title"])
    center_text(draw, 1340, "Folio TX-2026-0418", COLORS["brown"], F["subtitle"])
    return im


def hotel_checkin_screen():
    im, draw = app_frame("Hotel FIC", "Check-in con QR")
    rounded(draw, (360, 680, 1040, 1360), COLORS["ink"], COLORS["gold"], 5, 36)
    qr_pattern(draw, 480, 800, 440)
    rounded(draw, (1130, 760, 1690, 980), "#f9efd9", COLORS["gold"], 4, 28)
    text(draw, (1190, 815), "Cliente listo", COLORS["wine"], F["label"])
    text(draw, (1190, 880), "Maria Gonzalez", COLORS["ink"], F["body"])
    rounded(draw, (1130, 1120, 1690, 1225), COLORS["wine"], None, 1, 22)
    text(draw, (1410, 1148), "REGISTRAR", COLORS["cream"], F["button"], "ma")
    return im


def hotel_balance_screen():
    im, draw = app_frame("Hospedaje", "Descuento automatico")
    rounded(draw, (320, 720, 1728, 1040), "#dcfce7", "#15803d", 5, 32)
    text(draw, (380, 790), "Check-in registrado", "#14532d", F["title"])
    text(draw, (380, 880), "Tarifa descontada: $900.00", "#166534", F["body"])
    balance_card(draw, 320, 1200, 1408, "Saldo hospedaje restante", "$2,700.00")
    return im


def security_screen():
    im, draw = app_frame("Operacion segura", "Tokens y sesiones protegidas")
    items = [
        ("Login sanitizado", "Entradas validadas y tiempo limite"),
        ("Push tokens reforzados", "Registro por usuario y dispositivo"),
        ("Pagos con decision", "Aceptar o rechazar sin pasos extra"),
    ]
    for i, (title, body) in enumerate(items):
        y = 720 + i * 280
        rounded(draw, (320, y, 1728, y + 210), "#f9efd9", COLORS["gold"], 3, 28)
        draw.ellipse((380, y + 58, 480, y + 158), fill=COLORS["wine"])
        text(draw, (540, y + 48), title, COLORS["ink"], F["title"])
        text(draw, (540, y + 128), body, COLORS["brown"], F["body"])
    return im


SCREENS = [
    ("01-ipad-login-seguro.png", login_screen),
    ("02-ipad-credencial-qr.png", client_qr_screen),
    ("03-ipad-saldos-cliente.png", client_balances_screen),
    ("04-ipad-establecimientos.png", establishments_screen),
    ("05-ipad-solicitud-pago.png", payment_request_screen),
    ("06-ipad-cobro-proveedor.png", provider_charge_screen),
    ("07-ipad-pago-aprobado.png", provider_success_screen),
    ("08-ipad-checkin-hotel.png", hotel_checkin_screen),
    ("09-ipad-saldo-hospedaje.png", hotel_balance_screen),
    ("10-ipad-operacion-segura.png", security_screen),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for filename, factory in SCREENS:
        im = factory()
        assert im.size == (W, H)
        im.save(OUT / filename, "PNG", optimize=True)
        print(OUT / filename)


if __name__ == "__main__":
    main()

