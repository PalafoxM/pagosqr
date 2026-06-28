from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app-store-screenshots" / "ios-6-5-1242x2688"
W, H = 1242, 2688

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
    path = Path("C:/Windows/Fonts") / name
    return ImageFont.truetype(str(path), size)


F = {
    "hero": font(72, True),
    "title": font(56, True),
    "subtitle": font(34),
    "label": font(26, True),
    "body": font(30),
    "small": font(22, True),
    "money": font(66, True),
    "button": font(30, True),
}


def rounded(draw, box, fill, outline=None, width=1, radius=28):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, fill=COLORS["ink"], fnt=None, anchor=None):
    draw.text(xy, value, fill=fill, font=fnt or F["body"], anchor=anchor)


def center_text(draw, y, value, fill=COLORS["ink"], fnt=None):
    draw.text((W // 2, y), value, fill=fill, font=fnt or F["body"], anchor="ma", align="center")


def wrap_text(draw, value, max_width, fnt):
    words = value.split()
    lines = []
    line = ""
    for word in words:
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=fnt) <= max_width:
            line = test
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def paste_cover(base, path, alpha=0.30):
    img = Image.open(path).convert("RGB")
    scale = max(W / img.width, H / img.height)
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    left = (img.width - W) // 2
    top = (img.height - H) // 2
    img = img.crop((left, top, left + W, top + H))
    overlay = Image.new("RGB", (W, H), COLORS["black"])
    blended = Image.blend(img, overlay, 1 - alpha)
    base.paste(blended)


def make_base(bg=None):
    im = Image.new("RGB", (W, H), COLORS["paper"])
    if bg and bg.exists():
        paste_cover(im, bg)
    draw = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H
        r = int(243 * (1 - t) + 36 * t)
        g = int(234 * (1 - t) + 22 * t)
        b = int(213 * (1 - t) + 15 * t)
        draw.line((0, y, W, y), fill=(r, g, b))
    if bg and bg.exists():
        paste_cover(im, bg, alpha=0.35)
    return im


def phone_shell(draw):
    rounded(draw, (92, 205, 1150, 2515), COLORS["cream"], COLORS["gold"], 6, 70)
    rounded(draw, (126, 255, 1116, 2465), COLORS["paper"], COLORS["ink"], 3, 44)
    rounded(draw, (438, 225, 804, 258), COLORS["ink"], None, 1, 18)


def logo(draw, x, y, size=140):
    rounded(draw, (x, y, x + size, y + size), COLORS["wine"], COLORS["gold"], 5, size // 2)
    text(draw, (x + size / 2, y + size / 2 - 20), "FIC", COLORS["cream"], font(size // 3, True), "ma")
    draw.line((x + 24, y + size - 38, x + size - 24, y + 38), fill=COLORS["gold"], width=8)


def header(draw, title, subtitle=None):
    logo(draw, 164, 318, 128)
    text(draw, (324, 330), title, COLORS["ink"], F["title"])
    if subtitle:
        text(draw, (324, 398), subtitle, COLORS["brown"], F["subtitle"])


def app_frame(title, subtitle=None, bg=None):
    im = make_base(bg)
    draw = ImageDraw.Draw(im)
    phone_shell(draw)
    header(draw, title, subtitle)
    return im, draw


def balance_card(draw, y, label, amount, hint=None):
    rounded(draw, (180, y, 1062, y + 250), COLORS["ink"], COLORS["gold"], 4, 26)
    text(draw, (220, y + 42), label.upper(), COLORS["gold"], F["label"])
    text(draw, (220, y + 94), amount, COLORS["cream"], F["money"])
    if hint:
        text(draw, (220, y + 180), hint, COLORS["sand"], F["body"])


def pill(draw, box, label, active=False):
    fill = COLORS["wine"] if active else "#f9efd9"
    color = COLORS["cream"] if active else COLORS["ink"]
    rounded(draw, box, fill, COLORS["gold"], 3, 22)
    draw.text(((box[0] + box[2]) // 2, (box[1] + box[3]) // 2 - 18), label, fill=color, font=F["button"], anchor="ma")


def qr_pattern(draw, x, y, size):
    rounded(draw, (x, y, x + size, y + size), COLORS["cream"], COLORS["ink"], 4, 20)
    cell = size // 17
    points = [(1, 1), (11, 1), (1, 11)]
    for px, py in points:
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
    center_text(draw, 250, "Pagos FIC 2026", COLORS["cream"], F["hero"])
    center_text(draw, 335, "Credencial, pagos y beneficios en una app", COLORS["sand"], F["subtitle"])
    rounded(draw, (150, 620, 1092, 1510), "#192342", COLORS["gold"], 3, 34)
    logo(draw, 521, 690, 200)
    center_text(draw, 940, "Inicio de sesión seguro", COLORS["cream"], F["title"])
    rounded(draw, (230, 1060, 1012, 1140), "#2a355f", COLORS["gold"], 2, 18)
    text(draw, (260, 1082), "Usuario", COLORS["sand"], F["body"])
    rounded(draw, (230, 1180, 1012, 1260), "#2a355f", COLORS["gold"], 2, 18)
    text(draw, (260, 1202), "Contrasenia", COLORS["sand"], F["body"])
    rounded(draw, (230, 1320, 1012, 1410), COLORS["wine"], None, 1, 20)
    center_text(draw, 1342, "ADENTRARSE", COLORS["cream"], F["button"])
    center_text(draw, 1815, "Protegido con sesión privada", COLORS["cream"], F["title"])
    return im


def client_qr_screen():
    im, draw = app_frame("Hola, cliente", "Tu acceso FIC", ROOT / "images" / "Quijote3.jpg")
    balance_card(draw, 585, "Saldo disponible", "$1,250.00")
    rounded(draw, (250, 925, 992, 1667), "#f6e8c8", COLORS["gold"], 5, 32)
    qr_pattern(draw, 342, 1017, 558)
    center_text(draw, 1760, "Muestra tu QR para pagar o hacer check-in", COLORS["ink"], F["title"])
    return im


def client_balances_screen():
    im, draw = app_frame("Mis saldos", "Alimentos y hospedaje", ROOT / "images" / "Quijote4.jpg")
    balance_card(draw, 600, "Saldo disponible", "$840.00", "Para consumos en establecimientos")
    balance_card(draw, 900, "Saldo hospedaje", "$3,600.00", "Tarifa noche: $900.00")
    rounded(draw, (180, 1270, 1062, 1570), "#f9efd9", COLORS["gold"], 3, 26)
    text(draw, (230, 1320), "Beneficios activos", COLORS["wine"], F["label"])
    text(draw, (230, 1382), "Alimentos: activo", COLORS["ink"], F["body"])
    text(draw, (230, 1438), "Hospedaje: activo", COLORS["ink"], F["body"])
    return im


def establishments_screen():
    im, draw = app_frame("Establecimientos", "Encuentra comercios FIC")
    for i, (name, location) in enumerate([
        ("Cafe Cervantino", "Zona centro"),
        ("Restaurante FIC", "Teatro principal"),
        ("Tienda oficial", "Explanada"),
    ]):
        y = 610 + i * 270
        rounded(draw, (180, y, 1062, y + 210), "#f9efd9", COLORS["gold"], 3, 24)
        text(draw, (230, y + 38), name, COLORS["ink"], F["title"])
        text(draw, (230, y + 110), location, COLORS["brown"], F["body"])
        pill(draw, (800, y + 108, 1015, y + 170), "Mapa", True)
    center_text(draw, 1650, "Consulta ubicaciones y puntos autorizados", COLORS["ink"], F["subtitle"])
    return im


def payment_request_screen():
    im, draw = app_frame("Solicitud de pago", "Aceptar o rechazar")
    rounded(draw, (180, 620, 1062, 1340), COLORS["ink"], COLORS["gold"], 4, 30)
    text(draw, (235, 680), "Proveedor FIC", COLORS["gold"], F["label"])
    text(draw, (235, 750), "Cafe Cervantino", COLORS["cream"], F["title"])
    text(draw, (235, 830), "Consumo en establecimiento", COLORS["sand"], F["body"])
    text(draw, (235, 960), "Total", COLORS["sand"], F["body"])
    text(draw, (235, 1030), "$287.50", COLORS["cream"], F["money"])
    pill(draw, (235, 1180, 600, 1265), "Rechazar", False)
    pill(draw, (645, 1180, 1010, 1265), "Aprobar", True)
    center_text(draw, 1510, "Sin opción de después: decisión clara", COLORS["ink"], F["title"])
    return im


def provider_charge_screen():
    im, draw = app_frame("Nuevo cobro", "Escanea y envía notificación")
    rounded(draw, (180, 600, 1062, 760), "#f9efd9", COLORS["gold"], 3, 22)
    text(draw, (230, 635), "Cliente", COLORS["wine"], F["label"])
    text(draw, (230, 685), "Maria Gonzalez", COLORS["ink"], F["body"])
    rounded(draw, (180, 820, 1062, 940), "#f9efd9", COLORS["gold"], 3, 22)
    text(draw, (230, 855), "Monto: $250.00", COLORS["ink"], F["title"])
    for i, label in enumerate(["0%", "5%", "10%", "15%"]):
        pill(draw, (180 + i * 225, 1015, 380 + i * 225, 1095), label, label == "15%")
    text(draw, (180, 1160), "Propina calculada: $37.50", COLORS["ink"], F["body"])
    rounded(draw, (180, 1320, 1062, 1490), COLORS["ink"], COLORS["gold"], 4, 24)
    text(draw, (230, 1355), "Total a cobrar", COLORS["gold"], F["label"])
    text(draw, (230, 1405), "$287.50", COLORS["cream"], F["money"])
    return im


def provider_success_screen():
    im, draw = app_frame("Pago realizado", "Confirmacion inmediata")
    rounded(draw, (280, 670, 962, 1352), "#dcfce7", "#15803d", 5, 36)
    draw.ellipse((465, 780, 777, 1092), fill=COLORS["green"])
    draw.line((540, 940, 620, 1025, 720, 855), fill=COLORS["cream"], width=28)
    center_text(draw, 1160, "Pago aprobado", COLORS["ink"], F["title"])
    center_text(draw, 1230, "Folio TX-2026-0418", COLORS["brown"], F["subtitle"])
    balance_card(draw, 1530, "Saldo actualizado", "$962.50")
    return im


def hotel_checkin_screen():
    im, draw = app_frame("Hotel FIC", "Check-in con QR")
    rounded(draw, (245, 620, 997, 1372), COLORS["ink"], COLORS["gold"], 5, 36)
    qr_pattern(draw, 392, 760, 458)
    center_text(draw, 1450, "Escanea el QR del cliente", COLORS["ink"], F["title"])
    rounded(draw, (180, 1590, 1062, 1710), COLORS["wine"], None, 1, 22)
    center_text(draw, 1618, "REGISTRAR CHECK-IN", COLORS["cream"], F["button"])
    return im


def hotel_balance_screen():
    im, draw = app_frame("Hospedaje", "Descuento automatico")
    rounded(draw, (180, 620, 1062, 900), "#dcfce7", "#15803d", 4, 28)
    text(draw, (230, 675), "Check-in registrado", "#14532d", F["title"])
    text(draw, (230, 755), "Cliente: Maria Gonzalez", "#166534", F["body"])
    text(draw, (230, 815), "Tarifa descontada: $900.00", "#166534", F["body"])
    balance_card(draw, 1040, "Saldo hospedaje restante", "$2,700.00")
    center_text(draw, 1475, "Control claro para recepcion", COLORS["ink"], F["title"])
    return im


def security_screen():
    im, draw = app_frame("Operacion segura", "Tokens y sesiones protegidas")
    items = [
        ("Login sanitizado", "Entradas validadas y tiempo limite"),
        ("Push tokens reforzados", "Registro por usuario y dispositivo"),
        ("Pagos con decision", "Aceptar o rechazar sin pasos extra"),
    ]
    for i, (title, body) in enumerate(items):
        y = 650 + i * 260
        rounded(draw, (180, y, 1062, y + 190), "#f9efd9", COLORS["gold"], 3, 24)
        draw.ellipse((225, y + 48, 315, y + 138), fill=COLORS["wine"])
        text(draw, (345, y + 42), title, COLORS["ink"], F["title"])
        text(draw, (345, y + 112), body, COLORS["brown"], F["body"])
    return im


SCREENS = [
    ("01-login-seguro.png", login_screen),
    ("02-credencial-qr.png", client_qr_screen),
    ("03-saldos-cliente.png", client_balances_screen),
    ("04-establecimientos.png", establishments_screen),
    ("05-solicitud-pago.png", payment_request_screen),
    ("06-cobro-proveedor.png", provider_charge_screen),
    ("07-pago-aprobado.png", provider_success_screen),
    ("08-checkin-hotel.png", hotel_checkin_screen),
    ("09-saldo-hospedaje.png", hotel_balance_screen),
    ("10-operacion-segura.png", security_screen),
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

