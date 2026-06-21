const { expo } = require("./app.json");

module.exports = ({ config }) => {
  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    process.env.EAS_PROJECT_ID ||
    config?.extra?.eas?.projectId ||
    expo?.extra?.eas?.projectId;

  const nextConfig = {
    ...expo,
    ...config,
    extra: {
      ...(expo.extra || {}),
      ...(config.extra || {}),
    },
  };

  if (projectId) {
    nextConfig.extra.eas = {
      ...(expo.extra?.eas || {}),
      ...(config.extra?.eas || {}),
      projectId,
    };
  }

  return nextConfig;
};
