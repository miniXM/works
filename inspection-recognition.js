const TYPE_DEFINITIONS=[
 {id:'linear',label:'线性尺寸',symbol:'',tool:'CMM'},
 {id:'diameter',label:'直径 / 孔径',symbol:'Ø',tool:'内径千分尺'},
 {id:'radius',label:'半径',symbol:'R',tool:'二次元影像测量仪'},
 {id:'thread',label:'螺纹',symbol:'M',tool:'塞规 / 针规'},
 {id:'angle',label:'角度',symbol:'∠',tool:'万能角度尺'},
 {id:'depth',label:'深度',symbol:'↧',tool:'高度规 / 深度尺'},
 {id:'counterbore',label:'沉孔 / 锪平',symbol:'⌴',tool:'高度规 / 深度尺'},
 {id:'countersink',label:'沉头孔',symbol:'⌵',tool:'二次元影像测量仪'},
 {id:'chamfer',label:'倒角',symbol:'C',tool:'游标卡尺'},
 {id:'roughness',label:'表面粗糙度',symbol:'Ra',tool:'表面粗糙度仪'},
 {id:'position',label:'位置度',symbol:'⌖',tool:'CMM'},
 {id:'flatness',label:'平面度',symbol:'⏥',tool:'CMM'},
 {id:'perpendicularity',label:'垂直度',symbol:'⟂',tool:'CMM'},
 {id:'parallelism',label:'平行度',symbol:'∥',tool:'CMM'},
 {id:'profile',label:'轮廓度',symbol:'⌒',tool:'CMM'},
 {id:'runout',label:'跳动',symbol:'↗',tool:'百 / 千分表'},
 {id:'other',label:'其他字符',symbol:'',tool:'CMM'}
];

export const characteristicTypes=Object.freeze(TYPE_DEFINITIONS.map(type=>Object.freeze({...type})));
const typeMap=new Map(characteristicTypes.map(type=>[type.id,type]));
export const characteristicType=id=>typeMap.get(id)||typeMap.get('other');

export function normalizeInspectionText(raw){
 return String(raw??'').normalize('NFKC')
  .replace(/[⌀Φφ]/g,'Ø').replace(/[×✕✖]/g,'×').replace(/[−–—]/g,'-')
  .replace(/[⌄⇩↓]/g,'↧').replace(/@/g,'Ø').replace(/\s+/g,' ')
  .replace(/(\d)\s*[,，]\s*(\d)/g,'$1,$2')
  .replace(/([+\-±])\s+(?=\d)/g,'$1').trim();
}

