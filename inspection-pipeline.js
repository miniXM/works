import {
 isQualityOcrText,
 isRecognizableText,
 normalizeInspectionText,
 normalizeOcrEngineeringText,
 parseInspectionDimension,
 restoreSelectedEngineeringCallout
} from './inspection-recognition.js';

function orientationOf(hit){
 const angle=Math.abs(Number(hit.angle)||0);
 return Math.abs(Math.sin(angle))>.72?'vertical':'horizontal';
}

function unionBox(items){
 const x=Math.min(...items.map(item=>item.x));
 const y=Math.min(...items.map(item=>item.y));
 const right=Math.max(...items.map(item=>item.x+item.w));
 const bottom=Math.max(...items.map(item=>item.y+item.h));
 return{x,y,w:right-x,h:bottom-y};
}

function median(values){
 const ordered=[...values].sort((a,b)=>a-b);
 return ordered[Math.floor(ordered.length/2)]||12;
}

function visualSignalScore(raw,confidence=0){
 const clean=normalizeOcrEngineeringText(raw);
 let score=Number(confidence)||0;
 if(/[Ø⌴⌵↧⌖⏥⟂∥°]/.test(clean))score+=42;
 if(/\b(?:M|R|Ra|DIA|CSK|DEPTH|DEEP)\s*\d/i.test(clean))score+=28;
 if(/\d/.test(clean))score+=8;
 return score;
}

function lineDistance(a,b,orientation,size){
 const ac=orientation==='vertical'?a.x+a.w/2:a.y+a.h/2;
 const bc=orientation==='vertical'?b.x+b.w/2:b.y+b.h/2;
 return Math.abs(ac-bc)<=Math.max(3,size*.72);
}

function clusterVectorHits(hits){
 const valid=hits.filter(hit=>isRecognizableText(hit.text||''));
 if(!valid.length)return[];
 const output=[];
 for(const orientation of ['horizontal','vertical']){
  const bucket=valid.filter(hit=>orientationOf(hit)===orientation);
  if(!bucket.length)continue;
  const size=median(bucket.map(hit=>Math.min(hit.w,hit.h)));
  const rows=[];
  for(const hit of [...bucket].sort((a,b)=>(orientation==='vertical'?a.x-b.x:a.y-b.y)||(orientation==='vertical'?a.y-b.y:a.x-b.x))){
   const row=rows.find(candidate=>lineDistance(hit,candidate.anchor,orientation,size));
   if(row){
    row.items.push(hit);
    row.anchor=unionBox(row.items);
   }else rows.push({anchor:{...hit},items:[hit]});
  }
  for(const row of rows){
   const items=[...row.items].sort((a,b)=>orientation==='vertical'?a.y-b.y:a.x-b.x);
   const raw=items.map(item=>normalizeInspectionText(item.text)).join(' ');
   if(isRecognizableText(raw))output.push({
    raw,
    box:unionBox(items),
    items,
    orientation,
    source:'PDF 文字层'
   });
  }
 }
 return output.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
}

function overlapRatio(a,b){
 const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y);
 const right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);
 if(right<=left||bottom<=top)return 0;
 return(right-left)*(bottom-top)/Math.max(1,Math.min(a.w*a.h,b.w*b.h));
}

function near(a,b){
 const horizontal=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
 const vertical=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
 const gapX=horizontal<0?-horizontal:0,gapY=vertical<0?-vertical:0;
 const size=Math.max(4,Math.min(a.h,b.h)*2.8);
 return(vertical>0&&gapX<=size)||(horizontal>0&&gapY<=size);
}

