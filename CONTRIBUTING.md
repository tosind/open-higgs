# Contributing to Open Higgs

Useful contributions include reproducible bug fixes, tested workflow profiles, execution adapters, media tools and accessibility improvements.

## Development

Use Node.js 22 or newer and Python 3.11 or newer. Install with `npm ci`, then run `npm run dev`. The UI runs at port 3160 and the server at 3161. No GPU or paid account is required to work on the studio or run the isolated tests.

Run the checks relevant to your change:

```powershell
npm run build
npm run test:studio
npm run format:check
python tests/worker_e2e.py
python scripts/verify_integrations.py
python scripts/check_publication.py
```

With FFmpeg and FFprobe installed, also run `python tests/render_e2e.py` for timeline changes. Tests put scratch data under `work/`, which is ignored by Git.

The new studio and orchestration files use Prettier: `npm run format`. Do not reformat copied source snapshots in `integrations/sources`, because their checksums document upstream provenance.

## Architecture

- `src/pages/Studio.tsx`: shared project, canvas, shot and timeline state.
- `src/pages/StudioQueue.tsx`: batch queue, waiting-job cancellation and task recovery.
- `src/pages/StudioControls.tsx`: graph inputs, preflight feedback, media uploads and soundtrack controls.
- `server/studio.ts`: persistent jobs, execution queue, provider adapters and worker leases.
- `server/studio-tools.ts`: preflight, assets, runtime status and output archival.
- `scripts/kaggle_worker.py`: outbound worker protocol and ComfyUI media transfer.
- `scripts/render_timeline.py`: deterministic picture cuts and soundtrack assembly.
- `integrations/manifest.json`: immutable source trees, hashes and workflow provenance.

## Workflows and models

A graph that parses is not necessarily runnable. For a tested runtime profile, provide exact model revisions, model licenses, ComfyUI and custom-node revisions, hardware, settings, actual runtime, peak memory measurements if available, and an example result you can redistribute. Do not claim T4 compatibility based only on parameter count or the sum of two GPUs' VRAM.

Keep external model weights outside the repository. Preserve upstream licenses and NOTICE files when importing code. Submit changed source snapshots separately from application changes, with an explanation of the revision update.

## Provider integrations

Never expose keys to the browser or include them in logs. A lost submission response must not trigger an automatic duplicate generation. Persist remote task IDs, use the queue's idempotency keys, and test terminal states and ambiguous responses without calling a paid endpoint.

## Pull requests

Describe the concrete behavior and how you verified it. Keep changes focused. Contributions use the license of the files they modify; copied third-party components retain their own licenses. Follow [SECURITY.md](SECURITY.md) for security reports.