export function normalizeOcrEngineeringText(raw){
 let clean=normalizeInspectionText(raw);
 // Restrict the repair to the thread-size + depth grammar. This fixes the
 // common OCR output `M6 I12` without changing ordinary drawing notes.
 clean=clean.replace(/\bM\s*(\d+(?:[.,]\d+)?)\s*[Iil|TtVvYy¥]\s*(\d+(?:[.,]\d+)?)\b/g,'M$1 ↧$2');
 // Some OCR engines read the diameter glyph as the Chinese character `中`.
 // Only repair that when it directly prefixes a numeric callout.
 clean=clean.replace(/(^|[\s(])中(?=\s*\d)/g,'$1Ø');
 // Tesseract commonly reads an isolated diameter glyph as P/O/Q/D. Limit
 // this repair to a complete symbol+number token so ordinary words/fits are
 // left untouched.
 // OCR engines often emit the CAD diameter glyph as @, ®, ©, P, O, Q or D.
 // Keep this OCR-only because these substitutions would be unsafe for normal
 // user-entered text.  The token must be immediately followed by a number.
 clean=clean.replace(/[®©]\s*(?=\d)/g,'Ø');
 clean=clean.replace(/^[PpOoQqD]\s*(?=\d+(?:[.,]\d+)?\s*$)/,'Ø');
 clean=clean.replace(/^\s*[LI|_]{1,4}\s*(?=Ø)/,'⌴ ');
 clean=clean.replace(/\b[PpOoQqD]\s*(?=\d)/g,'Ø');
 clean=clean.replace(/(?<=\d)\s*[TtVvYy¥]\s*(?=\d)/g,' ↧');
 clean=clean.replace(/(?<=\d)\s*%\s*(?=\d)/g,' ↧');
 clean=clean.replace(/\b[TtVvYy¥]\s*(?=\d)/g,'↧');
 return clean.replace(/Ø\s+(?=\d)/g,'Ø');
}

function detectType(clean){
 if(/(?:\bRa\s*\d|粗糙度|roughness|\bALL\s+SURFACES?\b)/i.test(clean))return'roughness';
 if(/[⌖◎]|位置度|position(?:al)?\s*tolerance/i.test(clean))return'position';
 if(/[⏥]|平面度|flatness/i.test(clean))return'flatness';
 if(/[⟂⊥]|垂直度|perpendicularity/i.test(clean))return'perpendicularity';
 if(/[∥]|平行度|parallelism/i.test(clean))return'parallelism';
 if(/[⌒]|轮廓度|profile/i.test(clean))return'profile';
 if(/(?:runout|跳动)/i.test(clean))return'runout';
  if(/[⌴]|counterbore|spotface|c'?bore/i.test(clean))return'counterbore';
  if(/\bL[\s_|I]*Ø/.test(clean)&&((clean.match(/\d+(?:[.,]\d+)?/g)||[]).length>=2))return'counterbore';
 if(/[⌵]|countersink|\bCSK\b/i.test(clean))return'countersink';
 if(/\bM\s*\d/i.test(clean))return'thread';
 if(/^\s*中\s*\d/.test(clean))return'diameter';
 if(/(?:[Ø]|\b(?:DIA|DIAMETER)\b)\s*\d/i.test(clean))return'diameter';
  if(/\d+(?:[.,]\d+)?\s*[HhGgFfJjKkNnPpRrSsTtUuVvZz]\d+\b/.test(clean))return'diameter';
  if(/^\s*\d+\s*[x×]\s*(?:Ø\s*)?\d+(?:[.,]\d+)?(?:\s|$)/i.test(clean))return'diameter';
  if(/^\s*\(?\s*\d+\s*[x×]\s*\)?\s*(?:Ø\s*)?\d+(?:[.,]\d+)?(?:\s|$)/i.test(clean))return'diameter';
  if(/^\s*C\s*\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s+\d+(?:[.,]\d+)?\s*$/i.test(clean))return'diameter';
  if(/[↧]|\bdepth\b|\bdeep\b|深度/i.test(clean))return'depth';
 if(/\bR\s*\d/i.test(clean))return'radius';
 if(/(?:°|\bdeg\b|角度)/i.test(clean))return'angle';
 if(/\bC\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?/i.test(clean))return'chamfer';
 if(/[\u3400-\u9fff]/u.test(clean))return'other';
 if(/[A-Za-z\u3400-\u9fff]{2,}/.test(clean))return'other';
 return/\d/.test(clean)?'linear':'other';
}

function toleranceParts(clean){
 const decimal='\\d+(?:[.,]\\d+)?';
 const symmetric=clean.match(new RegExp(`±\\s*(${decimal})(?:\\s*°)?`));
 if(symmetric)return{upperTol:'+'+symmetric[1],lowerTol:'-'+symmetric[1],toleranceMode:'symmetric'};
 const upper=clean.match(new RegExp(`(?:^|\\s)\\+\\s*(${decimal})`));
 const lower=clean.match(new RegExp(`(?:^|\\s)-\\s*(${decimal})`));
 if(upper||lower){const hasStandaloneZero=/(?:^|\s)0(?:[.,]0+)?(?:\s|$)/.test(clean);return{upperTol:upper?'+'+upper[1]:(lower&&hasStandaloneZero?'0':''),lowerTol:lower?'-'+lower[1]:(upper&&hasStandaloneZero?'0':''),toleranceMode:'bilateral'}}
 return{upperTol:'',lowerTol:'',toleranceMode:'unspecified'};
}

function nominalText(clean,type){
  let withoutTol=clean
   .replace(/±\s*\d+(?:[.,]\d+)?(?:\s*°)?/g,' ')
   .replace(/(?:^|\s)[+\-]\s*\d+(?:[.,]\d+)?(?=\s|$)/g,' ')
   .replace(/\s*[·|]\s*.*$/,' ').replace(/\s+/g,' ').trim();
  if(/[+\-]\s*\d+(?:[.,]\d+)?/.test(clean))withoutTol=withoutTol.replace(/\s+0(?:[.,]0+)?\s*$/,'').trim();
 // Nominal Dim is the user's selected callout, not a second semantic
 // representation. Keep prefixes and engineering symbols (M, Ø, ↧, ⌴…)
 // so the table remains auditable against the framed drawing text.
 let value=withoutTol.trim();
  return /^[^\p{L}\p{N}]+$/u.test(value)?'':value;
}

function repairEngineeringNotation(value,type,evidence=''){
 let text=String(value||'').replace(/\s+/g,' ').trim();
 if(!text||type==='other')return text;
 if(type==='thread'){
  text=text.replace(/\bM\s*(\d+(?:[.,]\d+)?)\s*[Iil|TtVvYy¥]\s*(\d+(?:[.,]\d+)?)\b/g,'M$1 ↧$2');
 }
 const numbers=text.match(/\d+(?:[.,]\d+)?/g)||[];
  const signals=engineeringSignals(evidence);
  // OCR contributes symbol roles only; the numeric payload always comes from
  // the PDF/vector text in `value`. This remains correct even when OCR reads
  // 12 as 112, 17 as I7, or joins a glyph to a neighboring digit.
  if(type==='counterbore'&&!/[⌴]/.test(text)&&numbers.length===2&&signals.has('counterbore')){text=`⌴ Ø${numbers[0]} ↧${numbers[1]}`;return text}
 if(type==='diameter'&&!/[Ø]/.test(text)&&numbers.length===1&&signals.has('diameter')){text=`Ø${numbers[0]}`;return text}
 if(type==='diameter'&&/^\s*中\s*\d/.test(text)){text=text.replace(/^\s*中\s*/,'Ø');return text}
 if(type==='diameter'&&!/[Ø]/.test(text)&&numbers.length===2&&!/[x×]|\b[A-Za-z]\d+\b/.test(text)&&signals.has('diameter')&&signals.has('depth')){text=`Ø${numbers[0]} ↧${numbers[1]}`;return text}
  // A common CAD/PDF font maps Ø to C. In a multi-hole callout, C6 × 5 17
  // is overwhelmingly an OCR artifact; restore the visible engineering form.
  if(type==='diameter'&&/^C\s*\d+\s*[x×]/i.test(text)&&numbers.length>=3){
    text=text.replace(/^C\s*/i,'');
  }
  if(type==='diameter'&&!/[Ø]/.test(text)&&/^\d+\s*[x×]\s*\d/i.test(text)){
    text=text.replace(/^(\d+\s*[x×]\s*)/, '$1Ø');
  }
  if(type==='diameter'&&!/[Ø]/.test(text)&&/^\(?\s*\d+\s*[x×]\s*\)?\s*\d/i.test(text)){
    text=text.replace(/^(\(?\s*\d+\s*[x×]\s*\)?\s*)/i,'$1Ø');
  }
  if(type==='diameter'&&!/[Ø]/.test(text)&&/^\d+(?:[.,]\d+)?\s*[HhGgFfJjKkNnPpRrSsTtUuVvZz]\d+\b/.test(text))text='Ø'+text;
  if(type==='diameter'&&!/[↧]/.test(text)&&/^\d+\s*[x×]\s*Ø?\s*\d+(?:\s+\d+(?:[.,]\d+)?)$/i.test(text)){
    text=text.replace(/(\d+(?:[.,]\d+)?)\s*$/, '↧$1');
  }
  if(type==='thread'&&!/[↧]/.test(text)&&/^M\s*\d+\s+\d+(?:[.,]\d+)?$/i.test(text)){
    text=text.replace(/(\d+(?:[.,]\d+)?)\s*$/, '↧$1');
  }
  return text;
}

function detailParts(clean){
 const count=clean.match(/\(?\s*(\d+)\s*[x×]\s*\)?/i)?.[1]||'';
 const fit=clean.match(/\b([HhGgFfJjKkNnPpRrSsTtVvZz]\d+)\b/)?.[1]||'';
 const depth=clean.match(/(?:[↧]|\bdepth\b|\bdeep\b)\s*(\d+(?:[.,]\d+)?)/i)?.[1]||'';
 return{count,fit,depth};
}

export function parseInspectionDimension(raw,{source='PDF 文字层',ocrRaw=''}={}){
 const textRaw=normalizeInspectionText(raw),imageRaw=normalizeOcrEngineeringText(ocrRaw||((source.includes('图像 OCR')||source.includes('OCR'))?raw:''));
 const combined=mergeTextSignals(textRaw,imageRaw),type=detectType(combined),definition=characteristicType(type);
 const imageOnly=source.includes('图像 OCR')&&!source.includes('PDF');
 const authoritative=imageOnly?(imageRaw||textRaw):preferredTextSignal(textRaw,imageRaw),text=repairEngineeringNotation(nominalText(authoritative,type),type,imageRaw);
 // PDF/vector text owns the numeric payload. OCR is permitted to contribute
 // engineering symbols, but never to overwrite dimensions or tolerances.
 const tolerance=toleranceParts(textRaw&&valueNumbers(textRaw).length?textRaw:imageRaw),details=detailParts(text);
 const explicitSymbol=type!=='linear'&&type!=='other';
 const confidence=source.includes('PDF')&&imageRaw?(explicitSymbol?'高':'中'):source.includes('PDF')?(explicitSymbol?'高':'中'):(explicitSymbol?'中':'低');
 return{type,typeLabel:definition.label,symbol:definition.symbol,text,displayText:combined,raw:textRaw||imageRaw,...tolerance,...details,confidence,recognition:imageRaw&&textRaw?(source.includes('OCR')?'文字层 + 图像 OCR':source):source};
}

function mergeTextSignals(textRaw,imageRaw){
 if(!imageRaw)return textRaw;if(!textRaw)return imageRaw;
 if(prefersChineseOcr(textRaw,imageRaw))return imageRaw;
 const imageAddsSymbol=/[Ø⌴⌵↧⌖⏥⟂∥°]|\b(?:M|R|Ra|DIA|CSK)\s*\d/i.test(imageRaw);
 const textHasSymbol=/[Ø⌴⌵↧⌖⏥⟂∥°]|\b(?:M|R|Ra)\s*\d/i.test(textRaw);
 if(imageAddsSymbol&&!textHasSymbol)return`${imageRaw} · ${textRaw}`;
 if(textRaw.includes(imageRaw)||imageRaw.includes(textRaw))return textRaw.length>=imageRaw.length?textRaw:imageRaw;
 return`${textRaw} · ${imageRaw}`;
}

function prefersChineseOcr(textRaw,imageRaw){
 return /[\u3400-\u9fff]/u.test(imageRaw)&&!/[\u3400-\u9fff]/u.test(textRaw);
}

function preferredTextSignal(textRaw,imageRaw){
  if(prefersChineseOcr(textRaw,imageRaw))return imageRaw;
  if(!textRaw)return imageRaw;
  // Some CAD exports expose only a stray symbol fragment (for example `L_`)
  // while OCR has the complete numeric callout.  There is no numeric value to
  // preserve in that fragment, so use the OCR payload in this narrow case.
  if(!valueNumbers(textRaw).length&&valueNumbers(imageRaw).length)return imageRaw;
  // A visibly truncated PDF fragment such as `6 x` has no complete numeric
  // payload. Only then may OCR supply the missing fields, and only when the
  // existing PDF numbers occur in the same order.
  if(/[x×]\s*$/i.test(textRaw)){
    const numbers=valueNumbers(textRaw),ocrNumbers=valueNumbers(imageRaw),ordered=numbers.every((value,index)=>ocrNumbers[index]===value);
    if(ordered&&ocrNumbers.length>numbers.length)return imageRaw;
  }
  // Otherwise the PDF/vector text is authoritative. Symbol restoration is
  // performed later by the machining-callout grammar using OCR as evidence.
  return textRaw;
}

function valueNumbers(raw){
  return (String(raw||'').match(/\d+(?:[.,]\d+)?/g)||[]).map(value=>value.replace(',', '.'));
}

function engineeringSignals(raw){
  const value=String(raw||''),signals=new Set();
  if(/[Ø]|\bDIA(?:METER)?\b/i.test(value))signals.add('diameter');
  if(/[↧]|\b(?:DEPTH|DEEP)\b/i.test(value))signals.add('depth');
  if(/[⌴]|\b(?:COUNTERBORE|SPOTFACE)\b/i.test(value))signals.add('counterbore');
  if(/[⌵]|\bCSK\b/i.test(value))signals.add('countersink');
  if(/\bM\s*\d/i.test(value))signals.add('thread');
  if(/\bR\s*\d/i.test(value))signals.add('radius');
  if(/\bRa\s*\d/i.test(value))signals.add('roughness');
  if(/°/.test(value))signals.add('angle');
  return signals;
}

export function isInspectionCandidate(raw){
 const clean=normalizeInspectionText(raw);
 if(!/\d/.test(clean)||clean.length>80)return false;
 if(/^[+\-±]\s*\d+(?:[.,]\d+)?(?:\s*[+\-±]\s*\d+(?:[.,]\d+)?)*$/.test(clean))return false;
 if(/\b(?:(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2})\b/.test(clean))return false;
 if(/^\d{1,2}:\d{1,2}$/.test(clean))return false;
 const letters=(clean.match(/[A-Za-z]{2,}/g)||[]).join('');
 if(letters.length>14&&!/(?:diameter|radius|depth|roughness|tolerance|position|flatness|counterbore|countersink)/i.test(clean))return false;
 return /[Ø⌴⌵↧⌖⏥⟂∥°±]|\b(?:M|R|Ra|C)\s*\d|\d+(?:[.,]\d+)?(?:\s*[HhGgFfJjKkNnPpRrSsTtVvZz]\d+)?/i.test(clean);
}

export function isRecognizableText(raw){
 const clean=normalizeInspectionText(raw);
 return clean.length>0&&clean.length<=160&&/[\p{L}\p{N}Ø⌴⌵↧⌖⏥⟂∥°±+]/u.test(clean);
}

export function isQualityOcrText(raw){
 const clean=normalizeInspectionText(raw);
 if(!isRecognizableText(clean))return false;
 if(/[\dØ⌴⌵↧⌖⏥⟂∥°±]/u.test(clean))return true;
 if(/\b(?:Ra|DIA|CSK|DEEP|DEPTH|M|R|C)\b/i.test(clean))return true;
 if(/[\u3400-\u9fff]/u.test(clean))return true;
 const words=clean.match(/[A-Za-z]{4,}/g)||[];
 const letters=(clean.match(/[A-Za-z]/g)||[]).length;
 return words.length>0&&letters/Math.max(clean.length,1)>=.58;
}

function hasEngineeringOcrSignal(raw){
 const clean=normalizeOcrEngineeringText(raw);
 return /[Ø⌴⌵↧⌖⏥⟂∥°]|\b(?:Ra|DIA|DIAMETER|CSK|COUNTERBORE|SPOTFACE|DEPTH|DEEP|M|R|C)\s*\d/i.test(clean);
}

function hasConfidentChineseOcr(group){
 const clean=normalizeInspectionText(group.raw),cjk=(clean.match(/[\u3400-\u9fff]/gu)||[]).length,latin=(clean.match(/[A-Za-z]/g)||[]).length;
 return cjk>=2&&cjk/Math.max(1,cjk+latin)>=.6&&(Number(group.confidence)||0)>=55;
}

function orientationBucket(hit){
 const angle=Number(hit.angle)||0,quarter=Math.round(angle/(Math.PI/2));
 return((quarter%2)+2)%2;
}

export function clusterInspectionHits(hits){
 if(!hits.length)return[];
 const buckets=[hits.filter(hit=>orientationBucket(hit)===0),hits.filter(hit=>orientationBucket(hit)===1)],groups=[];
 for(const bucket of buckets){
  if(!bucket.length)continue;
  const vertical=orientationBucket(bucket[0])===1;
  const enriched=bucket.map(item=>{const cx=item.x+item.w/2,cy=item.y+item.h/2;return{item,along:vertical?cy:cx,cross:vertical?cx:cy,size:vertical?item.w:item.h}}).sort((a,b)=>a.cross-b.cross||a.along-b.along);
  const sizes=enriched.map(value=>value.size).sort((a,b)=>a-b),median=sizes[Math.floor(sizes.length/2)]||12,crossThreshold=Math.max(3,median*.55),rows=[];
  for(const entry of enriched){const row=rows.find(candidate=>Math.abs(entry.cross-candidate.cross)<=crossThreshold);if(row){row.entries.push(entry);row.cross=(row.cross*(row.entries.length-1)+entry.cross)/row.entries.length}else rows.push({entries:[entry],cross:entry.cross})}
  for(const row of rows){
   row.entries.sort((a,b)=>a.along-b.along);const gapThreshold=Math.max(42,median*4.5);let cluster=null;
   for(const entry of row.entries){const previous=cluster?.entries.at(-1),previousEnd=previous?previous.along+(vertical?previous.item.h:previous.item.w)/2:0,currentStart=entry.along-(vertical?entry.item.h:entry.item.w)/2;if(!cluster||currentStart-previousEnd>gapThreshold){cluster={entries:[entry],vertical};groups.push(cluster)}else cluster.entries.push(entry)}
  }
 }
 return groups.map(group=>{
  const items=group.entries.map(entry=>entry.item),x=Math.min(...items.map(item=>item.x)),y=Math.min(...items.map(item=>item.y)),right=Math.max(...items.map(item=>item.x+item.w)),bottom=Math.max(...items.map(item=>item.y+item.h));
  return{items,raw:items.map(item=>item.text).join(' '),box:{x,y,w:right-x,h:bottom-y},orientation:group.vertical?'vertical':'horizontal'};
 }).filter(group=>isRecognizableText(group.raw));
}

export function clusterSelectedInspectionHits(hits,selection){
 const groups=clusterInspectionHits(hits);
 if(!selection||groups.length<2)return groups;
 const rows=[];
 for(const group of [...groups].sort((a,b)=>a.orientation.localeCompare(b.orientation)||(a.orientation==='vertical'?a.box.x-b.box.x:a.box.y-b.box.y))){
  const vertical=group.orientation==='vertical',cross=vertical?group.box.x+group.box.w/2:group.box.y+group.box.h/2,size=vertical?group.box.w:group.box.h;
  const row=rows.find(candidate=>candidate.vertical===vertical&&Math.abs(candidate.cross-cross)<=Math.max(4,Math.min(candidate.size,size)*.8));
  if(row){row.groups.push(group);row.cross=(row.cross*(row.groups.length-1)+cross)/row.groups.length;row.size=Math.max(row.size,size)}
  else rows.push({vertical,cross,size,groups:[group]});
 }
 return rows.flatMap(row=>{
  const ordered=row.groups.sort((a,b)=>row.vertical?a.box.y-b.box.y:a.box.x-b.box.x),assembled=[];
  for(const group of ordered){
   const previous=assembled.at(-1);
   if(previous&&canJoinSelectedFragments(previous.raw,group.raw))assembled[assembled.length-1]=combineRecognitionGroups(previous,group,row.vertical);
   else assembled.push(group);
  }
  return assembled;
 }).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
}

function canJoinSelectedFragments(left,right){
 const joined=normalizeInspectionText(`${left} ${right}`);
 if(/^\d+\s*[x×]\s*$/i.test(normalizeInspectionText(left)))return true;
 if(/^M\s*\d+$/i.test(normalizeInspectionText(left))&&/^\d+(?:[.,]\d+)?$/.test(normalizeInspectionText(right)))return true;
 return /^\(?\s*\d+\s*[x×]\s*\)?\s*(?:Ø\s*)?\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?)?$/i.test(joined)
  ||/^\d+(?:[.,]\d+)?\s+[HhGgFfJjKkNnPpRrSsTtVvZz]\d+(?:\s+.*)?$/i.test(joined);
}

function combineRecognitionGroups(left,right,vertical){
 const x=Math.min(left.box.x,right.box.x),y=Math.min(left.box.y,right.box.y),rightEdge=Math.max(left.box.x+left.box.w,right.box.x+right.box.w),bottom=Math.max(left.box.y+left.box.h,right.box.y+right.box.h);
 return{items:[...(left.items||[]),...(right.items||[])],raw:`${left.raw} ${right.raw}`,box:{x,y,w:rightEdge-x,h:bottom-y},orientation:vertical?'vertical':'horizontal'};
}

function intersectionRatio(a,b){
 const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);
 if(right<=left||bottom<=top)return 0;const intersection=(right-left)*(bottom-top);return intersection/Math.max(1,Math.min(a.w*a.h,b.w*b.h));
}

