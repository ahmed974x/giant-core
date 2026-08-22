"""
Ø§ØªØ¬Ø§Ù‡ Ø§Ù„ØªØµÙ…ÙŠÙ…: Â«Giant Core WorkstationÂ» â€” Ø³Ø·Ø­ Ù…ÙƒØªØ¨ Ø¨Ø±Ù…Ø¬ÙŠ Ø¯Ø§ÙƒÙ† ÙˆÙ‡Ø§Ø¯Ø¦ØŒ Ù…ØªØ¯Ø±Ø¬
Ø¨Ø¨Ø·Ø¡ ÙˆÙ…Ø¯Ø±ÙˆØ³ Ù„Ù„Ù…Ø³ Ø¹Ù„Ù‰ iPad Pro. ØªØ±ÙƒØ² Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ø¹Ù„Ù‰ Ù…Ø­Ø±Ø± ÙˆØ§Ø¶Ø­ ÙˆÙ…Ø³Ø§Ø¹Ø¯ ÙƒÙˆØ¯ Ù…Ø­Ù„ÙŠ ØµØ§Ø¯Ù‚
ÙˆÙ„ÙˆØ­Ø§Øª Ø¬Ù„Ø³Ø© ÙˆÙ…Ù„Ù Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„Ù‚Ø±Ø§Ø¡Ø©ØŒ Ø¨Ø¯Ù„Ø§Ù‹ Ù…Ù† Ø§Ø¯Ø¹Ø§Ø¡ ØªÙ†ÙÙŠØ° Ø°ÙƒØ§Ø¡ Ø§ØµØ·Ù†Ø§Ø¹ÙŠ Ø®Ø§Ø±Ø¬ÙŠ.
"""

from __future__ import annotations

import html
from datetime import datetime
from pathlib import Path

import streamlit as st

from plugin_manager import (
    MERGED_PLUGIN_PATH,
    CodeAnalysis,
    analyze_python_code,
    get_plugin_file_summary,
    merge_plugin_code,
    run_merged_plugin,
)


WALLPAPER_URL = "/manus-storage/plugin-console-wallpaper_ed066218.png"
TERMINAL_TEXTURE_URL = "/manus-storage/plugin-terminal-ambient_734c444d.png"
LOGO_URL = "/manus-storage/plugin-symbol_fb028041.png"
MAX_OPERATION_LOG_ITEMS = 8


st.set_page_config(page_title="Giant Core", page_icon="â—ˆ", layout="wide", initial_sidebar_state="collapsed")


