import re,html,sys,glob
for f in sorted(sys.argv[1:]):
    t=open(f,encoding='utf8',errors='replace').read()
    dest=re.search(r'Destination Charge:\s*\$([\d,]+)', t)
    # pricing table rows: Model | Description | MSRP
    body=t
    rows=[]
    for m in re.finditer(r'<tr[^>]*>(.*?)</tr>', body, re.S):
        cells=[re.sub(r'<[^>]+>','',c).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', m.group(1), re.S)]
        cells=[html.unescape(c).replace('\xa0',' ').strip() for c in cells]
        if len(cells)==3 and re.match(r'^\$[\d,]+\.\d\d$', cells[2]) and cells[0] and 'Package' not in cells[0]:
            rows.append(cells)
    print('==',f,'dest=',dest.group(1) if dest else None)
    for r in rows[:8]: print('   ',r)
