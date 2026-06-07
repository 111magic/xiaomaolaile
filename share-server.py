#!/usr/bin/env python3
"""
喵了个咪 — 多人共享服务器
单端口 HTTP + WebSocket
"""

import asyncio, json, time, hashlib
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

from websockets.asyncio.server import serve
from websockets.http11 import Response, Headers

PORT = 8765
ROOT = Path(__file__).parent

clients = {}       # ws → {uid, name}
client_names = {}  # uid → name
msg_queue = []
MAX_QUEUE = 300

def add_msg(mt, fuid, fname, tuid, **kw):
    m = {'type': mt, 'fromUid': fuid, 'fromName': fname, 'toUid': tuid,
         'ts': int(time.time() * 1000), **kw}
    msg_queue.append(m)
    if len(msg_queue) > MAX_QUEUE: msg_queue.pop(0)

def get_msgs_for(uid, since):
    return [m for m in msg_queue if m['ts'] > since and (m['toUid'] in ('', uid) or m['fromUid'] == uid or m['toUid'] == uid)]

async def broadcast(md, skip=None):
    s = json.dumps(md, ensure_ascii=False)
    dead = set()
    for ws in list(clients):
        if ws is skip: continue
        try: await ws.send(s)
        except: dead.add(ws)
    for ws in dead:
        if ws in clients:
            u = clients[ws]['uid']; n = clients[ws].get('name','')
            del clients[ws]
            if u in client_names: del client_names[u]
            await broadcast({'type':'user_offline','data':{'uid':u,'name':n},'ts':int(time.time()*1000)})

async def send_one(uid, md):
    for ws, info in clients.items():
        if info.get('uid') == uid:
            try: await ws.send(json.dumps(md, ensure_ascii=False))
            except: pass
            return

# ====== WebSocket handler ======
async def ws_handler(websocket):
    ui = {'uid':'','name':''}
    clients[websocket] = ui
    try:
        async for raw in websocket:
            try:
                m = json.loads(raw); t = m.get('type',''); d = m.get('data',{}); ts = int(time.time()*1000)
                if t == 'login':
                    uid = d.get('uid','') or 'cat_'+hashlib.md5(str(time.time()).encode()).hexdigest()[:8]
                    name = d.get('name','猫友')
                    ui['uid'] = uid; ui['name'] = name
                    client_names[uid] = name
                    await websocket.send(json.dumps({'type':'online_list',
                        'data':[{'uid':u,'name':n} for u,n in client_names.items() if u!=uid],'ts':ts}, ensure_ascii=False))
                    await broadcast({'type':'user_online','data':{'uid':uid,'name':name},'ts':ts}, skip=websocket)
                    add_msg('user_online', uid, name, '')
                    print(f'🟢 {name} ({uid}) — {len(clients)}人在线')
                elif t == 'command':
                    to_uid = d.get('toUid',''); cmds = d.get('commands',[])
                    payload = {'fromUid':ui['uid'],'fromName':ui['name'],'toUid':to_uid,'commands':cmds}
                    await send_one(to_uid, {'type':'receive_command','data':payload,'ts':ts})
                    add_msg('receive_command', ui['uid'], ui['name'], to_uid, commands=cmds)
                    print(f'🎮 {ui["name"]} → {to_uid}: {cmds}')
                elif t == 'relay':
                    to_uid = d.get('toUid',''); msg = d.get('message','')
                    payload = {'fromUid':ui['uid'],'fromName':ui['name'],'toUid':to_uid,'message':msg}
                    await send_one(to_uid, {'type':'receive_relay','data':payload,'ts':ts})
                    add_msg('receive_relay', ui['uid'], ui['name'], to_uid, message=msg)
                    print(f'💬 {ui["name"]} → {to_uid}: {msg}')
                elif t == 'chat':
                    text = d.get('text','')
                    payload = {'fromUid':ui['uid'],'fromName':ui['name'],'toUid':'','text':text}
                    await broadcast({'type':'receive_chat','data':payload,'ts':ts}, skip=websocket)
                    add_msg('receive_chat', ui['uid'], ui['name'], '', text=text)
                elif t == 'announce':
                    payload = {'fromUid':ui.get('uid',''),'fromName':ui.get('name',''),
                               'message':d.get('message',''),'emoji':d.get('emoji','🐱')}
                    await broadcast({'type':'agent_announce','data':payload,'ts':ts}, skip=websocket)
                    add_msg('agent_announce', '', ui.get('name',''), '', message=d.get('message',''), emoji=d.get('emoji','🐱'))
                elif t == 'ping':
                    await websocket.send(json.dumps({'type':'pong','data':None,'ts':int(time.time()*1000)}))
            except json.JSONDecodeError: pass
            except Exception as e: print(f'WS err: {e}')
    except: pass
    finally:
        uid = ui.get('uid',''); name = ui.get('name','')
        if websocket in clients: del clients[websocket]
        # 保留一段时间再清理（给轮询缓冲）
        if uid and uid in client_names:
            still = any(i.get('uid')==uid for i in clients.values())
            if not still:
                # 延迟清理
                async def cleanup():
                    await asyncio.sleep(30)
                    if uid in client_names:
                        still2 = any(i.get('uid')==uid for i in clients.values())
                        if not still2: del client_names[uid]
                asyncio.create_task(cleanup())
        if name: print(f'🔴 {name} 下线')


