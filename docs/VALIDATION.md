# Open Higgs verification

Verified on Windows with Node.js 24, Python 3.13 and FFmpeg. Current source: Open Higgs 0.4.0-alpha.1.

The public GitHub CI matrix also passed on Linux with Node 22 and 24 and on Windows with Node 24. Each job installs from the lockfile, builds the application, runs the backend and worker tests, and verifies formatting, source provenance and publication hygiene. The Linux Node 24 job also verifies the FFmpeg render.

- TypeScript checks cover the frontend, backend and inherited MCP service.
- Fourteen backend tests cover the job lifecycle, API payloads, persistence, cross-origin writes, worker leases, graph bindings, preflight errors, uploads, media archival, atomic batches, idempotency, bounded dispatch, cancellation and task recovery.
- The real Python worker passed an isolated HTTP integration test with input-media upload, simulated ComfyUI inference, output upload and result retrieval. This is a protocol test, not a GPU benchmark.
- The timeline renderer produced a 2.000-second film from two test stills and a short test tone. FFprobe confirmed H.264 picture and AAC audio.
- The source verifier checks ten source license hashes, 180 copied-file hashes, 125 API-format workflow graphs and syntax for seven notebook code cells.
- Browser verification covers the canvas, workflow library, setup controls, timeline, saved projects and a 390-pixel layout. The narrow layout scrolls within the studio without widening the page.

No paid API request or actual local/Kaggle GPU inference was performed. Model files, custom node behavior, VRAM, generation speed and output quality remain unverified on real GPU hardware. The library preserves upstream recipes and does not claim hardware certification.

Run:

```powershell
npm run build
npm run test:studio
python tests/worker_e2e.py
python scripts/verify_integrations.py
python scripts/check_publication.py
```