export function mergeRecognitionGroups(textGroups,ocrGroups){
 const output=textGroups.map(group=>({...group,source:'PDF 文字层'}));
 const hasPdfText=output.length>0;
 for(const ocr of ocrGroups){
  const target=output.map(group=>({group,ratio:intersectionRatio(group.box,ocr.box)})).sort((a,b)=>b.ratio-a.ratio)[0];
   if(target&&(target.ratio>.18||recognitionBoxesNear(target.group.box,ocr.box))&&(hasEngineeringOcrSignal(ocr.raw)||hasConfidentChineseOcr(ocr))){
   target.group.ocrRaw=target.group.ocrRaw?`${target.group.ocrRaw} ${ocr.raw}`:ocr.raw;
   target.group.ocrConfidence=Math.max(Number(target.group.ocrConfidence)||0,Number(ocr.confidence)||0);
   target.group.source='PDF 文字层 + 图像 OCR';
  }else if(!hasPdfText&&isQualityOcrText(ocr.raw))output.push({...ocr,source:'图像 OCR'});
 }
 restoreStackedHoleCallouts(output);
 return output;
}

export function recognizeInspectionCandidates({textHits=[],textGroups=null,ocrGroups=[],visualGroups=[],selection=null}={}){
 const vectorGroups=textGroups||clusterSelectedInspectionHits(textHits,selection);
 const evidenceGroups=[...visualGroups,...ocrGroups].filter(group=>isRecognizableText(group.raw||group.text||''));
 return restoreSelectedEngineeringCallout(mergeRecognitionGroups(vectorGroups,evidenceGroups),selection);
}

