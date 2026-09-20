# -*- coding: utf-8 -*-
"""界面微调补丁（改 app.asar 里的 CSS）。

客户看过界面之后提的两点：

1) 左侧栏顶部那个 logo 图片撑得太满，四周没有留白 -> 缩小。
   原样式是 `max-width:100%;max-height:52px`，而那个胶囊本身只有 68px 高，
   图片贴着边框。改成最大宽度 86%、最大高度 42px，四周就透气了。

2) 顶部那条标题栏会跟着页面滚动上下飘（滚动时贴到窗口最上沿、还压住内容）
   -> 固定住。
   原因是原来的布局让 **整个文档** 滚动：`html,body,#app{height:100%}`，
   而 `.app-layout` 只有 `min-height:100vh`，内容一长就把文档撑开，
   `.app-layout__main` 的 `overflow:auto` 因为没有确定高度而形同虚设，
   于是标题栏的 `position:sticky` 相对文档生效，滚动时被顶到 top:0。
   改法是把外层做成固定高度的外壳（height:100% + overflow:hidden），
   让滚动发生在 `.app-layout__main` 里面；标题栏变成普通流式元素，
   位置永远不动，内容从它下面滚过去。
"""

LOGO_OLD = (
    ".app-sidebar__logo-img{box-sizing:border-box;object-fit:contain;"
    "border-radius:12px;flex-shrink:0;width:auto;max-width:100%;height:auto;"
    "max-height:52px}"
)

LOGO_NEW = (
    ".app-sidebar__logo-img{box-sizing:border-box;object-fit:contain;"
    "border-radius:12px;flex-shrink:0;width:auto;max-width:86%;height:auto;"
    "max-height:42px}"
)

LAYOUT_OLD = ".app-layout__main{flex:1;min-height:0;padding:0 0 40px;overflow:hidden auto}"

LAYOUT_NEW = (
    ".app-layout__main{flex:1;min-height:0;padding:0 0 40px;"
    "overflow:auto;overscroll-behavior:contain}"
    # 外壳固定成视口高度，滚动收进 .app-layout__main
    ".app-layout{height:100%;min-height:0;overflow:hidden;"
    "flex-direction:column;display:flex}"
    ".app-layout__body{height:100%;min-height:0;overflow:hidden}"
    ".app-layout__main-column{height:100%;min-height:0;overflow:hidden}"
    # 标题栏不再 sticky，位置固定不动
    ".app-header{position:relative;top:auto}"
)

RULES = [
    (LOGO_OLD, LOGO_NEW),
    (LAYOUT_OLD, LAYOUT_NEW),
]

# 每条补丁里“旧串”在 asar 里应当命中的次数，构建时人工核对。
EXPECTED_HITS = {
    LOGO_OLD: 1,
    LAYOUT_OLD: 1,
}
