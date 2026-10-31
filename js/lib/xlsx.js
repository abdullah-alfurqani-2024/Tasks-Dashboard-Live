/**
 * ملفات Excel (xlsx) بدون مكتبات
 *   writeXlsx(sheets)   ← Blob   ورقة من اليمين لليسار، عنوان عريض، تواريخ حقيقية، فلتر تلقائي
 *   readXlsx(buffer)    ← [{ name, rows: any[][] }]  (التواريخ تبقى أرقام Excel، وparseDate يحوّلها)
 */
import { zip, unzip } from './zip.js';

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
// يحذف الرموز غير المسموحة في XML
const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => XML_ESC[c]);

const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/** 'YYYY-MM-DD' ← رقم تاريخ Excel */
const excelDate = (iso) => (Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 864e5;

/**
 * sheets: [{ name, columns: [{ label, width?, type?: 'text'|'number'|'date' }], rows: any[][] }]
 */
export function writeXlsx(sheets) {
  const files = [];
  const sheetXml = sheets.map((sh) => {
    const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('');
    const head = `<row r="1">${sh.columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${x(c.label)}</t></is></c>`).join('')}</row>`;
    const body = sh.rows.map((row, ri) => {
      const r = ri + 2;
      return `<row r="${r}">${row.map((v, ci) => {
        if (v == null || v === '') return '';
        const ref = colName(ci) + r;
        const type = sh.columns[ci]?.type;
        if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v)) return `<c r="${ref}" s="2"><v>${excelDate(String(v))}</v></c>`;
        if ((type === 'number' || typeof v === 'number') && Number.isFinite(Number(v))) return `<c r="${ref}" s="3"><v>${Number(v)}</v></c>`;
        return `<c r="${ref}" t="inlineStr" s="4"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
      }).join('')}</row>`;
    }).join('');
    const last = colName(sh.columns.length - 1) + (sh.rows.length + 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData>
<autoFilter ref="A1:${last}"/></worksheet>`;
  });

  const names = sheets.map((s, i) => x((s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));

  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${sheets.map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>`).join('')}</definedNames>
</workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` });
  files.push({ name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5FA8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D7E2"/></left><right style="thin"><color rgb="FFD0D7E2"/></right><top style="thin"><color rgb="FFD0D7E2"/></top><bottom style="thin"><color rgb="FFD0D7E2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>` });
  sheetXml.forEach((data, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data }));

  return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* ───────────── القراءة ───────────── */

const colIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const parseXml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
const textOf = (si) => byTag(si, 't').map((t) => t.textContent).join('');

export async function readXlsx(buffer) {
  const files = await unzip(buffer);
  const get = (p) => files.get(p) || files.get(p.replace(/^\//, ''));

  const shared = [];
  if (get('xl/sharedStrings.xml')) {
    const doc = parseXml(get('xl/sharedStrings.xml'));
    for (const si of byTag(doc, 'si')) {
      // نص غني: نتجاهل الأجزاء الصوتية (rPh)
      const parts = Array.from(si.childNodes).filter((n) => n.localName === 't' || n.localName === 'r');
      shared.push(parts.map((n) => (n.localName === 't' ? n.textContent : textOf(n))).join(''));
    }
  }

  const wb = parseXml(get('xl/workbook.xml'));
  const relsDoc = parseXml(get('xl/_rels/workbook.xml.rels'));
  const rels = Object.fromEntries(byTag(relsDoc, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));

  const out = [];
  for (const s of byTag(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const bytes = get(target);
    if (!bytes) continue;
    const doc = parseXml(bytes);
    const rows = [];
    for (const row of byTag(doc, 'row')) {
      const ri = Number(row.getAttribute('r') || rows.length + 1) - 1;
      const cells = [];
      let ci = 0;
      for (const c of Array.from(row.childNodes).filter((n) => n.localName === 'c')) {
        const ref = c.getAttribute('r');
        if (ref) ci = colIndex(ref);
        const t = c.getAttribute('t');
        const v = Array.from(c.childNodes).find((n) => n.localName === 'v')?.textContent;
        let val = null;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = byTag(c, 't').map((n) => n.textContent).join('');
        else if (t === 'str') val = v ?? '';
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = null;
        else if (v != null && v !== '') val = Number(v);
        cells[ci++] = val;
      }
      rows[ri] = cells;
    }
    out.push({ name: s.getAttribute('name'), rows: Array.from(rows, (r) => r || []) });
  }
  return out;
}
