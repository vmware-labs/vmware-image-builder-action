// eslint-disable-next-line filenames/match-regex
import * as core from "@actions/core"
import * as path from "path"
import {
  createExecutionGraph,
  displayErrorExecutionGraph,
  getArtifactName,
  getExecutionGraph,
  getExecutionGraphReport,
  getLogsFolder,
  getRawLogs,
  getRawReports,
  loadRawLogsAndRawReports,
  loadTargetPlatforms,
  prettifyExecutionGraphResult,
  readPipeline,
  reset,
  runAction,
  substituteEnvVariables,
  validatePipeline,
} from "../src/main"
import fs from "fs"
import validator from "validator"
import ConfigurationFactory from "../src/config"

const root = path.join(__dirname, ".")
let fixedExecutionGraphId
let fixedTaskId
const tkgPlatformId = "7ddab896-2e4e-4d58-a501-f79897eba3a0"

const STARTING_ENV = process.env

describe("VIB", () => {
  beforeAll(async () => {
    // mock all output so that there is less noise when running tests
    jest.spyOn(core, "warning").mockImplementation(() => {})
    jest.spyOn(core, "error").mockImplementation(() => {})
    jest.spyOn(core, "setFailed")
  })

  beforeEach(async () => {
    jest.resetModules()
    process.env = { ...STARTING_ENV }

    // Needed to delete these for running tests on GitHub Action
    delete process.env["GITHUB_EVENT_PATH"]
    delete process.env["GITHUB_SHA"]
    delete process.env["GITHUB_REPOSITORY"]

    process.env["GITHUB_WORKSPACE"] = root // expect all test content under _tests_
    core.info(`Set base folder to ${root}`)
    reset()
  })

  afterEach(async () => {
    jest.clearAllMocks()
    if (fixedExecutionGraphId !== undefined) {
      let logsFolder
      try {
        // Remove resources and logs if exist
        logsFolder = getLogsFolder(fixedExecutionGraphId)
        if (fs.existsSync(logsFolder)) {
          fs.rmSync(logsFolder, { recursive: true })
        }
      } catch (err) {
        console.log(`Could not remove logs folder ${logsFolder}. Error: ${err}`)
      }
    }
  })

  describe("With the actual production system prove that", () => {
    // TODO: Add all the failure scenarios. Trying to get an execution graph that does not exist, no public url defined, etc.
    it("Runs the GitHub action and succeeds", async () => {
      const executionGraph = await runAction()
      fixedExecutionGraphId = executionGraph["execution_graph_id"]
      for (const task of executionGraph["tasks"]) {
        if (task["action_id"] === "trivy") {
          fixedTaskId = task["task_id"]
        }
      }
      //TODO: can also test the number of loops done is bigger than one, perhaps with a callback or exposing state

      expect(executionGraph).toBeDefined()
      expect(executionGraph["status"]).toEqual("SUCCEEDED")
    }, 1200000) // long test, processing this execution graph ( lint, trivy ) might take up to 2 minutes.

    it("Runs the GitHub action and fails because of a timeout", async () => {
      process.env["INPUT_MAX-PIPELINE-DURATION"] = "1"
      process.env["INPUT_EXECUTION-GRAPH-CHECK-INTERVAL"] = "1"
      const executionGraph = await runAction()
      expect(core.setFailed).toHaveBeenCalledTimes(1)
      expect(core.setFailed).toHaveBeenCalledWith(
        `Pipeline ${executionGraph["execution_graph_id"]} timed out. Ending GitHub Action.`
      )
    }, 1200000)
  })

  describe("With unit tests prove that", () => {
    it("Reads a pipeline from filesystem and has some content", async () => {
      const config = await new ConfigurationFactory(root).getConfiguration()

      const pipeline = await readPipeline(config)

      expect(pipeline).toBeDefined()
      expect(pipeline).not.toEqual("")
    })

    it("Reads a pipeline from a customized location other than default and has some content", async () => {
      process.env["INPUT_CONFIG"] = ".vib-other"
      process.env["INPUT_PIPELINE"] = "vib-pipeline-other.json"
      const config = await new ConfigurationFactory(root).getConfiguration()

      const pipeline = await readPipeline(config)

      expect(pipeline).toBeDefined()
      expect(pipeline).not.toEqual("")
    })

    it("Reads a pipeline and does not template sha archive if not needed", async () => {
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()

      const pipeline = await readPipeline(config)

      expect(pipeline).toBeDefined()
      expect(pipeline).not.toContain(config.shaArchive)
    })

    it("Reads a pipeline and does not template sha archive if not needed", async () => {
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()

      const pipeline = await readPipeline(config)

      expect(pipeline).toBeDefined()
      expect(pipeline).not.toContain(config.shaArchive)
    })

    it("Reads a pipeline and templates sha archive if needed", async () => {
      process.env.INPUT_PIPELINE = "vib-sha-archive.json"
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()

      const pipeline = await readPipeline(config)

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.package?.context?.resources?.url).toEqual(config.shaArchive)
    })

    it("Reads a pipeline and fails if cannot template sha archive when needed", async () => {
      process.env.INPUT_PIPELINE = "vib-sha-archive.json"
      const config = await new ConfigurationFactory(root).getConfiguration()

      await readPipeline(config)

      expect(core.setFailed).toHaveBeenCalledWith(
        "Pipeline vib-sha-archive.json expects {SHA_ARCHIVE} but the matching VIB_ENV_ template variable was not found in environment."
      )
    })
    //TODO: Move these URLs to constant defaults and change tests to verify default is used when no env variable exists
    //      Using defaults is more resilient and friendlier than forcing users to define env vars.

    it("Create pipeline returns an execution graph", async () => {
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)

      expect(executionGraphId).toBeDefined()
      expect(validator.isUUID(executionGraphId)).toBeTruthy()
    })

    // TODO: Add all pipeline failure test cases, e.g. pipeline does not exist, pipeline is wrongly formatted, ..

    it("Gets an execution graph", async () => {
      const executionGraph = await getExecutionGraph(fixedExecutionGraphId)
      expect(executionGraph).toBeDefined()
      //TODO: With Swagger and OpenAPI create object definitions and then we should have typed objects here
      expect(executionGraph["execution_graph_id"]).toEqual(fixedExecutionGraphId)
      expect(executionGraph["status"]).toEqual("SUCCEEDED")
    })

    it("Get execution graph that does not exist", async () => {
      const undefinedExecutionGraphId = "aaaaaaaa-f74c-4901-8e00-0dbed62f1031"
      expect(getExecutionGraph(undefinedExecutionGraphId)).rejects.toThrow(
        new Error(`Execution graph ${undefinedExecutionGraphId} not found!`)
      )
    })

    it("Reads a pipeline and validates its functionality", async () => {
      const config = await new ConfigurationFactory(root).getConfiguration()
      const pipeline = await readPipeline(config)
      await validatePipeline(pipeline)
      expect(core.setFailed).toHaveBeenCalledTimes(0)
    }, 160000)

    it("Reads a pipeline and fails if it is not functional", async () => {
      process.env["INPUT_PIPELINE"] = "disfunctional-pipeline.json"
      const config = await new ConfigurationFactory(root).getConfiguration()
      const pipeline = await readPipeline(config)
      await expect(validatePipeline(pipeline)).rejects.toThrow(
        new Error("Field: phases.verify.actions[0]. Error: Action ID action123@latest not found.")
      )
    })

    it("Fetches execution graph logs", async () => {
      const logFile = await getRawLogs(fixedExecutionGraphId, "linter-packaging", fixedTaskId)
      expect(logFile).not.toBeNull()
      if (logFile) {
        expect(logFile).toBeDefined()
        expect(fs.existsSync(logFile)).toBeTruthy()
      }
    })

    it("Fetches multiple execution graph logs", async () => {
      process.env.INPUT_ONLY_UPLOAD_ON_FAILURE = "false"

      const executionGraph = await getExecutionGraph(fixedExecutionGraphId)
      await loadRawLogsAndRawReports(executionGraph)

      // This fixed execution graph has two actions, linter-packaging and trivy
      // assert that logs folder has two files
      const logs = fs.readdirSync(getLogsFolder(fixedExecutionGraphId))

      expect(logs.length).toEqual(4)
      for (const task of executionGraph["tasks"]) {
        expect(logs.indexOf(`${task["action_id"]}-${task["task_id"]}.log`)).not.toEqual(-1)
      }
    }, 300000)

    it("Fetches a raw report", async () => {
      const reportFiles = await getRawReports(fixedExecutionGraphId, "linter-packaging", fixedTaskId)
      expect(reportFiles).toBeDefined()
      expect(reportFiles.length).toBeGreaterThanOrEqual(0)
    }, 300000)

    it("Fetches an execution graph result", async () => {
      const executionGraphReport = await getExecutionGraphReport(fixedExecutionGraphId)
      expect(executionGraphReport).toBeDefined()
      if (executionGraphReport) {
        expect(executionGraphReport["passed"]).toBeDefined()
        expect(executionGraphReport["actions"].length).toEqual(1)
        expect(executionGraphReport["actions"][0]["action_id"]).toEqual("trivy")
      }
    })

    it("Fetches platforms", async () => {
      const targetPlatforms = await loadTargetPlatforms()
      expect(targetPlatforms).toBeDefined()
      if (targetPlatforms) {
        expect(targetPlatforms[tkgPlatformId].kind).toBe("TKG")
      }
    })

    it("Artifact uses job name if no target platform is found", async () => {
      process.env.GITHUB_JOB = "test-job"
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = getArtifactName(config, executionGraphId)
      expect(artifactName.startsWith("assets-test-job")).toBeTruthy()
    })

    it("Artifact uses job name if target platform does not exist", async () => {
      process.env.GITHUB_JOB = "test-job"
      process.env.TARGET_PLATFORM = "this_one_does_not_exist"
      await loadTargetPlatforms()
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = await getArtifactName(config, executionGraphId)
      expect(artifactName.startsWith("assets-test-job")).toBeTruthy()
    })

    it("Artifact uses target platform in name when exists", async () => {
      process.env.GITHUB_JOB = "test-job"
      process.env.TARGET_PLATFORM = tkgPlatformId
      const targetPlatforms = await loadTargetPlatforms()
      const tkgPlatform = targetPlatforms ? targetPlatforms[tkgPlatformId] : "meh"
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = getArtifactName(config, executionGraphId)
      expect(artifactName).toBe(
        `assets-${process.env.GITHUB_JOB}-${tkgPlatform["kind"]}-${executionGraphId.slice(0, 8)}`
      )
    })

    it("Artifact uses target platform from vib_env in name when exists", async () => {
      process.env.GITHUB_JOB = "test-job"
      process.env.VIB_ENV_TARGET_PLATFORM = tkgPlatformId
      process.env.TARGET_PLATFORM = "meh" // must be overruled by the above
      const targetPlatforms = await loadTargetPlatforms()
      const tkgPlatform = targetPlatforms ? targetPlatforms[tkgPlatformId] : "meh"
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = getArtifactName(config, executionGraphId)
      expect(artifactName).toBe(
        `assets-${process.env.GITHUB_JOB}-${tkgPlatform["kind"]}-${executionGraphId.slice(0, 8)}`
      )
    })

    it("Artifact uses github run attempt if it exists", async () => {
      process.env.GITHUB_JOB = "test-job"
      process.env.TARGET_PLATFORM = "this_one_does_not_exist"
      process.env.GITHUB_RUN_ATTEMPT = "2"
      await loadTargetPlatforms()
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = getArtifactName(config, executionGraphId)
      expect(artifactName).toBe(`assets-test-job_2-${executionGraphId.slice(0, 8)}`)
    })

    it("Artifact uses github run attempt if it exists even when target platform exists", async () => {
      process.env.GITHUB_JOB = "test-job"
      process.env.TARGET_PLATFORM = tkgPlatformId
      process.env.GITHUB_RUN_ATTEMPT = "2"
      await loadTargetPlatforms()
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = getArtifactName(config, executionGraphId)
      expect(artifactName).toBe(`assets-test-job-TKG_2-${executionGraphId.slice(0, 8)}`)
    })

    it("Artifact uses github run attempt if it exists only when greater than 1", async () => {
      process.env.GITHUB_JOB = "test-job"
      process.env.TARGET_PLATFORM = "this_one_does_not_exist"
      process.env.GITHUB_RUN_ATTEMPT = "1"
      await loadTargetPlatforms()
      const config = await new ConfigurationFactory(root).getConfiguration()
      const executionGraphId = await createExecutionGraph(await readPipeline(config), config)
      const artifactName = getArtifactName(config, executionGraphId)
      expect(artifactName).toBe(`assets-test-job-${executionGraphId.slice(0, 8)}`)
    })

    it("Replaces environment variables with VIB_ENV_ prefix", async () => {
      // Clean warnings by setting these vars
      process.env.GITHUB_EVENT_PATH = path.join(root, "github-event-path.json")
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        {
          "phases": {
            "package": {
              "context": {
                "resources": {
                  "url": "{VIB_ENV_URL}",
                  "path": "{VIB_ENV_PATH}"
                }
              }
            }
          }        
        }
      `
      process.env.VIB_ENV_URL = "https://www.github.com/bitnami/charts"
      process.env.VIB_ENV_PATH = "/bitnami/wordpress"

      pipeline = substituteEnvVariables(config, pipeline)
      core.debug(`New pipeline: ${pipeline}`)
      expect(pipeline).toBeDefined()
      expect(pipeline).toContain(process.env.VIB_ENV_URL)
      expect(pipeline).toContain(process.env.VIB_ENV_PATH)
      // verify no warnings. This plays helps trusting below tests too
      expect(core.warning).toHaveBeenCalledTimes(1)
    })

    it("Don't replace environment variables with {{", async () => {
      // Clean warnings by setting these vars
      process.env.GITHUB_EVENT_PATH = path.join(root, "github-event-path.json")
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        {
          "phases": {
            "package": {
              "actions": [
                {
                  "action_id": "ginkgo",
                  "params": {
                    "resources": {
                      "path": "/.vib/metallb/ginkgo"
        
                    },
                    "params": {
                      "kubeconfig": "{{kubeconfig}}",
                      "namespace": "{{namespace}}"
                    }
                  }
                }
              ]
            }
          }
        }
      `

      pipeline = substituteEnvVariables(config, pipeline)
      expect(pipeline).toBeDefined()
      expect(pipeline).toContain("{{kubeconfig}}")
      expect(pipeline).toContain("{{namespace}}")
      // verify no warnings. This plays helps trusting below tests too
      expect(core.warning).toHaveBeenCalledTimes(1)
    })

    it("Warns of VIB_ENV_ template variables in environment that are not found", async () => {
      // Clean warnings by setting these vars
      process.env.GITHUB_EVENT_PATH = path.join(root, "github-event-path.json")
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        {
          "phases": {
            "package": {
              "context": {
                "resources": {
                  "url": "https://www.github.com/bitnami/charts",
                  "path": "/bitnami/wordpress"
                }
              }
            }
          }        
        }
      `
      process.env.VIB_ENV_FOO = "foo"
      process.env.VIB_ENV_BAR = "bar"

      pipeline = substituteEnvVariables(config, pipeline)

      expect(pipeline).toBeDefined()
      expect(pipeline).not.toContain(process.env.VIB_ENV_FOO)
      expect(pipeline).not.toContain(process.env.VIB_ENV_BAR)
      // verify we also got two warnings
      expect(core.warning).toHaveBeenCalledTimes(3)
    })

    it("Warns of VIB_ENV_ template variables found in file but not in environment", async () => {
      // Clean warnings by setting these vars
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        {
          "phases": {
            "package": {
              "context": {
                "resources": {
                  "url": "{VIB_ENV_NOT_FOUND}",
                  "path": "/bitnami/wordpress"
                }
              }
            }
          }        
        }
      `
      pipeline = substituteEnvVariables(config, pipeline)
      expect(pipeline).toBeDefined()
      expect(pipeline).toContain("VIB_ENV_NOT_FOUND")
      // verify we also got the warning
      expect(core.setFailed).toHaveBeenCalledTimes(1)
    })

    it("Replaces environment variables with VIB_ENV_ prefix with no prefix within file", async () => {
      // We do also support an abbreviated form where the user does not have to write VIB_ENV_ in their pipelines

      // Clean warnings by setting these vars
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        {
          "phases": {
            "package": {
              "context": {
                "resources": {
                  "url": "{URL}",
                  "path": "{PATH}"
                }
              }
            }
          }        
        }
      `
      process.env.VIB_ENV_URL = "https://www.github.com/bitnami/charts"
      process.env.VIB_ENV_PATH = "/bitnami/wordpress"

      pipeline = substituteEnvVariables(config, pipeline)
      expect(pipeline).toBeDefined()
      expect(pipeline).toContain(process.env.VIB_ENV_URL) // matches the URL var
      expect(pipeline).toContain(process.env.VIB_ENV_PATH) // matches the PATH
      // verify no warnings. This plays helps trusting below tests too
      expect(core.setFailed).toHaveBeenCalledTimes(0)
    })

    it("Warns of VIB_ENV_ template variables found in file but not in environment when using no prefix", async () => {
      // Clean warnings by setting these vars
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        {
          "phases": {
            "package": {
              "context": {
                "resources": {
                  "url": "{NOT_FOUND}", 
                  "path": "/bitnami/wordpress"
                }
              }
            }
          }        
        }
      `
      pipeline = substituteEnvVariables(config, pipeline)
      expect(pipeline).toBeDefined()
      expect(pipeline).toContain("NOT_FOUND") // resolves to env variable VIB_ENV_NOT_FOUND that does not exist
      // verify we also got the warning
      expect(core.setFailed).toHaveBeenCalledTimes(1)
    })

    it("Substitutes TARGET_PLATFORM with VIB_ENV_ variable", async () => {
      // Clean warnings by setting these vars
      process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      process.env.GITHUB_REPOSITORY = "vmware/vib-action"
      process.env.VIB_ENV_TARGET_PLATFORM = "7b13a7bb-011c-474f-ad71-8152fc321b9e"
      process.env.GITHUB_EVENT_PATH = path.join(root, "github-event-path.json")
      const config = await new ConfigurationFactory(root).getConfiguration()
      let pipeline = `
        "target_platform": {
          "target_platform_id": "{TARGET_PLATFORM}",
          "size": {
            "name": "M4",
            "worker_nodes_instance_count": 2
          }
        }
      `
      pipeline = substituteEnvVariables(config, pipeline)
      expect(pipeline).toBeDefined()
      expect(pipeline).toContain(process.env.VIB_ENV_TARGET_PLATFORM)
      expect(core.warning).toHaveBeenCalledTimes(1)
    })

    it("Displays prettified output test report", async () => {
      const executionGraphReport = await getExecutionGraphReport(fixedExecutionGraphId)
      expect(executionGraphReport).toBeDefined()
      if (executionGraphReport) {
        prettifyExecutionGraphResult(executionGraphReport)
      }
    })

    it("Display failed task errors when execution graph is failed", async () => {
      const executionGraph = await getExecutionGraph(fixedExecutionGraphId)
      expect(executionGraph).toBeDefined()
      if (executionGraph["status"] === "FAILED") {
        displayErrorExecutionGraph(executionGraph)
      }
    })
  })

  //TODO: Worth mocking axios and returning custom execution graphs to test the whole flows?
  //      Integration tests are slow
})
