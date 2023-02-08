import * as core from "@actions/core"
import * as artifact from "@actions/artifact"
import * as executionGraphMother from '../mother/execution-graph'
import * as executionGraphReportMother from '../mother/execution-graph-report'
import * as pipelineMother from '../mother/pipeline'
import * as targetPlatformMother from '../mother/target-platform'
import * as taskMother from '../mother/task'
import * as Fixtures from '../fixtures/fixtures'
import moment from "moment"
import path from 'path'
import Action from '../../src/action'
import { ExecutionGraph, Pipeline, TaskStatus } from "../../src/client/vib/api"
import { Readable } from "stream"
import fs from "fs"

jest.mock('../../src/client/csp')
jest.mock('../../src/client/vib')

jest.spyOn(artifact, 'create')
jest.spyOn(core, 'error')
jest.spyOn(core, 'info')
jest.spyOn(core, 'setFailed')
jest.spyOn(core, 'warning')

const STARTING_ENV = process.env

describe('Given an Action', () => {

  let action: Action

  beforeEach(() => {
    process.env = { ...STARTING_ENV, ACTIONS_RUNTIME_TOKEN: 'test-token' }
    
    delete process.env["GITHUB_EVENT_PATH"]
    delete process.env["GITHUB_JOB"]
    delete process.env['GITHUB_RUN_ATTEMPT']
    delete process.env["GITHUB_SHA"]
    delete process.env["GITHUB_REPOSITORY"]

    action = new Action(path.join(__dirname, ".."))
    action.config = { 
      ...action.config, 
      baseFolder: 'resources/.vib', 
      executionGraphCheckInterval: 500, 
      pipelineDuration: 2500, 
      uploadArtifacts: true 
    }
    
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and a checkCSPTokenExpiration function', () => {
    it('When the expiration window narrower than the expiration days warning then it warns', async () => {
      action.config = { ...action.config, tokenExpirationDaysWarning: 10 }
      jest.spyOn(action.csp, 'checkTokenExpiration')
        .mockResolvedValue(moment().add(action.config.tokenExpirationDaysWarning - 1, 'days').unix());
      
      await action.checkCSPTokenExpiration()

      expect(core.warning).toBeCalledTimes(1)
      expect(core.warning).toBeCalledWith(`CSP API token will expire in ${action.config.tokenExpirationDaysWarning - 2} days.`)
    })

    it('When the expiration window greater than the expiration days warning then it does not warn', async () => {
      action.config = { ...action.config, tokenExpirationDaysWarning: 10 }
      jest.spyOn(action.csp, 'checkTokenExpiration')
        .mockResolvedValue(moment().add(action.config.tokenExpirationDaysWarning + 1, 'days').unix());
      
      await action.checkCSPTokenExpiration()

      expect(core.warning).not.toHaveBeenCalled()
    })
  })
  
  describe('and a readPipeline function', () => {
    it('When the default config is used then it reads the pipeline', async () => {
      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.package).toBeDefined()
      expect(pipeline.phases.package?.actions.length).toEqual(2)
    })

    it('When a custom pipeline location is used then it reads the pipeline', async () => {
      action.config = { ...action.config, baseFolder: 'resources/.vib-other', pipeline: 'vib-pipeline-other.json' }

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.package).toBeDefined()
      expect(pipeline.phases.package?.actions.length).toEqual(1)
    })

    it('When GitHub information is found but no SHA_ARCHIVE is declared then it does not template it', async () => {
      const shaArchive = 'https://github.com/repo/archive/main.zip'
      action.config = { ...action.config, shaArchive }

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(JSON.stringify(pipeline)).not.toContain(shaArchive)
    })

    it('When GitHub information is found and SHA_ARCHIVE is declared then it templates it', async () => {
      const shaArchive = 'https://github.com/repo/archive/main.zip'
      action.config = { ...action.config, shaArchive, pipeline: 'vib-sha-archive.json' }

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.package?.context?.resources).toBeDefined()
      expect(pipeline.phases.package?.context?.resources?.url).toEqual(shaArchive)
    })

    it('When GitHub information is not found and SHA_ARCHIVE is declared then it throws', async () => {
      const pipeline = 'vib-sha-archive.json'
      action.config = { ...action.config, pipeline }

      await expect(action.readPipeline()).rejects
        .toThrowError(`Pipeline ${pipeline} expects SHA_ARCHIVE variable but either GITHUB_REPOSITORY or GITHUB_SHA cannot be found on environment.`)
    })
    
    it('When env vars with VIB_ENV_ prefix exist then it substitutes them', async () => {
      process.env.VIB_ENV_URL = "https://www.github.com/bitnami/charts"
      process.env.VIB_ENV_PATH = "/bitnami/wordpress"
      action.config = { ...action.config, pipeline: 'pipeline-with-vib-envs.json'}

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.package?.context?.resources).toBeDefined()
      expect(pipeline.phases.package?.context?.resources?.url).toEqual(process.env.VIB_ENV_URL)
      expect(pipeline.phases.package?.context?.resources?.path).toEqual(process.env.VIB_ENV_PATH)
    })

    it('When no replacements for templated variables exist then it warns', async () => {
      action.config = { ...action.config, pipeline: 'pipeline-with-vib-envs.json'}

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.package?.context?.resources).toBeDefined()
      expect(pipeline.phases.package?.context?.resources?.url).toEqual('{VIB_ENV_URL}')
      expect(pipeline.phases.package?.context?.resources?.path).toEqual('{PATH}')
      expect(core.warning).toBeCalledTimes(2)
    })

    it('When env vars with VIB_ENV_ prefix exist but not their templated var then it warns', async () => {
      process.env.VIB_ENV_URL = "https://www.github.com/bitnami/charts"
      process.env.VIB_ENV_PATH = "/bitnami/wordpress"

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(core.warning).toBeCalledTimes(2)
    })

    it('When variables with {{ exist then it does not substitute them', async () => {
      action.config = { ...action.config, pipeline: 'pipeline-with-vib-envs.json'}

      const pipeline = await action.readPipeline()

      expect(pipeline).toBeDefined()
      expect(pipeline.phases.verify?.actions).toBeDefined()
      expect(pipeline.phases.verify?.actions.length).toEqual(1)
      expect(pipeline.phases.verify?.actions[0].params['kubeconfig']).toEqual("{{kubeconfig}}")
    })

    it('When a runtime_parameters file is provided then they are added into the pipeline in base64', async () => {
      action.config = { ...action.config, pipeline: 'vib-pipeline-file.json', runtimeParametersFile: 'runtime-parameters-file.yaml' }
      
      const pipeline = await action.readPipeline()
      expect(pipeline).toBeDefined()
      expect(pipeline.phases.verify?.context?.runtime_parameters).toBeDefined()
      expect(pipeline.phases.verify?.context?.runtime_parameters).toBe(Buffer.from(Fixtures.runtimeParameters()).toString('base64')
      );
    });
  })

  describe('and a runPipeline function', () => {
    it('When a valid pipeline is given then it is submitted and the related execution graph is returned', async () => {
      const pipeline: Pipeline = pipelineMother.valid()
      const executionGraph: ExecutionGraph = executionGraphMother.empty(undefined, TaskStatus.Succeeded)
      jest.spyOn(action.vib, 'validatePipeline').mockResolvedValue([])
      jest.spyOn(action.vib, 'createPipeline').mockResolvedValue(executionGraph.execution_graph_id)
      jest.spyOn(action.vib, 'getExecutionGraph').mockResolvedValue(executionGraph)

      const result = await action.runPipeline(pipeline)

      expect(action.vib.validatePipeline).toHaveBeenCalledWith(pipeline)
      expect(action.vib.createPipeline).toHaveBeenCalledWith(pipeline, action.config.pipelineDuration, action.config.verificationMode)
      expect(action.vib.getExecutionGraph).toHaveBeenCalledWith(executionGraph.execution_graph_id)
      expect(result).toEqual(executionGraph)
    })

    it('When a wrong pipeline is given then it throws', async () => {
      const pipeline: Pipeline = pipelineMother.valid()
      const error = 'Random test error'
      jest.spyOn(action.vib, 'validatePipeline').mockResolvedValue([error])

      await expect(action.runPipeline(pipeline)).rejects.toThrowError(error)
      expect(action.vib.validatePipeline).toHaveBeenCalledWith(pipeline)
      expect(action.vib.createPipeline).not.toBeCalled()
      expect(action.vib.getExecutionGraph).not.toBeCalled()
    })

    it('When the vib client calls fail then it propagates the errors', async () => {
      const pipeline: Pipeline = pipelineMother.valid()
      const executionGraphId = 'fakeId'
      const error = new Error(`Could not find execution graph with id ${executionGraphId}`)
      jest.spyOn(action.vib, 'validatePipeline').mockResolvedValue([])
      jest.spyOn(action.vib, 'createPipeline').mockResolvedValue(executionGraphId)
      jest.spyOn(action.vib, 'getExecutionGraph').mockRejectedValue(error)

      await expect(action.runPipeline(pipeline)).rejects.toThrowError(error)
      expect(action.vib.validatePipeline).toHaveBeenCalledWith(pipeline)
      expect(action.vib.createPipeline).toHaveBeenCalledWith(pipeline, action.config.pipelineDuration, action.config.verificationMode)
      expect(action.vib.getExecutionGraph).toHaveBeenCalledWith(executionGraphId)
    })

    it('When the execution graph takes some time to complete then it polls until it finishes', async () => {
      const pipeline: Pipeline = pipelineMother.valid()
      const executionGraph: ExecutionGraph = executionGraphMother.empty(undefined, TaskStatus.Failed)
      jest.spyOn(action.vib, 'validatePipeline').mockResolvedValue([])
      jest.spyOn(action.vib, 'createPipeline').mockResolvedValue(executionGraph.execution_graph_id)
      jest.spyOn(action.vib, 'getExecutionGraph')
        .mockResolvedValueOnce({ ...executionGraph, status: TaskStatus.InProgress })
        .mockResolvedValue(executionGraph)

      const result = await action.runPipeline(pipeline)

      expect(action.vib.getExecutionGraph).toHaveBeenCalledTimes(2)
      expect(action.vib.getExecutionGraph).toHaveBeenCalledWith(executionGraph.execution_graph_id)
      expect(result).toEqual(executionGraph)
    })

    it('When the execution graph takes longer than the pipeline duration then it throws', async () => {
      action.config = { ...action.config, pipelineDuration: 750 }
      const pipeline: Pipeline = pipelineMother.valid()
      const executionGraph: ExecutionGraph = executionGraphMother.empty(undefined, TaskStatus.InProgress)
      jest.spyOn(action.vib, 'validatePipeline').mockResolvedValue([])
      jest.spyOn(action.vib, 'createPipeline').mockResolvedValue(executionGraph.execution_graph_id)
      jest.spyOn(action.vib, 'getExecutionGraph').mockResolvedValue(executionGraph)

      await expect(action.runPipeline(pipeline)).rejects.toThrowError()
      expect(action.vib.getExecutionGraph).toHaveBeenCalledTimes(2)
    });

    it('When some tasks fail during the execution check then a log is printed once', async () => {
      const cypressFailed = taskMother.cypress(undefined, TaskStatus.Failed)
      const deployFailed = taskMother.deployment(undefined, TaskStatus.Failed, cypressFailed.task_id)
      const executionGraph: ExecutionGraph = executionGraphMother.empty(undefined, TaskStatus.InProgress, [ deployFailed, cypressFailed ])
      jest.spyOn(action.vib, 'validatePipeline').mockResolvedValue([])
      jest.spyOn(action.vib, 'createPipeline').mockResolvedValue(executionGraph.execution_graph_id)
      jest.spyOn(action.vib, 'getExecutionGraph')
        .mockResolvedValueOnce(executionGraph)
        .mockResolvedValueOnce(executionGraph)
        .mockResolvedValueOnce({...executionGraph, status: TaskStatus.Failed})

      await action.runPipeline(pipelineMother.valid())

      expect(core.error).toBeCalledTimes(2)
      expect(core.error).toHaveBeenNthCalledWith(1, 'Task deployment (cypress) has failed. Error: undefined')
      expect(core.error).toHaveBeenNthCalledWith(2, 'Task cypress has failed. Error: undefined')
    })
  })

  describe('and a processExecutionGraph function', () => {
    it('When an execution graph is provided then it returns the corresponding action result', async () => {
      const executionGraph = executionGraphMother.empty(undefined, undefined, [ taskMother.trivy() ])
      const executionGraphReport = executionGraphReportMother.report()
      jest.spyOn(action.vib, 'getRawLogs').mockResolvedValue('test raw logs')
      jest.spyOn(action.vib, 'getRawReports').mockResolvedValue([{id: 'test-id', mime_type: 'text/html', filename: 'test.html'}])
      jest.spyOn(action.vib, 'getRawReport').mockResolvedValue(Readable.from('test raw report'))
      jest.spyOn(action.vib, 'getExecutionGraphReport').mockResolvedValue(executionGraphReport)

      const result = await action.processExecutionGraph(executionGraph)

      expect(result.baseDir).toContain('__tests__')
      expect(result.executionGraphReport).toEqual(executionGraphReport)
      expect(result.artifacts.length).toEqual(3)
      for (const a of result.artifacts) {
        expect(fs.existsSync(a)).toBeTruthy()
      }
    })

    it('When an execution graph is provided then it fetches the logs of the tasks FAILED and SUCCEEDED', async () => {
      const executionGraph = executionGraphMother.empty(undefined, TaskStatus.Failed)
      executionGraph.tasks = [ taskMother.cypress(undefined, TaskStatus.Failed), taskMother.trivy() ]

      await action.processExecutionGraph(executionGraph)

      expect(action.vib.getRawLogs).toHaveBeenCalledTimes(2)
      expect(action.vib.getRawLogs).toHaveBeenCalledWith(executionGraph.execution_graph_id, executionGraph.tasks[0].task_id)
      expect(action.vib.getRawLogs).toHaveBeenCalledWith(executionGraph.execution_graph_id, executionGraph.tasks[1].task_id)
    })

    it('When onlyUploadOnFailure is true then it only fetches the logs of the tasks FAILED', async () => {
      action.config = { ...action.config, onlyUploadOnFailure: true }
      const executionGraph = executionGraphMother.empty(undefined, TaskStatus.Failed)
      executionGraph.tasks = [ taskMother.cypress(undefined, TaskStatus.Failed), taskMother.trivy() ]

      await action.processExecutionGraph(executionGraph)

      expect(action.vib.getRawLogs).toHaveBeenCalledTimes(1)
      expect(action.vib.getRawLogs).toHaveBeenCalledWith(executionGraph.execution_graph_id, executionGraph.tasks[0].task_id)
    })

    it('When a logs request fails then it does not throw', async () => {
      const executionGraph = executionGraphMother.empty(undefined, TaskStatus.Failed, [ taskMother.trivy(undefined, TaskStatus.Failed) ])
      const error = new Error('fake error test')
      jest.spyOn(action.vib, 'getRawLogs').mockRejectedValue(error)

      await expect(action.processExecutionGraph(executionGraph)).resolves.not.toThrowError()
      expect(action.vib.getRawLogs).toHaveBeenCalledTimes(1)
      expect(core.warning).toHaveBeenCalledWith(`Error downloading task logs file for task ${executionGraph.tasks[0].task_id}, error: ${error}`)
    })

    it('When an execution graph is provided then it fetches the SUCCEEDED tasks raw reports', async () => {
      const executionGraph = executionGraphMother.empty(undefined, TaskStatus.Failed)
      executionGraph.tasks = [ taskMother.cypress(undefined, TaskStatus.Failed), taskMother.trivy() ]

      await action.processExecutionGraph(executionGraph)
      
      expect(action.vib.getRawReports).toHaveBeenCalledTimes(1)
      expect(action.vib.getRawReports).toHaveBeenCalledWith(executionGraph.execution_graph_id, executionGraph.tasks[1].task_id)
    })

    it('When a raw reports request fails then it does not throw', async () => {
      const executionGraph = executionGraphMother.empty(undefined, TaskStatus.Failed, [ taskMother.trivy(undefined, TaskStatus.Succeeded) ])
      const error = new Error('fake error test')
      jest.spyOn(action.vib, 'getRawLogs').mockResolvedValue('test raw logs')
      jest.spyOn(action.vib, 'getRawReports').mockRejectedValue(error)

      await expect(action.processExecutionGraph(executionGraph)).resolves.not.toThrowError()
      expect(action.vib.getRawReports).toHaveBeenCalledTimes(1)
      expect(core.warning).toHaveBeenCalledWith(`Error downloading report files for task ${executionGraph.tasks[0].task_id}, error: ${error}`)
    })

    it('When a SUCCESSFUL execution graph is provided then it fetches its report', async () => {
      const executionGraph = executionGraphMother.empty()
      const executionGraphReport = executionGraphReportMother.report()
      jest.spyOn(action.vib, 'getExecutionGraphReport').mockResolvedValue(executionGraphReport)

      const result = await action.processExecutionGraph(executionGraph)
      
      expect(action.vib.getExecutionGraphReport).toHaveBeenCalledTimes(1)
      expect(action.vib.getExecutionGraphReport).toHaveBeenCalledWith(executionGraph.execution_graph_id)
      expect(result.executionGraphReport).toEqual(executionGraphReport)
    })

    it('When an non SUCCESSFUL execution graph is provided then it fetches its report', async () => {
      const executionGraph = executionGraphMother.empty(undefined, TaskStatus.Skipped)
      jest.spyOn(action.vib, 'getExecutionGraphReport').mockResolvedValue(executionGraphReportMother.report())

      const result = await action.processExecutionGraph(executionGraph)
      
      expect(action.vib.getExecutionGraphReport).toHaveBeenCalledTimes(0)
      expect(result.executionGraphReport).toBeUndefined()
    })
  })

  describe('and an uploadArtifacts function', () => {
    it('When uploadArtifacts is false then it does not upload anything', async () => {
      action.config = { ...action.config, uploadArtifacts: false }
      jest.spyOn(action.vib, 'getTargetPlatform').mockRejectedValueOnce(new Error('Target Platform not found'))
      const artifactClient = artifactClientMock()
      jest.spyOn(artifactClient, 'uploadArtifact')
      jest.spyOn(artifact, 'create').mockReturnValue(artifactClient)

      await action.uploadArtifacts('testBaseDir', [ 'testBaseDir/testArtifact' ], 'test-execution-grahp-id')

      expect(artifactClient.uploadArtifact).not.toBeCalledWith()
      expect(core.info).toBeCalledWith('Artifacts will not be published.')
    })

    it('When the target platform is not found then it uses the job name in the artifact name', async () => {
      const baseDir = 'testBaseDir'
      const artifacts = [ 'testBaseDir/testArtifact' ]
      const executionGraphId = 'test-execution-grahp-id'
      jest.spyOn(action.vib, 'getTargetPlatform').mockRejectedValueOnce(new Error('Target Platform not found'))
      const artifactClient = artifactClientMock()
      jest.spyOn(artifactClient, 'uploadArtifact')
      jest.spyOn(artifact, 'create').mockReturnValue(artifactClient)

      await action.uploadArtifacts(baseDir, artifacts, executionGraphId)

      expect(artifactClient.uploadArtifact).toBeCalledWith('assets-undefined-test-exe', artifacts, baseDir, {continueOnError: true})
      expect(core.info).toBeCalledWith('Uploaded artifact: ')
    })

    it('When the target platform is found then it is used in the artifact name', async () => {
      const targetPlatform = targetPlatformMother.gke()
      action.config = { ...action.config, targetPlatform: targetPlatform.id}
      const baseDir = 'testBaseDir'
      const artifacts = [ 'testBaseDir/testArtifact' ]
      const executionGraphId = 'test-execution-grahp-id'
      jest.spyOn(action.vib, 'getTargetPlatform').mockResolvedValue(targetPlatform)
      const artifactClient = artifactClientMock()
      jest.spyOn(artifactClient, 'uploadArtifact')
      jest.spyOn(artifact, 'create').mockReturnValue(artifactClient)

      await action.uploadArtifacts(baseDir, artifacts, executionGraphId)

      expect(artifactClient.uploadArtifact).toBeCalledWith('assets-undefined-GKE-test-exe', artifacts, baseDir, {continueOnError: true})
      expect(core.info).toBeCalledWith('Uploaded artifact: ')
    })

    it('When a GitHub run attempt exists then it is used in the artifact name', async () => {
      process.env.GITHUB_RUN_ATTEMPT = '2'
      const baseDir = 'testBaseDir'
      const artifacts = [ 'testBaseDir/testArtifact' ]
      const executionGraphId = 'test-execution-grahp-id'
      jest.spyOn(action.vib, 'getTargetPlatform').mockRejectedValueOnce(new Error('Target Platform not found'))
      const artifactClient = artifactClientMock()
      jest.spyOn(artifactClient, 'uploadArtifact')
      jest.spyOn(artifact, 'create').mockReturnValue(artifactClient)

      await action.uploadArtifacts(baseDir, artifacts, executionGraphId)

      expect(artifactClient.uploadArtifact).toBeCalledWith('assets-undefined_2-test-exe', artifacts, baseDir, {continueOnError: true})
      expect(core.info).toBeCalledWith('Uploaded artifact: ')
    })

    it('When a GitHub run attempt <= 1 exists then it is not used in the artifact name', async () => {
      process.env.GITHUB_RUN_ATTEMPT = '1'
      const baseDir = 'testBaseDir'
      const artifacts = [ 'testBaseDir/testArtifact' ]
      const executionGraphId = 'test-execution-grahp-id'
      jest.spyOn(action.vib, 'getTargetPlatform').mockRejectedValueOnce(new Error('Target Platform not found'))
      const artifactClient = artifactClientMock()
      jest.spyOn(artifactClient, 'uploadArtifact')
      jest.spyOn(artifact, 'create').mockReturnValue(artifactClient)

      await action.uploadArtifacts(baseDir, artifacts, executionGraphId)

      expect(artifactClient.uploadArtifact).toBeCalledWith('assets-undefined-test-exe', artifacts, baseDir, {continueOnError: true})
      expect(core.info).toBeCalledWith('Uploaded artifact: ')
    })
  })

  describe('and a summarize function', () => {
    it('When an execution graph and report are provided then it displays the prettified report', () => {
      const executionGraph = executionGraphMother
        .empty(undefined, undefined, [taskMother.cypress(), taskMother.trivy(), taskMother.trivy(undefined, TaskStatus.Skipped)])
      const executionGraphReport = executionGraphReportMother.report()
      executionGraphReport.passed = false

      action.summarize(executionGraph, {baseDir: '', artifacts: [], executionGraph, executionGraphReport})

      expect(core.info).toHaveBeenCalledTimes(6)
      expect(core.info).toHaveBeenNthCalledWith(1, '\u001b[1mPipeline result: \u001b[31mfailed\u001b[39m\u001b[22m')
      expect(core.info).toHaveBeenNthCalledWith(2, '\u001b[1mtrivy: \u001b[31mfailed\u001b[39m\u001b[22m')
      expect(core.info).toHaveBeenNthCalledWith(3, '\u001b[1mcypress: \u001b[32mpassed\u001b[39m\u001b[22m')
      expect(core.info).toHaveBeenNthCalledWith(4, '\u001b[1mtrivy action:\u001b[22m \u001b[31mfailed\u001b[39m » Vulnerabilities: 6 minimal, 5 low, 4 medium, 3 high, \u001b[1m\u001b[31m2 critical\u001b[39m\u001b[22m, 1 unknown')
      expect(core.info).toHaveBeenNthCalledWith(5, '\u001b[1mcypress action:\u001b[22m \u001b[32mpassed\u001b[39m » Tests: \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m, \u001b[1m\u001b[33m2 skipped\u001b[39m\u001b[22m, \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m')
      expect(core.info).toHaveBeenNthCalledWith(6, '\u001b[1mActions: \u001b[32m1 passed\u001b[39m, \u001b[33m1 skipped\u001b[39m, \u001b[31m1 failed\u001b[39m, 3 total\u001b[22m')
    })
  })
})

function artifactClientMock(artifactName = '', artifactItems = [''], downloadPath = '', failedItems = []): artifact.ArtifactClient {
  return {
    uploadArtifact: () => new Promise(resolve => resolve({artifactName, artifactItems, size: artifactItems.length, failedItems})),
    downloadArtifact: () => new Promise(resolve => resolve({artifactName, downloadPath})),
    downloadAllArtifacts: () => new Promise(resolve => resolve([]))
  }
}