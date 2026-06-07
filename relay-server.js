/**
 * 互动中转服务器 — 支持猫咪 + AI Agent 多人接入
 *
 * 启动: node relay-server.js
 * 端口: 9527 (WebSocket) + 9528 (HTTP API)
 */

const WebSocket = require('ws');
const http = require('http');

const WS_PORT = 9527;
const API_PORT = 9528;

// 在线客户端
const clients = new Map();   // ws → { uid, name, type }
const AGENTS = new Map();    // 在线 AI 智能体

function broadcast(type, data, exclude) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  clients.forEach((_, ws) => {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function getUserList() {
  const list = [];
  clients.forEach((info) => list.push({ uid: info.uid, name: info.name, type: info.type }));
  AGENTS.forEach((info) => list.push({ uid: info.uid, name: info.name, type: 'agent' }));
  return list;
}

// ====== WebSocket 服务器 ======
const wsServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🐱 喵了个咪 WebSocket 服务器\n用户: ' + clients.size + ' | AI Agent: ' + AGENTS.size + '\n');
});

const wss = new WebSocket.Server({ server: wsServer });

wss.on('connection', (ws) => {
  let userInfo = { uid: '', name: '', type: 'cat' };

  ws.on('message', (raw) => {
    try {
      const { type, data } = JSON.parse(raw.toString());

      switch (type) {
        case 'login':
          userInfo = { uid: data.uid, name: data.name, type: data.type || 'cat' };
          clients.set(ws, userInfo);
          if (userInfo.type === 'agent') AGENTS.set(userInfo.uid, { ws, ...userInfo });
          console.log(`🐱 ${data.name} (${userInfo.type}) 上线 (${clients.size} 人在线)`);
          ws.send(JSON.stringify({ type: 'online_list', data: getUserList(), ts: Date.now() }));
          broadcast('user_online', { uid: data.uid, name: data.name, type: userInfo.type }, ws);
          break;

        case 'command':
          clients.forEach((info, clientWs) => {
            if (info.uid === data.toUid && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'receive_command',
                data: {
                  fromUid: userInfo.uid, fromName: userInfo.name,
                  fromType: userInfo.type,
                  toUid: data.toUid, commands: data.commands,
                },
                ts: Date.now(),
              }));
            }
          });
          break;

        case 'relay':
          clients.forEach((info, clientWs) => {
            if (info.uid === data.toUid && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'receive_relay',
                data: {
                  fromUid: userInfo.uid, fromName: userInfo.name,
                  fromType: userInfo.type,
                  toUid: data.toUid, message: data.message,
                },
                ts: Date.now(),
              }));
            }
          });
          break;

        case 'chat':
          clients.forEach((info, clientWs) => {
            if (info.uid === data.toUid && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'receive_chat',
                data: {
                  fromUid: userInfo.uid, fromName: userInfo.name,
                  fromType: userInfo.type,
                  toUid: data.toUid, text: data.text,
                },
                ts: Date.now(),
              }));
            }
          });
          break;

        // AI Agent 专属：向全员广播系统消息
        case 'announce':
          if (userInfo.type !== 'agent') break;
          broadcast('agent_announce', {
            fromUid: userInfo.uid, fromName: userInfo.name,
            message: data.message, emoji: data.emoji || '🤖',
          });
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', data: null, ts: Date.now() }));
          break;
      }
    } catch (e) {
      console.error('消息解析失败:', e.message);
    }
  });

  ws.on('close', () => {
    if (userInfo.name) {
      console.log(`��� ${userInfo.name} 下线`);
      broadcast('user_offline', { uid: userInfo.uid, name: userInfo.name, type: userInfo.type }, ws);
    }
    clients.delete(ws);
    if (userInfo.type === 'agent') AGENTS.delete(userInfo.uid);
  });
});

wsServer.listen(WS_PORT, () => {
  console.log('');
  console.log('🐱 ================================');
  console.log(`  WebSocket: ws://127.0.0.1:${WS_PORT}`);
  console.log(`  HTTP API:  http://127.0.0.1:${API_PORT}`);
  console.log('  等待猫咪和AI Agent连接...');
  console.log('🐱 ================================');
  console.log('');
});

// ====== HTTP API 服务器（AI Agent 可直接调） ======
const apiServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.end('{}');

  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);

  // GET /api/status — 服务器状态
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return res.end(JSON.stringify({
      ok: true,
      users: clients.size,
      agents: AGENTS.size,
      userList: getUserList(),
      commands: CMD_TYPES.map(c => c.id),
    }));
  }

  // GET /api/users — 在线用户列表
  if (req.method === 'GET' && url.pathname === '/api/users') {
    return res.end(JSON.stringify({ users: getUserList() }));
  }

  // POST /api/send — 发送指令/传话
  if (req.method === 'POST' && url.pathname === '/api/send') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { fromName, toUid, type: sendType, commands, message, text } = JSON.parse(body);
        const payload = { fromName: fromName || 'AI助手', fromUid: 'agent_http', fromType: 'agent' };

        if (sendType === 'command') {
          clients.forEach((info, clientWs) => {
            if (info.uid === toUid && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'receive_command',
                data: { ...payload, toUid, commands: commands || ['wave'] },
                ts: Date.now(),
              }));
            }
          });
          return res.end(JSON.stringify({ ok: true, sent: 'command', to: toUid }));
        }

        if (sendType === 'relay') {
          clients.forEach((info, clientWs) => {
            if (info.uid === toUid && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'receive_relay',
                data: { ...payload, toUid, message: message || text || '你好！' },
                ts: Date.now(),
              }));
            }
          });
          return res.end(JSON.stringify({ ok: true, sent: 'relay', to: toUid }));
        }

        return res.end(JSON.stringify({ ok: false, error: 'unknown type, use "command" or "relay"' }));
      } catch (e) {
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/broadcast — AI 向全员广播
  if (req.method === 'POST' && url.pathname === '/api/broadcast') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { fromName, message, emoji } = JSON.parse(body);
        broadcast('agent_announce', {
          fromUid: 'agent_http', fromName: fromName || 'AI助手',
          message: message || '大家好！', emoji: emoji || '🤖',
        });
        return res.end(JSON.stringify({ ok: true, broadcast: true, users: clients.size }));
      } catch (e) {
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

apiServer.listen(API_PORT, () => {
  console.log(`  HTTP API 就绪: http://127.0.0.1:${API_PORT}`);
});

// ====== 可用指令列表 ======
const CMD_TYPES = [
  { id: 'roll', label: '猫猫打滚' },
  { id: 'walk', label: '猫猫走路' },
  { id: 'wave', label: '猫猫招手' },
  { id: 'jump', label: '猫猫跳跃' },
  { id: 'lick', label: '猫猫舔脚' },
  { id: 'ball', label: '猫猫玩球' },
  { id: 'tail', label: '猫猫玩尾巴' },
  { id: 'muscle', label: '猛男小猫' },
];