export function restoreIsolatedDiameterSelection(groups,selection){
 return restoreSelectedEngineeringCallout(groups,selection);
}

export function restoreSelectedEngineeringCallout(groups,selection){
 groups=mergeThreadDepthFragments(groups);
 groups=mergeSelectedMultilineNote(groups);
 if(groups.length!==1||!selection)return groups;
  const group=groups[0],clean=normalizeInspectionText(group.raw);
 if(!group.box||/[ØMR↧⌴⌵]/i.test(group.ocrRaw||''))return groups;
  const leftGap=group.box.x-selection.x,rightGap=selection.x+selection.w-(group.box.x+group.box.w),symbolSpace=Math.max(4,group.box.h*.55);
  const compactSelection=selection.w<=group.box.w+group.box.h*5.2;
  const singleCalloutSelection=selection.w<=group.box.w+Math.max(140,group.box.h*12);
  if(leftGap>=symbolSpace&&(leftGap>rightGap+group.box.h*.25||singleCalloutSelection||compactSelection)){
  const numbers=clean.match(/\d+(?:[.,]\d+)?/g)||[];
  if(/^\d+(?:[.,]\d+)?$/.test(clean))group.ocrRaw=`Ø${clean}`;
  else if(/^[\d.,]+\s+[\d.,]+$/.test(clean)&&numbers.length===2){
   group.ocrRaw=leftGap>=group.box.h*1.45?`⌴ Ø${numbers[0]} ↧${numbers[1]}`:`Ø${numbers[0]} ↧${numbers[1]}`;
  }else if(/^\(?\s*\d+\s*[x×]\s*\)?\s*\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?)?$/i.test(clean)){
   group.ocrRaw=repairEngineeringNotation(clean,'diameter');
  }else if(/^\d+(?:[.,]\d+)?\s*[HhGgFfJjKkNnPpRrSsTtUuVvZz]\d+\b/.test(clean))group.ocrRaw='Ø'+clean;
  if(group.ocrRaw)group.source='PDF 文字层 + 选区符号复原';
 }
 return groups;
}

