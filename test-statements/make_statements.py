"""Synthetic CAS statements for testing Goalden's statement import. Every name, number and code is made up.
Layouts follow the public structure of a CAMS/KFintech detailed CAS and an NSDL CAS (as casparser reads them):
lines of positioned text, columns under headings. Output is password-protected like the real ones.
Usage: python make_statements.py <outdir>"""
import sys, os, math, random, datetime as dt
import fitz

OUT = sys.argv[1]
PW = 'ABCDE1234F'          # a made-up PAN-shaped test password
FONT = 'helv'
W, H = 595, 842


class Doc:
    def __init__(self):
        self.doc = fitz.open()
        self.page = None
        self.y = 0
        self.new_page()

    def new_page(self):
        self.page = self.doc.new_page(width=W, height=H)
        self.y = 50
        self.text(40, 'SYNTHETIC TEST STATEMENT - NOT A REAL ACCOUNT', 7)
        self.y += 12

    def need(self, h):
        if self.y + h > H - 50:
            self.new_page()

    def text(self, x, s, size=8, right=False, center=False):
        w = fitz.get_text_length(s, fontname=FONT, fontsize=size)
        if right:
            x -= w
        elif center:
            x -= w / 2
        self.page.insert_text((x, self.y), s, fontname=FONT, fontsize=size)

    def line(self, parts, size=8, gap=11):
        self.need(gap)
        for p in parts:
            x, s = p[0], p[1]
            mode = p[2] if len(p) > 2 else ''
            self.text(x, s, size, right=(mode == 'r'), center=(mode == 'c'))
        self.y += gap

    def save(self, name):
        path = os.path.join(OUT, name)
        self.doc.save(path, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw=PW, owner_pw=PW + '-owner', permissions=fitz.PDF_PERM_PRINT)
        print('wrote', path, len(self.doc), 'pages')


def inr(v, d=2):
    neg = v < 0
    v = abs(v)
    s = f'{v:.{d}f}'
    whole, frac = s.split('.') if d else (s, '')
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ','.join(groups) + ',' + tail
    s = whole + ('.' + frac if d else '')
    return '(' + s + ')' if neg else s


def dfmt(d):
    return d.strftime('%d-%b-%Y')


def nav_path(start, years_growth, seed, start_date, end_date):
    rnd = random.Random(seed)
    navs = {}
    d, v = start_date, start
    daily = (1 + years_growth) ** (1 / 365) - 1
    while d <= end_date:
        v *= 1 + daily + rnd.gauss(0, 0.009)
        navs[d] = round(v, 4)
        d += dt.timedelta(days=1)
    return navs


def month_starts(a, b, day=5):
    out = []
    y, m = a.year, a.month
    while True:
        d = dt.date(y, m, day)
        if d > b:
            break
        if d >= a:
            out.append(d)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


AS_OF = dt.date(2026, 10, 23)
START = dt.date(2019, 1, 1)


