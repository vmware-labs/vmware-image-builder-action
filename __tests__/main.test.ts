// eslint-disable-next-line filenames/match-regex
import * as core from "@actions/core"
import * as path from "path"
import {
  getLogsFolder,
  runAction,
} from "../src/main"
import fs from "fs"

const root = path.join(__dirname, ".")
let fixedExecutionGraphId

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

