import { Phase, Task, TaskStatus } from '../../src/client/vib/api'

export function trivy(task_id = '8b9ea8f0-06d7-4332-b353-afcbadfc89ea', status: TaskStatus = TaskStatus.Succeeded): Task {
  return {
    action_id: 'trivy',
    action_version: '0.113.0',
    status,
    execution_time: 29,
    started_at: '2023-01-19T14:16:08.226643Z',
    phase: Phase.Verify,
    task_id,
    previous_tasks: [],
    next_tasks: [],
    preconditions: [],
    params: {
      'allowlist': [],
      'threshold': 'IGNORE_ALL',
      'application': {
        'kind': 'HELM',
        'details': {
          'name': 'wordpress',
          'repository': {
            'url': 'oci://docker.io/bitnami/charts'
          },
          'version': '15.0.4'
        }
      }
    }
  }
}

export function cypress(task_id = 'd426abec-4d9e-44d1-b540-0448197d5651', status: TaskStatus = TaskStatus.Succeeded): Task {
  return {
    action_id: 'cypress',
    action_version: '0.113.0',
    status,
    execution_time: 113,
    started_at: '2023-01-19T14:16:08.364005Z',
    phase: Phase.Verify,
    task_id,
    previous_tasks: [],
    next_tasks: [],
    preconditions: [],
    params: {
      'port': '80',
      'host': '192.168.122.123',
      'resources': {
        'path': '/examples/wordpress/cypress',
        'url': 'https://github.com/testproject/'
      },
      'app_protocol': 'HTTP',
      'env': {
        'password': 'test_password',
        'username': 'test_user'
      }
    }
  }
}