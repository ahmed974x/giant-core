"""NABD Cognitive Modes Layer, Phase 1: the mode registry.

A cognitive mode is a named way of thinking (for example ``/causeeffect`` or
``/verify``) that an agent can be asked to work in. This module only *declares*
the modes: their category, a bilingual description and the agents they suit.

Out of scope for Phase 1 (see ADR-064): switching modes, prompt templates,
mode history in pgvector, and wiring modes into agents.

Descriptions are written by the NABD team. They are not copied from any
third-party prompt library. Standard library only, so the module stays well
inside the 7 GB RAM budget.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Iterable, Mapping

# --- Agents -----------------------------------------------------------------

DIRECTOR = "director_00"
BUTTERFLY = "butterfly"
TRUTH = "truth_layer"
PHOENIX = "phoenix"
CALIBRATOR = "auto_calibration"
META = "meta_cognition"
RED_BLUE = "red_blue_team"
REPORT_WRITER = "report_writer"
MARKET = "market"
MARITIME = "maritime"
LIBRARY = "library"
ALL_AGENTS = "all_agents"

AGENTS: frozenset[str] = frozenset(
    {
        DIRECTOR,
        BUTTERFLY,
        TRUTH,
        PHOENIX,
        CALIBRATOR,
        META,
        RED_BLUE,
        REPORT_WRITER,
        MARKET,
        MARITIME,
        LIBRARY,
        ALL_AGENTS,
    }
)

# --- Categories (key -> (Arabic label, English label)) ----------------------

CATEGORIES: Mapping[str, tuple[str, str]] = MappingProxyType(
    {
        "learning": ("التعلّم والفهم", "Learning"),
        "practice": ("التدريب", "Practice"),
        "writing": ("الكتابة", "Writing"),
        "organization": ("التنظيم", "Organization"),
        "reading": ("القراءة", "Reading"),
        "math": ("الرياضيات", "Math"),
        "language": ("اللغة", "Language"),
        "exam": ("الاختبارات والتخطيط", "Exams & planning"),
        "self_improvement": ("التحسين الذاتي", "Self-improvement"),
        "research": ("البحث", "Research writing"),
        "analysis": ("التحليل والتحقق", "Analysis & verification"),
    }
)


@dataclass(frozen=True)
class CognitiveMode:
    name: str
    category: str
    description_ar: str
    description_en: str
    targets: tuple[str, ...]


def _m(name: str, category: str, ar: str, en: str, *targets: str) -> CognitiveMode:
    return CognitiveMode(name, category, ar, en, tuple(targets))


_MODES: tuple[CognitiveMode, ...] = (
    # learning
    _m("/teachback", "learning",
       "يشرح الفكرة بكلماته ثم يصحّح نفسه من ملاحظات المستخدم.",
       "Explain the idea back in its own words, then correct it from the user's feedback.",
       DIRECTOR),
    _m("/coreidea", "learning",
       "يستخرج الفكرة الجوهرية من أي تحليل في جملة واحدة.",
       "Pull the single central idea out of an analysis.",
       DIRECTOR, BUTTERFLY, TRUTH),
    _m("/firstprinciples", "learning",
       "يفكك المشكلة إلى حقائقها الأساسية ويعيد البناء منها.",
       "Break the problem down to basic facts and rebuild the reasoning from them.",
       DIRECTOR, BUTTERFLY),
    _m("/causeeffect", "learning",
       "يربط كل نتيجة بأسبابها المباشرة وغير المباشرة.",
       "Link each outcome to its direct and indirect causes.",
       DIRECTOR, BUTTERFLY),
    _m("/counterexample", "learning",
       "يبحث عن مثال واحد ينقض الفرضية.",
       "Look for a single case that would break the hypothesis.",
       BUTTERFLY, RED_BLUE),
    _m("/edgecase", "learning",
       "يختبر الاستنتاج على الحالات الحدّية والنادرة.",
       "Test the conclusion against rare and boundary cases.",
       DIRECTOR, PHOENIX, CALIBRATOR),
    _m("/knowledgegap", "learning",
       "يحدد ما لا يعرفه بعد ويلزمه لإكمال المهمة.",
       "Name what it does not know yet but needs for the task.",
       DIRECTOR, META),
    _m("/confusion", "learning",
       "يرصد النقاط الغامضة أو المتناقضة قبل المتابعة.",
       "Flag unclear or contradictory points before moving on.",
       DIRECTOR, META),
    _m("/misconceptions", "learning",
       "يكشف الافتراضات الخاطئة في قرارات أو معلومات سابقة.",
       "Expose wrong assumptions in earlier decisions or information.",
       DIRECTOR, TRUTH, RED_BLUE),
    _m("/bigpicture", "learning",
       "يعرض الصورة الكاملة قبل الدخول في التفاصيل.",
       "Lay out the whole picture before going into detail.",
       DIRECTOR),
    _m("/layers", "learning",
       "يشرح الموضوع على مستويات متدرجة حسب خبرة القارئ.",
       "Explain the topic in graded levels matched to the reader's expertise.",
       DIRECTOR),
    # practice
    _m("/drill", "practice",
       "يكرر نوع مهمة واحد حتى يثبت الأداء.",
       "Repeat one kind of task until performance is steady.",
       CALIBRATOR),
    _m("/practice", "practice",
       "تمارين متدرجة الصعوبة على مهارة محددة.",
       "Exercises of rising difficulty on one skill.",
       CALIBRATOR),
    _m("/challenge", "practice",
       "مسألة أصعب قليلاً من المستوى الحالي.",
       "A problem one step above the current level.",
       CALIBRATOR),
    _m("/challengeboss", "practice",
       "أصعب اختبار ممكن لدفع الحدود ومواجهة الخصم.",
       "The hardest available test, used to push limits or face an opponent.",
       CALIBRATOR, RED_BLUE),
    _m("/oracleexam", "practice",
       "اختبار ذاتي دوري بإجابات معروفة لقياس الدقة.",
       "Periodic self-exam against known answers to measure accuracy.",
       CALIBRATOR),
    _m("/timedtest", "practice",
       "اختبار بمهلة زمنية لقياس الأداء تحت الضغط.",
       "A time-boxed test to measure performance under pressure.",
       CALIBRATOR),
    _m("/speedrun", "practice",
       "تدريب على إنجاز المهمة أسرع دون خسارة الدقة.",
       "Train to finish the task faster without losing accuracy.",
       CALIBRATOR),
    _m("/selftest", "practice",
       "يختبر نفسه بأسئلة يولّدها قبل تسليم النتيجة.",
       "Quiz itself with its own questions before handing over a result.",
       PHOENIX, CALIBRATOR, META),
    _m("/mastery", "practice",
       "يتحقق إن كانت المهارة متقنة فعلاً أم سطحية.",
       "Check whether a skill is truly mastered or only shallow.",
       PHOENIX, CALIBRATOR, META),
    # writing
    _m("/abstract", "writing",
       "يكتب ملخصاً قصيراً يغطي الهدف والطريقة والنتيجة.",
       "Write a short summary covering aim, method and result.",
       REPORT_WRITER),
    _m("/thesis", "writing",
       "يصوغ الادعاء الرئيسي في جملة واضحة قابلة للدفاع.",
       "State the main claim in one clear, defensible sentence.",
       REPORT_WRITER),
    _m("/findings", "writing",
       "يعرض النتائج مرتبة حسب الأهمية مع دليل كل منها.",
       "Present results by importance, each with its evidence.",
       REPORT_WRITER),
    _m("/coherence", "writing",
       "يتأكد أن الأفكار مترابطة وتخدم الادعاء نفسه.",
       "Make sure the ideas connect and serve the same claim.",
       REPORT_WRITER),
    _m("/transition", "writing",
       "يحسّن الانتقال بين الفقرات والأقسام.",
       "Smooth the moves between paragraphs and sections.",
       REPORT_WRITER),
    _m("/tonecheck", "writing",
       "يراجع النبرة لتناسب القارئ والغرض.",
       "Review the tone so it fits the reader and the purpose.",
       REPORT_WRITER, DIRECTOR),
    _m("/structurecheck", "writing",
       "يراجع ترتيب الأقسام ويقترح بنية أوضح.",
       "Review section order and propose a clearer structure.",
       REPORT_WRITER),
    # organization
    _m("/comparematrix", "organization",
       "يقارن الخيارات في جدول بمعايير موحدة.",
       "Compare options in a table with shared criteria.",
       DIRECTOR),
    _m("/extract", "organization",
       "يستخرج الحقول المطلوبة فقط من نص أو بيانات.",
       "Pull only the required fields out of text or data.",
       ALL_AGENTS),
    _m("/classify", "organization",
       "يصنّف العناصر في فئات محددة مسبقاً.",
       "Sort items into predefined classes.",
       ALL_AGENTS),
    _m("/filter", "organization",
       "يستبعد ما لا يطابق الشروط ويُبقي المهم.",
       "Drop what does not meet the criteria and keep what matters.",
       ALL_AGENTS),
    _m("/sort", "organization",
       "يرتّب العناصر حسب معيار واحد معلن.",
       "Order items by one stated key.",
       ALL_AGENTS),
    _m("/rank", "organization",
       "يرتّب الخيارات حسب الأولوية مع سبب كل ترتيب.",
       "Rank options by priority with a reason for each place.",
       DIRECTOR),
    _m("/proscons", "organization",
       "يوازن المزايا والعيوب لكل خيار.",
       "Weigh the advantages and drawbacks of each option.",
       DIRECTOR, RED_BLUE),
    # reading
    _m("/dataread", "reading",
       "يقرأ جدول بيانات ويصف ما يظهره وما لا يظهره.",
       "Read a data table and describe what it shows and what it does not.",
       MARKET, MARITIME),
    _m("/chartread", "reading",
       "يقرأ رسماً بيانياً: المحاور والاتجاه والقيم الشاذة.",
       "Read a chart: axes, trend and outliers.",
       MARKET),
    _m("/documentmap", "reading",
       "يرسم خريطة لأقسام المستند وأين توجد كل معلومة.",
       "Map a document's sections and where each fact lives.",
       LIBRARY),
    _m("/givens", "reading",
       "يحصر المعطيات المؤكدة قبل البدء بالحل.",
       "List the confirmed inputs before starting to solve.",
       ALL_AGENTS),
    _m("/unknowns", "reading",
       "يحصر المجاهيل المطلوب إيجادها.",
       "List the unknowns that need to be found.",
       ALL_AGENTS),
    _m("/methodselect", "reading",
       "يختار طريقة الحل المناسبة ويبرر الاختيار.",
       "Choose a suitable solving method and justify the choice.",
       ALL_AGENTS),
    _m("/formulaexplainer", "reading",
       "يشرح معادلة رمزاً رمزاً ومعنى كل جزء.",
       "Explain a formula term by term and what each part means.",
       LIBRARY, MARKET),
    # math
    _m("/estimate", "math",
       "يقدّر رقماً تقريبياً سريعاً قبل الحساب الدقيق.",
       "Make a quick rough estimate before the exact calculation.",
       MARKET, MARITIME, DIRECTOR),
    _m("/graph", "math",
       "يمثّل العلاقة بين المتغيرات بيانياً.",
       "Represent the relation between variables as a graph.",
       MARKET),
    _m("/derivation", "math",
       "يشتق النتيجة خطوة خطوة مع تبرير كل خطوة.",
       "Derive the result step by step, justifying each step.",
       BUTTERFLY, LIBRARY),
    _m("/alternative", "math",
       "يقترح طريقة أو تفسيراً بديلاً للوصول للنتيجة.",
       "Propose another method or explanation for the result.",
       BUTTERFLY, RED_BLUE),
    # language
    _m("/wordroots", "language",
       "يفكك الكلمة إلى جذرها لفهم معناها.",
       "Break a word down to its root to understand its meaning.",
       LIBRARY),
    _m("/synonyms", "language",
       "يقترح مرادفات مناسبة للسياق.",
       "Suggest synonyms that fit the context.",
       REPORT_WRITER),
    _m("/antonyms", "language",
       "يقترح أضداداً لتوضيح المعنى بالمقابلة.",
       "Suggest opposites that clarify meaning by contrast.",
       REPORT_WRITER),
    # exam & planning
    _m("/crammap", "exam",
       "خريطة مراجعة مكثفة لأهم النقاط في وقت قصير.",
       "A compact review map of the key points for a short window.",
       DIRECTOR),
    _m("/studybreak", "exam",
       "يقسّم العمل إلى جلسات مع فواصل راحة.",
       "Split the work into sessions with rest breaks.",
       DIRECTOR),
    _m("/examstrategy", "exam",
       "خطة للتعامل مع الاختبار: الترتيب والوقت والتخمين.",
       "A plan for taking a test: order, timing and guessing.",
       DIRECTOR),
    _m("/studentcoach", "exam",
       "يدرّب المستخدم بأسئلة موجّهة بدل إعطاء الإجابة.",
       "Coach the user with guiding questions instead of giving the answer.",
       DIRECTOR),
    _m("/deadline", "exam",
       "يرتّب المهام بالعودة من الموعد النهائي.",
       "Plan tasks backwards from the deadline.",
       DIRECTOR),
    _m("/subjectpriority", "exam",
       "يحدد أي المواضيع أولاً حسب الوزن والضعف.",
       "Decide which topics come first by weight and weakness.",
       DIRECTOR, CALIBRATOR),
    _m("/roadmap", "exam",
       "يبني خارطة طريق بمراحل ومعالم واضحة.",
       "Build a roadmap with clear phases and milestones.",
       DIRECTOR),
    _m("/nextstep", "exam",
       "يحدد الخطوة التالية الواحدة الأكثر فائدة.",
       "Name the single most useful next step.",
       DIRECTOR, CALIBRATOR),
    # self-improvement
    _m("/mistakebook", "self_improvement",
       "يسجّل كل خطأ وسببه وتصحيحه للرجوع إليه.",
       "Log each mistake with its cause and fix for later review.",
       PHOENIX),
    _m("/errorpatterns", "self_improvement",
       "يبحث عن أخطاء متكررة لها السبب نفسه.",
       "Look for recurring mistakes that share a cause.",
       PHOENIX, CALIBRATOR),
    _m("/accuracy", "self_improvement",
       "يقيس نسبة الصواب ويركّز على تقليل الأخطاء.",
       "Measure the hit rate and focus on cutting errors.",
       CALIBRATOR),
    _m("/weakness", "self_improvement",
       "يحدد أضعف نقطة في أدائه الحالي.",
       "Find the weakest point in its current performance.",
       PHOENIX, CALIBRATOR, META),
    _m("/debug", "self_improvement",
       "يتتبع الخلل إلى سببه الجذري ثم يقترح إصلاحاً.",
       "Trace a fault to its root cause, then propose a fix.",
       PHOENIX),
    _m("/checkwork", "self_improvement",
       "يراجع عمله المنجز ويحدد موضع الخطأ بدقة.",
       "Review finished work and pinpoint where it went wrong.",
       PHOENIX),
    _m("/feedback", "self_improvement",
       "يقيّم أداءه ويكتب ملاحظات محددة للتحسين.",
       "Assess its own performance and write specific notes to improve.",
       META),
    # research writing
    _m("/topicidea", "research",
       "يقترح مواضيع بحث قابلة للتنفيذ.",
       "Suggest research topics that are feasible.",
       DIRECTOR, REPORT_WRITER),
    _m("/brainstorm", "research",
       "يولّد أفكاراً كثيرة دون حكم ثم يفرزها.",
       "Generate many ideas without judging, then sort them.",
       DIRECTOR, RED_BLUE),
    _m("/researchquestion", "research",
       "يصوغ سؤال بحث محدداً قابلاً للإجابة.",
       "Frame a specific, answerable research question.",
       DIRECTOR, REPORT_WRITER),
    _m("/methodology", "research",
       "يصف كيف ستُجمع البيانات وتُحلل ولماذا.",
       "Describe how data will be gathered and analysed, and why.",
       REPORT_WRITER, BUTTERFLY),
    _m("/counterargument", "research",
       "يكتب أقوى رد معارض ثم يجيب عليه.",
       "Write the strongest opposing argument, then answer it.",
       RED_BLUE, REPORT_WRITER),
    _m("/paragraph", "research",
       "يبني فقرة: فكرة رئيسية ثم دليل ثم ربط.",
       "Build a paragraph: main point, then evidence, then link.",
       REPORT_WRITER),
    # analysis & verification
    _m("/verify", "analysis",
       "يعيد فحص النتيجة بطريقة مستقلة قبل اعتمادها.",
       "Re-check a result by an independent route before relying on it.",
       ALL_AGENTS),
    _m("/factcheck", "analysis",
       "يطابق كل ادعاء مع مصدر يمكن فتحه.",
       "Match each claim to a source that can be opened.",
       TRUTH),
    _m("/sourcecheck", "analysis",
       "يقيّم موثوقية المصدر وحداثته وتحيّزه.",
       "Rate a source's reliability, freshness and bias.",
       TRUTH),
    _m("/evidence", "analysis",
       "يحدد الأدلة التي تدعم الاستنتاج والتي تضعفه.",
       "Identify the evidence for and against the conclusion.",
       TRUTH, BUTTERFLY),
    _m("/logicchain", "analysis",
       "يكتب سلسلة الاستدلال كاملة خطوة خطوة.",
       "Write out the full chain of reasoning step by step.",
       BUTTERFLY),
    _m("/questiontree", "analysis",
       "يفرّع السؤال الكبير إلى أسئلة أصغر قابلة للإجابة.",
       "Branch a big question into smaller answerable ones.",
       DIRECTOR, BUTTERFLY),
)


def _index(modes: Iterable[CognitiveMode]) -> Mapping[str, CognitiveMode]:
    index: dict[str, CognitiveMode] = {}
    for mode in modes:
        if mode.name in index:
            raise ValueError(f"duplicate cognitive mode: {mode.name}")
        index[mode.name] = mode
    return MappingProxyType(index)


COGNITIVE_MODES: Mapping[str, CognitiveMode] = _index(_MODES)


def get_mode(name: str) -> CognitiveMode:
    """Look up a mode by name; the leading slash is optional."""
    key = name if name.startswith("/") else f"/{name}"
    try:
        return COGNITIVE_MODES[key]
    except KeyError:
        raise KeyError(f"unknown cognitive mode: {name}") from None


def modes_in_category(category: str) -> tuple[CognitiveMode, ...]:
    if category not in CATEGORIES:
        raise KeyError(f"unknown category: {category}")
    return tuple(m for m in _MODES if m.category == category)


def modes_for_agent(agent: str) -> tuple[CognitiveMode, ...]:
    """Modes that target ``agent`` directly or through ``all_agents``."""
    if agent not in AGENTS:
        raise KeyError(f"unknown agent: {agent}")
    return tuple(m for m in _MODES if agent in m.targets or ALL_AGENTS in m.targets)