function mergeThreadDepthFragments(groups){
 const consumed=new Set(),output=[];
 for(let index=0;index<groups.length;index++){
  if(consumed.has(index))continue;
  const thread=groups[index],threadText=normalizeInspectionText(thread.raw);
  if(!/^M\s*\d+(?:[.,]\d+)?$/i.test(threadText)||!thread.box){output.push(thread);continue}
  const candidateIndex=groups.findIndex((candidate,candidateIndex)=>{
   if(candidateIndex===index||consumed.has(candidateIndex)||!candidate.box)return false;
   const depthText=normalizeInspectionText(candidate.raw);
   if(!/^\s*[↧⌄⇩↓]?\s*\d+(?:[.,]\d+)?\s*$/.test(depthText))return false;
   const threadMiddle=thread.box.y+thread.box.h/2,depthMiddle=candidate.box.y+candidate.box.h/2;
   const horizontalGap=candidate.box.x-(thread.box.x+thread.box.w);
   return Math.abs(threadMiddle-depthMiddle)<=Math.max(thread.box.h,candidate.box.h)*1.7&&horizontalGap>=-thread.box.h&&horizontalGap<=Math.max(thread.box.h,candidate.box.h)*7;
  });
  if(candidateIndex<0){output.push(thread);continue}
  const depth=groups[candidateIndex],x=Math.min(thread.box.x,depth.box.x),y=Math.min(thread.box.y,depth.box.y),right=Math.max(thread.box.x+thread.box.w,depth.box.x+depth.box.w),bottom=Math.max(thread.box.y+thread.box.h,depth.box.y+depth.box.h);
  consumed.add(candidateIndex);
  output.push({...thread,items:[...(thread.items||[]),...(depth.items||[])],raw:`${thread.raw} ${depth.raw}`,ocrRaw:[thread.ocrRaw,depth.ocrRaw].filter(Boolean).join(' '),box:{x,y,w:right-x,h:bottom-y},source:String(thread.source||'').includes('OCR')||String(depth.source||'').includes('OCR')?'PDF 文字层 + 图像 OCR':thread.source});
 }
 return output;
}

