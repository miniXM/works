# -*- coding: utf-8 -*-
"""账号档案：系统预置一份完整、可信的示例档案，客户照着改就行。

背景：档案页原来给的是“卖鸭血粉丝汤的红姐”那套占位示例，而且表单是空的、
灰字提示客户经常直接跳过。现在改成两件事：

1. 「账号档案」里默认躺着一份写满的示例档案（北京烤鸭店的李逍遥），
   客户打开就能看到“一份能用的档案长什么样”，照着把自己的信息换进去；
2. 表单里去掉了「出生年份」「性别」两格——这两项跟口播文案没关系，
   客户也不想填，所以连「当前改写参考」里也不再输出。

另外「新建档案」建完之后直接弹「AI 帮我写」（在 persona_rules.py 那个补丁里
有 `VmxAiOpen`），客户点新建就是“先回答几个问题，AI 直接把档案写满”。

五个整串替换（旧串在 base asar 里的命中次数写在 EXPECTED_HITS）：

1. `mix-*.js` 建档案的 `$(name, profile)`：不给 profile 时用示例档案当默认值
   （新建档案、删到最后一个自动补的档案都走这里）；
2. `mix-*.js` 拼「当前改写参考」的 `z()`：不再输出「出生年份」「性别」两行；
3. `AccountPage` 表单：去掉那两格，其余示例文字换成不带 XX 的通用例子；
4. `AccountPage` 新建档案：建完自动弹出「AI 帮我写」；
5. 「档案名称」和新建弹窗里的示例（同一句，出现 2 次）。

示例档案的值只写在这里一处，`STOCK_JS` 会同时喂给 persona_rules.py 的 AI 补丁，
两边永远一致（AI 那边用“这一格还是不是示例原值”判断客户填没填）。
"""

# 系统预置的示例档案（顺序固定，跟表单里的字段顺序一致）。
# 这份数据同时被 persona_rules.py 用来判断“客户改过这一格没有”。
STOCK = [
    ("nickname", "我叫李逍遥"),
    ("hometown", "北京海淀人"),
    ("storeName", "北京烤鸭"),
    ("industry", "做的是餐饮行业，店里主营北京烤鸭和老火靓汤"),
    ("address", "北京市丰台区西罗园街道西马场路瑞和生活广场4楼"),
    ("investment", "前前后后投了100多万，租了280平的铺面，买了各种煎炸烘焙的设备"),
    ("duration", "从2007年开到现在"),
    ("setback", "2012年的时候想多做几样，结果亏了快200万；后来收回来只做烤鸭，才慢慢稳住"),
    ("trust", "做烤鸭这行快二十年，一直坚持货真价实，用料和手艺从来没糊弄过客户"),
    ("goal", "客户一饿就想到我这家"),
    ("audience", "大众口味，老人小孩都能吃，价格不贵，谁都能来"),
    ("sellingPoint", "果木挂炉现烤，皮脆肉嫩，师傅当面片鸭；老火靓汤每天现吊，不搁味精；"
                     "菜量实在，人均六七十就吃得挺舒服"),
    ("promo", "烤鸭168元一套，配荷叶饼、甜面酱和葱丝；老火靓汤38元一盅；午市套餐58元一位"),
]

STOCK_JS = "{" + ",".join("%s:`%s`" % (key, value) for key, value in STOCK) + "}"

# 1) 默认档案内容。
SEED_OLD = (
    "function $(e=`默认人设`,t){let n=Date.now();return{id:de(),"
    "name:String(e||``).trim()||`默认人设`,profile:Q(t),createdAt:n,updatedAt:n}}"
)

SEED_NEW = (
    "function VmxSeedProfile(){return" + STOCK_JS + "}"
    "function $(e=`默认人设`,t){let n=Date.now();return{id:de(),"
    "name:String(e||``).trim()||`默认人设`,profile:Q(t||VmxSeedProfile()),createdAt:n,updatedAt:n}}"
)

# 2) 「当前改写参考」不再输出年龄、性别。
REF_OLD = ("return r(`别人怎么称呼你`,t.nickname),r(`出生年份`,t.birth),"
           "r(`性别`,t.gender),r(`哪里人`,t.hometown),")
REF_NEW = "return r(`别人怎么称呼你`,t.nickname),r(`哪里人`,t.hometown),"

