# Open Higgs setup and status

Open Higgs is a working first version of a unified creative studio built on Openfield. It adds a story canvas, saved shots, take selection, a cut timeline, provider adapters, and an outbound Kaggle worker bridge. It is independent of Higgsfield and does not require the Higgsfield service.

## Start the studio

Use Node.js 22 or newer. Node 24 was used for the checks in this workspace. Install dependencies and build:

```powershell
npm install
npm run build
npm start
```

Open <http://127.0.0.1:3161>. For development use `npm run dev`, with the UI at port 3160. Projects and orchestration jobs are stored in `data/studio.sqlite`. The inherited Openfield tool pages use `data/openfield.db`. Both are local SQLite databases. Media and worker outputs stay under `data/`.

The canvas, shots and timeline share the same project. Drag shots around the board, edit their prompts, generate takes, select the best take, and reorder timeline clips. Export Project makes a portable JSON project. Import creates a new project with new identifiers. Reference clips in the initial project are bundled Openfield previews, labeled REFERENCE; they are never exported as generated outputs.

## Batch queue and recovery

Choose **Queue shots** to queue eligible shots with prompts, excluding shots that are already processing. In paid mode the button identifies paid takes. Up to 24 shots can be submitted in one batch. Every request is validated before any job in the batch is stored or dispatched.

The Queue tab shows all project takes, status, errors and remote task IDs. One local job or two jobs per paid provider can run at once. Kaggle jobs remain in the pull queue until a notebook worker claims them. Waiting jobs can be canceled; this does not call a provider and cannot stop a generation that has already started.

Both single and batch API submissions accept an `idempotencyKey`. Repeating the identical request with that key returns the existing jobs. Reusing it with a changed request returns HTTP 409. Keys persist in the studio database across restarts. Integrations should preserve the same key when recovering from a lost HTTP response.

For an `unknown` submission, copy the existing task ID from provider or ComfyUI history into **Resume tracking** in the Queue tab. This only resumes result polling. It does not create another generation. No automatic retry of an ambiguous submission is performed.

## Paid API mode

Add credentials to the local, git-ignored `.env` file, then restart the server:

```dotenv
WAVESPEED_API_KEY=your_key_here
KIE_API_KEY=your_key_here
```

Choose WaveSpeed or Kie.ai in the shot inspector. The model ID and model-specific parameters are editable. The shot prompt is added to the submitted input. The starting examples are WaveSpeed `wavespeed-ai/z-image/turbo` and Kie `google/imagen4-ultra`. Video models also work through the generic adapter when they use the documented WaveSpeed prediction API or Kie Market task API and you supply their required parameters. Kie's separate Veo, Runway, and other dedicated APIs are not interchangeable with its Market endpoint.

Credentials stay on the server. Task IDs are saved before polling. Submissions are never blindly retried. If a submission response is lost, the job becomes `unknown`; inspect provider history before creating a replacement. A polling failure leaves the task running and is retried on the next polling cycle. Failed, deleted, canceled, and timed-out WaveSpeed results stop polling.

Choose **Save media locally** on a completed take to archive its outputs into the studio and replace provider URLs with persistent local paths. Downloads stream to disk and support up to 256 MB per output. Provider links can expire before you save them. Archival is explicit, and no cost estimator is implemented yet. Each Generate click creates one request and may incur provider charges. No paid request was made during development verification.