# ====== MIME ======
MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8',
        '.json':'application/json; charset=utf-8','.png':'image/png','.gif':'image/gif','.jpg':'image/jpeg',
        '.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
        '.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'}

# ====== HTTP process_request ======
async def process_request(connection, request):
    path = unquote(request.path)    # ★ 解码 %E7%8C%AB 等中文文件名
    headers = request.headers

    # ★ WebSocket 升级 → 放行
    conn = headers.get('Connection','') + headers.get('connection','')
    upg = headers.get('Upgrade','') + headers.get('upgrade','')
    if 'upgrade' in conn.lower() or 'websocket' in upg.lower():
        return None

    # ★ 轮询 API（GET only）
    if path.startswith('/api/poll'):
        parsed = urlparse(path)
        qs = parse_qs(parsed.query or '')
        uid = qs.get('uid',[''])[0]
        since = int(qs.get('since',['0'])[0])
        msgs = get_msgs_for(uid, since)
        online = [{'uid':u,'name':n} for u,n in client_names.items() if u!=uid]
        body = json.dumps({'msgs':msgs,'online':online,'server_ts':int(time.time()*1000)}, ensure_ascii=False).encode()
        return Response(200,'OK', headers=Headers({'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-cache'}), body=body)

    # ★ 静态文件
    if path == '/' or path == '/share': path = '/share.html'
    fp = None
    if path == '/share.html': fp = ROOT/'share.html'
    elif path.startswith('/assets/'): fp = ROOT/path.lstrip('/')
    else:
        c = ROOT/path.lstrip('/')
        if c.exists() and c.is_file(): fp = c

    if fp and fp.exists() and fp.is_file():
        ct = MIME.get(fp.suffix.lower(), 'application/octet-stream')
        return Response(200,'OK', headers=Headers({'Content-Type':ct,'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=3600'}), body=fp.read_bytes())

    return Response(404,'Not Found', headers=Headers({'Content-Type':'text/plain; charset=utf-8','Access-Control-Allow-Origin':'*'}), body=b'Not Found')


async def main():
    print(f'\n🐱 喵了个咪服务器 v4\n   本地: http://localhost:{PORT}\n')
    async with serve(ws_handler, host='0.0.0.0', port=PORT, process_request=process_request, ping_interval=20, ping_timeout=10, max_size=2**20):
        print('✅ 已启动\n')
        await asyncio.Future()

if __name__ == '__main__':
    asyncio.run(main())
