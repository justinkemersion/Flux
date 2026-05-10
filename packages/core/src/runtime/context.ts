import type Docker from "dockerode";
import {
  FLUX_DOCKER_IMAGES,
  FLUX_NETWORK_NAME,
  POSTGRES_USER,
} from "../docker/docker-constants.ts";

export type FluxCoreContext = {
  docker: Docker;
  images: typeof FLUX_DOCKER_IMAGES;
  networkName: string;
  postgresUser: string;
};

export function createFluxCoreContext(docker: Docker): FluxCoreContext {
  return {
    docker,
    images: FLUX_DOCKER_IMAGES,
    networkName: FLUX_NETWORK_NAME,
    postgresUser: POSTGRES_USER,
  };
}
