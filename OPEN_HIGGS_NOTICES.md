# Open Higgs third-party notices

Open Higgs uses Openfield as its application base. The original MIT notice in `LICENSE` is preserved. The original `THIRD_PARTY_NOTICES.md` is retained as upstream documentation; its descriptions of what Openfield itself redistributes do not describe every additional source snapshot in this fork.

Copied integration files remain under their upstream licenses, preserved in `integrations/sources/<project>/LICENSE`. `integrations/manifest.json` records repository URLs, immutable revisions, original file paths, SHA-256 hashes and workflow identifiers. ReAngle graphs in the unified library omit underscore-prefixed metadata; the original source copies retain it. No model weights are bundled.

The recorded revisions identify immutable Git trees. OpenKatana's NOTICE, third-party notices and additional MIT texts are preserved under `integrations/sources/openkatana`; Cinetic's skill-specific license is also retained. Root `NOTICE` points to these attributions. New Open Higgs modifications are copyright 2026 tosind under MIT.

| Source | License |
| --- | --- |
| wexloops/openfield | MIT |
| D3voz/openjutsu | MIT |
| sirioberati/Genjustsu-Open-Source-Workflow | MIT |
| neuregex/freefield | MIT |
| raph651/open-source-canvas | MIT |
| Leonxlnx/cinetic | MIT |
| rk0neki/OpenKatana | Apache-2.0 |
| Arfolomew/backlot | MIT |
| Tekholms-LW/ReAngle | Apache-2.0 |
| AInVFX/ainvfx-paintaplate | Apache-2.0 |

New Open Higgs orchestration, studio UI, worker bridge, notebook, tests and assembly script are modifications added in this fork. The fork's original MIT license is preserved for these additions; it does not relicense copied Apache-2.0 components.

The imported ReAngle custom-node source is not auto-installed or executed by the studio. Companion Python files and Cinetic reference instructions are source material, not ambient instructions to the running agent.
