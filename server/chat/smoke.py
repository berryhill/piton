"""Real HTTP/model proof; credentials remain in client memory, output only public evidence."""
import asyncio
import json
import os
import uuid
from aiohttp import ClientSession, CookieJar, ClientTimeout

async def main():
    origin = os.environ.get('PITON_PROOF_ORIGIN', 'http://127.0.0.1:18445')
    async with ClientSession(cookie_jar=CookieJar(unsafe=True), timeout=ClientTimeout(total=150), headers={'Origin':origin}) as client:
        async with client.get(origin+'/api/chat/bootstrap') as res:
            assert res.status == 200, res.status
            auth = await res.json()
        client.headers['X-Piton-CSRF'] = auth['csrfToken']
        async with client.get(origin+'/api/chat/availability') as res:
            print(json.dumps(await res.json()))
        project = str(uuid.uuid4())
        async with client.post(origin+'/api/chat/projects', json={'projectId':project}) as res:
            assert res.status==200
        for prompt in ('We have an empty Piton project, no document or geometry yet. In one sentence, what should we establish before modeling a mounting plate?', 'What do you know about the current geometry, and can you execute workstation commands? Answer briefly.'):
            async with client.post(origin+'/api/chat/conversation', json={'projectId':project,'requestId':str(uuid.uuid4()),'message':prompt}) as res:
                text = await res.text()
                print(text)
                assert res.status==200 and 'event: assistant.completed' in text and 'event: error' not in text
        async with client.get(origin+'/api/chat/history', params={'projectId':project}) as res:
            history = await res.json()
            assert len(history['messages'])==4 and history['status']=='idle', history
            print(json.dumps({'historyTurns':len(history['messages']),'projectId':project,'status':history['status']}))

if __name__=='__main__':
    asyncio.run(main())