def cams():
    D = Doc()
    D.line([(40, 'Consolidated Account Statement', '')], 13, 18)
    D.line([(40, dfmt(START) + ' To ' + dfmt(AS_OF))], 9, 14)
    D.line([(40, 'Example Investor')], 9)
    D.line([(40, '1 Test Street, Testville 000000')], 8, 16)
    funds = [
        dict(amc='Example Mutual Fund', code='B205', name='Example Flexi Cap Fund - Regular Plan - Growth', isin='INF000X01011', nav0=40, g=0.13, seed=1,
             sip=(dt.date(2019, 2, 5), AS_OF, 5000), redeem=[(dt.date(2023, 6, 12), 60000)]),
        dict(amc='Example Mutual Fund', code='B310', name='Example Nifty 50 Index Fund - Direct Plan - Growth', isin='INF000X01029', nav0=100, g=0.12, seed=2,
             lump=[(dt.date(2020, 3, 24), 100000)], sip=(dt.date(2024, 1, 5), AS_OF, 3000)),
        dict(amc='Sample Asset Management', code='S12', name='Sample Long Name Asset Management Small Cap Opportunities Fund - Direct Plan - Growth Option', isin='INF000Y01017', nav0=20, g=0.18, seed=3,
             sip=(dt.date(2022, 4, 5), AS_OF, 2000), wrap=True),
        dict(amc='Sample Asset Management', code='S40', name='Sample Liquid Fund - Direct Plan - Growth', isin='INF000Y01025', nav0=2500, g=0.065, seed=4,
             lump=[(dt.date(2025, 6, 2), 50000)]),
        dict(amc='Test Mutual Fund', code='T07', name='Test Mid Cap Fund - Regular Plan - IDCW Reinvestment', isin='INF000Z01013', nav0=30, g=0.15, seed=5,
             lump=[(dt.date(2019, 5, 6), 40000)], reinvest=[(dt.date(2020, 3, 2), 1200), (dt.date(2021, 3, 1), 1500)], close_all=dt.date(2024, 2, 14)),
        dict(amc='Test Mutual Fund', code='T15', name='Test Large Cap Fund - Direct Plan - Growth', isin='INF000Z01021', nav0=55, g=0.11, seed=6,
             lump=[(dt.date(2026, 3, 16), 25000)]),
    ]
    blocks, summary = [], {}
    for f in funds:
        navs = nav_path(f['nav0'], f['g'], f['seed'], START, AS_OF)
        tx = []
        for d, a in f.get('lump', []):
            tx.append((d, 'Purchase', a))
        if f.get('sip'):
            a, b, amt = f['sip']
            for d in month_starts(a, b):
                tx.append((d, 'Purchase - Systematic - Instalment', amt))
        for d, a in f.get('redeem', []):
            tx.append((d, 'Redemption', -a))
        for d, a in f.get('reinvest', []):
            tx.append((d, 'IDCW Reinvestment @ Rs.1.00 per unit', a, 'reinv'))
        if f.get('close_all'):
            tx.append((f['close_all'], 'Redemption', None))
        tx.sort(key=lambda t: t[0])
        bal, rows, cost = 0.0, [], 0.0
        for t in tx:
            d, desc, a = t[0], t[1], t[2]
            nav = navs[d]
            if a is None:
                units = -round(bal, 3)
                a = round(units * nav, 2)
            else:
                units = round(a / nav, 3)
            bal = round(bal + units, 3)
            rows.append((d, desc, a, units, nav, bal))
            if a > 0 and d >= dt.date(2020, 7, 1) and len(t) < 4:
                rows.append((d, '*** Stamp Duty ***', round(a * 0.00005, 2)))
        nav_end = navs[AS_OF]
        value = round(bal * nav_end, 2)
        # remaining cost, first in first out
        lots = []
        for r in rows:
            if len(r) < 6:
                continue
            d, desc, a, u = r[0], r[1], r[2], r[3]
            if u > 0:
                lots.append([u, abs(a)])
            else:
                left = -u
                while left > 1e-9 and lots:
                    take = min(left, lots[0][0])
                    lots[0][1] -= lots[0][1] * take / lots[0][0]
                    lots[0][0] -= take
                    left -= take
                    if lots[0][0] <= 1e-9:
                        lots.pop(0)
        cost = round(sum(l[1] for l in lots), 2)
        blocks.append((f, rows, bal, nav_end, cost, value))
        s = summary.setdefault(f['amc'], [0, 0])
        s[0] += cost
        s[1] += value
    D.line([(40, 'PORTFOLIO SUMMARY')], 10, 14)
    D.line([(40, 'Mutual Fund'), (380, 'Cost Value', 'r'), (520, 'Market Value', 'r')], 8)
    for amc, (c, v) in summary.items():
        D.line([(40, amc), (380, inr(c), 'r'), (520, inr(v), 'r')])
    tc, tv = sum(c for c, v in summary.values()), sum(v for c, v in summary.values())
    D.line([(40, 'Total'), (380, inr(tc), 'r'), (520, inr(tv), 'r')], 8, 20)
    last_amc = None
    for f, rows, bal, nav_end, cost, value in blocks:
        if f['amc'] != last_amc:
            D.line([(40, f['amc'])], 10, 14)
            last_amc = f['amc']
        D.line([(40, 'Folio No: 1234567 / 89'), (200, 'PAN: ' + PW), (330, 'KYC: OK'), (400, 'PAN: OK')])
        D.line([(40, 'Example Investor')])
        head = f['code'] + '-' + f['name']
        if f.get('wrap'):
            D.line([(40, head)])
            D.line([(40, '- ISIN: ' + f['isin'] + '(Advisor: DIRECT)'), (430, 'Registrar : CAMS')])
        else:
            D.line([(40, head + ' - ISIN: ' + f['isin'] + '(Advisor: ARN-000000)'), (470, 'Registrar : CAMS')], 7.5)
        D.line([(40, 'Nominee 1: Test Nominee'), (220, 'Nominee 2:'), (330, 'Nominee 3:')])
        D.line([(40, 'Opening Unit Balance: 0.000')])
        D.line([(40, 'Date'), (100, 'Transaction'), (330, 'Amount', 'r'), (400, 'Units', 'r'), (470, 'NAV', 'r'), (545, 'Unit Balance', 'r')], 7.5)
        D.line([(330, '(INR)', 'r'), (470, '(INR)', 'r')], 7.5)
        for r in rows:
            if len(r) == 3:
                D.line([(40, dfmt(r[0])), (100, r[1]), (330, inr(r[2]), 'r')])
            else:
                d, desc, a, u, nav, b = r
                D.line([(40, dfmt(d)), (100, desc), (330, inr(a), 'r'), (400, inr(u, 3), 'r'), (470, inr(nav, 4), 'r'), (545, inr(b, 3), 'r')])
        D.line([(40, 'Closing Unit Balance: ' + inr(bal, 3)), (180, 'NAV on ' + dfmt(AS_OF) + ': INR ' + inr(nav_end, 4)),
                (330, 'Total Cost Value: ' + inr(cost)), (430, 'Market Value on ' + dfmt(AS_OF) + ': INR ' + inr(value))], 6.5, 18)
    D.save('synthetic-cams-detailed.pdf')
    return tv


