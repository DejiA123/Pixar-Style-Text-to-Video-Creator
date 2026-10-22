import urllib.parse, json, sys
# usage: python3 dev/q.py '<json cast>' '<json grid>' extra
cast = sys.argv[1]; grid = sys.argv[2] if len(sys.argv) > 2 else ''
extra = sys.argv[3] if len(sys.argv) > 3 else ''
q = 'dev/lab.html?' + extra + '&cast=' + urllib.parse.quote(cast)
if grid: q += '&grid=' + urllib.parse.quote(grid)
print(q)