def inject_theme() -> None:
    """ÙŠØ¶ÙŠÙ ÙˆØ§Ø¬Ù‡Ø© Giant Core Ø§Ù„Ù…Ø±ÙŠØ­Ø© Ù„Ù„Ø¹ÙŠÙ† ÙˆÙ…Ù‚Ø§Ø³Ø§Øª Ù„Ù…Ø³ Ù…Ø±ØªÙØ¹Ø© Ù„Ù„Ø¢ÙŠØ¨Ø§Ø¯."""
    st.markdown(
        f"""
        <style>
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap');
        :root {{
            --ink:#eff8ff; --muted:#94a8ba; --line:rgba(193,225,247,.14); --blue:#64c8ff;
            --cyan:#75e5d8; --green:#83e5ad; --amber:#ffc46f; --red:#ff9898; --panel:rgba(9,20,34,.80);
        }}
        * {{ box-sizing:border-box; }} html, body, [class*="css"] {{ font-family:'IBM Plex Sans Arabic',sans-serif; }}
        @keyframes core-drift {{ 0%,100%{{background-position:0% 50%;}} 50%{{background-position:100% 50%;}} }}
        @keyframes glow {{ 0%,100%{{box-shadow:0 0 0 0 rgba(100,200,255,.18);}} 50%{{box-shadow:0 0 0 9px rgba(100,200,255,0);}} }}
        .stApp {{
            min-height:100vh; color:var(--ink); background:
                radial-gradient(circle at 14% 7%,rgba(49,156,222,.15),transparent 28%),
                radial-gradient(circle at 88% 92%,rgba(42,178,160,.11),transparent 26%),
                linear-gradient(125deg,#050a14,#0c2334,#0a1730,#06171a),url('{WALLPAPER_URL}') center/cover fixed;
            background-size:auto,auto,280% 280%,cover; animation:core-drift 32s ease-in-out infinite;
        }}
        #MainMenu, footer, header {{ visibility:hidden; }}
        .block-container {{ max-width:1540px; padding:clamp(.75rem,2.8vw,2.7rem) clamp(.8rem,3.7vw,4rem) 3rem; }}
        .workstation {{ overflow:hidden; border:1px solid rgba(214,237,252,.17); border-radius:30px; background:linear-gradient(145deg,rgba(18,33,50,.90),rgba(5,12,22,.96)); box-shadow:0 38px 108px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07); backdrop-filter:blur(22px); }}
        .windowbar {{ min-height:54px; padding:0 1.25rem; display:flex; align-items:center; gap:.54rem; border-bottom:1px solid var(--line); background:rgba(255,255,255,.018); }}
        .dot {{width:10px;height:10px;border-radius:50%;display:inline-block;}} .d1{{background:#ef7474;}}.d2{{background:#e6b35d;}}.d3{{background:#58c58e;}}
        .path {{margin-right:.4rem;color:#a8bdce;font:500 .69rem 'IBM Plex Mono',monospace;letter-spacing:.02em;}}
        .hero {{ padding:clamp(1.3rem,3.5vw,2.6rem) clamp(1.1rem,3.8vw,3rem) 1.05rem; display:flex;align-items:flex-start;justify-content:space-between;gap:1rem; }}
        .brand {{display:flex;align-items:center;gap:1rem;min-width:0;}} .mark {{width:58px;height:58px;flex:0 0 auto;border-radius:18px;background:#0979ba url('{LOGO_URL}') center/contain no-repeat;box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 12px 30px rgba(0,0,0,.25);}}
        .eyebrow {{margin:0 0 .3rem;color:var(--cyan);font:600 .68rem 'IBM Plex Mono',monospace;letter-spacing:.15em;}} h1 {{margin:0;color:#fbfdff;font-size:clamp(2rem,4.8vw,3.45rem);font-weight:700;letter-spacing:-.045em;line-height:1;}} .subtitle {{margin:.52rem 0 0;max-width:680px;color:#a7b9ca;font-size:clamp(.88rem,1.45vw,1.03rem);line-height:1.7;}}
        .core-state {{min-width:168px;padding:.78rem .9rem;border:1px solid rgba(117,229,216,.25);border-radius:16px;background:rgba(8,52,58,.35);text-align:right;}} .state-label {{margin:0;color:#9ab0c2;font:500 .62rem 'IBM Plex Mono',monospace;letter-spacing:.10em;}} .state-value {{margin:.28rem 0 0;color:var(--green);font:700 1.04rem 'IBM Plex Mono',monospace;}} .state-value.waiting{{color:var(--amber);}} .state-value::before{{content:'';display:inline-block;width:8px;height:8px;margin-left:.38rem;border-radius:50%;background:currentColor;animation:glow 2.6s ease-in-out infinite;}}
        .dashboard {{padding:0 clamp(1.1rem,3.8vw,3rem) 1.1rem;}} .section-row{{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.62rem;}} .section-title{{margin:0;color:#d8e8f5;font-size:.96rem;font-weight:700;}} .section-note{{margin:0;color:#8298aa;font-size:.77rem;}}
        .metric-grid {{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.68rem;}} .metric {{min-height:104px;padding:.9rem;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,.018));}} .metric-label{{margin:0;color:#91a6b9;font-size:.7rem;}} .metric-value{{margin:.4rem 0 0;color:#eff8ff;font:700 clamp(1.15rem,2vw,1.55rem) 'IBM Plex Mono',monospace;}} .metric-detail{{margin:.25rem 0 0;color:#7e94a9;font-size:.69rem;}}
        .assistant {{margin:.78rem 0 1rem;padding:1rem;border:1px solid rgba(100,200,255,.22);border-radius:18px;background:linear-gradient(108deg,rgba(14,78,108,.35),rgba(10,29,40,.48));}} .assistant-head{{display:flex;align-items:center;justify-content:space-between;gap:1rem;}} .assistant-title{{margin:0;color:#e5f4ff;font-size:1rem;font-weight:700;}} .assistant-caption{{margin:.24rem 0 0;color:#96aabc;font-size:.75rem;}} .local-tag{{padding:.32rem .5rem;border-radius:99px;color:#b5e8ff;background:rgba(100,200,255,.10);font:500 .61rem 'IBM Plex Mono',monospace;white-space:nowrap;}}
        .assistant-body{{display:grid;grid-template-columns:120px 1fr;gap:.75rem;align-items:stretch;margin-top:.78rem;}} .score{{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:110px;border:1px solid rgba(100,200,255,.20);border-radius:15px;background:rgba(2,12,19,.28);}} .score-number{{color:var(--cyan);font:700 2.1rem 'IBM Plex Mono',monospace;line-height:1;}} .score-label{{margin:.35rem 0 0;color:#9eb5c8;font-size:.64rem;letter-spacing:.07em;}} .assistant-columns{{display:grid;grid-template-columns:1fr 1fr;gap:.62rem;}} .assistant-group{{padding:.75rem;border-radius:13px;background:rgba(1,10,18,.27);}} .group-title{{margin:0 0 .48rem;color:#cde1ee;font-size:.78rem;font-weight:700;}} .assistant-item{{padding:.46rem .54rem;border-right:2px solid rgba(100,200,255,.68);border-radius:7px;color:#bbcedd;font-size:.74rem;line-height:1.55;}} .assistant-item+.assistant-item{{margin-top:.38rem;}} .diag-error{{border-right-color:var(--red);}} .diag-warning{{border-right-color:var(--amber);}} .diag-success{{border-right-color:var(--green);}}
        .workspace{{padding:0 clamp(1.1rem,3.8vw,3rem) clamp(1.3rem,3vw,2.6rem);}} .intel-grid{{display:grid;grid-template-columns:1.15fr .85fr;gap:.75rem;margin-bottom:.85rem;}} .intel-panel{{padding:.9rem 1rem;border:1px solid var(--line);border-radius:16px;background:rgba(7,16,27,.55);}} .intel-title{{margin:0;color:#d7e7f4;font-size:.87rem;font-weight:700;}} .file-main{{margin:.55rem 0 0;color:#f2f9ff;font:600 .84rem 'IBM Plex Mono',monospace;}} .intel-line{{margin:.32rem 0 0;color:#8ea4b7;font-size:.73rem;line-height:1.5;}} .session-rows{{margin-top:.52rem;display:grid;gap:.35rem;}} .session-row{{display:flex;justify-content:space-between;gap:.7rem;color:#9eb5c8;font-size:.73rem;}} .session-row strong{{color:#e1eff9;font:600 .72rem 'IBM Plex Mono',monospace;}}
        .editor-title{{margin:.8rem 0 .35rem;color:#d9e8f4;font-size:.98rem;font-weight:700;}} .editor-help{{margin:0 0 .65rem;color:#8098aa;font-size:.78rem;}} div[data-testid="stTextArea"] textarea{{min-height:380px!important;resize:vertical;padding:1.2rem 1.15rem!important;border:1px solid rgba(170,211,247,.20)!important;border-radius:17px!important;background:rgba(1,8,14,.74)!important;color:#dff0ff!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 16px 32px rgba(0,0,0,.15);font-family:'IBM Plex Mono',monospace!important;font-size:clamp(.9rem,1.5vw,1rem)!important;line-height:1.78!important;direction:ltr!important;text-align:left!important;}} div[data-testid="stTextArea"] textarea:focus{{border-color:rgba(100,200,255,.8)!important;box-shadow:0 0 0 3px rgba(100,200,255,.14),0 16px 32px rgba(0,0,0,.15)!important;}}
        div[data-testid="stButton"] > button{{min-height:62px;width:100%;border:1px solid rgba(177,214,241,.20);border-radius:15px;background:rgba(255,255,255,.06);color:#eff8ff;font:700 clamp(1rem,1.8vw,1.1rem) 'IBM Plex Sans Arabic',sans-serif;transition:transform 160ms cubic-bezier(.23,1,.32,1),background 160ms ease,border-color 160ms ease;}} div[data-testid="stButton"] > button:hover{{border-color:rgba(100,200,255,.67);background:rgba(100,200,255,.13);}} div[data-testid="stButton"] > button:active{{transform:scale(.975);}} div[data-testid="stButton"] > button[kind="primary"]{{border-color:rgba(117,229,216,.78);background:linear-gradient(135deg,#1786bf,#65d9d0);color:#03151b;box-shadow:0 12px 28px rgba(44,184,181,.22);}}
        .results,.operations{{margin-top:.92rem;padding:1rem 1.05rem;border:1px solid var(--line);border-radius:17px;background:rgba(7,15,25,.62);}} .results{{background:linear-gradient(rgba(5,12,21,.9),rgba(5,12,21,.94)),url('{TERMINAL_TEXTURE_URL}') center/cover;}} .panel-head{{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-bottom:.68rem;border-bottom:1px solid var(--line);}} .panel-title{{margin:0;color:#cedeea;font:600 .74rem 'IBM Plex Mono',monospace;letter-spacing:.08em;}} .panel-meta{{margin:.22rem 0 0;color:#7e94a9;font-size:.72rem;}} .panel-state{{margin:0;color:#a4ddff;font:600 .67rem 'IBM Plex Mono',monospace;}} .panel-state.error{{color:var(--red);}} .terminal{{margin:.82rem 0 0;color:#dceaf6;font:.88rem/1.72 'IBM Plex Mono',monospace;white-space:pre-wrap;direction:ltr;text-align:left;}} .placeholder{{display:block;margin-top:.85rem;color:#748c9f;font:.82rem/1.7 'IBM Plex Mono',monospace;}}
        .operation-list{{display:grid;gap:.46rem;margin-top:.65rem;}} .op-row{{display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:.65rem;padding:.62rem .7rem;border-radius:10px;background:rgba(255,255,255,.028);}} .op-time{{color:#7891a8;font:.67rem 'IBM Plex Mono',monospace;}} .op-title{{margin:0;color:#dceaf5;font-size:.78rem;font-weight:700;}} .op-detail{{margin:.12rem 0 0;color:#879daf;font-size:.71rem;}} .op-tag{{padding:.22rem .42rem;border-radius:99px;font:.59rem 'IBM Plex Mono',monospace;white-space:nowrap;}} .tag-info{{color:#a8ddff;background:rgba(100,200,255,.10);}}.tag-success{{color:var(--green);background:rgba(131,229,173,.10);}}.tag-error{{color:var(--red);background:rgba(255,152,152,.10);}}
        @media(max-width:1024px){{.block-container{{padding:.9rem 1rem 2.4rem;}}.workstation{{border-radius:22px;}}.hero{{padding:1.35rem 1.25rem 1rem;}}.dashboard{{padding:0 1.25rem 1rem;}}.workspace{{padding:0 1.25rem 1.35rem;}}.metric-grid{{grid-template-columns:repeat(4,minmax(0,1fr));}}.assistant-body{{grid-template-columns:105px 1fr;}}.intel-grid{{grid-template-columns:1fr 1fr;}}}}
        @media(max-width:720px){{.windowbar{{min-height:48px;}}.path{{font-size:.61rem;}}.hero{{padding:1.15rem 1rem .92rem;flex-direction:column;}}.mark{{width:48px;height:48px;border-radius:15px;}}.core-state{{width:100%;min-width:0;display:flex;align-items:center;justify-content:space-between;}}.state-value{{margin:0;}}.dashboard,.workspace{{padding-right:1rem;padding-left:1rem;}}.section-row{{align-items:flex-start;flex-direction:column;gap:.2rem;}}.metric-grid{{grid-template-columns:repeat(2,minmax(0,1fr));}}.assistant-body,.assistant-columns,.intel-grid{{grid-template-columns:1fr;}}.score{{min-height:82px;flex-direction:row;gap:.6rem;}}.score-label{{margin:0;}}.op-row{{grid-template-columns:46px 1fr;}}.op-tag{{grid-column:2;justify-self:start;}}div[data-testid="stTextArea"] textarea{{min-height:290px!important;}}}}
        @media(prefers-reduced-motion:reduce){{.stApp,.state-value::before{{animation:none!important;}}*{{transition:none!important;}}}}
        </style>
        """,
        unsafe_allow_html=True,
    )


