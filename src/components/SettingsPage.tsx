import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClawKitBootstrapStatus, OpenClawCliStatus } from "../types/app";
import type {
  AppearanceSettings,
  ClawKitSettings,
  ClawKitSettingsPatch,
  GeneralSettings,
  NotificationSettings,
} from "../types/settings";
import type { GatewayConfigGetResult } from "../types/gateway";
import {
  isOpenClawCliBelowRecommended,
  MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD,
  openClawCliMeetsMinimum,
  RECOMMENDED_OPENCLAW_CLI_VERSION,
} from "../lib/openClawVersion";

type SettingsSection = "general" | "appearance" | "notifications" | "openclaw";

type Choice<T extends string> = {
  value: T;
  label: string;
};

type SettingsPageProps = {
  settings: ClawKitSettings;
  loading: boolean;
  error: string | null;
  t: (key: string) => string;
  patchSettings: (patch: ClawKitSettingsPatch) => Promise<ClawKitSettings>;
  gatewayConnected: boolean;
  gatewayStatusText: string;
  bootstrapStatus: ClawKitBootstrapStatus | null;
  openClawCliStatus: OpenClawCliStatus | null;
  actionBusy: boolean;
  actionMessage: string | null;
  onRefreshOpenClaw: () => void;
  onReconnectGateway: () => void;
  onToggleGateway: () => void;
  onRepairBinding: () => void;
  onInstallOpenClaw: () => void;
  onUpdateOpenClaw: () => void;
  onNavigate: (nav: "models" | "connections") => void;
  patchOpenClawConfig: (patch: unknown) => Promise<void>;
};

const sections: Array<{ key: SettingsSection; labelKey: string; descriptionKey: string }> = [
  { key: "general", labelKey: "settings.section.general", descriptionKey: "settings.section.general.description" },
  { key: "appearance", labelKey: "settings.section.appearance", descriptionKey: "settings.section.appearance.description" },
  { key: "notifications", labelKey: "settings.section.notifications", descriptionKey: "settings.section.notifications.description" },
  { key: "openclaw", labelKey: "settings.section.openclaw", descriptionKey: "settings.section.openclaw.description" },
];

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <label className="switch-control">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span />
      </label>
    </div>
  );
}

function SegmentedRow<T extends string>({
  title,
  description,
  value,
  choices,
  disabled,
  onChange,
}: {
  title: string;
  description?: string;
  value: T;
  choices: Array<Choice<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="segmented-control" role="group" aria-label={title}>
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.value}
            className={choice.value === value ? "active" : ""}
            disabled={disabled}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectRow<T extends string>({
  title,
  description,
  value,
  choices,
  disabled,
  onChange,
}: {
  title: string;
  description?: string;
  value: T;
  choices: Array<Choice<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <select
        className="settings-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {choices.map((choice) => (
          <option value={choice.value} key={choice.value}>{choice.label}</option>
        ))}
      </select>
    </div>
  );
}

function NumberRow({
  title,
  description,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  title: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settings-number-control">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>px</span>
      </div>
    </div>
  );
}

function readAllowUploadedArchives(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const skills = (config as Record<string, unknown>).skills;
  if (!skills || typeof skills !== "object") return false;
  const install = (skills as Record<string, unknown>).install;
  if (!install || typeof install !== "object") return false;
  return (install as Record<string, unknown>).allowUploadedArchives === true;
}

function ReadOnlyRow({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {hint ? <p>{hint}</p> : null}
      </div>
      <code className="settings-readonly-value">{value}</code>
    </div>
  );
}

