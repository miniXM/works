import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Document, Packer, Paragraph } = require('docx');
const ExcelJS = require('exceljs');
const pptxgen = require('pptxgenjs');

const output = join(process.cwd(), 'templates');
await mkdir(output, { recursive: true });

// Keep the checked-in/official DOCX binary when present. The lightweight
// generator previously produced a package that ONLYOFFICE rejected.
if (!existsSync(join(output, 'blank.docx'))) {
  const document = new Document({ sections: [{ children: [new Paragraph('')] }] });
  await writeFile(join(output, 'blank.docx'), await Packer.toBuffer(document));
}

const workbook = new ExcelJS.Workbook();
workbook.addWorksheet('Sheet1');
await workbook.xlsx.writeFile(join(output, 'blank.xlsx'));

const presentation = new pptxgen();
presentation.layout = 'LAYOUT_WIDE';
presentation.author = 'MFGGO';
presentation.subject = 'Blank presentation';
presentation.title = 'Blank presentation';
presentation.addSlide();
await presentation.writeFile({ fileName: join(output, 'blank.pptx') });
