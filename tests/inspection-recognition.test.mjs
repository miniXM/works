import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInspectionDimension,isInspectionCandidate,isRecognizableText,isQualityOcrText,clusterInspectionHits,clusterSelectedInspectionHits,mergeRecognitionGroups,recognizeInspectionCandidates,hydrateCharacteristic,normalizeOcrEngineeringText,restoreIsolatedDiameterSelection,restoreSelectedEngineeringCallout} from '../inspection-recognition.js';
import {buildInspectionCandidates,buildVisionCandidates} from '../inspection-pipeline.js';

test('parses symmetric linear tolerance without inventing a default',()=>{
 const value=parseInspectionDimension('45 ±0,2');
 assert.equal(value.type,'linear');
 assert.equal(value.text,'45');
 assert.equal(value.upperTol,'+0,2');
 assert.equal(value.lowerTol,'-0,2');
 const plain=parseInspectionDimension('118');
 assert.equal(plain.upperTol,'');
 assert.equal(plain.lowerTol,'');
});

test('classifies common machining characters and recommends semantic symbols',()=>{
 assert.deepEqual(['diameter','radius','thread','counterbore','roughness','position'],[
  parseInspectionDimension('Ø 19').type,
  parseInspectionDimension('R41').type,
  parseInspectionDimension('M6 ↧12').type,
  parseInspectionDimension('⌴ Ø12 ↧52').type,
  parseInspectionDimension('Ra 3,2').type,
  parseInspectionDimension('⌖ Ø0,2 A B').type
 ]);
 assert.equal(parseInspectionDimension('8,1 H7 +0,015 0').symbol,'Ø');
 assert.equal(parseInspectionDimension('12 52',{source:'PDF 文字层 + 图像 OCR',ocrRaw:'LI@®i12ys2'}).type,'counterbore');
 assert.equal(parseInspectionDimension('210,18 ±0,2',{ocrRaw:'210,18 x02'}).type,'linear');
 assert.equal(parseInspectionDimension('3 x 6,6 garbage').type,'diameter');
});

test('keeps the complete selected callout in Nominal Dim',()=>{
 const drilledHoles=parseInspectionDimension('6 × Ø5 ↧17');
 assert.equal(drilledHoles.type,'diameter');
 assert.equal(drilledHoles.text,'6 × Ø5 ↧17');
 assert.equal(parseInspectionDimension('M6 ↧12').text,'M6 ↧12');
 assert.equal(parseInspectionDimension('⌴ Ø12 ↧52').text,'⌴ Ø12 ↧52');
});

test('restores OCR engineering symbols while keeping PDF numbers authoritative',()=>{
 const restored=parseInspectionDimension('6 × 5 17',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'6 × Ø5 ↧17'
 });
 assert.equal(restored.text,'6 × Ø5 ↧17');

 const thread=parseInspectionDimension('M6 12',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'M6 ↧12'
 });
 assert.equal(thread.text,'M6 ↧12');

 const noisy=parseInspectionDimension('12 52',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'LI@®i12ys2'
 });
 assert.equal(noisy.text,'⌴ Ø12 ↧52');
});

test('never lets OCR overwrite a complete PDF numeric payload',()=>{
 const thread=parseInspectionDimension('M6 12',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'M6 ↧112'
 });
 assert.equal(thread.type,'thread');
 assert.equal(thread.text,'M6 ↧12');

 const holes=parseInspectionDimension('6 x 5 17',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'6 x Ø5 T I7'
 });
 assert.equal(holes.type,'diameter');
 assert.equal(holes.text,'6 x Ø5 ↧17');

 const diameter=parseInspectionDimension('19',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'Ø19'
 });
 assert.equal(diameter.text,'Ø19');

 const counterbore=parseInspectionDimension('12 52',{
  source:'PDF 文字层 + 图像 OCR',
  ocrRaw:'⌴ Ø127 ↧2'
 });
 assert.equal(counterbore.text,'⌴ Ø12 ↧52');
});

