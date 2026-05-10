import type Docker from "dockerode";

export function getDockerEngineHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode?: number }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

/**
 * Disconnects all endpoints (survives stale attachments) then removes the network.
 * 404 if the network does not exist is treated as success.
 */
export async function removeDockerNetworkByNameAllowMissing(
  docker: Docker,
  networkName: string,
): Promise<void> {
  let inspect: { Containers?: Record<string, unknown> };
  try {
    inspect = (await docker.getNetwork(networkName).inspect()) as {
      Containers?: Record<string, unknown>;
    };
  } catch (err: unknown) {
    if (getDockerEngineHttpStatus(err) === 404) return;
    throw err;
  }
  const net = docker.getNetwork(networkName);
  for (const containerId of Object.keys(inspect.Containers ?? {})) {
    try {
      await net.disconnect({ Container: containerId, Force: true });
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) !== 404) throw err;
    }
  }
  try {
    await net.remove();
  } catch (err: unknown) {
    if (getDockerEngineHttpStatus(err) === 404) return;
    throw err;
  }
}

/**
 * Removes API + DB containers, the data volume, and the per-tenant private network when
 * `privateNetworkName` is set (404-safe). `onPurge` is called **before** each remove (resource name).
 */
export async function removeApiPgAndVolumeForProvision(
  docker: Docker,
  apiContainerName: string,
  pgContainerName: string,
  volumeName: string,
  privateNetworkName?: string,
  onPurge?: (resourceName: string) => void,
): Promise<void> {
  for (const name of [apiContainerName, pgContainerName]) {
    onPurge?.(name);
    try {
      await docker.getContainer(name).remove({ force: true });
    } catch (err: unknown) {
      if (getDockerEngineHttpStatus(err) !== 404) throw err;
    }
  }
  onPurge?.(volumeName);
  try {
    await docker.getVolume(volumeName).remove({ force: true });
  } catch (err: unknown) {
    if (getDockerEngineHttpStatus(err) !== 404) throw err;
  }
  if (privateNetworkName && privateNetworkName.length > 0) {
    onPurge?.(privateNetworkName);
    await removeDockerNetworkByNameAllowMissing(docker, privateNetworkName);
  }
}
