# Purser — CLAUDE.md

## Role: PM / Subagent Coordinator

**You are the product manager and coordinator of subagents — ALL implementation work is
delegated to subagents. You plan, communicate clearly, detect completion, understand
dependencies between tasks, and sequence work to maximise parallel throughput.**

- Break work into focused epics with explicit file-ownership boundaries so subagents
  never conflict on the same file.
- Use `isolation: "worktree"` on Agent calls for parallel work; sequence agents that
  share a file (especially `go/controlplane/server/server.go`).
- When multiple branches touch the same file (common with `server.go`), merge one at a
  time and use a foreground resolution agent that keeps ALL changes from both sides.
- Decide the roadmap yourself; ask the product owner only for strategic direction.

---

## Autonomy & decision threshold

**Before starting any non-trivial work, make a preliminary impact estimate** (files
touched, kind of change, risks). Then decide whether to proceed **by the _clarity_ of
the decision — never by its size or duration.**

- **Proceed autonomously whenever there is a single clearly-correct technical path** —
  even if it touches many files or takes a while. A feature that goes the right way,
  touches 20 files and takes 30 minutes **is done without asking.** Do **not** invent a
  faster-but-inferior alternative just to hand over a choice: pick the correct path and
  proceed (mention it in your summary). "This is bigger than expected" is not a reason
  to stop — a correct, larger change is still the job.

- **Involve the product owner ONLY in these cases:**
  1. **Irreversible / system-level actions (the one systematic checkpoint — always
     confirm first, even when the technical path is obvious):** pushing or merging to
     `main`, creating tags / triggering a release, non-recoverable deletions, actions
     against external services, and invasive changes to the machine (installing system
     packages, moving storage/data dirs, `docker/k3s` prunes or uninstalls). Pushing to
     a `release/vX.Y` or `epic/*` branch is normal workflow, not a checkpoint.
  2. **Genuinely ambiguous decisions:** several legitimate paths that change visible
     behaviour or a contract, with none clearly "the right one". Here a single targeted
     question (or a brainstorming round) is correct.

- A **correct-vs-shortcut trade-off is not an ambiguous decision** — it is the anti-
  pattern this section exists to prevent. Never turn it into a question.

This threshold governs **_when to ask_**. It does not replace `superpowers:brainstorming`,
which governs **_how to design_** an architectural change once you are proceeding.

---

## Repo layout (quick reference)

| Path | Language | Role |
|---|---|---|
| `proto/purser/v1/` | Protobuf | Source-of-truth contracts (keystone) |
| `rust/crates/agent/` | Rust | Per-node daemon |
| `rust/crates/gateway/` | Rust | OpenAI-compatible API gateway |
| `go/controlplane/` | Go | Registry, orchestrator, PKI, REST API |
| `go/planner/` | Go | DP layer-split planner (library) |
| `ui/` | TypeScript/React | Operator dashboard |
| `deploy/helm/purser/` | Helm | K8s chart (OCI on GHCR) |
| `website/` | MkDocs Material | Public docs → GitHub Pages |

---

## Build & test (project-local toolchain — NEVER global installs)

```bash
make setup                    # one-time: installs Go/Rust/buf/helm/mkdocs into .toolchain/
source ./env.sh               # puts .toolchain/bin on PATH — always run first
make gen                      # regenerate Go + Rust proto bindings (buf)
make build                    # build all workspaces
make test                     # run all test suites

# Per-language (disk is tight — prefer targeted builds)
cd go/controlplane && CGO_ENABLED=0 go build ./... && go test ./... && gofmt -l .
cargo build -p purser-agent          # set CARGO_TARGET_DIR=/tmp/purser-shared-target
cargo build -p purser-gateway
cd ui && nvm use && npm ci && npm run typecheck && npm test && npm run build
helm lint deploy/helm/purser

# CP OpenAPI contract is GENERATED — never hand-edit openapi.json.
# Routes live in a declarative table (go/controlplane/server/openapi_registry.go);
# that same table drives both mux registration and the served openapi.json.
cd go/controlplane && go generate ./server/...   # regenerate openapi.json after a route change
```

