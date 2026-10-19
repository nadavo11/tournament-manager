"""Reset through the authenticated organizer API without printing credentials."""
import argparse,json,urllib.request,urllib.parse
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--url',default='http://127.0.0.1:8400')
p.add_argument('--tournament',type=int,default=1)
args=p.parse_args()
account=json.loads((Path(__file__).resolve().parent.parent/'.local/demo-accounts.json').read_text())['admin']
req=urllib.request.Request(args.url+'/api/token',data=urllib.parse.urlencode({'username':account['email'],'password':account['password']}).encode())
token=json.load(urllib.request.urlopen(req))['access_token']
req=urllib.request.Request(args.url+f'/api/live/tournaments/{args.tournament}/reset',data=b'',method='POST',headers={'Authorization':'Bearer '+token})
with urllib.request.urlopen(req) as r:
    print('Reset completed:',r.status)
