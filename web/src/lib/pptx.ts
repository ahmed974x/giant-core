// PowerPoint writer (ADR-031): a real .pptx with the OMEGA look (night-bridge navy, brass titles, teal accents),
// built from Office Open XML parts on top of zip.ts. 16:9 slides; Arabic lines are set right-to-left.
import { escapeXml } from "./office.ts";
import { writeZip } from "./zip.ts";

export type Slide = { title: string; subtitle?: string; bullets?: string[]; big?: { value: string; label: string }[] };

const W = 12192000, H = 6858000; // 16:9 in EMU
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: [string, string, string][]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

const COLORS = { bg: "071526", panel: "0D2136", ink: "E4ECF4", muted: "8EA3B8", brass: "D4A72C", teal: "3DD6C6" };

function para(text: string, size: number, color: string, bold = false, bullet = false): string {
  const rtl = RTL.test(text);
  const pPr = `<a:pPr${rtl ? ' rtl="1" algn="r"' : ""}${bullet ? ' marL="285750" indent="-285750"' : ""}>${bullet ? `<a:buClr><a:srgbClr val="${COLORS.teal}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : "<a:buNone/>"}<a:spcAft><a:spcPts val="${bullet ? 900 : 300}"/></a:spcAft></a:pPr>`;
  const rPr = `<a:rPr lang="${rtl ? "ar-SA" : "en-US"}" sz="${size * 100}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Segoe UI"/><a:cs typeface="Segoe UI"/></a:rPr>`;
  return `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

let shapeId = 2;
function box(x: number, y: number, w: number, h: number, paras: string, fill?: string): string {
  const id = shapeId++;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="${fill ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom>${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>"}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="182880" rIns="182880" tIns="91440" bIns="91440"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

function slideXml(s: Slide, n: number, total: number): string {
  shapeId = 2;
  const m = 609600;
  let body = box(m, 380000, W - 2 * m, 900000, para(s.title, 34, COLORS.brass, true));
  if (s.subtitle) body += box(m, 1250000, W - 2 * m, 600000, para(s.subtitle, 16, COLORS.muted));
  if (s.big?.length) {
    const gap = 228600, cw = Math.floor((W - 2 * m - gap * (s.big.length - 1)) / s.big.length);
    s.big.forEach((b, i) => { body += box(m + i * (cw + gap), 2200000, cw, 2000000, para(b.value, 48, COLORS.teal, true) + para(b.label, 16, COLORS.ink), COLORS.panel); });
  }
  if (s.bullets?.length) body += box(m, s.subtitle ? 2000000 : 1500000, W - 2 * m, H - 2700000, s.bullets.map(b => para(b, 18, COLORS.ink, false, true)).join(""));
  body += box(m, H - 600000, W - 2 * m, 400000, para(`OMEGA PRIME · ${n}/${total}`, 10, COLORS.muted));
  return `${XML}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${COLORS.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OMEGA"><a:themeElements><a:clrScheme name="OMEGA"><a:dk1><a:srgbClr val="071526"/></a:dk1><a:lt1><a:srgbClr val="E4ECF4"/></a:lt1><a:dk2><a:srgbClr val="0D2136"/></a:dk2><a:lt2><a:srgbClr val="8EA3B8"/></a:lt2><a:accent1><a:srgbClr val="3DD6C6"/></a:accent1><a:accent2><a:srgbClr val="D4A72C"/></a:accent2><a:accent3><a:srgbClr val="6F9CFF"/></a:accent3><a:accent4><a:srgbClr val="8A7CFF"/></a:accent4><a:accent5><a:srgbClr val="F2685C"/></a:accent5><a:accent6><a:srgbClr val="4CD38A"/></a:accent6><a:hlink><a:srgbClr val="3DD6C6"/></a:hlink><a:folHlink><a:srgbClr val="8A7CFF"/></a:folHlink></a:clrScheme><a:fontScheme name="OMEGA"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface="Segoe UI"/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface="Segoe UI"/></a:minorFont></a:fontScheme><a:fmtScheme name="OMEGA"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export function writePptx(slides: Slide[]): Buffer {
  if (!slides.length) throw new Error("no slides");
  const n = slides.length;
  const pres = `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`;
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`;
  return writeZip([
    ["[Content_Types].xml", ct],
    ["_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]])],
    ["ppt/presentation.xml", pres],
    ["ppt/_rels/presentation.xml.rels", rels([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "theme", "theme/theme1.xml"],
      ...slides.map((_, i): [string, string, string] => [`rId${i + 3}`, "slide", `slides/slide${i + 1}.xml`])])],
    ["ppt/slideMasters/slideMaster1.xml", MASTER],
    ["ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]])],
    ["ppt/slideLayouts/slideLayout1.xml", LAYOUT],
    ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]])],
    ["ppt/theme/theme1.xml", THEME],
    ...slides.flatMap((s, i): [string, string][] => [
      [`ppt/slides/slide${i + 1}.xml`, slideXml(s, i + 1, n)],
      [`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]])],
    ]),
  ]);
}
