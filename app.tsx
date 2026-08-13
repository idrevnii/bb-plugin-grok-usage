import { definePluginApp } from "@bb/plugin-sdk/app";
import { startUsageLimitsInjection } from "./inject";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "usage-limits-card",
    mount({ pluginId, signal }) {
      return startUsageLimitsInjection(pluginId, signal);
    },
  });
});