test('covers the engineering callouts observed in the SolidWorks sample',()=>{
 const fixtures=[
  ['19','@19','diameter','Ø19'],
  ['5','P5','diameter','Ø5'],
  ['6 40','@ 6T 40','diameter','Ø6 ↧40'],
  ['6 x 5 17','bx P5V 17','diameter','6 x Ø5 ↧17'],
  ['M6 12','Mé V 12','thread','M6 ↧12'],
  ['3 x 6,6','3x @ 66','diameter','3 x Ø6,6'],
  ['11 24','LI@117T 24','counterbore','⌴ Ø11 ↧24'],
  ['12 52','LI ®12¥52','counterbore','⌴ Ø12 ↧52'],
  ['(3x) 8,2','(3x) @8,2','diameter','(3x) Ø8,2'],
  ['R41','','radius','R41'],
  ['R19','','radius','R19'],
  ['R5','','radius','R5'],
  ['R15','','radius','R15']
 ];
 for(const [pdfRaw,ocrRaw,type,text] of fixtures){
  const parsed=parseInspectionDimension(pdfRaw,{source:ocrRaw?'PDF 文字层 + 图像 OCR':'PDF 文字层',ocrRaw});
  assert.equal(parsed.type,type,`${pdfRaw} type`);
  assert.equal(parsed.text,text,`${pdfRaw} text`);
 }
});

test('keeps the fit nominal separate from its bilateral tolerance',()=>{
 const parsed=parseInspectionDimension('8,1 H7 +0,015 0',{source:'PDF 文字层 + 图像 OCR',ocrRaw:'@® 81H 0'});
 assert.equal(parsed.type,'diameter');
 assert.equal(parsed.text,'Ø8,1 H7');
 assert.equal(parsed.upperTol,'+0,015');
 assert.equal(parsed.lowerTol,'0');
});

test('classifies the Inventor all-surfaces finish note as roughness',()=>{
 const parsed=parseInspectionDimension('64 ALL SURFACES WITHIN .550" DIMENSION');
 assert.equal(parsed.type,'roughness');
 assert.equal(parsed.text,'64 ALL SURFACES WITHIN .550" DIMENSION');
});

test('uses a complete OCR callout when the PDF text layer is only a symbol fragment',()=>{
 const parsed=parseInspectionDimension('L_',{source:'PDF 文字层 + 图像 OCR',ocrRaw:'L_| Ø12% 52'});
 assert.equal(parsed.type,'counterbore');
 assert.equal(parsed.text,'⌴ Ø12 ↧52');
});

test('merges a selected multi-line drawing note but keeps stacked dimensions separate',()=>{
 const selection={x:5,y:5,w:180,h:70};
 const note=restoreSelectedEngineeringCallout([
  {raw:'64 ALL SURFACES',box:{x:10,y:10,w:110,h:12},source:'PDF 文字层'},
  {raw:'WITHIN .550"',box:{x:24,y:26,w:90,h:12},source:'PDF 文字层'},
  {raw:'DIMENSION',box:{x:24,y:42,w:78,h:12},source:'PDF 文字层'}
 ],selection);
 assert.equal(note.length,1);
 assert.equal(note[0].raw,'64 ALL SURFACES WITHIN .550" DIMENSION');
 assert.equal(parseInspectionDimension(note[0].raw).type,'roughness');

 const holes=restoreSelectedEngineeringCallout([
  {raw:'3 x Ø6,6',box:{x:10,y:10,w:80,h:12}},
  {raw:'⌴ Ø11 ↧24',box:{x:10,y:26,w:90,h:12}}
 ],selection);
 assert.equal(holes.length,2);
});

test('repairs the common CAD font C-for-diameter multi-hole callout',()=>{
 const parsed=parseInspectionDimension('C6 x 5 17');
 assert.equal(parsed.type,'diameter');
 assert.equal(parsed.text,'6 x Ø5 ↧17');
});

