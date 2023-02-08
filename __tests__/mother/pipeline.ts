import { Pipeline } from "../../src/client/vib/api"

export function valid(): Pipeline {
  return {
    phases: {
      package: {
        actions: [
          {
            action_id: 'helm-package',
            params: {
              resources: {
                url: 'https://github.com/bitnami/charts/tarball/d8a5f63aa65655f819bbd5d31f0be3c6c488e85c',
                path: 'bitnami/wordpress'
              }
            }
          }
        ]
      }
    }
  }
}