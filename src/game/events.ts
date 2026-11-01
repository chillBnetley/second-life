import type { EventCategory, EventChoice, EventOutcome, Effects, GameEvent, GameState, Mood, NPC, NpcEffect, Relation } from './types';
import { dateParts, pick, uid } from './util';
import type { RNG } from './util';

export interface EventDef {
  id: string;
  category: EventCategory;
  weight: number;
  title: string;
  description: string; // 支持 {npc} 占位符
  npc?: { relation?: Relation[]; minAffinity?: number };
  when?: (s: GameState) => boolean;
  priority?: boolean; // 条件满足时必定触发
  once?: boolean;
  cooldown?: number; // 天，默认 12
  choices: EventChoice[];
}

// ---------- 构造辅助 ----------
const o = (text: string, effects: Effects = {}, weight = 1): EventOutcome => ({ weight, text, effects });
const N = (affinity: number, memory?: string, mood?: Mood): NpcEffect[] => [{ id: '$npc', affinity, memory, mood }];
const c = (id: string, label: string, outcomes: EventOutcome[], extra: Partial<EventChoice> = {}): EventChoice => ({ id, label, outcomes, ...extra });

const isStudent = (s: GameState) => s.player.occupation === 'student';
const isEmployed = (s: GameState) => s.player.occupation === 'employed';
const hasJob = (s: GameState) => !!s.player.jobId;
/** 是否处于恋爱关系（第三阶段） */
const hasPartner = (s: GameState) => Object.keys(s.flags).some((k) => k.startsWith('partner_'));
/** 是否有可以发展恋爱线的对象（未在一起且好感 ≥ 50） */
const loverCandidate = (s: GameState) => s.npcs.some((n) => n.met && n.romanceable && n.affinity >= 50 && s.flags[`partner_${n.id}`] === undefined);
/** 某个事件是否在 days 天前发生过（用于事件链） */
const happenedBefore = (s: GameState, id: string) => s.seenEvents[id] !== undefined;
const happenedAtLeast = (s: GameState, id: string, days: number) => {
  const last = s.seenEvents[id];
  return last !== undefined && s.day - last >= days;
};