test('re-hydrates legacy rows after the parser improves',()=>{
 const legacy={raw:'6 x 5 17',type:'chamfer',text:'6 x 5 17',symbol:'C'};
 hydrateCharacteristic(legacy);
 assert.equal(legacy.type,'diameter');
 assert.equal(legacy.symbol,'Ø');
 assert.equal(legacy.text,'6 x Ø5 ↧17');
});

test('migrates stale automatic type fields instead of preserving a wrong legacy thread type',()=>{
 const legacy={raw:'6 x 5 17',type:'thread',typeLabel:'螺纹',text:'6 x 5 17',symbol:'M',manualType:true};
 hydrateCharacteristic(legacy);
 assert.equal(legacy.type,'diameter');
 assert.equal(legacy.symbol,'Ø');
 assert.equal(legacy.text,'6 x Ø5 ↧17');
 assert.equal(legacy.recognitionSchemaVersion,2);
});

test('normalizes OCR I/T/V depth glyphs on OCR-only thread callouts',()=>{
 assert.equal(normalizeOcrEngineeringText('M6 I12'),'M6 ↧12');
 assert.equal(normalizeOcrEngineeringText('M6 T12'),'M6 ↧12');
 assert.equal(normalizeOcrEngineeringText('M6 V12'),'M6 ↧12');
 const parsed=parseInspectionDimension('M6 I12',{source:'图像 OCR'});
 assert.equal(parsed.type,'thread');
 assert.equal(parsed.text,'M6 ↧12');
});

test('restores a stacked counterbore callout when the PDF drops all symbols',()=>{
 const merged=mergeRecognitionGroups([
  {raw:'3 x Ø6,6',box:{x:10,y:10,w:80,h:12}},
  {raw:'11 24',box:{x:10,y:25,w:65,h:12}}
 ],[]);
 const parsed=parseInspectionDimension(merged[1].raw,{source:merged[1].source,ocrRaw:merged[1].ocrRaw});
 assert.equal(parsed.type,'counterbore');
 assert.equal(parsed.text,'⌴ Ø11 ↧24');
});

test('merges a symbol-rich OCR line back into a fragmented PDF text hit',()=>{
 const merged=mergeRecognitionGroups(
  [{raw:'6 x',box:{x:10,y:10,w:24,h:12}}],
  [{raw:'6 x Ø5 ↧17',confidence:86,box:{x:8,y:9,w:86,h:14}}]
 );
 assert.equal(merged.length,1);
 const parsed=parseInspectionDimension(merged[0].raw,{source:merged[0].source,ocrRaw:merged[0].ocrRaw});
 assert.equal(parsed.type,'diameter');
 assert.equal(parsed.text,'6 x Ø5 ↧17');
});

test('repairs the isolated diameter symbol variants produced by OCR',()=>{
 for(const raw of ['P19','O19','Q19','D19'])assert.equal(normalizeOcrEngineeringText(raw),'Ø19');
 assert.equal(normalizeOcrEngineeringText('PART 19'),'PART 19');
 const merged=mergeRecognitionGroups(
  [{raw:'19',box:{x:30,y:10,w:18,h:12}}],
  [{raw:normalizeOcrEngineeringText('P19'),confidence:14,box:{x:8,y:9,w:42,h:14}}]
 );
 const parsed=parseInspectionDimension(merged[0].raw,{source:merged[0].source,ocrRaw:merged[0].ocrRaw});
 assert.equal(parsed.type,'diameter');
 assert.equal(parsed.text,'Ø19');
});

test('restores a missing leading diameter glyph from a tight single selection',()=>{
 const groups=[{raw:'19',box:{x:55,y:10,w:24,h:12}}];
 restoreIsolatedDiameterSelection(groups,{x:10,y:8,w:82,h:18});
 assert.equal(groups[0].ocrRaw,'Ø19');
 assert.equal(parseInspectionDimension(groups[0].raw,{source:groups[0].source,ocrRaw:groups[0].ocrRaw}).text,'Ø19');
 const plain=[{raw:'19',box:{x:25,y:10,w:24,h:12}}];
 restoreIsolatedDiameterSelection(plain,{x:20,y:8,w:44,h:18});
 assert.equal(plain[0].ocrRaw,undefined);
});