function mergeSelectedMultilineNote(groups){
 if(groups.length<2||groups.length>6)return groups;
 const ordered=[...groups].sort((a,b)=>(a.box?.y||0)-(b.box?.y||0)||(a.box?.x||0)-(b.box?.x||0));
 const containsDimensionCallout=raw=>/[Ø⌴⌵↧⌖⏥⟂∥°±]|\b(?:M|R|Ra|C)\s*\d|^\s*\(?\d+\s*[x×]/i.test(normalizeInspectionText(raw));
 // Descriptive drawing notes have alphabetic continuation on every visual
 // line.  Actual machining callouts (for example a hole line stacked over a
 // counterbore line) contain engineering symbols and must remain separate.
 if(!ordered.every(group=>/[A-Za-z]{3,}/.test(group.raw||''))||ordered.some(group=>containsDimensionCallout(group.raw)))return groups;
 const boxes=ordered.map(group=>group.box).filter(Boolean);
 if(boxes.length!==ordered.length)return groups;
 const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y)),right=Math.max(...boxes.map(box=>box.x+box.w)),bottom=Math.max(...boxes.map(box=>box.y+box.h));
 const raw=ordered.map(group=>normalizeInspectionText(group.raw)).join(' '),ocrRaw=ordered.map(group=>group.ocrRaw||'').filter(Boolean).join(' ');
 return[{...ordered[0],raw,ocrRaw,box:{x,y,w:right-x,h:bottom-y},source:ordered.some(group=>String(group.source||'').includes('OCR'))?'PDF 文字层 + 图像 OCR':ordered[0].source}];
}

