import * as core from "@actions/core"
import path from 'path'
import Action from "../../src/action"
import { TaskStatus } from '../../src/client/vib/api'

const TWO_MINUTES = 1200000

jest.spyOn(core, 'setFailed')

describe('Given a VIB Action', () => {

  let action: Action

  beforeAll(() => {
    delete process.env["GITHUB_EVENT_PATH"]
    delete process.env["GITHUB_SHA"]
    delete process.env["GITHUB_REPOSITORY"]

    action = new Action(path.join(__dirname, '..'))
    action.config = { ...action.config, baseFolder: 'resources/.vib' }
  })

  it('When it is executed then it returns the final ActionResult', async () => {
    const result = await action.main()

    expect(result.artifacts.length).toBe(9)
    expect(result.executionGraph.status).toBe(TaskStatus.Succeeded)
    expect(result.executionGraph.tasks.length).toBe(4)
    expect(result.executionGraphReport).toBeDefined
    expect(result.executionGraphReport?.passed).toBe(false)
    expect(result.executionGraphReport?.actions.length).toBe(1)
  }, TWO_MINUTES)

  it('When the execution graph times out then it fails', async () => {
    action.config = { ...action.config, executionGraphCheckInterval: 100, pipelineDuration: 100 }

    await expect(action.main()).rejects.toThrowError(/^Pipeline .+ timed out\. Ending GitHub Action\.$/)
  })
})