def record_operation(title: str, detail: str, tone: str = "info") -> None:
    """ÙŠØ¶ÙŠÙ Ø¹Ù…Ù„ÙŠØ© Ø¬Ø¯ÙŠØ¯Ø© Ø¥Ù„Ù‰ Ø³Ø¬Ù„ Ø¬Ù„Ø³Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆÙŠØ­Ø§ÙØ¸ Ø¹Ù„Ù‰ Ø£Ø­Ø¯Ø« Ø§Ù„Ø¹Ù†Ø§ØµØ± ÙÙ‚Ø·."""
    log = st.session_state.setdefault("operation_log", [])
    log.insert(0, {"time": datetime.now().strftime("%H:%M"), "title": title, "detail": detail, "tone": tone})
    del log[MAX_OPERATION_LOG_ITEMS:]


def get_operation_log() -> list[dict[str, str]]:
    """ÙŠØ¹ÙŠØ¯ Ø³Ø¬Ù„ Ø§Ù„Ø¬Ù„Ø³Ø© Ø£Ùˆ Ø­Ø§Ù„Ø© Ø¨Ø¯Ø¡ ÙˆØ§Ø¶Ø­Ø© Ø¹Ù†Ø¯ Ø¹Ø¯Ù… ÙˆØ¬ÙˆØ¯ Ø¹Ù…Ù„ÙŠØ§Øª."""
    if "operation_log" not in st.session_state:
        st.session_state["operation_log"] = [{"time":"â€”","title":"Ø§Ù„Ù…Ø­Ø·Ø© Ø¬Ø§Ù‡Ø²Ø©","detail":"Ø£Ø¶Ù ÙƒÙˆØ¯Ø§Ù‹ Ù„Ø¨Ø¯Ø¡ Ø§Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ø­Ù„ÙŠ.","tone":"info"}]
    return st.session_state["operation_log"]


