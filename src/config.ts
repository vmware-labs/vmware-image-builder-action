import * as core from "@actions/core"
import * as path from "path"
import { getNumberArray, getNumberInput } from "./util"
import { VerificationModes } from "./client/vib"
import fs from "fs"
import util from "util"

export const DEFAULT_BASE_FOLDER = ".vib"

const DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL = 30 // 30 seconds

export const DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT = 90 * 60 // 90 minutes

export const DEFAULT_PIPELINE_FILE = "vib-pipeline.json"

const DEFAULT_HTTP_TIMEOUT = 120000

const DEFAULT_HTTP_RETRY_COUNT = 3

const DEFAULT_HTTP_RETRY_INTERVALS = process.env.JEST_WORKER_ID ? [500, 1000, 2000] : [5000, 10000, 15000]

const MAX_GITHUB_ACTION_RUN_TIME = 360 * 60 * 1000 // 6 hours

export interface Config {
  baseFolder: string
  clientTimeout: number,
  clientRetryCount: number,
  clientRetryIntervals: number[],
  clientUserAgentVersion: string,
  executionGraphCheckInterval: number
  pipeline: string
  pipelineDuration: number
  shaArchive: string | undefined
  targetPlatform: string | undefined
  verificationMode: VerificationModes
}

class ConfigurationFactory {
  root: string

  constructor(root: string) {
    this.root = root
  }

  async getConfiguration(): Promise<Config> {
    const shaArchive = await this.loadGitHubEvent()
    core.info(`Resources will be resolved from ${shaArchive}`)

    const baseFolder = core.getInput("config") || DEFAULT_BASE_FOLDER
    const pipeline = core.getInput("pipeline") || DEFAULT_PIPELINE_FILE

    const folderName = path.join(this.root, baseFolder)
    if (!fs.existsSync(folderName)) {
      core.setFailed(`Could not find base folder at ${folderName}`)
    }

    const filename = path.join(folderName, pipeline)
    if (!fs.existsSync(filename)) {
      core.setFailed(`Could not find pipeline at ${filename}`)
    }

    const rawVerificationMode = core.getInput("verification-mode")
    const verificationMode = VerificationModes[rawVerificationMode]
    if (!verificationMode) {
      core.warning(
        `The value ${rawVerificationMode} for verification-mode is not valid, the default value will be used.`
      )
    }

    let pipelineDuration = getNumberInput("max-pipeline-duration", DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT) * 1000
    if (pipelineDuration > MAX_GITHUB_ACTION_RUN_TIME) {
      pipelineDuration = DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT * 1000
      core.warning(
        `The value specified for the pipeline duration is larger than Github's allowed default. Pipeline will run with a duration of ${
          pipelineDuration / 1000
        } seconds.`
      )
    }

    const clientTimeout = getNumberInput("http-timeout", DEFAULT_HTTP_TIMEOUT)
    const clientRetryCount = getNumberInput("retry-count", DEFAULT_HTTP_RETRY_COUNT)
    const clientRetryIntervals = getNumberArray("backoff-intervals", DEFAULT_HTTP_RETRY_INTERVALS)
    const clientUserAgentVersion = process.env.GITHUB_ACTION_REF ? process.env.GITHUB_ACTION_REF : "unknown"

    const executionGraphCheckInterval = 
      getNumberInput("execution-graph-check-interval", DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL) * 1000

    const config = {
      baseFolder,
      clientTimeout,
      clientRetryCount,
      clientRetryIntervals,
      clientUserAgentVersion,
      executionGraphCheckInterval,
      pipeline,
      pipelineDuration,
      shaArchive,
      targetPlatform: process.env.VIB_ENV_TARGET_PLATFORM || process.env.TARGET_PLATFORM,
      verificationMode,
    }

    core.debug(`Config: ${util.inspect(config)}`)

    return config
  }

  private async loadGitHubEvent(): Promise<string | undefined> {
    //TODO: Replace SHA_ARCHIVE with something more meaningful like PR_HEAD_TARBALL or some other syntax. 
    // Perhaps something we could do would be to allow to use as variables to the actions any of the data 
    // from the GitHub event from the GITHUB_EVENT_PATH file. For the time being I'm using pull_request.head.repo.url 
    // plus the ref as the artifact name and reusing shaArchive but we need to redo this in the very short term
    try {
      if (!process.env.GITHUB_EVENT_PATH) {
        throw new Error(
          "Could not find GITHUB_EVENT_PATH environment variable. Will not have any action event context."
        )
      }

      core.info(`Loading event configuration from ${process.env.GITHUB_EVENT_PATH}`)

      const githubEvent = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH).toString())
      core.debug(`Loaded config: ${util.inspect(githubEvent)}`)

      if (githubEvent["pull_request"]) {
        // This event triggers only for fork pull requests. We load the sha differently here.
        return `${githubEvent["pull_request"]["head"]["repo"]["url"]}/tarball/${githubEvent["pull_request"]["head"]["ref"]}`
      } else {
        const ref = process.env.GITHUB_SHA || process.env.GITHUB_REF_NAME || githubEvent?.repository?.master_branch
        if (!ref) {
          core.setFailed(
            `Could not guess the source code ref value. Neither a valid GitHub event or the GITHUB_REF_NAME env variable are available`
          )
        }

        const url = githubEvent["repository"]
          ? githubEvent["repository"]["url"]
          : `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
        return `${url}/tarball/${ref}`
      }
    } catch (error) {
      core.warning(`Could not read content from ${process.env.GITHUB_EVENT_PATH}. Error: ${error}`)
      if (!process.env.GITHUB_SHA) {
        core.warning(
          "Could not find a valid GitHub SHA on environment. Is the GitHub action running as part of PR?"
        )
      } else if (!process.env.GITHUB_REPOSITORY) {
        core.warning(
          "Could not find a valid GitHub Repository on environment. Is the GitHub action running as part of PR?"
        )
      } else {
        return `https://github.com/${process.env.GITHUB_REPOSITORY}/archive/${process.env.GITHUB_SHA}.zip`
      }
    }
  }
}

export default ConfigurationFactory
