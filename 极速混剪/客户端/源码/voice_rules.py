# -*- coding: utf-8 -*-
"""智能配音补丁：没填 MiniMax Key 时，音色下拉也要能点开、能看见有什么。

客户提过两轮：

第一轮 —— 「没填写 minimax 的时候音色是不可选择的状态，但在这个页面看不出来
是什么原因导致的」。原因在代码里是这样的（VideoMix-*.js，create-actions-card）：

    Oe = computed(() => !!V.value && !!f.value?.trim())   // 配音开着 且 MiniMax Key 非空
    ...  disabled: !Oe.value, placeholder: `选择音色`

也就是说：**只要 MiniMax Key 是空的，音色就必然选不了**，因为音色列表本来
就是拿这个 Key 去 MiniMax 云端拉的（`Ke()` → `https://api.minimaxi.com/v1/get_voice`）。
可界面只把它变灰，不说为什么。第一轮已经补了占位文字和一句可点的橙色提示。

第二轮 —— 「没配置 minimax 的时候那个下拉框也可以下拉，这样用户就能看到选择框
里面是什么东西，不然第一次使用的人不知道选择框里面有音色」，并且「未配置 minimax
的时候点击创建任务，弹一个二次确认框，告诉用户视频生成出来是没有人物声音的，
弹窗有两个按钮：立即配置 / 继续生成」。

所以这个补丁一共做四件事（都只在「配音开着但没填 Key」时出现明显变化）：

1) 音色下拉在没 Key 时不再 disabled，可以点开；
2) 没 Key 时下拉里放一份内置的默认音色清单（9 个 MiniMax 官方系统音色），
   第一次用的人点开就知道这个框里是「音色」，选了也认得名字；
3) 占位文字从「选择音色」变成「未填写 MiniMax Key」，下拉后面仍保留那句
   可点的橙色提示，点一下直接跳「系统设置」去填 Key；
4) 点「创建任务」时如果还没填 Key，先弹二次确认框：
   【立即配置】跳系统设置（不建任务）/【继续生成】按无声继续建任务。

填上 Key 之后 1)~3) 自动消失，下拉恢复成云端音色列表 + 「选择音色」占位。
"""

# 内置默认音色（MiniMax 官方系统音色 ID + 中文名）。
# 取的正是软件自己在 minimaxManualVoicesStorage 里列的 9 个首选 ID，
# 所以用户顺手选一个，等填上 Key 之后云端列表也对得上同一个 ID。
VOICE_LIST = [
    ("Chinese_crisp_podcaster_nv1", "清亮女主播"),
    ("Chinese_worker_male", "沉稳男声"),
    ("Chinese_wenrounvxing", "温柔女声"),
    ("Chinese (Mandarin)_Gentleman", "儒雅绅士"),
    ("Chinese_pangban_male", "磁性男声"),
    ("female-tianmei", "甜美少女"),
    ("cute_boy", "可爱男孩"),
    ("qiaopi_mengmei", "俏皮萌妹"),
    ("danya_xuejie", "淡雅学姐"),
]

_FALLBACK_JS = (
    "var VmxVoiceDefault=["
    + ",".join("{id:`%s`,name:`%s`}" % (vid, name) for vid, name in VOICE_LIST)
    + "];function VmxVoiceList(){return VmxVoiceDefault.map(function(e)"
      "{return{id:e.id,name:e.name}})}"
)

# 1) 音色下拉：没 Key 也能点开，占位文字按有没有 Key 分情况。
DROPDOWN_OLD = (
    "e=>L(re)?re.value=e:null,disabled:!Oe.value,loading:Y.value,filterable:``,"
    "clearable:``,placeholder:`选择音色`,style:{width:`260px`},onVisibleChange:qe}"
)
DROPDOWN_NEW = (
    "e=>L(re)?re.value=e:null,disabled:!1,loading:Y.value,filterable:``,"
    "clearable:``,placeholder:Oe.value?`选择音色`:`未填写 MiniMax Key`,"
    "style:{width:`260px`},onVisibleChange:qe}"
)

