# Hermes ACP runtime support

The distributed patch uses zero-context hunks to preserve source bytes without treating diff context markers as code whitespace. At the exact pinned base, validate with `git apply --check --unidiff-zero <patch>` and apply with `git apply --unidiff-zero <patch>`; never apply it to an unverified or dirty shared runtime.

Piton's application host is TypeScript. Optional agent conversation uses Hermes over ACP stdio; manual browser CAD does not require Python. No Python CAD backend or exact-CAD adapter is introduced.

The bundled `hermes-conversation-only.patch` is the source patch for Piton's restricted Hermes runtime, based on Hermes commit `56631482ce9d632d4f630a705b5aa2def5e6215b`. Apply it only to a separate pinned Hermes checkout, never to a shared running fleet checkout. Use the installed Hermes virtualenv with that checkout selected as `PYTHONPATH`, and invoke `python -m acp_adapter --conversation-only`. This dedicated entrypoint is intentional: the ordinary `hermes acp` CLI is not yet covered by this restriction.

Restricted sessions have no native or MCP tools, no private profile memory/context/plugin injection, and no agentic provider subprocess transports. Direct inference transports only. The actual session response must attest its enforced policy; Piton independently verifies the deployed source manifest before each request. Empty advertised capabilities are not sufficient.

Hermes child sessions are deliberately ephemeral and do not read/write the shared profile session database or save trajectories. Piton's authenticated, principal-owned private application ledger owns durable visible conversation history. Browser reload preserves it. Host restart, interrupted/uncertain turns, or changing the selected model may require explicit Recover; completed turns are never automatically resent. Each turn starts a new restricted ACP child and restores bounded visible conversation reference data. Stop cancels the running child; failure does not become a fabricated reply.

Configure the application host with an absolute `PITON_RUNTIME_CONFIG` path. That file and its source manifest must be private regular files owned by the service user. Fields are `python`, `hermesRoot`, `profileHome`, `workingDirectory`, `manifestFile`, `defaultModel`, and allowlisted `models` (`id`, `label`). Credentials remain solely in Hermes's existing protected credential custody; never put credentials into this file, UI, argv, patch, or logs.

The source manifest format is `{ "version": 1, "root": "<absolute Hermes root>", "files": { "<relative source path>": "<sha256>" } }`. It must cover the reviewed runtime source including adapter, policy, agent, tools and lifecycle code. Source hashes establish identity, not correctness: policy regression tests and real restricted-session acceptance are required before activation. Policy or source mismatch fails closed.