def session_totals() -> tuple[int, int, int]:
    """ÙŠØ­Ø³Ø¨ Ø¹Ø¯Ø¯ Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª ÙˆØ§Ù„Ù†Ø¬Ø§Ø­Ø§Øª ÙˆØ§Ù„Ø¥Ø®ÙØ§Ù‚Ø§Øª Ù…Ù† Ø³Ø¬Ù„ Ø§Ù„Ø¬Ù„Ø³Ø© Ø§Ù„Ø­Ø§Ù„ÙŠ."""
    log = get_operation_log()
    successes = sum(item["tone"] == "success" for item in log)
    failures = sum(item["tone"] == "error" for item in log)
    return len(log), successes, failures


def overall_status(analysis: CodeAnalysis) -> tuple[str, str, str]:
    """ÙŠØ­Ø¯Ø¯ Ø­Ø§Ù„Ø© Ø§Ù„Ù†ÙˆØ§Ø© Ø§Ù„Ø¹Ø§Ù…Ø© Ø¯ÙˆÙ† Ø¥Ø®ÙØ§Ø¡ Ø£Ø®Ø·Ø§Ø¡ Ø§Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ø­Ù„ÙŠ."""
    if not analysis.valid:
        return "REVIEW", "waiting", "ÙŠÙˆØ¬Ø¯ Ø®Ø·Ø£ Ù†Ø­ÙˆÙŠ ÙŠØ­ØªØ§Ø¬ Ø¥Ù„Ù‰ Ù…Ø±Ø§Ø¬Ø¹Ø© Ù‚Ø¨Ù„ Ø§Ù„ØªØ´ØºÙŠÙ„."
    if st.session_state.get("plugin_code", "").strip() or MERGED_PLUGIN_PATH.exists():
        return "ACTIVE", "active", "Ø§Ù„Ù…Ø³Ø§Ø¹Ø¯ Ø§Ù„Ù…Ø­Ù„ÙŠ ÙŠØ­Ù„Ù„ Ø¥Ø¶Ø§ÙØ© Ù…ØªØ§Ø­Ø© Ù„Ù„ØªØ´ØºÙŠÙ„ Ø£Ùˆ Ø§Ù„Ø­ÙØ¸."
    return "WAITING", "waiting", "Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø¥Ø¶Ø§ÙØ© ÙƒÙˆØ¯ Ø¥Ù„Ù‰ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ø¹Ù…Ù„."


