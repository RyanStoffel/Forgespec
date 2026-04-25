import { PartLike } from "./wattage";

export type Issue = {
  severity: "warning" | "error";
  message: string;
};

function psuWattage(psu: PartLike | null | undefined): number {
  if (!psu) return 0;
  const fromSpec = Number(psu.specs?.wattage ?? 0);
  if (fromSpec > 0) return fromSpec;
  const m = psu.name?.match(/(\d{3,4})\s*W/i);
  return m ? Number(m[1]) : 0;
}

export function checkCompatibility(
  parts: Record<string, PartLike | null | undefined>,
  totalW: number
): Issue[] {
  const out: Issue[] = [];

  // PSU adequacy
  const psu = parts["power-supply"];
  if (psu) {
    const psuW = psuWattage(psu);
    if (psuW > 0 && psuW < totalW * 1.2) {
      out.push({
        severity: "warning",
        message: `PSU is ${psuW}W; build draws ~${totalW}W. Recommend ≥${Math.ceil(
          totalW * 1.2
        )}W (20% headroom).`,
      });
    }
  } else if (totalW > 100) {
    out.push({ severity: "warning", message: "No power supply selected." });
  }

  // RAM ↔ Mobo memory type
  const ram = parts.memory;
  const mobo = parts.motherboard;
  if (ram?.specs?.memoryType && mobo?.specs?.memoryType) {
    if (ram.specs.memoryType !== mobo.specs.memoryType) {
      out.push({
        severity: "error",
        message: `RAM is ${ram.specs.memoryType} but motherboard supports ${mobo.specs.memoryType}.`,
      });
    }
  }

  // CPU socket ↔ Mobo socket
  const cpu = parts.cpu;
  if (cpu?.specs?.socket && mobo?.specs?.socket) {
    if (cpu.specs.socket !== mobo.specs.socket) {
      out.push({
        severity: "error",
        message: `CPU socket ${cpu.specs.socket} doesn't match motherboard ${mobo.specs.socket}.`,
      });
    }
  }

  return out;
}

export type CompatStatus = "ok" | "warn" | "error";

export function statusFor(issues: Issue[]): CompatStatus {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.length > 0) return "warn";
  return "ok";
}
