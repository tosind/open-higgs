<h1 align="center">Open Source Canvas</h1>

<p align="center">
  <strong>The graph is the studio.</strong><br>
  An open-source node canvas for images and video, on your own GPU with ComfyUI.
</p>

<p align="center">
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square">
  <img alt="built on ComfyUI" src="https://img.shields.io/badge/built%20on-ComfyUI-7c3aed?style=flat-square">
  <img alt="runs locally" src="https://img.shields.io/badge/runs-locally-f97316?style=flat-square">
</p>

<p align="center">
  <a href="https://raph651.github.io/open-source-canvas/">Live demo</a> ·
  <a href="docs/media/demo-1080p-v3.mp4">Demo video</a> ·
  <a href="docs/SETUP.md">Docs</a> ·
  <a href="#quick-start">Quick start</a>
</p>

<p align="center">
  <a href="docs/media/demo-1080p-v3.mp4"><img src="docs/media/demo-sharp-v3.gif" alt="Open Source Canvas demo: one prompt, one film" width="720"></a>
</p>

Prompts, references and models go in on one infinite board; finished images and clips come out. Nothing is generated in the browser: the app talks to a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server you run, and builds the workflow for each model for you.

The [live demo](https://raph651.github.io/open-source-canvas/) is for looking around only: ComfyUI is offline there, so Run draws placeholder artwork. Run the app locally for real generations.

<p align="center">
  <img src="docs/media/board-music-video-v2.jpg" alt="The Music Video board with the generation panel" width="48%">
  <img src="docs/media/board-marketing-studio-day-v2.jpg" alt="The Marketing Studio board in the day theme" width="48%">
</p>
<p align="center"><sub>Music Video (night) and Marketing Studio (day). The example boards ship with their finished outputs.</sub></p>

## What you get

- **Boards, not workflows.** Prompt, Image, Model, Output and Note nodes with typed connections. Templates for a music video, a marketing film, a recreate and more.
- **`@` references.** Write "@Avatar opens @Product" in a prompt and it points at those reference nodes.
- **Every render kept.** Each node has a History strip; batch renders get their own seeds.
- **Chains.** An image from one node becomes the next node's reference or first frame.
- **Teamwork.** Comments and reactions that pin to nodes, plus an optional room (`npm run room`) that syncs a board.
- **Local first.** Boards autosave in your browser, export as JSON, and follow your light or night theme.

## Try Pika H3 Flex on your own GPU

You are welcome to try [Pika H3 Flex](https://huggingface.co/Pika-Labs/Pika-H3-Flex), Pika Labs' open video model with audio, on your own GPU. It is in the model list, and the app shows which files to install (no custom node; you need ComfyUI 0.43.2 or newer, then follow [ComfyUI's Pika H3 Flex guide](https://docs.comfy.org/tutorials/video/pika/pika-h3-flex)). The canvas has no workflow for it yet, so for now render it with ComfyUI's built-in Pika H3 Flex templates. A workflow so the canvas can run it directly is a very welcome pull request ([how to add a model](docs/ADDING_MODELS.md)).

## Quick start

You need Node.js 20 or newer and a recent ComfyUI (0.40 or newer recommended). SD-Turbo (images) runs on almost anything, including Apple Silicon; the default LTX-Video 2B (video) needs about 24 GB of GPU or unified memory. Plan for about 16 GB of disk.

```bash
git clone https://github.com/raph651/open-source-canvas.git
cd open-source-canvas
npm install
```

**1. ComfyUI.** If you already run it, skip ahead. Otherwise one script clones it next to this repo, sets up Python with [uv](https://docs.astral.sh/uv/) and downloads the models:

```bash
./scripts/setup-comfyui.sh --with-video      # leave the flag off for images only
```

Prefer to do it by hand? See [docs/SETUP.md](docs/SETUP.md). Start ComfyUI with CORS on so the browser may call it:

```bash
python main.py --enable-cors-header
```

**2. The app.**

```bash
npm run dev        # http://127.0.0.1:4173
```

**3. Check the link.** Click the **ComfyUI** badge in the top bar: it should say `Connected` with your device and version.

**4. Make something.** Open a template or choose **New canvas**, connect a **Prompt** node to a **Model** node, and press **Generate**. For video, connect an image into the node and it becomes the first frame. A 512×512 SD-Turbo image takes roughly 10 to 20 seconds on an Apple M-series chip; a short LTX-Video clip takes a minute or two.

For a production-style run, `npm run build` then `node server/app.mjs` serves the built app and proxies ComfyUI at `/comfy`, so no CORS flag is needed.

## Models

| Where | Models |
|---|---|
| Local, work out of the box | SD-Turbo (images), LTX-Video 2B (video) |
| Local, install the files | Wan 2.2 TI2V 5B, Pika H3 Flex. The app checks ComfyUI and shows an **Install** badge with the steps until the files are there. |
| Hosted through ComfyUI partner nodes | LTX-2.5, Seedream 5.0 Pro, Nano Banana Pro, Seedance, Kling, Veo, FLUX and more. They appear in the list, but generating with them from the canvas is not wired yet ([details](docs/SETUP.md#api-models)). |

Add your own local model with [docs/ADDING_MODELS.md](docs/ADDING_MODELS.md).

**Licenses.** The app is MIT. Models are separate, so read each model card before commercial use:

| Model | License |
|---|---|
| SD-Turbo | Stability AI community license |
| LTX-Video 2B | Lightricks license (see the model card) |
| LTX-2.5 | LTX-2.x Community License. Companies with annual revenue of $10M or more need a commercial license. |
| MiniMax H3 | Community license that excludes the US, EU, UK and South Korea |
| Wan 2.1, Wan 2.2, Mochi 1 | Apache-2.0 |
| Pika H3 Flex (adapters on MiniMax-H3) | MiniMax H3 Community License; Pika asks for a credit when you use the adapters in research or products |

## Troubleshooting

- **The badge says offline.** ComfyUI is not running, or the dev server cannot reach it. Start ComfyUI with `--enable-cors-header`, or use `node server/app.mjs`, which proxies it, and check the base URL in the ComfyUI panel.
- **`/prompt failed (400)` or "model not found".** A file name in the ComfyUI panel does not match a file in `models/checkpoints/` or `models/text_encoders/`. Copy the exact names.
- **Out of memory on video.** Keep **Fast local video** on, use a shorter clip, or run it on a machine with more memory.
- **403 from `/comfy/...` on a shared deployment.** The proxy refused a request for someone else's output, or a gateway such as Cloudflare Access blocked it. See [deploy/README.md](deploy/README.md).

## More

- [docs/SETUP.md](docs/SETUP.md): manual ComfyUI install, connecting to a remote server, environment variables, hosted API models, project layout, scripts
- [docs/COMFYUI_RUNTIME.md](docs/COMFYUI_RUNTIME.md): how a render flows through the code
- [docs/ADDING_MODELS.md](docs/ADDING_MODELS.md): add a local model
- [deploy/README.md](deploy/README.md): share a running copy behind Cloudflare Tunnel and Access
- [CHANGELOG.md](CHANGELOG.md): what changed in each version

## License

MIT. See [LICENSE](./LICENSE). Built with [ComfyUI](https://github.com/comfyanonymous/ComfyUI), [React Flow](https://reactflow.dev/), React, Vite and Zustand.