def render_dashboard(analysis: CodeAnalysis) -> None:
    """ÙŠØ¹Ø±Ø¶ Ù‡ÙˆÙŠØ© Giant CoreØŒ Ø­Ø§Ù„Ø© Ø§Ù„Ù†ÙˆØ§Ø©ØŒ ÙˆÙ…Ù‚Ø§ÙŠÙŠØ³ Ø§Ù„Ù…Ù„Ù ÙˆØ§Ù„Ø¬Ù„Ø³Ø© ÙˆØ§Ù„Ù…Ø³Ø§Ø¹Ø¯."""
    status, status_class, status_detail = overall_status(analysis)
    summary = get_plugin_file_summary()
    operations, successes, failures = session_totals()
    file_status = summary.name if summary.exists else "Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù…Ù„Ù Ù…Ø¯Ù…Ø¬"
    diagnostics_html = "".join(
        f'<div class="assistant-item diag-{html.escape(item.level)}"><strong>{html.escape(item.title)}</strong><br>{html.escape(item.message)}</div>'
        for item in analysis.diagnostics
    )
    suggestions_html = "".join(
        f'<div class="assistant-item">{html.escape(item)}</div>' for item in analysis.suggestions
    )
    st.markdown(
        f"""
        <section class="hero"><div class="brand"><span class="mark" aria-hidden="true"></span><div>
            <p class="eyebrow">LOCAL PROGRAMMING WORKSTATION</p><h1>Giant Core</h1>
            <p class="subtitle">Ù…Ø³Ø§Ø­Ø© Ø¨Ø±Ù…Ø¬Ø© Ù…Ø±ÙƒØ²Ø© Ù„Ù„Ø¢ÙŠØ¨Ø§Ø¯: ØªØ­Ù„ÙŠÙ„ Ø«Ø§Ø¨ØªØŒ ØªØ´Ø®ÙŠØµ ÙˆØ§Ø¶Ø­ØŒ ÙˆØ¥Ø¯Ø§Ø±Ø© Ø¢Ù…Ù†Ø© Ù„Ù„Ù…Ù„Ù ÙˆØ§Ù„Ø¬Ù„Ø³Ø© Ù…Ù† Ø´Ø§Ø´Ø© ÙˆØ§Ø­Ø¯Ø©.</p></div></div>
            <aside class="core-state" title="{html.escape(status_detail)}"><p class="state-label">CORE STATUS</p><p class="state-value {status_class}">{status}</p></aside>
        </section>
        <section class="dashboard"><div class="section-row"><p class="section-title">Ù„ÙˆØ­Ø© ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø¬Ù„Ø³Ø©</p><p class="section-note">{html.escape(status_detail)}</p></div>
            <div class="metric-grid">
                <article class="metric"><p class="metric-label">CODE HEALTH</p><p class="metric-value">{analysis.score}%</p><p class="metric-detail">{analysis.line_count} Ø£Ø³Ø·Ø± Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„ØªØ­Ù„ÙŠÙ„</p></article>
                <article class="metric"><p class="metric-label">STRUCTURE</p><p class="metric-value">{analysis.function_count}</p><p class="metric-detail">Ø¯ÙˆØ§Ù„ Â· {analysis.class_count} Ø£ØµÙ†Ø§Ù</p></article>
                <article class="metric"><p class="metric-label">PLUGIN FILE</p><p class="metric-value">{summary.size_bytes if summary.exists else 'â€”'}</p><p class="metric-detail">{html.escape(file_status)}</p></article>
                <article class="metric"><p class="metric-label">SESSION</p><p class="metric-value">{operations}</p><p class="metric-detail">{successes} Ù†Ø¬Ø§Ø­ Â· {failures} Ø£Ø®Ø·Ø§Ø¡</p></article>
            </div>
            <section class="assistant" aria-live="polite"><div class="assistant-head"><div><p class="assistant-title">Ù…Ø³Ø§Ø¹Ø¯ Ø§Ù„ÙƒÙˆØ¯</p><p class="assistant-caption">ØªØ´Ø®ÙŠØµ ÙˆØ§Ù‚ØªØ±Ø§Ø­Ø§Øª Ù…Ø­Ù„ÙŠØ© Ø¹Ø¨Ø± ØªØ­Ù„ÙŠÙ„ Ø¨Ø§ÙŠØ«ÙˆÙ† Ø§Ù„Ø«Ø§Ø¨ØªØ› Ù„Ø§ ÙŠÙØ±Ø³Ù„ Ø§Ù„ÙƒÙˆØ¯ Ø¥Ù„Ù‰ Ø£ÙŠ Ø®Ø¯Ù…Ø© Ø®Ø§Ø±Ø¬ÙŠØ©.</p></div><span class="local-tag">LOCAL AUTO-DEBUG</span></div>
                <div class="assistant-body"><div class="score"><span class="score-number">{analysis.score}</span><span class="score-label">QUALITY SCORE</span></div>
                    <div class="assistant-columns"><div class="assistant-group"><p class="group-title">Ø§Ù„ØªØ´Ø®ÙŠØµ Ø§Ù„Ø¢Ù†</p>{diagnostics_html}</div><div class="assistant-group"><p class="group-title">Ø§Ù„Ø®Ø·ÙˆØ© Ø§Ù„Ù…Ù‚ØªØ±Ø­Ø©</p>{suggestions_html}</div></div>
                </div></section>
        </section>
        """,
        unsafe_allow_html=True,
    )