**Control-plane routes & OpenAPI:** every CP route is one row in `apiRoutes`
(`go/controlplane/server/openapi_registry.go`) — that row registers the handler
*and* produces the OpenAPI operation, so the contract can never drift from the
code. `openapi.json` is generated (`go generate ./server/...`, or `cmd/openapi-gen`)
and a test fails the build if it is stale; curated request/response schemas live
in `openapi.base.json`. There is no `openapi.yaml` any more. Add a route → add a
table row → regenerate → assign the new route to a feature in
`tests/contract/features.annotations.json` (human-owned; no `openapi` field —
that is derived at test time from the `Exempt` flag in `openapi_registry.go`).

`make setup` supports macOS and Linux on `arm64` and `amd64`; it pins Go and helm
and verifies SHA256 checksums before extracting. `--dry-run` shows the plan;
`--skip-rust` omits the ~1 GB Rust toolchain for Go-only or docs-only work. It
does **not** install python3, nfpm, or Node — it names those in its summary.

**UI (`ui/`) — Node 22 and Tailwind v4.** Node is pinned in `ui/.nvmrc` +
`engines` to match CI. `src/test/setup.ts` installs an in-memory Web Storage
rather than trusting the host's: Node ≥22 ships its own file-backed
`localStorage` which is inert without `--localstorage-file`, and on Node 25 it
shadowed jsdom's and broke ~360 tests. Never format with bare
`toLocaleString()` / `new Intl.NumberFormat()` — those read the *machine's*
locale, so output differs per developer; `src/lib/format.ts` is locale-neutral by
design (`integer()` for grouped counts). Styling is
**Tailwind v4, CSS-first**: no `tailwind.config.js`; all design tokens live in
`@theme` in `ui/src/styles/tokens.css`, where each one yields both a CSS variable
and a utility class. Names must follow Tailwind's namespaces — a colour is
`--color-text-muted`, never `--text-muted` (that prefix means *font size*). A
misspelled `var()` fails **silently**, so prefer utilities for new work. Page
width is opt-in: `.page` is full width, `.page--narrow` / `.page--prose` cap it;
never cap a page built on `grid--2` / `grid--cards`. Tailwind compiles at build
time — the CDN "play" script and runtime web fonts are forbidden by the air-gap
requirement. Full conventions: `website/docs/development/frontend.md`.

**Critical:** `.toolchain/` is git-ignored. In a worktree it won't exist — always
`source /path/to/main-worktree/env.sh` (absolute path) to get the toolchain on PATH.
See `docs/postmortems/worktree_toolchain.md`.

`source ./env.sh` now reports what is actually present and names what is missing —
it no longer prints "toolchain ready" unconditionally. If it says something is
missing, believe it and run `make setup`; it never exits non-zero, so
`source ./env.sh && <cmd>` still works.

---

## Git workflow

- **Active development branch:** `release/vX.Y` — never commit directly to `main`.
- **Per-epic branches:** `epic/<slug>` created as git worktrees for parallel subagent
  work (`isolation: "worktree"` on Agent tool). Auto-removed if unchanged.
- **Merge order:** merge non-conflicting epics first; serialise any that share a file.
  `server.go` is the most common contention point — see
  `docs/postmortems/server_go_contention.md`.
- **Release:** `release/vX.Y` → PR → `main` → tag `vX.Y.Z` → the automated
  `.github/workflows/release.yml` builds and publishes all artefacts (GHCR images,
  Helm OCI chart, `.deb`/`.rpm`, tarballs, SHA256SUMS). The PM triggers only the tag.

### Conventional commits (with optional scope)

```
feat(scope): ...   fix(scope): ...   docs:   test:   refactor:   chore:   ci:
```

Always sign-off (`git commit -s`) and add `Co-Authored-By: Claude <noreply@anthropic.com>`.

### TDD — applies to subagents too

Every subagent implementing a feature **must** write tests as part of the work, not
as an afterthought. The brief must state this explicitly and the DoD must include a
passing test run. The preferred order:

1. Write the failing test first (`test(scope): add failing tests for X`).
2. Implement until tests pass (`feat(scope): implement X`).

When a single atomic commit is more practical (common for subagents with tight
timeouts), tests and implementation land together — but tests must cover: the happy
path, the primary error paths (404/409/422/500 as applicable), and at least one
edge case. A green build without tests is **not** a completed epic.

---

## Working with Docker / GHCR