References: [WaveSpeed integration](https://wavespeed.ai/docs/api-integration), [WaveSpeed results](https://wavespeed.ai/docs/get-result), [Kie Market](https://docs.kie.ai/market/quickstart), [Kie Imagen example](https://docs.kie.ai/market/google/imagen4-ultra), [Kie task results](https://docs.kie.ai/market/common/get-task-detail).

## Local GPU mode

Run ComfyUI on your machine. The new studio submits native API-format graphs directly to ComfyUI at `http://127.0.0.1:8188`. Override this with `COMFY_URL` in `.env` if necessary.

Start with the `open-source-canvas / sd turbo` library graph. It expects `sd_turbo.safetensors` in ComfyUI's `models/checkpoints`. The included Kaggle notebook uses this same baseline. Inspect the [SD Turbo model card](https://huggingface.co/stabilityai/sd-turbo) and install the checkpoint separately.

Choose a library workflow or import a ComfyUI file saved with **Save (API Format)**. Review the JSON and the prompt binding. A binding is an exact node ID and input field, for example node `2`, field `text` in SD Turbo. An empty binding runs the workflow unchanged. Model filenames, custom nodes, media inputs, resolutions and other required values must match your installation. The library is a collection of upstream recipes, not a claim that all models are installed or all graphs fit your GPU.

The **Workflow Inputs** panel exposes scalar graph settings such as model files, dimensions, sampling steps and seeds. **Check setup** compares local graphs against ComfyUI's available node classes and enumerated inputs, identifies missing nodes and unavailable model names, and checks broken graph links. Available model names become dropdown options. This check does not measure peak VRAM or validate every custom node's semantics.

Image, video and audio input fields support media uploads up to 45 MB. Uploaded files stay in the studio and are transferred to the chosen local or Kaggle ComfyUI instance before graph submission. Prompt bindings from Freefield manifests are detected automatically. The full JSON editor remains available for complex inputs.

The inherited Director, Cast, Stage, Reshoot and other dedicated Openfield pages still use the Comfy SDK through `comfy-api-proxy` at port 8189. Install that proxy for those pages, as described in `README.upstream.md`. They retain their local Openfield execution path; the three-mode selector applies to the new studio's shot jobs.

References: [ComfyUI server API](https://docs.comfy.org/development/comfyui-server/comms_routes), [ComfyUI](https://github.com/Comfy-Org/ComfyUI).

## Kaggle twin T4 mode

Upload `notebooks/Open_Higgs_Twin_T4.ipynb` to Kaggle. Enable Internet and select GPU T4 x2. The notebook checks the actual accelerator count, installs a pinned ComfyUI revision in an isolated environment, downloads the SD Turbo baseline, and starts two independent ComfyUI instances. Both reuse checkpoint files on disk; each has its own GPU, output directory and temporary directory.

Set `OPENHIGGS_WORKER_TOKEN` to the same random value on the studio server and in Kaggle Secrets. The local checkout already has a randomly generated token in `.env`; it was not printed or committed. For another install generate one locally with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

The token must contain at least 24 characters. Enter the studio's externally reachable HTTPS worker origin when the notebook asks. A notebook cannot reach the `localhost` address on your laptop. Use an HTTPS reverse proxy or a hosted studio. Only the worker routes need to be forwarded. For example, a Caddy configuration on your studio host:

```caddyfile
gpu-bridge.example.com {
    handle /api/studio/worker/* {
        reverse_proxy 127.0.0.1:3161
    }
    handle {
        respond "Not found" 404
    }
}
```

This requires your own domain, DNS, reachable host and TLS setup. No tunnel, cloud deployment or public endpoint was created during this task. The normal studio is loopback-only and the worker endpoints authenticate with the shared bearer token. Inherited Openfield judge mode adds a separate password gate and is not the notebook bridge configuration.

Choose Twin T4 in the studio and queue independent shots. The first available worker claims a job with a two-minute lease and sends heartbeats every 20 seconds. A second worker cannot claim that same job. An expired lease marks a job interrupted instead of automatically starting a duplicate. Results are uploaded back as files, with a 45 MB per-output limit. Larger outputs remain in the notebook and require manual transfer or smaller preview settings.

The inspector reports recently connected workers. Kaggle setup checks validate graph structure in the studio; node and model availability on the notebook are still resolved by the actual worker. The local ComfyUI model check does not certify a Kaggle environment.

Two T4s provide two separate memory spaces. This baseline uses one worker per GPU and FP16. It does not turn them into one 32 GB GPU or provide tensor parallelism. Larger video recipes may require quantization, CPU offload, a lower resolution, model-specific distributed inference, or different hardware. T4 compatibility and runtime depend on the exact model and nodes. Kaggle GPU availability, quota and notebook lifetime are external constraints. See [Kaggle's runtime repository](https://github.com/Kaggle/docker-python).

## Render a film

Generate and select a take for every shot, then choose Timeline and Export timeline. With Python and FFmpeg on PATH:

```powershell
python scripts/render_timeline.py timeline.json --output film.mp4
```

The script downloads the explicitly listed outputs, normalizes size and frame rate, loops still images, freezes short clips to match their shot duration, and writes an H.264 MP4. Add a WAV, MP3 or FLAC soundtrack in the Timeline tab and adjust its volume before exporting. The renderer loops or trims that soundtrack to the film length, applies a short end fade, and encodes it as AAC. Source-clip audio is still dropped. Multitrack sound mixing, transitions, titles, color management and a full nondestructive editing engine remain follow-on work. OpenKatana's engine and Cinetic's motion design system are documented companion integration opportunities, not silently emulated by this script.

## What was verified

- Production TypeScript checks and Vite build.
- Ten automated orchestration tests covering workflow binding, provider states, project persistence, origin checks, worker claims, artifact leases, request bodies, task IDs, ambiguous submissions, preflight errors, uploaded media and local media archival.
- An end-to-end test runs the actual Python worker through input-media transfer, a simulated ComfyUI response, authenticated claim, output upload and final result retrieval against an isolated studio server.
- A two-second test film rendered with H.264 picture and an AAC soundtrack, verified with FFprobe.
- Browser checks for canvas, workflow selection, editing, timeline and narrow layout.
- Python scripts compile; notebook code cells compile.
- Imported source revisions, workflow JSON structure and file hashes are recorded in `integrations/manifest.json`.

Live paid generation, local GPU generation and actual Kaggle GPU inference were not executed. Those require credentials or GPU sessions unavailable to this chat. Imported recipes are not end-to-end inference certified. See `RESEARCH.md` for the contribution map and next integrations.
