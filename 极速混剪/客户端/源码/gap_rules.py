# -*- coding: utf-8 -*-
"""空档补丁：没人说话的镜头不再被素材原始长度撑开，合成前先提醒一次。

客户端原本的规则（在 BatchGenerationPage 的时间轴构建函数里）：

    有配音 -> 画面 = 配音时长 + 一点点尾巴（实测尾部空档 0.07~0.23 秒，很干净）
    没配音 -> 用「镜头剪辑」里的「时长（秒）」；而这一项在开启配音时是隐藏的，
              默认值 0 的含义是“播完整段素材”，于是 10 秒素材就真的播 10 秒

所以“开头几秒有人说话、后面一大段没人说话”只可能出现在那个镜头最后没有配音
（TTS 失败 / 没配 Key / 文案为空）的情况：画面退回“播完整段”，声音却没有。

这个补丁做三件事：

1) 定一个空档阈值 VmxGap = 0.5 秒。有配音的镜头本来只有 0.2 秒左右的收尾尾巴，
   所以阈值实际作用在“压根没人说话”的镜头上。
2) 配音开着、镜头有文案、但配音没生成出来时，画面按文案字数估算时长裁短，
   而不是把整段素材播完。
3) 合成前扫一遍镜头，把“没配音但有文案”“既没文案也没配音又没开背景音乐”
   的镜头列出来弹窗确认，用户可选继续合成或先去改。

注意：不改变“有配音的镜头按配音长度裁画面”这条原有规则，也不改变
“关掉配音”这个模式（那种模式下时长是用户自己在「镜头剪辑」里定的）。
"""

# 单段无声超过这个秒数就算“空档”。
GAP_LIMIT = 0.5
# 中文口播的估算语速（字/秒），实际估算时再除以界面上的语速倍数。
CHARS_PER_SECOND = 4.5

# 1) 把 Element Plus 的 MessageBox 引进这个页面。
#    BatchGenerationPage 自己的 import 里没有它（`n` 在这个文件里已经被占用，
#    是 electronAPI 桥），所以起个别名 VmxBox。
#    导出表里 `GX as n`，而 GX 就是 MessageBox（$msgbox/$alert/$confirm/$prompt
#    那套），AccountPage / SystemSettingsPage 也是这么用的。
IMPORT_OLD = ',w as d,x as f}from"./es-BoKzuN0V.js";'
IMPORT_NEW = ',w as d,x as f,n as VmxBox}from"./es-BoKzuN0V.js";'

# 2) 工具函数 + 合成前检查，插在时间轴构建函数 Bt 之前，并在 Bt 开头调用。
BT_OLD = "async function Bt(e){n.updateTask(e.id,{status:`rendering`,errorMessage:``});"

_HELPERS = (
    "var VmxGap=" + repr(GAP_LIMIT) + ",VmxCps=" + repr(CHARS_PER_SECOND) + ";"
    # 只数“会念出来”的字：汉字、假名、字母、数字；标点和空格不算时长。
    "function VmxSec(e){"
    "var t=String(e==null?``:e).match(/[\\u3400-\\u9fff\\u3040-\\u30ffa-zA-Z0-9]/g);"
    "return t&&t.length>0?Math.max(.6,t.length/VmxCps):0"
    "}"
    "async function VmxCheck(e){"
    "var t=[],n=[];"
    "if(typeof it!==`function`||!it(e))return;"  # 关掉配音的任务不提示
    "try{"
    "var r=lt(e),o=!!(r&&r.enabled)&&!!String((r&&r.folder)||``).trim(),"
    "s=Number(dt(e));s=s>0?s:1;"
    "var i=e&&e.shots?e.shots.length:0;"
    "for(var c=0;c<i;c++){"
    "var l=e.shots[c];"
    "if(String((l&&l.audioUrl)||``).trim()&&((l&&l.durationSec)||0)>0)continue;"
    "var u=``;try{u=bt(e,c)||``}catch{}"
    "if(String(u).trim()){"
    "t.push(`镜头 ${c+1}（约 ${(Math.max(.6,VmxSec(u))/s).toFixed(1)} 秒）`)"
    "}else if(!o){n.push(`镜头 ${c+1}`)}"
    "}"
    "}catch{return}"
    "if(t.length===0&&n.length===0)return;"
    "var a=[];"
    "t.length>0&&a.push(`以下镜头没有配音，画面会按文案长度裁短（不再播完整段素材），"
    "这几段没有人声：`+t.join(`、`)+`。`);"
    "n.length>0&&a.push(`以下镜头既没有文案也没有配音，会把整段素材播完，"
    "当前也没开启背景音乐，这几段会全程无声：`+n.join(`、`)+`。`);"
    "a.push(`判定标准：单段无声超过 ${VmxGap} 秒。`);"
    "a.push(`确定继续合成吗？`);"
    "try{await VmxBox.confirm(a.join(`\\n\\n`),`合成前提醒`,"
    "{confirmButtonText:`继续合成`,cancelButtonText:`取消，我先去改`,type:`warning`})}"
    # 取消时抛错就够了：调用方会把任务标成“已取消”（和软件自带取消按钮一致，
    # 列表里显示“已取消 + 重试合成”），用户改完再点一次即可。
    "catch{throw Error(`已取消合成：请先补齐这些镜头的配音，"
    "或在「镜头剪辑」里清空不需要配音的镜头文案（也可以先开背景音乐来垫底）`)}"
    "}"
)

BT_NEW = _HELPERS + BT_OLD + "await VmxCheck(e);"

# 3) 没有配音的镜头：如果它还有文案，按文案估算时长，而不是播完整段素材。
EST_OLD = ",!0};if(_){"
EST_NEW = (
    ",!0};var vmxEst=0;"
    "if(!_&&typeof it===`function`&&it(e)){"
    "try{var vmxTxt=bt(e,t);"
    "vmxTxt&&(vmxEst=VmxSec(vmxTxt)/(Number(dt(e))>0?Number(dt(e)):1))}catch{}"
    "}"
    "if(_){"
)

# 没配音的分支里，原来写死了 baseDurationSec/durationSec，为 0 就整段播完；
# 现在 0 就退回上面算出来的估算时长。
ELSE_OLD = "i=!1;e>0&&p.duration>e&&(i=!0,"
ELSE_NEW = "i=!1;e<=0&&(e=vmxEst),e>0&&p.duration>e&&(i=!0,"

RULES = [
    (IMPORT_OLD, IMPORT_NEW),
    (BT_OLD, BT_NEW),
    (EST_OLD, EST_NEW),
    (ELSE_OLD, ELSE_NEW),
]

# 每条补丁里“旧串”在 base asar 里应当命中的次数，构建时人工核对。
EXPECTED_HITS = {
    IMPORT_OLD: 1,
    BT_OLD: 1,
    EST_OLD: 1,
    ELSE_OLD: 1,
}