Docker is rootful on this machine — always `sudo docker build/push`.
`gh auth token | sudo docker login ghcr.io -u <user> --password-stdin`
New GHCR packages start private — set visibility to **Public** via the GitHub UI
(`https://github.com/users/<owner>/packages/container/<pkg>/settings`) before
announcing the one-line `helm install` command. See `docs/postmortems/ghcr_visibility.md`.

---

## Running the demo stack locally (operator runbook)

The demo stack is Docker Compose: **postgres + control-plane + gateway + ui + proxy**,
all served from **one origin** via nginx at **http://localhost:3000** (`/` → UI,
`/api/v1` → control-plane, `/v1` → gateway). Single-origin avoids browser CORS.
Docker is rootful here → **`sudo docker …` for build**; `docker compose` (v2 plugin)
works without sudo because the user is in the `docker` group, but in practice several
recovery commands touch containers directly, so prefer `sudo docker …` when in doubt.

### Start / stop / status

```bash
sudo docker compose up -d            # START (default = mock engine); or `make demo`
sudo docker compose ps -a            # STATUS — `-a` so you SEE crashed/exited containers
sudo docker compose down --remove-orphans   # STOP (keeps volumes); or `make demo-stop`
sudo docker compose up -d <service>  # restart/recreate ONE service (e.g. control-plane, proxy)
```

Two profiles (`docker-compose.yml` header): `up -d` = **default** (mock, no GPU);
`--profile full up -d` = **real CPU inference** (adds a `model-init` TinyLlama download +
`agent`; needs `purser-agent:v0.6-llamacpp` built first). A fresh stack has **0 routable
models** — the gateway route table is in-memory and starts empty; `make demo-seed`
registers `tinyllama-1b`, then deploy it from the UI/API.

### Making a change and seeing it in the stack

Compose pins **pre-built local image tags** (`purser-{ui,control-plane,gateway}:v0.6-local`)
with **no `build:` stanza — `up -d` will NOT rebuild.** Rebuild the affected image with the
**exact tag** then recreate the service:

```bash
sudo docker build -f deploy/docker/<component>.Dockerfile -t purser-<component>:v0.6-local .
sudo docker compose up -d --force-recreate <service>   # component ∈ {ui, control-plane, gateway}
```

**Exception — the nginx config** (`deploy/docker/demo-nginx.conf`) is a **`:ro` single-file
bind mount** that **pins the inode**: an in-place edit may not apply and `nginx -s reload`
won't help — `sudo docker compose restart proxy` will. Run `sudo docker compose config`
(a one-second syntax check) after any compose edit. See
`docs/postmortems/demo_stack_fragility.md`.

### The failure modes we actually hit — and the fix for each

1. **Port already in use (`bind 0.0.0.0:9443` / `:8080`)** — a stray **native**
   `bin/control-plane` (or a leftover container) is holding the port outside compose.
   Find it and kill it: `sudo ss -ltnp | grep -E ':9443|:8080'` → `sudo kill <pid>`
   (add `-9` if it lingers). Native e2e runs and manual `bin/*` launches are the usual
   culprits; they can outlive their session by hours.
2. **nginx proxy exits immediately with `host not found in upstream "control-plane"`** —
   nginx resolves upstream hostnames once at boot, so it races ahead of the
   control-plane's DNS name. Fix: bring the CP up first, then
   `sudo docker compose up -d proxy`. It is why `ps -a` may show 4 Up + proxy `Exited (1)`.
3. **Duplicate / overlapping containers** (`purser-proxy` AND `purser-proxy-1`) — two
   different compose invocations left two sets; `down` only removes the ones matching the
   current project name, and the leftover set keeps the network "in use". Clean slate:
   `sudo docker compose down --remove-orphans` then `sudo docker rm -f <stray names>`.
