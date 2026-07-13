import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

const FacilityState = z.enum(['崭新', '整洁', '良好', '忙乱', '肮脏', '破损', '停用', '升级中']);
const FarmState = z.enum(['空畦', '已播种', '发芽', '生长期', '待收获', '受损', '枯萎']);
const BrewState = z.enum(['空桶', '发酵中', '陈酿中', '待开桶', '已开桶', '污染', '失败']);
const MatchJudgement = z.enum(['灾难级', '严重冲突', '轻微冲突', '无冲突', '经典搭配', '绝佳搭配', '奇迹']);

const StatBar = z.object({
  当前值: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  上限: z.coerce.number().transform(value => Math.max(1, Math.floor(value))),
});

const StorageItem = z.object({
  数量: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  标签: z.array(z.string()),
  价格折合铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
});

const CookedItem = StorageItem.extend({
  搭配判定: MatchJudgement,
});

const MoneyBucket = z.object({
  铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  银币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  金币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  铂金币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  秘银币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  折算合计铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
});

const TavernReputation = z.object({
  数值: z.coerce.number().transform(value => _.clamp(Math.floor(value), 0, 9999)),
  阶段: z.coerce.number().transform(value => _.clamp(Math.floor(value), 1, 5)),
  名称: z.enum(['无人知晓', '略有耳闻', '小有名气', '远近闻名', '声名远扬']),
  乘数: z.coerce.number().transform(value => Math.max(0, Number(value) || 0)),
  范围: z.string(),
});

const ClockTime = z.preprocess(value => {
  const text = String(value ?? '').trim();
  const match = text.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!match) return '';
  const hour = Math.max(0, Math.min(23, Math.floor(Number(match[1]) || 0)));
  const minute = Math.max(0, Math.min(59, Math.floor(Number(match[2]) || 0)));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}, z.string().regex(/^\d{2}:\d{2}$/));

const InventoryBucket = z.object({
  食材: z.record(z.string().describe('食材名'), StorageItem).prefault({}),
  调料: z.record(z.string().describe('调料名'), StorageItem).prefault({}),
  成品: z.record(z.string().describe('成品名'), CookedItem).prefault({}),
  酒水: z.record(z.string().describe('酒水名'), CookedItem).prefault({}),
  杂物: z.record(z.string().describe('杂物名'), StorageItem).prefault({}),
});

const TemporaryState = z.object({
  名称: z.string(),
  剩余回合: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
  描述: z.string(),
  来源物品: z.string().prefault(''),
});

const Facility = z.object({
  状态: FacilityState,
  风格: z.string(),
  描述: z.string(),
  价格折合铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
});

