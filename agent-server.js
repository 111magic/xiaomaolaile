/**
 * 喵了个咪 — Agent 自注册 + 双窗口通信服务器
 *
 * 启动: npm start  或  node agent-server.js
 * 访问: http://localhost:3000?agent=A  /  ?agent=B
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const WebSocket = require('ws');

const PORT = 3000;
const ROOT = __dirname;

const AGENT_PRESETS = {
  A: { name: '小胖', emoji: '🐱' },
  B: { name: '夜猫子', emoji: '🌙' },
};

const agents = new Map();
const tokens = new Map();
const connections = new Map();

function genId() {
  return 'agent_' + crypto.randomBytes(4).toString('hex');
}

function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

function getAgentList() {
  return Array.from(agents.values()).map((a) => ({
    id: a.id,
    slot: a.slot,
    name: a.name,
    registeredAt: a.registeredAt,
    online: connections.has(a.id),
  }));
}

function getPeerSlot(slot) {
  return slot === 'A' ? 'B' : 'A';
}

function findAgentBySlot(slot) {
  for (const a of agents.values()) {
    if (a.slot === slot) return a;
  }
  return null;
}

function broadcastAgentStatus(agentId, online) {
  const agent = agents.get(agentId);
  if (!agent) return;
  const msg = JSON.stringify({
    type: 'peer_status',
    data: { agentId: agent.id, slot: agent.slot, name: agent.name, online },
    ts: Date.now(),
  });
  connections.forEach((ws, id) => {
    if (id !== agentId && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gif': 'image/gif',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.txt': 'text/plain; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (pathname === '/' || pathname === '/agent-window.html') {
    serveFile(res, path.join(ROOT, 'agent-window.html'), 'text/html; charset=utf-8');
    return;
  }

  if (pathname.startsWith('/assets/')) {
    const assetPath = decodeURIComponent(pathname.slice(1));
    serveStatic(res, path.join(ROOT, assetPath));
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, agents: getAgentList(), ts: Date.now() });
    return;
  }

  if (pathname === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, { agents: getAgentList() });
    return;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const slot = String(body.slot || '').toUpperCase();
      if (!AGENT_PRESETS[slot]) {
        sendJson(res, 400, { error: '无效的 agent 槽位，请使用 A 或 B' });
        return;
      }
      const preset = AGENT_PRESETS[slot];
      const existing = findAgentBySlot(slot);
      if (existing) {
        sendJson(res, 200, {
          agentId: existing.id,
          slot: existing.slot,
          name: existing.name,
          emoji: existing.emoji,
          token: existing.token,
          registeredAt: existing.registeredAt,
          reused: true,
        });
        return;
      }
      const agentId = genId();
      const token = genToken();
      const record = {
        id: agentId,
        slot,
        name: preset.name,
        emoji: preset.emoji,
        token,
        registeredAt: new Date().toISOString(),
      };
      agents.set(agentId, record);
      tokens.set(token, agentId);
      console.log(`✅ Agent ${slot} 注册成功: ${preset.name} (${agentId})`);
      sendJson(res, 200, {
        agentId,
        slot,
        name: preset.name,
        emoji: preset.emoji,
        token,
        registeredAt: record.registeredAt,
        reused: false,
      });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  const agentMatch = pathname.match(/^\/api\/agent\/([^/]+)$/);
  if (agentMatch && req.method === 'GET') {
    const agent = agents.get(agentMatch[1]);
    if (!agent) {
      sendJson(res, 404, { error: 'Agent 不存在' });
      return;
    }
    const peer = findAgentBySlot(getPeerSlot(agent.slot));
    sendJson(res, 200, {
      id: agent.id,
      slot: agent.slot,
      name: agent.name,
      registeredAt: agent.registeredAt,
      online: connections.has(agent.id),
      peer: peer
        ? { id: peer.id, slot: peer.slot, name: peer.name, online: connections.has(peer.id) }
        : null,
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let agentId = null;

  ws.on('message', (raw) => {
    try {
      const { type, data } = JSON.parse(raw.toString());

      switch (type) {
        case 'auth': {
          const token = data?.token;
          const id = tokens.get(token);
          if (!id || !agents.has(id)) {
            ws.send(JSON.stringify({ type: 'auth_fail', data: { reason: '无效 token' }, ts: Date.now() }));
            ws.close();
            return;
          }
          agentId = id;
          connections.set(agentId, ws);
          const agent = agents.get(agentId);
          console.log(`🟢 ${agent.name} (${agent.slot}) WebSocket 已连接`);

          ws.send(JSON.stringify({
            type: 'auth_ok',
            data: {
              agentId: agent.id,
              slot: agent.slot,
              name: agent.name,
              registeredAt: agent.registeredAt,
              agents: getAgentList(),
            },
            ts: Date.now(),
          }));

          broadcastAgentStatus(agentId, true);

          const peer = findAgentBySlot(getPeerSlot(agent.slot));
          if (peer) {
            ws.send(JSON.stringify({
              type: 'peer_status',
              data: {
                agentId: peer.id,
                slot: peer.slot,
                name: peer.name,
                online: connections.has(peer.id),
              },
              ts: Date.now(),
            }));
          }
          break;
        }

        case 'message': {
          if (!agentId) return;
          const sender = agents.get(agentId);
          const toId = data?.toAgentId;
          const text = String(data?.text || '').trim();
          if (!text || !toId) return;

          const payload = {
            fromAgentId: sender.id,
            fromSlot: sender.slot,
            fromName: sender.name,
            toAgentId: toId,
            text,
          };

          const targetWs = connections.get(toId);
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({ type: 'receive_message', data: payload, ts: Date.now() }));
          }
          ws.send(JSON.stringify({ type: 'message_sent', data: payload, ts: Date.now() }));
          console.log(`💬 ${sender.name} → ${agents.get(toId)?.name || toId}: ${text}`);
          break;
        }

        case 'command': {
          if (!agentId) return;
          const sender = agents.get(agentId);
          const toId = data?.toAgentId;
          const commands = Array.isArray(data?.commands) ? data.commands : [];
          if (!toId || commands.length === 0) return;

          const payload = {
            fromAgentId: sender.id,
            fromSlot: sender.slot,
            fromName: sender.name,
            toAgentId: toId,
            commands,
          };

          const targetWs = connections.get(toId);
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({ type: 'receive_command', data: payload, ts: Date.now() }));
          }
          ws.send(JSON.stringify({ type: 'command_sent', data: payload, ts: Date.now() }));
          const labels = commands.join('、');
          console.log(`🎮 ${sender.name} → ${agents.get(toId)?.name || toId}: [${labels}]`);
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', data: null, ts: Date.now() }));
          break;
      }
    } catch (e) {
      console.error('消息解析失败:', e.message);
    }
  });

  ws.on('close', () => {
    if (agentId) {
      const agent = agents.get(agentId);
      connections.delete(agentId);
      console.log(`🔴 ${agent?.name || agentId} WebSocket 断开`);
      broadcastAgentStatus(agentId, false);
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('🐱 ========================================');
  console.log('  喵了个咪 Agent 通信服务器');
  console.log(`  HTTP:  http://localhost:${PORT}`);
  console.log(`  WS:    ws://localhost:${PORT}`);
  console.log('');
  console.log('  窗口 A: http://localhost:3000?agent=A  (小胖)');
  console.log('  窗口 B: http://localhost:3000?agent=B  (夜猫子)');
  console.log('🐱 ========================================');
  console.log('');
});