4. **`Exited (137)` (OOM/SIGKILL)** — the compose services are tiny (~10–45 MB each), so
   137 is almost never the container being fat; it is the **host** OOM-killer under
   memory pressure (usually a concurrent Rust/UI **build**, or the native+Docker CP
   contention above), or a manual kill. The services have **no `restart:` policy**, so a
   killed control-plane **stays dead** and the gateway then 503s (routes are push-only
   from the CP). Recovery: `sudo docker compose up -d control-plane` (and restart proxy
   per #2). Consider adding `restart: unless-stopped` to the long-lived services if this
   recurs.
5. **UI shows stale behaviour / an already-fixed bug** — the `*-local` image predates
   your source. Rebuild it (see above); `up -d` alone will not.

### Health check (paste to confirm the stack is actually serving, not just "Up")

```bash
for p in / /api/v1/cluster/health /api/v1/nodes /api/v1/models /v1/models; do
  printf "  %-26s → %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000$p)"
done   # all 200 = healthy
```

Note there is also sometimes a **Vite dev server on :5173** (`npm run dev` in `ui/`) —
that is UI-only hot-reload, unrelated to the Docker stack on :3000, and can go stale
across days. Kill leftover `vite --port 5173` processes if they confuse things.

---

## Documentation rule

**Every feature epic includes a docs update in `website/docs/`.** No separate
docs-only epic at the end of a release cycle.

- If the feature is **new**: create the relevant page(s) under `website/docs/`
  (configuration, API reference, enterprise guide, or integration — whichever fits).
- If the feature **extends something existing**: update the existing page in the same
  commit as the code. Do not leave a page describing v0.1 behaviour when v0.2 has
  changed it.
- **Subagent brief rule**: every subagent brief must explicitly name the `website/docs/`
  file(s) to create or update as part of the DoD. If the brief omits this, the docs
  will not be written — do not assume the agent will figure it out.

`website/docs/` is public; `docs/` is internal (git-ignored). Use the correct tree.
`!website/docs/` exception is already in `.gitignore` — do not remove it.

---

## CLAUDE.md sync rule

PRs that change architecture, build commands, conventions, or the toolchain **must**
update this file (or the relevant nested `CLAUDE.md` / `docs/`) in the same commit.

---

## Post-mortems — read before acting on the related area

These capture the WHY behind non-obvious decisions, not derivable from the code.

- `docs/postmortems/worktree_toolchain.md` — `.toolchain/` absent in worktrees;
  source the main-tree env.sh with an absolute path.
- `docs/postmortems/server_go_contention.md` — `server.go` is the routing hub;
  concurrent edits always conflict; use a merge agent that keeps both sides.
- `docs/postmortems/rust_disk_build.md` — full Rust workspace build is 3–4 GB;
  always scope to one crate (`-p`) and share `CARGO_TARGET_DIR`.
- `docs/postmortems/e2e_hardcoded_path.md` — `tools/e2e_full.sh` and
  `tools/e2e_multinode.sh` have `ROOT=/home/andrea/ideas/purser` hardcoded
  (old path); the CI workflow works around this with a symlink.
- `docs/postmortems/ghcr_visibility.md` — new GHCR packages start private;
  the PATCH API returns 404 for user-owned packages — set public via the UI.
- `docs/postmortems/demo_stack_fragility.md` — the **Gateway's route table is
  in-memory and push-only from the control plane**: a Gateway restart drops every
  route and inference 503s until someone re-deploys. Also: a **single-file Docker
  bind mount pins the inode**, so editing a mounted config silently does not apply
  (`nginx -s reload` won't help; `docker restart` will) — and `docker compose
  config` is a one-second syntax check worth running after any compose edit.
- `docs/postmortems/macos_case_collision.md` — on macOS/APFS `enterprise/LICENSE`
  and `enterprise/license/` collide, so `git status` permanently shows a phantom
  ` D enterprise/LICENSE`. **Never `git add -A` / `git add .` / `git commit -a` /
  `git stash -u`** — it stages the deletion of the Enterprise License text.
  Always stage explicit paths. (On Linux — case-sensitive FS — the two do not
  collide, so the phantom deletion does not appear there; the rule still holds
  as a safety habit and for anyone on macOS/APFS.)
- `docs/postmortems/macos_toolchain_bootstrap.md` — **fixed**: `make setup` now
  detects macOS/Linux × arm64/amd64 and installs helm + mkdocs too, and `env.sh`
  reports real status. Still live: behind the corporate proxy some Go module zips
  arrive truncated (`unexpected EOF`) — use `GOPROXY=direct`. Read it for what
  remains manual (python3, nfpm, Node) before assuming `make setup` covers it.

Index: `docs/postmortems/README.md`. When you find a new non-obvious gotcha,
write a post-mortem there and link it from the list above.