test('restores selected sample callouts whose vector symbols are absent from PDF text',()=>{
 const cases=[
  {raw:'6 40',box:{x:30,y:10,w:42,h:12},selection:{x:20,y:8,w:58,h:18},expected:'Ø6 ↧40'},
  {raw:'6 40',box:{x:30,y:10,w:42,h:12},selection:{x:20,y:8,w:130,h:18},expected:'Ø6 ↧40'},
  {raw:'12 52',box:{x:50,y:10,w:42,h:12},selection:{x:20,y:8,w:78,h:18},expected:'⌴ Ø12 ↧52'},
  {raw:'(3x) 8,2',box:{x:38,y:10,w:58,h:12},selection:{x:20,y:8,w:82,h:18},expected:'(3x) Ø8,2'},
  {raw:'8,1 H7',box:{x:38,y:10,w:48,h:12},selection:{x:20,y:8,w:72,h:18},expected:'Ø8,1 H7'}
 ];
 for(const value of cases){
  const groups=[{raw:value.raw,box:value.box}];
  restoreSelectedEngineeringCallout(groups,value.selection);
  assert.equal(groups[0].ocrRaw,value.expected,value.raw);
 }
});

test('keeps engineering candidates and rejects obvious title block data',()=>{
 assert.equal(isInspectionCandidate('3 × Ø6,6'),true);
 assert.equal(isInspectionCandidate('17-03-2017'),false);
 assert.equal(isInspectionCandidate('1:1'),false);
 assert.equal(isInspectionCandidate('connecting serpentine 6038'),false);
 assert.equal(isInspectionCandidate('+0,015'),false);
});

test('clusters horizontal and vertical PDF text independently',()=>{
 const groups=clusterInspectionHits([
  {text:'45',x:10,y:10,w:16,h:8,angle:0},
  {text:'±0,2',x:28,y:10,w:24,h:8,angle:0},
  {text:'Ø',x:90,y:20,w:8,h:8,angle:Math.PI/2},
  {text:'12',x:90,y:30,w:12,h:8,angle:Math.PI/2}
 ]);
 assert.equal(groups.length,2);
 assert.ok(groups.some(group=>group.orientation==='horizontal'&&group.raw.includes('45')));
 assert.ok(groups.some(group=>group.orientation==='vertical'&&group.raw.includes('12')));
});

test('reassembles fragmented PDF words on the same selected callout line',()=>{
 const groups=clusterSelectedInspectionHits([
  {text:'6 x',x:10,y:10,w:20,h:10,angle:0},
  {text:'5',x:82,y:10,w:10,h:10,angle:0},
  {text:'17',x:126,y:10,w:14,h:10,angle:0},
  {text:'M6',x:22,y:32,w:18,h:10,angle:0},
  {text:'12',x:112,y:32,w:14,h:10,angle:0}
 ],{x:5,y:5,w:145,h:45});
 assert.deepEqual(groups.map(group=>group.raw),['6 x 5 17','M6 12']);
 assert.deepEqual(groups.map(group=>parseInspectionDimension(group.raw).text),['6 x Ø5 ↧17','M6 ↧12']);
});

test('merges a thread and an orphaned depth number before assigning symbols',()=>{
 const groups=restoreSelectedEngineeringCallout([
  {raw:'M6',box:{x:10,y:30,w:18,h:11},source:'PDF 文字层'},
  // PDF glyphs can report the depth text under a different orientation bucket.
  {raw:'12',box:{x:56,y:31,w:13,h:10},source:'PDF 文字层 + 图像 OCR',ocrRaw:'Ø12'}
 ],{x:5,y:20,w:80,h:30});
 assert.equal(groups.length,1);
 assert.equal(groups[0].raw,'M6 12');
 assert.equal(parseInspectionDimension(groups[0].raw,{source:groups[0].source,ocrRaw:groups[0].ocrRaw}).text,'M6 ↧12');
});

