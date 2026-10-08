"""Local plugin engine for the Giant Core workstation.

Static analysis via ``ast`` (code never leaves the machine), saving the merged plugin
to ``plugins/``, and running it in a separate, time-limited Python process.
"""

from __future__ import annotations

import ast
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PLUGINS_DIR = Path(__file__).resolve().parent / "plugins"
MERGED_PLUGIN_PATH = PLUGINS_DIR / "merged_plugin.py"
RUN_TIMEOUT_S = 10
MAX_OUTPUT_CHARS = 20_000
MAX_CODE_BYTES = 200_000


@dataclass
class Diagnostic:
    level: str  # "error" | "warning" | "info"
    title: str
    message: str


@dataclass
class CodeAnalysis:
    valid: bool
    score: int
    line_count: int
    function_count: int
    class_count: int
    diagnostics: list[Diagnostic] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


@dataclass
class PluginFileSummary:
    exists: bool
    name: str
    size_bytes: int
    modified_at: str


@dataclass
class RunResult:
    ok: bool
    output: str
    error: str | None
    duration_ms: int


def analyze_python_code(code: str) -> CodeAnalysis:
    """يحلل الكود محلياً ويعيد درجة جودة وتشخيصات واقتراحات."""
    lines = [line for line in code.splitlines() if line.strip()]
    if not lines:
        return CodeAnalysis(
            valid=True, score=0, line_count=0, function_count=0, class_count=0,
            diagnostics=[Diagnostic("info", "مساحة العمل فارغة", "ألصق كود بايثون لبدء التحليل.")],
            suggestions=["ابدأ بدالة run_plugin() واستدعها في آخر الملف."],
        )

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return CodeAnalysis(
            valid=False, score=0, line_count=len(lines), function_count=0, class_count=0,
            diagnostics=[Diagnostic("error", f"خطأ نحوي في السطر {exc.lineno}", exc.msg or "تعذر تحليل الكود.")],
            suggestions=["أصلح الخطأ النحوي أولاً ثم أعد التحليل."],
        )

    functions = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    diagnostics: list[Diagnostic] = []
    suggestions: list[str] = []
    score = 100

    undocumented = [f.name for f in functions if not ast.get_docstring(f)]
    if undocumented:
        score -= min(20, 5 * len(undocumented))
        diagnostics.append(Diagnostic("warning", "دوال بلا توثيق", "، ".join(undocumented[:5])))
        suggestions.append("أضف docstring قصيراً لكل دالة.")

    bare_excepts = sum(isinstance(n, ast.ExceptHandler) and n.type is None for n in ast.walk(tree))
    if bare_excepts:
        score -= 15
        diagnostics.append(Diagnostic("warning", "except عام", f"{bare_excepts} موضع يلتقط كل الأخطاء بلا تمييز."))
        suggestions.append("حدّد نوع الاستثناء بدلاً من except العام.")

    risky = sorted({n.func.id for n in ast.walk(tree)
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in {"eval", "exec"}})
    if risky:
        score -= 25
        diagnostics.append(Diagnostic("error", "استدعاء خطر", "، ".join(risky)))
        suggestions.append("تجنّب eval/exec واستخدم منطقاً صريحاً.")

    long_lines = sum(len(line) > 120 for line in code.splitlines())
    if long_lines:
        score -= min(10, long_lines)
        diagnostics.append(Diagnostic("info", "أسطر طويلة", f"{long_lines} سطر أطول من 120 حرفاً."))

    if not diagnostics:
        diagnostics.append(Diagnostic("info", "لا مشاكل", "الكود سليم نحوياً ولا توجد ملاحظات."))
    if not suggestions:
        suggestions.append("الكود جاهز للدمج أو التشغيل.")

    return CodeAnalysis(
        valid=True, score=max(0, score), line_count=len(lines),
        function_count=len(functions), class_count=len(classes),
        diagnostics=diagnostics, suggestions=suggestions,
    )


def get_plugin_file_summary() -> PluginFileSummary:
    """يعيد معلومات ملف الإضافة المدمجة إن وُجد."""
    if not MERGED_PLUGIN_PATH.exists():
        return PluginFileSummary(False, MERGED_PLUGIN_PATH.name, 0, "")
    stat = MERGED_PLUGIN_PATH.stat()
    return PluginFileSummary(
        True, MERGED_PLUGIN_PATH.name, stat.st_size,
        datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
    )


def merge_plugin_code(code: str) -> Path:
    """يتحقق من الكود ويحفظه في plugins/merged_plugin.py. يرفع ValueError عند الرفض."""
    if not code.strip():
        raise ValueError("لا يوجد كود للدمج.")
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise ValueError("الكود أكبر من الحد المسموح (200 كيلوبايت).")
    try:
        ast.parse(code)
    except SyntaxError as exc:
        raise ValueError(f"خطأ نحوي في السطر {exc.lineno}: {exc.msg}") from exc
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    MERGED_PLUGIN_PATH.write_text(code, encoding="utf-8")
    return MERGED_PLUGIN_PATH


def run_merged_plugin() -> RunResult:
    """يشغّل الإضافة المحفوظة في عملية بايثون منفصلة ومعزولة بمهلة زمنية."""
    if not MERGED_PLUGIN_PATH.exists():
        raise ValueError("لا توجد إضافة محفوظة للتشغيل.")
    started = time.perf_counter()
    try:
        proc = subprocess.run(
            [sys.executable, "-I", str(MERGED_PLUGIN_PATH)],
            cwd=PLUGINS_DIR, capture_output=True, text=True, timeout=RUN_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return RunResult(False, "", f"تجاوزت الإضافة المهلة ({RUN_TIMEOUT_S} ثوانٍ) وأُوقفت.",
                         int((time.perf_counter() - started) * 1000))
    duration = int((time.perf_counter() - started) * 1000)
    return RunResult(
        ok=proc.returncode == 0,
        output=proc.stdout[-MAX_OUTPUT_CHARS:],
        error=proc.stderr[-MAX_OUTPUT_CHARS:] or None,
        duration_ms=duration,
    )
