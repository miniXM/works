# -*- coding: utf-8 -*-
"""账号档案页加“AI 帮我写”：回答几个问题，让 AI 按这个人的情况把档案填满。

为什么要做：档案有 15 个字段（称呼、门店、行业、挫折、信赖、卖点、价格……），
直接甩给客户，客户不知道该写什么、写成什么样才算能用。改成问答之后，客户只要回答
“你是做什么的、客户是谁、想让客户记住什么”，剩下的交给模型。

用的还是软件自己那条 AI 通道（阿里云百炼，`dist/assets/api-D6D4R6Zx.js` 里的
`t` = chat completions，`n` = 从响应里取正文；文案改写、标题生成都走它），
所以 Key、模型、请求方式跟系统设置里已有的“阿里云百炼 Key / 改写模型”完全一致，
不再多要一个 Key，也不用经过我们自己的服务器。

三处整串替换（每条旧串在 base asar 里各命中 1 次），另外还负责
「新建档案」之后自动弹出这个对话框（`setTimeout(VmxAiOpen,300)`，
那条替换写在 `persona_seed_rules.py` 里）：

1. `AccountPage` 那条 import 上加 `import{t as VmxChat,n as VmxText}from"./api-D6D4R6Zx.js";`
2. 编辑器右上角按钮组里，在“清空内容”前面插一个「AI 帮我写」
3. 在 `K=_(()=>B.buildActivePersonaText())` 前面插整块 VmxAi* 代码

配合 `persona_seed_rules.py`：账号档案默认带一份写满的示例档案，所以这里把
“值还跟示例原值一模一样”的格子当成还没填——不覆盖时不会因为示例把 AI 结果挡在外面，
拼提示词时也不会把示例里的北京烤鸭信息当成客户自己的人设。

界面没有用 Vue 组件去拼（这段代码是压缩过的产物，手写 render 函数太容易出错），
而是在 `document.body` 上挂一个用 Element Plus 全局样式做的对话框，
事件用委托处理；弹窗关掉就整个移除。
"""

import persona_seed_rules

# 1) 引入百炼通道：t = chat completions，n = 从返回里取正文。
IMPORT_OLD = 'import{r as S}from"./mix-DrzTFiIL.js";'
IMPORT_NEW = (
    'import{r as S}from"./mix-DrzTFiIL.js";'
    'import{t as VmxChat,n as VmxText}from"./api-D6D4R6Zx.js";'
)

# 2) 编辑器右上角：AI 帮我写 / 清空内容 / 删除档案。
BTN_OLD = "y(`div`,N,[f(c,{size:`small`,onClick:q}"
BTN_NEW = (
    "y(`div`,N,[f(c,{size:`small`,type:`primary`,plain:``,onClick:VmxAiOpen},"
    "{default:o(()=>[h(`AI 帮我写`,-1)]),_:1}),"
    "f(c,{size:`small`,onClick:q}"
)

# 3) 代码块插在 setup 里那条 let 声明之后。
#    注意必须插在语句**结束之后**：这段是
#    `let B=S(),{...}=x(B),G=[...],K=_(()=>B.buildActivePersonaText());`
#    一整条声明，插在中间（逗号列表里）会直接 SyntaxError。
ANCHOR_OLD = "K=_(()=>B.buildActivePersonaText());"