test('hybrid merge keeps OCR-only symbols on the PDF text group',()=>{
 const merged=mergeRecognitionGroups(
  [{raw:'12 52',box:{x:10,y:10,w:50,h:14}}],
  [{raw:'⌴ Ø12 ↧52',box:{x:8,y:8,w:54,h:18}}]
 );
 assert.equal(merged.length,1);
 assert.equal(merged[0].ocrRaw,'⌴ Ø12 ↧52');
 assert.equal(parseInspectionDimension(merged[0].raw,{source:merged[0].source,ocrRaw:merged[0].ocrRaw}).type,'counterbore');
});

test('candidate pipeline accepts visual symbol evidence without trusting OCR numbers',()=>{
 const groups=recognizeInspectionCandidates({
  textGroups:[{raw:'6 40',box:{x:30,y:10,w:42,h:12}}],
  visualGroups:[{raw:'Ø6 ↧40',confidence:98,box:{x:20,y:8,w:60,h:18}}],
  ocrGroups:[{raw:'Ø6 ↧400',confidence:88,box:{x:20,y:8,w:60,h:18}}],
  selection:{x:20,y:8,w:130,h:18}
 });
 assert.equal(groups.length,1);
 const parsed=parseInspectionDimension(groups[0].raw,{source:groups[0].source,ocrRaw:groups[0].ocrRaw});
 assert.equal(parsed.text,'Ø6 ↧40');
});

test('candidate pipeline applies stacked-hole structure before final parsing',()=>{
 const groups=buildInspectionCandidates({
  textHits:[
   {text:'3 x 6,6',x:30,y:10,w:52,h:12,angle:0},
   {text:'11',x:30,y:27,w:18,h:12,angle:0},
   {text:'24',x:58,y:27,w:18,h:12,angle:0}
  ],
  selection:{x:20,y:5,w:90,h:45}
 });
 assert.equal(groups.length,2);
 assert.equal(groups[1].parsed.text,'⌴ Ø11 ↧24');
 assert.equal(groups[1].source,'PDF 文字层 + 工程结构语法');
});

test('vision-first pipeline reconstructs the SolidWorks callouts without OCR',()=>{
 const groups=buildVisionCandidates({
  textHits:[
   {text:'6 x 5 17',x:10,y:10,w:80,h:12,angle:0},
   {text:'M6 I12',x:10,y:28,w:60,h:12,angle:0}
  ]
 });
 assert.deepEqual(groups.map(group=>group.parsed.text),['6 x Ø5 ↧17','M6 ↧12']);
 assert.deepEqual(groups.map(group=>group.parsed.type),['diameter','thread']);
 assert.ok(groups.every(group=>group.source==='图像字符结构识别'));
});

test('vision-first pipeline reconstructs a single PDF text block as diameter plus depth',()=>{
 const groups=buildVisionCandidates({
  textHits:[
   {text:'6 40',x:30,y:10,w:42,h:12,angle:0}
  ],
  selection:{x:20,y:8,w:70,h:18}
 });
 assert.equal(groups.length,1);
 assert.equal(groups[0].parsed.type,'diameter');
 assert.equal(groups[0].parsed.text,'Ø6 ↧40');
});

test('vision-first pipeline keeps a selected standalone diameter as diameter',()=>{
 const groups=buildVisionCandidates({
  textHits:[
   {text:'19',x:55,y:10,w:24,h:12,angle:0}
  ],
  selection:{x:10,y:8,w:82,h:18}
 });
 assert.equal(groups.length,1);
 assert.equal(groups[0].parsed.type,'diameter');
 assert.equal(groups[0].parsed.symbol,'Ø');
 assert.equal(groups[0].parsed.text,'Ø19');
});