function recognitionBoxesNear(a,b){
 if(!a||!b)return false;
 const horizontal=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),vertical=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
 const horizontalRatio=horizontal/Math.max(1,Math.min(a.w,b.w)),verticalRatio=vertical/Math.max(1,Math.min(a.h,b.h));
 const horizontalGap=horizontal<0?-horizontal:0,verticalGap=vertical<0?-vertical:0;
 return verticalRatio>.2&&horizontalGap<=Math.max(a.h,b.h)*2.8||horizontalRatio>.2&&verticalGap<=Math.max(a.h,b.h)*2.8;
}

function restoreStackedHoleCallouts(groups){
 for(const current of groups){
  const clean=normalizeInspectionText(current.raw),numbers=clean.match(/\d+(?:[.,]\d+)?/g)||[];
  if(numbers.length!==2||!/^[\s\d.,]+$/.test(clean)||!current.box)continue;
  const above=groups.filter(candidate=>candidate!==current&&candidate.box&&candidate.box.y<current.box.y)
   .map(candidate=>({candidate,gap:current.box.y-(candidate.box.y+candidate.box.h),overlap:horizontalIntersectionRatio(candidate.box,current.box)}))
   .filter(item=>item.gap>=-2&&item.gap<=Math.max(16,current.box.h*2.4)&&item.overlap>.28)
   .sort((a,b)=>a.gap-b.gap)[0]?.candidate;
  if(!above)continue;
  const aboveType=detectType(normalizeInspectionText(above.raw));
  if(aboveType!=='diameter')continue;
  current.ocrRaw=`⌴ Ø${numbers[0]} ↧${numbers[1]}`;
  current.source='PDF 文字层 + 工程语义复原';
  const originalX=current.box.x,expandedX=Math.max(0,originalX-current.box.h*3.5);
  current.box={...current.box,x:expandedX,w:current.box.w+originalX-expandedX};
 }
}

