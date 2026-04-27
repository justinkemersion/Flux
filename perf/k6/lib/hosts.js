const DEFAULT_HOST = "myapp-a1b2c3d.flux.localhost";

export function fixedHost() {
  const host = __ENV.HOST || DEFAULT_HOST;
  return () => host;
}

export function hotTenantHost() {
  const hotHost = __ENV.HOT_HOST || DEFAULT_HOST;
  const others = (__ENV.OTHER_HOSTS || "a.flux.localhost,b.flux.localhost")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return () => {
    if (Math.random() < 0.8 || others.length === 0) return hotHost;
    return others[Math.floor(Math.random() * others.length)];
  };
}

export function randomHost() {
  const suffix = __ENV.RANDOM_HOST_SUFFIX || "flux.localhost";
  return () => `rand-${Math.random().toString(36).slice(2)}.${suffix}`;
}