export const Schema = z.object({
  世界: z.object({
    时代: z.string(),
    地区: z.string(),
    当前历法: z.object({
      年: z.coerce.number(),
      月份序号: z.coerce.number().transform(value => _.clamp(Math.floor(value), 1, 12)),
      月份名: z.enum(['冰封月', '残雪月', '解冻月', '花萌月', '绿涨月', '长日月', '炎阳月', '收获月', '金叶月', '落穗月', '霜降月', '暗夜月']),
      季节: z.enum(['隆冬', '冬末', '初春', '仲春', '暮春', '初夏', '盛夏', '暮夏', '初秋', '仲秋', '暮秋', '初冬']),
      日: z.coerce.number(),
      天气: z.string(),
      时间: ClockTime,
    }),
    当前地点: z.object({
      区域: z.string(),
      具体位置: z.string(),
    }),
  }),
  酒馆: z.object({
    名称: z.string(),
    所属领地: z.string(),
    所在城市: z.string(),
    声望: TavernReputation,
    声望值: z.coerce.number().transform(value => _.clamp(Math.floor(value), 0, 9999)),
    声望名: z.enum(['无人知晓', '略有耳闻', '小有名气', '远近闻名', '声名远扬']),
    资金: z.object({
      随身钱袋: MoneyBucket,
      钱匣: MoneyBucket,
      铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      银币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      金币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      铂金币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      秘银币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      折算合计铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
    }),
    今日营业状态: z.string(),
    整体概况: z.string().prefault(''),
    区域: z.record(z.string().describe('区域名'), z.object({
      状态: FacilityState,
      风格: z.string(),
      描述: z.string(),
      分配员工: z.string(),
      设施: z.record(z.string().describe('设施名'), Facility).prefault({}),
    })).prefault({}),
    客房: z.record(z.string().describe('房间名'), z.object({
      所属区域: z.string(),
      类型: z.string(),
      住客: z.string(),
      价格折合铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      舒适: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      私密: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      清洁: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      设施: z.record(z.string().describe('房间设施名'), Facility).prefault({}),
    })).prefault({}),
  }),
  主角: z.object({
    姓名: z.string(),
    种族: z.string(),
    称号: z.string(),
    当前状态: z.string(),
    所在位置: z.string(),
    一句话穿着: z.string(),
    生命: StatBar,
    精力: StatBar,
    烹饪等级: z.object({
      等级: z.coerce.number().transform(value => _.clamp(Math.floor(value), 1, 8)),
      称号: z.string(),
      做菜次数: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      下级所需次数: z.coerce.number().transform(value => Math.max(1, Math.floor(value))),
    }),
  }),
  库房: z.object({
    食材: z.record(z.string().describe('食材名'), StorageItem).prefault({}),
    调料: z.record(z.string().describe('调料名'), StorageItem).prefault({}),
    成品: z.record(z.string().describe('成品名'), CookedItem).prefault({}),
    酒水: z.record(z.string().describe('酒水名'), CookedItem).prefault({}),
    杂物: z.record(z.string().describe('杂物名'), StorageItem).prefault({}),
  }),
  行囊: InventoryBucket.prefault({ 食材: {}, 调料: {}, 成品: {}, 酒水: {}, 杂物: {} }),
  临时状态: z.object({
    主角: z.array(TemporaryState).prefault([]),
    酒馆: z.array(TemporaryState).prefault([]),
    酒馆区域: z.record(z.string().describe('区域名'), z.array(TemporaryState)).prefault({}),
    人物: z.record(z.string().describe('人物名'), z.array(TemporaryState)).prefault({}),
  }).prefault({ 主角: [], 酒馆: [], 酒馆区域: {}, 人物: {} }),
  人物羁绊: z.record(z.string().describe('配角名'), z.object({
    种族: z.string(),
    身份: z.string(),
    羁绊阶段: z.coerce.number().transform(value => _.clamp(Math.floor(value), 1, 8)),
    阶段文字: z.string(),
    好感: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
    心情: z.string(),
    所在位置: z.string(),
    一句话穿着: z.string(),
    生命: StatBar,
    精力: StatBar,
    膀胱: StatBar,
    个人资金: MoneyBucket,
    收入: z.object({
      职业: z.string(),
      日收入折合铜币: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      结算方式: z.string(),
      备注: z.string(),
    }),
    备注: z.string(),
  })).prefault({}),
  农田与酒窖: z.object({
    农田: z.record(z.string().describe('田畦名'), z.object({
      状态: FarmState,
      作物: z.string(),
      阶段: z.coerce.number().transform(value => Math.max(0, Math.floor(value))),
      阶段上限: z.coerce.number().transform(value => Math.max(1, Math.floor(value))),
      播种日: z.union([z.string(), z.coerce.number()]),
      成熟日: z.union([z.string(), z.coerce.number()]),
      预计产出: z.string(),
      批次标签: z.array(z.string()),
    })).prefault({}),
    酒窖桶: z.record(z.string().describe('酒桶名'), z.object({
      状态: BrewState,
      内容物: z.string(),
      类型: z.string(),
      酿造开始日: z.union([z.string(), z.coerce.number()]),
      收获日: z.union([z.string(), z.coerce.number()]),
      预计产出: z.string(),
    })).prefault({}),
  }),
  街坊商铺: z.object({
    当前商铺: z.string(),
  }),
});

registerMvuSchema(Schema);
