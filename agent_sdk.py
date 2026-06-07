"""
喵了个咪 — AI Agent SDK (Python)
===============================
其他 AI 程序通过此 SDK 接入猫咪多人互动系统。

用法:
    from agent_sdk import CatAgent

    class MyAgent(CatAgent):
        def on_user_online(self, uid, name):
            self.send_relay(uid, f'你好 {name}！欢迎来到猫咪星球～')

        def on_user_message(self, from_uid, from_name, text):
            reply = my_llm(text)  # 调用你的大模型
            self.send_relay(from_uid, reply)

        def on_receive_command(self, from_uid, from_name, commands):
            print(f'{from_name} 让猫猫执行: {commands}')

    agent = MyAgent('我的AI助手')
    agent.connect()
"""

import asyncio
import json
import time
import urllib.request


class CatAgent:
    """AI Agent 基类 — 接入猫咪多人互动系统"""

    SERVER = 'http://127.0.0.1:9528'

    def __init__(self, name='AI助手'):
        self.name = name
        self.uid = f'agent_{int(time.time())}'
        self.running = False

    # ====== 发送指令（HTTP API） ======

    def send_command(self, to_uid, commands):
        """让指定猫咪执行动作指令"""
        return self._post('/api/send', {
            'fromName': self.name,
            'toUid': to_uid,
            'type': 'command',
            'commands': commands,   # ['roll', 'wave', 'jump', ...]
        })

    def send_relay(self, to_uid, message):
        """向指定猫咪传话"""
        return self._post('/api/send', {
            'fromName': self.name,
            'toUid': to_uid,
            'type': 'relay',
            'message': message,
        })

    def broadcast(self, message, emoji='🤖'):
        """向所有在线猫咪广播系统消息"""
        return self._post('/api/broadcast', {
            'fromName': self.name,
            'message': message,
            'emoji': emoji,
        })

    def get_users(self):
        """获取在线用户列表"""
        data = self._get('/api/users')
        return data.get('users', []) if data else []

    def get_status(self):
        """获取服务器状态"""
        return self._get('/api/status')

    # ====== 内部 ======

    def _post(self, path, body):
        try:
            req = urllib.request.Request(
                self.SERVER + path,
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            resp = urllib.request.urlopen(req, timeout=5)
            return json.loads(resp.read())
        except Exception as e:
            print(f'[Agent SDK] POST {path} error: {e}')
            return None

    def _get(self, path):
        try:
            resp = urllib.request.urlopen(self.SERVER + path, timeout=5)
            return json.loads(resp.read())
        except Exception as e:
            print(f'[Agent SDK] GET {path} error: {e}')
            return None

    # ====== WebSocket 实时监听 ======

    def connect(self):
        """连接 WebSocket 实时接收事件（阻塞）"""
        self.running = True
        print(f'🤖 {self.name} 正在连接猫咪服务器...')

        try:
            asyncio.run(self._ws_loop())
        except KeyboardInterrupt:
            print(f'\n👋 {self.name} 已断开')
        except Exception as e:
            print(f'⚠️ WebSocket 连接失败，切换到 HTTP 轮询模式: {e}')
            self._poll_loop()

    async def _ws_loop(self):
        """WebSocket 主循环"""
        try:
            import websocket
            ws = websocket.create_connection(f'ws://127.0.0.1:9527')
        except ImportError:
            print('需要 websocket-client: pip install websocket-client')
            self._poll_loop()
            return

        ws.send(json.dumps({
            'type': 'login',
            'data': {'uid': self.uid, 'name': self.name, 'type': 'agent'}
        }))

        # 发送上线广播
        ws.send(json.dumps({
            'type': 'announce',
            'data': {'message': f'{self.name} 已上线！正在守护猫咪们～', 'emoji': '🤖'}
        }))

        print(f'✅ {self.name} 已连接，监听中...')

        while self.running:
            try:
                msg = json.loads(ws.recv())
                event = msg.get('type', '')
                data = msg.get('data', {})

                if event == 'receive_relay' and data.get('fromUid') != self.uid:
                    self.on_user_message(
                        data.get('fromUid', ''),
                        data.get('fromName', ''),
                        data.get('message', ''),
                    )

                elif event == 'receive_command' and data.get('fromUid') != self.uid:
                    self.on_receive_command(
                        data.get('fromUid', ''),
                        data.get('fromName', ''),
                        data.get('commands', []),
                    )

                elif event == 'receive_chat' and data.get('fromUid') != self.uid:
                    self.on_user_message(
                        data.get('fromUid', ''),
                        data.get('fromName', ''),
                        data.get('text', ''),
                    )

                elif event == 'user_online':
                    if data.get('uid') != self.uid:
                        self.on_user_online(data.get('uid', ''), data.get('name', ''))

                elif event == 'user_offline':
                    self.on_user_offline(data.get('uid', ''), data.get('name', ''))

                elif event == 'online_list':
                    self.on_online_list(data or [])

            except Exception as e:
                if self.running:
                    print(f'⚠️ WS 消息处理错误: {e}')
                break

        ws.close()

    def _poll_loop(self):
        """HTTP 轮询模式（不需要 WebSocket 库）"""
        import time as _time
        print(f'✅ {self.name} HTTP 轮询模式，每5秒检查...')
        last_count = 0

        while self.running:
            try:
                status = self.get_status()
                if status:
                    count = status.get('users', 0)
                    if count != last_count:
                        users = self.get_users()
                        self.on_online_list(users)
                    last_count = count
            except:
                pass
            _time.sleep(5)

    # ====== 事件回调（子类覆盖） ======

    def on_user_online(self, uid, name):
        """用户上线"""
        pass

    def on_user_offline(self, uid, name):
        """用户下线"""
        pass

    def on_online_list(self, users):
        """收到完整在线列表"""
        pass

    def on_user_message(self, from_uid, from_name, text):
        """收到用户消息（传话/聊天）"""
        pass

    def on_receive_command(self, from_uid, from_name, commands):
        """收到用户指令"""
        pass


# ====== 使用示例 ======
if __name__ == '__main__':
    class DemoAgent(CatAgent):
        """Demo: 一个友好的 AI 管家"""
        def __init__(self):
            super().__init__('猫咪管家 🤖')

        def on_user_online(self, uid, name):
            print(f'🟢 {name} 上线了！')
            self.send_relay(uid, f'欢迎 {name}！我是猫咪管家，有什么需要帮忙的吗？')

        def on_user_offline(self, uid, name):
            print(f'🔴 {name} 下线了')

        def on_user_message(self, from_uid, from_name, text):
            print(f'💬 [{from_name}]: {text}')
            # 简单回复（可替换为 LLM 调用）
            reply = f'收到！{from_name} 说的是「{text}」。本管家会帮你的喵～'
            self.send_relay(from_uid, reply)

        def on_receive_command(self, from_uid, from_name, commands):
            print(f'🎮 [{from_name}] 让猫猫: {commands}')
            # 回一个 relay
            cmd_names = '、'.join(commands)
            self.send_relay(from_uid, f'好的，已让猫咪{cmd_names}！😸')

        def on_online_list(self, users):
            print(f'📋 在线: {len(users)} 人')
            for u in users:
                print(f'   - {u["name"]} ({u.get("type","cat")})')

    agent = DemoAgent()
    agent.connect()