function clusterOcrEvidence(groups){
 const valid=groups
  .map(group=>({...group,raw:normalizeOcrEngineeringText(group.raw||group.text||'')}))
  .filter(group=>group.raw&&isQualityOcrText(group.raw)&&group.box);
 const clusters=[];
 for(const group of valid){
  const existing=clusters.find(cluster=>near(cluster.box,group.box));
  if(existing){
   existing.items.push(group);
   existing.box=unionBox(existing.items.map(item=>item.box));
  }else clusters.push({box:{...group.box},items:[group]});
 }
 return clusters.map(cluster=>{
  const representative=[...cluster.items].sort((a,b)=>{
   const score=visualSignalScore(b.raw,b.confidence)-visualSignalScore(a.raw,a.confidence);
   return score||String(b.raw).length-String(a.raw).length;
  })[0];
  return{
   raw:representative.raw,
   confidence:Number(representative.confidence)||0,
   box:cluster.box,
   source:'图像 OCR 集成证据',
   variants:cluster.items.map(item=>({raw:item.raw,confidence:item.confidence}))
  };
 });
}

function evidenceFor(vectorGroup,evidence){
 return evidence
  .filter(item=>overlapRatio(vectorGroup.box,item.box)>.12||near(vectorGroup.box,item.box))
  .sort((a,b)=>visualSignalScore(b.raw,b.confidence)-visualSignalScore(a.raw,a.confidence));
}