HELPERS = r"""
function VmxAiKeys(){return[`nickname`,`hometown`,`storeName`,`industry`,`address`,`investment`,`duration`,`setback`,`trust`,`goal`,`audience`,`sellingPoint`,`promo`]}
function VmxAiKey(){return String(B.bailianApiKey||``).trim()}
function VmxAiStock(){return __VMX_STOCK__}
function VmxAiSeed(k,e){return String(e||``).trim()===String(VmxAiStock()[k]||``).trim()}
function VmxAiModel(){return String(B.bailianRewriteModel||``).trim()||`qwen-plus`}
function VmxAiTone(){return[`亲切自然`,`专业可信`,`幽默接地气`,`简洁直接`,`真诚走心`]}
function VmxAiQs(){
return[
{k:`industry`,q:`你是做什么的？`,hint:`行业、主营产品或服务（必填）`,ph:`例如：餐饮 / 北京烤鸭 / 本地门店`,big:!0},
{k:`storeName`,q:`门店、品牌或账号叫什么？`,ph:`例如：北京烤鸭 / 老张家常菜`},
{k:`address`,q:`在哪座城市、哪个商圈？`,ph:`例如：北京市丰台区西罗园街道`}]
}
function VmxAiStyle(){
if(document.getElementById(`vmx-ai-style`))return;
let s=document.createElement(`style`);s.id=`vmx-ai-style`;
s.textContent=`.vmx-ai-mask{position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px}.vmx-ai-panel{width:640px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);overflow:hidden;font-size:14px;color:#303133}.vmx-ai-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #ebeef5}.vmx-ai-title{font-size:16px;font-weight:600}.vmx-ai-x{border:0;background:transparent;font-size:20px;line-height:1;color:#909399;cursor:pointer}.vmx-ai-body{padding:16px 20px;overflow:auto}.vmx-ai-tip{margin:0 0 14px;color:#909399;font-size:13px;line-height:1.6}.vmx-ai-row{margin-bottom:12px}.vmx-ai-label{display:block;margin-bottom:6px;font-weight:600;font-size:13px}.vmx-ai-sub{margin-left:8px;color:#a8abb2;font-weight:400;font-size:12px}.vmx-ai-select{width:100%;height:32px;border:1px solid #dcdfe6;border-radius:4px;padding:0 8px;color:#606266;background:#fff}.vmx-ai-select:focus{outline:none;border-color:var(--el-color-primary,#409eff);box-shadow:0 0 0 1px var(--el-color-primary,#409eff) inset}.vmx-ai-cover{display:flex;align-items:center;gap:6px;color:#606266;font-size:13px;margin-top:6px}.vmx-ai-warn{margin-top:10px;padding:8px 10px;border-radius:6px;background:#fef0f0;color:#f56c6c;font-size:13px;line-height:1.6}.vmx-ai-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid #ebeef5}.vmx-ai-mask .el-textarea__inner{box-shadow:0 0 0 1px #dcdfe6 inset}.vmx-ai-mask .el-textarea__inner:hover{box-shadow:0 0 0 1px #c0c4cc inset}.vmx-ai-mask .el-textarea__inner:focus{box-shadow:0 0 0 1px var(--el-color-primary,#409eff) inset;outline:none}.vmx-ai-mask .el-input__wrapper{box-shadow:0 0 0 1px #dcdfe6 inset}.vmx-ai-mask .el-input__wrapper:hover{box-shadow:0 0 0 1px #c0c4cc inset}.vmx-ai-mask .el-input__wrapper.is-focus,.vmx-ai-mask .el-input__wrapper:focus-within{box-shadow:0 0 0 1px var(--el-color-primary,#409eff) inset}`;
document.head.appendChild(s)
}
function VmxAiEsc(e){e.key===`Escape`&&VmxAiClose()}
function VmxAiClose(){
let e=document.querySelector(`.vmx-ai-mask`);
e&&e.remove();
document.removeEventListener(`keydown`,VmxAiEsc,!0)
}
function VmxAiWarn(e,t){
if(!e)return;
e.textContent=String(t||``);
e.hidden=!String(t||``).trim()
}
function VmxAiHtml(e){
let t=``;
for(let n=0;n<e.length;n++){
let r=e[n];
t+=`<div class="vmx-ai-row"><div class="vmx-ai-label">`+r.q+(r.hint?`<span class="vmx-ai-sub">`+r.hint+`</span>`:``)+`</div>`;
t+=r.big
?`<textarea class="el-textarea__inner" data-k="`+r.k+`" rows="2" placeholder="`+r.ph+`"></textarea>`
:`<div class="el-input"><div class="el-input__wrapper"><input class="el-input__inner" data-k="`+r.k+`" placeholder="`+r.ph+`"></div></div>`;
t+=`</div>`
}
return t
}
function VmxAiOpen(){
if(document.querySelector(`.vmx-ai-mask`))return;
VmxAiStyle();
let e=document.createElement(`div`);
e.className=`vmx-ai-mask`;
e.innerHTML=`<div class="vmx-ai-panel" role="dialog" aria-modal="true">`
 +`<div class="vmx-ai-head"><div class="vmx-ai-title">AI 帮我写档案</div>`
 +`<button type="button" class="vmx-ai-x" data-role="close">×</button></div>`
 +`<div class="vmx-ai-body"><p class="vmx-ai-tip">只填下面这几项就行，剩下的 AI 按你的行业和城市补全，生成完你再改改就是一份能用的档案。</p>`
 +VmxAiHtml(VmxAiQs())
 +`<div class="vmx-ai-row"><div class="vmx-ai-label">用什么口吻讲？<span class="vmx-ai-sub">会写进档案，影响以后改写文案的语气</span></div>`
 +`<select class="vmx-ai-select" data-k="tone">`
 +VmxAiTone().map(function(e){return `<option>`+e+`</option>`}).join(``)
 +`</select></div>`
 +`<label class="vmx-ai-cover"><input type="checkbox" data-role="cover">覆盖已经填过的内容（默认只补还没填的）</label>`
 +`<div class="vmx-ai-warn" data-role="warn" hidden></div></div>`
 +`<div class="vmx-ai-foot"><button type="button" class="el-button" data-role="cancel"><span>取消</span></button>`
 +`<button type="button" class="el-button el-button--primary" data-role="go"><span>生成档案</span></button></div>`
 +`</div>`;
document.body.appendChild(e);
document.addEventListener(`keydown`,VmxAiEsc,!0);
e.addEventListener(`click`,function(t){
let n=t.target&&t.target.closest?t.target.closest(`[data-role]`):null,r=n?n.getAttribute(`data-role`):``;
if(t.target===e||r===`close`||r===`cancel`)VmxAiClose();
else if(r===`go`)VmxAiGo(e)
});
if(!VmxAiKey())VmxAiWarn(e.querySelector(`[data-role="warn"]`),`还没有配置「阿里云百炼 Key」：请先到「系统设置 → 阿里云百炼 Key」填上，再回来生成。（软件里的 AI 改写文案用的是同一个 Key）`);
let t=e.querySelector(`[data-k="industry"]`);t&&t.focus()
}
function VmxAiPrompt(e,t){
let n=[];
function r(e,t){String(t||``).trim()&&n.push(`【`+e+`】`+String(t).trim())}
r(`行业或主营`,e.industry);
r(`门店或品牌名`,e.storeName);
r(`城市或商圈`,e.address);
r(`口播口吻`,e.tone);
let i=``;
if(!t){
try{
let o=[],s=V.value||{};
for(let c=0;c<VmxAiKeys().length;c++){let l=VmxAiKeys()[c],u=String(s[l]||``).trim();u&&!VmxAiSeed(l,u)&&o.push(l+`=`+u)}
o.length&&(i=`\n\n这份档案现在已经有这些内容，保留它们，只把问答里新说到的信息补进去；问答和它冲突时以问答为准\n`+o.join(`\n`))
}catch{}
}else i=`\n\n这一次是按问答重写整份档案：上面问答写的就是标准答案，现有内容作废、不要受它影响。`;
 return `你是短视频账号策划，负责帮实体店老板填写“账号档案”。这份档案之后会用来让 AI 按本人的口吻改写口播文案，所以要像这个人自己说的话。\n\n`
 +`老板只说了自己是做什么的、店叫什么、开在哪，其余信息由你按这个行业和这座城市的常见真实情况补全——要像一家普通实体店，不要写得像连锁大品牌、不要写得完美无缺。\n\n`
 +`请根据下面的内容写出整份档案。\n\n`
 +`输出要求（必须严格遵守）\n`
 +`1. 只输出一个 JSON 对象，不要解释、不要 markdown、不要代码块、不要多余文字\n`
 +`2. JSON 只能有这些键：nickname,hometown,storeName,industry,address,investment,duration,setback,trust,goal,audience,sellingPoint,promo\n`
 +`3. 每一项都要写满，不许留空、不许写“不详”“暂无”“待补充”这类字\n`
 +`4. 数字给一个合理的大概值就行：投入多少、铺面多大、做了几年、卖多少钱都可以写，但要像一家普通小店（比如“前前后后投了七八十万”“租了个一百多平的铺面”“这一行干了十来年”），不要写成夸张的大数字\n`
 +`5. 每项 8~60 字，口语、具体、像老板自己讲出来的，不要排比、不要广告腔、不要“秉承”“匠心”这类空话\n`
 +`6. 各项含义：nickname 别人怎么称呼你；hometown 哪里人（写“山东济南人”这种，别只写“本地人”）；storeName 门店或品牌名；industry 行业或主营；address 城市或商圈；investment 投了多少钱干了什么；duration 做了多少年；setback 遇到过的挫折和怎么解决的；trust 为什么值得信赖；goal 目标或期望；audience 目标客群；sellingPoint 特色卖点；promo 产品介绍和价格\n`
 +`7. 称呼 nickname：客户没说自己叫什么，就写“大家都叫我老X”，X 用一个常见姓，客户自己会改\n`
 +`8. 不要写出生年份、年龄、性别这类内容，档案里没有这几项\n\n`
 +`老板填的内容\n`+n.join(`\n`)+i
}
function VmxAiText(e){
try{let t=typeof VmxText===`function`?VmxText(e):``;if(String(t||``).trim())return t}catch{}
let t=e&&e.data?e.data:e;
try{return String(t&&t.choices&&t.choices[0]&&t.choices[0].message?t.choices[0].message.content||``:``)}catch{return ``}
}
function VmxAiParse(e){
let t=String(e||``).trim().replace(/^```[a-zA-Z]*\s*/,``).replace(/```\s*$/,``);
let n=t.indexOf(`{`),r=t.lastIndexOf(`}`);
n>=0&&r>n&&(t=t.slice(n,r+1));
return JSON.parse(t)
}
function VmxAiFill(e,t){
if(!(U.value&&U.value.profile))B.addPersonaProfile(`AI 生成的档案`);
let n=V.value,r=VmxAiKeys(),i=0;
if(!n)return 0;
for(let o=0;o<r.length;o++){
let s=r[o],c=String(e&&e[s]!=null?e[s]:``).trim();
if(!c)continue;
if(!t&&String(n[s]||``).trim()&&!VmxAiSeed(s,String(n[s]||``)))continue;
n[s]=c,i++
}
J();
return i
}
async function VmxAiGo(e){
let t=e.querySelector(`[data-role="go"]`),n=e.querySelector(`[data-role="warn"]`);
if(!VmxAiKey()){VmxAiWarn(n,`还没有配置「阿里云百炼 Key」，请先到「系统设置 → 阿里云百炼 Key」填上再回来。`);return}
let r={},i=VmxAiQs();
for(let o=0;o<i.length;o++){
let s=e.querySelector(`[data-k="`+i[o].k+`"]`);
r[i[o].k]=s?String(s.value||``).trim():``
}
let a2=e.querySelector(`[data-k="tone"]`);
r.tone=a2?a2.value:``;
if(!r.industry){VmxAiWarn(n,`第一项“你是做什么的”不能空，先填一下。`);let o=e.querySelector(`[data-k="industry"]`);o&&o.focus();return}
VmxAiWarn(n,``);
let c2=!!(e.querySelector(`[data-role="cover"]`)||{}).checked;
let s2=t.innerHTML;
t.disabled=!0;t.textContent=`正在生成…`;
try{
let l2=await VmxChat({api_key:VmxAiKey(),model:VmxAiModel(),prompt:VmxAiPrompt(r,c2)});
let u2=VmxAiText(l2);
if(!String(u2||``).trim())throw Error(`AI 没返回内容，稍后再试`);
let d2=VmxAiParse(u2);
let f2=VmxAiFill(d2,c2);
VmxAiClose();
if(!f2)a.error(`AI 返回的内容没有可填的字段，请再试一次`);
else a.success(`AI 已写好这份档案（填了 `+f2+` 项），检查一下再改改就好`)
}catch(o2){
t.disabled=!1;t.innerHTML=s2;
VmxAiWarn(n,`生成失败：`+(o2&&o2.message?o2.message:`请稍后再试`))
}
}
"""

# 示例档案那几个值只在 persona_seed_rules.py 里写一遍，这里注入，保证两边永远一致。
HELPERS = HELPERS.replace("__VMX_STOCK__", persona_seed_rules.STOCK_JS)

ANCHOR_NEW = ANCHOR_OLD + HELPERS

RULES = [
    (IMPORT_OLD, IMPORT_NEW),
    (BTN_OLD, BTN_NEW),
    (ANCHOR_OLD, ANCHOR_NEW),
]

# 每条补丁里“旧串”在 base asar 里应当命中的次数，构建时人工核对。
EXPECTED_HITS = {
    IMPORT_OLD: 1,
    BTN_OLD: 1,
    ANCHOR_OLD: 1,
}
