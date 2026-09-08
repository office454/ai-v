import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("ai-v-volume");
  const ai_v = service("ai v", {
    healthcheck: "/api/health",
    volumeMounts: {
      "/data": data,
    },
  });
  return project("ai v", {
    resources: [ai_v, data],
  });
});
