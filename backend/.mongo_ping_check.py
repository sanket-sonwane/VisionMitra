from pathlib import Path
from pymongo import MongoClient
import pymongo
print('pymongo', pymongo.__version__)

env = {}
for line in Path('.env').read_text(encoding='utf-8').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k,v=line.split('=',1)
    env[k.strip()]=v.strip().strip('"').strip("'")
uri=env['MONGO_URL']

try:
    c = MongoClient(uri, serverSelectionTimeoutMS=12000)
    print('ping', c.admin.command('ping').get('ok'))
except Exception as e:
    print(type(e).__name__, str(e)[:400])
