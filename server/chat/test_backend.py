"""Hermetic bridge contract tests; fake native SSE is NOT model proof (smoke.py is)."""
import asyncio
import json
from pathlib import Path
import secrets
import tempfile
from types import SimpleNamespace
import unittest
import uuid
from aiohttp import web, ClientSession, CookieJar
from aiohttp.test_utils import TestServer
from backend import Bridge

class BackendTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []
        self.fail = False
        self.slow = False
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        async def create(req):
            return web.json_response({'session':{'id':'native_test'}})
        async def stream(req):
            self.calls.append(await req.json())
            res = web.StreamResponse(headers={'Content-Type':'text/event-stream'})
            await res.prepare(req)
            await res.write(b'event: run.started\ndata: {"run_id":"native_run"}\n\n')
            self.started.set()
            if self.slow:
                await self.release.wait()
            if self.fail:
                await res.write(b'event: error\ndata: {"message":"upstream private error"}\n\n')
            else:
                await res.write(b'event: assistant.delta\ndata: {"delta":"fixture"}\n\n')
                await res.write(b'event: assistant.completed\ndata: {"session_id":"native_rotated","content":"fixture","completed":true}\n\n')
            return res
        native = web.Application()
        native.router.add_post('/api/sessions', create)
        native.router.add_post('/api/sessions/{sid}/chat/stream', stream)
        self.native = TestServer(native)
        await self.native.start_server()
        self.agent = SimpleNamespace(interrupt=lambda reason: self.release.set())
        adapter = SimpleNamespace(public_runtime={'model':'fixture','provider':'test'},_api_key=secrets.token_urlsafe(32),_active_run_agents={'native_run':self.agent})
        self.bridge = Bridge(self.tmp.name, 'http://127.0.0.1:1', adapter, str(self.native.make_url('')).rstrip('/'), local_bootstrap=True)
        self.server = TestServer(self.bridge.app())
        await self.server.start_server()
        self.origin = str(self.server.make_url('')).rstrip('/')
        self.bridge.origin = self.origin
        self.bridge.host = self.origin.split('//')[1]
        self.client = ClientSession(cookie_jar=CookieJar(unsafe=True),headers={'Origin':self.origin})
        async with self.client.get(self.origin+'/api/chat/bootstrap') as r:
            self.assertEqual(r.status,200)
            self.csrf = (await r.json())['csrfToken']
            self.assertIn('HttpOnly', r.headers['Set-Cookie'])
            self.assertIn('SameSite=Strict', r.headers['Set-Cookie'])
        self.client.headers['X-Piton-CSRF']=self.csrf
        self.project=str(uuid.uuid4())
        r=await self.client.post(self.origin+'/api/chat/projects',json={'projectId':self.project}); self.assertEqual(r.status,200); await r.read()

    async def asyncTearDown(self):
        self.release.set()
        await self.client.close()
        await self.server.close()
        await self.native.close()
        self.tmp.cleanup()

    async def post(self, path='conversation', **extra):
        value={'projectId':self.project,'message':'hello','requestId':str(uuid.uuid4())}
        value.update(extra)
        return await self.client.post(self.origin+'/api/chat/'+path,json=value)

    async def test_real_transport_shape_empty_project_and_rotation(self):
        r=await self.post(context='frozen tab A')
        text=await r.text()
        self.assertIn('assistant.completed',text)
        self.assertIn('frozen tab A',self.calls[0]['input'])
        row=self.bridge.db.execute('SELECT * FROM projects').fetchone()
        self.assertEqual(row['sid'],'native_rotated')
        r=await self.client.get(self.origin+'/api/chat/history',params={'projectId':self.project})
        history=await r.json()
        self.assertEqual(len(history['messages']),2)
        self.assertFalse(history['blocked'])

    async def test_unknown_project_and_forged_scope(self):
        r=await self.post(projectId=str(uuid.uuid4()))
        self.assertEqual(r.status,403)
        self.assertFalse(self.calls)

    async def test_csrf(self):
        self.client.headers['X-Piton-CSRF']='incorrect'
        r=await self.post()
        self.assertEqual(r.status,403)
        self.assertFalse(self.calls)

    async def test_origin_host_and_forwarded_identity(self):
        for headers in ({'Origin':'https://evil.invalid'}, {'Host':'evil.invalid'}, {'Sec-Fetch-Site':'cross-site'}):
            r=await self.client.get(self.origin+'/api/chat/availability',headers=headers)
            self.assertEqual(r.status,403)
        async with ClientSession(headers={'Origin':self.origin,'X-Forwarded-User':'owner','Tailscale-User-Login':'owner'}) as client:
            r=await client.get(self.origin+'/api/chat/availability')
            self.assertEqual(r.status,401)

    async def test_overrides_and_context_limit(self):
        for extra in ({'model':'other'}, {'profile':'other'}, {'system_prompt':'override'}, {'upstream':'http://evil'}, {'context':'a'*24001}):
            r=await self.post(**extra)
            self.assertEqual(r.status,400)
        self.assertFalse(self.calls)

    async def test_idempotency(self):
        rid=str(uuid.uuid4())
        r=await self.post(requestId=rid); await r.read()
        r=await self.post(requestId=rid)
        self.assertEqual(r.status,409)
        self.assertEqual((await r.json())['error'],'duplicate_request')
        r=await self.post(requestId=rid,message='changed')
        self.assertEqual((await r.json())['error'],'idempotency_conflict')
        self.assertEqual(len(self.calls),1)

    async def test_failure_and_explicit_recovery(self):
        self.fail=True
        r=await self.post(); text=await r.text()
        self.assertNotIn('private error',text)
        self.assertIn('conversation_interrupted',text)
        r=await self.post(); self.assertEqual(r.status,409)
        r=await self.client.post(self.origin+'/api/chat/recover',json={'projectId':self.project})
        self.assertEqual(r.status,200)
        self.fail=False
        r=await self.post(); self.assertIn('assistant.completed',await r.text())
        self.assertIn('Prior visible project conversation',self.calls[-1]['input'])

    async def test_stop_and_busy(self):
        self.slow=True
        r=await self.post()
        await self.started.wait()
        second=await self.post(); self.assertEqual(second.status,409)
        stopped=await self.client.post(self.origin+'/api/chat/stop',json={'projectId':self.project})
        self.assertTrue((await stopped.json())['stopped'])
        self.assertIn('cancelled',await r.text())
        self.assertFalse(self.bridge.active)

    async def test_cross_principal_history(self):
        self.bridge.save('UPDATE projects SET principal=? WHERE id=?',('other',self.project))
        r=await self.client.get(self.origin+'/api/chat/history',params={'projectId':self.project})
        self.assertEqual(r.status,403)
        r=await self.client.post(self.origin+'/api/chat/projects',json={'projectId':self.project})
        self.assertEqual(r.status,403)

    async def test_static_cannot_read_state(self):
        r=await self.client.get(self.origin+'/api/other')
        self.assertEqual(r.status,404)
        r=await self.client.get(self.origin+'/bridge.db')
        self.assertEqual(r.status,404)

if __name__=='__main__':
    unittest.main()
