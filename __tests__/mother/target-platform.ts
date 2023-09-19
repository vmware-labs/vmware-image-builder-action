import { TargetPlatform, TargetPlatformArchitecture, TargetPlatformKind, TargetPlatformProvider } from "../../src/client/vib/api"

export function gke(): TargetPlatform {
  return {
    architecture: TargetPlatformArchitecture.Amd64,
    id: '91d398a2-25c4-4cda-8732-75a3cfc179a1',
    name: 'GKE Kubernetes v1.24.x',
    kind: TargetPlatformKind.Gke,
    default_version: '1.27',
    supported_versions: ["1.27"],
    provider: TargetPlatformProvider.Gcp
  }
}