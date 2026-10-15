# physics_lab: مختبر مؤشرات "الفيزياء" (تجربة ورقية فقط)

اختبار ورقي لثلاث أفكار من مقترح NABD: أُس هيرست، تباعد ليابونوف، ونسبة "رينولدز" للسوق.
لا تداول، لا أوامر، لا تحريك أموال، لا رسائل خارجية. القرار والتصميم في
[ADR-065](../docs/adr/ADR-065-physics-signals-paper-experiment.md)، والنتائج في
[results/REPORT.md](results/REPORT.md).

Paper-only test of Hurst, Lyapunov-style divergence and a Reynolds-style ratio on free daily data
(S&P 500, WTI, Bitcoin), scored against 20-day volatility and VIX.

```bash
pip install -r physics_lab/requirements.txt
python -m pytest -q physics_lab          # 15 known-answer tests, no network
python -m physics_lab.backtest            # downloads 3 public CSVs, ~3 min on CPU
```

| File | What |
|---|---|
| `signals.py` | `hurst_dfa`, `hurst_rs`, `lyapunov_rosenstein`, `reynolds_style`, `realized_vol` |
| `data.py` | keyless loaders + SHA-256 of every download |
| `backtest.py` | rolling signals, AUC with block-bootstrap CI, shuffled-noise bands, crisis-event table |
| `results/` | `metrics.json`, `REPORT.md`, daily signal CSVs |