test('restores a Chinese diameter glyph artifact to Ø19',()=>{
 const parsed=parseInspectionDimension('中19');
 assert.equal(parsed.type,'diameter');
 assert.equal(parsed.text,'Ø19');
 assert.equal(normalizeOcrEngineeringText('中19'),'Ø19');
 const groups=buildVisionCandidates({
  textHits:[
   {text:'中19',x:55,y:10,w:30,h:12,angle:0}
  ],
  selection:{x:45,y:8,w:48,h:18}
 });
 assert.equal(groups.length,1);
 assert.equal(groups[0].parsed.type,'diameter');
 assert.equal(groups[0].parsed.text,'Ø19');
});

test('does not add noisy OCR-only rows when a PDF text layer exists',()=>{
 const merged=mergeRecognitionGroups(
  [{raw:'12 52',box:{x:10,y:10,w:50,h:14}}],
  [
   {raw:'⌴ Ø12 ↧52',box:{x:8,y:8,w:54,h:18}},
   {raw:'Fl',box:{x:120,y:80,w:15,h:10}},
   {raw:'oo',box:{x:160,y:90,w:14,h:10}},
   {raw:'3 x 6,6',box:{x:200,y:100,w:50,h:12}}
  ]
 );
 assert.equal(merged.length,1);
 assert.equal(merged[0].raw,'12 52');
});

test('keeps only plausible standalone OCR rows for scanned PDFs',()=>{
 assert.equal(isQualityOcrText('Fl'),false);
 assert.equal(isQualityOcrText('re)'),false);
 assert.equal(isQualityOcrText('Ø12'),true);
 assert.equal(isQualityOcrText('INSPECTION NOTE'),true);
 const merged=mergeRecognitionGroups([], [
  {raw:'Fl',box:{x:0,y:0,w:10,h:10}},
  {raw:'Ø12',box:{x:20,y:0,w:20,h:10}}
 ]);
 assert.deepEqual(merged.map(group=>group.raw),['Ø12']);
});

test('prefers confident Chinese OCR over a broken Latin PDF text layer',()=>{
 const merged=mergeRecognitionGroups(
  [{raw:'2it',box:{x:10,y:10,w:32,h:14}}],
  [{raw:'设计',confidence:91,box:{x:9,y:9,w:34,h:16}}]
 );
 assert.equal(merged[0].ocrRaw,'设计');
 const parsed=parseInspectionDimension(merged[0].raw,{source:merged[0].source,ocrRaw:merged[0].ocrRaw});
 assert.equal(parsed.text,'设计');
 assert.equal(parsed.displayText,'设计');
 assert.equal(parsed.type,'other');
});

test('does not replace PDF text with low-confidence Chinese OCR',()=>{
 const merged=mergeRecognitionGroups(
  [{raw:'Aluminum',box:{x:10,y:10,w:60,h:14}}],
  [{raw:'铝合金',confidence:18,box:{x:9,y:9,w:62,h:16}}]
 );
 assert.equal(merged[0].ocrRaw,undefined);
});

test('does not accept a single hallucinated Chinese character in Latin OCR noise',()=>{
 const merged=mergeRecognitionGroups(
  [{raw:'27,5',box:{x:10,y:10,w:42,h:14}}],
  [{raw:'人yz,',confidence:88,box:{x:9,y:9,w:44,h:16}}]
 );
 assert.equal(merged[0].ocrRaw,undefined);
 assert.equal(parseInspectionDimension(merged[0].raw).text,'27,5');
});

test('keeps arbitrary selected text before semantic classification',()=>{
 const plain=parseInspectionDimension('Aluminum 6061');
 assert.equal(plain.type,'other');
 assert.equal(plain.text,'Aluminum 6061');
 assert.equal(isRecognizableText('INSPECTION NOTE'),true);
 const groups=clusterInspectionHits([{text:'INSPECTION',x:10,y:10,w:65,h:9,angle:0},{text:'NOTE',x:79,y:10,w:30,h:9,angle:0}]);
 assert.equal(groups[0].raw,'INSPECTION NOTE');
});