def render_workspace_intelligence() -> None:
    """ÙŠØ¹Ø±Ø¶ Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ù…Ù„Ù Ø§Ù„Ù…Ø­ÙÙˆØ¸ ÙˆÙ…Ø¤Ø´Ø±Ø§Øª Ø§Ù„Ø¬Ù„Ø³Ø© ÙÙˆÙ‚ Ù…Ø­Ø±Ø± Ø§Ù„ÙƒÙˆØ¯."""
    summary = get_plugin_file_summary()
    operations, successes, failures = session_totals()
    file_title = summary.name if summary.exists else "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¥Ø¶Ø§ÙØ© Ù…Ø­ÙÙˆØ¸Ø©"
    file_detail = f"{summary.size_bytes} Ø¨Ø§ÙŠØª Â· Ø¢Ø®Ø± ØªØ¹Ø¯ÙŠÙ„ {summary.modified_at}" if summary.exists else "Ø³ÙŠÙÙ†Ø´Ø£ Ù…Ø¬Ù„Ø¯ plugins Ø¹Ù†Ø¯ Ø£ÙˆÙ„ Ø¯Ù…Ø¬."
    st.markdown(
        f"""
        <section class="intel-grid"><article class="intel-panel"><p class="intel-title">Ø§Ù„Ù…Ù„Ù Ø§Ù„Ù†Ø´Ø·</p><p class="file-main">{html.escape(file_title)}</p><p class="intel-line">{html.escape(file_detail)}</p></article>
            <article class="intel-panel"><p class="intel-title">Ù†Ø¨Ø¶ Ø§Ù„Ø¬Ù„Ø³Ø©</p><div class="session-rows"><div class="session-row"><span>Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ù…Ø³Ø¬Ù„Ø©</span><strong>{operations}</strong></div><div class="session-row"><span>ØªØ´ØºÙŠÙ„ Ù†Ø§Ø¬Ø­</span><strong>{successes}</strong></div><div class="session-row"><span>ÙŠØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø©</span><strong>{failures}</strong></div></div></article>
        </section>
        """,
        unsafe_allow_html=True,
    )


