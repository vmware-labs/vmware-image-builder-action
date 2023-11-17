import * as core from "@actions/core"
import path from 'path'
import Action from "../../src/action"
import { TaskStatus } from '../../src/client/vib/api'
import fs from 'fs'

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
    
    expect(result.executionGraph.status).toBe(TaskStatus.Succeeded)
    expect(result.executionGraph.tasks.length).toBe(5)
    expect(result.executionGraphReport).toBeDefined
    expect(result.executionGraphReport?.passed).toBe(true)
    expect(result.executionGraphReport?.actions.length).toBe(1)
    expect(result.artifacts.length).toBe(14)
    result.artifacts.forEach(a => expect(fs.existsSync(a)).toBeFalsy())
  }, TWO_MINUTES)

  it('When the execution graph times out then it fails', async () => {
    action.config = { ...action.config, executionGraphCheckInterval: 100, pipelineDurationMillis: 100 }

    await expect(action.main()).rejects.toThrowError(/^Pipeline .+ timed out\. Ending pipeline execution\.$/)
  })
})