# 2) 没 Key 的时候把内置音色清单放进下拉框。
#    原逻辑：Key 一变就把列表清空，只有 Oe（配音开着 + 有 Key）才去云端拉。
#    现在改成：没 Key 就塞内置清单，点开至少能看见音色长什么样。
WATCHER_OLD = (
    "function qe(e){e&&(Z.value=Ce(Z.value,Te()),Z.value.length===0&&Ke())}"
    "A(f,()=>{Z.value=[],X.value=``,Oe.value&&Ke()},{immediate:!0});"
)
WATCHER_NEW = (
    "function qe(e){e&&(Z.value=Ce(Z.value,Te()),Z.value.length===0&&Ke())}"
    + _FALLBACK_JS
    + "A(f,()=>{Z.value=Oe.value?[]:VmxVoiceList(),X.value=``,Oe.value&&Ke()},"
      "{immediate:!0});"
)

# 3) 下拉框后面补一句可点的提示，点一下跳系统设置。
#
# 锚点取「普通话/粤语」那个语言下拉的尾巴：它正好是智能配音这一行
# （key:2 的 fragment）的最后一个子节点，插在它后面就落在同一行里。
HINT_OLD = (
    "j(g,{label:`粤语`,value:vr})]),_:1},8,[`modelValue`])):P(``,!0)],64)):P(``,!0)])]),"
    "H(`div`,rr,["
)
HINT_TEXT = "未填写 MiniMax Key，下面是默认音色，点这里去系统设置填 Key（填完才会真正出声）"
HINT_NEW = (
    "j(g,{label:`粤语`,value:vr})]),_:1},8,[`modelValue`])):P(``,!0),"
    "Oe.value?P(``,!0):(w(),B(`span`,{key:`vmxVoiceWhy`,"
    "class:`create-actions-card__hint`,"
    "style:{color:`#e6a23c`,cursor:`pointer`},"
    "onClick:()=>{window.location.hash=`#/settings`}},"
    "`" + HINT_TEXT + "`))"
    "],64)):P(``,!0)])]),H(`div`,rr,["
)

# 4) 点「创建任务」时没填 Key 先弹二次确认。
#    VmxBox 在这个文件里叫 g（es-BoKzuN0V.js 的 `GX as n`，本文件 `n as g`），
#    系统设置页 / 保存模板那两处也是用它弹的 confirm / prompt。
#    nt 本身是 async，可以直接 await。
CONFIRM_OLD = (
    "if(V.value&&!String(re.value||``).trim())"
    "{_.warning(`已开启智能配音，请先选择音色`);return}"
)
CONFIRM_TEXT = (
    "检测到还没有配置 MiniMax Key，生成出来的视频不会有配音，人物没有说话的声音。"
    "可以点「立即配置」去系统设置里填 MiniMax Key，也可以点「继续生成」先按无声合成。"
)
CONFIRM_NEW = (
    "if(V.value&&!Oe.value){"
    "try{await g.confirm(`" + CONFIRM_TEXT + "`,`未配置 MiniMax`,"
    "{confirmButtonText:`继续生成`,cancelButtonText:`立即配置`,type:`warning`,"
    "showClose:!1,closeOnClickModal:!1})}"
    "catch{window.location.hash=`#/settings`;return}}"
    # 选了「继续生成」就真的让它走下去：没挑音色的话顺手补上默认音色，
    # 免得紧接着又被原来那句「请先选择音色」拦下来。
    "if(V.value&&!Oe.value&&!String(re.value||``).trim())"
    "re.value=VmxVoiceDefault[0].id;"
    "if(V.value&&!String(re.value||``).trim())"
    "{_.warning(`已开启智能配音，请先选择音色`);return}"
)

RULES = [
    (DROPDOWN_OLD, DROPDOWN_NEW),
    (WATCHER_OLD, WATCHER_NEW),
    (HINT_OLD, HINT_NEW),
    (CONFIRM_OLD, CONFIRM_NEW),
]

# 每条补丁里“旧串”在 base asar 里应当命中的次数，构建时人工核对。
EXPECTED_HITS = {
    DROPDOWN_OLD: 1,
    WATCHER_OLD: 1,
    HINT_OLD: 1,
    CONFIRM_OLD: 1,
}
