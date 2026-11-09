export type ServiceConfigurationStatus = {
  configured: boolean;
  aiConfigured: boolean;
  lawConfigured: boolean;
};

export function configurationStatus(env: Readonly<Record<string, string | undefined>>): ServiceConfigurationStatus {
  const aiConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const lawConfigured = Boolean(env.LAW_OPEN_API_OC?.trim());
  return { configured: aiConfigured, aiConfigured, lawConfigured };
}
