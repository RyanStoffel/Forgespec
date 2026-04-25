export interface PartLike {
  partType?: string;
  name?: string;
  specs?: any;
}

const TDP_REGEX_TABLE: Array<[RegExp, number]> = [
  [/i9-?14|i9-?13|i9-?12|9950X|9900X|9700X/i, 170],
  [/i7-?14|i7-?13|i7-?12|7800X3D|7700X|7700|7800/i, 105],
  [/i5|7600X|5600X|7600/i, 65],
  [/i3|5500|5600G/i, 65],
  [/RTX\s*40?9|RTX\s*40?8|7900\s*XTX|7900\s*XT/i, 380],
  [/RTX\s*40?7|RTX\s*30?9|RTX\s*30?8/i, 280],
  [/RTX\s*40?6|RTX\s*30?7|RTX\s*30?6/i, 200],
  [/RTX\s*40?5|RTX\s*30?5|RX\s*7600|RX\s*6600/i, 130],
  [/GTX\s*16|GTX\s*10/i, 100],
];

const DEFAULTS: Record<string, number> = {
  cpu: 95,
  gpu: 200,
  "video-card": 200,
  motherboard: 30,
  memory: 10,
  "internal-hard-drive": 8,
  "external-hard-drive": 8,
  ssd: 5,
  "case-fan": 3,
  "cpu-cooler": 5,
  monitor: 0,
  case: 0,
  "power-supply": 0,
  os: 0,
  headphones: 0,
  speakers: 5,
  keyboard: 1,
  mouse: 1,
  webcam: 1,
};

export function tdpFor(part: PartLike | null | undefined): number {
  if (!part) return 0;
  const name = part.name ?? "";
  for (const [re, w] of TDP_REGEX_TABLE) {
    if (re.test(name)) return w;
  }
  return DEFAULTS[part.partType ?? ""] ?? 0;
}

export function totalWattage(parts: Array<PartLike | null | undefined>): number {
  return parts.reduce<number>((sum, p) => sum + tdpFor(p), 0);
}