# 3) 表单：去掉出生年份、性别，示例文字换成不带 XX 的通用例子。
FIELDS_OLD = (
    "G=[{key:`nickname`,label:`（别人怎么称呼你）`,placeholder:`大家都叫我红姐`},"
    "{key:`birth`,label:`（出生年份）`,placeholder:`八四年出生（八四年大写，不要写84）`},"
    "{key:`gender`,label:`（性别）`,placeholder:`女`},"
    "{key:`hometown`,label:`（哪里人）`,placeholder:`江苏南京人`},"
    "{key:`storeName`,label:`（门店或品牌名称）`,placeholder:`红姐鸭血粉丝汤`},"
    "{key:`industry`,label:`（行业或主营业务）`,placeholder:`餐饮 / 鸭血粉丝汤 / 本地门店`},"
    "{key:`address`,label:`（门店地址或商圈）`,placeholder:`南京秦淮区夫子庙附近`},"
    "{key:`investment`,label:`（投了多少钱干了什么事）`,"
    "placeholder:`花了20万在南京开了家鸭血粉丝汤`,type:`textarea`,rows:2},"
    "{key:`duration`,label:`（做了多少年）`,placeholder:`5年`},"
    "{key:`setback`,label:`（遇到过什么挫折怎么解决的）`,"
    "placeholder:`2018年盲目扩张什么都想做，结果亏了100万，现在专注做好鸭血粉丝汤这一件事，靠这一口地道口味积累了口碑`,"
    "type:`textarea`,rows:2},"
    "{key:`trust`,label:`（我为什么值得信赖）`,"
    "placeholder:`5年专注做鸭血粉丝汤，秉承顾客至上，真材实料的理念，踏实做事`,type:`textarea`,rows:2},"
    "{key:`goal`,label:`（目标或者期望）`,"
    "placeholder:`让每一个顾客吃上一碗地道的南京鸭血粉丝汤`,type:`textarea`,rows:2},"
    "{key:`audience`,label:`（目标客群）`,"
    "placeholder:`南京本地上班族、附近居民、喜欢老味道的人`},"
    "{key:`sellingPoint`,label:`（特色卖点）`,"
    "placeholder:`汤底每天现熬、鸭血新鲜、粉丝劲道、老南京口味`,type:`textarea`,rows:2},"
    "{key:`promo`,label:`（产品介绍和价格）`,placeholder:`18元，鸭血粉丝汤`,type:`textarea`,rows:2}],"
)

FIELDS_NEW = (
    "G=[{key:`nickname`,label:`（别人怎么称呼你）`,placeholder:`例如：大家都叫我老张`},"
    "{key:`hometown`,label:`（哪里人）`,placeholder:`例如：山东济南人`},"
    "{key:`storeName`,label:`（门店或品牌名称）`,placeholder:`例如：老张家常菜`},"
    "{key:`industry`,label:`（行业或主营业务）`,placeholder:`例如：餐饮 / 家常菜 / 社区店`},"
    "{key:`address`,label:`（门店地址或商圈）`,placeholder:`例如：城西区文化路88号`},"
    "{key:`investment`,label:`（投了多少钱干了什么事）`,"
    "placeholder:`例如：投了60万，租了120平的铺面`,type:`textarea`,rows:2},"
    "{key:`duration`,label:`（做了多少年）`,placeholder:`例如：从2015年做到现在`},"
    "{key:`setback`,label:`（遇到过什么挫折怎么解决的）`,"
    "placeholder:`例如：2020年盲目扩张亏过钱，后来收回来只做一个店`,type:`textarea`,rows:2},"
    "{key:`trust`,label:`（我为什么值得信赖）`,"
    "placeholder:`例如：开店十年，用料实在，从没糊弄过客人`,type:`textarea`,rows:2},"
    "{key:`goal`,label:`（目标或者期望）`,"
    "placeholder:`例如：让周边的人想吃饭就想到我家`,type:`textarea`,rows:2},"
    "{key:`audience`,label:`（目标客群）`,"
    "placeholder:`例如：附近上班族和周边小区的住户`},"
    "{key:`sellingPoint`,label:`（特色卖点）`,"
    "placeholder:`例如：现炒现做、分量足、价格实在`,type:`textarea`,rows:2},"
    "{key:`promo`,label:`（产品介绍和价格）`,"
    "placeholder:`例如：人均40元，招牌菜58元一份`,type:`textarea`,rows:2}],"
)

# 4) 新建档案之后直接弹「AI 帮我写」。
NEW_OLD = "B.addPersonaProfile(String(e.value||``).trim()),a.success(`已新建账号档案`)"
NEW_NEW = NEW_OLD + ",setTimeout(VmxAiOpen,300)"

# 5) 「档案名称」和新建弹窗里的示例（同一句，出现 2 次）。
NAME_OLD = "例如：红姐南京店"
NAME_NEW = "例如：北京烤鸭店"

RULES = [
    (SEED_OLD, SEED_NEW),
    (REF_OLD, REF_NEW),
    (FIELDS_OLD, FIELDS_NEW),
    (NEW_OLD, NEW_NEW),
    (NAME_OLD, NAME_NEW),
]

# 每条补丁里“旧串”在 base asar 里应当命中的次数，构建时人工核对。
EXPECTED_HITS = {
    SEED_OLD: 1,
    REF_OLD: 1,
    FIELDS_OLD: 1,
    NEW_OLD: 1,
    NAME_OLD: 2,
}
