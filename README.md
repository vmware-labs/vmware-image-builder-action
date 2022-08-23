# VMware Image Builder

## Overview

This GitHub Action allows to interact with the VMware Image Builder (VIB) service from VMware. VIB is a SaaS product that can be used by Independent Software Vendors (ISV) to Package, Verify and Publish their software products. These products can be packaged in different formats like for example [Carvel Packages](https://carvel.dev), [Helm Charts](https://helm.sh) or [Open Virtual Appliances](https://docs.vmware.com/en/VMware-vSphere/7.0/com.vmware.vsphere.vm_admin.doc/GUID-AE61948B-C2EE-436E-BAFB-3C7209088552.html) (OVA). 

VIB supports verification in multiple Kubernetes distributions and flavours, like for example TKG, GKE, AKS, EKS, IKS and OpenShift, and also does support vSphere for OVAs. In addition to functional verification, VIB does offer compliance verification with support for static analyis and some popular tools like Trivy or Grype for vulnerability scanning. For publishing software, OCI registries are supported. 

[VMware Image Builder Helps Verify Customized, Secure Software for Any Platform on Any Cloud](https://tanzu.vmware.com/content/blog/vmware-image-builder-verifies-customized-secure-software) is a good introductory article about how Carto, one of our partners is using VIB for verifying their Helm Chart from their own Supply Chain.

## Requirements

Before using this GitHub Action you need to have a valid API Token. Valid tokens can be obtained by [signing up](https://console.cloud.vmware.com) to VMware Cloud Services and following these instructions.

Once you have a valid api token you will need to set that **API token as a repository secret**. Your workflow then needs to make that secret available as an environment variable to the GitHub Action.

## Usage

Once you have a valid token exposed as secret, ten using the GitHub Action is very simple. Here below you can find what would be a totally valid GitHub workflow that is using this action:

```yaml
name: 'vib'
on:
  pull_request
env:
  CSP_API_URL: https://console.cloud.vmware.com
  CSP_API_TOKEN: ${{ secrets.CSP_API_TOKEN }}
  VIB_PUBLIC_URL: https://cp.bromelia.vmware.com
jobs:
  validation:
    name: Validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: vmware-labs/vmware-image-builder-action@main
```

### Action Input Parameters

The above line is using the GitHub Action default input parameters. You can customize those parameters if you need to, and in fact, this will be pretty common when you have multiple pipelines that need to be sent to VIB:

| Attribute              | Description                                                                                                                                         | Default value        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| config                 | This is the default folder where the action can find the configuration files for the different tasks that will be executed as part of the pipeline. | .vib                 |
| backoff-intervals      | This is the default backoff time used between each retry in case of failure reaching out to VIB.                                                    | [5000, 10000, 15000] |
| only-upload-on-failure | This parameter sets whether the GitHub Actions should upload artifacts for every task or only for those tasks that have failed.                     | true                 |
| pipeline               | This is the default JSON file that contains the VIB pipeline that will be executed.                                                                 | vib-pipeline.json    |
| retry-count            | This is the default number of retries to do in case of failure reaching out to VIB.                                                                 | 3                    |
| upload-artifacts       | This parameter specifies whether the GitHub Action will publish logs and reports as GitHub artifacts.                                               | true                 |
| http-timeout           | This is the default number of seconds the GitHub Action waits for an HTTP timeout before failing.                                                   | 30000                |

With that in mind, you can customize your action as follows:

```yaml
    steps:
      - uses: actions/checkout@v2
      - uses: vmware-labs/vmware-image-builder-action@main
        with:
          config: redis-chart-tests
          pipeline: vib-platform-verify.json
```

## Templating your pipelines via environment variables

Pipelines can be templated via environment variables to allow further customization. Any environment variable that your workflow defines with the `VIB_ENV_` prefix will be substituted by the GitHub Action in the pipeline file before being sent to VIB. Furthermore, the GitHub Action will make this substitution independently of whether you are using the `VIB_ENV_` prefix in your pipeline or not.

For example, if you had the following step:

```yaml
    steps:
      - uses: vmware-labs/vmware-image-builder-action@main
        env:
          VIB_ENV_PATH: /bitnami/redis
```

and part of your pipeline looks like:

```json
{
  "phases": {
    "package": {
      "context": {
        "resources": {
          "path": "{PATH}"
        }
      }
    }
  }
}
```

The GitHub Action will find the `{PATH}` template variable and will substitute it with the value from the `VIB_ENV_PATH` environment variable resulting in the following snipped being used when sending the pipeline to VIB:

```json
{
  "phases": {
    "package": {
      "context": {
        "resources": {
          "path": "/bitnami/redis"
        }
      }
    }
  }
}
```

`VIB_ENV` variable substitution can be a powerful mechanism to make your workloads more flexible and to reuse pipelines.

## Special variables

There are a number of special variables that can be used as shortcuts. Here we will keep a list of those

* `{SHA_ARCHIVE}`: Points to the HEAD of the change that has triggered the workflow, either from the main branch or a pull request.

## Contributing

The vmware-image-builder-action project team welcomes contributions from the community. Before you start working with vmware-image-builder-action, please
read our [Developer Certificate of Origin](https://cla.vmware.com/dco). All contributions to this repository must be
signed as described on that page. Your signature certifies that you wrote the patch or have the right to pass it on
as an open-source patch. For more detailed information, refer to [CONTRIBUTING.md](CONTRIBUTING.md).

## License

VMware Image Builder Action
Copyright 2021 VMware, Inc.

The BSD-2 license (the "License") set forth below applies to all parts of the VMware Image Builder Examples project. You may not use this file except in compliance with the License.

BSD-2 License

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
