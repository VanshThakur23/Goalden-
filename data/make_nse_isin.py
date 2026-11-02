"""Builds data/nse-isin.json: every share listed on NSE, ISIN -> NSE symbol, from NSE's own EQUITY_L.csv.
The Lab uses it to open the shares on a demat statement (NSDL/CDSL CAS) in Test Real Investments, where prices
come from Yahoo Finance as SYMBOL.NS. A snapshot rather than a live fetch: NSE often refuses requests from
cloud servers, and listings change slowly. Re-run to refresh:  python data/make_nse_isin.py"""
import csv, io, json, os, urllib.request, datetime

URL = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv'
req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
with urllib.request.urlopen(req, timeout=60) as res:
    text = res.read().decode('utf-8', 'replace')
rows = list(csv.reader(io.StringIO(text)))
head = [h.strip().upper() for h in rows[0]]
i_sym, i_isin, i_series = head.index('SYMBOL'), head.index('ISIN NUMBER'), head.index('SERIES')
m = {}
for r in rows[1:]:
    if len(r) <= i_isin:
        continue
    isin, sym = r[i_isin].strip(), r[i_sym].strip()
    if isin.startswith('IN') and len(isin) == 12 and sym and r[i_series].strip() in ('EQ', 'BE', 'BZ', 'SM', 'ST'):
        m[isin] = sym
out = {'source': URL, 'asOf': datetime.date.today().isoformat(), 'count': len(m), 'map': m}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nse-isin.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, separators=(',', ':'), sort_keys=True)
print('wrote', path, len(m), 'shares')
