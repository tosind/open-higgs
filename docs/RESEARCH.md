# Open Higgs: repository synthesis

Research date: November 5, 2026. The duplicated Openfield link was counted once. All ten supplied repositories were inspected. Original source files and license texts are preserved under `integrations/sources`; the exact revisions and SHA-256 hashes are recorded in `integrations/manifest.json`.

## What was combined

| Repository | Contribution | Integration depth |
| --- | --- | --- |
| [Openfield](https://github.com/wexloops/openfield) | Main application, Comfy SDK tools, director, cast, staging, generation and finishing | Forked application base; inherited tools retain their existing runtime |
| [Openjutsu](https://github.com/D3voz/openjutsu) | Character replacement, object swap and post-processing recipes | API workflow library; model and custom-node setup remains external |
| [Genjustsu workflow](https://github.com/sirioberati/Genjustsu-Open-Source-Workflow) | Depth, masks, face mesh, Seedance replacement and original-audio restoration | Companion source snapshot, not ported to the unified provider API |
| [Freefield](https://github.com/neuregex/freefield) | Curated app manifests and image, editing, camera and finishing graphs | API workflow library plus original manifests |
| [Open Source Canvas](https://github.com/raph651/open-source-canvas) | SD Turbo and LTX graph recipes | Runnable starter graphs; unified story canvas is a new implementation |
| [Cinetic](https://github.com/Leonxlnx/cinetic) | Creative direction and motion-design reference system | Reference material; full Remotion/HyperFrames rendering is not integrated |
| [OpenKatana](https://github.com/rk0neki/OpenKatana) | Editing graphs and timeline/composition specifications | Workflow library and companion specification; full engine not embedded |
| [Backlot](https://github.com/Arfolomew/backlot) | Cinema camera data, move presets and relay character-swap graph | Preserved presets plus workflow library |
| [ReAngle](https://github.com/Tekholms-LW/ReAngle) | LTX camera reshoot recipes and custom node source | Workflow library; install the bundled node source in ComfyUI separately |
| [Paint a Plate](https://github.com/AInVFX/ainvfx-paintaplate) | Ingest, matte, edit, propagate, composite and export graphs | Workflow library; its custom node pack is required for inference |

The source licenses in the supplied repositories are MIT or Apache 2.0. Full license texts remain beside the copied files. Model weights, checkpoints, music, and other assets have their own terms. Code license compatibility alone does not establish model suitability for commercial use.

This first version unifies project and shot management and imports specialist workflow recipes. It does not claim that ten independent applications have become one fully ported runtime. Source cards in the app state the actual integration depth.

## Additional projects found

The next additions should fill specific gaps rather than duplicate the studio shell. These are candidates, not dependencies installed during this task.

| Project | Why it is useful | Integration decision |
| --- | --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Shared native graph runtime and HTTP API | Baseline inference engine; revision pinned in Kaggle notebook |
| [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) | Quantized model loaders | High priority for memory-limited workers; validate model-specific kernels on T4 |
| [VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | Video load, save and workflow utilities | Add to versioned video worker profiles where graphs require it |
| [WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | Wan video workflows and model-specific controls | Candidate optional runtime profile, benchmark separately |
| [Wan2.2](https://github.com/Wan-Video/Wan2.2) | Official video model and inference reference | Candidate open-weights video family; do not assume large variants fit one T4 |
| [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) | Alternative diffusion pipelines and memory management | Evaluate as a separate worker executor after the Comfy baseline is measured |
| [LTX-Video](https://github.com/Lightricks/LTX-Video) | Official LTX model and inference stack | Relevant to inherited cinematic and reshoot recipes; pin exact model revisions |
| [SAM 2](https://github.com/facebookresearch/sam2) | Video segmentation and object masks | Candidate unified mask service; source workflows that use SAM 3 need that exact dependency instead |
| [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3) | Geometry and depth estimation | Evaluate camera and scene understanding; not a drop-in replacement for every depth node |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Efficient transcription | Candidate captions and spoken-word editing service |
| [WhisperX](https://github.com/m-bain/whisperX) | Word alignment and diarization | Optional when timing accuracy and speaker labels justify the extra model setup |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | Image and frame restoration | Candidate lightweight finishing profile and comparison baseline |

## Product architecture

```text
Canvas / Shots / Timeline / Sources
                  |
        projects + assets + takes
                  |
      persisted job orchestration
       /          |           \
WaveSpeed/Kie   ComfyUI    authenticated pull queue
 paid APIs     local GPU      /          \
                         Kaggle T4 0  Kaggle T4 1
```

The execution interface should stay capability based. Image generation, video generation, image editing, segmentation, camera reconstruction and final export are different capabilities. A paid model cannot be assumed to offer the same controls as a local graph. The current generic adapter handles the documented asynchronous request envelopes, while per-model parameters remain explicit.

The most valuable next step is a tested runtime catalog. Each recipe needs a model revision, custom-node revision set, minimum ComfyUI version, expected disk and memory requirements, prompt/media bindings, expected output type, and an inference smoke test. The present library preserves upstream recipes but does not invent memory measurements for them.

## Follow-on implementation priorities

1. Automatic background archival and asset packs, extending the implemented explicit media saving and local/Kaggle media uploads.
2. Full manifest-driven parameter forms and VRAM profiles, extending the implemented scalar input forms, Freefield prompt bindings, and local node/model preflight.
3. A tested SD Turbo baseline on Kaggle, followed by one measured low-memory video profile.
4. A shared project-to-OpenKatana translation for audio, titles, transitions and deterministic final exports.
5. Masks, camera paths and character references as versioned project assets, shared across specialist tools.
6. Provider schema discovery, cost quotes, cancel semantics and history-based recovery for unknown submissions.
7. Batch scheduling, worker capability advertisements, GPU memory admission control and backpressure.
8. A graph dependency scheduler after the current visual story board. The present connectors visualize shot order; they do not execute a computational DAG.

The intended product is one creative project that can choose its compute per take, with visible provenance and a reliable path to a finished film. A workflow import library provides a useful foundation; measured model profiles and shared media contracts are what make the specialist tools interoperable.