function horizontalIntersectionRatio(a,b){
 const left=Math.max(a.x,b.x),right=Math.min(a.x+a.w,b.x+b.w);
 return right<=left?0:(right-left)/Math.max(1,Math.min(a.w,b.w));
}

export function hydrateCharacteristic(result){
 if(result.recognitionSchemaVersion!==2){
  if(!result.manualTypeSource)result.manualType=false;
  if(!result.manualTextSource)result.manualText=false;
  if(!result.manualToolSource)result.manualTool=false;
  if(!result.manualToleranceSource)result.manualTolerance=false;
  result.recognitionSchemaVersion=2;
 }
 const parsed=parseInspectionDimension(result.raw||result.text||'',{source:result.source||'历史标注',ocrRaw:result.ocrRaw||''});
 if(!result.manualType){result.type=parsed.type;result.typeLabel=parsed.typeLabel;result.symbol=parsed.symbol}
 else result.typeLabel=characteristicType(result.type).label;
 if(!result.manualText)result.text=parsed.text;
 if(!result.manualTolerance){
  result.upperTol=parsed.upperTol;
  result.lowerTol=parsed.lowerTol;
  result.toleranceMode=parsed.toleranceMode;
 }
 if(!result.manualTool)result.tool=characteristicType(result.manualType?result.type:parsed.type).tool;
 result.count=parsed.count;
 result.fit=parsed.fit;
 result.depth=parsed.depth;
 result.displayText=parsed.displayText;
 result.recognitionSchemaVersion=2;
 if(result.upperTol==='0.005'&&result.lowerTol==='0.005'&&!/[±+\-]/.test(result.raw||'')){result.upperTol='';result.lowerTol=''}
 result.confidence=parsed.confidence;
 result.recognition=parsed.recognition;
 return result;
}