def nsdl():
    D = Doc()
    D.line([(40, 'NSDL Consolidated Account Statement')], 13, 18)
    D.line([(40, 'Statement for the period from 01-Sep-2026 to 30-Sep-2026')], 9, 14)
    D.line([(40, 'Example Investor'), (300, 'PAN: ' + PW)], 9, 16)
    eq = [('INE000A01011', 'EXBANK', 'EXAMPLE BANK LIMITED', 1, 100, 1650.25),
          ('INE000B01019', 'SAMPLEIT', 'SAMPLE INFOTECH LIMITED', 5, 40, 1489.6),
          ('INE000C01017', 'TESTPOW', 'TEST POWER GENERATION AND TRANSMISSION CORPORATION OF INDIA LIMITED', 10, 300, 312.4),
          ('INF000E01012', 'EXNIFTY', 'EXAMPLE NIFTY 50 ETF', 1, 500, 265.1),
          ('INF000E01020', 'EXGOLD', 'EXAMPLE GOLD ETF', 1, 800, 78.35)]
    cols = [(40, 'ISIN'), (112, 'Stock'), (170, 'Company Name'), (330, 'Face Value'), (390, 'No. of'), (455, 'Market Price'), (530, 'Value')]
    sub = [(112, 'Symbol'), (330, '(₹)'), (390, 'Shares'), (455, '(₹)'), (530, '(₹)')]
    D.line([(40, 'NSDL Demat Account'), (220, 'DP ID: IN300000'), (330, 'Client ID: 10000000')], 9, 14)
    D.line([(40, 'Equities (E)')], 9, 13)
    D.line([(x, s, 'c' if x > 300 else '') for x, s in cols], 7.5, 9)
    D.line([(x, s, 'c' if x > 300 else '') for x, s in sub], 7.5, 11)
    total = 0
    for isin, sym, name, fv, q, p in eq:
        v = round(q * p, 2)
        total += v
        cut = name.rfind(' ', 0, 34) if len(name) >= 34 else len(name)
        D.line([(40, isin), (112, sym), (170, name[:cut]), (355, inr(fv), 'r'), (412, str(q), 'r'), (485, inr(p), 'r'), (560, inr(v), 'r')], 7.5)
        if cut < len(name):
            D.line([(170, name[cut:].strip())], 7.5)
    D.line([(40, 'Sub Total'), (560, inr(total), 'r')], 7.5, 16)
    D.line([(40, 'Government Securities (G)')], 9, 13)
    D.line([(40, 'ISIN'), (170, 'Security'), (390, 'No. of Units', 'c'), (455, 'Market Price (₹)', 'c'), (530, 'Value (₹)', 'c')], 7.5, 11)
    sg = ('IN0020210000', 'SGB 2.50% 2029 SR-IV', 10, 7350.0)
    v = round(sg[2] * sg[3], 2); total += v
    D.line([(40, sg[0]), (170, sg[1]), (412, str(sg[2]), 'r'), (485, inr(sg[3]), 'r'), (560, inr(v), 'r')], 7.5, 16)
    D.line([(40, 'Mutual Fund Folios (F)')], 9, 13)
    mcols = [(40, 'ISIN'), (95, 'UCC'), (135, 'ISIN Description'), (250, 'Folio No.'), (295, 'No. of Units'), (340, 'Average Cost'), (385, 'Total Cost'),
             (430, 'Current NAV'), (475, 'Current Value'), (520, 'Unrealised'), (560, 'Annualised')]
    msub = [(340, 'Per Unit (₹)'), (385, '(₹)'), (430, 'per unit (₹)'), (475, '(₹)'), (520, 'Profit/(Loss) (₹)'), (560, 'Return (%)')]
    D.line([(x, s, 'c' if x > 290 else '') for x, s in mcols], 6, 8)
    D.line([(x, s, 'c' if x > 290 else '') for x, s in msub], 6, 11)
    mf = [('INF000X01011', 'MFEX0001', 'EXAMPLE FLEXI CAP FUND - REGULAR PLAN - GROWTH', '1234567/89', 1500.0, 45.10, 71.85),
          ('INF000W01015', 'MFEX0002', 'WIDGET CORPORATE BOND FUND - DIRECT PLAN - GROWTH', '7654321', 2000.0, 30.0, 33.4)]
    for isin, ucc, nm, folio, u, ac, nav in mf:
        tc, cv = round(u * ac, 2), round(u * nav, 2)
        total += cv
        cut = nm.rfind(' ', 0, 26)
        D.line([(40, isin), (95, ucc), (135, nm[:cut]), (250, folio), (318, inr(u, 3), 'r'), (362, inr(ac), 'r'), (408, inr(tc), 'r'), (452, inr(nav, 4), 'r'),
                (498, inr(cv), 'r'), (543, inr(cv - tc), 'r'), (575, '9.80', 'r')], 6)
        D.line([(135, nm[cut:].strip())], 6)
    D.y += 6
    D.line([(40, 'CDSL Demat Account'), (220, 'DP ID: 12000000'), (330, 'BO ID: 1200000000000000')], 9, 14)
    D.line([(40, 'ISIN'), (130, 'Security'), (330, 'Current Bal', 'c'), (400, 'Free Bal', 'c'), (470, 'Market Price / Face Value', 'c'), (540, 'Value (₹)', 'c')], 7, 11)
    v = round(20 * 1650.25, 2); total += v
    D.line([(40, 'INE000A01011'), (130, 'EXAMPLE BANK LIMITED'), (350, '20.000', 'r'), (420, '20.000', 'r'), (495, inr(1650.25), 'r'), (568, inr(v), 'r')], 7, 16)
    D.line([(40, 'Grand Total'), (568, inr(total), 'r')], 8, 14)
    D.save('synthetic-nsdl.pdf')
    return total


os.makedirs(OUT, exist_ok=True)
print('cams total', cams())
print('nsdl total', nsdl())
