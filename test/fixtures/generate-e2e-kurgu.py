"""Regenerate the synthetic browser-test XLSX fixture (e2e) with Python's standard library only."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

HEADERS = ['Cari Kodu', 'Cari Ünvanı', 'Tarih', 'Miktar', 'Net Tutar', 'Stok Adı']
SHEETS = {
    'Satışlar': [
        ['Kurgusal satış raporu (tarayıcı testi)'], [], HEADERS,
        ['K001', 'Kurgu Lastik Alfa', '2026-03-03', 4, 12400.5, 'Kurgu Ürün A'],
        ['K001', 'Kurgu Lastik Alfa', '2026-08-15', 2, 6100, 'Kurgu Ürün A'],
        ['K002', 'Kurgu Oto Beta', '2026-01-10', 8, 20000.005, 'Kurgu Ürün B'],
        ['K003', 'Kurgu Servis Gama', '2026-09-20', 1, 3250.75, 'Kurgu Ürün C'],
        ['K004', 'Kurgu Ticaret Delta', '2026-07-01', 3, 9000, 'Kurgu Ürün D'],
    ],
}
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
DOCREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def sheet_xml(rows):
    lines = []
    for i, row in enumerate(rows, 1):
        cells = []
        for j, value in enumerate(row):
            ref = f'{chr(65 + j)}{i}'
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>')
        lines.append(f'<row r="{i}">{"".join(cells)}</row>')
    return f'<worksheet xmlns="{NS}"><sheetData>{"".join(lines)}</sheetData></worksheet>'


files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(SHEETS) + 1)) + '</Types>',
    '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="{DOCREL}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': f'<workbook xmlns="{NS}" xmlns:r="{DOCREL}"><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(SHEETS, 1)) + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': f'<Relationships xmlns="{REL}">' + ''.join(f'<Relationship Id="rId{i}" Type="{DOCREL}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(SHEETS) + 1)) + '</Relationships>',
}
files.update({f'xl/worksheets/sheet{i}.xml': sheet_xml(rows) for i, rows in enumerate(SHEETS.values(), 1)})
with ZipFile(Path(__file__).with_name('e2e-kurgu.xlsx'), 'w') as archive:
    for name, xml in files.items():
        info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, xml.encode('utf-8'))