export const EVENT_DEFS: EventDef[] = [
  // ===================== 重大人生事件 =====================
  { id: 'opening', category: 'major', weight: 0, priority: true, once: true, when: (s) => s.day === 0,
    title: '人生的第一个岔路口',
    description: '十八岁的夏天结束了。行李已经收拾好，父母站在门口。接下来的路，由你自己来选。',
    choices: [
      c('a', '去上大学', [o('你拖着行李箱走进校园，新的生活开始了。学生的身份让你每月能拿到家里的津贴，但也意味着要学好功课。',
        { occupation: 'student', attrs: { intelligence: 2, happiness: 3 }, knowledge: 10, flags: { opened: true } })], { hint: '成为学生，每月领取家庭津贴' }),
      c('b', '直接进入社会', [o('你决定先赚钱再说。没有津贴，但你的第一份简历已经写好——去「工作」页面找份工作吧。',
        { occupation: 'unemployed', attrs: { eq: 2, charm: 1 }, knowledge: 3, flags: { opened: true } })], { hint: '没有津贴，需要自己找工作' }),
      c('c', '先出去走走', [o('你用一段独自旅行为人生按下了暂停键。回来时晒黑了，也更清楚自己想要什么。',
        { occupation: 'unemployed', attrs: { happiness: 12, charm: 3, eq: 1 }, flags: { opened: true } })], { cost: 2000, hint: '花费 ¥2,000，幸福感大涨' }),
    ] },
  { id: 'graduation', category: 'major', weight: 0, priority: true, once: true, when: (s) => isStudent(s) && s.day >= 1400,
    title: '毕业季',
    description: '答辩结束，学位帽被抛向空中。四年的时光像一场快进的电影。从明天起，你不再是学生了。',
    choices: [
      c('a', '带着笑容告别校园', [o('你和同学们拍下了最后一张合影。学生时代，圆满结束。',
        { occupation: 'unemployed', attrs: { happiness: 6, charm: 1 }, knowledge: 15, flags: { graduated: true } })]),
      c('b', '请大家吃散伙饭', [o('酒过三巡，大家都红了眼眶。这些人也许就是你一生的朋友。',
        { occupation: 'unemployed', attrs: { happiness: 8, eq: 2 }, knowledge: 15, flags: { graduated: true } })], { cost: 600 }),
    ] },
  { id: 'birthday', category: 'major', weight: 0, priority: true, cooldown: 300, when: (s) => s.flags.birthdayToday === true,
    title: '生日',
    description: '今天是你的生日，又长大了一岁。手机里已经躺着几条祝福。',
    choices: [
      c('a', '约朋友热闹庆祝', [o('蛋糕、蜡烛、走调的生日歌，这是个让你记很久的夜晚。', { attrs: { happiness: 8, charm: 1 }, npc: [{ id: 'yiming', affinity: 4, memory: '一起给你过了生日' }] })], { cost: 300 }),
      c('b', '和家人视频', [o('妈妈对着镜头念叨了十分钟，爸爸在后面小声说「长高了」。', { attrs: { happiness: 5, eq: 1 }, npc: [{ id: 'mom', affinity: 5, memory: '生日视频通话' }, { id: 'dad', affinity: 4, memory: '生日视频通话' }] })]),
      c('c', '一个人安静地度过', [o('你给自己煮了碗面，认真许了个愿。', { attrs: { happiness: 2, eq: 1 } })]),
    ] },
  { id: 'mentor_project', category: 'major', weight: 0, priority: true, once: true,
    when: (s) => isStudent(s) && s.player.knowledge >= 60 && s.npcs.some((n) => n.id === 'prof_zhou' && n.met),
    title: '导师的邀请',
    description: '周教授把你叫到办公室：「我手上有个课题，缺一个能吃苦的人。你有兴趣吗？」',
    choices: [
      c('a', '接下课题', [
        o('你熬了无数个夜，课题顺利结项，教授在署名里写上了你的名字。', { attrs: { intelligence: 5, health: -2 }, knowledge: 18, npc: [{ id: 'prof_zhou', affinity: 12, memory: '课题合作成功，赞许你的韧性' }] }),
        o('课题难度远超预期，你狼狈收场，但也学到不少。', { attrs: { intelligence: 2, happiness: -4, health: -3 }, knowledge: 8, npc: [{ id: 'prof_zhou', affinity: 3, memory: '课题没做成，但他看到了你的努力' }] }),
      ], { check: { attr: 'intelligence', target: 55 }, hint: '需要智力支撑，风险与回报并存' }),
      c('b', '婉拒，专心课业', [o('教授点点头：「也好，打好基础。」', { attrs: { eq: 1 }, npc: [{ id: 'prof_zhou', affinity: -1 }] })]),
    ] },
  { id: 'health_scare', category: 'major', weight: 0, priority: true, cooldown: 60, when: (s) => s.player.attrs.health < 40,
    title: '身体亮起红灯',
    description: '连续的疲劳终于有了回响：头晕、心悸，你被迫停下了脚步。',
    choices: [
      c('a', '立刻去医院检查', [o('医生说幸好来得早，开了药，嘱咐你好好休息。', { attrs: { health: 12, happiness: -1 } })], { cost: 800 }),
      c('b', '硬扛过去', [
        o('睡了一觉居然缓过来了。但你得记住，身体不会永远原谅你。', { attrs: { health: 3 } }, 6),
        o('症状加重了。你不得不请了几天假，还被医生训了一顿。', { attrs: { health: -4, happiness: -5 }, ap: -5, money: -600 }, 4),
      ]),
    ] },

  // ===================== 日常事件 =====================
  { id: 'rainy_day', category: 'daily', weight: 8, title: '突如其来的大雨', description: '你刚走出门，天色骤变，雨点噼里啪啦砸了下来。',
    choices: [
      c('a', '冲进雨里跑回去', [o('你湿漉漉地冲回家，打了几个喷嚏，却莫名有点畅快。', { attrs: { health: -2, happiness: 1 } })]),
      c('b', '买把伞', [o('便利店的伞不贵，你撑着它慢慢走，听了一路雨声。', { attrs: { happiness: 1 } })], { cost: 20 }),
      c('c', '进咖啡馆躲雨', [
        o('一杯热咖啡，一本书，雨停时你竟有点舍不得走。', { attrs: { happiness: 3, intelligence: 0.5 } }, 7),
        o('你在咖啡馆偶遇了一个聊得来的陌生人，换了联系方式。', { attrs: { charm: 1, happiness: 3 } }, 3),
      ], { cost: 35 }),
    ] },
  { id: 'street_cat', category: 'daily', weight: 6, title: '路边的小猫', description: '一只瘦瘦的橘猫蹲在你的必经之路上，歪着头看你。',
    choices: [
      c('a', '蹲下来摸摸它', [o('它舒服地呼噜起来，一整天的疲惫都被治愈了。', { attrs: { happiness: 4 } })]),
      c('b', '买根火腿肠喂它', [o('小猫吃得飞快，还蹭了蹭你的裤脚。你决定以后每天带点吃的。', { attrs: { happiness: 5, eq: 1 } })], { cost: 5 }),
      c('c', '赶时间，径直走过', [o('你匆匆走过，有点后悔没停一停。', { attrs: { happiness: -1 } })]),
    ] },
  { id: 'phone_broken', category: 'daily', weight: 4, title: '手机屏幕碎了', description: '手一滑，手机重重摔在地上，屏幕裂成了蜘蛛网。',
    choices: [
      c('a', '去修理', [o('师傅半小时就修好了，焕然一新。', { attrs: { happiness: 1 } })], { cost: 350 }),
      c('b', '凑合用', [o('裂纹划得手指生疼，每次看到都心烦。', { attrs: { happiness: -3 } })]),
    ] },
  { id: 'insomnia', category: 'daily', weight: 5, title: '失眠的夜', description: '凌晨两点，你还睁着眼，脑子里像有一台停不下来的放映机。',
    choices: [
      c('a', '刷手机到困', [o('屏幕的蓝光让你更清醒了，直到天蒙蒙亮才睡着。', { attrs: { health: -2, happiness: -1 } })]),
      c('b', '做个冥想', [o('呼吸变得缓慢，你不知什么时候睡着了。', { attrs: { eq: 1, health: 1, happiness: 1 } })]),
      c('c', '爬起来学习', [o('安静的深夜，效率出奇地高，只是第二天有点困。', { attrs: { health: -2, intelligence: 1 }, knowledge: 4 })]),
    ] },
  { id: 'granny_dumplings', category: 'daily', weight: 5, npc: { relation: ['neighbor'] }, title: '{npc}的饺子',
    description: '门被敲响了，{npc}端着一盘热腾腾的饺子站在门外：「多包了点，给你尝尝。」',
    choices: [
      c('a', '道谢并聊几句', [o('老人家笑眯眯地说起年轻时的故事，你听得入神。', { attrs: { happiness: 3, eq: 1 }, npc: N(6, '收下了饺子，听她讲年轻时的故事') })]),
      c('b', '回送一些水果', [o('老人家推辞了半天还是收下了，眼角笑出了褶子。', { attrs: { happiness: 3, eq: 1 }, npc: N(9, '互相送了东西，像家人一样') })], { cost: 40 }),
    ] },

  // ===================== 社交事件 =====================
  { id: 'friend_party', category: 'social', weight: 8, npc: { relation: ['friend', 'classmate'], minAffinity: 10 }, title: '{npc}的邀约',
    description: '{npc}发来消息：「这周末有个小聚会，来不来？都是些有意思的人。」',
    choices: [
      c('a', '欣然赴约', [
        o('现场气氛很好，你认识了几个新朋友，也和{npc}聊得更投机了。', { attrs: { charm: 2, happiness: 4, eq: 1 }, npc: N(6, '一起参加了聚会') }, 7),
        o('聚会有点尴尬，你提前溜了，但{npc}并不介意。', { attrs: { happiness: 0 }, npc: N(2) }, 3),
      ], { cost: 100 }),
      c('b', '带着礼物去', [o('你的细心让{npc}很感动，整晚都在向别人介绍你。', { attrs: { charm: 2, happiness: 4 }, npc: N(10, '你带了礼物来参加聚会') })], { cost: 220 }),
      c('c', '委婉拒绝', [o('{npc}回了个「没事，下次！」，但似乎有点失落。', { attrs: { happiness: 0 }, npc: N(-2, '你拒绝了聚会邀约') })]),
    ] },
  { id: 'borrow_money', category: 'social', weight: 5, npc: { relation: ['friend', 'classmate', 'neighbor'], minAffinity: 20 }, title: '{npc}想借钱',
    description: '{npc}有点难为情地开了口：「最近手头有点紧，能借我 500 吗？很快还你。」',
    choices: [
      c('a', '借给 TA', [
        o('一周后{npc}就把钱还了，还请你吃了顿饭。', { money: 560, attrs: { eq: 1 }, npc: N(8, '借了钱，如期归还') }, 6),
        o('钱迟迟没有下文，你们都默契地不再提起。', { npc: N(-3, '借出去的 500 元没了下文') }, 4),
      ], { cost: 500 }),
      c('b', '婉言拒绝', [o('{npc}笑了笑说理解，但气氛明显冷了下来。', { npc: N(-5, '你拒绝借钱') })]),
    ] },
  { id: 'argument', category: 'social', weight: 5, npc: { relation: ['friend', 'classmate', 'colleague'] }, title: '与{npc}起了争执',
    description: '一句无心的话被{npc}听岔了，场面突然僵住。',
    choices: [
      c('a', '主动道歉，把话说开', [
        o('你们把误会说开了，反而更加了解彼此。', { attrs: { eq: 2 }, npc: N(5, '一场误会后和解') }, 6),
        o('对方余怒未消，但态度软化了一些。', { attrs: { eq: 1 }, npc: N(1) }, 4),
      ], { check: { attr: 'eq', target: 45 } }),
      c('b', '据理力争', [o('你说得头头是道，但{npc}的脸色越来越难看。', { attrs: { happiness: -2 }, npc: N(-8, '那次争吵，你寸步不让', 'angry') })]),
      c('c', '冷处理，各自冷静', [o('几天后你们都没提这事，关系却有了一道看不见的裂缝。', { npc: N(-3, '争吵后的冷战') })]),
    ] },
  { id: 'heart_to_heart', category: 'social', weight: 5, npc: { relation: ['friend', 'family', 'classmate'], minAffinity: 30 }, title: '{npc}的心事',
    description: '{npc}约你到河边坐坐，沉默了很久才说：「其实我最近一直很迷茫……」',
    choices: [
      c('a', '安静地倾听', [o('你没有急着给建议，只是陪着。{npc}说完，长长地舒了口气。', { attrs: { eq: 2, happiness: 1 }, npc: N(9, '在你面前说出了心事', 'happy') })]),
      c('b', '给出具体建议', [
        o('你的建议一针见血，{npc}若有所思地点点头。', { attrs: { intelligence: 1, eq: 1 }, npc: N(6, '收到了你的建议') }, 5),
        o('{npc}只是想被听见，你的建议让TA有点失落。', { npc: N(1) }, 5),
      ]),
      c('c', '敷衍几句', [o('{npc}笑了笑说「没事」，但你知道自己错过了什么。', { attrs: { happiness: -2 }, npc: N(-7, '你敷衍了TA的心事', 'sad') })]),
    ] },
  { id: 'family_call', category: 'social', weight: 6, npc: { relation: ['family'] }, title: '来自{npc}的电话',
    description: '手机响了，屏幕上跳动着「{npc}」两个字。',
    choices: [
      c('a', '聊聊近况', [
        o('你们聊了半小时，挂电话前{npc}偷偷给你转了一笔钱。', { attrs: { happiness: 3 }, money: 300, npc: N(5, '通了很久的电话', 'happy') }, 3),
        o('你们聊了很久，挂电话后你心里暖暖的。', { attrs: { happiness: 4, eq: 0.5 }, npc: N(5, '通了很久的电话', 'happy') }, 7),
      ]),
      c('b', '匆匆说两句', [o('「我在忙，回头说。」你挂了电话，心里有点歉意。', { attrs: { happiness: -1 }, npc: N(-2, '电话里你很匆忙') })]),
    ] },

  // ===================== 学习事件 =====================
  { id: 'pop_quiz', category: 'study', weight: 8, when: isStudent, title: '随堂测验',
    description: '老师笑眯眯地说：「今天有个小测验，不计入总评，但……会记在我的小本本上。」',
    choices: [
      c('a', '认真作答', [
        o('题目都在你的复习范围内，你交卷时胸有成竹。', { attrs: { intelligence: 1.5, happiness: 2 }, knowledge: 4 }),
        o('有几道题你完全没见过，只好硬着头皮写。', { attrs: { happiness: -2 }, knowledge: 1 }),
      ], { check: { attr: 'intelligence', target: 50 } }),
      c('b', '凭感觉写写', [o('你很快交了卷，成绩……只能说有点惊险。', { attrs: { happiness: -1 }, knowledge: 1 })]),
    ] },
  { id: 'study_group', category: 'study', weight: 6, when: isStudent, npc: { relation: ['classmate', 'friend'] }, title: '{npc}的学习小组',
    description: '{npc}问你要不要一起组个学习小组，互相督促。',
    choices: [
      c('a', '加入', [
        o('小组效率奇高，你们互相讲解、互相纠错，进步飞快。', { attrs: { intelligence: 2, eq: 0.5 }, knowledge: 8, npc: N(5, '一起组了学习小组') }, 7),
        o('小组成了聊天会，几个小时过去了什么也没学。', { attrs: { happiness: 3 }, knowledge: 1, npc: N(4) }, 3),
      ]),
      c('b', '更习惯自己学', [o('{npc}耸耸肩：「行吧，需要时随时找我。」', { npc: N(0) })]),
    ] },
  { id: 'scholarship', category: 'study', weight: 3, cooldown: 300, when: (s) => isStudent(s) && s.player.knowledge >= 30, title: '奖学金评选',
    description: '辅导员发来通知：本年度奖学金开始评选，需要提交申请材料。',
    choices: [
      c('a', '认真准备材料', [
        o('评审通过了！这笔奖学金让你的钱包和自信心都鼓了起来。', { money: 2000, attrs: { happiness: 6, intelligence: 1 } }),
        o('遗憾落选，但评委给了你不少中肯的反馈。', { attrs: { happiness: -2, intelligence: 1 }, knowledge: 3 }),
      ], { check: { attr: 'intelligence', target: 55 }, hint: '看智力检定' }),
      c('b', '不参加', [o('你觉得这事和自己没什么关系。', {})]),
    ] },

  // ===================== 工作事件 =====================
  { id: 'overtime_ask', category: 'work', weight: 8, when: isEmployed, title: '临时加班通知',
    description: '快下班时，上司拍了拍你的肩：「这个项目周末前要交，辛苦一下？」',
    choices: [
      c('a', '答应加班', [o('熬到深夜，项目顺利交付，上司当场给你发了加班补贴。', { money: 400, attrs: { health: -4, happiness: -3 }, knowledge: 3 })]),
      c('b', '礼貌拒绝', [
        o('你条理清晰地说明了手头的工作量，上司表示理解。', { attrs: { eq: 1 } }),
        o('上司脸色不太好看，之后几天你明显被冷落。', { attrs: { happiness: -3 } }),
      ], { check: { attr: 'eq', target: 50 }, hint: '看情商检定' }),
    ] },
  { id: 'colleague_help', category: 'work', weight: 6, when: hasJob, title: '同事求助',
    description: '隔壁工位的同事皱着眉头，对着电脑屏幕叹气：「你有空帮我看看这个吗？」',
    choices: [
      c('a', '耐心帮忙', [o('问题很快解决，同事感激地请你喝了杯奶茶。', { attrs: { eq: 1.5, happiness: 2 }, knowledge: 2 })]),
      c('b', '推说自己忙', [o('对方悻悻地离开了。你省下了时间，却也少了一份人情。', { attrs: { eq: -1 } })]),
    ] },
  { id: 'perf_review', category: 'work', weight: 5, cooldown: 90, when: isEmployed, title: '季度绩效评估',
    description: '人事发来通知：本季度的绩效评估将在下周一进行。',
    choices: [
      c('a', '精心准备述职', [
        o('你的述职逻辑清晰，上司当场表扬，并给了一笔绩效奖金。', { money: 1500, attrs: { happiness: 5, charm: 1 }, knowledge: 5 }),
        o('述职时你有些紧张，评价只是「合格」。', { attrs: { happiness: -2 }, knowledge: 2 }),
      ], { check: { attr: 'charm', target: 48 }, hint: '看魅力检定' }),
      c('b', '照常工作', [o('评估结果不好不坏。', { knowledge: 1 })]),
    ] },
  { id: 'side_gig', category: 'work', weight: 5, cooldown: 40, when: (s) => !isEmployed(s), title: '一单临时兼职',
    description: '朋友圈里有人在找临时帮手：做一天活动场务，结算当天现金。',
    choices: [
      c('a', '接下来', [o('你忙了大半天，累得够呛，但拿到现金时还是很开心。', { money: 300, ap: -2, attrs: { health: -1, charm: 0.5 } })]),
      c('b', '算了，不想折腾', [o('你婉拒了，继续做自己的事。', {})]),
    ] },

  // ===================== 随机事件 =====================
  { id: 'find_wallet', category: 'random', weight: 5, title: '路上的钱包', description: '长椅上躺着一个鼓鼓的钱包，周围一个人也没有。',
    choices: [
      c('a', '交给附近的警察', [o('失主很快找来了，对你千恩万谢，还硬塞了点酬谢金。', { money: 100, attrs: { happiness: 4, eq: 1 } })]),
      c('b', '据为己有', [o('你拿走了里面的现金，心里却一直不踏实。', { money: 400, attrs: { happiness: -4, eq: -1 } })]),
    ] },
  { id: 'lottery', category: 'random', weight: 4, title: '刮刮乐', description: '便利店收银台旁摆着一排刮刮乐，老板笑着问你：「试试手气？」',
    choices: [
      c('a', '买一张试试', [
        o('刮开——「谢谢参与」。', { attrs: { happiness: -0.5 } }, 90),
        o('小中！勉强够回本。', { money: 50, attrs: { happiness: 2 } }, 8),
        o('居然中了 ¥2000！你盯着屏幕愣了好几秒。', { money: 2000, attrs: { happiness: 10 } }, 2),
      ], { cost: 20 }),
      c('b', '不买', [o('你理智地摇了摇头。', { attrs: { eq: 0.3 } })]),
    ] },
  { id: 'scam_call', category: 'random', weight: 5, title: '可疑的来电', description: '陌生号码来电：「你好，我们是银行客服，你的账户存在风险，需要你立即转账验证。」',
    choices: [
      c('a', '保持警惕，直接挂断', [
        o('你识破了骗局，顺手把号码拉黑。', { attrs: { eq: 1, happiness: 1 } }),
        o('你一时慌了神，转了一笔钱才反应过来……', { money: -500, attrs: { happiness: -6 } }),
      ], { check: { attr: 'intelligence', target: 45 }, hint: '看智力检定' }),
      c('b', '追问细节想看看对方什么来头', [o('对方露出了破绽，你果断报了警。', { attrs: { eq: 1, happiness: 2 } })]),
    ] },
  { id: 'sudden_cold', category: 'random', weight: 6, title: '突如其来的感冒', description: '一觉醒来，嗓子像被砂纸磨过，额头也有些发烫。',
    choices: [
      c('a', '吃药休息', [o('两天后症状大大缓解。', { attrs: { health: -1, happiness: -1 } })], { cost: 60 }),
      c('b', '硬扛着', [
        o('居然自己好了。', { attrs: { health: -2 } }, 5),
        o('症状反而加重，耽误了半天时间。', { attrs: { health: -6, happiness: -3 }, ap: -3 }, 5),
      ]),
    ] },
  { id: 'old_classmate', category: 'random', weight: 4, title: '偶遇旧识', description: '在路口等红灯时，有人拍了拍你的肩：「你是……？居然真的是你！」',
    choices: [
      c('a', '热情地叙叙旧', [
        o('你们在路边聊了二十分钟，互留了联系方式。', { attrs: { charm: 1, happiness: 3 } }),
        o('你一时想不起对方是谁，尴尬地笑了笑。', { attrs: { happiness: -1 } }),
      ], { check: { attr: 'charm', target: 40 } }),
      c('b', '礼貌点头，赶路', [o('你匆匆告别，之后偶尔想起这次擦肩而过。', {})]),
    ] },
  // ===================== 日常事件（扩充） =====================
  { id: 'lost_key', category: 'daily', weight: 5, title: '钥匙不见了', description: '出门时摸遍口袋，钥匙不在。你开始回想它可能落在哪里。',
    choices: [
      c('a', '沿原路找回去', [o('你在楼道的花盆后面找到了它，只是上班迟到了，被扣了全勤。', { attrs: { happiness: -1, eq: 0.5 }, money: -20 })]),
      c('b', '叫开锁师傅', [o('师傅十分钟就到了，收了一笔不算便宜的费用。', { attrs: { happiness: -2 }, money: -120 })]),
    ] },
  { id: 'loud_neighbor', category: 'daily', weight: 5, title: '楼上的噪音', description: '深夜十一点，楼上还在拖家具、来回走动，天花板像在打鼓。',
    choices: [
      c('a', '上楼好好沟通', [
        o('对方连声道歉，说家里孩子刚学会走路，之后果然安静了。', { attrs: { eq: 1, happiness: 1 } }, 6),
        o('对方态度强硬，你们在门口僵了半天，你憋了一肚子气。', { attrs: { happiness: -3, eq: 0.5 } }, 4),
      ], { check: { attr: 'eq', target: 45 } }),
      c('b', '戴上耳塞忍一晚', [o('你翻来覆去到后半夜才睡着，第二天眼圈发青。', { attrs: { health: -1, happiness: -1 } })]),
    ] },
  { id: 'elevator_stuck', category: 'daily', weight: 3, title: '电梯停在两层之间', description: '电梯猛地一震，停住了，灯闪了一下。你按了按警铃。',
    choices: [
      c('a', '按警铃等待救援', [o('二十分钟后门被打开，你被扶了出来，腿还有点软。', { attrs: { happiness: -2, eq: 1 } })]),
      c('b', '试着扒开电梯门', [
        o('你居然真的撑开了门，跳出来时心脏狂跳，但也多了点底气。', { attrs: { happiness: 1, charm: 1 } }, 5),
        o('门只开了一条缝，手被划伤了。你决定以后再也不逞强。', { attrs: { health: -3, happiness: -2 } }, 5),
      ]),
    ] },
  { id: 'laundry_rain', category: 'daily', weight: 5, title: '晾着的衣服', description: '衣服刚晾上阳台，天色又阴了下来，风里带着湿气。',
    choices: [
      c('a', '赶紧收进来', [
        o('你抢在雨点落下前收好了衣服，还顺手帮隔壁收了床单。', { attrs: { happiness: 1, eq: 0.5 }, npc: N(2, '下雨天你帮TA收了床单') }, 6),
        o('刚收完雨就下大了，你站在阳台边，莫名有种胜利感。', { attrs: { happiness: 1 } }, 4),
      ]),
      c('b', '赌一把不会下雨', [
        o('雨最终没下来，衣服在风里干得蓬松。', { attrs: { happiness: 1 } }, 4),
        o('一场急雨把衣服全浇透了，你重新洗了一遍。', { attrs: { happiness: -3, health: -1 }, money: -100 }, 6),
      ]),
    ] },
  { id: 'hair_cut', category: 'daily', weight: 4, title: '理发', description: '理发店的镜子照出一个有点陌生的自己，剪刀已经在耳边响了。',
    choices: [
      c('a', '剪个利落的短发', [o('走出店门时，你觉得自己精神了不少，路上还被人多看了两眼。', { attrs: { charm: 1, happiness: 1 } })], { cost: 60 }),
      c('b', '只修一修', [o('你几乎看不出变化，但至少不再挡住眼睛。', { attrs: { happiness: 0.5 } })], { cost: 30 }),
      c('c', '改天再说', [o('你在镜子前比划了两下，还是转身走了。', { attrs: { happiness: -0.5 } })]),
    ] },
  { id: 'market_sale', category: 'daily', weight: 5, title: '限时折扣', description: '超市的日用品正在打折，购物车一辆接一辆从你身边推过。',
    choices: [
      c('a', '囤一批日用品', [o('你扛着两大袋纸巾回家，接下来半年都不用买了。', { attrs: { happiness: 1.5 } })], { cost: 150 }),
      c('b', '只买需要的', [o('你列了清单，只拿了清单上的东西，心里很踏实。', { attrs: { happiness: 1 } })], { cost: 40 }),
      c('c', '空手而归', [o('你绕了一圈就出去了，反正家里还够用。', { attrs: { happiness: 0.5 } })]),
    ] },
  { id: 'power_outage', category: 'daily', weight: 4, title: '停电', description: '整栋楼忽然暗了下来，只有应急灯在走廊里亮着。',
    choices: [
      c('a', '点蜡烛看书', [o('烛光摇摇晃晃，你却读得格外专注，像是偷来的时间。', { attrs: { intelligence: 1, happiness: 1 }, knowledge: 2 })]),
      c('b', '索性早点睡', [o('没有手机的夜晚，你睡得很沉。', { attrs: { health: 2, happiness: 1 } })]),
    ] },
  { id: 'missed_bus', category: 'daily', weight: 6, title: '错过的公交', description: '你跑到站台时，公交车刚好关上车门，扬长而去。',
    choices: [
      c('a', '打车赶时间', [o('你赶到时刚好没迟到，只是钱包又瘦了一点。', { attrs: { happiness: 0.5 } })], { cost: 35 }),
      c('b', '等下一班', [o('你站在站牌下看了很久的天，倒也没那么着急了。', { attrs: { happiness: -1, eq: 0.5 } })]),
    ] },
  { id: 'summer_heat', category: 'daily', weight: 5, when: (s) => [6, 7, 8].includes(dateParts(s.startISO, s.day).m), title: '持续高温', description: '连续一周的高温预警，柏油路都泛着白光。',
    choices: [
      c('a', '开空调窝在家里', [o('你抱着西瓜看了一下午的剧，除了电费有点心疼。', { attrs: { happiness: 1.5, health: 1 } })], { cost: 50 }),
      c('b', '该出门还是得出门', [o('你在太阳下走了二十分钟，整个人像被晒化了。', { attrs: { health: -2, eq: 0.5 } })]),
    ] },
  { id: 'first_snow', category: 'daily', weight: 4, when: (s) => [12, 1].includes(dateParts(s.startISO, s.day).m), title: '今年第一场雪', description: '窗外一片一片地白了，楼下有小孩在喊。',
    choices: [
      c('a', '出门踩雪', [o('你在雪地里留下了一串脚印，还拍了很多照片。', { attrs: { happiness: 3, health: -1 } })]),
      c('b', '在家煮一锅热汤', [o('热气糊住了窗玻璃，你觉得这样的冬天也很好。', { attrs: { health: 2, happiness: 1.5 } })], { cost: 30 }),
    ] },

  // ===================== 社交事件（扩充） =====================
  { id: 'old_friend_invite', category: 'social', weight: 6, npc: { relation: ['friend', 'classmate'], minAffinity: 10 }, title: '{npc}约你聚聚',
    description: '{npc}发来消息：「好久没见了，周末出来坐坐？」',
    choices: [
      c('a', '欣然赴约', [o('你们聊到店里打烊，聊起旧事时都笑出了声。', { attrs: { happiness: 3, eq: 1 }, npc: N(4, '一起聚了一次，聊得很开心') })], { cost: 80 }),
      c('b', '这周实在抽不开身', [o('对方说「没事，下次再约」，你却有点过意不去。', { attrs: { happiness: -1 }, npc: N(-2, '你推掉了这次邀约') })]),
    ] },
  { id: 'colleague_lunch', category: 'social', weight: 6, when: hasJob, npc: { relation: ['colleague', 'mentor'], minAffinity: 0 }, title: '同事叫你吃饭',
    description: '午休时间，{npc}敲了敲你的桌子：「一起去楼下吃？」',
    choices: [
      c('a', '一起去', [o('饭桌上聊起公司里的事，你听到了不少有用的信息。', { attrs: { happiness: 1, eq: 0.8 }, npc: N(3, '一起吃午饭，聊了很多') })], { cost: 25 }),
      c('b', '自己随便吃点', [o('你在工位上吃完，把下午的任务提前做完了。', { attrs: { happiness: 0.5, intelligence: 0.5 } })]),
    ] },
  { id: 'neighbor_help', category: 'social', weight: 5, npc: { relation: ['neighbor'] }, title: '{npc}来敲门',
    description: '{npc}站在门口，问你能不能帮忙搬一下新买的柜子。',
    choices: [
      c('a', '搭把手', [o('柜子搬上去时你出了一身汗，{npc}硬塞给你一袋水果。', { attrs: { fitness: 0.5, happiness: 1.5 }, npc: N(5, '你帮TA搬了柜子') })]),
      c('b', '说自己正忙着', [o('门关上后，你听见外面传来拖动家具的声音。', { attrs: { happiness: -1 }, npc: N(-3, '你拒绝了帮忙') })]),
    ] },
  { id: 'online_friend', category: 'social', weight: 4, title: '网友想见面', description: '聊了半年的网友说，下周正好来你的城市，要不要见一面？',
    choices: [
      c('a', '见一面', [
        o('现实里的TA和网上一样有趣，你们聊到地铁末班车。', { attrs: { charm: 2, happiness: 3 } }, 6),
        o('见面后才发现没什么话聊，尴尬地喝完了咖啡。', { attrs: { happiness: -1, eq: 1 } }, 4),
      ], { check: { attr: 'eq', target: 50 }, cost: 60 }),
      c('b', '保持线上就好', [o('你回了个笑脸，觉得有些关系留在屏幕里也不错。', { attrs: { happiness: 0.5, eq: 0.5 } })]),
    ] },
  { id: 'family_birthday', category: 'social', weight: 5, npc: { relation: ['family'] }, title: '{npc}的生日',
    description: '日历提醒弹了出来：今天是{npc}的生日。',
    choices: [
      c('a', '挑份礼物寄回去', [o('{npc}收到礼物后打来电话，语气里全是笑。', { attrs: { happiness: 3, eq: 0.5 }, npc: N(8, '生日收到你寄来的礼物') })], { cost: 300 }),
      c('b', '打个电话问候', [o('你们聊了十几分钟家常，挂电话时{npc}还在说「别乱花钱」。', { attrs: { happiness: 2 }, npc: N(4, '生日那天你打了电话') })]),
    ] },
  { id: 'misunderstanding', category: 'social', weight: 5, npc: { relation: ['friend', 'classmate'], minAffinity: 20 }, title: '被误会的玩笑',
    description: '你随口的一句玩笑，似乎被{npc}当真了，气氛有点僵。',
    choices: [
      c('a', '认真解释清楚', [
        o('话说开之后，{npc}反而笑了：「你怎么这么较真。」', { attrs: { eq: 1, happiness: 1 }, npc: N(3, '误会解开，关系更近了一点') }, 6),
        o('越解释越乱，最后不欢而散。', { attrs: { happiness: -2 }, npc: N(-4, '因为一句玩笑闹得不愉快') }, 4),
      ], { check: { attr: 'eq', target: 50 } }),
      c('b', '冷处理，等它过去', [o('几天后你们照常说话，但那句话像一根小刺留了下来。', { attrs: { happiness: -1 }, npc: N(-2, '你们之间有过一点隔阂') })]),
    ] },
  { id: 'group_photo', category: 'social', weight: 4, when: isStudent, title: '班级合影', description: '摄影师举着相机喊：「再往中间挤一挤，笑一个！」',
    choices: [
      c('a', '站到前排，笑得灿烂', [o('照片洗出来后，你在角落里找到了笑得最开心的自己。', { attrs: { charm: 1, happiness: 2 } })]),
      c('b', '悄悄躲在后排', [o('你在照片边角露出半张脸，倒也挺自在。', { attrs: { happiness: 0.5 } })]),
    ] },
  { id: 'reunion', category: 'social', weight: 4, cooldown: 240, when: (s) => s.day >= 180, title: '同学聚会',
    description: '群里有人张罗着聚会，说「这次一定要来」。',
    choices: [
      c('a', '去看看大家', [o('有人发了福，有人换了城市，聊起当年的糗事，笑声没停过。', { attrs: { happiness: 3, eq: 1, charm: 0.5 } })], { cost: 150 }),
      c('b', '不太想凑这个热闹', [o('你在群里回了个「下次一定」，然后关掉了手机。', { attrs: { happiness: -1 } })]),
    ] },
  { id: 'crush_hint', category: 'social', weight: 4, when: loverCandidate, npc: { relation: ['friend'], minAffinity: 45 }, title: '{npc}的暗示',
    description: '{npc}最近总找借口和你待在一起，今天还问你要不要一起看电影。',
    choices: [
      c('a', '主动约TA', [o('电影散场后你们在街边走了很久，谁也没说破，但都懂了。', { attrs: { happiness: 3, charm: 1 }, npc: N(5, '你约TA看了电影') })], { cost: 120 }),
      c('b', '装作没察觉', [o('TA笑了笑没再提，你们的关系停在了一个微妙的距离。', { attrs: { eq: 0.5, happiness: 0.5 }, npc: N(-1, 'TA的暗示没有得到回应') })]),
    ] },
  { id: 'partner_anniversary', category: 'social', weight: 4, cooldown: 180, when: hasPartner, npc: { relation: ['friend'], minAffinity: 50 }, title: '在一起的第 100 天',
    description: '你和{npc}在一起已经有一阵子了，今天是个有点特别的日子。',
    choices: [
      c('a', '准备一个小惊喜', [o('{npc}看到礼物时眼睛亮了一下，说「你怎么记得」。', { attrs: { happiness: 5, eq: 1 }, npc: N(6, '你记住了纪念日，准备了惊喜') })], { cost: 200 }),
      c('b', '和平时一样度过', [o('普通的晚饭，普通的一句晚安，{npc}好像有点失落。', { attrs: { happiness: -1 }, npc: N(-2, '纪念日你似乎忘了') })]),
    ] },
  { id: 'breakup_talk', category: 'social', weight: 4, when: hasPartner, npc: { relation: ['friend'], minAffinity: 20 }, title: '越来越少的对话',
    description: '你和{npc}最近话越来越少，连吃饭都各看各的手机。',
    choices: [
      c('a', '坐下来好好谈一次', [
        o('你们聊到深夜，把攒了很久的话都说了出来，反而轻松了。', { attrs: { happiness: 2, eq: 2 }, npc: N(5, '认真沟通过一次，关系缓和') }, 6),
        o('谈着谈着变成了争吵，最后谁也没有让步。', { attrs: { happiness: -4 }, npc: N(-6, '沟通变成了争吵') }, 4),
      ], { check: { attr: 'eq', target: 55 } }),
      c('b', '彼此冷静一段时间', [o('你们默契地减少了联系，偶尔想起时心里空了一块。', { attrs: { happiness: -2 }, npc: N(-3, '你们默契地疏远了') })]),
    ] },

  // ===================== 学习事件（扩充） =====================
  { id: 'library_seat', category: 'study', weight: 5, when: isStudent, title: '座位被占了', description: '你常坐的图书馆座位被占了，书包就放在桌上，人却不知道去了哪。',
    choices: [
      c('a', '换个位置坐下', [o('新位置靠窗，光线很好，你反而学得更专心了。', { attrs: { intelligence: 0.5, happiness: 0.5 }, knowledge: 2 })]),
      c('b', '礼貌地沟通', [o('对方红着脸收拾东西走了，你还帮他把落在桌上的笔递了过去。', { attrs: { eq: 1, happiness: 0.5 } })]),
    ] },
  { id: 'exam_week', category: 'study', weight: 8, cooldown: 90, when: isStudent, title: '考试周',
    description: '教学楼的灯亮到很晚，走廊里全是背书的声音。',
    choices: [
      c('a', '通宵复习', [o('你抱着咖啡撑到了天亮，第二天考试时头晕眼花，但知识点确实记住了。', { attrs: { intelligence: 3, health: -4 }, knowledge: 8 })]),
      c('b', '有节奏地复习', [o('你每天复习到十点就收工，考试时状态很好。', { attrs: { intelligence: 1.5, health: -1 }, knowledge: 5 })]),
    ] },
  { id: 'group_project', category: 'study', weight: 6, when: isStudent, npc: { relation: ['classmate', 'friend'] }, title: '小组作业',
    description: '小组作业分到了{npc}这一组，大家面面相觑，谁都不想先开口。',
    choices: [
      c('a', '主动承担大部分', [
        o('你熬了两个晚上把框架搭好，组员们终于跟上了。', { attrs: { intelligence: 2, health: -2 }, knowledge: 6, npc: N(4, '你在小组作业里承担了很多') }, 6),
        o('你一个人扛到崩溃，成果却并不理想。', { attrs: { happiness: -2 }, knowledge: 2, npc: N(-1, '小组作业不太顺利') }, 4),
      ], { check: { attr: 'intelligence', target: 50 } }),
      c('b', '按分工完成自己那份', [o('你按时交了作业，剩下的就交给命运吧。', { attrs: { happiness: 1 }, knowledge: 1 })]),
    ] },
  { id: 'teacher_praise', category: 'study', weight: 4, when: (s) => isStudent(s) && s.player.knowledge >= 40, title: '被点名表扬',
    description: '老师在课上翻了翻作业，抬头说：「这次的思路很漂亮。」',
    choices: [
      c('a', '谦虚地点头', [o('你课后去问了两个问题，老师讲得格外耐心。', { attrs: { intelligence: 1, happiness: 2 }, knowledge: 3 })]),
      c('b', '小小地得意一下', [o('你在同学的目光里挺直了腰，一整天心情都不错。', { attrs: { charm: 1, happiness: 2 } })]),
    ] },
  { id: 'note_lost', category: 'study', weight: 4, when: isStudent, title: '笔记落在教室', description: '回到宿舍才发现，记了一学期的笔记本还在教室抽屉里。',
    choices: [
      c('a', '回去找', [
        o('教室门没锁，笔记本还安静地躺在抽屉里。', { attrs: { happiness: 1 } }, 6),
        o('教室已经锁门了，你在门口站了一会儿，只好明天再说。', { attrs: { happiness: -1, eq: 0.5 } }, 4),
      ]),
      c('b', '重新整理一遍', [o('你凭记忆重新梳理了一遍，反而理清了不少脉络。', { attrs: { intelligence: 1, health: -1 }, knowledge: 2 })]),
    ] },
  { id: 'debate_club', category: 'study', weight: 4, when: isStudent, title: '辩论社招新', description: '社团招新的横幅挂到了教学楼门口，报名表上已经写了好几行名字。',
    choices: [
      c('a', '报名试试', [o('第一次上台时手在抖，但把话说完的那一刻，全场鼓起掌来。', { attrs: { eq: 2, charm: 1, happiness: 2 } })]),
      c('b', '在旁边看看', [o('你听完一场表演赛，回去后查了半晚上的资料。', { attrs: { intelligence: 0.5 }, knowledge: 2 })]),
    ] },
  { id: 'language_exam', category: 'study', weight: 4, cooldown: 200, when: (s) => (s.player.skills.language ?? 0) >= 30, title: '外语等级考试',
    description: '外语等级考试开始报名了，考试费不便宜，但证书很有分量。',
    choices: [
      c('a', '报名参加', [
        o('你发挥得不错，拿到成绩单时手都在抖。', { attrs: { intelligence: 2, happiness: 3, eq: 1 }, knowledge: 8 }, 6),
        o('差了几分没通过，你决定下次再来。', { attrs: { happiness: -2 }, knowledge: 3 }, 4),
      ], { check: { attr: 'intelligence', target: 55 }, cost: 200 }),
      c('b', '再准备准备', [o('你给自己定了三个月的学习计划。', { attrs: { intelligence: 0.5 }, knowledge: 2 })]),
    ] },
  { id: 'internship_ad', category: 'study', weight: 4, cooldown: 150, when: (s) => isStudent(s) && s.player.knowledge >= 50, title: '看到一份实习招聘',
    description: '公告栏上贴着一张实习招聘，要求不低，但写着一句「欢迎肯学的人」。',
    choices: [
      c('a', '投一份简历', [
        o('面试聊得很投机，你拿到了实习机会，第一次摸到了真实的工作。', { attrs: { eq: 2, happiness: 4, intelligence: 1 }, knowledge: 6 }, 6),
        o('简历石沉大海，你在宿舍里默默改了三遍。', { attrs: { happiness: -1, eq: 1 } }, 4),
      ], { check: { attr: 'charm', target: 50 } }),
      c('b', '先专注学业', [o('你把心思收回到课本上，基础确实更牢了。', { attrs: { intelligence: 1 }, knowledge: 3 })]),
    ] },

  // ===================== 工作事件（扩充） =====================
  { id: 'first_day', category: 'work', weight: 6, once: true, when: (s) => hasJob(s) && s.player.workDays <= 2, title: '入职第一天',
    description: '工位、门禁卡、一张还没写名字的工牌。你深吸一口气。',
    choices: [
      c('a', '主动和大家打招呼', [o('同事们比想象中友善，有人带你熟悉了茶水间在哪。', { attrs: { eq: 1, charm: 1, happiness: 2 } })]),
      c('b', '先埋头把自己那摊事弄明白', [o('你把文档看完，虽然没怎么说话，但心里踏实了。', { attrs: { intelligence: 0.5, eq: 0.5 }, knowledge: 2 })]),
    ] },
  { id: 'deadline_crunch', category: 'work', weight: 7, when: isEmployed, title: '项目赶工',
    description: '明天就是截止日，进度表上的红色区域还有一大块没填满。',
    choices: [
      c('a', '留下来加班到深夜', [o('你在最后一刻提交了版本，拿到了一笔加班费，回家时地铁已经停运。', { attrs: { health: -3, happiness: -1 }, knowledge: 3, money: 150 })]),
      c('b', '按时下班，明天再说', [o('你关了电脑走人，晚上睡得很好，明天的事明天再面对。', { attrs: { health: 1, happiness: 1 } })]),
    ] },
  { id: 'boss_praise', category: 'work', weight: 5, when: (s) => isEmployed(s) && s.player.performance >= 70, title: '当众表扬',
    description: '例会上，领导点了你的名字：「这个月大家都该学学TA。」',
    choices: [
      c('a', '谦虚地把功劳分给团队', [o('同事们看你的眼神温和了不少。', { attrs: { eq: 1, happiness: 2 } })]),
      c('b', '顺势提一提加薪', [
        o('领导愣了一下，说「我考虑考虑」，第二周你的工资条变了。', { attrs: { happiness: 3 }, money: 800 }, 6),
        o('领导笑着把话题岔开，会议室里安静了几秒。', { attrs: { happiness: -2 } }, 4),
      ], { check: { attr: 'charm', target: 60 } }),
    ] },
  { id: 'client_complaint', category: 'work', weight: 5, when: isEmployed, title: '客户投诉',
    description: '电话那头的声音越来越大：「这件事到底谁来负责？」',
    choices: [
      c('a', '耐心处理到底', [
        o('你把问题一步步拆解清楚，对方最后说了句「谢谢你」。', { attrs: { eq: 2, happiness: 1 }, knowledge: 2 }, 6),
        o('对方不依不饶，挂掉电话后你在楼梯间坐了很久。', { attrs: { happiness: -3, health: -1 } }, 4),
      ], { check: { attr: 'eq', target: 55 } }),
      c('b', '向上汇报，交给主管', [o('主管接手后事情很快解决了，你有点不好意思。', { attrs: { happiness: -1, eq: 0.5 } })]),
    ] },
  { id: 'salary_delay', category: 'work', weight: 4, cooldown: 120, when: isEmployed, title: '工资延迟发放',
    description: '发薪日过了两天，工资还没到账，群里已经有人在小声议论。',
    choices: [
      c('a', '找人事问清楚', [o('人事说是银行系统问题，第二天就到账了，你松了口气。', { attrs: { eq: 1, happiness: 1 } })]),
      c('b', '再等等看', [o('又过了三天才到账，那几天你连外卖都不敢点。', { attrs: { happiness: -2 } })]),
    ] },
  { id: 'poach_offer', category: 'work', weight: 3, cooldown: 200, when: (s) => isEmployed(s) && s.player.knowledge >= 80, title: '猎头的电话',
    description: '一个陌生号码打来：「方便聊聊吗？我们这边有个更合适你的位置。」',
    choices: [
      c('a', '去聊聊看', [
        o('对方开出的条件很诱人，你动了心，也更有底气了。', { attrs: { happiness: 3 }, money: 1000 }, 6),
        o('聊完发现对方画的饼太大，你客气地结束了通话。', { attrs: { happiness: -1, eq: 1 } }, 4),
      ], { check: { attr: 'charm', target: 55 } }),
      c('b', '婉拒，现在挺好', [o('你挂了电话，看着窗外的城市，忽然觉得踏实。', { attrs: { happiness: 1 } })]),
    ] },
  { id: 'team_building', category: 'work', weight: 5, when: isEmployed, title: '部门团建',
    description: '群里通知：这周六团建，地点在郊区的农家乐，AA。',
    choices: [
      c('a', '一起去', [o('你被拉着玩了一下午的游戏，和平时不太说话的同事也熟了起来。', { attrs: { charm: 1, eq: 1, happiness: 2 } })], { cost: 100 }),
      c('b', '找理由请假', [o('周末你在家睡到自然醒，周一听同事们聊团建时插不上话。', { attrs: { happiness: 1, health: 1 } })]),
    ] },
  { id: 'resignation_temptation', category: 'work', weight: 4, when: (s) => isEmployed(s) && s.player.attrs.happiness < 40, title: '想辞职的念头',
    description: '又一个加班到深夜的晚上，你盯着屏幕，忽然很想把工牌扔进抽屉。',
    choices: [
      c('a', '请几天假调整', [o('短暂离开之后，你重新找回了一点呼吸的空间。', { attrs: { health: 5, happiness: 5 } })], { cost: 500 }),
      c('b', '咬牙撑过去', [o('你告诉自己再坚持一下，但那股疲惫没有消失。', { attrs: { happiness: -2, health: -2 }, knowledge: 1 })]),
    ] },
  { id: 'side_hustle_gig', category: 'work', weight: 5, cooldown: 60, when: (s) => !isEmployed(s), title: '朋友介绍的临时活',
    description: '朋友发来消息：「有个临时的活儿，两天，给的钱还行，接不接？」',
    choices: [
      c('a', '接下来', [o('你忙了两天，累得够呛，但拿到钱的那一刻很踏实。', { attrs: { health: -2, eq: 1 }, money: 300 })]),
      c('b', '婉拒', [o('你回绝了，把时间留给了自己。', { attrs: { happiness: 1 } })]),
    ] },
  { id: 'interview_notes', category: 'work', weight: 4, when: (s) => !isEmployed(s), title: '翻看面试笔记',
    description: '整理抽屉时翻出了之前面试做的笔记，字迹密密麻麻。',
    choices: [
      c('a', '认真复盘一遍', [o('你把自己答得不好的问题重新想了一遍，心里有底多了。', { attrs: { intelligence: 1, eq: 0.5 }, knowledge: 2 })]),
      c('b', '合上本子，出门走走', [o('阳光很好，你绕着街区走了两圈，心情松快起来。', { attrs: { happiness: 2, health: 1 } })]),
    ] },

  // ===================== 随机事件（扩充） =====================
  { id: 'found_note', category: 'random', weight: 4, title: '旧书里的便条', description: '翻开一本二手书，一张手写便条掉了出来，上面写着别人的心事。',
    choices: [
      c('a', '夹回书里，收好', [o('你把便条夹回原页，觉得像是替陌生人保管了一段过去。', { attrs: { happiness: 2, intelligence: 0.5 } })]),
      c('b', '读完再放回去', [o('你读完了那段话，莫名被安慰到，也提醒自己好好生活。', { attrs: { happiness: 1.5, eq: 0.5 } })]),
    ] },
  { id: 'street_music', category: 'random', weight: 5, title: '街头的歌声', description: '地铁口的街头艺人正唱着一首老歌，围了一圈人。',
    choices: [
      c('a', '停下来听，打赏一点', [o('歌手冲你点头致意，你在人群里站了很久。', { attrs: { happiness: 3 } })], { cost: 20 }),
      c('b', '站着听完', [o('你听完一首才走，脚步都轻了。', { attrs: { happiness: 2 } })]),
    ] },
  { id: 'stray_dog', category: 'random', weight: 4, title: '跟着你的小狗', description: '一只脏兮兮的小狗从巷子里跑出来，跟在你身后走了两条街。',
    choices: [
      c('a', '给它买点吃的', [o('它狼吞虎咽吃完，还在你脚边蹭了蹭。', { attrs: { happiness: 2, eq: 0.5 } })], { cost: 15 }),
      c('b', '加快脚步离开', [o('你回头看了一眼，它蹲在原地望着你。', { attrs: { happiness: -1 } })]),
    ] },
  { id: 'cashback', category: 'random', weight: 4, title: '意外的返现', description: '外卖软件弹出通知：你的一笔订单可以返现。',
    choices: [
      c('a', '收下', [o('到账的金额不大，但白捡的快乐很实在。', { attrs: { happiness: 1 }, money: 30 })]),
      c('b', '顺手捐掉', [o('你把这点钱捐了出去，心里暖了一下。', { attrs: { happiness: 2, eq: 1 } })]),
    ] },
  { id: 'charity_box', category: 'random', weight: 4, title: '募捐箱', description: '商场门口的募捐箱旁贴着几张受助者的照片。',
    choices: [
      c('a', '捐一点', [o('工作人员对你说了声谢谢，你摆摆手走开了。', { attrs: { happiness: 2, eq: 1 } })], { cost: 100 }),
      c('b', '路过', [o('你脚步没停，但走远后回头看了一眼。', {})]),
    ] },
  { id: 'short_circuit', category: 'random', weight: 4, title: '跳闸', description: '插排冒出一股焦味，屋里瞬间黑了，跳闸了。',
    choices: [
      c('a', '换个新插排', [o('你摸黑换好插排，重新通电，只是损失了一个插排的钱。', { attrs: { happiness: -0.5 } })], { cost: 120 }),
      c('b', '找人来修', [o('师傅检查了半天，说是老线路的问题，账单比你想象的贵。', { attrs: { happiness: -1.5 } })], { cost: 200 }),
      c('c', '摸黑过一晚', [o('你点着手机手电筒洗漱完，早早就睡了。', { attrs: { health: -1, happiness: -1 } })]),
    ] },
  { id: 'new_year', category: 'random', weight: 8, cooldown: 300, when: (s) => { const d = dateParts(s.startISO, s.day); return d.m === 1 && d.d === 1; }, title: '元旦', description: '新年的第一天，窗外有人在放零星的烟花。',
    choices: [
      c('a', '写下今年的计划', [o('你把想做的事一条条列出来，写满了一整页。', { attrs: { happiness: 3, intelligence: 0.5 }, knowledge: 2 })]),
      c('b', '睡到自然醒', [o('难得的假期，你把手机调成静音，睡了个够。', { attrs: { health: 2, happiness: 2 } })]),
    ] },
  { id: 'spring_festival', category: 'random', weight: 8, cooldown: 300, when: (s) => dateParts(s.startISO, s.day).m === 2, title: '春节将至', description: '街上开始挂红灯笼，超市里循环播放着恭喜发财。',
    choices: [
      c('a', '买年货回家', [o('家里知道你要回来，提前几天就开始准备你爱吃的菜。', { attrs: { happiness: 5, eq: 1 }, npc: N(8, '春节你回家团聚了') })], { cost: 500 }),
      c('b', '今年留在城里', [o('你在出租屋里煮了顿好的，和家人视频时笑了很久。', { attrs: { happiness: 2, health: 1 } })], { cost: 100 }),
      c('c', '给家里打个电话', [o('电话里妈妈说「回来就好」，你笑着说下次一定。', { attrs: { happiness: 1, eq: 0.5 }, npc: N(3, '春节你给家里打了电话') })]),
    ] },
  { id: 'mid_autumn', category: 'random', weight: 6, cooldown: 300, when: (s) => dateParts(s.startISO, s.day).m === 9, title: '中秋', description: '月亮很圆，超市的月饼开始了最后一天的促销。',
    choices: [
      c('a', '给家里寄一盒月饼', [o('妈妈打来电话，说邻居都夸你懂事。', { attrs: { happiness: 3, eq: 0.5 }, npc: N(5, '中秋你寄了月饼回家') })], { cost: 200 }),
      c('b', '自己买一块尝尝', [o('你站在阳台上吃完了一整块月饼，月亮确实很圆。', { attrs: { happiness: 2 } })], { cost: 30 }),
      c('c', '抬头看看月亮', [o('你什么也没买，只是在楼下站了一会儿。月亮并不在乎有没有人看它。', { attrs: { happiness: 1, eq: 0.5 } })]),
    ] },
  { id: 'valentine', category: 'random', weight: 6, cooldown: 300, when: (s) => { const d = dateParts(s.startISO, s.day); return d.m === 2 && d.d === 14; }, title: '情人节', description: '花店门口排起了队，空气里都是玫瑰的味道。',
    choices: [
      c('a', '给在意的人准备礼物', [o('对方收到礼物时的表情，让你觉得钱花得值。', { attrs: { happiness: 3, charm: 1 }, npc: N(5, '情人节你送了礼物') })], { cost: 300 }),
      c('b', '给自己买束花', [o('你把花插在瓶子里，房间里一下有了生气。', { attrs: { happiness: 2 } })], { cost: 60 }),
      c('c', '在家看一部老电影', [o('屏幕里的爱情故事很老套，你还是看完了。', { attrs: { happiness: 1.5 } })]),
    ] },

  // ===================== 重大人生 / 事件链（扩充） =====================
  { id: 'first_salary', category: 'major', weight: 5, once: true, when: (s) => isEmployed(s) && s.player.workDays >= 1, title: '第一笔工资', description: '工资到账的短信弹了出来，金额不算多，但那是你自己挣的。',
    choices: [
      c('a', '请自己吃顿好的', [o('你点了平时舍不得点的菜，吃得格外香。', { attrs: { happiness: 4, health: 1 } })], { cost: 100 }),
      c('b', '一分不动先存着', [o('你看着余额，第一次对「以后」这两个字有了实感。', { attrs: { happiness: 2, intelligence: 0.5 } })]),
    ] },
  { id: 'moving_out', category: 'major', weight: 3, once: true, when: (s) => isEmployed(s) && s.player.workDays >= 30, title: '搬出去住',
    description: '你算了算账，发现自己或许可以负担一个属于自己的小房间了。',
    choices: [
      c('a', '租个单间搬出去', [o('房间很小，但一切都按你的意思摆放，你在第一晚失眠了。', { attrs: { happiness: 5, eq: 1 } })], { cost: 800 }),
      c('b', '再攒攒，先不搬', [o('你把这笔钱留在账上，心里更安稳。', { attrs: { happiness: 1 } })]),
    ] },
  { id: 'family_health', category: 'major', weight: 0, priority: true, cooldown: 300, when: (s) => s.day >= 200 && s.npcs.some((n) => n.relation === 'family' && n.met), npc: { relation: ['family'] }, title: '{npc}的身体',
    description: '电话里{npc}的声音有点虚，说只是小毛病，让你别担心。',
    choices: [
      c('a', '请假回去看看', [o('你陪着做了检查，确认没有大碍，才在返程的高铁上睡着。', { attrs: { happiness: -1, eq: 2 }, npc: N(10, '你专程回来陪TA做检查') })], { cost: 600 }),
      c('b', '只能在电话里多问几句', [o('挂了电话，你盯着天花板，很久没有睡着。', { attrs: { happiness: -3 }, npc: N(3, '你打了电话关心TA') })]),
    ] },
  { id: 'mentor_recommend', category: 'major', weight: 0, priority: true, once: true, when: (s) => happenedAtLeast(s, 'mentor_project', 20), title: '导师的推荐',
    description: '周教授发来消息：「有个机会，我想到你了。要不要试试？」',
    choices: [
      c('a', '把握这次机会', [
        o('你认真准备了很久，最终争取到了这个机会，履历上多了一行很有分量的字。', { attrs: { happiness: 4, eq: 2 }, knowledge: 8 }, 6),
        o('竞争对手都很强，你差了一点，但教授说「你还年轻」。', { attrs: { happiness: -1 }, knowledge: 3 }, 4),
      ], { check: { attr: 'intelligence', target: 60 } }),
      c('b', '先把手上的事做完', [o('你感谢了教授，决定等自己准备得更充分再谈机会。', { attrs: { intelligence: 1 }, knowledge: 3 })]),
    ] },
  { id: 'scholarship_followup', category: 'major', weight: 0, priority: true, once: true, when: (s) => happenedAtLeast(s, 'scholarship', 20), title: '奖学金的回音',
    description: '学院的名单公示了，你的名字出现在上面。',
    choices: [
      c('a', '去确认一下', [o('奖学金到账了，你请室友喝了奶茶。', { attrs: { happiness: 5 }, money: 1500 })]),
      c('b', '低调地当没看见', [o('你照常去上课，只是走路时脚步轻了些。', { attrs: { happiness: 3 } })]),
    ] },
  { id: 'scam_followup', category: 'major', weight: 0, priority: true, once: true, when: (s) => happenedBefore(s, 'scam_call'), title: '反诈中心的回访',
    description: '社区民警打来电话，提醒你最近冒充客服的诈骗很多。',
    choices: [
      c('a', '认真听完，记下要点', [o('你把要点转给了家里人，还顺手装上了国家反诈中心。', { attrs: { eq: 1, intelligence: 1 }, knowledge: 1 })]),
      c('b', '客气地挂了电话', [o('你说了声谢谢就挂断，继续忙自己的事。', { attrs: { happiness: 0.5 } })]),
    ] },
];

