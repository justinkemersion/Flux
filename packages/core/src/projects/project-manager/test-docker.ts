import {
  assertFluxDockerEngineReachableOrThrow,
  createFluxDocker,
  formatDockerEngineTarget,
} from "../../docker/docker-client.ts";

export async function testDockerConnection(): Promise<void> {
  const docker = createFluxDocker();

  console.log(`▸ Targeting Docker Engine: ${formatDockerEngineTarget(docker)}`);
  console.log("🔄 Attempting to connect to Docker Engine...");

  try {
    await assertFluxDockerEngineReachableOrThrow(docker);
    const ping = await docker.ping();
    console.log("✅ Docker Connection: SUCCESS");
    console.log(`📡 Ping Response: ${ping.toString()}`);

    // Added { all: true } so we can see the hello-world container
    const containers = await docker.listContainers({ all: true });

    console.log(`📦 Found ${containers.length} total containers:`);

    if (containers.length === 0) {
      console.log(
        "ℹ️  No containers found. Try running 'docker run hello-world' in another terminal.",
      );
    }

    for (const c of containers) {
      const name = c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
      const status = c.State; // running, exited, etc.
      console.log(`   - [${status.toUpperCase()}] ${name} (Image: ${c.Image})`);
    }
  } catch (err) {
    console.error("❌ Docker Connection: FAILED");
    console.error(err);
    process.exit(1);
  }
}
