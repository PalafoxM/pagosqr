const { expo } = require("./app.json");

module.exports = ({ config }) => {
  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    process.env.EAS_PROJECT_ID ||
    config?.extra?.eas?.projectId ||
    expo?.extra?.eas?.projectId;

  // Detectamos si estamos generando la versión de desarrollo
  const isDevelopment =
    process.env.APP_VARIANT === "development";

  const nextConfig = {
    ...expo,
    ...config,

    // Nombre de la aplicación
    name: isDevelopment
      ? `${expo.name} DEV`
      : expo.name,

    // iOS
    ios: {
      ...(expo.ios || {}),
      ...(config.ios || {}),

      bundleIdentifier: isDevelopment
        ? "com.agustinmarin.pagosfic.dev"
        : "com.agustinmarin.pagosfic",
    },

    // Android
    android: {
      ...(expo.android || {}),
      ...(config.android || {}),

      package: isDevelopment
        ? "com.agustinmarin.pagosfic.dev"
        : "com.agustinmarin.pagosfic",

      // Firebase diferente para DEV y producción
      googleServicesFile: isDevelopment
        ? "./google-services.dev.json"
        : "./google-services.json",
    },

    extra: {
      ...(expo.extra || {}),
      ...(config.extra || {}),
    },
  };

  // Conservamos el Project ID de EAS
  if (projectId) {
    nextConfig.extra.eas = {
      ...(expo.extra?.eas || {}),
      ...(config.extra?.eas || {}),
      projectId,
    };
  }

  return nextConfig;
};