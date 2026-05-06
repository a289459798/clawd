export type ChannelCredentialStatusValue = "available" | "configured_unavailable" | "missing";

/** Subset of Gateway channel account snapshot fields used for readiness hints (safe / projected fields). */
export type ChannelAccountCredentialInput = {
  configured?: boolean;
  lastError?: string | null;
  tokenSource?: string;
  botTokenSource?: string;
  appTokenSource?: string;
  signingSecretSource?: string;
  tokenStatus?: ChannelCredentialStatusValue;
  botTokenStatus?: ChannelCredentialStatusValue;
  appTokenStatus?: ChannelCredentialStatusValue;
  signingSecretStatus?: ChannelCredentialStatusValue;
  userTokenStatus?: ChannelCredentialStatusValue;
  statusState?: string;
};

export type ChannelAccountReadiness = {
  /** SecretRef / runtime resolution: declared in config but not usable now */
  secretResolution: string[];
  /** Required credential slots still missing while account appears configured */
  credentialGaps: string[];
  /** Heuristic: plugin packaging / manifest / channelConfigs contract issues */
  pluginContract?: string;
};

const CREDENTIAL_STATUS_FIELDS: Array<{
  field: keyof Pick<
    ChannelAccountCredentialInput,
    "tokenStatus" | "botTokenStatus" | "appTokenStatus" | "signingSecretStatus" | "userTokenStatus"
  >;
  label: string;
}> = [
  { field: "tokenStatus", label: "Token" },
  { field: "botTokenStatus", label: "Bot Token" },
  { field: "appTokenStatus", label: "App Token" },
  { field: "signingSecretStatus", label: "Signing Secret" },
  { field: "userTokenStatus", label: "User Token" },
];

export function inferPluginContractIssueFromLastError(lastError?: string | null): string | undefined {
  const raw = typeof lastError === "string" ? lastError.trim() : "";
  if (!raw) return undefined;

  if (/channelconfigs/i.test(raw)) {
    return "插件清单缺少该通道所需的 channelConfigs 契约，或插件版本与当前配置形态不匹配。可尝试升级/重装通道插件并运行 openclaw doctor --fix。";
  }

  if (/unsupportedsecretref|unsupported\s+secret\s*ref|secretref.*unsupported/i.test(raw)) {
    return "配置中的 SecretRef 引用形态不被该插件支持。请对照插件文档改用受支持的密钥引用方式，或升级插件。";
  }

  if (/manifest|plugin\s+manifest|missing\s+manifest|invalid\s+manifest/i.test(raw)) {
    return "插件包清单缺失或损坏（manifest / 打包不完整）。建议按官方指引强制重装对应插件。";
  }

  if (/contract\s+api|doctor-contract|contract-api/i.test(raw)) {
    return "通道契约接口异常（contract surface）。通常为插件安装不完整或版本不匹配，建议重装插件。";
  }

  return undefined;
}

export function buildChannelAccountReadiness(account: ChannelAccountCredentialInput): ChannelAccountReadiness {
  const secretResolution: string[] = [];
  const credentialGaps: string[] = [];

  for (const { field, label } of CREDENTIAL_STATUS_FIELDS) {
    const status = account[field];
    if (!status) continue;

    if (status === "configured_unavailable") {
      secretResolution.push(
        `${label}：配置已指向密钥位置（含 SecretRef），但当前 Gateway 运行时无法解析为可用值。请检查 OpenClaw 密钥存储、路径权限与环境变量，必要时在本机终端运行 openclaw doctor --fix。`,
      );
    } else if (status === "missing" && account.configured === true) {
      credentialGaps.push(
        `${label}：通道标记为已配置，但该凭证仍处于缺失状态。请补齐配置文件字段或对应环境变量。`,
      );
    }
  }

  const pluginContract = inferPluginContractIssueFromLastError(account.lastError);

  return {
    secretResolution,
    credentialGaps,
    pluginContract,
  };
}

export function readinessHasSignals(readiness: ChannelAccountReadiness): boolean {
  return (
    readiness.secretResolution.length > 0 ||
    readiness.credentialGaps.length > 0 ||
    Boolean(readiness.pluginContract)
  );
}