function canonicalVisionText(raw,visualRaw='',{implicitHoleDepth=false,allowStandaloneNumber=false}={}){
 const clean=normalizeOcrEngineeringText(raw),visual=normalizeOcrEngineeringText(visualRaw);
 const multiHole=clean.match(/^\s*\(?\s*(\d+)\s*[x×]\s*\)?\s*Ø?\s*(\d+(?:[.,]\d+)?)(?:\s+(?:[↧])?\s*(\d+(?:[.,]\d+)?))?\s*$/i);
 if(multiHole)return `${multiHole[1]} x Ø${multiHole[2]}${multiHole[3]?` ↧${multiHole[3]}`:''}`;
 const thread=clean.match(/^\s*M\s*(\d+(?:[.,]\d+)?)\s*(?:[↧Iil|TtVvYy¥]?\s*)?(\d+(?:[.,]\d+)?)\s*$/i);
 if(thread)return `M${thread[1]} ↧${thread[2]}`;
 const twoNumbers=clean.match(/^\s*(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/);
 if(twoNumbers&&/[Ø↧⌴]/.test(visual)){
  if(/[⌴]/.test(visual))return `⌴ Ø${twoNumbers[1]} ↧${twoNumbers[2]}`;
  return `Ø${twoNumbers[1]} ↧${twoNumbers[2]}`;
 }
 if(twoNumbers&&implicitHoleDepth)return `Ø${twoNumbers[1]} ↧${twoNumbers[2]}`;
 const singleNumber=clean.match(/^\s*Ø?\s*(\d+(?:[.,]\d+)?)\s*$/);
 if(singleNumber&&/^\s*Ø/.test(clean))return `Ø${singleNumber[1]}`;
 if(singleNumber&&/[Ø]/.test(visual))return `Ø${singleNumber[1]}`;
 if(singleNumber&&allowStandaloneNumber)return clean;
 if(/[\u3400-\u9fff]/u.test(clean))return clean;
 return '';
}

export function buildVisionCandidates({textHits=[],visualGroups=[],selection=null}={}){
 const vectorGroups=clusterVectorHits(textHits);
 const visualEvidence=clusterOcrEvidence(visualGroups);
 const candidates=vectorGroups.flatMap(group=>{
  const matched=evidenceFor(group,visualEvidence)[0];
  const items=[...(group.items||[])].sort((a,b)=>a.x-b.x);
  const heights=items.map(item=>Math.min(item.w,item.h)).filter(Boolean).sort((a,b)=>a-b);
  const textHeight=heights[Math.floor(heights.length/2)]||group.box.h||12;
  const gaps=items.slice(1).map((item,index)=>item.x-(items[index].x+items[index].w));
  const numericOnly=/^\s*\d+(?:[.,]\d+)?\s+\d+(?:[.,]\d+)?\s*$/.test(group.raw);
  const singleNumber=/^\s*\d+(?:[.,]\d+)?\s*$/.test(group.raw);
  const selectedSingleCallout=!!selection&&vectorGroups.length===1&&(
   overlapRatio(group.box,selection)>.3||near(group.box,selection)
  );
  const implicitHoleDepth=selectedSingleCallout&&numericOnly&&(
   items.length===1||
   items.length===2&&gaps[0]>=Math.max(3,textHeight*.7)
  );
  const canonical=canonicalVisionText(group.raw,matched?.raw||'',{
   implicitHoleDepth,
   allowStandaloneNumber:selectedSingleCallout&&singleNumber
  });
  if(!canonical)return[];
  const parsed=parseInspectionDimension(canonical,{source:'图像字符结构识别',ocrRaw:canonical});
  return[{
   ...group,
   raw:canonical,
   ocrRaw:canonical,
   ocrConfidence:matched?.confidence||99,
   source:'图像字符结构识别',
   parsed,
   evidence:matched?.variants||[]
  }];
 });
 const structured=applyEngineeringStructure(candidates);
 if(selection){
  restoreSelectedEngineeringCallout(structured,selection);
  for(const current of structured){
   current.parsed=parseInspectionDimension(current.raw,{source:current.source,ocrRaw:current.ocrRaw||''});
  }
 }
 return structured;
}

function horizontalOverlap(a,b){
 const left=Math.max(a.x,b.x),right=Math.min(a.x+a.w,b.x+b.w);
 return right<=left?0:(right-left)/Math.max(1,Math.min(a.w,b.w));
}

function applyEngineeringStructure(candidates){
 for(const current of candidates){
  const clean=normalizeInspectionText(current.raw),numbers=clean.match(/\d+(?:[.,]\d+)?/g)||[];
  if(numbers.length!==2||!/^[\s\d.,]+$/.test(clean)||!current.box)continue;
  const above=candidates
   .filter(candidate=>candidate!==current&&candidate.box&&candidate.box.y<current.box.y)
   .map(candidate=>({candidate,gap:current.box.y-(candidate.box.y+candidate.box.h),overlap:horizontalOverlap(candidate.box,current.box)}))
   .filter(item=>item.gap>=-2&&item.gap<=Math.max(16,current.box.h*2.4)&&item.overlap>.28)
   .sort((a,b)=>a.gap-b.gap)[0]?.candidate;
  if(!above||above.parsed?.type!=='diameter')continue;
  current.ocrRaw=`⌴ Ø${numbers[0]} ↧${numbers[1]}`;
  current.source='PDF 文字层 + 工程结构语法';
  current.parsed=parseInspectionDimension(current.raw,{source:current.source,ocrRaw:current.ocrRaw});
  const originalX=current.box.x,expandedX=Math.max(0,originalX-current.box.h*3.5);
  current.box={...current.box,x:expandedX,w:current.box.w+originalX-expandedX};
 }
 return candidates;
}

export function buildInspectionCandidates({textHits=[],ocrGroups=[],visualGroups=[],selection=null}={}){
 const vectorGroups=clusterVectorHits(textHits);
 const evidence=clusterOcrEvidence([...visualGroups,...ocrGroups]);
 if(vectorGroups.length){
  const candidates=vectorGroups.map(group=>{
   const matched=evidenceFor(group,evidence)[0];
   const parsed=parseInspectionDimension(group.raw,{
    source:matched?'PDF 文字层 + 图像 OCR':'PDF 文字层',
    ocrRaw:matched?.raw||''
   });
   return{
    ...group,
    ocrRaw:matched?.raw||'',
    ocrConfidence:matched?.confidence||0,
    source:matched?'PDF 文字层 + 图像 OCR':'PDF 文字层',
    parsed,
    evidence:matched?.variants||[]
   };
  });
  const structured=applyEngineeringStructure(candidates);
  if(selection){
   restoreSelectedEngineeringCallout(structured,selection);
   for(const current of structured){
    current.parsed=parseInspectionDimension(current.raw,{source:current.source,ocrRaw:current.ocrRaw||''});
   }
  }
  return structured;
 }
 return evidence
  .filter(group=>!selection||near(group.box,selection))
  .map(group=>{
   const parsed=parseInspectionDimension(group.raw,{source:'图像 OCR 集成证据',ocrRaw:group.raw});
   return{...group,parsed,evidence:group.variants||[]};
  });
}
