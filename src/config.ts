import * as core from "@actions/core"
import * as path from "path"
import { getNumberArray, getNumberInput } from "./util"
import { VerificationModes } from "./client/vib"
import fs from "fs"
import util from "util"

const DEFAULT_BASE_FOLDER = ".vib"

const DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL_SECS = 30 // 30 seconds

const DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT_SECS = 90 * 60 // 90 minutes

const DEFAULT_PIPELINE_FILE = "vib-pipeline.json"

const DEFAULT_HTTP_TIMEOUT_MILLIS = 120000

const DEFAULT_HTTP_RETRY_COUNT = 3

const DEFAULT_HTTP_RETRY_INTERVALS_MILLIS = [5000, 10000, 15000]

const MAX_GITHUB_ACTION_RUN_TIME_MILLIS = 360 * 60 * 1000 // 6 hours

export interface Config {
  runtimeParametersFile: string,
  baseFolder: string,
  clientTimeoutMillis: number,
  clientRetryCount: number,
  clientRetryIntervals: number[],
  clientUserAgentVersion: string,
  configurationRoot: string,
  executionGraphCheckInterval: number,
  pipeline: string,
  pipelineDurationMillis: number,
  shaArchive: string | undefined,
  onlyUploadOnFailure: boolean,
  targetPlatform: string | undefined,
  tokenExpirationDaysWarning: number,
  uploadArtifacts: boolean,
  verificationMode: VerificationModes
}

class ConfigurationFactory {
  root: string

  constructor(root: string) {
    this.root = root
  }

  getConfiguration(): Config {
    const shaArchive = this.loadGitHubEvent()
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

    let pipelineDurationMillis = getNumberInput("max-pipeline-duration", DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT_SECS) * 1000
    if (pipelineDurationMillis > MAX_GITHUB_ACTION_RUN_TIME_MILLIS) {
      pipelineDurationMillis = DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT_SECS * 1000
      core.warning(
        `The value specified for the pipeline duration is larger than Github's allowed default. Pipeline will run with a duration of ${
          pipelineDurationMillis / 1000
        } seconds.`
      )
    }
    const runtimeParametersFile = core.getInput("runtime-parameters-file")

    const clientTimeoutMillis = getNumberInput("http-timeout", DEFAULT_HTTP_TIMEOUT_MILLIS)
    const clientRetryCount = getNumberInput("retry-count", DEFAULT_HTTP_RETRY_COUNT)
    const clientRetryIntervals = getNumberArray("backoff-intervals", DEFAULT_HTTP_RETRY_INTERVALS_MILLIS)
    const clientUserAgentVersion = process.env.GITHUB_ACTION_REF ? process.env.GITHUB_ACTION_REF : "unknown"

    const executionGraphCheckInterval = 
      getNumberInput("execution-graph-check-interval", DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL_SECS) * 1000

    const config = {
      baseFolder,
      clientTimeoutMillis,
      clientRetryCount,
      clientRetryIntervals,
      clientUserAgentVersion,
      configurationRoot: this.root,
      executionGraphCheckInterval,
      runtimeParametersFile,
      pipeline,
      pipelineDurationMillis,
      shaArchive,
      onlyUploadOnFailure: core.getInput("only-upload-on-failure") === 'true',
      targetPlatform: process.env.VIB_ENV_TARGET_PLATFORM || process.env.TARGET_PLATFORM,
      tokenExpirationDaysWarning: 30,
      uploadArtifacts: core.getInput("upload-artifacts") === 'true',
      verificationMode,
    }

    core.debug(`Config: ${util.inspect(config)}`)

    return config
  }

  private loadGitHubEvent(): string | undefined {
    //TODO: Replace SHA_ARCHIVE with something more meaningful like PR_HEAD_TARBALL or some other syntax. 
    // Perhaps something we could do would be to allow to use as variables to the actions any of the data 
    // from the GitHub event from the GITHUB_EVENT_PATH file. For the time being I'm using pull_request.head.repo.url 
    // plus the ref as the artifact name and reusing shaArchive but we need to redo this in the very short term
    const eventPath = process.env.GITHUB_EVENT_PATH_OVERRIDE ? process.env.GITHUB_EVENT_PATH_OVERRIDE 
      : process.env.GITHUB_EVENT_PATH
    try {
      if (!eventPath) {
        throw new Error(
          "Could not find GITHUB_EVENT_PATH environment variable. Will not have any action event context."
        )
      }

      core.info(`Loading event configuration from ${eventPath}`)

      const githubEvent = JSON.parse(fs.readFileSync(eventPath).toString())
      core.debug(`Loaded config: ${util.inspect(githubEvent)}`)

      if (githubEvent["pull_request"]) {
        // This event triggers only for fork pull requests. We load the sha differently here.
        return encodeURIComponent(`${githubEvent["pull_request"]["head"]["repo"]["url"]}/tarball/${githubEvent["pull_request"]["head"]["ref"]}`)
      } else {
        const ref = process.env.GITHUB_SHA || process.env.GITHUB_REF_NAME || githubEvent?.repository?.master_branch
        if (!ref) {
          core.setFailed(
            `Could not guess the source code ref value. Neither a valid GitHub event or the GITHUB_REF_NAME env variable are available`
          )
        }

        const url = githubEvent["repository"]
          ? encodeURIComponent(githubEvent["repository"]["url"])
          : encodeURIComponent(`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`)
        return encodeURIComponent(`${url}/tarball/${ref}`)
      }
    } catch (error) {
      core.warning(`Could not read content from ${eventPath}. Error: ${error}`)
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
