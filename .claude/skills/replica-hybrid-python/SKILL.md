---
name: replica-hybrid-python
description: Algorithmic design engines for Jarvis in standard-library Python - Weisfeiler-Lehman layout fingerprints and clean golden-ratio templates (topology_synth), graphlib workflow scheduling with locked steps isolated (dag_scheduler), a Markov memory of layouts that passed the gates (pattern_memory), a manifest inventory and entropy audit (static_intel), and a seeded curriculum of 50,000+ layouts and 50,000+ Arabic/English Q&A pairs with computed answers (curriculum_50k). No network, no processes.
---

# replica-hybrid-python

Five tools that turn structure into numbers and numbers back into clean designs. They read files
you give them and write only where you say inside `--root`. None reaches the network, starts a
process, or runs what it reads (HTML is parsed with `html.parser`, Python with `ast`).

| Tool | Does | Typical command |
| --- | --- | --- |
| `topology_synth.py` | WL fingerprint of a page's element tree (text dropped), layout archetype [INFERENCE], and a clean template in the Jarvis design system | `synth page.html --out jarvis/replica/template.html --lang ar` |
| `dag_scheduler.py` | parallel batches with `graphlib.TopologicalSorter`, cycles named, critical path, locked steps and everything after them held | `dag_scheduler.py plan.json` |
| `pattern_memory.py` | learns section sequences weighted by the gates they passed; suggests and scores layouts [INFERENCE] | `learn mem.json nav,hero,faq,footer --passed contrast,sizes` |
| `static_intel.py` | inventory of saved manifests (RFC 8615 placement, RFC 9116 facts) and an entropy audit of string literals | `static_intel.py entropy jarvis/app/src` |
| `curriculum_50k.py` | 258,048 layouts and 54,250 Q&A pairs, decoded from their index, every answer computed | `export --kind qa --n 50000 --out work/qa.jsonl` |

## The maths, in one line each

- **Weisfeiler-Lehman**: each element's label becomes a hash of its role and its children's sorted
  labels, three rounds; the label histogram is the fingerprint; similarity is the cosine of two
  histograms.
- **Golden ratio**: type sizes are `base × φ^(step/2)` rounded to pixels; a split pane is 61.8 / 38.2;
  spacing snaps to 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 (DESIGN.md).
- **Scheduling**: Kahn-style ready sets from `graphlib`; the critical path is the longest weighted
  chain.
- **Markov memory**: transition counts weighted 1 + gates passed, Laplace smoothing, greedy walk.
- **Entropy**: H = −Σ p·log₂p bits per character.

## In giant-core

- Outputs that guess (archetypes, suggestions) carry `[INFERENCE]`.
- A step that moves money, publishes, changes permissions, installs or sends a message outside is
  always locked here, whatever a plan or a model says (AGENTS.md §1).
- The curriculum is for few-shot examples, evaluation and fine-tuning **elsewhere**: Ollama does not
  train models, and a tuned model is still advisory to Jarvis's rules. Exports are large; write them
  to a scratch folder, not into git.
- Templates from `synth` are clean-room: no source text, brand, images or scripts survive, and the
  page carries a strict CSP pinned by SHA-256.