def render_results() -> None:
    """ÙŠØ¹Ø±Ø¶ Ø¢Ø®Ø± Ù…Ø®Ø±Ø¬Ø§Øª ØªØ´ØºÙŠÙ„ ÙˆØ­Ø§Ù„ØªÙ‡Ø§ ÙˆÙ…Ø¯Ø© Ø§Ù„ØªÙ†ÙÙŠØ°."""
    result = st.session_state.get("last_result")
    if not result:
        body = '<span class="placeholder"># Ø³ØªØ¸Ù‡Ø± Ù‡Ù†Ø§ Ù…Ø®Ø±Ø¬Ø§Øª Ø§Ù„Ø¥Ø¶Ø§ÙØ© Ø£Ùˆ Ø±Ø³Ø§Ù„Ø© Ø§Ù„Ø®Ø·Ø£ Ø¨Ø¹Ø¯ Ø§Ù„ØªØ´ØºÙŠÙ„.</span>'
        state, state_class, meta = "WAITING", "", "Ù„Ù… ÙŠÙØ³Ø¬Ù‘Ù„ ØªØ´ØºÙŠÙ„ ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ø¬Ù„Ø³Ø©"
    else:
        content = result["content"] or "# ØªÙ… Ø§Ù„ØªÙ†ÙÙŠØ° Ø¨Ù†Ø¬Ø§Ø­ Ø¯ÙˆÙ† Ù…Ø®Ø±Ø¬Ø§Øª Ù†ØµÙŠØ©."
        body = f'<pre class="terminal">{html.escape(content)}</pre>'
        state, state_class = ("COMPLETED", "") if result["ok"] else ("STOPPED", "error")
        meta = f"{max(1, len(content.splitlines()))} Ø³Ø·Ø± Â· {result.get('duration_ms', 0)} Ù…Ù„Ù„ÙŠ Ø«Ø§Ù†ÙŠØ©"
    st.markdown(
        f'<section class="results" aria-live="polite"><div class="panel-head"><div><p class="panel-title">RESULTS / CONSOLE</p><p class="panel-meta">{meta}</p></div><p class="panel-state {state_class}">{state}</p></div>{body}</section>',
        unsafe_allow_html=True,
    )


def render_operation_log() -> None:
    """ÙŠØ¹Ø±Ø¶ Ø³Ø¬Ù„ Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ø¬Ù„Ø³Ø© Ø¨ØªØ±ØªÙŠØ¨ Ø²Ù…Ù†ÙŠ Ø¹ÙƒØ³ÙŠ ÙˆÙ…Ù‚Ø±ÙˆØ¡ Ù„Ù„Ù…Ø³."""
    rows = "".join(
        f'<div class="op-row"><span class="op-time">{html.escape(item["time"])}</span><div><p class="op-title">{html.escape(item["title"])}</p><p class="op-detail">{html.escape(item["detail"])}</p></div><span class="op-tag tag-{html.escape(item["tone"])}">{html.escape(item["tone"].upper())}</span></div>'
        for item in get_operation_log()
    )
    st.markdown(
        f'<section class="operations"><div class="panel-head"><div><p class="panel-title">SESSION ACTIVITY</p><p class="panel-meta">Ø¢Ø®Ø± Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ø¬Ù„Ø³Ø©</p></div><p class="panel-state">LOG</p></div><div class="operation-list">{rows}</div></section>',
        unsafe_allow_html=True,
    )


