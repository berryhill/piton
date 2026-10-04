# Piton Nick bridge contract (implementation in server/chat/backend.ts)

Objective: actual profile-bound Nick conversation via native Hermes Sessions API; browser TypeScript remains sole CAD authority. Acceptance: real streamed reply, durable project history, negative auth/origin tests, no ambient tools. No shared runtime/config changes.

All API calls same-origin, credentials include. JSON POSTs require `Origin` exact configured origin and `X-Piton-CSRF` from bootstrap. GET requires same-origin fetch metadata (or exact Origin). No caller profile/model/upstream/system overrides.

- `GET /api/chat/bootstrap`: existing HttpOnly session -> `{csrfToken, authenticated:true}`. Local loopback or trusted Tailscale Serve identity may bootstrap automatically only when server explicitly configured for that exact identity; otherwise 401. No browser upstream keys.
- `POST /api/chat/projects` `{projectId}`: enroll browser-local project under authenticated principal (UUID). This is transport ownership, not CAD persistence.
- `GET /api/chat/availability`: `{available,profile:'nick-mercer',capabilities:[],runtime:{model,provider}}`.
- `GET /api/chat/history?projectId=UUID`: `{messages:[{role,content}],blocked:boolean,status:string}`. Conversation project-scoped; document never required.
- `POST /api/chat/conversation`: `{projectId,message,context?:string,requestId?:UUID,documentId?:UUID|null}`. Context is frozen bounded untrusted data; no active document is valid. SSE `run.started {runId}`, `assistant.delta {delta}`, `assistant.completed {content}`, `error {error}`, `done {}`. One run/project; reload history while running. Duplicate request ID never starts another turn.
- `POST /api/chat/stop` `{projectId}`: interrupts actual runtime, returns `{stopped:boolean}`. Does not undo CAD or erase history.
- `POST /api/chat/recover` `{projectId}`: explicit fork after uncertain interrupted runtime, preserving visible transcript; never silently resends ambiguous turn.

Static compiled `dist/` served same-origin by backend when configured. Production deployment/package wiring parent-owned.

P2: capability list is initially empty; not falsely advertising OPFS/MCP access. Frozen explicit context works; live browser query/lease MCP requires frontend integration and is separately tracked. Workstation/file/terminal tools forbidden at construction and dispatch. No fabrication/release authority.
