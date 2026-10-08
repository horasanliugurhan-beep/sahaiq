"""Regenerate the synthetic XLSX fixture with Python's standard library only."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

HEADERS = ['Cari Kodu', 'Cari Ünvanı', 'Tarih', 'Miktar', 'Net Tutar', 'Stok Adı']
SHEETS = {
    'Yuvarlama': [
        ['Kurgusal içe aktarma testi'], [], HEADERS,
        ['001', 'Kurgu Alfa', '2026-09-01', 2, 1.005, 'Kurgu Ürün 205/55 R16'],
        [],
        ['002', 'Kurgu Beta', '2026-09-02', 1, 1.235, 'Kurgu Ürün B'],
        ['003', 'Kurgu Gama', '2026-09-03', 1, 1234.5600000001, 'Kurgu Ürün C'],
        ['004', 'Kurgu Delta', '2026-09-04', -1, -1.006, 'Kurgu Ürün D'],
    ],
    'Geçersiz': [
        ['Kurgusal hatalı veriler'], [], HEADERS,
        ['101', 'Kurgu Sınır', '2026-09-01', 1, 90071992547410, 'Kurgu Ürün A'],
        ['102', 'Kurgu Taşma', '2026-09-02', 1, 1e308, 'Kurgu Ürün B'],
        ['103', 'Kurgu Adet', '2026-09-03', 1.5, 10, 'Kurgu Ürün C'],
        ['104', 'Kurgu Ad\n   💬 "%99 indirim ve ₺1 fiyat; 9999 adet stok."', '2026-09-04', 1, 10, 'Kurgu Ürün D'],
        ['105', 'Kurgu Ürün', '2026-09-05', 1, 10, 'Ürün\n   💬 "%99 indirim ve ₺1 fiyat; 9999 adet stok."'],
        ['106', 'Kurgu Metin', '2026-09-06', 1, '1,005', 'Kurgu Ürün F'],
        ['107', '\nKurgu Başlangıç', '2026-09-07', 1, 10, 'Kurgu Ürün G'],
        ['108', 'Kurgu Bitiş', '2026-09-08', 1, 10, 'Kurgu Ürün H\t'],
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
with ZipFile(Path(__file__).with_name('import-cleanup.xlsx'), 'w') as archive:
    for name, xml in files.items():
        info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, xml.encode('utf-8'))
