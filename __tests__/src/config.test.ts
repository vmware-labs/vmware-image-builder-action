// eslint-disable-next-line filenames/match-regex
import * as core from "@actions/core"
import * as path from "path"
import ConfigurationFactory from "../../src/config"

const STARTING_ENV = process.env
const root = path.join(__dirname, "..")
const configFactory = new ConfigurationFactory(root)

describe("Given a configuration", () => {
  beforeAll(() => {
    jest.spyOn(core, "info").mockImplementation(msg => console.log("::info:: " + msg))
    jest.spyOn(core, "warning").mockImplementation(msg => console.log("::warning:: " + msg))
    jest.spyOn(core, "debug").mockImplementation(msg => console.log("::debug:: " + msg))
    jest.spyOn(core, "setFailed")
  })

  beforeEach(() => {
    process.env = { ...STARTING_ENV }

    // Needed to delete these for running tests on GitHub Action
    delete process.env["GITHUB_EVENT_PATH"]
    delete process.env["GITHUB_SHA"]
    delete process.env["GITHUB_REPOSITORY"]
  })

  it("When github sha is not present there will be no sha archive config property", () => {
    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeUndefined()
  })

  it("When github repository is not present there will be no sha archive config property", () => {
    process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"

    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeUndefined()
  })

  it("When both github sha and repository are present then there will be sha archive config property set", () => {
    process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
    process.env.GITHUB_REPOSITORY = "vmware/vib-action"

    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toEqual(
      `https://github.com/vmware/vib-action/archive/aacf48f14ed73e4b368ab66abf4742b0e9afae54.zip`
    )
  })

  it("Loads event configuration from the environment path", () => {
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-path.json")

    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toBe("https://api.github.com/repos/mpermar/vib-action-test/tarball/a-new-branch")
  })

  it("When event configuration exists SHA archive variable is set from its data", () => {
    process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54"
    process.env.GITHUB_REPOSITORY = "vmware/vib-action"
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-path.json") // overseeds the previous two env vars

    const config = configFactory.getConfiguration()
    expect(config.shaArchive).toEqual("https://api.github.com/repos/mpermar/vib-action-test/tarball/a-new-branch")
    
  })

  it("When push from branch and no SHA archive variable is set then sha is picked from ref env", () => {
    process.env.GITHUB_REF_NAME = "martinpe-patch-1" // this is what rules
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-path-branch.json") // still will use env var above

    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toEqual("https://github.com/mpermar/vib-action-test/tarball/martinpe-patch-1")
  })

  it("When a special character present in URL from 'tarball' onwards, GitHub Action encodes it", () => {
    process.env.GITHUB_REF_NAME = "#artine-patch-1" // this is what rules
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-path-branch.json") // still will use env var above
    
    const config =  configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toContain('https://github.com/mpermar/vib-action-test/tarball/%23artine-patch-1')
  })

  it("When a '/' present in URL from 'tarball' onwards, GitHub Action excludes it from encoding", () => {
    process.env.GITHUB_REF_NAME = "marti/ne-patch-1" // this is what rules
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-path-branch.json") // still will use env var above
    
    const config =  configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toContain('https://github.com/mpermar/vib-action-test/tarball/marti/ne-patch-1')
  })

  it("When push from branch and both SHA archive and REF are set then sha is picked from SHA env", () => {
    process.env.GITHUB_SHA = "aacf48f14ed73e4b368ab66abf4742b0e9afae54" // this will be ignored
    process.env.GITHUB_REF_NAME = "martinpe-patch-1" // this is what rules
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-path-branch.json") // still will use env var above

    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toEqual(
        "https://github.com/mpermar/vib-action-test/tarball/aacf48f14ed73e4b368ab66abf4742b0e9afae54"
      )  
  })

  it("When triggered from a scheduled job, GitHub Action still gets an archive to download", () => {
    process.env.GITHUB_REPOSITORY = "vmware/vib-action"
    process.env.GITHUB_SERVER_URL = "https://github.com"
    process.env.GITHUB_REF_NAME = "martinpe-patch-1"
    process.env.GITHUB_EVENT_PATH = path.join(root, "resources", "github-event-scheduled.json")

    const config = configFactory.getConfiguration()

    expect(config.shaArchive).toBeDefined()
    expect(config.shaArchive).toEqual("https://github.com/vmware/vib-action/tarball/martinpe-patch-1")
  })

  it("Default base folder is used when not customized", () => {
    const config = configFactory.getConfiguration()

    expect(config.baseFolder).toEqual(".vib")
  })

  it("Default base folder is not used when customized", () => {
    const expectedInputconfig = ".vib-other"
    process.env["INPUT_CONFIG"] = expectedInputconfig

    const config = configFactory.getConfiguration()

    expect(config.baseFolder).toEqual(expectedInputconfig)
  })

  it("Default pipeline is used when not customized", () => {
    const config = configFactory.getConfiguration()

    expect(config.pipeline).toEqual("vib-pipeline.json")
  })

  it("Default pipeline duration is used when not customized", () => {
    const config = configFactory.getConfiguration()

    expect(config.pipelineDurationMillis).toEqual(90 * 60 * 1000)
  })

  it("Passed pipeline duration is used when customized", () => {
    const expectedMaxDuration = 3333
    process.env["INPUT_MAX-PIPELINE-DURATION"] = "" + expectedMaxDuration

    const config = configFactory.getConfiguration()

    expect(config.pipelineDurationMillis).toEqual(expectedMaxDuration * 1000)
  })

  it("If file does not exist, throw an error", () => {
    process.env["INPUT_PIPELINE"] = "wrong.json"

    configFactory.getConfiguration()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Could not find pipeline"))
  })

  it("If verification mode has not a valid value the default is used", () => {
    const wrongVerificationMode = "WHATEVER"
    process.env["INPUT_VERIFICATION-MODE"] = wrongVerificationMode

    configFactory.getConfiguration()

    expect(core.warning).toHaveBeenCalledWith(
      `The value ${wrongVerificationMode} for verification-mode is not valid, the default value will be used.`
    )
  })

  it("Passed verification mode is used when customized", () => {
    const expectedVerificationMode = "SERIAL"
    process.env["INPUT_VERIFICATION-MODE"] = expectedVerificationMode

    const config = configFactory.getConfiguration()

    expect(config.verificationMode.toString()).toEqual(expectedVerificationMode)
  })
})
