import re,html,sys
for f in sys.argv[1:]:
    t=open(f,encoding='utf8',errors='replace').read()
    t=re.sub(r'(?s)<script.*?</script>','',t); t=re.sub(r'(?s)<style.*?</style>','',t)
    t=re.sub(r'<(td|th)[^>]*>','\t',t)
    t=re.sub(r'<[^>]+>','\n',t)
    t=html.unescape(t).replace('\xa0',' ')
    lines=[re.sub(r'[ ]+',' ',l).strip() for l in t.split('\n')]
    lines=[l for l in lines if l]
    print('=====',f)
    print('\n'.join(lines))