export function SettingsPage({
  settings,
  loading,
  error,
  t,
  patchSettings,
  gatewayConnected,
  gatewayStatusText,
  bootstrapStatus,
  openClawCliStatus,
  actionBusy,
  actionMessage,
  onRefreshOpenClaw,
  onReconnectGateway,
  onToggleGateway,
  onRepairBinding,
  onInstallOpenClaw,
  onUpdateOpenClaw,
  onNavigate,
  patchOpenClawConfig,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [allowUploadedArchives, setAllowUploadedArchives] = useState(false);
  const [allowUploadedArchivesLoaded, setAllowUploadedArchivesLoaded] = useState(false);
  const [skillsConfigError, setSkillsConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (activeSection !== "openclaw" || !gatewayConnected) return;
    let cancelled = false;
    setSkillsConfigError(null);
    if (!openClawCliMeetsMinimum(openClawCliStatus?.installedVersion, MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)) {
      setAllowUploadedArchives(false);
      setAllowUploadedArchivesLoaded(true);
      return;
    }
    void (async () => {
      try {
        const result = await invoke<GatewayConfigGetResult>("gateway_config_get");
        if (cancelled) return;
        setAllowUploadedArchives(readAllowUploadedArchives(result.config));
        setAllowUploadedArchivesLoaded(true);
      } catch {
        if (!cancelled) setAllowUploadedArchivesLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSection, gatewayConnected, openClawCliStatus?.installedVersion]);

  const savePatch = async (key: string, patch: ClawKitSettingsPatch) => {
    setSavingKey(key);
    setLocalError(null);
    try {
      await patchSettings(patch);
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingKey(null);
    }
  };

  const disabled = loading || Boolean(savingKey);
  const installedCliVersion = openClawCliStatus?.installedVersion?.trim() ?? "";
  const skillZipUploadSupported = openClawCliMeetsMinimum(openClawCliStatus?.installedVersion, MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD);
  const openclawInstalled = bootstrapStatus?.openclawInstalled ?? false;
  const bindingConfigured = bootstrapStatus?.bindingConfigured ?? false;
  const showOpenClawInstall = !openclawInstalled;
  const showOpenClawUpdate = openclawInstalled && Boolean(openClawCliStatus?.updateAvailable);
  const showGatewayReconnect = openclawInstalled && bindingConfigured;
  const showGatewayToggle = openclawInstalled && bindingConfigured;
  const showRepairBinding = openclawInstalled && !bindingConfigured;
  const updateGeneral = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) =>
    void savePatch(`general.${String(key)}`, { general: { [key]: value } });
  const updateAppearance = <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) =>
    void savePatch(`appearance.${String(key)}`, { appearance: { [key]: value } });
  const updateNotifications = <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) =>
    void savePatch(`notifications.${String(key)}`, { notifications: { [key]: value } });
  const activeSectionMeta = sections.find((section) => section.key === activeSection) ?? sections[0];

  const handleAllowUploadedArchivesChange = async (checked: boolean) => {
    if (!openClawCliMeetsMinimum(openClawCliStatus?.installedVersion, MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)) {
      return;
    }
    setSkillsConfigError(null);
    try {
      await patchOpenClawConfig({ skills: { install: { allowUploadedArchives: checked } } });
      setAllowUploadedArchives(checked);
    } catch (err) {
      setSkillsConfigError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="single-page settings-page">
      {error || localError ? <div className="settings-error" role="alert">{localError ?? error}</div> : null}

      <div className="settings-layout">
        <nav className="settings-section-list" aria-label={t("settings.sectionGroups")}>
          {sections.map((section) => (
            <button
              type="button"
              key={section.key}
              className={activeSection === section.key ? "active" : ""}
              onClick={() => setActiveSection(section.key)}
            >
              <strong>{t(section.labelKey)}</strong>
              <span>{t(section.descriptionKey)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          <div className="settings-section-heading">
            <h2>{t(activeSectionMeta.labelKey)}</h2>
            {loading ? <span className="inline-page-status">{t("settings.loading")}</span> : null}
          </div>
          {activeSection === "general" ? (
            <>
              <SegmentedRow
                title={t("settings.general.defaultMode")}
                description={t("settings.general.defaultMode.description")}
                value={settings.general.defaultConversationMode}
                choices={[
                  { value: "focus", label: t("settings.option.focus") },
                  { value: "conversation", label: t("settings.option.conversation") },
                ]}
                disabled={disabled}
                onChange={(value) => updateGeneral("defaultConversationMode", value)}
              />
              <SelectRow
                title={t("settings.general.language")}
                description={t("settings.general.language.description")}
                value={settings.general.language}
                choices={[
                  { value: "auto", label: t("settings.option.auto") },
                  { value: "zh-CN", label: t("settings.option.zhCN") },
                  { value: "zh-TW", label: t("settings.option.zhTW") },
                  { value: "en-US", label: t("settings.option.enUS") },
                  { value: "ja-JP", label: t("settings.option.jaJP") },
                  { value: "fr-FR", label: t("settings.option.frFR") },
                  { value: "ru-RU", label: t("settings.option.ruRU") },
                ]}
                disabled={disabled}
                onChange={(value) => updateGeneral("language", value)}
              />
              <SegmentedRow
                title={t("settings.general.sendShortcut")}
                value={settings.general.sendShortcut}
                choices={[
                  { value: "enterToSend", label: t("settings.option.enter") },
                  { value: "modEnterToSend", label: t("settings.option.modEnter") },
                ]}
                disabled={disabled}
                onChange={(value) => updateGeneral("sendShortcut", value)}
              />
              <ToggleRow
                title={t("settings.general.restoreLastConversation")}
                checked={settings.general.restoreLastConversation}
                disabled={disabled}
                onChange={(value) => updateGeneral("restoreLastConversation", value)}
              />
              <ToggleRow
                title={t("settings.general.rememberFilters")}
                checked={settings.general.rememberConversationFilters}
                disabled={disabled}
                onChange={(value) => updateGeneral("rememberConversationFilters", value)}
              />
              <ToggleRow
                title={t("settings.general.autoCheck")}
                description={t("settings.general.autoCheck.description")}
                checked={settings.general.autoCheckUpdates}
                disabled={disabled}
                onChange={(value) => updateGeneral("autoCheckUpdates", value)}
              />
              <ToggleRow
                title={t("settings.general.confirmDestructive")}
                description={t("settings.general.confirmDestructive.description")}
                checked={settings.general.confirmDestructiveActions}
                disabled={disabled}
                onChange={(value) => updateGeneral("confirmDestructiveActions", value)}
              />
            </>
          ) : null}

          {activeSection === "appearance" ? (
            <>
              <SegmentedRow
                title={t("settings.appearance.theme")}
                value={settings.appearance.theme}
                choices={[
                  { value: "light", label: t("settings.option.light") },
                  { value: "dark", label: t("settings.option.dark") },
                  { value: "system", label: t("settings.option.system") },
                ]}
                disabled={disabled}
                onChange={(value) => updateAppearance("theme", value)}
              />
              <NumberRow
                title={t("settings.appearance.fontSize")}
                description={t("settings.appearance.fontSize.description")}
                value={settings.appearance.fontSize}
                min={12}
                max={20}
                disabled={disabled}
                onChange={(value) => updateAppearance("fontSize", value)}
              />
              <SegmentedRow
                title={t("settings.appearance.density")}
                value={settings.appearance.density}
                choices={[
                  { value: "comfortable", label: t("settings.option.comfortable") },
                  { value: "compact", label: t("settings.option.compact") },
                ]}
                disabled={disabled}
                onChange={(value) => updateAppearance("density", value)}
              />
              <ToggleRow
                title={t("settings.appearance.codeWrap")}
                checked={settings.appearance.codeWrap}
                disabled={disabled}
                onChange={(value) => updateAppearance("codeWrap", value)}
              />
              <SegmentedRow
                title={t("settings.appearance.messageWidth")}
                value={settings.appearance.messageWidth}
                choices={[
                  { value: "normal", label: t("settings.option.normal") },
                  { value: "wide", label: t("settings.option.wide") },
                ]}
                disabled={disabled}
                onChange={(value) => updateAppearance("messageWidth", value)}
              />
            </>
          ) : null}

          {activeSection === "notifications" ? (
            <>
              <ToggleRow
                title={t("settings.notifications.finished")}
                checked={settings.notifications.conversationFinished}
                disabled={disabled}
                onChange={(value) => updateNotifications("conversationFinished", value)}
              />
              <ToggleRow
                title={t("settings.notifications.onlyUnfocused")}
                checked={settings.notifications.onlyWhenUnfocused}
                disabled={disabled}
                onChange={(value) => updateNotifications("onlyWhenUnfocused", value)}
              />
              <ToggleRow
                title={t("settings.notifications.success")}
                checked={settings.notifications.notifyOnSuccess}
                disabled={disabled}
                onChange={(value) => updateNotifications("notifyOnSuccess", value)}
              />
              <ToggleRow
                title={t("settings.notifications.failure")}
                checked={settings.notifications.notifyOnFailure}
                disabled={disabled}
                onChange={(value) => updateNotifications("notifyOnFailure", value)}
              />
              <ToggleRow
                title={t("settings.notifications.summary")}
                checked={settings.notifications.includeReplySummary}
                disabled={disabled}
                onChange={(value) => updateNotifications("includeReplySummary", value)}
              />
              <ToggleRow
                title={t("settings.notifications.privacy")}
                description={t("settings.notifications.privacy.description")}
                checked={settings.notifications.privacyMode}
                disabled={disabled}
                onChange={(value) => updateNotifications("privacyMode", value)}
              />
            </>
          ) : null}

          {activeSection === "openclaw" ? (
            <>
              <ReadOnlyRow title={t("settings.openclaw.gatewayStatus")} value={gatewayConnected ? t("settings.openclaw.connected") : t("settings.openclaw.disconnected")} hint={gatewayStatusText} />
              <ReadOnlyRow title={t("settings.openclaw.cli")} value={openClawCliStatus?.path ?? t("settings.openclaw.cliMissing")} hint={openClawCliStatus?.installedVersion ?? t("settings.openclaw.versionUnknown")} />
              {openClawCliStatus?.installedVersion && isOpenClawCliBelowRecommended(openClawCliStatus.installedVersion) ? (
                <div className="settings-callout-upgrade" role="status">
                  {t("settings.openclaw.recommendedVersionHint")
                    .replace("{{current}}", openClawCliStatus.installedVersion)
                    .replace("{{recommended}}", RECOMMENDED_OPENCLAW_CLI_VERSION)}
                </div>
              ) : null}
              <ReadOnlyRow title={t("settings.openclaw.config")} value={bootstrapStatus?.configPath ?? t("settings.openclaw.waiting")} />
              <ReadOnlyRow title={t("settings.openclaw.clawkitSettings")} value="~/.clawkit/clawkit.json" />
              <div className="settings-action-row">
                <button className="ghost-button" type="button" onClick={onRefreshOpenClaw} disabled={actionBusy}>
                  {t("settings.openclaw.refresh")}
                </button>
                {showGatewayReconnect ? (
                  <button className="ghost-button" type="button" onClick={onReconnectGateway} disabled={actionBusy}>
                    {t("settings.openclaw.reconnect")}
                  </button>
                ) : null}
                {showGatewayToggle ? (
                  <button className="ghost-button" type="button" onClick={onToggleGateway} disabled={actionBusy}>
                    {gatewayConnected ? t("settings.openclaw.stopGateway") : t("settings.openclaw.startGateway")}
                  </button>
                ) : null}
                {showRepairBinding ? (
                  <button className="ghost-button" type="button" onClick={onRepairBinding} disabled={actionBusy}>
                    {t("settings.openclaw.repairBinding")}
                  </button>
                ) : null}
                {showOpenClawInstall ? (
                  <button className="ghost-button" type="button" onClick={onInstallOpenClaw} disabled={actionBusy}>
                    {t("settings.openclaw.install")}
                  </button>
                ) : null}
                {showOpenClawUpdate ? (
                  <button className="ghost-button" type="button" onClick={onUpdateOpenClaw} disabled={actionBusy}>
                    {t("settings.openclaw.update")}
                  </button>
                ) : null}
              </div>
              {actionBusy ? <div className="inline-page-status">{t("settings.openclaw.busy")}</div> : null}
              {actionMessage ? <div className="settings-note">{actionMessage}</div> : null}
              <ToggleRow
                title={t("settings.openclaw.autoStart")}
                description={t("settings.openclaw.autoStart.description")}
                checked={settings.openclaw.autoStartGateway}
                disabled={disabled}
                onChange={(value) => void savePatch("openclaw.autoStartGateway", { openclaw: { autoStartGateway: value } })}
              />
              {!skillZipUploadSupported ? (
                <div className="settings-callout-upgrade" role="status">
                  {t("settings.openclaw.allowUploadedArchives.requiresOpenClaw")
                    .replace("{{min}}", MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)
                    .replace("{{current}}", installedCliVersion || t("settings.openclaw.versionUnknown"))}
                </div>
              ) : null}
              <ToggleRow
                title={t("settings.openclaw.allowUploadedArchives")}
                description={
                  skillZipUploadSupported
                    ? t("settings.openclaw.allowUploadedArchives.description")
                    : t("settings.openclaw.allowUploadedArchives.upgradeShort")
                }
                checked={skillZipUploadSupported && allowUploadedArchives}
                disabled={disabled || !gatewayConnected || !allowUploadedArchivesLoaded || !skillZipUploadSupported}
                onChange={(value) => void handleAllowUploadedArchivesChange(value)}
              />
              {skillsConfigError ? <div className="settings-note" role="alert">{skillsConfigError}</div> : null}
              <div className="settings-note">
                {t("settings.openclaw.note")}
                <div className="settings-inline-actions">
                  <button type="button" className="tiny-button" onClick={() => onNavigate("models")}>{t("nav.models")}</button>
                  <button type="button" className="tiny-button" onClick={() => onNavigate("connections")}>{t("nav.connections")}</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
