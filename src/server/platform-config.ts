import type { WebConfig } from './parallel.js';
import type { SetupStatus } from '../shared/types.js';
export interface PlatformConfig extends WebConfig {
  intelligenceKey?: string;
  intelligenceApiUrl?: string;
  intelligenceWsUrl?: string;
  model?: string;
  apiKey?: string;
  baseUrl: string;
  computerSupervisorUrl?: string;
  computerSupervisorToken?: string;
  computerToken?: string;
  computerNamespace?: string;
  browserUrl?: string;
  browserSecret?: string;
  ttsUrl?: string;
  voiceCallMinutes?: number;
  opencodeUrl?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  opencodeModel?: string;
  opencodeTimeoutMs?: number;
  slackChannel?: string;
  slackTeam?: string;
  slackUsers: string[];
  slackDotId?: string;
  runtimeUrl: string;
  ownerToken?: string;
}
export function setupStatus(
  config: PlatformConfig,
  slack = 'not_configured',
  activationFailed = false,
): SetupStatus {
  const missing = [
    !config.intelligenceKey && 'INTELLIGENCE_API_KEY',
    !config.apiKey && 'OPENAI_API_KEY',
    !config.model && 'OPENAI_MODEL',
  ].filter((item): item is string => !!item);
  const declaredSlack = !!(
    config.slackChannel &&
    config.slackTeam &&
    config.slackUsers.length
  );
  slack = declaredSlack
    ? activationFailed && slack !== 'online'
      ? 'activation_failed'
      : slack
    : config.slackChannel || config.slackTeam || config.slackUsers.length
      ? 'setup_required'
      : 'not_configured';
  return {
    intelligence: !!config.intelligenceKey,
    model: !!(config.apiKey && config.model),
    browser: !!(config.browserUrl && config.browserSecret),
    voice: !!(config.ttsUrl && !missing.length),
    opencode: opencodeConfigured(config),
    slack,
    missing,
  };
}
export function opencodeConfigured(config: PlatformConfig) {
  return !!(config.opencodeUrl && config.opencodePassword);
}
// OpenCode tasks can take minutes; give agent turns room to wait for them.
export function turnTimeoutMs(config: PlatformConfig) {
  return opencodeConfigured(config)
    ? Math.max(90_000, (config.opencodeTimeoutMs ?? 600_000) + 30_000)
    : 90_000;
}