export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENT_DEFS.map((d) => [d.id, d]));

// ===================== 筛选与实例化 =====================
function npcCandidates(def: EventDef, s: GameState): NPC[] {
  if (!def.npc) return [];
  return s.npcs.filter(
    (n) => n.met && (!def.npc!.relation || def.npc!.relation.includes(n.relation)) && n.affinity >= (def.npc!.minAffinity ?? -100),
  );
}

export function isEligible(def: EventDef, s: GameState): boolean {
  const last = s.seenEvents[def.id];
  if (last !== undefined && (def.once || s.day - last < (def.cooldown ?? 12))) return false;
  if (def.when && !def.when(s)) return false;
  if (def.npc && npcCandidates(def, s).length === 0) return false;
  return true;
}

/** 将事件模板实例化为可序列化的 GameEvent（占位符替换为具体 NPC） */
export function instantiateEvent(def: EventDef, s: GameState, rng: RNG): GameEvent | null {
  let npc: NPC | undefined;
  if (def.npc) {
    const cands = npcCandidates(def, s);
    if (!cands.length) return null;
    npc = pick(cands, rng);
  }
  const body = JSON.stringify({ title: def.title, description: def.description, choices: def.choices });
  const filled = npc ? body.split('{npc}').join(npc.name).split('$npc').join(npc.id) : body;
  const parsed = JSON.parse(filled) as { title: string; description: string; choices: EventChoice[] };
  return {
    id: uid('ev'), defId: def.id, category: def.category, title: parsed.title, description: parsed.description,
    npcId: npc?.id, choices: parsed.choices, source: 'local', day: s.day,
  };
}
