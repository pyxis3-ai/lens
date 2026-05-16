import { z } from 'zod'

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3002),
  dbPath: z.string().default('/data/lens.db'),
  hostProc: z.string().default('/proc'),
  f2bLog: z.string().default('/host-var-log/fail2ban.log'),
  authLog: z.string().default('/host-var-log/auth.log'),
  nginxLabel: z.string().default('app=nginx-ingress'),
  nginxNamespace: z.string().default('nginx-ingress'),
  alertWebhook: z.string().default(''),
  autheliaNamespace: z.string().default('authelia'),
  autheliaLabel: z.string().default('app.kubernetes.io/component=authelia'),
  k8sApi: z.string().default('https://kubernetes.default.svc'),
  k8sWs: z.string().default('wss://kubernetes.default.svc'),
  k8sTokenPath: z.string().default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
  apiSecret: z.string().default(''),

  // Thresholds (compile-time constants but validated for type safety)
  crashLoopThreshold: z.number().int().positive().default(5),
  noLimitsThreshold: z.number().int().positive().default(5),
  certWarnDays: z.number().int().positive().default(14),
  certCritDays: z.number().int().positive().default(7),
  maxReplicas: z.number().int().positive().default(20),

  // Intervals (ms)
  systemInterval: z.number().int().positive().default(2000),
  podsInterval: z.number().int().positive().default(10000),
  healthInterval: z.number().int().positive().default(30000),
  attackStoreInterval: z.number().int().positive().default(15000),
  certCheckInterval: z.number().int().positive().default(300_000),
  alertHistoryMax: z.number().int().positive().default(200),
  tokenCacheTTL: z.number().int().positive().default(300_000),
  healthTimeout: z.number().int().positive().default(5000),
  webhookTimeout: z.number().int().positive().default(5000),
  nginxCacheTTL: z.number().int().positive().default(10000),
  cleanupInterval: z.number().int().positive().default(3600_000),

  // Retention
  attackRetentionDays: z.number().int().positive().default(30),
})

export type Config = z.infer<typeof ConfigSchema>

export const config: Config = ConfigSchema.parse({
  port: process.env.PORT,
  dbPath: process.env.DB_PATH,
  hostProc: process.env.HOST_PROC,
  f2bLog: process.env.F2B_LOG,
  authLog: process.env.AUTH_LOG,
  nginxLabel: process.env.NGINX_LABEL,
  nginxNamespace: process.env.NGINX_NAMESPACE,
  alertWebhook: process.env.ALERT_WEBHOOK,
  autheliaNamespace: process.env.AUTHELIA_NAMESPACE,
  autheliaLabel: process.env.AUTHELIA_LABEL,
  k8sApi: process.env.K8S_API,
  k8sWs: process.env.K8S_WS,
  k8sTokenPath: process.env.K8S_TOKEN_PATH,
  apiSecret: process.env.API_SECRET,
})