def main() -> None:
    """ÙŠØ´ØºÙ‘Ù„ Ù…Ø­Ø·Ø© Giant Core Ù…Ø¹ Ø§Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ø­Ù„ÙŠ ÙˆØ­ÙØ¸ ÙˆØªØ´ØºÙŠÙ„ Ø§Ù„Ø¥Ø¶Ø§ÙØ§Øª."""
    inject_theme()
    current_code = st.session_state.get("plugin_code", "")
    analysis = analyze_python_code(current_code)
    get_operation_log()

    st.markdown('<main class="workstation">', unsafe_allow_html=True)
    st.markdown('<div class="windowbar"><span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span><span class="path">giant-core / ipad-workstation / plugins</span></div>', unsafe_allow_html=True)
    render_dashboard(analysis)
    st.markdown('<section class="workspace">', unsafe_allow_html=True)
    render_workspace_intelligence()
    st.markdown('<p class="editor-title">Ù…Ø³Ø§Ø­Ø© Ø¨Ø±Ù…Ø¬Ø© Ø¨Ø§ÙŠØ«ÙˆÙ†</p><p class="editor-help">Ø£Ù„ØµÙ‚ Ø§Ù„ÙƒÙˆØ¯ØŒ Ø±Ø§Ù‚Ø¨ ØªØ´Ø®ÙŠØµ Ù…Ø³Ø§Ø¹Ø¯ Ø§Ù„ÙƒÙˆØ¯ØŒ Ø«Ù… Ø§Ø¯Ù…Ø¬Ù‡ Ù„Ù„Ø­ÙØ¸ Ø£Ùˆ Ø´ØºÙ‘Ù„Ù‡ Ù„Ø¹Ø±Ø¶ Ø§Ù„Ù†ØªÙŠØ¬Ø© ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ø¬Ù„Ø³Ø©.</p>', unsafe_allow_html=True)
    code = st.text_area("Ù…Ø³Ø§Ø­Ø© Ø¨Ø±Ù…Ø¬Ø© Ø¨Ø§ÙŠØ«ÙˆÙ†", key="plugin_code", height=410, placeholder="def run_plugin():\n    print('Giant Core ready')\n\nrun_plugin()", label_visibility="collapsed")

    merge_column, run_column = st.columns(2, gap="medium")
    with merge_column:
        merge_clicked = st.button("Ø¯Ù…Ø¬ ÙˆØ­ÙØ¸ Ø§Ù„Ø¥Ø¶Ø§ÙØ©", use_container_width=True)
    with run_column:
        run_clicked = st.button("ØªØ´ØºÙŠÙ„ Ø§Ù„Ø¥Ø¶Ø§ÙØ©", type="primary", use_container_width=True)

    if merge_clicked:
        try:
            path = merge_plugin_code(code)
            record_operation("ØªÙ… Ø¯Ù…Ø¬ Ø§Ù„Ø¥Ø¶Ø§ÙØ©", f"Ø­ÙÙØ¸Øª Ø§Ù„Ù†Ø³Ø®Ø© ÙÙŠ {Path(path).parent.name}/{Path(path).name}.", "success")
            st.success(f"Ø­ÙÙØ¸Øª Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…Ø¯Ù…Ø¬Ø© ÙÙŠ {Path(path).parent.name}/{Path(path).name}")
        except ValueError as exc:
            record_operation("ØªØ¹Ø°Ø± Ø§Ù„Ø¯Ù…Ø¬", str(exc), "error")
            st.warning(str(exc))

    if run_clicked:
        try:
            merge_plugin_code(code)
            result = run_merged_plugin()
            st.session_state["last_result"] = {
                "ok": result.ok,
                "content": result.output if result.ok else (result.error or result.output),
                "duration_ms": result.duration_ms,
            }
            if result.ok:
                record_operation("Ø§ÙƒØªÙ…Ù„ ØªØ´ØºÙŠÙ„ Ø§Ù„Ø¥Ø¶Ø§ÙØ©", f"Ø§Ù†ØªÙ‡Øª Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø®Ù„Ø§Ù„ {result.duration_ms} Ù…Ù„Ù„ÙŠ Ø«Ø§Ù†ÙŠØ©.", "success")
            else:
                record_operation("ØªÙˆÙ‚Ù ØªØ´ØºÙŠÙ„ Ø§Ù„Ø¥Ø¶Ø§ÙØ©", "Ø±Ø§Ø¬Ø¹ ØªÙØ§ØµÙŠÙ„ Ø§Ù„ØªØ´Ø®ÙŠØµ Ø£Ùˆ Ø§Ù„Ù†ØªØ§Ø¦Ø¬ Ù‚Ø¨Ù„ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„ØªØ§Ù„ÙŠØ©.", "error")
        except ValueError as exc:
            st.session_state["last_result"] = {"ok": False, "content": str(exc), "duration_ms": 0}
            record_operation("ØªØ¹Ø°Ø± ØªØ´ØºÙŠÙ„ Ø§Ù„Ø¥Ø¶Ø§ÙØ©", str(exc), "error")

    render_results()
    render_operation_log()
    st.markdown('</section></main>', unsafe_allow_html=True)
    if merge_clicked or run_clicked:
        st.rerun()

